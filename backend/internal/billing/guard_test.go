package billing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// Tes perlindungan login beruntun di Scheduler, dengan jam palsu yang digerakkan
// tes dan Runner palsu yang menjawab menurut naskah. Tidak ada yang tidur.

// scriptRunner menjawab panggilan ke-n dengan script(n) dan mencatat kapan dipanggil
// menurut jam palsu.
type scriptRunner struct {
	clock  *fakeClock
	script func(n int) (RunOutcome, error)

	mu   sync.Mutex
	runs []time.Time
	done chan time.Time
}

func (r *scriptRunner) RunOnce(ctx context.Context, trigger Trigger) (RunOutcome, error) {
	r.mu.Lock()
	r.runs = append(r.runs, r.clock.Now())
	n := len(r.runs)
	r.mu.Unlock()
	out, err := r.script(n)
	r.done <- r.clock.Now()
	return out, err
}

func (r *scriptRunner) times() []time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]time.Time(nil), r.runs...)
}

// Hasil sinkron palsu.
func credFail() (RunOutcome, error) {
	return RunOutcome{Status: RunFailed, RunID: "run", Failure: Classify(ErrLoginFailed)},
		fmt.Errorf("baca tagihan: %w", ErrLoginFailed)
}

func otherFail() (RunOutcome, error) {
	return RunOutcome{Status: RunFailed, RunID: "run"}, fmt.Errorf("baca tagihan: %w", ErrNetwork)
}

func okRun() (RunOutcome, error) { return RunOutcome{Status: RunSuccess, RunID: "run"}, nil }

// noRowFail adalah kegagalan sebelum ada baris log (BeginRun gagal).
func noRowFail() (RunOutcome, error) {
	return RunOutcome{Status: RunFailed}, errors.New("database mati")
}

func skippedRun() (RunOutcome, error) { return RunOutcome{Status: RunSkipped}, nil }

type guardRig struct {
	t      *testing.T
	clock  *fakeClock
	runner *scriptRunner
	store  *fakeScheduleStore
	logs   *safeBuffer
	sched  *Scheduler

	cancel context.CancelFunc
	done   chan struct{}
	err    error
}

// newGuardRig menyiapkan penjadwal pada `now`, menit 5, dengan sinkron berhasil
// terakhir 10 menit sebelum `now` (tidak ada sinkron susulan) kecuali tes
// mengubahnya, dan `finished` sebagai log sinkron selesai (terbaru dulu).
func newGuardRig(t *testing.T, now time.Time, finished []FinishedRun, script func(n int) (RunOutcome, error)) *guardRig {
	t.Helper()
	order := &callLog{}
	clock := newFakeClock(now)
	r := &guardRig{
		t: t, clock: clock, logs: &safeBuffer{},
		runner: &scriptRunner{clock: clock, script: script, done: make(chan time.Time, 100)},
		store: &fakeScheduleStore{
			clock: clock, order: order, lastAt: now.Add(-10 * time.Minute), lastOK: true, finished: finished,
		},
	}
	r.rebuild()
	return r
}

// rebuild membuat Scheduler baru di atas penyimpanan yang sama: proses yang dimulai ulang.
func (r *guardRig) rebuild() {
	r.t.Helper()
	sched, err := NewScheduler(SchedulerOptions{
		Syncer: r.runner, Store: r.store, Minute: 5, Clock: r.clock,
		Logger: slog.New(slog.NewTextHandler(r.logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	})
	if err != nil {
		r.t.Fatal(err)
	}
	r.sched = sched
}

func (r *guardRig) start() {
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

func (r *guardRig) stop() {
	r.t.Helper()
	r.cancel()
	select {
	case <-r.done:
	case <-time.After(watchdog):
		r.t.Fatalf("Run tidak kembali dalam %s", watchdog)
	}
}

func (r *guardRig) expectTimerAt(want time.Time) {
	r.t.Helper()
	if got := r.clock.waitTimer(r.t); !got.Equal(want) {
		r.t.Fatalf("penjadwal menunggu sampai %s, want %s", got.Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

// ran menggerakkan jam ke slot `at` dan menunggu sinkron berjalan.
func (r *guardRig) ran(at time.Time) {
	r.t.Helper()
	r.expectTimerAt(at)
	r.clock.Set(at)
	select {
	case got := <-r.runner.done:
		if !got.Equal(at) {
			r.t.Fatalf("sinkron berjalan pada %s, want %s", got, at)
		}
	case <-time.After(watchdog):
		r.t.Fatalf("sinkron pada %s tidak berjalan", at.Format(time.RFC3339))
	}
}

// skipped menggerakkan jam ke slot `at` dan memastikan slot itu dilewati: Runner
// tidak dipanggil dan tepat satu catatan "dilewati" ditulis untuk slot ini.
func (r *guardRig) skipped(at time.Time) {
	r.t.Helper()
	r.expectTimerAt(at)
	runsBefore, skipsBefore := len(r.runner.times()), r.skipLogs()
	r.clock.Set(at)
	// Penjadwal selesai menimbang slot ini bila sudah memasang pewaktu berikutnya.
	r.expectTimerAt(at.Add(time.Hour))
	if got := len(r.runner.times()); got != runsBefore {
		r.t.Errorf("slot %s: sinkron berjalan padahal harus dilewati", at.Format(time.RFC3339))
	}
	if got := r.skipLogs(); got != skipsBefore+1 {
		r.t.Errorf("slot %s: catatan 'dilewati' bertambah %d, want 1", at.Format(time.RFC3339), got-skipsBefore)
	}
}

func (r *guardRig) skipLogs() int {
	return strings.Count(r.logs.String(), "sinkron billing dilewati: login ditolak berulang kali")
}

func hm(h, m int) time.Time { return utc(2026, 5, 1, h, m, 0, 0) }

func hmDay(day, h, m int) time.Time { return utc(2026, 5, day, h, m, 0, 0) }

// Tiga kegagalan login berturut-turut menghentikan percobaan tiap jam; sesudahnya
// satu percobaan per 6 jam sampai berhasil.
func TestSchedulerStopsHammeringAfterThreeCredentialFailures(t *testing.T) {
	script := func(n int) (RunOutcome, error) {
		if n <= 4 {
			return credFail()
		}
		return okRun()
	}
	r := newGuardRig(t, utc(2026, 5, 1, 10, 0, 30, 0), nil, script)
	r.start()

	// Tiga percobaan pertama berjalan tiap jam.
	r.ran(hm(10, 5))
	r.ran(hm(11, 5))
	r.ran(hm(12, 5))
	if CredentialFailureLimit != 3 || CredentialBackoff != 6*time.Hour {
		t.Fatalf("batas = %d, jeda = %s; want 3 dan 6 jam", CredentialFailureLimit, CredentialBackoff)
	}
	// Lalu lima slot dilewati...
	for h := 13; h <= 17; h++ {
		r.skipped(hm(h, 5))
	}
	// ...dan percobaan berikutnya tepat 6 jam sesudah yang terakhir. Gagal lagi.
	r.ran(hm(18, 5))
	for h := 19; h <= 23; h++ {
		r.skipped(hm(h, 5))
	}
	// Enam jam sesudahnya (lewat tengah malam) berhasil, dan jadwal kembali tiap jam.
	r.ran(hmDay(2, 0, 5))
	r.ran(hmDay(2, 1, 5))
	r.ran(hmDay(2, 2, 5))
	r.stop()

	want := []time.Time{hm(10, 5), hm(11, 5), hm(12, 5), hm(18, 5), hmDay(2, 0, 5), hmDay(2, 1, 5), hmDay(2, 2, 5)}
	got := r.runner.times()
	if len(got) != len(want) {
		t.Fatalf("sinkron berjalan %d kali (%v), want %d", len(got), got, len(want))
	}
	for i := range want {
		if !got[i].Equal(want[i]) {
			t.Errorf("sinkron %d pada %s, want %s", i+1, got[i], want[i])
		}
	}
	logs := r.logs.String()
	if n := r.skipLogs(); n != 10 {
		t.Errorf("catatan 'dilewati' = %d, want 10 (satu per slot yang dilewati)", n)
	}
	for _, want := range []string{"gagal_berturut=3", "percobaan_berikutnya=2026-05-01T18:05:00Z", "percobaan_berikutnya=2026-05-02T00:05:00Z"} {
		if !strings.Contains(logs, want) {
			t.Errorf("log tidak memuat %q:\n%s", want, logs)
		}
	}
	if !strings.Contains(logs, "login ke sistem billing ditolak berturut-turut") {
		t.Errorf("log tidak menyebut perlindungan mulai berlaku:\n%s", logs)
	}
}

// Kegagalan lain, sukses, atau tidak adanya percobaan yang sungguh-sungguh ke
// billing menentukan apakah hitungan berlanjut.
func TestSchedulerCredentialCountResetsAndContinues(t *testing.T) {
	type step func() (RunOutcome, error)
	cred := step(credFail)
	other := step(otherFail)
	ok := step(okRun)
	noRow := step(noRowFail)
	skipped := step(skippedRun)
	cases := []struct {
		name string
		// script adalah hasil panggilan berturut-turut, tiap jam satu.
		script []step
		// blocked benar bila slot sesudah naskah habis harus dilewati.
		blocked bool
	}{
		{"tiga kegagalan login", []step{cred, cred, cred}, true},
		{"dua kegagalan login belum cukup", []step{cred, cred}, false},
		{"kegagalan lain di tengah mengulang hitungan (dua lagi)", []step{cred, cred, other, cred, cred}, false},
		{"kegagalan lain di tengah mengulang hitungan (tiga lagi)", []step{cred, cred, other, cred, cred, cred}, true},
		{"sukses di tengah mengulang hitungan (dua lagi)", []step{cred, cred, ok, cred, cred}, false},
		{"sukses di tengah mengulang hitungan (tiga lagi)", []step{cred, cred, ok, cred, cred, cred}, true},
		{"gagal tanpa baris log tidak mengulang dan tidak menambah", []step{cred, cred, noRow, cred}, true},
		{"gagal tanpa baris log tidak menambah", []step{cred, cred, noRow}, false},
		{"dilewati tidak mengulang dan tidak menambah", []step{cred, skipped, cred, skipped, cred}, true},
		{"dilewati tidak menambah", []step{cred, skipped, cred, skipped}, false},
	}
	for _, c := range cases {
		script := func(n int) (RunOutcome, error) {
			if n <= len(c.script) {
				return c.script[n-1]()
			}
			return okRun()
		}
		r := newGuardRig(t, hm(10, 0), nil, script)
		r.start()
		slot := hm(10, 5)
		for range c.script {
			r.ran(slot)
			slot = slot.Add(time.Hour)
		}
		if c.blocked {
			r.skipped(slot)
		} else {
			r.ran(slot)
		}
		r.stop()
		if c.blocked && len(r.runner.times()) != len(c.script) {
			t.Errorf("%s: sinkron berjalan %d kali, want %d", c.name, len(r.runner.times()), len(c.script))
		}
	}
}

// Sinkron yang dimulai ulang menghitung kegagalan login beruntun dari log, supaya
// mulai ulang backend tidak membuka lagi percobaan tiap jam.
func TestSchedulerRestoresCredentialGuardFromTheSyncLog(t *testing.T) {
	cred := func(started time.Time, msg string) FinishedRun {
		return FinishedRun{Success: false, StartedAt: started, FinishedAt: started.Add(2 * time.Second), Message: msg}
	}
	ok := func(started time.Time) FinishedRun {
		return FinishedRun{Success: true, StartedAt: started, FinishedAt: started.Add(2 * time.Second)}
	}
	other := func(started time.Time) FinishedRun {
		return FinishedRun{Success: false, StartedAt: started, FinishedAt: started.Add(2 * time.Second), Message: msgNetworkDown}
	}
	accessDenied := fmt.Sprintf(msgAccessDenied, 403)

	cases := []struct {
		name     string
		finished []FinishedRun
		blocked  bool
		// failures adalah hitungan yang dipulihkan (0-3).
		failures int
	}{
		{"tiga kegagalan login", []FinishedRun{cred(hm(10, 5), msgLoginRejected), cred(hm(9, 5), msgLoginRejected), cred(hm(8, 5), msgLoginRejected)}, true, 3},
		{"tiga jenis pesan login", []FinishedRun{cred(hm(10, 5), accessDenied), cred(hm(9, 5), msgLoginNoCSRF), cred(hm(8, 5), msgLoginRejected)}, true, 3},
		{"dua kegagalan login", []FinishedRun{cred(hm(10, 5), msgLoginRejected), cred(hm(9, 5), msgLoginRejected)}, false, 2},
		{"satu kegagalan login", []FinishedRun{cred(hm(10, 5), msgLoginRejected)}, false, 1},
		{"dua gagal lalu sukses sebelumnya", []FinishedRun{cred(hm(10, 5), msgLoginRejected), cred(hm(9, 5), msgLoginRejected), ok(hm(8, 5))}, false, 2},
		{"sukses paling baru", []FinishedRun{ok(hm(10, 5)), cred(hm(9, 5), msgLoginRejected), cred(hm(8, 5), msgLoginRejected)}, false, 0},
		{"kegagalan lain di tengah", []FinishedRun{cred(hm(10, 5), msgLoginRejected), other(hm(9, 5)), cred(hm(8, 5), msgLoginRejected)}, false, 1},
		{"sinkron terputus paling baru", []FinishedRun{cred(hm(10, 5), RecoveredRunMessage), cred(hm(9, 5), msgLoginRejected), cred(hm(8, 5), msgLoginRejected)}, false, 0},
		{"log kosong", nil, false, 0},
	}
	for _, c := range cases {
		r := newGuardRig(t, hm(10, 30), c.finished, func(n int) (RunOutcome, error) { return credFail() })
		r.start()
		if c.blocked {
			// 10:05 + 6 jam = 16:05; semua slot sebelumnya dilewati.
			for h := 11; h <= 15; h++ {
				r.skipped(hm(h, 5))
			}
			r.ran(hm(16, 5))
		} else {
			r.ran(hm(11, 5))
			// Hitungan yang dipulihkan berlanjut: kegagalan berikutnya menambahnya.
			wantBlockedAfter := c.failures + 1
			slot := hm(12, 5)
			for i := wantBlockedAfter; i < CredentialFailureLimit; i++ {
				r.ran(slot)
				slot = slot.Add(time.Hour)
			}
			r.skipped(slot)
		}
		r.stop()
		if got := r.store.finishedCalls; got != 1 {
			t.Errorf("%s: log dibaca %d kali, want 1", c.name, got)
		}
	}
}

func TestSchedulerReadsOnlyTheNewestRunsForTheGuard(t *testing.T) {
	r := newGuardRig(t, hm(10, 30), nil, func(int) (RunOutcome, error) { return okRun() })
	var limits []int
	spy := &spyScheduleStore{fakeScheduleStore: r.store, limits: &limits}
	sched, err := NewScheduler(SchedulerOptions{Syncer: r.runner, Store: spy, Minute: 5, Clock: r.clock})
	if err != nil {
		t.Fatal(err)
	}
	r.sched = sched
	r.start()
	r.ran(hm(11, 5))
	r.stop()
	if len(limits) != 1 || limits[0] != CredentialFailureLimit {
		t.Errorf("RecentFinishedRuns(limit) = %v, want [%d]", limits, CredentialFailureLimit)
	}
}

type spyScheduleStore struct {
	*fakeScheduleStore
	limits *[]int
}

func (s *spyScheduleStore) RecentFinishedRuns(ctx context.Context, limit int) ([]FinishedRun, error) {
	*s.limits = append(*s.limits, limit)
	return s.fakeScheduleStore.RecentFinishedRuns(ctx, limit)
}

// Sinkron susulan saat mulai tidak boleh menembus perlindungan: itu justru saat
// backend dimulai ulang, yang paling sering terjadi sesudah kredensial salah.
func TestSchedulerCatchUpRespectsTheRestoredGuard(t *testing.T) {
	finished := []FinishedRun{
		{StartedAt: hm(10, 5), FinishedAt: hm(10, 6), Message: msgLoginRejected},
		{StartedAt: hm(9, 5), FinishedAt: hm(9, 6), Message: msgLoginRejected},
		{StartedAt: hm(8, 5), FinishedAt: hm(8, 6), Message: msgLoginRejected},
	}
	r := newGuardRig(t, hm(10, 30), finished, func(int) (RunOutcome, error) { return credFail() })
	r.store.lastOK = false // belum pernah ada sinkron berhasil: biasanya langsung menyusul
	r.start()

	// Susulan dijadwalkan 10 detik sesudah mulai, lalu dilewati oleh perlindungan.
	r.expectTimerAt(hm(10, 30).Add(DefaultCatchUpDelay))
	skips := r.skipLogs()
	r.clock.Set(hm(10, 30).Add(DefaultCatchUpDelay))
	r.expectTimerAt(hm(11, 5))
	if n := len(r.runner.times()); n != 0 {
		t.Errorf("sinkron susulan berjalan %d kali padahal login ditolak 3 kali berturut-turut", n)
	}
	if r.skipLogs() != skips+1 {
		t.Errorf("sinkron susulan yang dilewati harus dicatat:\n%s", r.logs)
	}
	r.stop()
}

// Bila log tidak terbaca saat mulai, penjadwal tidak macet: ia mencoba lagi sebelum
// sinkron berikutnya dan memakai hasilnya.
func TestSchedulerRetriesReadingTheLogBeforeTheNextSync(t *testing.T) {
	finished := []FinishedRun{
		{StartedAt: hm(10, 5), FinishedAt: hm(10, 6), Message: msgLoginRejected},
		{StartedAt: hm(9, 5), FinishedAt: hm(9, 6), Message: msgLoginRejected},
		{StartedAt: hm(8, 5), FinishedAt: hm(8, 6), Message: msgLoginRejected},
	}
	r := newGuardRig(t, hm(10, 30), finished, func(int) (RunOutcome, error) { return okRun() })
	r.store.finishedErr = errors.New("database belum siap")
	r.start()
	r.expectTimerAt(hm(11, 5))
	if !strings.Contains(r.logs.String(), "gagal membaca log sinkron billing") {
		t.Errorf("kegagalan membaca log tidak dicatat:\n%s", r.logs)
	}

	// Database siap sebelum slot berikutnya: log dibaca dan perlindungan berlaku.
	r.store.mu.Lock()
	r.store.finishedErr = nil
	r.store.mu.Unlock()
	skips := r.skipLogs()
	r.clock.Set(hm(11, 5))
	r.expectTimerAt(hm(12, 5))
	if n := len(r.runner.times()); n != 0 || r.skipLogs() != skips+1 {
		t.Errorf("sinkron berjalan %d kali, catatan dilewati %d; perlindungan harus berlaku sesudah log terbaca", n, r.skipLogs()-skips)
	}
	r.stop()
	if r.store.finishedCalls != 2 {
		t.Errorf("log dibaca %d kali, want 2 (gagal lalu berhasil)", r.store.finishedCalls)
	}
}

// Sesudah perlindungan aktif karena log, percobaan yang diizinkan memakai waktu mulai
// sinkron terakhir di log, bukan waktu proses dimulai.
func TestSchedulerRestoredGuardUsesTheLoggedStartTime(t *testing.T) {
	finished := []FinishedRun{
		{StartedAt: hm(7, 5).Add(3 * time.Millisecond), FinishedAt: hm(7, 6), Message: msgLoginRejected},
		{StartedAt: hm(6, 5), FinishedAt: hm(6, 6), Message: msgLoginRejected},
		{StartedAt: hm(5, 5), FinishedAt: hm(5, 6), Message: msgLoginRejected},
	}
	r := newGuardRig(t, hm(9, 30), finished, func(int) (RunOutcome, error) { return okRun() })
	r.start()
	r.skipped(hm(10, 5))
	r.skipped(hm(11, 5))
	r.skipped(hm(12, 5))
	r.ran(hm(13, 5)) // 07:05 + 6 jam
	r.stop()
}

func TestCredentialGuardDecidesPerSlotNotPerSecond(t *testing.T) {
	newSched := func(minute, failures int, last time.Time) *Scheduler {
		return &Scheduler{minute: minute, credFailures: failures, credLast: last}
	}
	jitter := 3 * time.Millisecond
	cases := []struct {
		name    string
		sched   *Scheduler
		now     time.Time
		blocked bool
		next    time.Time
	}{
		{"belum cukup gagal", newSched(5, 2, hm(12, 5)), hm(12, 5).Add(time.Hour), false, time.Time{}},
		{"tanpa kegagalan", newSched(5, 0, time.Time{}), hm(12, 5), false, time.Time{}},
		{"satu jam sesudahnya", newSched(5, 3, hm(12, 5)), hm(13, 5), true, hm(18, 5)},
		{"lima jam sesudahnya", newSched(5, 3, hm(12, 5)), hm(17, 5), true, hm(18, 5)},
		{"tepat 6 jam", newSched(5, 3, hm(12, 5)), hm(18, 5), false, hm(18, 5)},
		{"6 jam dengan selisih pewaktu", newSched(5, 3, hm(12, 5).Add(jitter)), hm(18, 5).Add(2 * time.Millisecond), false, hm(18, 5)},
		{"sedetik sebelum 6 jam", newSched(5, 3, hm(12, 5)), hm(18, 5).Add(-time.Second), true, hm(18, 5)},
		{"enam jam lebih", newSched(5, 3, hm(12, 5)), hm(19, 5), false, hm(18, 5)},
		{"percobaan terakhir bukan di slot (susulan)", newSched(5, 3, hm(10, 37).Add(10*time.Second)), hm(15, 5), true, hm(16, 5)},
		{"percobaan terakhir bukan di slot, 6 jam kemudian", newSched(5, 3, hm(10, 37).Add(10*time.Second)), hm(16, 5), false, hm(16, 5)},
		{"menit 0", newSched(0, 4, hm(12, 0)), hm(17, 0), true, hm(18, 0)},
		{"menit 59", newSched(59, 3, hm(12, 59)), hm(18, 59), false, hm(18, 59)},
		{"lebih dari batas", newSched(5, 9, hm(12, 5)), hm(17, 5), true, hm(18, 5)},
	}
	for _, c := range cases {
		blocked, next := c.sched.credentialGuard(c.now)
		if blocked != c.blocked || !next.Equal(c.next) {
			t.Errorf("%s: credentialGuard(%s) = %v, %s; want %v, %s", c.name, c.now.Format(time.RFC3339Nano), blocked, next, c.blocked, c.next)
		}
	}
}

func TestIsCredentialsMessageOnlyMatchesLoginFailures(t *testing.T) {
	for _, msg := range []string{msgLoginRejected, msgLoginNoCSRF, fmt.Sprintf(msgAccessDenied, 401), fmt.Sprintf(msgAccessDenied, 403), fmt.Sprintf(msgAccessDenied, 419)} {
		if !isCredentialsMessage(msg) {
			t.Errorf("isCredentialsMessage(%q) = false", msg)
		}
	}
	for _, msg := range []string{
		msgSourceChanged, msgSessionLost, msgNetworkDown, msgNetworkTimeout, msgNetworkTLS, fmt.Sprintf(msgServerError, 503),
		msgUnknownStatusBlank, msgInternal, msgCanceled, msgTimeout, ErrEmptyInvoiceSource.Error(),
		RecoveredRunMessage, FallbackFailureMessage, "", "Login ke sistem billing ditolak.",
		fmt.Sprintf(msgAccessDenied, 403) + " tambahan", "x" + msgLoginRejected,
	} {
		if isCredentialsMessage(msg) {
			t.Errorf("isCredentialsMessage(%q) = true", msg)
		}
	}
}
