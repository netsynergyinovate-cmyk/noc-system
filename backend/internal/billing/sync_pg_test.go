package billing

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// Tes terpadu Syncer dan Scheduler NYATA dengan Store nyata (PostgreSQL sekali
// pakai lewat `npm test`) dan Scraper nyata yang membaca server billing tiruan
// (httptest, mock_test.go). Dilewati tanpa TEST_DATABASE_URL.
//
// Store.LoadCustomers membaca SEMUA pelanggan, bukan hanya milik tes ini, jadi
// pemeriksaan hanya menyangkut pelanggan buatan tes (dan hitungan sisi tagihan),
// tidak jumlah pelanggan tanpa tagihan.

type pgSyncRig struct {
	f       *pgFixture
	fake    *fakeBilling
	scraper *Scraper
	syncer  *Syncer
	logs    *safeBuffer
}

func newPGSyncRig(t *testing.T, f *pgFixture, fake *fakeBilling, mutateCfg func(*Config), mutateOpts func(*SyncerOptions)) *pgSyncRig {
	t.Helper()
	rig := &pgSyncRig{f: f, fake: fake, logs: &safeBuffer{}}
	logger := slog.New(slog.NewTextHandler(rig.logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	rig.scraper = newTestScraper(t, fake, mutateCfg, WithLogger(logger))
	opts := SyncerOptions{Logger: logger, Now: newSteppingClock(t0).Now}
	if mutateOpts != nil {
		mutateOpts(&opts)
	}
	s, err := NewSyncer(rig.scraper, f.store, opts)
	if err != nil {
		t.Fatal(err)
	}
	rig.syncer = s
	return rig
}

func (r *pgSyncRig) run(t *testing.T) (RunOutcome, error) {
	t.Helper()
	return r.syncer.RunOnce(testCtx(t), TriggerSchedule)
}

// assertNoSecrets: tidak ada kata sandi, token CSRF, id sesi, atau nama pelanggan
// (yang memuat awalan unik tes ini) di teks s.
func (r *pgSyncRig) assertNoSecrets(t *testing.T, where, s string) {
	t.Helper()
	for _, secret := range append(r.fake.secrets(), r.f.prefix) {
		if secret != "" && strings.Contains(s, secret) {
			t.Errorf("%s memuat rahasia atau isi tagihan %q:\n%s", where, secret, s)
		}
	}
}

// seedCustomers membuat pelanggan tes beserta tagihannya:
//
//	a lunas  -> tagihan Isolir  (berubah ke isolir)
//	b lunas  -> tagihan Lunas   (tetap)
//	c isolir -> tagihan Lunas   (berubah ke lunas)
//	d lunas  -> tanpa tagihan   (dibiarkan)
//	e isolir -> tagihan "NAMA BESAR" Lunas (cocok setelah dirapikan, berubah ke lunas)
//	satu tagihan yang tidak dimiliki siapa pun
func seedCustomers(f *pgFixture) (map[string]Customer, []fakeRow) {
	cs := map[string]Customer{
		"a": f.addCustomer("a", StatusLunas),
		"b": f.addCustomer("b", StatusLunas),
		"c": f.addCustomer("c", StatusIsolir),
		"d": f.addCustomer("d", StatusLunas),
		"e": f.addCustomer("e", StatusIsolir),
	}
	rows := []fakeRow{
		{Name: cs["a"].PPPoE, Ref: "INV-A", Status: "Isolir"},
		{Name: cs["b"].PPPoE, Ref: "INV-B", Status: "Lunas"},
		{Name: cs["c"].PPPoE, Ref: "INV-C", Status: "Lunas"},
		{Name: strings.ToUpper(cs["e"].PPPoE), Ref: "INV-E", Status: "Lunas"},
		{Name: f.name("tidak-dikenal"), Ref: "INV-X", Status: "Lunas"},
	}
	return cs, rows
}

func TestSyncerFullRunAgainstRealStoreAndScraper(t *testing.T) {
	f := newPGFixture(t)
	cs, rows := seedCustomers(f)
	fake := newFake(t, rows)
	rig := newPGSyncRig(t, f, fake, nil, nil)

	out, err := rig.run(t)
	if err != nil || out.Status != RunSuccess {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}

	// Log sinkron.
	run := f.run(out.RunID)
	if run.Status != "success" || run.Trigger != "schedule" || run.Error != nil || run.FinishedAt == nil {
		t.Fatalf("log sinkron = %+v", run)
	}
	if *run.Invoices != 5 || *run.Exact != 3 || *run.Normalized != 1 || *run.Unknown != 1 ||
		*run.Duplicate != 0 || *run.Ambiguous != 0 || *run.Changed != 3 {
		t.Errorf("hitungan log: tagihan %d, persis %d, dirapikan %d, tak dikenal %d, kembar %d, ambigu %d, berubah %d",
			*run.Invoices, *run.Exact, *run.Normalized, *run.Unknown, *run.Duplicate, *run.Ambiguous, *run.Changed)
	}
	if out.Counts.Invoices != 5 || out.Counts.StatusesChanged != 3 {
		t.Errorf("hitungan hasil = %+v", out.Counts)
	}
	if out.Stats.Pages == 0 || out.Stats.Rows != 5 {
		t.Errorf("Stats = %+v", out.Stats)
	}

	// customers.billing_status.
	got := f.customerStatuses()
	want := map[string]Status{
		cs["a"].ID: StatusIsolir, cs["b"].ID: StatusLunas, cs["c"].ID: StatusLunas,
		cs["d"].ID: StatusLunas, cs["e"].ID: StatusLunas,
	}
	for id, status := range want {
		if got[id] != status {
			t.Errorf("customers.billing_status %s = %q, want %q", id, got[id], status)
		}
	}

	// billing_status: satu baris per tagihan yang cocok, tidak ada untuk d.
	rowsFor := map[string]string{}
	for _, line := range f.query(`SELECT customer_id::text, status || '/' || coalesce(match_kind, '~') || '/' || coalesce(invoice_ref, '~')
		FROM billing_status WHERE customer_id = ANY($1::text[]::uuid[]) ORDER BY customer_id`, f.ids()) {
		rowsFor[line[:36]] = line[36:]
	}
	wantRows := map[string]string{
		cs["a"].ID: "isolir/exact/INV-A", cs["b"].ID: "lunas/exact/INV-B", cs["c"].ID: "lunas/exact/INV-C",
		cs["e"].ID: "lunas/normalized/INV-E",
	}
	if len(rowsFor) != len(wantRows) {
		t.Errorf("baris billing_status = %v, want %v", rowsFor, wantRows)
	}
	for id, w := range wantRows {
		if rowsFor[id] != w {
			t.Errorf("billing_status %s = %q, want %q", id, rowsFor[id], w)
		}
	}

	// Tagihan tanpa pemilik tercatat sebagai ketidakcocokan sinkron ini.
	mism := f.query(`SELECT reason || '/' || invoice_name FROM billing_mismatches WHERE run_id = $1::uuid`, out.RunID)
	if len(mism) != 1 || mism[0] != "unknown/"+f.name("tidak-dikenal") {
		t.Errorf("ketidakcocokan = %v", mism)
	}

	logs := rig.logs.String()
	for _, want := range []string{"sinkron billing dimulai", "sinkron billing selesai", "tagihan=5", "berubah=3"} {
		if !strings.Contains(logs, want) {
			t.Errorf("log tidak memuat %q:\n%s", want, logs)
		}
	}
	rig.assertNoSecrets(t, "log", logs)
}

// Sinkron kedua dengan data yang sama tidak mengubah status siapa pun lagi.
func TestSyncerRepeatedRunChangesNothingNew(t *testing.T) {
	f := newPGFixture(t)
	_, rows := seedCustomers(f)
	rig := newPGSyncRig(t, f, newFake(t, rows), nil, nil)
	if out, err := rig.run(t); err != nil || out.Status != RunSuccess {
		t.Fatalf("sinkron pertama = %+v, %v", out, err)
	}
	before := f.xmins()
	out, err := rig.run(t)
	if err != nil || out.Status != RunSuccess || out.Counts.StatusesChanged != 0 {
		t.Fatalf("sinkron kedua = %+v, %v", out, err)
	}
	after := f.xmins()
	for id, x := range before {
		if after[id] != x {
			t.Errorf("baris pelanggan %s ditulis ulang oleh sinkron yang tidak mengubah apa pun", id)
		}
	}
}

func TestSyncerEmptySourceChangesNothing(t *testing.T) {
	f := newPGFixture(t)
	_, rows := seedCustomers(f)
	fake := newFake(t, rows)
	fake.emptyMarker = true
	rig := newPGSyncRig(t, f, fake, func(c *Config) {
		c.Profile = DefaultProfile()
		c.Profile.EmptySelector = ".empty-state"
	}, nil)

	if out, err := rig.run(t); err != nil || out.Status != RunSuccess {
		t.Fatalf("sinkron pertama = %+v, %v", out, err)
	}
	before := f.dataSnapshot()

	fake.mu.Lock()
	fake.rows = nil
	fake.mu.Unlock()
	out, err := rig.run(t)
	if !errors.Is(err, ErrEmptyInvoiceSource) || out.Status != RunFailed {
		t.Fatalf("sumber kosong: RunOnce = %+v, %v; want ErrEmptyInvoiceSource", out, err)
	}
	if after := f.dataSnapshot(); after != before {
		t.Errorf("sumber kosong mengubah data:\n--- sebelum\n%s\n--- sesudah\n%s", before, after)
	}
	run := f.run(out.RunID)
	const want = "Sumber billing tidak mengembalikan satu pun tagihan; status lama dipertahankan."
	if run.Status != "failed" || run.Error == nil || *run.Error != want || run.FinishedAt == nil {
		t.Errorf("log sinkron = %+v (error %v), want failed dengan pesan %q", run, run.Error, want)
	}
	if n := f.countRuns(`status = 'running'`); n != 0 {
		t.Errorf("%d sinkron masih running", n)
	}
}

func TestSyncerDeadSourceLeavesOldStatusesAndLogsFailure(t *testing.T) {
	f := newPGFixture(t)
	_, rows := seedCustomers(f)
	fake := newFake(t, rows)
	// Sistem billing mati adalah kegagalan sementara, jadi dibaca ulang; jeda nol
	// supaya tes tidak menunggu.
	rig := newPGSyncRig(t, f, fake, nil, func(o *SyncerOptions) { o.RetryDelays = []time.Duration{0} })
	if out, err := rig.run(t); err != nil || out.Status != RunSuccess {
		t.Fatalf("sinkron pertama = %+v, %v", out, err)
	}
	before := f.dataSnapshot()
	hostPort := strings.TrimPrefix(fake.srv.URL, "http://")

	fake.srv.Close() // sistem billing mati
	out, err := rig.run(t)
	if !errors.Is(err, ErrNetwork) || out.Status != RunFailed || out.RunID == "" {
		t.Fatalf("sumber mati: RunOnce = %+v, %v; want ErrNetwork", out, err)
	}
	if after := f.dataSnapshot(); after != before {
		t.Errorf("sumber mati mengubah data:\n--- sebelum\n%s\n--- sesudah\n%s", before, after)
	}
	run := f.run(out.RunID)
	if run.Status != "failed" || run.Error == nil || *run.Error != msgNetworkDown {
		t.Fatalf("log sinkron = %+v (error %v); want pesan %q", run, run.Error, msgNetworkDown)
	}
	if out.Attempts != DefaultMaxReadAttempts || f.countRuns(`true`) != 2 {
		t.Errorf("percobaan = %d, baris log = %d; want %d percobaan dalam SATU baris (ditambah sinkron pertama)",
			out.Attempts, f.countRuns(`true`), DefaultMaxReadAttempts)
	}
	if strings.Contains(*run.Error, hostPort) {
		t.Errorf("pesan di log sinkron memuat alamat sistem billing: %q", *run.Error)
	}
	rig.assertNoSecrets(t, "pesan di log sinkron", *run.Error)
	rig.assertNoSecrets(t, "log", rig.logs.String())
	if strings.Contains(rig.logs.String(), hostPort) {
		t.Errorf("log memuat alamat sistem billing:\n%s", rig.logs)
	}
	if !strings.Contains(rig.logs.String(), "tahap=baca_tagihan") {
		t.Errorf("log harus menyebut tahap:\n%s", rig.logs)
	}
}

func TestSyncerRejectedLoginIsLoggedWithoutSecrets(t *testing.T) {
	f := newPGFixture(t)
	_, rows := seedCustomers(f)
	fake := newFake(t, rows)
	const wrongPassword = "kata-sandi-salah-777"
	rig := newPGSyncRig(t, f, fake, func(c *Config) { c.Password = wrongPassword }, nil)
	before := f.dataSnapshot()

	out, err := rig.run(t)
	if !errors.Is(err, ErrLoginFailed) || out.Status != RunFailed {
		t.Fatalf("RunOnce = %+v, %v; want ErrLoginFailed", out, err)
	}
	if after := f.dataSnapshot(); after != before {
		t.Errorf("login ditolak mengubah data")
	}
	run := f.run(out.RunID)
	if run.Status != "failed" || run.Error == nil || *run.Error != msgLoginRejected {
		t.Fatalf("log sinkron = %+v (error %v); want pesan %q", run, run.Error, msgLoginRejected)
	}
	if out.Attempts != 1 {
		t.Errorf("login yang ditolak dicoba %d kali, want 1 (tidak boleh diulang)", out.Attempts)
	}
	for name, text := range map[string]string{"pesan di log sinkron": *run.Error, "log": rig.logs.String()} {
		rig.assertNoSecrets(t, name, text)
		if strings.Contains(text, wrongPassword) {
			t.Errorf("%s memuat kata sandi yang dikirim:\n%s", name, text)
		}
	}
}

// gateSource menahan pembacaan sampai dilepas atau konteksnya dibatalkan.
type gateSource struct {
	inner   InvoiceSource
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func newGateSource(inner InvoiceSource) *gateSource {
	return &gateSource{inner: inner, entered: make(chan struct{}), release: make(chan struct{})}
}

func (g *gateSource) Invoices(ctx context.Context) ([]Invoice, Stats, error) {
	g.once.Do(func() { close(g.entered) })
	select {
	case <-g.release:
		return g.inner.Invoices(ctx)
	case <-ctx.Done():
		return nil, Stats{}, ctx.Err()
	}
}

func TestSyncerTwoConcurrentRunsOneRunsOneSkipped(t *testing.T) {
	f := newPGFixture(t)
	cs, rows := seedCustomers(f)
	rig := newPGSyncRig(t, f, newFake(t, rows), nil, nil)
	gate := newGateSource(rig.scraper)
	syncer, err := NewSyncer(gate, f.store, SyncerOptions{Now: newSteppingClock(t0).Now})
	if err != nil {
		t.Fatal(err)
	}

	results := make(chan RunOutcome, 2)
	for i := 0; i < 2; i++ {
		go func() {
			out, err := syncer.RunOnce(context.Background(), TriggerSchedule)
			if err != nil {
				t.Errorf("RunOnce: %v", err)
			}
			results <- out
		}()
	}
	first := <-results // hanya yang kalah yang bisa kembali selagi pemenang menahan sumber
	if first.Status != RunSkipped || first.RunID != "" {
		t.Errorf("yang kembali lebih dulu = %+v, want RunSkipped", first)
	}
	<-gate.entered
	if n := f.countRuns(`status = 'running'`); n != 1 {
		t.Errorf("%d sinkron running selagi pemenang menahan sumber, want 1", n)
	}
	close(gate.release)
	second := <-results
	if second.Status != RunSuccess {
		t.Fatalf("pemenang = %+v, want RunSuccess", second)
	}
	if n := f.countRuns(`true`); n != 1 {
		t.Errorf("baris log = %d, want 1 (yang dilewati tidak menulis apa-apa)", n)
	}
	if got := f.customerStatuses(); got[cs["a"].ID] != StatusIsolir {
		t.Errorf("hasil pemenang tidak diterapkan: %v", got)
	}
}

// Backend berhenti di tengah sinkron: baris log harus ditutup failed dengan pesan
// henti walau konteks sinkron sudah mati. Menulisnya dengan konteks yang sudah
// dibatalkan akan gagal dan meninggalkan baris running.
func TestSyncerShutdownMidSyncMarksTheRunFailed(t *testing.T) {
	f := newPGFixture(t)
	_, rows := seedCustomers(f)
	rig := newPGSyncRig(t, f, newFake(t, rows), nil, nil)
	gate := newGateSource(rig.scraper)
	syncer, err := NewSyncer(gate, f.store, SyncerOptions{Logger: slog.New(slog.DiscardHandler), Now: newSteppingClock(t0).Now})
	if err != nil {
		t.Fatal(err)
	}
	before := f.dataSnapshot()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type result struct {
		out RunOutcome
		err error
	}
	done := make(chan result, 1)
	go func() {
		out, err := syncer.RunOnce(ctx, TriggerSchedule)
		done <- result{out, err}
	}()
	<-gate.entered
	cancel()
	res := <-done

	if !errors.Is(res.err, ErrSyncCanceled) || res.out.Status != RunFailed {
		t.Fatalf("RunOnce = %+v, %v; want ErrSyncCanceled", res.out, res.err)
	}
	run := f.run(res.out.RunID)
	const want = "Sinkron dibatalkan karena backend berhenti."
	if run.Status != "failed" || run.Error == nil || *run.Error != want || run.FinishedAt == nil {
		t.Errorf("log sinkron = %+v (error %v); want failed dengan pesan %q", run, run.Error, want)
	}
	if n := f.countRuns(`status = 'running'`); n != 0 {
		t.Errorf("%d sinkron tertinggal running sesudah penutupan", n)
	}
	if after := f.dataSnapshot(); after != before {
		t.Errorf("sinkron yang dibatalkan mengubah data")
	}
}

func TestSyncerPrunesOldRunsAfterSuccess(t *testing.T) {
	f := newPGFixture(t)
	_, rows := seedCustomers(f)
	rig := newPGSyncRig(t, f, newFake(t, rows), nil, func(o *SyncerOptions) { o.Keep = 2 })
	var last RunOutcome
	for i := 0; i < 5; i++ {
		out, err := rig.run(t)
		if err != nil || out.Status != RunSuccess {
			t.Fatalf("sinkron %d = %+v, %v", i, out, err)
		}
		last = out
	}
	if n := f.countRuns(`true`); n != 2 {
		t.Errorf("baris log = %d, want 2 (keep = 2)", n)
	}
	if last.Pruned != 1 {
		t.Errorf("Pruned sinkron terakhir = %d, want 1", last.Pruned)
	}
	if n := f.countRuns(`id = $1::uuid`, last.RunID); n != 1 {
		t.Error("sinkron terbaru tidak boleh ikut terpangkas")
	}
}

func TestStoreLastSuccessAt(t *testing.T) {
	f := newPGFixture(t)
	ctx := f.ctx

	if _, ok, err := f.store.LastSuccessAt(ctx); err != nil || ok {
		t.Fatalf("tanpa riwayat: ok = %v, err = %v", ok, err)
	}

	// Hanya sinkron gagal atau berjalan: belum ada yang berhasil.
	failed, err := f.store.BeginRun(ctx, TriggerSchedule, t0)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.FailRun(ctx, failed, errors.New("gagal"), t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	running, err := f.store.BeginRun(ctx, TriggerSchedule, t0.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := f.store.LastSuccessAt(ctx); err != nil || ok {
		t.Fatalf("hanya gagal dan berjalan: ok = %v, err = %v", ok, err)
	}

	first := t0.Add(2 * time.Minute)
	if err := f.store.ApplySuccess(ctx, running, MatchInvoices(nil, nil), first); err != nil {
		t.Fatal(err)
	}
	if got, ok, err := f.store.LastSuccessAt(ctx); err != nil || !ok || !got.Equal(first) || got.Location() != time.UTC {
		t.Errorf("LastSuccessAt = %s (%s), %v, %v; want %s UTC", got, got.Location(), ok, err, first)
	}

	// Sinkron gagal yang lebih baru tidak menutupi yang berhasil.
	later, err := f.store.BeginRun(ctx, TriggerSchedule, t0.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.FailRun(ctx, later, errors.New("gagal lagi"), t0.Add(time.Hour+time.Second)); err != nil {
		t.Fatal(err)
	}
	if got, ok, _ := f.store.LastSuccessAt(ctx); !ok || !got.Equal(first) {
		t.Errorf("sesudah sinkron gagal: LastSuccessAt = %s, want %s", got, first)
	}

	// Yang berhasil lebih baru menggantikan.
	second := t0.Add(2 * time.Hour)
	id, err := f.store.BeginRun(ctx, TriggerSchedule, t0.Add(2*time.Hour-time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.ApplySuccess(ctx, id, MatchInvoices(nil, nil), second); err != nil {
		t.Fatal(err)
	}
	if got, ok, _ := f.store.LastSuccessAt(ctx); !ok || !got.Equal(second) {
		t.Errorf("LastSuccessAt = %s, want %s", got, second)
	}

	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, _, err := f.store.LastSuccessAt(cancelled); err == nil {
		t.Error("konteks yang dibatalkan seharusnya menghasilkan galat")
	}
}

// notifyRunner meneruskan ke Syncer nyata lalu memberi tahu tes bahwa sinkron selesai.
type notifyRunner struct {
	inner Runner
	done  chan RunOutcome
}

func (n *notifyRunner) RunOnce(ctx context.Context, trigger Trigger) (RunOutcome, error) {
	out, err := n.inner.RunOnce(ctx, trigger)
	n.done <- out
	return out, err
}

// Penjadwal nyata + Syncer nyata + Store nyata + Scraper nyata, dengan jam palsu:
// memulihkan sinkron yang tertinggal, menyusul sinkron yang hilang, lalu berjalan
// tepat di slot berikutnya, dan berhenti dengan lembut.
func TestSchedulerEndToEndWithRealSyncerStoreAndScraper(t *testing.T) {
	f := newPGFixture(t)
	cs, rows := seedCustomers(f)
	fake := newFake(t, rows)

	now := utc(2026, 5, 1, 10, 30, 0, 0)
	clock := newFakeClock(now)
	rig := newPGSyncRig(t, f, fake, nil, func(o *SyncerOptions) { o.Now = clock.Now })

	// Sisa proses yang mati di tengah sinkron.
	stale, err := f.store.BeginRun(f.ctx, TriggerSchedule, now.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}

	runner := &notifyRunner{inner: rig.syncer, done: make(chan RunOutcome, 10)}
	sched, err := NewScheduler(SchedulerOptions{
		Syncer: runner, Store: f.store, Minute: 5, Clock: clock,
		Logger: slog.New(slog.NewTextHandler(rig.logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- sched.Run(ctx) }()

	waitOutcome := func() RunOutcome {
		t.Helper()
		select {
		case out := <-runner.done:
			return out
		case <-time.After(watchdog):
			t.Fatal("sinkron tidak selesai")
			return RunOutcome{}
		}
	}

	// Sinkron susulan 10 detik sesudah mulai (belum pernah ada yang berhasil).
	if got := clock.waitTimer(t); !got.Equal(now.Add(DefaultCatchUpDelay)) {
		t.Fatalf("penjadwal menunggu sampai %s, want %s", got, now.Add(DefaultCatchUpDelay))
	}
	clock.Set(now.Add(DefaultCatchUpDelay))
	catchUp := waitOutcome()
	if catchUp.Status != RunSuccess {
		t.Fatalf("sinkron susulan = %+v", catchUp)
	}
	staleRun := f.run(stale)
	if staleRun.Status != "failed" || staleRun.Error == nil || *staleRun.Error != RecoveredRunMessage {
		t.Errorf("sinkron yang tertinggal = %+v (error %v), want failed: %q", staleRun, staleRun.Error, RecoveredRunMessage)
	}
	if got := f.customerStatuses(); got[cs["a"].ID] != StatusIsolir || got[cs["c"].ID] != StatusLunas {
		t.Errorf("status pelanggan sesudah sinkron susulan = %v", got)
	}
	if at, ok, err := f.store.LastSuccessAt(f.ctx); err != nil || !ok || at.Before(now.Add(DefaultCatchUpDelay)) {
		t.Errorf("LastSuccessAt = %s, %v, %v", at, ok, err)
	}

	// Sesudahnya, slot biasa: 11:05:00 tepat.
	slot := utc(2026, 5, 1, 11, 5, 0, 0)
	if got := clock.waitTimer(t); !got.Equal(slot) {
		t.Fatalf("penjadwal menunggu sampai %s, want slot %s", got, slot)
	}
	clock.Set(slot)
	scheduled := waitOutcome()
	if scheduled.Status != RunSuccess || !scheduled.StartedAt.Equal(slot) {
		t.Errorf("sinkron terjadwal = %+v, want mulai tepat %s", scheduled, slot)
	}
	if n := f.countRuns(`status = 'success'`); n != 2 {
		t.Errorf("sinkron berhasil = %d, want 2 (susulan dan terjadwal)", n)
	}
	if n := f.countRuns(`status = 'running'`); n != 0 {
		t.Errorf("%d sinkron masih running", n)
	}

	// Penutupan lembut.
	clock.waitTimer(t)
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Run = %v, want context.Canceled", err)
		}
	case <-time.After(watchdog):
		t.Fatal("Run tidak kembali sesudah konteks dibatalkan")
	}
	rig.assertNoSecrets(t, "log", rig.logs.String())
}
