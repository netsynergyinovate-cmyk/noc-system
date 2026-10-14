package billing

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// Tes Syncer dengan sumber dan penyimpanan palsu. Tidak ada yang tidur atau
// membaca jam dinding: jam Syncer adalah penghitung yang maju satu detik tiap
// dibaca.

// callLog mencatat urutan panggilan lintas sumber dan penyimpanan palsu.
type callLog struct {
	mu    sync.Mutex
	calls []string
}

func (l *callLog) add(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls = append(l.calls, fmt.Sprintf(format, args...))
}

func (l *callLog) names() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.calls...)
}

func (l *callLog) count(name string) int {
	n := 0
	for _, c := range l.names() {
		if c == name {
			n++
		}
	}
	return n
}

type fakeSource struct {
	log      *callLog
	invoices []Invoice
	stats    Stats
	err      error
	panicVal any
	// onCall berjalan di dalam Invoices; boleh memblokir (mis. menunggu ctx.Done).
	onCall func(ctx context.Context) error
}

func (s *fakeSource) Invoices(ctx context.Context) ([]Invoice, Stats, error) {
	s.log.add("Invoices")
	if s.panicVal != nil {
		panic(s.panicVal)
	}
	if s.onCall != nil {
		if err := s.onCall(ctx); err != nil {
			return nil, s.stats, err
		}
	}
	if s.err != nil {
		return nil, s.stats, s.err
	}
	return s.invoices, s.stats, nil
}

type failCall struct {
	runID    string
	message  string
	cause    error
	ctxAlive bool
	at       time.Time
}

type fakeRunStore struct {
	log *callLog

	beginErr, loadErr, applyErr, failErr, pruneErr error
	panicIn                                        string // "begin", "load", "apply", "fail", "prune"
	panicVal                                       any
	customers                                      []Customer

	// Sinkron berhasil terakhir untuk LastSuccess. Panggilannya SENGAJA tidak masuk
	// callLog: urutan panggilan di banyak tes lama tidak menyebutnya.
	lastSuccess    SuccessRun
	hasLastSuccess bool
	lastSuccessErr error

	mu               sync.Mutex
	lastSuccessCalls int
	runID            string
	begun            []begunRun
	applied          []Result
	appliedAt        []time.Time
	failed           []failCall
	pruneKeep        []int
	pruneN           int
	running          bool // meniru indeks unik: satu baris running
}

type begunRun struct {
	trigger Trigger
	at      time.Time
}

func (s *fakeRunStore) maybePanic(where string) {
	if s.panicIn == where {
		panic(s.panicVal)
	}
}

func (s *fakeRunStore) BeginRun(ctx context.Context, trigger Trigger, now time.Time) (string, error) {
	s.log.add("BeginRun")
	s.maybePanic("begin")
	if err := ctx.Err(); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.beginErr != nil {
		return "", s.beginErr
	}
	if s.running {
		return "", ErrRunInProgress
	}
	s.running = true
	s.begun = append(s.begun, begunRun{trigger, now})
	if s.runID == "" {
		return "run-1", nil
	}
	return s.runID, nil
}

func (s *fakeRunStore) LastSuccess(ctx context.Context) (SuccessRun, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastSuccessCalls++
	if s.lastSuccessErr != nil {
		return SuccessRun{}, false, s.lastSuccessErr
	}
	return s.lastSuccess, s.hasLastSuccess, nil
}

func (s *fakeRunStore) LoadCustomers(ctx context.Context) ([]Customer, error) {
	s.log.add("LoadCustomers")
	s.maybePanic("load")
	if s.loadErr != nil {
		return nil, s.loadErr
	}
	return s.customers, nil
}

func (s *fakeRunStore) ApplySuccess(ctx context.Context, runID string, res Result, now time.Time) error {
	s.log.add("ApplySuccess")
	s.maybePanic("apply")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.applyErr != nil {
		return s.applyErr
	}
	s.applied = append(s.applied, res)
	s.appliedAt = append(s.appliedAt, now)
	s.running = false
	return nil
}

// FailRun meniru pgx: konteks yang sudah mati membuat penulisan gagal.
func (s *fakeRunStore) FailRun(ctx context.Context, runID string, cause error, now time.Time) error {
	s.log.add("FailRun")
	s.maybePanic("fail")
	s.mu.Lock()
	defer s.mu.Unlock()
	alive := ctx.Err() == nil
	s.failed = append(s.failed, failCall{runID: runID, message: failureMessage(cause), cause: cause, ctxAlive: alive, at: now})
	if !alive {
		return ctx.Err()
	}
	if s.failErr != nil {
		return s.failErr
	}
	s.running = false
	return nil
}

func (s *fakeRunStore) PruneRuns(ctx context.Context, keep int) (int, error) {
	s.log.add("PruneRuns")
	s.maybePanic("prune")
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneKeep = append(s.pruneKeep, keep)
	if s.pruneErr != nil {
		return 0, s.pruneErr
	}
	return s.pruneN, nil
}

// steppingClock maju satu detik tiap dibaca.
type steppingClock struct {
	mu   sync.Mutex
	next time.Time
}

func newSteppingClock(start time.Time) *steppingClock { return &steppingClock{next: start} }

func (c *steppingClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := c.next
	c.next = c.next.Add(time.Second)
	return t
}

type syncerRig struct {
	t      *testing.T
	log    *callLog
	source *fakeSource
	store  *fakeRunStore
	logs   *bytes.Buffer
	syncer *Syncer
	clock  *steppingClock
}

func newSyncerRig(t *testing.T, mutate func(*syncerRig, *SyncerOptions)) *syncerRig {
	t.Helper()
	log := &callLog{}
	r := &syncerRig{
		t: t, log: log, logs: &bytes.Buffer{},
		clock: newSteppingClock(utc(2026, 5, 1, 10, 5, 0, 0)),
		source: &fakeSource{log: log, invoices: []Invoice{
			{Name: "budi01", Ref: "INV-1", Status: StatusLunas},
			{Name: "dewi02", Ref: "INV-2", Status: StatusIsolir},
			{Name: "tidak-dikenal", Ref: "INV-3", Status: StatusLunas},
		}, stats: Stats{Pages: 2, Rows: 3}},
		store: &fakeRunStore{log: log, customers: []Customer{
			{ID: "c1", PPPoE: "budi01", Status: StatusIsolir},
			{ID: "c2", PPPoE: "dewi02", Status: StatusLunas},
			{ID: "c3", PPPoE: "agus03", Status: StatusLunas},
		}},
	}
	opts := SyncerOptions{
		Logger: slog.New(slog.NewTextHandler(r.logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
		Now:    r.clock.Now,
	}
	if mutate != nil {
		mutate(r, &opts)
	}
	s, err := NewSyncer(r.source, r.store, opts)
	if err != nil {
		t.Fatal(err)
	}
	r.syncer = s
	return r
}

// run memanggil RunOnce; panik yang lolos dari RunOnce dilaporkan sebagai kegagalan
// tes, bukan mematikan seluruh proses tes.
func (r *syncerRig) run(ctx context.Context) (out RunOutcome, err error) {
	r.t.Helper()
	defer func() {
		if p := recover(); p != nil {
			r.t.Fatalf("RunOnce membiarkan panic lolos: %v", p)
		}
	}()
	return r.syncer.RunOnce(ctx, TriggerSchedule)
}

func TestRunOnceSuccessCallOrderAndResult(t *testing.T) {
	r := newSyncerRig(t, nil)
	out, err := r.run(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if want := []string{"BeginRun", "Invoices", "LoadCustomers", "ApplySuccess", "PruneRuns"}; !reflect.DeepEqual(r.log.names(), want) {
		t.Errorf("urutan panggilan = %v, want %v", r.log.names(), want)
	}

	want := MatchInvoices(r.source.invoices, r.store.customers)
	if len(r.store.applied) != 1 || !reflect.DeepEqual(r.store.applied[0], want) {
		t.Errorf("ApplySuccess menerima %+v, want hasil MatchInvoices %+v", r.store.applied, want)
	}
	if out.Status != RunSuccess || out.Counts != want.Counts || out.RunID != "run-1" || out.Err != nil {
		t.Errorf("outcome = %+v", out)
	}
	if out.Counts.Invoices != 3 || out.Counts.StatusesChanged != 2 || out.Counts.UnmatchedUnknown != 1 {
		t.Errorf("hitungan = %+v", out.Counts)
	}
	if out.Stats != r.source.stats {
		t.Errorf("Stats = %+v, want %+v", out.Stats, r.source.stats)
	}
	if got := r.store.begun[0]; got.trigger != TriggerSchedule || !got.at.Equal(out.StartedAt) {
		t.Errorf("BeginRun menerima %+v, StartedAt %s", got, out.StartedAt)
	}
	if !r.store.appliedAt[0].After(out.StartedAt) || !out.FinishedAt.After(out.StartedAt) {
		t.Errorf("waktu: mulai %s, terapkan %s, selesai %s", out.StartedAt, r.store.appliedAt[0], out.FinishedAt)
	}
	if got := r.store.pruneKeep; len(got) != 1 || got[0] != DefaultKeepRuns {
		t.Errorf("PruneRuns(keep) = %v, want [%d]", got, DefaultKeepRuns)
	}
	if DefaultKeepRuns != 336 {
		t.Errorf("DefaultKeepRuns = %d, want 24*14 = 336", DefaultKeepRuns)
	}
	if len(r.store.failed) != 0 {
		t.Errorf("FailRun dipanggil pada sinkron yang berhasil: %+v", r.store.failed)
	}
}

func TestRunOnceUsesConfiguredKeepAndReportsPruned(t *testing.T) {
	r := newSyncerRig(t, func(_ *syncerRig, o *SyncerOptions) { o.Keep = 7 })
	r.store.pruneN = 4
	out, err := r.run(context.Background())
	if err != nil || out.Status != RunSuccess {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if got := r.store.pruneKeep; len(got) != 1 || got[0] != 7 {
		t.Errorf("PruneRuns(keep) = %v, want [7]", got)
	}
	if out.Pruned != 4 {
		t.Errorf("Pruned = %d, want 4", out.Pruned)
	}
	if !strings.Contains(r.logs.String(), "dibuang=4") {
		t.Errorf("log tidak mencatat hasil pemangkasan:\n%s", r.logs)
	}
}

func TestRunOnceSkipsWhenAnotherRunIsInProgress(t *testing.T) {
	for name, beginErr := range map[string]error{
		"langsung":  ErrRunInProgress,
		"dibungkus": fmt.Errorf("lapisan lain: %w", ErrRunInProgress),
	} {
		r := newSyncerRig(t, nil)
		r.store.beginErr = beginErr
		out, err := r.run(context.Background())
		if err != nil {
			t.Errorf("%s: RunOnce = %v; sinkron yang dilewati bukan galat", name, err)
		}
		if out.Status != RunSkipped || out.RunID != "" || out.Err != nil {
			t.Errorf("%s: outcome = %+v, want RunSkipped", name, out)
		}
		if got := r.log.names(); !reflect.DeepEqual(got, []string{"BeginRun"}) {
			t.Errorf("%s: panggilan = %v; sinkron yang dilewati tidak boleh menyentuh yang lain", name, got)
		}
		if strings.Contains(r.logs.String(), "level=ERROR") || strings.Contains(r.logs.String(), "level=WARN") {
			t.Errorf("%s: sinkron yang dilewati tidak boleh mencatat kegagalan:\n%s", name, r.logs)
		}
	}
}

func TestRunOnceTwoConcurrentCallsOneRunsOneSkips(t *testing.T) {
	r := newSyncerRig(t, nil)
	entered := make(chan struct{})
	release := make(chan struct{})
	r.source.onCall = func(ctx context.Context) error {
		close(entered)
		<-release
		return nil
	}

	results := make(chan RunOutcome, 2)
	for i := 0; i < 2; i++ {
		go func() {
			out, err := r.syncer.RunOnce(context.Background(), TriggerSchedule)
			if err != nil {
				t.Errorf("RunOnce: %v", err)
			}
			results <- out
		}()
	}
	// Yang pertama kembali hanyalah yang kalah: pemenang masih menahan sumber.
	first := <-results
	if first.Status != RunSkipped {
		t.Errorf("sinkron yang kembali lebih dulu = %+v, want RunSkipped", first)
	}
	<-entered
	close(release)
	if second := <-results; second.Status != RunSuccess {
		t.Errorf("sinkron yang menang = %+v, want RunSuccess", second)
	}
	if n := r.log.count("Invoices"); n != 1 {
		t.Errorf("sumber dibaca %d kali, want 1", n)
	}
}

func TestRunOnceStageFailuresCloseTheRunAndStopEarly(t *testing.T) {
	sentinel := errors.New("gangguan buatan")
	cases := []struct {
		name      string
		setup     func(*syncerRig)
		wantCalls []string
	}{
		{"galat sumber", func(r *syncerRig) { r.source.err = fmt.Errorf("baca: %w", sentinel) },
			[]string{"BeginRun", "Invoices", "FailRun"}},
		{"galat baca pelanggan", func(r *syncerRig) { r.store.loadErr = sentinel },
			[]string{"BeginRun", "Invoices", "LoadCustomers", "FailRun"}},
		{"galat menerapkan", func(r *syncerRig) { r.store.applyErr = sentinel },
			[]string{"BeginRun", "Invoices", "LoadCustomers", "ApplySuccess", "FailRun"}},
	}
	for _, c := range cases {
		r := newSyncerRig(t, nil)
		c.setup(r)
		out, err := r.run(context.Background())
		if !errors.Is(err, sentinel) || !errors.Is(out.Err, sentinel) {
			t.Errorf("%s: err = %v, out.Err = %v; want membungkus penyebabnya", c.name, err, out.Err)
		}
		if out.Status != RunFailed || out.RunID != "run-1" {
			t.Errorf("%s: outcome = %+v, want RunFailed dengan RunID", c.name, out)
		}
		if got := r.log.names(); !reflect.DeepEqual(got, c.wantCalls) {
			t.Errorf("%s: panggilan = %v, want %v", c.name, got, c.wantCalls)
		}
		if len(r.store.failed) != 1 || r.store.failed[0].runID != "run-1" || !errors.Is(r.store.failed[0].cause, sentinel) {
			t.Errorf("%s: FailRun = %+v", c.name, r.store.failed)
		}
		if len(r.store.applied) != 0 {
			t.Errorf("%s: hasil diterapkan walau sinkron gagal: %+v", c.name, r.store.applied)
		}
		if !strings.Contains(r.logs.String(), "level=ERROR") || !strings.Contains(r.logs.String(), "sinkron billing gagal") {
			t.Errorf("%s: kegagalan tidak dicatat:\n%s", c.name, r.logs)
		}
	}
}

func TestRunOnceBeginFailureWritesNoFailureRecord(t *testing.T) {
	r := newSyncerRig(t, nil)
	boom := errors.New("database mati")
	r.store.beginErr = boom
	out, err := r.run(context.Background())
	if !errors.Is(err, boom) || out.Status != RunFailed || out.RunID != "" {
		t.Errorf("RunOnce = %+v, %v", out, err)
	}
	if got := r.log.names(); !reflect.DeepEqual(got, []string{"BeginRun"}) {
		t.Errorf("panggilan = %v; tanpa baris log tidak ada yang bisa ditutup", got)
	}
}

func TestRunOnceEmptySourceFailsWithoutApplying(t *testing.T) {
	const want = "Sumber billing tidak mengembalikan satu pun tagihan; status lama dipertahankan."
	for name, invoices := range map[string][]Invoice{"nil": nil, "kosong": {}} {
		r := newSyncerRig(t, nil)
		r.source.invoices = invoices
		out, err := r.run(context.Background())
		if !errors.Is(err, ErrEmptyInvoiceSource) || out.Status != RunFailed {
			t.Errorf("%s: RunOnce = %+v, %v; want ErrEmptyInvoiceSource", name, out, err)
		}
		if ErrEmptyInvoiceSource.Error() != want {
			t.Errorf("pesan ErrEmptyInvoiceSource = %q", ErrEmptyInvoiceSource.Error())
		}
		if r.log.count("ApplySuccess") != 0 || r.log.count("LoadCustomers") != 0 || r.log.count("PruneRuns") != 0 {
			t.Errorf("%s: sumber kosong tidak boleh sampai ke penerapan: %v", name, r.log.names())
		}
		if len(r.store.failed) != 1 || r.store.failed[0].message != want {
			t.Errorf("%s: catatan gagal = %+v, want pesan %q", name, r.store.failed, want)
		}
		if len(r.store.applied) != 0 {
			t.Errorf("%s: ApplySuccess dipanggil dengan sumber kosong", name)
		}
	}
}

// Satu tagihan saja sudah sinkron yang sah: penjaga hanya untuk NOL tagihan.
func TestRunOnceSingleInvoiceIsNotEmpty(t *testing.T) {
	r := newSyncerRig(t, nil)
	r.source.invoices = []Invoice{{Name: "budi01", Ref: "INV-1", Status: StatusLunas}}
	if out, err := r.run(context.Background()); err != nil || out.Status != RunSuccess {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
}

func TestRunOnceCatchesPanicsAnywhere(t *testing.T) {
	const secret = "sandi-rahasia-12345"
	cases := []struct {
		name      string
		setup     func(*syncerRig)
		wantRunID string
		wantFail  int
	}{
		{"di sumber", func(r *syncerRig) { r.source.panicVal = secret }, "run-1", 1},
		{"di sumber, nilai panic galat", func(r *syncerRig) { r.source.panicVal = errors.New(secret) }, "run-1", 1},
		{"di baca pelanggan", func(r *syncerRig) { r.store.panicIn, r.store.panicVal = "load", secret }, "run-1", 1},
		{"di menerapkan", func(r *syncerRig) { r.store.panicIn, r.store.panicVal = "apply", secret }, "run-1", 1},
		{"panic runtime (indeks)", func(r *syncerRig) {
			var empty []int
			r.source.onCall = func(context.Context) error { _ = empty[3]; return nil }
		}, "run-1", 1},
		{"panic runtime (pointer nil)", func(r *syncerRig) {
			r.source.onCall = func(context.Context) error { var c *Customer; _ = c.ID; return nil }
		}, "run-1", 1},
		{"di mulai (belum ada baris)", func(r *syncerRig) { r.store.panicIn, r.store.panicVal = "begin", secret }, "", 0},
	}
	for _, c := range cases {
		r := newSyncerRig(t, nil)
		c.setup(r)
		out, err := r.run(context.Background())
		if !errors.Is(err, ErrSyncPanic) || out.Status != RunFailed || !errors.Is(out.Err, ErrSyncPanic) {
			t.Errorf("%s: RunOnce = %+v, %v; want RunFailed membungkus ErrSyncPanic", c.name, out, err)
			continue
		}
		var pe *PanicError
		if !errors.As(err, &pe) || pe.Detail == "" || len(pe.Stack) == 0 {
			t.Errorf("%s: err = %#v, want *PanicError dengan detail dan stack", c.name, err)
		}
		if len(r.store.failed) != c.wantFail {
			t.Errorf("%s: FailRun dipanggil %d kali, want %d", c.name, len(r.store.failed), c.wantFail)
		}
		if c.wantFail == 1 && r.store.failed[0].message != ErrSyncPanic.Error() {
			t.Errorf("%s: pesan catatan gagal = %q, want %q", c.name, r.store.failed[0].message, ErrSyncPanic.Error())
		}
		if out.RunID != c.wantRunID {
			t.Errorf("%s: RunID = %q, want %q", c.name, out.RunID, c.wantRunID)
		}
		if r.log.count("ApplySuccess") > 0 && c.name != "di menerapkan" {
			t.Errorf("%s: ApplySuccess seharusnya tidak tercapai", c.name)
		}
		logs := r.logs.String()
		if strings.Contains(logs, secret) {
			t.Errorf("%s: nilai panic bocor ke log:\n%s", c.name, logs)
		}
		if !strings.Contains(logs, "panic=") || !strings.Contains(logs, "stack=") {
			t.Errorf("%s: panic harus dicatat dengan jenis dan stack:\n%s", c.name, logs)
		}
		for _, f := range r.store.failed {
			if strings.Contains(f.message, secret) {
				t.Errorf("%s: nilai panic bocor ke catatan sinkron: %q", c.name, f.message)
			}
		}
	}
}

func TestRunOncePanicLeavesSyncerUsable(t *testing.T) {
	r := newSyncerRig(t, nil)
	r.source.panicVal = "meledak"
	if out, _ := r.run(context.Background()); out.Status != RunFailed {
		t.Fatalf("sinkron pertama = %+v", out)
	}
	r.source.panicVal = nil
	if out, err := r.run(context.Background()); err != nil || out.Status != RunSuccess {
		t.Errorf("sinkron sesudah panic = %+v, %v; Syncer harus tetap hidup", out, err)
	}
}

func TestRunOncePanicWhileRecordingFailureStillReturns(t *testing.T) {
	r := newSyncerRig(t, nil)
	r.source.err = errors.New("sumber gagal")
	r.store.panicIn, r.store.panicVal = "fail", "meledak lagi"
	out, err := r.run(context.Background())
	if out.Status != RunFailed || err == nil {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if !errors.Is(err, ErrSyncPanic) || !strings.Contains(err.Error(), "sumber gagal") {
		t.Errorf("err = %v; harus memuat penyebab awal dan panic saat mencatat", err)
	}
}

func TestRunOnceFailureToRecordFailureIsReported(t *testing.T) {
	r := newSyncerRig(t, nil)
	cause := errors.New("sumber gagal")
	recordErr := errors.New("tulis gagal")
	r.source.err = cause
	r.store.failErr = recordErr
	out, err := r.run(context.Background())
	if !errors.Is(err, cause) || !errors.Is(err, recordErr) || !errors.Is(out.Err, recordErr) {
		t.Errorf("err = %v, out.Err = %v; want keduanya", err, out.Err)
	}
	if !strings.Contains(r.logs.String(), "gagal menulis catatan sinkron billing") {
		t.Errorf("kegagalan menulis catatan tidak dicatat:\n%s", r.logs)
	}
}

// Baris log yang sudah ditutup (mis. penerapan ter-commit lalu galat muncul) bukan
// kegagalan tambahan.
func TestRunOnceRunAlreadyClosedIsNotAnExtraError(t *testing.T) {
	r := newSyncerRig(t, nil)
	cause := errors.New("galat setelah commit")
	r.store.applyErr = cause
	r.store.failErr = ErrRunNotRunning
	out, err := r.run(context.Background())
	if !errors.Is(err, cause) {
		t.Fatalf("err = %v", err)
	}
	if errors.Is(err, ErrRunNotRunning) || out.Status != RunFailed {
		t.Errorf("err = %v, outcome = %+v", err, out)
	}
}

func TestRunOncePruneFailureDoesNotFailTheSync(t *testing.T) {
	for name, setup := range map[string]func(*syncerRig){
		"galat": func(r *syncerRig) { r.store.pruneErr = errors.New("pangkas gagal: disk penuh") },
		"panic": func(r *syncerRig) { r.store.panicIn, r.store.panicVal = "prune", "meledak" },
	} {
		r := newSyncerRig(t, nil)
		setup(r)
		out, err := r.run(context.Background())
		if err != nil || out.Status != RunSuccess || out.Err != nil {
			t.Errorf("%s: RunOnce = %+v, %v; pemangkasan gagal tidak boleh menggagalkan sinkron yang berhasil", name, out, err)
		}
		if r.log.count("FailRun") != 0 || len(r.store.failed) != 0 {
			t.Errorf("%s: FailRun dipanggil sesudah sinkron berhasil", name)
		}
		if len(r.store.applied) != 1 {
			t.Errorf("%s: hasil harus tetap diterapkan", name)
		}
		if !strings.Contains(r.logs.String(), "level=WARN") || !strings.Contains(r.logs.String(), "gagal memangkas") {
			t.Errorf("%s: kegagalan pemangkasan harus dicatat:\n%s", name, r.logs)
		}
	}
}

func TestRunOnceCanceledContextFailsWithStopMessageAndWritesItAnyway(t *testing.T) {
	const want = "Sinkron dibatalkan karena backend berhenti."
	if ErrSyncCanceled.Error() != want {
		t.Fatalf("pesan ErrSyncCanceled = %q", ErrSyncCanceled.Error())
	}

	cases := map[string]func(r *syncerRig, cancel context.CancelFunc){
		// Sumber menghormati konteks dan mengembalikan galat konteks.
		"sumber menghormati konteks": func(r *syncerRig, cancel context.CancelFunc) {
			r.source.onCall = func(ctx context.Context) error {
				cancel()
				<-ctx.Done()
				return fmt.Errorf("%w: permintaan terputus", ctx.Err())
			}
		},
		// Sumber mengembalikan galat lain yang tidak menyebut konteks sama sekali.
		"galat yang tidak menyebut konteks": func(r *syncerRig, cancel context.CancelFunc) {
			r.source.onCall = func(ctx context.Context) error {
				cancel()
				return errors.New("koneksi terputus")
			}
		},
		// Pembatalan tiba saat sinkron sudah di tahap database.
		"di tahap database": func(r *syncerRig, cancel context.CancelFunc) {
			r.store.applyErr = errors.New("write failed")
			r.source.onCall = func(ctx context.Context) error { cancel(); return nil }
		},
	}
	for name, setup := range cases {
		r := newSyncerRig(t, nil)
		ctx, cancel := context.WithCancel(context.Background())
		setup(r, cancel)
		out, err := r.run(ctx)
		cancel()
		if !errors.Is(err, ErrSyncCanceled) || out.Status != RunFailed {
			t.Errorf("%s: RunOnce = %+v, %v; want ErrSyncCanceled", name, out, err)
		}
		if err != nil && err.Error() != want {
			t.Errorf("%s: pesan = %q, want %q", name, err.Error(), want)
		}
		if len(r.store.failed) != 1 {
			t.Fatalf("%s: FailRun dipanggil %d kali, want 1", name, len(r.store.failed))
		}
		f := r.store.failed[0]
		if f.message != want {
			t.Errorf("%s: pesan catatan = %q, want %q", name, f.message, want)
		}
		if !f.ctxAlive {
			t.Errorf("%s: catatan gagal ditulis dengan konteks yang sudah dibatalkan; penulisan nyata akan gagal dan baris tetap running", name)
		}
		if out.Err != nil && out.Err.Error() != want {
			t.Errorf("%s: out.Err = %v", name, out.Err)
		}
	}
}

func TestRunOnceCanceledBeforeStartNeverCreatesARun(t *testing.T) {
	r := newSyncerRig(t, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out, err := r.run(ctx)
	if !errors.Is(err, ErrSyncCanceled) || !errors.Is(err, context.Canceled) || out.Status != RunFailed || out.RunID != "" {
		t.Errorf("RunOnce = %+v, %v", out, err)
	}
	if r.log.count("Invoices") != 0 || r.log.count("FailRun") != 0 {
		t.Errorf("panggilan = %v", r.log.names())
	}
}

func TestRunOnceTimeoutFailsWithTimeoutMessage(t *testing.T) {
	const want = "Sinkron melewati batas waktu."
	r := newSyncerRig(t, nil)
	// Konteks sinkron yang batas waktunya sudah lewat sejak awal: tidak perlu
	// menunggu. BeginRun palsu memeriksa konteks seperti pgx, jadi sinkron gagal
	// di langkah pertama; yang diuji adalah penjelasan galatnya.
	r.syncer.derive = func(parent context.Context) (context.Context, context.CancelFunc) {
		return context.WithDeadline(parent, time.Unix(1, 0))
	}
	out, err := r.run(context.Background())
	if !errors.Is(err, ErrSyncTimeout) || errors.Is(err, ErrSyncCanceled) || out.Status != RunFailed {
		t.Fatalf("RunOnce = %+v, %v; want ErrSyncTimeout", out, err)
	}
	if err.Error() != want {
		t.Errorf("pesan = %q, want %q", err.Error(), want)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("penyebab asli harus tetap bisa diperiksa: %v", err)
	}
}

func TestRunOnceTimeoutDuringSourceWritesFailureWithLiveContext(t *testing.T) {
	const want = "Sinkron melewati batas waktu."
	r := newSyncerRig(t, nil)
	var expire context.CancelCauseFunc
	r.syncer.derive = func(parent context.Context) (context.Context, context.CancelFunc) {
		ctx, cancel := context.WithCancelCause(parent)
		expire = cancel
		return ctx, func() { cancel(nil) }
	}
	r.source.onCall = func(ctx context.Context) error {
		expire(context.DeadlineExceeded)
		<-ctx.Done()
		return ctx.Err()
	}
	out, err := r.run(context.Background())
	if !errors.Is(err, ErrSyncTimeout) || out.Status != RunFailed {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if len(r.store.failed) != 1 || r.store.failed[0].message != want || !r.store.failed[0].ctxAlive {
		t.Errorf("catatan gagal = %+v, want pesan %q dengan konteks hidup", r.store.failed, want)
	}
}

func TestRunOnceContextIsDerivedFromParentWithTimeout(t *testing.T) {
	type ctxKey struct{}
	for name, timeout := range map[string]time.Duration{"bawaan": DefaultSyncTimeout, "disetel": 7 * time.Minute} {
		r := newSyncerRig(t, func(_ *syncerRig, o *SyncerOptions) {
			if name == "disetel" {
				o.Timeout = timeout
			}
		})
		var value any
		var deadline time.Time
		var hasDeadline bool
		r.source.onCall = func(ctx context.Context) error {
			value = ctx.Value(ctxKey{})
			deadline, hasDeadline = ctx.Deadline()
			return nil
		}
		parent := context.WithValue(context.Background(), ctxKey{}, "dari-induk")
		before := time.Now()
		if _, err := r.run(parent); err != nil {
			t.Fatal(err)
		}
		after := time.Now()
		if value != "dari-induk" {
			t.Errorf("%s: konteks sinkron tidak diturunkan dari konteks induk", name)
		}
		if !hasDeadline || deadline.Before(before.Add(timeout)) || deadline.After(after.Add(timeout)) {
			t.Errorf("%s: batas waktu = %s (ada: %v), want %s sejak panggilan", name, deadline, hasDeadline, timeout)
		}
	}
	if DefaultSyncTimeout != 10*time.Minute {
		t.Errorf("DefaultSyncTimeout = %s, want 10m", DefaultSyncTimeout)
	}
}

func TestRunOnceLogsCountsAndNeverContents(t *testing.T) {
	const (
		secretName = "pelanggan-rahasia-xyz"
		secretRef  = "INV-RAHASIA-999"
	)
	r := newSyncerRig(t, nil)
	r.source.invoices = []Invoice{
		{Name: "budi01", Ref: secretRef, Status: StatusLunas},
		{Name: secretName, Ref: "INV-2", Status: StatusIsolir},
	}
	r.store.customers = []Customer{{ID: "c1", PPPoE: "budi01", Status: StatusIsolir}, {ID: "c2", PPPoE: "agus03", Status: StatusLunas}}
	if _, err := r.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	logs := r.logs.String()
	for _, want := range []string{
		"sinkron billing dimulai", "sinkron billing selesai", "run_id=run-1", "trigger=schedule",
		"tagihan=2", "cocok=1", "tidak_cocok=1", "tanpa_tagihan=1", "berubah=1", "halaman=2", "durasi=",
	} {
		if !strings.Contains(logs, want) {
			t.Errorf("log tidak memuat %q:\n%s", want, logs)
		}
	}
	for _, banned := range []string{secretName, secretRef, "budi01", "agus03", "INV-2"} {
		if strings.Contains(logs, banned) {
			t.Errorf("log memuat isi tagihan atau pelanggan %q:\n%s", banned, logs)
		}
	}

	// Gagal: hanya tahap dan pesan galat.
	r = newSyncerRig(t, nil)
	r.source.err = ErrLoginFailed
	if _, err := r.run(context.Background()); err == nil {
		t.Fatal("seharusnya gagal")
	}
	logs = r.logs.String()
	for _, want := range []string{"sinkron billing gagal", "tahap=baca_tagihan", "login ditolak", "run_id=run-1"} {
		if !strings.Contains(logs, want) {
			t.Errorf("log kegagalan tidak memuat %q:\n%s", want, logs)
		}
	}
}

func TestNewSyncerValidatesAndDefaults(t *testing.T) {
	log := &callLog{}
	src := &fakeSource{log: log}
	st := &fakeRunStore{log: log}
	if _, err := NewSyncer(nil, st, SyncerOptions{}); err == nil {
		t.Error("sumber nil seharusnya ditolak")
	}
	if _, err := NewSyncer(src, nil, SyncerOptions{}); err == nil {
		t.Error("penyimpanan nil seharusnya ditolak")
	}
	if _, err := NewSyncer(src, st, SyncerOptions{Timeout: -time.Second}); err == nil {
		t.Error("batas waktu negatif seharusnya ditolak")
	}
	if _, err := NewSyncer(src, st, SyncerOptions{Keep: -1}); err == nil {
		t.Error("keep negatif seharusnya ditolak")
	}
	s, err := NewSyncer(src, st, SyncerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if s.timeout != DefaultSyncTimeout || s.keep != DefaultKeepRuns || s.now == nil || s.log == nil {
		t.Errorf("bawaan tidak terisi: %+v", s)
	}
}
