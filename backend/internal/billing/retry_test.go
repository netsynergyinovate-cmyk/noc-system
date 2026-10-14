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

// Tes percobaan ulang pembacaan sumber dan penjaga hasil yang menyusut, dengan
// sumber dan penyimpanan palsu. Tidak ada yang tidur: jam dan pewaktu Syncer
// diganti retryClock, yang mencatat jeda lalu langsung memajukan jam seolah-olah
// sudah menunggu.

// retryClock adalah jam palsu untuk Syncer (Now dan After).
type retryClock struct {
	mu    sync.Mutex
	now   time.Time
	waits []time.Duration
	// hold membuat After memberi kanal yang tidak pernah berbunyi, dan menutup
	// entered pada panggilan pertama: jeda yang hanya bisa diputus pembatalan.
	hold    bool
	entered chan struct{}
	once    sync.Once
}

func newRetryClock() *retryClock {
	return &retryClock{now: utc(2026, 5, 1, 10, 5, 0, 0), entered: make(chan struct{})}
}

func (c *retryClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *retryClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func (c *retryClock) After(d time.Duration) <-chan time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.waits = append(c.waits, d)
	ch := make(chan time.Time, 1)
	if c.hold {
		c.once.Do(func() { close(c.entered) })
		return ch
	}
	c.now = c.now.Add(d)
	ch <- c.now
	return ch
}

func (c *retryClock) resetWaits() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.waits = nil
}

func (c *retryClock) recordedWaits() []time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]time.Duration(nil), c.waits...)
}

// scriptSource menjawab pembacaan ke-n dengan steps[n-1]; bila langkahnya habis,
// langkah terakhir dipakai terus.
type scriptSource struct {
	clock *retryClock
	steps []sourceStep
	log   *callLog // bila ada, tiap pembacaan dicatat sebagai "Invoices"

	mu    sync.Mutex
	calls int
	at    []time.Time
}

type sourceStep func(ctx context.Context) ([]Invoice, Stats, error)

func (s *scriptSource) Invoices(ctx context.Context) ([]Invoice, Stats, error) {
	s.mu.Lock()
	s.calls++
	n := s.calls
	s.at = append(s.at, s.clock.Now())
	s.mu.Unlock()
	if s.log != nil {
		s.log.add("Invoices")
	}
	return s.steps[min(n, len(s.steps))-1](ctx)
}

func (s *scriptSource) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func failStep(err error) sourceStep {
	return func(context.Context) ([]Invoice, Stats, error) { return nil, Stats{Pages: 1}, err }
}

func okStep(list []Invoice) sourceStep {
	return func(context.Context) ([]Invoice, Stats, error) { return list, Stats{Pages: 2, Rows: len(list)}, nil }
}

// slowly menjalankan step sesudah memajukan jam sebanyak d (lama pembacaan).
func slowly(c *retryClock, d time.Duration, step sourceStep) sourceStep {
	return func(ctx context.Context) ([]Invoice, Stats, error) {
		c.advance(d)
		return step(ctx)
	}
}

func sampleInvoices() []Invoice {
	return []Invoice{
		{Name: "budi01", Ref: "INV-1", Status: StatusLunas},
		{Name: "dewi02", Ref: "INV-2", Status: StatusIsolir},
		{Name: "tidak-dikenal", Ref: "INV-3", Status: StatusLunas},
	}
}

type retryRig struct {
	t      *testing.T
	clock  *retryClock
	source *scriptSource
	store  *fakeRunStore
	order  *callLog
	logs   *bytes.Buffer
	syncer *Syncer
}

func newRetryRig(t *testing.T, steps []sourceStep, mutate func(*SyncerOptions)) *retryRig {
	t.Helper()
	order := &callLog{}
	clock := newRetryClock()
	r := &retryRig{
		t: t, clock: clock, order: order, logs: &bytes.Buffer{},
		source: &scriptSource{clock: clock, steps: steps, log: order},
		store: &fakeRunStore{log: order, customers: []Customer{
			{ID: "c1", PPPoE: "budi01", Status: StatusIsolir},
			{ID: "c2", PPPoE: "dewi02", Status: StatusLunas},
			{ID: "c3", PPPoE: "agus03", Status: StatusLunas},
		}},
	}
	opts := SyncerOptions{
		Logger: slog.New(slog.NewTextHandler(r.logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
		Now:    clock.Now,
		After:  clock.After,
	}
	if mutate != nil {
		mutate(&opts)
	}
	s, err := NewSyncer(r.source, r.store, opts)
	if err != nil {
		t.Fatal(err)
	}
	r.syncer = s
	return r
}

func (r *retryRig) run(ctx context.Context) (RunOutcome, error) {
	r.t.Helper()
	return r.syncer.RunOnce(ctx, TriggerSchedule)
}

func durations(ds ...time.Duration) []time.Duration { return ds }

// --- Percobaan ulang ------------------------------------------------------------

func transientErrors() map[string]error {
	return map[string]error{
		"jaringan":     netErr(errors.New("koneksi ditolak")),
		"timeout":      netErr(context.DeadlineExceeded),
		"HTTP 503":     &StatusError{Method: "GET", Path: "/invoices", Code: 503},
		"HTTP 500":     &StatusError{Method: "POST", Path: "/login", Code: 500},
		"ErrNetwork":   fmt.Errorf("dial: %w", ErrNetwork),
		"timeout net.": netErr(timeoutNetErr{}),
	}
}

func TestReadRetriesTransientFailureThenSucceedsInOneSuccessRun(t *testing.T) {
	for name, transient := range transientErrors() {
		// Gagal sekali lalu berhasil di percobaan kedua.
		r := newRetryRig(t, []sourceStep{failStep(transient), okStep(sampleInvoices())}, nil)
		out, err := r.run(context.Background())
		if err != nil || out.Status != RunSuccess || out.Err != nil || out.Failure != (Failure{}) {
			t.Fatalf("%s: RunOnce = %+v, %v", name, out, err)
		}
		if out.Attempts != 2 || r.source.callCount() != 2 {
			t.Errorf("%s: percobaan = %d, panggilan sumber = %d, want 2", name, out.Attempts, r.source.callCount())
		}
		if got := r.clock.recordedWaits(); !reflect.DeepEqual(got, durations(15*time.Second)) {
			t.Errorf("%s: jeda = %v, want [15s]", name, got)
		}
		// SATU baris log: satu BeginRun, satu ApplySuccess, tidak ada FailRun.
		if want := []string{"BeginRun", "Invoices", "Invoices", "LoadCustomers", "ApplySuccess", "PruneRuns"}; !reflect.DeepEqual(r.order.names(), want) {
			t.Errorf("%s: panggilan = %v, want %v", name, r.order.names(), want)
		}
		if len(r.store.begun) != 1 || len(r.store.applied) != 1 || len(r.store.failed) != 0 {
			t.Errorf("%s: BeginRun %d, ApplySuccess %d, FailRun %d; want 1, 1, 0",
				name, len(r.store.begun), len(r.store.applied), len(r.store.failed))
		}
		// Hasil yang diterapkan adalah hasil percobaan yang berhasil.
		if want := MatchInvoices(sampleInvoices(), r.store.customers); !reflect.DeepEqual(r.store.applied[0], want) {
			t.Errorf("%s: hasil yang diterapkan = %+v", name, r.store.applied[0])
		}
		if out.Stats.Pages != 2 {
			t.Errorf("%s: Stats = %+v; harus milik percobaan terakhir", name, out.Stats)
		}
	}
}

func TestReadRetriesTwiceWithFifteenThenFortyFiveSeconds(t *testing.T) {
	r := newRetryRig(t, []sourceStep{
		failStep(netErr(errors.New("a"))), failStep(&StatusError{Code: 502}), okStep(sampleInvoices()),
	}, nil)
	start := r.clock.Now()
	out, err := r.run(context.Background())
	if err != nil || out.Status != RunSuccess || out.Attempts != 3 {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if got := r.clock.recordedWaits(); !reflect.DeepEqual(got, durations(15*time.Second, 45*time.Second)) {
		t.Errorf("jeda = %v, want [15s 45s]", got)
	}
	// Waktu tiap percobaan menurut jam palsu: 0, 15 detik, 60 detik.
	wantAt := []time.Time{start, start.Add(15 * time.Second), start.Add(60 * time.Second)}
	if len(r.source.at) != len(wantAt) {
		t.Fatalf("waktu percobaan = %v, want %v", r.source.at, wantAt)
	}
	for i := range wantAt {
		if !r.source.at[i].Equal(wantAt[i]) {
			t.Errorf("percobaan %d pada %s, want %s", i+1, r.source.at[i], wantAt[i])
		}
	}
	if DefaultMaxReadAttempts != 3 || DefaultFirstRetryDelay != 15*time.Second || DefaultSecondRetryDelay != 45*time.Second {
		t.Errorf("bawaan = %d percobaan, %s, %s", DefaultMaxReadAttempts, DefaultFirstRetryDelay, DefaultSecondRetryDelay)
	}
}

func TestReadAllAttemptsFailWriteOneFailedRunWithTheLastError(t *testing.T) {
	// Tiap percobaan gagal dengan sebab berbeda; yang dicatat adalah yang terakhir.
	last := fmt.Errorf("baca: %w", netErr(context.DeadlineExceeded))
	r := newRetryRig(t, []sourceStep{
		failStep(&StatusError{Method: "GET", Path: "/invoices", Code: 503}),
		failStep(netErr(errors.New("koneksi ditolak"))),
		failStep(last),
	}, nil)
	out, err := r.run(context.Background())
	if out.Status != RunFailed || out.Attempts != 3 || r.source.callCount() != 3 {
		t.Fatalf("outcome = %+v", out)
	}
	if !errors.Is(err, last) || !errors.Is(out.Err, last) {
		t.Errorf("err = %v, out.Err = %v; want galat percobaan terakhir", err, out.Err)
	}
	want := Classify(last)
	if want.Kind != FailureTimeout || out.Failure != want {
		t.Errorf("Failure = %+v, want %+v", out.Failure, want)
	}
	// Tepat dua jeda (tidak menunggu lagi sesudah percobaan terakhir) dan SATU baris.
	if got := r.clock.recordedWaits(); !reflect.DeepEqual(got, durations(15*time.Second, 45*time.Second)) {
		t.Errorf("jeda = %v", got)
	}
	if len(r.store.begun) != 1 || len(r.store.failed) != 1 || len(r.store.applied) != 0 {
		t.Errorf("BeginRun %d, FailRun %d, ApplySuccess %d; want 1, 1, 0", len(r.store.begun), len(r.store.failed), len(r.store.applied))
	}
	if got := r.store.failed[0].message; got != want.Message {
		t.Errorf("pesan tersimpan = %q, want %q", got, want.Message)
	}
	if want := []string{"BeginRun", "Invoices", "Invoices", "Invoices", "FailRun"}; !reflect.DeepEqual(r.order.names(), want) {
		t.Errorf("panggilan = %v, want %v", r.order.names(), want)
	}
}

// Kegagalan permanen tidak diulang sama sekali. Mengulang login yang ditolak
// berisiko mengunci akun billing.
func TestReadNeverRetriesPermanentFailures(t *testing.T) {
	permanent := map[string]error{
		"login ditolak":        fmt.Errorf("%w: HTTP 419", ErrLoginFailed),
		"login ditolak polos":  ErrLoginFailed,
		"CSRF tidak ada":       ErrCSRFNotFound,
		"halaman berubah":      fmt.Errorf("%w: baris", ErrUnexpectedPage),
		"terlalu besar":        ErrTooLarge,
		"terlalu banyak alih":  ErrTooManyRedirects,
		"pengalihan lintas":    ErrCrossHostRedirect,
		"sesi hilang":          ErrSessionLost,
		"status tak dikenal":   &UnknownStatusError{Value: "x", Page: 1, Row: 1},
		"HTTP 401":             &StatusError{Code: 401},
		"HTTP 403":             &StatusError{Code: 403},
		"HTTP 419":             &StatusError{Code: 419},
		"HTTP 404":             &StatusError{Code: 404},
		"HTTP 429":             &StatusError{Code: 429},
		"sumber kosong dari s": ErrEmptyInvoiceSource,
		"galat tak dikenal":    errors.New("database mati"),
		"turun drastis":        &InvoiceDropError{Previous: 20, Current: 1},
	}
	for name, perm := range permanent {
		r := newRetryRig(t, []sourceStep{failStep(perm), okStep(sampleInvoices())}, nil)
		out, err := r.run(context.Background())
		if !errors.Is(err, perm) || out.Status != RunFailed {
			t.Errorf("%s: RunOnce = %+v, %v", name, out, err)
		}
		if r.source.callCount() != 1 || out.Attempts != 1 || len(r.clock.recordedWaits()) != 0 {
			t.Errorf("%s: panggilan = %d, percobaan = %d, jeda = %v; kegagalan permanen tidak boleh diulang",
				name, r.source.callCount(), out.Attempts, r.clock.recordedWaits())
		}
		if len(r.store.failed) != 1 || len(r.store.begun) != 1 {
			t.Errorf("%s: BeginRun %d, FailRun %d; want 1, 1", name, len(r.store.begun), len(r.store.failed))
		}
	}
}

// Sumber kosong adalah hasil, bukan galat: ia juga tidak diulang.
func TestReadDoesNotRetryAnEmptyResult(t *testing.T) {
	r := newRetryRig(t, []sourceStep{okStep(nil), okStep(sampleInvoices())}, nil)
	out, err := r.run(context.Background())
	if !errors.Is(err, ErrEmptyInvoiceSource) || out.Attempts != 1 || r.source.callCount() != 1 {
		t.Errorf("RunOnce = %+v, %v; panggilan = %d", out, err, r.source.callCount())
	}
}

func TestReadAttemptsAndDelaysAreConfigurable(t *testing.T) {
	always := failStep(netErr(errors.New("x")))
	cases := []struct {
		name      string
		mutate    func(*SyncerOptions)
		wantCalls int
		wantWaits []time.Duration
	}{
		{"tanpa ulangan", func(o *SyncerOptions) { o.MaxReadAttempts = 1 }, 1, nil},
		{"dua percobaan", func(o *SyncerOptions) { o.MaxReadAttempts = 2 }, 2, durations(15 * time.Second)},
		{"lima percobaan, jeda terakhir dipakai terus", func(o *SyncerOptions) { o.MaxReadAttempts = 5 }, 5,
			durations(15*time.Second, 45*time.Second, 45*time.Second, 45*time.Second)},
		{"jeda sendiri", func(o *SyncerOptions) { o.RetryDelays = durations(time.Second, 2*time.Second) }, 3,
			durations(time.Second, 2*time.Second)},
		{"jeda nol", func(o *SyncerOptions) { o.RetryDelays = durations(0) }, 3, durations(0, 0)},
		{"jeda satu untuk semua", func(o *SyncerOptions) { o.MaxReadAttempts = 4; o.RetryDelays = durations(7 * time.Second) }, 4,
			durations(7*time.Second, 7*time.Second, 7*time.Second)},
	}
	for _, c := range cases {
		r := newRetryRig(t, []sourceStep{always}, c.mutate)
		out, _ := r.run(context.Background())
		if r.source.callCount() != c.wantCalls || out.Attempts != c.wantCalls {
			t.Errorf("%s: panggilan = %d, percobaan = %d, want %d", c.name, r.source.callCount(), out.Attempts, c.wantCalls)
		}
		if got := r.clock.recordedWaits(); !reflect.DeepEqual(got, c.wantWaits) {
			t.Errorf("%s: jeda = %v, want %v", c.name, got, c.wantWaits)
		}
	}
}

// --- Batas waktu sinkron memotong ulangan ----------------------------------------

func TestReadStopsRetryingWhenTheSyncBudgetCannotCoverTheNextDelay(t *testing.T) {
	boom := netErr(errors.New("x"))
	cases := []struct {
		name      string
		timeout   time.Duration
		steps     func(c *retryClock) []sourceStep
		wantCalls int
		wantWaits []time.Duration
		wantOK    bool
	}{
		{
			// Sisa tepat sama dengan jeda: tidak ada waktu untuk percobaannya sendiri.
			"sisa tepat sama dengan jeda pertama", 100 * time.Second,
			func(c *retryClock) []sourceStep {
				return []sourceStep{slowly(c, 85*time.Second, failStep(boom)), okStep(sampleInvoices())}
			}, 1, nil, false,
		},
		{
			"sisa lebih satu nanodetik dari jeda pertama", 100 * time.Second,
			func(c *retryClock) []sourceStep {
				return []sourceStep{slowly(c, 85*time.Second-time.Nanosecond, failStep(boom)), okStep(sampleInvoices())}
			}, 2, durations(15 * time.Second), true,
		},
		{
			"sisa kurang dari jeda pertama", 100 * time.Second,
			func(c *retryClock) []sourceStep {
				return []sourceStep{slowly(c, 99*time.Second, failStep(boom)), okStep(sampleInvoices())}
			}, 1, nil, false,
		},
		{
			"waktu sudah habis sesudah percobaan pertama", 100 * time.Second,
			func(c *retryClock) []sourceStep {
				return []sourceStep{slowly(c, 200*time.Second, failStep(boom)), okStep(sampleInvoices())}
			}, 1, nil, false,
		},
		{
			// Jeda kedua (45 detik) tidak muat: 10 + 15 + 30 = 55 detik terpakai, sisa 45.
			"sisa tepat sama dengan jeda kedua", 100 * time.Second,
			func(c *retryClock) []sourceStep {
				return []sourceStep{slowly(c, 10*time.Second, failStep(boom)), slowly(c, 30*time.Second, failStep(boom)), okStep(sampleInvoices())}
			}, 2, durations(15 * time.Second), false,
		},
		{
			"sisa lebih satu nanodetik dari jeda kedua", 100*time.Second + time.Nanosecond,
			func(c *retryClock) []sourceStep {
				return []sourceStep{slowly(c, 10*time.Second, failStep(boom)), slowly(c, 30*time.Second, failStep(boom)), okStep(sampleInvoices())}
			}, 3, durations(15*time.Second, 45*time.Second), true,
		},
	}
	for _, c := range cases {
		clock := newRetryClock()
		rig := newRetryRigWithClock(t, clock, c.steps(clock), func(o *SyncerOptions) { o.Timeout = c.timeout })
		out, err := rig.run(context.Background())
		if rig.source.callCount() != c.wantCalls {
			t.Errorf("%s: panggilan = %d, want %d", c.name, rig.source.callCount(), c.wantCalls)
		}
		if got := clock.recordedWaits(); !reflect.DeepEqual(got, c.wantWaits) {
			t.Errorf("%s: jeda = %v, want %v", c.name, got, c.wantWaits)
		}
		if c.wantOK {
			if err != nil || out.Status != RunSuccess {
				t.Errorf("%s: RunOnce = %+v, %v; want berhasil", c.name, out, err)
			}
			continue
		}
		// Berhenti dengan galat percobaan terakhir, bukan galat batas waktu.
		if !errors.Is(err, boom) || out.Status != RunFailed || out.Failure.Kind != FailureNetwork {
			t.Errorf("%s: RunOnce = %+v, %v; want gagal dengan galat percobaan terakhir", c.name, out, err)
		}
		if len(rig.store.failed) != 1 || rig.store.failed[0].message != msgNetworkDown {
			t.Errorf("%s: catatan gagal = %+v", c.name, rig.store.failed)
		}
		if !strings.Contains(rig.logs.String(), "sisa waktu sinkron billing tidak cukup") {
			t.Errorf("%s: alasan berhenti tidak dicatat:\n%s", c.name, rig.logs)
		}
	}
}

// newRetryRigWithClock seperti newRetryRig tetapi dengan jam yang sudah dimiliki
// pemanggil (supaya langkah sumber bisa memajukannya).
func newRetryRigWithClock(t *testing.T, clock *retryClock, steps []sourceStep, mutate func(*SyncerOptions)) *retryRig {
	t.Helper()
	r := newRetryRig(t, steps, func(o *SyncerOptions) {
		o.Now, o.After = clock.Now, clock.After
		if mutate != nil {
			mutate(o)
		}
	})
	r.clock = clock
	r.source.clock = clock
	return r
}

// --- Pembatalan -----------------------------------------------------------------

func TestReadCancelStopsTheDelayAtOnce(t *testing.T) {
	r := newRetryRig(t, []sourceStep{failStep(netErr(errors.New("x"))), okStep(sampleInvoices())}, nil)
	r.clock.hold = true // jeda tidak pernah berbunyi sendiri
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	type result struct {
		out RunOutcome
		err error
	}
	done := make(chan result, 1)
	go func() {
		out, err := r.run(ctx)
		done <- result{out, err}
	}()
	select {
	case <-r.clock.entered:
	case <-time.After(watchdog):
		t.Fatal("sinkron tidak sampai ke jeda")
	}
	cancel()
	var res result
	select {
	case res = <-done:
	case <-time.After(watchdog):
		t.Fatal("pembatalan tidak memutus jeda percobaan ulang")
	}

	if !errors.Is(res.err, ErrSyncCanceled) || res.out.Status != RunFailed {
		t.Fatalf("RunOnce = %+v, %v; want ErrSyncCanceled", res.out, res.err)
	}
	if r.source.callCount() != 1 {
		t.Errorf("sumber dibaca %d kali; pembatalan harus mencegah percobaan berikutnya", r.source.callCount())
	}
	if got := r.clock.recordedWaits(); !reflect.DeepEqual(got, durations(15*time.Second)) {
		t.Errorf("jeda = %v", got)
	}
	if len(r.store.failed) != 1 || r.store.failed[0].message != msgCanceled || !r.store.failed[0].ctxAlive {
		t.Errorf("catatan gagal = %+v; want pesan henti, ditulis dengan konteks hidup", r.store.failed)
	}
	if res.out.Failure.Kind != FailureCanceled {
		t.Errorf("Failure = %+v", res.out.Failure)
	}
}

// Pembatalan di tengah percobaan (galat jaringan yang muncul karena konteks mati)
// tidak boleh memulai jeda.
func TestReadCanceledDuringAnAttemptDoesNotWait(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := newRetryRig(t, []sourceStep{
		func(context.Context) ([]Invoice, Stats, error) {
			cancel()
			return nil, Stats{}, netErr(errors.New("koneksi terputus"))
		},
		okStep(sampleInvoices()),
	}, nil)
	out, err := r.run(ctx)
	if !errors.Is(err, ErrSyncCanceled) || out.Status != RunFailed {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if r.source.callCount() != 1 || len(r.clock.recordedWaits()) != 0 {
		t.Errorf("panggilan = %d, jeda = %v", r.source.callCount(), r.clock.recordedWaits())
	}
}

func TestReadSyncTimeoutDuringAnAttemptIsATimeoutNotARetry(t *testing.T) {
	var expire context.CancelCauseFunc
	r := newRetryRig(t, []sourceStep{
		func(ctx context.Context) ([]Invoice, Stats, error) {
			expire(context.DeadlineExceeded) // batas waktu sinkron habis di tengah pembacaan
			return nil, Stats{}, netErr(ctx.Err())
		},
		okStep(sampleInvoices()),
	}, nil)
	r.syncer.derive = func(parent context.Context) (context.Context, context.CancelFunc) {
		ctx, cancel := context.WithCancelCause(parent)
		expire = cancel
		return ctx, func() { cancel(nil) }
	}
	out, err := r.run(context.Background())
	if !errors.Is(err, ErrSyncTimeout) || errors.Is(err, ErrSyncCanceled) || out.Status != RunFailed || r.source.callCount() != 1 {
		t.Fatalf("RunOnce = %+v, %v; panggilan = %d", out, err, r.source.callCount())
	}
	if len(r.clock.recordedWaits()) != 0 {
		t.Errorf("jeda = %v; konteks yang sudah mati tidak boleh menunggu", r.clock.recordedWaits())
	}
	if len(r.store.failed) != 1 || r.store.failed[0].message != msgTimeout || !r.store.failed[0].ctxAlive {
		t.Errorf("catatan gagal = %+v", r.store.failed)
	}
}

// --- Pesan tersimpan --------------------------------------------------------------

// Yang disimpan adalah pesan hasil Classify; teks mentah galat (alamat, URL, kata
// sandi) tidak ikut, sedangkan galat aslinya tetap bisa diperiksa dari nilai kembalian.
func TestFailureRecordHoldsTheClassifiedMessageNotTheRawText(t *testing.T) {
	const raw = "dial tcp 10.0.0.5:8080: GET https://billing.example/internal?token=abc password=hunter2-S3kr3t"
	cases := map[string]error{
		"jaringan":   fmt.Errorf("%s: %w", raw, ErrNetwork),
		"login":      fmt.Errorf("%s: %w", raw, ErrLoginFailed),
		"galat db":   errors.New(raw),
		"HTTP":       &StatusError{Method: "GET", Path: "/internal?token=abc&password=hunter2-S3kr3t", Code: 502},
		"halaman":    fmt.Errorf("%s: %w", raw, ErrUnexpectedPage),
		"sesi":       fmt.Errorf("%s: %w", raw, ErrSessionLost),
		"timeout":    netErr(fmt.Errorf("%s: %w", raw, context.DeadlineExceeded)),
		"ditembus":   fmt.Errorf("%s: %w", raw, fmt.Errorf("%s: %w", raw, ErrNetwork)),
		"sandi saja": errors.New("password=hunter2-S3kr3t"),
	}
	for name, cause := range cases {
		r := newRetryRig(t, []sourceStep{failStep(cause)}, nil)
		out, err := r.run(context.Background())
		if !errors.Is(err, cause) || out.Status != RunFailed {
			t.Errorf("%s: RunOnce = %+v, %v; galat aslinya harus tetap bisa diperiksa", name, out, err)
			continue
		}
		want := Classify(cause)
		if len(r.store.failed) != 1 || r.store.failed[0].message != want.Message {
			t.Errorf("%s: pesan tersimpan = %+v, want %q", name, r.store.failed, want.Message)
			continue
		}
		for _, secret := range []string{"10.0.0.5", "8080", "billing.example", "token=abc", "hunter2", "dial tcp"} {
			if strings.Contains(r.store.failed[0].message, secret) {
				t.Errorf("%s: pesan tersimpan memuat %q: %q", name, secret, r.store.failed[0].message)
			}
		}
		if out.Failure != want {
			t.Errorf("%s: Failure = %+v, want %+v", name, out.Failure, want)
		}
	}
}

func TestEveryFailureKindIsStoredWithItsClassifiedMessage(t *testing.T) {
	for _, c := range classifyCases() {
		r := newRetryRig(t, []sourceStep{failStep(c.err)}, func(o *SyncerOptions) { o.RetryDelays = durations(0) })
		out, _ := r.run(context.Background())
		if out.Status != RunFailed || len(r.store.failed) != 1 {
			t.Errorf("%s: outcome = %+v, FailRun = %+v", c.name, out, r.store.failed)
			continue
		}
		// Pesan akhir adalah hasil Classify atas galat yang dikembalikan RunOnce
		// (yang bisa sudah diterangkan sebagai henti atau batas waktu).
		want := Classify(out.Err)
		if got := r.store.failed[0].message; got != want.Message || out.Failure != want {
			t.Errorf("%s: pesan tersimpan = %q, Failure = %+v, want %+v", c.name, got, out.Failure, want)
		}
	}
}

func TestRetryLogsEachAttemptWithoutSecrets(t *testing.T) {
	r := newRetryRig(t, []sourceStep{
		failStep(&StatusError{Method: "GET", Path: "/invoices", Code: 503}),
		failStep(netErr(context.DeadlineExceeded)),
		failStep(netErr(errors.New("koneksi ditolak"))),
	}, nil)
	if out, _ := r.run(context.Background()); out.Status != RunFailed {
		t.Fatalf("outcome = %+v", out)
	}
	logs := r.logs.String()
	if n := strings.Count(logs, "percobaan membaca tagihan billing gagal"); n != 3 {
		t.Errorf("catatan per percobaan = %d, want 3:\n%s", n, logs)
	}
	for _, want := range []string{
		"percobaan=1", "percobaan=2", "percobaan=3", "dari=3",
		"jenis=server_error", "jenis=timeout", "jenis=network", "sementara=true",
		"percobaan_berikutnya=2", "percobaan_berikutnya=3", "jeda=15s", "jeda=45s",
	} {
		if !strings.Contains(logs, want) {
			t.Errorf("log tidak memuat %q:\n%s", want, logs)
		}
	}
	if n := strings.Count(logs, "membaca tagihan billing diulang"); n != 2 {
		t.Errorf("catatan ulangan = %d, want 2", n)
	}
	// Satu catatan akhir untuk satu sinkron, bukan satu per percobaan.
	if n := strings.Count(logs, "sinkron billing gagal"); n != 1 {
		t.Errorf("catatan sinkron gagal = %d, want 1:\n%s", n, logs)
	}
	if n := strings.Count(logs, "sinkron billing dimulai"); n != 1 {
		t.Errorf("catatan mulai = %d, want 1", n)
	}
}

// --- Penjaga hasil yang menyusut --------------------------------------------------

func TestDrasticDropBoundaries(t *testing.T) {
	cases := []struct {
		previous, current int
		want              bool
	}{
		// Tepat 50% tidak memicu; di bawahnya memicu.
		{10, 5, false}, {10, 4, true}, {20, 10, false}, {20, 9, true}, {100, 50, false}, {100, 49, true},
		{11, 6, false}, {11, 5, true}, {1001, 500, true}, {1001, 501, false},
		// Batas minimum: 10 tagihan ke atas dijaga, di bawahnya tidak.
		{10, 0, true}, {9, 0, false}, {9, 4, false}, {1, 0, false}, {0, 0, false},
		// Tidak menyusut atau bertambah.
		{10, 10, false}, {10, 11, false}, {100, 1000, false},
		// Bilangan besar tidak meluap.
		{1 << 40, 1 << 38, true}, {1 << 40, 1 << 39, false}, {1<<62 - 1, 1<<61 - 1, true},
	}
	for _, c := range cases {
		if got := drasticDrop(c.previous, c.current, DefaultDropMinInvoices, DefaultDropPercent); got != c.want {
			t.Errorf("drasticDrop(%d, %d) = %v, want %v", c.previous, c.current, got, c.want)
		}
	}
	if DefaultDropMinInvoices != 10 || DefaultDropPercent != 50 {
		t.Errorf("bawaan = %d, %d%%; want 10, 50%%", DefaultDropMinInvoices, DefaultDropPercent)
	}
	// Ambang kustom.
	if drasticDrop(4, 3, 2, 75) || !drasticDrop(4, 2, 2, 75) || drasticDrop(1, 0, 2, 75) {
		t.Error("ambang kustom (min 2, 75%) salah")
	}
}

// customers dan tagihan bawaan rig menghasilkan 3 tagihan.
func TestRunOnceRejectsADrasticDropBeforeTouchingData(t *testing.T) {
	r := newRetryRig(t, []sourceStep{okStep(sampleInvoices())}, nil)
	r.store.lastSuccess, r.store.hasLastSuccess = SuccessRun{Invoices: 20, FinishedAt: r.clock.Now()}, true
	out, err := r.run(context.Background())

	const want = "Jumlah tagihan turun drastis (dari 20 ke 3). Periksa tampilan sistem billing. Bila penurunan ini memang benar, atur BILLING_DROP_PERCENT. Status lama dipertahankan."
	var drop *InvoiceDropError
	if !errors.Is(err, ErrAnomalousDrop) || !errors.As(err, &drop) || drop.Previous != 20 || drop.Current != 3 || out.Status != RunFailed {
		t.Fatalf("RunOnce = %+v, %v; want ErrAnomalousDrop 20 -> 3", out, err)
	}
	if out.Failure.Kind != FailureAnomalousDrop || out.Failure.Transient || out.Failure.Message != want {
		t.Errorf("Failure = %+v", out.Failure)
	}
	if len(r.store.failed) != 1 || r.store.failed[0].message != want {
		t.Errorf("catatan gagal = %+v, want %q", r.store.failed, want)
	}
	// Berhenti sebelum membaca pelanggan dan sebelum menerapkan apa pun.
	if got, wantCalls := r.order.names(), []string{"BeginRun", "Invoices", "FailRun"}; !reflect.DeepEqual(got, wantCalls) {
		t.Errorf("panggilan = %v, want %v", got, wantCalls)
	}
	if len(r.store.applied) != 0 || r.store.lastSuccessCalls != 1 {
		t.Errorf("ApplySuccess %d kali, LastSuccess %d kali", len(r.store.applied), r.store.lastSuccessCalls)
	}
	// Bukan kegagalan sementara: tidak diulang.
	if r.source.callCount() != 1 || len(r.clock.recordedWaits()) != 0 {
		t.Errorf("sumber dibaca %d kali, jeda %v; penyusutan tidak boleh diulang", r.source.callCount(), r.clock.recordedWaits())
	}
}

func TestRunOnceDropGuardAtTheExactBoundaries(t *testing.T) {
	cases := []struct {
		name           string
		previous       int
		has            bool
		current        int
		wantRejected   bool
		customOptional func(*SyncerOptions)
	}{
		{"10 ke 5 (tepat 50%) lolos", 10, true, 5, false, nil},
		{"10 ke 4 ditolak", 10, true, 4, true, nil},
		{"6 ke 2 tidak dijaga (di bawah minimum)", 6, true, 2, false, nil},
		{"9 ke 1 tidak dijaga (satu di bawah minimum)", 9, true, 1, false, nil},
		{"10 ke 3 ditolak (minimum tepat)", 10, true, 3, true, nil},
		{"sinkron berhasil pertama tidak dijaga", 100, false, 3, false, nil},
		{"jumlah naik", 3, true, 3, false, nil},
		{"ambang kustom: 75% tepat lolos", 4, true, 3, false, func(o *SyncerOptions) { o.DropGuard = &DropGuard{MinInvoices: 2, Percent: 75} }},
		{"ambang kustom: di bawah 75% ditolak", 4, true, 2, true, func(o *SyncerOptions) { o.DropGuard = &DropGuard{MinInvoices: 2, Percent: 75} }},
		{"ambang kustom: di bawah minimum kustom", 1, true, 1, false, func(o *SyncerOptions) { o.DropGuard = &DropGuard{MinInvoices: 2, Percent: 75} }},
	}
	for _, c := range cases {
		list := make([]Invoice, c.current)
		for i := range list {
			list[i] = Invoice{Name: fmt.Sprintf("p%d", i), Ref: fmt.Sprintf("INV-%d", i), Status: StatusLunas}
		}
		r := newRetryRig(t, []sourceStep{okStep(list)}, c.customOptional)
		r.store.lastSuccess, r.store.hasLastSuccess = SuccessRun{Invoices: c.previous, FinishedAt: r.clock.Now()}, c.has
		out, err := r.run(context.Background())
		if c.wantRejected {
			if !errors.Is(err, ErrAnomalousDrop) || out.Status != RunFailed || len(r.store.applied) != 0 {
				t.Errorf("%s: RunOnce = %+v, %v; want ditolak", c.name, out, err)
			}
			continue
		}
		if err != nil || out.Status != RunSuccess || len(r.store.applied) != 1 {
			t.Errorf("%s: RunOnce = %+v, %v; want lolos", c.name, out, err)
		}
	}
}

// Sumber kosong lebih dulu daripada penjaga penyusutan: pesannya yang khusus.
func TestRunOnceEmptySourceIsReportedBeforeADrop(t *testing.T) {
	r := newRetryRig(t, []sourceStep{okStep(nil)}, nil)
	r.store.lastSuccess, r.store.hasLastSuccess = SuccessRun{Invoices: 50}, true
	out, err := r.run(context.Background())
	if !errors.Is(err, ErrEmptyInvoiceSource) || errors.Is(err, ErrAnomalousDrop) || out.Failure.Kind != FailureEmptySource {
		t.Errorf("RunOnce = %+v, %v", out, err)
	}
	if r.store.lastSuccessCalls != 0 {
		t.Errorf("LastSuccess dipanggil %d kali padahal sumber kosong", r.store.lastSuccessCalls)
	}
}

// Pembanding yang tidak terbaca: tidak diketahui aman tidaknya, jadi tidak diterapkan.
func TestRunOnceFailsWhenTheComparisonCannotBeRead(t *testing.T) {
	r := newRetryRig(t, []sourceStep{okStep(sampleInvoices())}, nil)
	r.store.lastSuccessErr = errors.New("database mati: 10.0.0.9:5432")
	out, err := r.run(context.Background())
	if !errors.Is(err, r.store.lastSuccessErr) || out.Status != RunFailed || len(r.store.applied) != 0 {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if out.Failure.Kind != FailureInternal || len(r.store.failed) != 1 || r.store.failed[0].message != msgInternal {
		t.Errorf("Failure = %+v, FailRun = %+v", out.Failure, r.store.failed)
	}
}

func TestRunOnceFirstEverSuccessHasNothingToCompareWith(t *testing.T) {
	r := newRetryRig(t, []sourceStep{okStep(sampleInvoices())}, nil)
	out, err := r.run(context.Background())
	if err != nil || out.Status != RunSuccess || r.store.lastSuccessCalls != 1 {
		t.Errorf("RunOnce = %+v, %v; LastSuccess %d kali", out, err, r.store.lastSuccessCalls)
	}
}

// --- Opsi -----------------------------------------------------------------------

func TestNewSyncerValidatesAndDefaultsTheFailureOptions(t *testing.T) {
	log := &callLog{}
	src := &fakeSource{log: log}
	st := &fakeRunStore{log: log}
	for name, opts := range map[string]SyncerOptions{
		"percobaan negatif":     {MaxReadAttempts: -1},
		"jeda negatif":          {RetryDelays: durations(time.Second, -time.Second)},
		"minimum nol":           {DropGuard: &DropGuard{MinInvoices: 0, Percent: 50}},
		"minimum negatif":       {DropGuard: &DropGuard{MinInvoices: -1, Percent: 50}},
		"persen negatif":        {DropGuard: &DropGuard{MinInvoices: 10, Percent: -1}},
		"persen lebih dari 100": {DropGuard: &DropGuard{MinInvoices: 10, Percent: 101}},
	} {
		if _, err := NewSyncer(src, st, opts); err == nil {
			t.Errorf("%s seharusnya ditolak", name)
		}
	}
	s, err := NewSyncer(src, st, SyncerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if s.maxAttempts != 3 || !reflect.DeepEqual(s.retryDelays, durations(15*time.Second, 45*time.Second)) ||
		s.after == nil || s.drop != (DropGuard{MinInvoices: 10, Percent: 50}) {
		t.Errorf("bawaan tidak terisi: %+v", s)
	}
	if _, err := NewSyncer(src, st, SyncerOptions{DropGuard: &DropGuard{MinInvoices: 1, Percent: 100}, MaxReadAttempts: 1}); err != nil {
		t.Errorf("nilai batas yang sah ditolak: %v", err)
	}

	// Slice opsi disalin: mengubahnya sesudah NewSyncer tidak mengubah Syncer.
	delays := durations(time.Second)
	s, err = NewSyncer(src, st, SyncerOptions{RetryDelays: delays})
	if err != nil {
		t.Fatal(err)
	}
	delays[0] = time.Hour
	if s.retryDelays[0] != time.Second {
		t.Error("RetryDelays tidak disalin")
	}

	// Pewaktu bawaan benar-benar berbunyi (tanpa menunggu: jeda nol).
	select {
	case <-s.after(0):
	case <-time.After(watchdog):
		t.Error("pewaktu bawaan tidak berbunyi")
	}
}
