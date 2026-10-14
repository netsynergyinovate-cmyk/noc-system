package billing

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// Tes Scheduler memakai jam palsu yang digerakkan tes. Tidak ada tidur dan tidak
// ada ketergantungan pada jam dinding: waktu hanya maju bila tes memajukannya, dan
// tes menunggu penjadwal "tertidur" (pewaktu terdaftar) lewat sync.Cond.

// watchdog adalah batas menunggu NYATA yang hanya terpakai bila tes macet (penjadwal
// tidak melakukan apa yang seharusnya); tes yang sehat tidak pernah menunggunya.
const watchdog = 20 * time.Second

type fakeTimer struct {
	at time.Time
	ch chan time.Time
}

type fakeClock struct {
	mu     sync.Mutex
	cond   *sync.Cond
	now    time.Time
	timers []*fakeTimer
}

func newFakeClock(now time.Time) *fakeClock {
	c := &fakeClock{now: now}
	c.cond = sync.NewCond(&c.mu)
	return c
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) After(d time.Duration) <-chan time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch := make(chan time.Time, 1)
	if d <= 0 {
		ch <- c.now
		return ch
	}
	c.timers = append(c.timers, &fakeTimer{at: c.now.Add(d), ch: ch})
	c.cond.Broadcast()
	return ch
}

// Set menggerakkan jam ke t dan membunyikan semua pewaktu yang jatuh tempo.
func (c *fakeClock) Set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = t
	kept := c.timers[:0]
	for _, tm := range c.timers {
		if !tm.at.After(t) {
			tm.ch <- t
		} else {
			kept = append(kept, tm)
		}
	}
	c.timers = kept
}

func (c *fakeClock) Advance(d time.Duration) { c.Set(c.Now().Add(d)) }

// fireEarly membunyikan semua pewaktu TANPA menggerakkan jam: pewaktu monoton yang
// berbunyi sebelum jam dinding mencapai target.
func (c *fakeClock) fireEarly() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, tm := range c.timers {
		tm.ch <- c.now
	}
	c.timers = nil
}

// waitTimer menunggu sampai ada pewaktu yang terdaftar dan memberi batas
// waktunya yang paling awal.
func (c *fakeClock) waitTimer(t *testing.T) time.Time {
	t.Helper()
	stop := make(chan struct{})
	defer close(stop)
	expired := false
	go func() {
		select {
		case <-stop:
		case <-time.After(watchdog):
			c.mu.Lock()
			expired = true
			c.cond.Broadcast()
			c.mu.Unlock()
		}
	}()
	c.mu.Lock()
	defer c.mu.Unlock()
	for len(c.timers) == 0 && !expired {
		c.cond.Wait()
	}
	if expired {
		t.Fatalf("penjadwal tidak menunggu pewaktu apa pun dalam %s", watchdog)
	}
	earliest := c.timers[0].at
	for _, tm := range c.timers[1:] {
		if tm.at.Before(earliest) {
			earliest = tm.at
		}
	}
	return earliest
}

func (c *fakeClock) pending() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.timers)
}

type runRecord struct {
	at      time.Time
	trigger Trigger
}

// fakeRunner meniru Syncer: mencatat kapan dipanggil dan apa yang dikerjakannya.
type fakeRunner struct {
	clock *fakeClock
	// behave, bila diisi, berjalan di dalam RunOnce; n adalah nomor panggilan (1...).
	behave func(ctx context.Context, n int) error
	order  *callLog

	mu   sync.Mutex
	runs []runRecord
	ctxs []context.Context
	done chan runRecord
}

func newFakeRunner(clock *fakeClock, order *callLog) *fakeRunner {
	return &fakeRunner{clock: clock, order: order, done: make(chan runRecord, 100)}
}

func (r *fakeRunner) RunOnce(ctx context.Context, trigger Trigger) (RunOutcome, error) {
	r.order.add("RunOnce")
	rec := runRecord{at: r.clock.Now(), trigger: trigger}
	r.mu.Lock()
	r.runs = append(r.runs, rec)
	r.ctxs = append(r.ctxs, ctx)
	n := len(r.runs)
	r.mu.Unlock()
	var err error
	if r.behave != nil {
		err = r.behave(ctx, n)
	}
	r.done <- rec
	return RunOutcome{Status: RunSuccess, Trigger: trigger}, err
}

func (r *fakeRunner) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.runs)
}

func (r *fakeRunner) records() []runRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]runRecord(nil), r.runs...)
}

// waitRun menunggu sinkron berikutnya selesai dan memberi catatannya.
func (r *fakeRunner) waitRun(t *testing.T) runRecord {
	t.Helper()
	select {
	case rec := <-r.done:
		return rec
	case <-time.After(watchdog):
		t.Fatalf("sinkron tidak berjalan dalam %s", watchdog)
		return runRecord{}
	}
}

type fakeScheduleStore struct {
	clock *fakeClock
	order *callLog

	mu         sync.Mutex
	recoverErr []error // galat untuk panggilan ke-1, ke-2, ...; habis berarti berhasil
	recovered  []time.Time
	recoverN   int
	lastAt     time.Time
	lastOK     bool
	lastErr    error
	lastCalls  int

	// Log sinkron selesai untuk RecentFinishedRuns (terbaru dulu).
	finished      []FinishedRun
	finishedErr   error
	finishedCalls int
}

func (s *fakeScheduleStore) RecoverStaleRuns(ctx context.Context, now time.Time) (int, error) {
	s.order.add("RecoverStaleRuns")
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recovered = append(s.recovered, now)
	if len(s.recoverErr) >= len(s.recovered) {
		if err := s.recoverErr[len(s.recovered)-1]; err != nil {
			return 0, err
		}
	}
	return s.recoverN, nil
}

func (s *fakeScheduleStore) LastSuccessAt(ctx context.Context) (time.Time, bool, error) {
	s.order.add("LastSuccessAt")
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastCalls++
	return s.lastAt, s.lastOK, s.lastErr
}

// RecentFinishedRuns memberi log palsu `finished` (terbaru dulu), dipotong sebanyak
// limit. Kosong bila tes tidak mengisinya.
func (s *fakeScheduleStore) RecentFinishedRuns(ctx context.Context, limit int) ([]FinishedRun, error) {
	s.order.add("RecentFinishedRuns")
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finishedCalls++
	if s.finishedErr != nil {
		return nil, s.finishedErr
	}
	runs := s.finished
	if len(runs) > limit {
		runs = runs[:limit]
	}
	return append([]FinishedRun(nil), runs...), nil
}

func (s *fakeScheduleStore) recoverCalls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.recovered)
}

type schedRig struct {
	t      *testing.T
	clock  *fakeClock
	runner *fakeRunner
	store  *fakeScheduleStore
	order  *callLog
	logs   *safeBuffer
	sched  *Scheduler

	cancel context.CancelFunc
	done   chan struct{} // ditutup sesudah Run kembali
	err    error         // galat yang dikembalikan Run; valid sesudah done ditutup
}

// safeBuffer: slog menulis dari goroutine penjadwal sementara tes membaca.
type safeBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *safeBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *safeBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// newSchedRig menyiapkan penjadwal pada jam `now`, menit `minute`, dengan sinkron
// berhasil terakhir pada `lastSuccess` (nol berarti belum pernah). Belum dijalankan.
func newSchedRig(t *testing.T, now time.Time, minute int, lastSuccess time.Time) *schedRig {
	t.Helper()
	order := &callLog{}
	clock := newFakeClock(now)
	r := &schedRig{
		t: t, clock: clock, order: order, logs: &safeBuffer{},
		runner: newFakeRunner(clock, order),
		store:  &fakeScheduleStore{clock: clock, order: order, lastAt: lastSuccess, lastOK: !lastSuccess.IsZero()},
	}
	sched, err := NewScheduler(SchedulerOptions{
		Syncer: r.runner, Store: r.store, Minute: minute, Clock: clock,
		Logger: slog.New(slog.NewTextHandler(r.logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	})
	if err != nil {
		t.Fatal(err)
	}
	r.sched = sched
	return r
}

func (r *schedRig) start() {
	r.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	r.done = make(chan struct{})
	go func() {
		r.err = r.sched.Run(ctx)
		close(r.done)
	}()
	r.t.Cleanup(func() {
		cancel()
		select {
		case <-r.done:
		case <-time.After(watchdog):
		}
	})
}

// stop membatalkan konteks dan menunggu Run kembali; memberi galat yang dikembalikan.
func (r *schedRig) stop() error {
	r.t.Helper()
	r.cancel()
	select {
	case <-r.done:
		return r.err
	case <-time.After(watchdog):
		r.t.Fatalf("Run tidak kembali dalam %s sesudah konteks dibatalkan", watchdog)
		return nil
	}
}

// expectTimer menunggu penjadwal tidur sampai want lalu membunyikannya dengan
// menggerakkan jam tepat ke want.
func (r *schedRig) expectTimerAt(want time.Time) {
	r.t.Helper()
	got := r.clock.waitTimer(r.t)
	if !got.Equal(want) {
		r.t.Fatalf("penjadwal menunggu sampai %s, want %s", got.Format(time.RFC3339Nano), want.Format(time.RFC3339Nano))
	}
}

func (r *schedRig) tick(at time.Time) runRecord {
	r.t.Helper()
	r.expectTimerAt(at)
	r.clock.Set(at)
	return r.runner.waitRun(r.t)
}

func TestSchedulerRunsExactlyAtEachSlot(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 30, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	r.start()

	for i, slot := range []time.Time{
		utc(2026, 5, 1, 10, 5, 0, 0), utc(2026, 5, 1, 11, 5, 0, 0), utc(2026, 5, 1, 12, 5, 0, 0), utc(2026, 5, 1, 13, 5, 0, 0),
	} {
		r.expectTimerAt(slot)
		if n := r.runner.count(); n != i {
			t.Fatalf("sebelum slot %s sudah ada %d sinkron, want %d", slot, n, i)
		}
		rec := r.tick(slot)
		if !rec.at.Equal(slot) || rec.trigger != TriggerSchedule {
			t.Errorf("sinkron berjalan pada %s dengan pemicu %q, want %s dan %q", rec.at, rec.trigger, slot, TriggerSchedule)
		}
	}
	if n := r.runner.count(); n != 4 {
		t.Errorf("jumlah sinkron = %d, want 4 (satu per slot)", n)
	}
	if err := r.stop(); !errors.Is(err, context.Canceled) {
		t.Errorf("Run = %v, want context.Canceled", err)
	}
}

// Sinkron yang selesai pada detik yang sama dengan slotnya (jam tidak bergerak
// selama sinkron) tidak boleh dijalankan lagi untuk slot yang sama.
func TestSchedulerNeverRunsTwiceForTheSameSlot(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 0, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	r.start()
	slot := utc(2026, 5, 1, 10, 5, 0, 0)
	r.tick(slot)

	// Tepat sesudah sinkron, penjadwal menunggu slot BERIKUTNYA, bukan slot yang sama.
	r.expectTimerAt(slot.Add(time.Hour))
	if n := r.runner.count(); n != 1 {
		t.Errorf("jumlah sinkron = %d, want 1", n)
	}
	// Tanpa pewaktu yang jatuh tempo, tidak ada sinkron baru tak peduli berapa lama menunggu.
	r.clock.Advance(59 * time.Minute)
	r.expectTimerAt(slot.Add(time.Hour))
	if n := r.runner.count(); n != 1 {
		t.Errorf("jumlah sinkron = %d sebelum slot berikutnya, want 1", n)
	}
	r.stop()
}

func TestSchedulerLongSyncSkipsMissedSlotsInsteadOfCatchingUp(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 0, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	// Sinkron pertama berlangsung 2 jam 20 menit: selesai 12:25, melewati 11:05 dan 12:05.
	r.runner.behave = func(ctx context.Context, n int) error {
		if n == 1 {
			r.clock.Set(utc(2026, 5, 1, 12, 25, 0, 0))
		}
		return nil
	}
	r.start()

	first := r.tick(utc(2026, 5, 1, 10, 5, 0, 0))
	if !first.at.Equal(utc(2026, 5, 1, 10, 5, 0, 0)) {
		t.Fatalf("sinkron pertama pada %s", first.at)
	}
	// Slot 11:05 dan 12:05 dilewati; berikutnya 13:05.
	r.expectTimerAt(utc(2026, 5, 1, 13, 5, 0, 0))
	if n := r.runner.count(); n != 1 {
		t.Fatalf("jumlah sinkron = %d; slot yang terlewat tidak boleh dikejar", n)
	}
	second := r.tick(utc(2026, 5, 1, 13, 5, 0, 0))
	if !second.at.Equal(utc(2026, 5, 1, 13, 5, 0, 0)) {
		t.Errorf("sinkron kedua pada %s, want 13:05", second.at)
	}
	if n := r.runner.count(); n != 2 {
		t.Errorf("jumlah sinkron = %d, want 2", n)
	}
	if logs := r.logs.String(); !strings.Contains(logs, "dilewati=2") || !strings.Contains(logs, "level=WARN") {
		t.Errorf("slot yang terlewat harus dicatat (dilewati=2):\n%s", logs)
	}
	r.stop()
}

func TestSchedulerSyncEndingExactlyOnTheNextSlotSkipsIt(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 0, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	r.runner.behave = func(ctx context.Context, n int) error {
		if n == 1 {
			r.clock.Set(utc(2026, 5, 1, 11, 5, 0, 0)) // selesai tepat di slot berikutnya
		}
		return nil
	}
	r.start()
	r.tick(utc(2026, 5, 1, 10, 5, 0, 0))
	// 11:05:00 sudah lewat (<= sekarang): yang berikutnya 12:05.
	r.expectTimerAt(utc(2026, 5, 1, 12, 5, 0, 0))
	r.stop()
}

func TestSchedulerSyncEndingJustBeforeTheNextSlotDoesNotSkipIt(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 0, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	r.runner.behave = func(ctx context.Context, n int) error {
		if n == 1 {
			r.clock.Set(utc(2026, 5, 1, 11, 4, 59, 999_999_999))
		}
		return nil
	}
	r.start()
	r.tick(utc(2026, 5, 1, 10, 5, 0, 0))
	r.expectTimerAt(utc(2026, 5, 1, 11, 5, 0, 0))
	if strings.Contains(r.logs.String(), "dilewati=") {
		t.Errorf("tidak ada slot yang terlewat:\n%s", r.logs)
	}
	r.stop()
}

// Pewaktu monoton bisa berbunyi sebelum jam dinding mencapai slot; sinkron tidak
// boleh berjalan lebih awal dari slotnya.
func TestSchedulerDoesNotRunWhenTheTimerFiresEarly(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 0, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	r.start()
	slot := utc(2026, 5, 1, 10, 5, 0, 0)
	r.expectTimerAt(slot)

	r.clock.fireEarly()
	r.expectTimerAt(slot) // menunggu sisanya lagi
	if n := r.runner.count(); n != 0 {
		t.Fatalf("sinkron berjalan %d kali sebelum jam mencapai slot", n)
	}
	r.clock.Set(slot)
	if rec := r.runner.waitRun(t); !rec.at.Equal(slot) {
		t.Errorf("sinkron pada %s, want %s", rec.at, slot)
	}
	r.stop()
}

func TestSchedulerUsesTheConfiguredMinute(t *testing.T) {
	for _, minute := range []int{0, 5, 30, 59} {
		r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 30, 0), minute, utc(2026, 5, 1, 9, 45, 0, 0))
		r.start()
		first := utc(2026, 5, 1, 10, minute, 0, 0)
		if !first.After(r.clock.Now()) {
			first = first.Add(time.Hour)
		}
		r.tick(first)
		r.tick(first.Add(time.Hour))
		r.stop()
		if got := r.sched.NextRunAt(utc(2026, 5, 1, 10, 0, 30, 0)); got.Minute() != minute || got.Second() != 0 {
			t.Errorf("menit %d: NextRunAt = %s", minute, got)
		}
	}
}

func TestSchedulerFollowsUTCWhateverZoneTheClockReports(t *testing.T) {
	wib := time.FixedZone("WIB", 7*3600)
	r := newSchedRig(t, time.Date(2026, 5, 1, 17, 0, 30, 0, wib), 5, utc(2026, 5, 1, 9, 45, 0, 0)) // 10:00:30 UTC
	r.start()
	r.tick(utc(2026, 5, 1, 10, 5, 0, 0))
	r.tick(utc(2026, 5, 1, 11, 5, 0, 0))
	r.stop()
}

func TestSchedulerNextRunAtMatchesNextRun(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 0, 0), 17, time.Time{})
	for _, now := range []time.Time{utc(2026, 5, 1, 10, 16, 59, 0), utc(2026, 5, 1, 10, 17, 0, 0), utc(2026, 12, 31, 23, 59, 0, 0)} {
		if got, want := r.sched.NextRunAt(now), NextRun(now, 17); !got.Equal(want) {
			t.Errorf("NextRunAt(%s) = %s, want %s", now, got, want)
		}
	}
}

// --- Kejar saat mulai ---------------------------------------------------------

func TestSchedulerCatchUpAtStart(t *testing.T) {
	now := utc(2026, 5, 1, 10, 30, 0, 0)
	cases := []struct {
		name        string
		lastSuccess time.Time
		wantCatchUp bool
	}{
		{"belum pernah ada sinkron berhasil", time.Time{}, true},
		{"sinkron berhasil terakhir 2,5 jam lalu", now.Add(-150 * time.Minute), true},
		{"sinkron berhasil terakhir satu jam lebih satu nanodetik lalu", now.Add(-time.Hour - time.Nanosecond), true},
		{"sinkron berhasil terakhir tepat satu jam lalu", now.Add(-time.Hour), false},
		{"sinkron berhasil terakhir 40 menit lalu", now.Add(-40 * time.Minute), false},
		{"sinkron berhasil terakhir baru saja", now.Add(-time.Second), false},
		{"sinkron berhasil terakhir bertanda masa depan (jam bergeser)", now.Add(3 * time.Hour), false},
	}
	for _, c := range cases {
		r := newSchedRig(t, now, 5, c.lastSuccess)
		r.start()
		nextSlot := utc(2026, 5, 1, 11, 5, 0, 0)
		if c.wantCatchUp {
			// Jeda 10 detik agar backend siap, bukan menunggu slot 11:05.
			rec := r.tick(now.Add(DefaultCatchUpDelay))
			if rec.trigger != TriggerSchedule || !rec.at.Equal(now.Add(DefaultCatchUpDelay)) {
				t.Errorf("%s: sinkron susulan = %+v", c.name, rec)
			}
			// Sesudahnya kembali ke slot biasa.
			r.expectTimerAt(nextSlot)
			if n := r.runner.count(); n != 1 {
				t.Errorf("%s: %d sinkron sebelum slot, want 1 (susulan)", c.name, n)
			}
		} else {
			r.expectTimerAt(nextSlot)
			if n := r.runner.count(); n != 0 {
				t.Errorf("%s: %d sinkron sebelum slot, want 0 (tidak mengejar)", c.name, n)
			}
		}
		r.stop()
	}
}

func TestSchedulerCatchUpDelayIsConfigurable(t *testing.T) {
	now := utc(2026, 5, 1, 10, 30, 0, 0)
	r := newSchedRig(t, now, 5, time.Time{})
	sched, err := NewScheduler(SchedulerOptions{Syncer: r.runner, Store: r.store, Minute: 5, Clock: r.clock, CatchUpDelay: 90 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	r.sched = sched
	r.start()
	r.tick(now.Add(90 * time.Second))
	r.stop()
	if DefaultCatchUpDelay != 10*time.Second {
		t.Errorf("DefaultCatchUpDelay = %s, want 10s", DefaultCatchUpDelay)
	}
}

// Bila slot berikutnya datang lebih dulu daripada jeda susulan, slot itu sendiri
// yang menyusul: satu sinkron, bukan dua berdekatan.
func TestSchedulerCatchUpYieldsToANearbySlot(t *testing.T) {
	now := utc(2026, 5, 1, 10, 4, 55, 0) // slot 10:05:00 tiba 5 detik lagi, sebelum jeda 10 detik
	r := newSchedRig(t, now, 5, time.Time{})
	r.start()
	rec := r.tick(utc(2026, 5, 1, 10, 5, 0, 0))
	if !rec.at.Equal(utc(2026, 5, 1, 10, 5, 0, 0)) {
		t.Errorf("sinkron pada %s, want 10:05:00", rec.at)
	}
	r.expectTimerAt(utc(2026, 5, 1, 11, 5, 0, 0))
	if n := r.runner.count(); n != 1 {
		t.Errorf("jumlah sinkron = %d, want 1", n)
	}
	r.stop()
}

func TestSchedulerLastSuccessReadErrorDoesNotHoldTheScheduler(t *testing.T) {
	now := utc(2026, 5, 1, 10, 30, 0, 0)
	r := newSchedRig(t, now, 5, time.Time{})
	r.store.lastErr = errors.New("database belum siap")
	r.start()
	// Tidak ada sinkron susulan, tetapi slot biasa tetap ditunggu dan dijalankan.
	r.expectTimerAt(utc(2026, 5, 1, 11, 5, 0, 0))
	if n := r.runner.count(); n != 0 {
		t.Errorf("%d sinkron sebelum slot; galat baca tidak boleh memicu sinkron susulan", n)
	}
	if logs := r.logs.String(); !strings.Contains(logs, "level=WARN") || !strings.Contains(logs, "database belum siap") {
		t.Errorf("galat baca harus dicatat:\n%s", logs)
	}
	rec := r.tick(utc(2026, 5, 1, 11, 5, 0, 0))
	if !rec.at.Equal(utc(2026, 5, 1, 11, 5, 0, 0)) {
		t.Errorf("sinkron pada %s", rec.at)
	}
	r.stop()
}

func TestSchedulerCancelDuringCatchUpDelayRunsNothing(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 30, 0, 0), 5, time.Time{})
	r.start()
	r.expectTimerAt(utc(2026, 5, 1, 10, 30, 10, 0))
	if err := r.stop(); !errors.Is(err, context.Canceled) {
		t.Errorf("Run = %v, want context.Canceled", err)
	}
	if n := r.runner.count(); n != 0 {
		t.Errorf("%d sinkron berjalan padahal dibatalkan sebelum jeda habis", n)
	}
}

// --- Pemulihan sinkron terputus ------------------------------------------------

func TestSchedulerRecoversStaleRunsOnceBeforeAnySync(t *testing.T) {
	now := utc(2026, 5, 1, 10, 0, 30, 0)
	r := newSchedRig(t, now, 5, utc(2026, 5, 1, 9, 30, 0, 0))
	r.store.recoverN = 2
	r.start()
	for _, slot := range []time.Time{utc(2026, 5, 1, 10, 5, 0, 0), utc(2026, 5, 1, 11, 5, 0, 0), utc(2026, 5, 1, 12, 5, 0, 0)} {
		r.tick(slot)
	}
	r.stop()

	if n := r.store.recoverCalls(); n != 1 {
		t.Fatalf("RecoverStaleRuns dipanggil %d kali, want tepat 1", n)
	}
	if got := r.store.recovered[0]; !got.Equal(now) {
		t.Errorf("RecoverStaleRuns(now) = %s, want %s", got, now)
	}
	names := r.order.names()
	if len(names) == 0 || names[0] != "RecoverStaleRuns" {
		t.Errorf("urutan = %v; RecoverStaleRuns harus yang pertama", names)
	}
	if logs := r.logs.String(); !strings.Contains(logs, "jumlah=2") {
		t.Errorf("sinkron yang dipulihkan harus dicatat:\n%s", logs)
	}
}

func TestSchedulerRecoversBeforeTheCatchUpSync(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 30, 0, 0), 5, time.Time{})
	r.start()
	r.tick(utc(2026, 5, 1, 10, 30, 10, 0))
	r.stop()
	names := r.order.names()
	if len(names) == 0 || names[0] != "RecoverStaleRuns" {
		t.Errorf("urutan = %v", names)
	}
	recoverIdx, runIdx := indexOf(names, "RecoverStaleRuns"), indexOf(names, "RunOnce")
	if recoverIdx < 0 || runIdx < 0 || recoverIdx > runIdx {
		t.Errorf("urutan = %v; pemulihan harus mendahului sinkron", names)
	}
}

func indexOf(list []string, s string) int {
	for i, v := range list {
		if v == s {
			return i
		}
	}
	return -1
}

// Bila pemulihan gagal saat mulai (database belum siap), baris running yang
// tertinggal akan membuat setiap sinkron dilewati; penjadwal mencobanya lagi
// sebelum sinkron berikutnya sampai berhasil, lalu berhenti mencoba.
func TestSchedulerRetriesRecoveryUntilItSucceeds(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 30, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	r.store.recoverErr = []error{errors.New("database belum siap"), errors.New("masih belum siap")}
	r.start()

	r.tick(utc(2026, 5, 1, 10, 5, 0, 0)) // pemulihan ke-2 gagal juga, sinkron tetap jalan
	r.tick(utc(2026, 5, 1, 11, 5, 0, 0)) // ke-3 berhasil
	r.tick(utc(2026, 5, 1, 12, 5, 0, 0)) // tidak dipanggil lagi
	r.stop()

	if n := r.store.recoverCalls(); n != 3 {
		t.Errorf("RecoverStaleRuns dipanggil %d kali, want 3 (2 gagal + 1 berhasil)", n)
	}
	if logs := r.logs.String(); !strings.Contains(logs, "gagal memulihkan") {
		t.Errorf("kegagalan pemulihan harus dicatat:\n%s", logs)
	}
	if n := r.runner.count(); n != 3 {
		t.Errorf("jumlah sinkron = %d; pemulihan yang gagal tidak boleh menghentikan penjadwal", n)
	}
}

// --- Penutupan lembut ---------------------------------------------------------

func TestSchedulerGracefulShutdownWhileWaiting(t *testing.T) {
	before := runtime.NumGoroutine()
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 30, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	r.start()
	r.tick(utc(2026, 5, 1, 10, 5, 0, 0))
	r.expectTimerAt(utc(2026, 5, 1, 11, 5, 0, 0))

	if err := r.stop(); !errors.Is(err, context.Canceled) {
		t.Fatalf("Run = %v, want context.Canceled", err)
	}
	if n := r.runner.count(); n != 1 {
		t.Errorf("jumlah sinkron = %d; pembatalan tidak boleh memicu sinkron", n)
	}
	assertNoLeftoverGoroutines(t, before)
}

func TestSchedulerShutdownCancelsTheRunningSyncAndWaitsForIt(t *testing.T) {
	before := runtime.NumGoroutine()
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 30, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	entered := make(chan struct{})
	finished := make(chan struct{})
	r.runner.behave = func(ctx context.Context, n int) error {
		close(entered)
		<-ctx.Done() // meniru Syncer yang diberhentikan: menulis catatan gagal lalu kembali
		close(finished)
		return ctx.Err()
	}
	r.start()
	r.expectTimerAt(utc(2026, 5, 1, 10, 5, 0, 0))
	r.clock.Set(utc(2026, 5, 1, 10, 5, 0, 0))
	<-entered

	r.cancel()
	<-r.done
	err := r.err
	select {
	case <-finished:
	default:
		t.Fatal("Run kembali sebelum sinkron yang berjalan selesai")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("Run = %v, want context.Canceled", err)
	}
	if r.clock.pending() != 0 {
		t.Errorf("penjadwal menjadwalkan ulang sesudah dibatalkan (%d pewaktu)", r.clock.pending())
	}
	if ctx := r.runner.ctxs[0]; ctx.Err() == nil {
		t.Error("konteks yang diterima sinkron seharusnya ikut dibatalkan")
	}
	assertNoLeftoverGoroutines(t, before)
}

func TestSchedulerReturnsAtOnceWhenContextIsAlreadyCanceled(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 30, 0, 0), 5, time.Time{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan error, 1)
	go func() { done <- r.sched.Run(ctx) }()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Run = %v", err)
		}
	case <-time.After(watchdog):
		t.Fatal("Run tidak kembali")
	}
	if n := r.runner.count(); n != 0 {
		t.Errorf("%d sinkron berjalan", n)
	}
}

// assertNoLeftoverGoroutines memastikan jumlah goroutine kembali ke semula. Goroutine
// yang baru selesai butuh beberapa giliran penjadwal Go untuk benar-benar hilang,
// jadi diberi kesempatan dengan runtime.Gosched, bukan tidur.
func assertNoLeftoverGoroutines(t *testing.T, before int) {
	t.Helper()
	for i := 0; i < 10_000; i++ {
		if runtime.NumGoroutine() <= before {
			return
		}
		runtime.Gosched()
	}
	buf := make([]byte, 1<<16)
	buf = buf[:runtime.Stack(buf, true)]
	t.Errorf("goroutine tertinggal: %d sebelum, %d sesudah\n%s", before, runtime.NumGoroutine(), buf)
}

// --- Ketahanan ------------------------------------------------------------------

func TestSchedulerSurvivesARunnerThatPanicsOrFails(t *testing.T) {
	r := newSchedRig(t, utc(2026, 5, 1, 10, 0, 30, 0), 5, utc(2026, 5, 1, 9, 30, 0, 0))
	r.runner.behave = func(ctx context.Context, n int) error {
		switch n {
		case 1:
			panic("meledak di dalam sinkron")
		case 2:
			return errors.New("sinkron gagal")
		}
		return nil
	}
	r.start()
	for _, slot := range []time.Time{utc(2026, 5, 1, 10, 5, 0, 0), utc(2026, 5, 1, 11, 5, 0, 0), utc(2026, 5, 1, 12, 5, 0, 0)} {
		r.expectTimerAt(slot)
		r.clock.Set(slot)
		// Pemanggil panik sebelum sempat mengirim ke r.done; tunggu lewat jumlah panggilan.
		if slot == utc(2026, 5, 1, 10, 5, 0, 0) {
			r.expectTimerAt(slot.Add(time.Hour))
			continue
		}
		r.runner.waitRun(t)
	}
	r.stop()
	if n := r.runner.count(); n != 3 {
		t.Errorf("jumlah sinkron = %d, want 3; panic tidak boleh menghentikan penjadwal", n)
	}
	if logs := r.logs.String(); !strings.Contains(logs, "penjadwal tetap berjalan") {
		t.Errorf("panic harus dicatat:\n%s", logs)
	}
}

func TestNewSchedulerValidates(t *testing.T) {
	order := &callLog{}
	clock := newFakeClock(utc(2026, 5, 1, 10, 0, 0, 0))
	runner := newFakeRunner(clock, order)
	store := &fakeScheduleStore{clock: clock, order: order}
	ok := SchedulerOptions{Syncer: runner, Store: store, Minute: 5, Clock: clock}

	if _, err := NewScheduler(ok); err != nil {
		t.Fatalf("opsi sah ditolak: %v", err)
	}
	for _, minute := range []int{-1, 60, 61, 1000, -30} {
		opts := ok
		opts.Minute = minute
		if _, err := NewScheduler(opts); !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("menit %d: err = %v, want ErrInvalidConfig", minute, err)
		}
	}
	for _, minute := range []int{0, 1, 30, 58, 59} {
		opts := ok
		opts.Minute = minute
		if _, err := NewScheduler(opts); err != nil {
			t.Errorf("menit %d ditolak: %v", minute, err)
		}
	}
	noSyncer, noStore, negative := ok, ok, ok
	noSyncer.Syncer = nil
	noStore.Store = nil
	negative.CatchUpDelay = -time.Second
	for name, opts := range map[string]SchedulerOptions{"tanpa Syncer": noSyncer, "tanpa Store": noStore, "jeda negatif": negative} {
		if _, err := NewScheduler(opts); err == nil {
			t.Errorf("%s seharusnya ditolak", name)
		}
	}
	s, err := NewScheduler(SchedulerOptions{Syncer: runner, Store: store, Minute: 5})
	if err != nil {
		t.Fatal(err)
	}
	if s.clock == nil || s.log == nil || s.catchUp != DefaultCatchUpDelay {
		t.Errorf("bawaan tidak terisi: %+v", s)
	}
	if _, isSystem := s.clock.(systemClock); !isSystem {
		t.Errorf("Clock bawaan = %T, want systemClock", s.clock)
	}
	now := time.Now()
	if got := (systemClock{}).Now(); got.Before(now.Add(-time.Minute)) || got.After(now.Add(time.Minute)) {
		t.Errorf("systemClock.Now = %s", got)
	}
}

// Kunci: urutan pewaktu pada jam palsu dipakai tes lain, jadi pastikan ia benar.
func TestFakeClockFiresInOrder(t *testing.T) {
	c := newFakeClock(utc(2026, 5, 1, 10, 0, 0, 0))
	a, b, d := c.After(3*time.Second), c.After(time.Second), c.After(5*time.Second)
	c.Advance(2 * time.Second)
	select {
	case <-b:
	default:
		t.Error("pewaktu 1 detik seharusnya sudah berbunyi")
	}
	for name, ch := range map[string]<-chan time.Time{"3s": a, "5s": d} {
		select {
		case <-ch:
			t.Errorf("pewaktu %s berbunyi terlalu awal", name)
		default:
		}
	}
	times := []time.Duration{}
	for _, tm := range c.timers {
		times = append(times, tm.at.Sub(utc(2026, 5, 1, 10, 0, 0, 0)))
	}
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	if len(times) != 2 || times[0] != 3*time.Second || times[1] != 5*time.Second {
		t.Errorf("pewaktu tersisa = %v", times)
	}
}
