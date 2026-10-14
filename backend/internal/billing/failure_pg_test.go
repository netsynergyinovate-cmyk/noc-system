package billing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Tes terpadu penanganan kegagalan dengan PostgreSQL sekali pakai (npm test), Store
// nyata, Scraper nyata, dan server billing tiruan. Yang dibuktikan: untuk SETIAP jenis
// kegagalan, status lama tetap berlaku (billing_status dan customers.billing_status
// identik dengan sebelum sinkron), log berstatus failed dengan pesan hasil Classify,
// dan sinkron berikutnya yang sehat memulihkan. Dilewati tanpa TEST_DATABASE_URL.

// switchSource meneruskan ke sumber yang sedang dipilih tes, sehingga satu Syncer
// bisa membaca dari server sehat, lalu server rusak, lalu server sehat lagi.
// dropTimers membuang semua pewaktu yang belum berbunyi: proses lama yang berhenti
// membawa pewaktunya mati.
func (c *fakeClock) dropTimers() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.timers = nil
}

type switchSource struct {
	mu  sync.Mutex
	cur InvoiceSource
}

func (s *switchSource) use(src InvoiceSource) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cur = src
}

func (s *switchSource) Invoices(ctx context.Context) ([]Invoice, Stats, error) {
	s.mu.Lock()
	cur := s.cur
	s.mu.Unlock()
	return cur.Invoices(ctx)
}

// --- Galat database yang disisipkan ---------------------------------------------

// faultyDB meneruskan semuanya ke DB nyata, kecuali satu titik yang dibuat gagal.
// Teks galat buatannya sengaja memuat alamat dan kata sandi, untuk membuktikan
// bahwa teks galat database tidak sampai ke log sinkron.
type faultyDB struct {
	DB
	// failExec membuat tx.Exec yang SQL-nya memuat teks ini gagal (di dalam transaksi).
	failExec string
	// failQuery dan failQueryRow membuat Query dan QueryRow di luar transaksi gagal.
	failQuery, failQueryRow string
	failBatch, failCommit   bool
}

const faultText = "koneksi database putus: host=10.0.0.5:5432 password=hunter2-S3kr3t"

func (d *faultyDB) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := d.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &faultyTx{Tx: tx, db: d}, nil
}

func (d *faultyDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if d.failQuery != "" && strings.Contains(sql, d.failQuery) {
		return nil, errors.New(faultText)
	}
	return d.DB.Query(ctx, sql, args...)
}

func (d *faultyDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if d.failQueryRow != "" && strings.Contains(sql, d.failQueryRow) {
		return errRow{errors.New(faultText)}
	}
	return d.DB.QueryRow(ctx, sql, args...)
}

type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }

type faultyTx struct {
	pgx.Tx
	db *faultyDB
}

func (t *faultyTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if t.db.failExec != "" && strings.Contains(sql, t.db.failExec) {
		return pgconn.CommandTag{}, errors.New(faultText)
	}
	return t.Tx.Exec(ctx, sql, args...)
}

func (t *faultyTx) SendBatch(ctx context.Context, b *pgx.Batch) pgx.BatchResults {
	if t.db.failBatch {
		return failedBatch{errors.New(faultText)}
	}
	return t.Tx.SendBatch(ctx, b)
}

func (t *faultyTx) Commit(ctx context.Context) error {
	if t.db.failCommit {
		_ = t.Tx.Rollback(ctx)
		return errors.New(faultText)
	}
	return t.Tx.Commit(ctx)
}

type failedBatch struct{ err error }

func (b failedBatch) Exec() (pgconn.CommandTag, error) { return pgconn.CommandTag{}, b.err }
func (b failedBatch) Query() (pgx.Rows, error)         { return nil, b.err }
func (b failedBatch) QueryRow() pgx.Row                { return errRow{b.err} }
func (b failedBatch) Close() error                     { return b.err }

// --- Rig ------------------------------------------------------------------------

type failureRig struct {
	f      *pgFixture
	clock  *retryClock
	source *switchSource
	syncer *Syncer
	logs   *safeBuffer
}

// newFailureRig menyusun Syncer nyata di atas store (Store nyata atau yang disisipi
// galat). Jam dan pewaktunya palsu: jeda percobaan ulang dicatat, tidak ditunggu.
func newFailureRig(t *testing.T, f *pgFixture, store RunStore, source InvoiceSource) *failureRig {
	t.Helper()
	return newFailureRigWithClock(t, f, store, source, newRetryClock())
}

// newFailureRigWithClock seperti newFailureRig dengan jam yang dibagi dengan rig lain,
// supaya dua Syncer di atas database yang sama berjalan di garis waktu yang sama.
func newFailureRigWithClock(t *testing.T, f *pgFixture, store RunStore, source InvoiceSource, clock *retryClock) *failureRig {
	t.Helper()
	rig := &failureRig{f: f, clock: clock, source: &switchSource{cur: source}, logs: &safeBuffer{}}
	logger := slog.New(slog.NewTextHandler(rig.logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	s, err := NewSyncer(rig.source, store, SyncerOptions{Logger: logger, Now: rig.clock.Now, After: rig.clock.After})
	if err != nil {
		t.Fatal(err)
	}
	rig.syncer = s
	return rig
}

func (r *failureRig) run(t *testing.T) (RunOutcome, error) {
	t.Helper()
	return r.syncer.RunOnce(testCtx(t), TriggerSchedule)
}

// next memajukan jam satu jam, seperti slot berikutnya.
func (r *failureRig) next() { r.clock.advance(time.Hour) }

func copyRows(rows []fakeRow) []fakeRow { return append([]fakeRow(nil), rows...) }

// assertUntouchedAndFailed memeriksa jaminan "pakai status lama": data identik
// dengan `before`, tepat satu baris log baru berstatus failed berpesan `message`,
// tidak ada yang masih running, dan tidak ada rahasia di pesan maupun log.
func (r *failureRig) assertUntouchedAndFailed(t *testing.T, name string, out RunOutcome, before string, runsBefore int, message string, secrets []string) {
	t.Helper()
	f := r.f
	if after := f.dataSnapshot(); after != before {
		t.Errorf("%s: data berubah walau sinkron gagal:\n--- sebelum\n%s\n--- sesudah\n%s", name, before, after)
	}
	if out.Status != RunFailed || out.RunID == "" {
		t.Fatalf("%s: outcome = %+v", name, out)
	}
	run := f.run(out.RunID)
	if run.Status != "failed" || run.FinishedAt == nil || run.Error == nil || *run.Error != message ||
		run.Invoices != nil || run.Changed != nil {
		t.Errorf("%s: log sinkron = %+v (error %v); want failed dengan pesan %q", name, run, run.Error, message)
	}
	if n := f.countRuns(`true`); n != runsBefore+1 {
		t.Errorf("%s: baris log = %d, want %d (SATU baris untuk seluruh percobaan)", name, n, runsBefore+1)
	}
	if n := f.countRuns(`status = 'running'`); n != 0 {
		t.Errorf("%s: %d sinkron masih running", name, n)
	}
	for _, view := range []string{message, r.logs.String()} {
		for _, secret := range secrets {
			if secret != "" && strings.Contains(view, secret) {
				t.Errorf("%s: rahasia atau alamat %q muncul di: %s", name, secret, view)
			}
		}
	}
}

func hostParts(rawURL string) []string {
	u, _ := url.Parse(rawURL)
	return []string{u.Host, "127.0.0.1"}
}

// healthyRig menyiapkan pelanggan, server sehat A, dan satu sinkron berhasil.
func healthyRig(t *testing.T) (*pgFixture, map[string]Customer, []fakeRow, *failureRig, *Scraper) {
	t.Helper()
	f := newPGFixture(t)
	cs, rows := seedCustomers(f)
	healthy := newTestScraper(t, newFake(t, copyRows(rows)), nil)
	rig := newFailureRig(t, f, f.store, healthy)
	if out, err := rig.run(t); err != nil || out.Status != RunSuccess {
		t.Fatalf("sinkron awal = %+v, %v", out, err)
	}
	return f, cs, rows, rig, healthy
}

// recover menjalankan sinkron sehat dari server C yang statusnya berbeda dan
// memeriksa bahwa ia diterapkan: pelanggan b berubah dari lunas ke isolir.
func (r *failureRig) recoverAndVerify(t *testing.T, name string, cs map[string]Customer, rows []fakeRow) {
	t.Helper()
	changed := copyRows(rows)
	changed[1].Status = "Isolir" // INV-B: b lunas -> isolir
	r.source.use(newTestScraper(t, newFake(t, changed), nil))
	r.next()
	if got := r.f.customerStatuses()[cs["b"].ID]; got != StatusLunas {
		t.Fatalf("%s: prasyarat: b = %q, want lunas", name, got)
	}
	out, err := r.run(t)
	if err != nil || out.Status != RunSuccess {
		t.Fatalf("%s: sinkron sehat berikutnya = %+v, %v; harus memulihkan", name, out, err)
	}
	if got := r.f.customerStatuses()[cs["b"].ID]; got != StatusIsolir {
		t.Errorf("%s: sesudah pulih b = %q, want isolir", name, got)
	}
	if run := r.f.run(out.RunID); run.Status != "success" || run.Error != nil {
		t.Errorf("%s: log pemulihan = %+v", name, run)
	}
}

// --- Setiap kegagalan sumber ------------------------------------------------------

func TestEverySourceFailureKeepsTheOldStatuses(t *testing.T) {
	for _, c := range scraperFailureCases() {
		if c.ctx != nil {
			continue // pembatalan sebelum mulai tidak membuat baris; dicakup tes lain
		}
		t.Run(c.name, func(t *testing.T) {
			f, cs, rows, rig, _ := healthyRig(t)
			rig.next()
			before, runsBefore := f.dataSnapshot(), f.countRuns(`true`)

			// Server rusak B dengan tagihan yang sama.
			broken := newFakeWith(t, copyRows(rows), c.tls)
			mutate, opts := c.setup(broken)
			rig.source.use(newTestScraper(t, broken, mutate, opts...))
			rig.clock.resetWaits()

			out, err := rig.run(t)
			if err == nil || out.Status != RunFailed {
				t.Fatalf("RunOnce = %+v, %v; seharusnya gagal", out, err)
			}
			wantAttempts, wantWaits := 1, []time.Duration(nil)
			if c.transient {
				wantAttempts, wantWaits = 3, durations(15*time.Second, 45*time.Second)
			}
			if out.Failure.Kind != c.kind || out.Failure.Transient != c.transient || out.Failure.Message != c.message {
				t.Errorf("Failure = %+v; want %s, sementara %v, %q", out.Failure, c.kind, c.transient, c.message)
			}
			if out.Attempts != wantAttempts || !reflect.DeepEqual(rig.clock.recordedWaits(), wantWaits) {
				t.Errorf("percobaan = %d, jeda = %v; want %d dan %v", out.Attempts, rig.clock.recordedWaits(), wantAttempts, wantWaits)
			}
			secrets := append(append(broken.secrets(), hostParts(broken.srv.URL)...), "salah-"+fakePass, "token=def", "sid=abc", f.prefix)
			rig.assertUntouchedAndFailed(t, c.name, out, before, runsBefore, c.message, secrets)

			// Sinkron yang diulang tampak sebagai satu baris yang membentang selama jeda-jedanya.
			if c.transient {
				run := f.run(out.RunID)
				if got := run.FinishedAt.Sub(run.StartedAt); got != 60*time.Second {
					t.Errorf("baris log membentang %s, want 60s (15s + 45s jeda)", got)
				}
			}
			rig.recoverAndVerify(t, c.name, cs, rows)
		})
	}
}

// Sumber kosong (halaman 1 tanpa tagihan yang sah) tidak menghapus status siapa pun.
func TestEmptySourceKeepsTheOldStatuses(t *testing.T) {
	f, cs, rows, rig, _ := healthyRig(t)
	rig.next()
	before, runsBefore := f.dataSnapshot(), f.countRuns(`true`)

	empty := newFake(t, nil)
	empty.emptyMarker = true
	rig.source.use(newTestScraper(t, empty, func(c *Config) {
		c.Profile = DefaultProfile()
		c.Profile.EmptySelector = ".empty-state"
	}))
	out, err := rig.run(t)
	if !errors.Is(err, ErrEmptyInvoiceSource) {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if out.Failure.Kind != FailureEmptySource || out.Attempts != 1 || len(rig.clock.recordedWaits()) != 0 {
		t.Errorf("Failure = %+v, percobaan = %d, jeda = %v", out.Failure, out.Attempts, rig.clock.recordedWaits())
	}
	rig.assertUntouchedAndFailed(t, "sumber kosong", out, before, runsBefore,
		"Sumber billing tidak mengembalikan satu pun tagihan; status lama dipertahankan.", []string{f.prefix})
	rig.recoverAndVerify(t, "sumber kosong", cs, rows)
}

// --- Gagal sementara lalu berhasil dalam satu sinkron --------------------------------

// Server gagal di halaman kedua pada dua percobaan pertama, lalu sehat: SATU baris
// success, tiga login (tiap percobaan mulai dari sesi baru), hasilnya diterapkan.
func TestTransientFailuresThenSuccessIsOneSuccessRowWithFreshLoginsEachAttempt(t *testing.T) {
	f := newPGFixture(t)
	cs, rows := seedCustomers(f)
	fake := newFake(t, copyRows(rows))
	var mu sync.Mutex
	failuresLeft := 2
	fake.override = func(w http.ResponseWriter, r *http.Request) {
		fake.mu.Lock()
		body := fake.invoicesHTML(r)
		fake.mu.Unlock()
		mu.Lock()
		fail := r.URL.Query().Get("page") == "2" && failuresLeft > 0
		if fail {
			failuresLeft--
		}
		mu.Unlock()
		if fail {
			http.Error(w, "gangguan", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, body)
	}
	rig := newFailureRig(t, f, f.store, newTestScraper(t, fake, nil))

	out, err := rig.run(t)
	if err != nil || out.Status != RunSuccess || out.Attempts != 3 {
		t.Fatalf("RunOnce = %+v, %v; want berhasil pada percobaan ketiga", out, err)
	}
	if got := rig.clock.recordedWaits(); !reflect.DeepEqual(got, durations(15*time.Second, 45*time.Second)) {
		t.Errorf("jeda = %v", got)
	}
	if c := fake.snapshot(); c.loginPosts != 3 || c.loginGets != 3 {
		t.Errorf("login POST %d, GET %d; want 3 dan 3 (tiap percobaan login dari awal)", c.loginPosts, c.loginGets)
	}
	if n := f.countRuns(`true`); n != 1 {
		t.Errorf("baris log = %d, want 1", n)
	}
	run := f.run(out.RunID)
	if run.Status != "success" || run.Error != nil || *run.Invoices != 5 || run.FinishedAt.Sub(run.StartedAt) != 60*time.Second {
		t.Errorf("log sinkron = %+v", run)
	}
	if got := f.customerStatuses(); got[cs["a"].ID] != StatusIsolir || got[cs["c"].ID] != StatusLunas {
		t.Errorf("hasil percobaan terakhir tidak diterapkan: %v", got)
	}
	if strings.Contains(rig.logs.String(), fakePass) {
		t.Errorf("log memuat kata sandi:\n%s", rig.logs)
	}
}

// --- Galat database di tengah penerapan ----------------------------------------------

func TestDatabaseFailureMidApplyKeepsTheOldStatuses(t *testing.T) {
	faults := []struct {
		name string
		set  func(d *faultyDB)
	}{
		{"menutup sinkron", func(d *faultyDB) { d.failExec = "UPDATE billing_sync_runs" }},
		{"menulis status tagihan", func(d *faultyDB) { d.failExec = "INSERT INTO billing_status" }},
		{"membuang status pelanggan tanpa tagihan", func(d *faultyDB) { d.failExec = "DELETE FROM billing_status" }},
		{"memperbarui status pelanggan", func(d *faultyDB) { d.failExec = "UPDATE customers" }},
		{"menyimpan ketidakcocokan", func(d *faultyDB) { d.failBatch = true }},
		{"commit", func(d *faultyDB) { d.failCommit = true }},
		{"membaca pelanggan", func(d *faultyDB) { d.failQuery = "FROM customers" }},
		{"membaca pembanding jumlah tagihan", func(d *faultyDB) { d.failQueryRow = "invoices_total, finished_at" }},
	}
	for _, fault := range faults {
		t.Run(fault.name, func(t *testing.T) {
			f, cs, rows, healthy, scraper := healthyRig(t)
			// Syncer kedua membaca dari server yang sama tetapi menyimpan lewat database
			// yang disisipi galat; Syncer yang sehat dipakai memulihkan.
			faulty := &faultyDB{DB: f.pool}
			broken := newFailureRigWithClock(t, f, NewStore(faulty), scraper, healthy.clock)
			healthy.next()
			before, runsBefore := f.dataSnapshot(), f.countRuns(`true`)

			fault.set(faulty)
			out, err := broken.run(t)
			if err == nil || out.Status != RunFailed {
				t.Fatalf("RunOnce = %+v, %v; seharusnya gagal", out, err)
			}
			// Teks mentah galat database (alamat, kata sandi) tetap ada di galat yang
			// dikembalikan dan di log server, tetapi tidak di log sinkron.
			if !strings.Contains(err.Error(), "10.0.0.5") {
				t.Errorf("galat aslinya harus tetap bisa diperiksa: %v", err)
			}
			if out.Failure.Kind != FailureInternal || out.Failure.Message != msgInternal || out.Attempts != 1 {
				t.Errorf("Failure = %+v, percobaan = %d", out.Failure, out.Attempts)
			}
			broken.assertUntouchedAndFailed(t, fault.name, out, before, runsBefore, msgInternal, nil)
			if run := f.run(out.RunID); strings.Contains(*run.Error, "10.0.0.5") || strings.Contains(*run.Error, "hunter2") {
				t.Errorf("log sinkron memuat teks galat database: %q", *run.Error)
			}

			healthy.recoverAndVerify(t, fault.name, cs, rows)
		})
	}
}

// --- Penjaga hasil yang menyusut ------------------------------------------------------

func TestDrasticDropKeepsTheOldStatusesInTheRealDatabase(t *testing.T) {
	f := newPGFixture(t)
	var rows []fakeRow
	for i := 0; i < 12; i++ {
		c := f.addCustomer(fmt.Sprintf("p%02d", i), StatusIsolir)
		rows = append(rows, fakeRow{Name: c.PPPoE, Ref: fmt.Sprintf("INV-%02d", i), Status: "Lunas"})
	}
	scraperFor := func(n int) *Scraper { return newTestScraper(t, newFake(t, copyRows(rows[:n])), nil) }
	rig := newFailureRig(t, f, f.store, scraperFor(12))

	if out, err := rig.run(t); err != nil || out.Status != RunSuccess || out.Counts.Invoices != 12 {
		t.Fatalf("sinkron awal = %+v, %v", out, err)
	}
	last, ok, err := f.store.LastSuccess(f.ctx)
	if err != nil || !ok || last.Invoices != 12 {
		t.Fatalf("LastSuccess = %+v, %v, %v", last, ok, err)
	}
	for _, c := range f.mine() {
		if c.Status != StatusLunas {
			t.Fatalf("prasyarat: %s = %q", c.PPPoE, c.Status)
		}
	}

	// Halaman terpotong: hanya 5 dari 12 tagihan yang terbaca. Tanpa penjaga, 7
	// pelanggan akan kehilangan baris billing_status mereka.
	rig.next()
	before, runsBefore := f.dataSnapshot(), f.countRuns(`true`)
	rig.source.use(scraperFor(5))
	out, err := rig.run(t)
	const want = "Jumlah tagihan turun drastis (dari 12 ke 5). Periksa tampilan sistem billing. Bila penurunan ini memang benar, atur BILLING_DROP_PERCENT. Status lama dipertahankan."
	if !errors.Is(err, ErrAnomalousDrop) || out.Failure.Kind != FailureAnomalousDrop || out.Attempts != 1 {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	rig.assertUntouchedAndFailed(t, "turun drastis", out, before, runsBefore, want, []string{f.prefix})
	if got := f.query(`SELECT count(*) FROM billing_status WHERE customer_id = ANY($1::text[]::uuid[])`, f.ids()); got[0] != "12" {
		t.Errorf("baris billing_status = %v, want 12", got)
	}
	// Kegagalan tidak menggeser pembanding.
	if last, _, _ := f.store.LastSuccess(f.ctx); last.Invoices != 12 {
		t.Errorf("LastSuccess sesudah gagal = %+v", last)
	}

	// Tepat 50% (6 dari 12) lolos: itu perubahan yang sah.
	rig.next()
	rig.source.use(scraperFor(6))
	if out, err := rig.run(t); err != nil || out.Status != RunSuccess || out.Counts.Invoices != 6 {
		t.Fatalf("6 dari 12 = %+v, %v; harus lolos", out, err)
	}
	if got := f.query(`SELECT count(*) FROM billing_status WHERE customer_id = ANY($1::text[]::uuid[])`, f.ids()); got[0] != "6" {
		t.Errorf("baris billing_status = %v, want 6", got)
	}
}

// --- Store: pembaca ringan --------------------------------------------------------------

func TestStoreLastSuccessReturnsTheLatestSuccessSummary(t *testing.T) {
	f := newPGFixture(t)
	ctx := f.ctx
	if _, ok, err := f.store.LastSuccess(ctx); err != nil || ok {
		t.Fatalf("tanpa riwayat: ok = %v, err = %v", ok, err)
	}

	// Gagal dan berjalan tidak dihitung.
	failed, _ := f.store.BeginRun(ctx, TriggerSchedule, t0)
	if err := f.store.FailRun(ctx, failed, errors.New("gagal"), t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	running, _ := f.store.BeginRun(ctx, TriggerSchedule, t0.Add(time.Minute))
	if _, ok, _ := f.store.LastSuccess(ctx); ok {
		t.Fatal("sinkron gagal dan berjalan tidak boleh dihitung berhasil")
	}

	a := f.addCustomer("a", StatusLunas)
	first := MatchInvoices([]Invoice{{Name: a.PPPoE, Ref: "X", Status: StatusLunas}, {Name: "tak-dikenal-" + f.prefix, Status: StatusLunas}}, []Customer{a})
	firstAt := t0.Add(2 * time.Minute)
	if err := f.store.ApplySuccess(ctx, running, first, firstAt); err != nil {
		t.Fatal(err)
	}
	got, ok, err := f.store.LastSuccess(ctx)
	if err != nil || !ok || got.Invoices != 2 || !got.FinishedAt.Equal(firstAt) || got.FinishedAt.Location() != time.UTC {
		t.Errorf("LastSuccess = %+v (%s), %v, %v; want 2 tagihan selesai %s UTC", got, got.FinishedAt.Location(), ok, err, firstAt)
	}

	// Yang berhasil lebih baru menggantikan; yang gagal lebih baru tidak menutupinya.
	id, _ := f.store.BeginRun(ctx, TriggerSchedule, t0.Add(time.Hour))
	second := MatchInvoices([]Invoice{{Name: a.PPPoE, Status: StatusIsolir}}, []Customer{a})
	if err := f.store.ApplySuccess(ctx, id, second, t0.Add(time.Hour+time.Second)); err != nil {
		t.Fatal(err)
	}
	later, _ := f.store.BeginRun(ctx, TriggerSchedule, t0.Add(2*time.Hour))
	if err := f.store.FailRun(ctx, later, errors.New("gagal lagi"), t0.Add(2*time.Hour+time.Second)); err != nil {
		t.Fatal(err)
	}
	if got, ok, _ := f.store.LastSuccess(ctx); !ok || got.Invoices != 1 || !got.FinishedAt.Equal(t0.Add(time.Hour+time.Second)) {
		t.Errorf("LastSuccess = %+v", got)
	}
	// LastSuccessAt memberi waktu yang sama.
	if at, ok, _ := f.store.LastSuccessAt(ctx); !ok || !at.Equal(t0.Add(time.Hour+time.Second)) {
		t.Errorf("LastSuccessAt = %s", at)
	}

	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, _, err := f.store.LastSuccess(cancelled); err == nil {
		t.Error("konteks yang dibatalkan seharusnya menghasilkan galat")
	}
}

func TestStoreRecentFinishedRuns(t *testing.T) {
	f := newPGFixture(t)
	ctx := f.ctx
	if runs, err := f.store.RecentFinishedRuns(ctx, 3); err != nil || len(runs) != 0 {
		t.Fatalf("tanpa riwayat: %v, %v", runs, err)
	}
	for _, bad := range []int{0, -1} {
		if _, err := f.store.RecentFinishedRuns(ctx, bad); err == nil {
			t.Errorf("limit %d seharusnya ditolak", bad)
		}
	}

	// Lima sinkron selesai berselang-seling, lalu satu yang masih berjalan.
	type spec struct {
		ok  bool
		msg string
	}
	specs := []spec{{false, msgLoginRejected}, {true, ""}, {false, msgNetworkDown}, {false, msgLoginNoCSRF}, {true, ""}}
	for i, sp := range specs {
		started := t0.Add(time.Duration(i) * time.Hour)
		id, err := f.store.BeginRun(ctx, TriggerSchedule, started)
		if err != nil {
			t.Fatal(err)
		}
		finished := started.Add(5 * time.Second)
		if sp.ok {
			err = f.store.ApplySuccess(ctx, id, MatchInvoices(nil, nil), finished)
		} else {
			err = f.store.FailRun(ctx, id, errors.New(sp.msg), finished)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.store.BeginRun(ctx, TriggerSchedule, t0.Add(10*time.Hour)); err != nil {
		t.Fatal(err)
	}

	runs, err := f.store.RecentFinishedRuns(ctx, 3)
	if err != nil || len(runs) != 3 {
		t.Fatalf("RecentFinishedRuns(3) = %v, %v", runs, err)
	}
	// Terbaru dulu; yang masih running tidak ikut.
	for i, wantIdx := range []int{4, 3, 2} {
		r := runs[i]
		started := t0.Add(time.Duration(wantIdx) * time.Hour)
		sp := specs[wantIdx]
		if r.Success != sp.ok || r.Message != sp.msg || !r.StartedAt.Equal(started) || !r.FinishedAt.Equal(started.Add(5*time.Second)) ||
			r.StartedAt.Location() != time.UTC || r.FinishedAt.Location() != time.UTC {
			t.Errorf("sinkron %d = %+v, want sinkron ke-%d %+v mulai %s", i, r, wantIdx, sp, started)
		}
	}
	all, err := f.store.RecentFinishedRuns(ctx, 100)
	if err != nil || len(all) != 5 {
		t.Errorf("RecentFinishedRuns(100) = %d sinkron, %v; want 5 (yang running tidak ikut)", len(all), err)
	}

	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := f.store.RecentFinishedRuns(cancelled, 3); err == nil {
		t.Error("konteks yang dibatalkan seharusnya menghasilkan galat")
	}
}

// --- Perlindungan login beruntun dengan Syncer, Store, dan Scraper nyata ------------------

// Kata sandi salah: tiga percobaan berturut-turut (susulan, 10:05, 11:05), lalu server
// billing tidak dihubungi sama sekali sampai 6 jam kemudian, juga sesudah backend
// dimulai ulang. Slot yang dilewati tidak menulis baris log gagal.
func TestWrongPasswordIsTriedThreeTimesThenOnlyEverySixHoursAcrossRestarts(t *testing.T) {
	f := newPGFixture(t)
	_, rows := seedCustomers(f)
	fake := newFake(t, copyRows(rows))
	bad := newTestScraper(t, fake, func(c *Config) { c.Password = "salah-" + fakePass })
	good := newTestScraper(t, fake, nil)
	source := &switchSource{cur: bad}

	now := utc(2026, 5, 1, 10, 0, 30, 0)
	clock := newFakeClock(now)
	logs := &safeBuffer{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	syncer, err := NewSyncer(source, f.store, SyncerOptions{Logger: logger, Now: clock.Now})
	if err != nil {
		t.Fatal(err)
	}
	// Penjadwal diberi Runner pembungkus supaya tes tahu kapan sinkron selesai.
	runner := &notifyRunner{inner: syncer, done: make(chan RunOutcome, 20)}
	start := func() (context.CancelFunc, chan struct{}) {
		sched, err := NewScheduler(SchedulerOptions{Syncer: runner, Store: f.store, Minute: 5, Clock: clock, Logger: logger})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() { _ = sched.Run(ctx); close(done) }()
		t.Cleanup(cancel)
		return cancel, done
	}
	stop := func(cancel context.CancelFunc, done chan struct{}) {
		cancel()
		select {
		case <-done:
		case <-time.After(watchdog):
			t.Fatal("penjadwal tidak berhenti")
		}
	}
	// tick menggerakkan jam ke `at` dan menunggu sinkron yang dipicunya selesai.
	tick := func(at time.Time) RunOutcome {
		t.Helper()
		if got := clock.waitTimer(t); !got.Equal(at) {
			t.Fatalf("penjadwal menunggu sampai %s, want %s", got, at)
		}
		clock.Set(at)
		select {
		case out := <-runner.done:
			return out
		case <-time.After(watchdog):
			t.Fatalf("sinkron pada %s tidak berjalan", at)
			return RunOutcome{}
		}
	}
	// skip menggerakkan jam ke `at` dan memastikan tidak ada sinkron yang berjalan.
	skip := func(at, wantNext time.Time) {
		t.Helper()
		if got := clock.waitTimer(t); !got.Equal(at) {
			t.Fatalf("penjadwal menunggu sampai %s, want %s", got, at)
		}
		clock.Set(at)
		if got := clock.waitTimer(t); !got.Equal(wantNext) {
			t.Fatalf("sesudah %s penjadwal menunggu sampai %s, want %s", at, got, wantNext)
		}
		select {
		case out := <-runner.done:
			t.Fatalf("sinkron berjalan pada %s padahal harus dilewati: %+v", at, out)
		default:
		}
	}
	skipLogs := func() int {
		return strings.Count(logs.String(), "sinkron billing dilewati: login ditolak berulang kali")
	}

	// Tiga percobaan pertama, semuanya ditolak. Tidak diulang dalam satu sinkron.
	cancel, done := start()
	if got := clock.waitTimer(t); !got.Equal(now.Add(DefaultCatchUpDelay)) {
		t.Fatalf("susulan pada %s", got)
	}
	for _, at := range []time.Time{now.Add(DefaultCatchUpDelay), hm(10, 5), hm(11, 5)} {
		out := tick(at)
		if out.Status != RunFailed || out.Failure.Kind != FailureCredentials || out.Attempts != 1 {
			t.Fatalf("percobaan pada %s = %+v", at, out)
		}
	}
	if n := f.countRuns(`true`); n != 3 {
		t.Fatalf("baris log = %d, want 3", n)
	}
	// Satu POST login per percobaan (login yang ditolak tidak diulang); tiap penolakan
	// dialihkan ke halaman login, jadi GET-nya dua per percobaan.
	afterThree := fake.snapshot()
	if afterThree.loginPosts != 3 || afterThree.loginGets != 6 {
		t.Fatalf("login POST %d, GET %d; want 3 dan 6", afterThree.loginPosts, afterThree.loginGets)
	}

	// 12:05-16:05 dilewati: tidak ada permintaan ke billing, tidak ada baris log baru.
	for h := 12; h <= 16; h++ {
		skip(hm(h, 5), hm(h+1, 5))
	}
	if n := skipLogs(); n != 5 {
		t.Errorf("catatan 'dilewati' = %d, want 5 (satu per slot)", n)
	}
	if n := f.countRuns(`true`); n != 3 {
		t.Errorf("baris log = %d sesudah slot dilewati, want 3", n)
	}
	if got := fake.snapshot(); got != afterThree {
		t.Errorf("billing dihubungi saat perlindungan aktif: %+v, sebelumnya %+v", got, afterThree)
	}

	// Backend dimulai ulang pukul 16:30: penjadwal baru menghitung ulang dari log.
	// Belum pernah ada sinkron berhasil, jadi ia ingin menyusul; perlindungan menahannya.
	stop(cancel, done)
	clock.dropTimers() // pewaktu penjadwal lama ikut mati bersama prosesnya
	clock.Set(hm(16, 30))
	cancel, done = start()
	before := skipLogs()
	skip(hm(16, 30).Add(DefaultCatchUpDelay), hm(17, 5))
	if n := skipLogs(); n != before+1 {
		t.Errorf("susulan yang ditahan dicatat %d kali, want 1", n-before)
	}
	if n, got := f.countRuns(`true`), fake.snapshot(); n != 3 || got != afterThree {
		t.Errorf("sesudah mulai ulang: baris log %d, billing %+v; perlindungan hilang", n, got)
	}

	// Kata sandi diperbaiki. Percobaan yang diizinkan tiba pukul 17:05 (6 jam sesudah 11:05).
	source.use(good)
	if out := tick(hm(17, 5)); out.Status != RunSuccess || out.Err != nil {
		t.Fatalf("percobaan 6 jam kemudian = %+v; kata sandi sudah benar", out)
	}
	// Sesudah berhasil jadwal kembali tiap jam.
	if out := tick(hm(18, 5)); out.Status != RunSuccess {
		t.Errorf("slot 18:05 = %+v", out)
	}
	stop(cancel, done)

	// Log sinkron: tiga gagal dengan pesan login, dua berhasil.
	got := f.query(`SELECT status || '|' || coalesce(error_message, '') FROM billing_sync_runs ORDER BY started_at`)
	want := []string{"failed|" + msgLoginRejected, "failed|" + msgLoginRejected, "failed|" + msgLoginRejected, "success|", "success|"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("log sinkron = %q\nwant %q", got, want)
	}
	for _, secret := range append(fake.secrets(), "salah-"+fakePass) {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("log memuat rahasia %q", secret)
		}
	}
}
