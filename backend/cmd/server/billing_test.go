package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/billing"
)

// Tes pemasangan sinkron billing ke backend (billing.go). Penjadwal dan Syncer
// diuji di paket billing; di sini yang diuji hanya konfigurasi, keputusan hidup
// atau mati, dan penutupan.

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func testLogger() (*slog.Logger, *lockedBuffer) {
	buf := &lockedBuffer{}
	return slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})), buf
}

func envFrom(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func fullBillingEnv(extra map[string]string) map[string]string {
	env := map[string]string{
		"BILLING_URL":      "https://billing.example.com",
		"BILLING_USERNAME": "operator",
		"BILLING_PASSWORD": "kata-sandi-rahasia-123",
	}
	for k, v := range extra {
		env[k] = v
	}
	return env
}

func TestLoadBillingSettingsDisabledWhenNothingIsSet(t *testing.T) {
	for name, env := range map[string]map[string]string{
		"tidak ada apa-apa":     {},
		"semua kosong":          {"BILLING_URL": "", "BILLING_USERNAME": "", "BILLING_PASSWORD": ""},
		"hanya spasi":           {"BILLING_URL": "  ", "BILLING_USERNAME": "\t"},
		"menit sah saja":        {"BILLING_SYNC_MINUTE": "30"},
		"menit kosong saja":     {"BILLING_SYNC_MINUTE": ""},
		"menit nol saja":        {"BILLING_SYNC_MINUTE": "0"},
		"menit batas atas saja": {"BILLING_SYNC_MINUTE": "59"},
		"penjaga sah saja":      {"BILLING_DROP_PERCENT": "0", "BILLING_DROP_MIN_INVOICES": "5"},
		"penjaga kosong saja":   {"BILLING_DROP_PERCENT": "", "BILLING_DROP_MIN_INVOICES": ""},
	} {
		got, err := loadBillingSettings(envFrom(env))
		if err != nil || got.Enabled {
			t.Errorf("%s: got %+v, %v; want billing mati tanpa galat", name, got, err)
		}
	}
}

func TestLoadBillingSettingsEnabled(t *testing.T) {
	for name, tc := range map[string]struct {
		extra map[string]string
		want  int
	}{
		"menit bawaan 5":     {nil, 5},
		"menit kosong":       {map[string]string{"BILLING_SYNC_MINUTE": ""}, 5},
		"menit 0":            {map[string]string{"BILLING_SYNC_MINUTE": "0"}, 0},
		"menit 30":           {map[string]string{"BILLING_SYNC_MINUTE": "30"}, 30},
		"menit 59":           {map[string]string{"BILLING_SYNC_MINUTE": "59"}, 59},
		"menit dengan spasi": {map[string]string{"BILLING_SYNC_MINUTE": " 12 "}, 12},
	} {
		got, err := loadBillingSettings(envFrom(fullBillingEnv(tc.extra)))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if !got.Enabled || got.Minute != tc.want || got.Config.BaseURL != "https://billing.example.com" || got.Config.Username != "operator" {
			t.Errorf("%s: got %+v, want Enabled dengan menit %d", name, got, tc.want)
		}
	}
}

// Konfigurasi setengah terisi atau rusak menghentikan backend (run mengembalikan
// galat ini), dan pesannya tidak membocorkan kata sandi.
func TestLoadBillingSettingsRejectsBrokenConfiguration(t *testing.T) {
	const password = "kata-sandi-rahasia-123"
	cases := map[string]struct {
		env  map[string]string
		want string // nama variabel yang harus disebut pesannya
	}{
		"hanya URL":                    {map[string]string{"BILLING_URL": "https://billing.example.com"}, "BILLING_USERNAME"},
		"hanya username":               {map[string]string{"BILLING_USERNAME": "operator"}, "BILLING_URL"},
		"hanya kata sandi":             {map[string]string{"BILLING_PASSWORD": password}, "BILLING_URL"},
		"URL dan username tanpa sandi": {map[string]string{"BILLING_URL": "https://b.example.com", "BILLING_USERNAME": "u"}, "BILLING_PASSWORD"},
		"URL tidak sah":                {fullBillingEnv(map[string]string{"BILLING_URL": "ftp://billing.example.com"}), "BILLING_URL"},
		"URL membawa kredensial":       {fullBillingEnv(map[string]string{"BILLING_URL": "https://u:" + password + "@billing.example.com"}), "BILLING_URL"},
		"menit 60":                     {fullBillingEnv(map[string]string{"BILLING_SYNC_MINUTE": "60"}), "BILLING_SYNC_MINUTE"},
		"menit negatif":                {fullBillingEnv(map[string]string{"BILLING_SYNC_MINUTE": "-1"}), "BILLING_SYNC_MINUTE"},
		"menit bukan angka":            {fullBillingEnv(map[string]string{"BILLING_SYNC_MINUTE": "lima"}), "BILLING_SYNC_MINUTE"},
		"menit pecahan":                {fullBillingEnv(map[string]string{"BILLING_SYNC_MINUTE": "5.5"}), "BILLING_SYNC_MINUTE"},
		"menit salah, billing mati":    {map[string]string{"BILLING_SYNC_MINUTE": "99"}, "BILLING_SYNC_MINUTE"},

		"persen 101":                     {fullBillingEnv(map[string]string{"BILLING_DROP_PERCENT": "101"}), "BILLING_DROP_PERCENT"},
		"persen negatif":                 {fullBillingEnv(map[string]string{"BILLING_DROP_PERCENT": "-1"}), "BILLING_DROP_PERCENT"},
		"persen pecahan":                 {fullBillingEnv(map[string]string{"BILLING_DROP_PERCENT": "50.5"}), "BILLING_DROP_PERCENT"},
		"persen teks":                    {fullBillingEnv(map[string]string{"BILLING_DROP_PERCENT": "separuh"}), "BILLING_DROP_PERCENT"},
		"persen salah, billing mati":     {map[string]string{"BILLING_DROP_PERCENT": "150"}, "BILLING_DROP_PERCENT"},
		"minimum 0":                      {fullBillingEnv(map[string]string{"BILLING_DROP_MIN_INVOICES": "0"}), "BILLING_DROP_MIN_INVOICES"},
		"minimum negatif":                {fullBillingEnv(map[string]string{"BILLING_DROP_MIN_INVOICES": "-5"}), "BILLING_DROP_MIN_INVOICES"},
		"minimum pecahan":                {fullBillingEnv(map[string]string{"BILLING_DROP_MIN_INVOICES": "2.5"}), "BILLING_DROP_MIN_INVOICES"},
		"minimum teks":                   {fullBillingEnv(map[string]string{"BILLING_DROP_MIN_INVOICES": "banyak"}), "BILLING_DROP_MIN_INVOICES"},
		"minimum salah, billing mati":    {map[string]string{"BILLING_DROP_MIN_INVOICES": "0"}, "BILLING_DROP_MIN_INVOICES"},
		"persen salah, billing setengah": {map[string]string{"BILLING_URL": "https://billing.example.com", "BILLING_DROP_PERCENT": "x"}, "BILLING_USERNAME"},
	}
	for name, tc := range cases {
		got, err := loadBillingSettings(envFrom(tc.env))
		if err == nil {
			t.Errorf("%s: diterima sebagai %+v; seharusnya ditolak", name, got)
			continue
		}
		if !errors.Is(err, billing.ErrInvalidConfig) {
			t.Errorf("%s: err = %v, want membungkus ErrInvalidConfig", name, err)
		}
		if !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: pesan %q tidak menyebut %s", name, err, tc.want)
		}
		if strings.Contains(err.Error(), password) {
			t.Errorf("%s: pesan membocorkan kata sandi: %q", name, err)
		}
		if got.Enabled {
			t.Errorf("%s: Enabled benar walau konfigurasi ditolak", name)
		}
	}
}

// Penjaga hasil yang menyusut dibaca dari environment dan sampai ke Syncer.
func TestLoadBillingSettingsReadsTheDropGuard(t *testing.T) {
	for name, tc := range map[string]struct {
		extra map[string]string
		want  billing.DropGuard
	}{
		"bawaan":               {nil, billing.DropGuard{MinInvoices: 10, Percent: 50}},
		"kosong":               {map[string]string{"BILLING_DROP_PERCENT": "", "BILLING_DROP_MIN_INVOICES": ""}, billing.DropGuard{MinInvoices: 10, Percent: 50}},
		"persen 0 (mati)":      {map[string]string{"BILLING_DROP_PERCENT": "0"}, billing.DropGuard{MinInvoices: 10, Percent: 0}},
		"persen 100":           {map[string]string{"BILLING_DROP_PERCENT": "100"}, billing.DropGuard{MinInvoices: 10, Percent: 100}},
		"persen 80":            {map[string]string{"BILLING_DROP_PERCENT": "80"}, billing.DropGuard{MinInvoices: 10, Percent: 80}},
		"minimum 1":            {map[string]string{"BILLING_DROP_MIN_INVOICES": "1"}, billing.DropGuard{MinInvoices: 1, Percent: 50}},
		"minimum 25":           {map[string]string{"BILLING_DROP_MIN_INVOICES": " 25 "}, billing.DropGuard{MinInvoices: 25, Percent: 50}},
		"keduanya":             {map[string]string{"BILLING_DROP_PERCENT": "30", "BILLING_DROP_MIN_INVOICES": "4"}, billing.DropGuard{MinInvoices: 4, Percent: 30}},
		"persen 0 dan minimum": {map[string]string{"BILLING_DROP_PERCENT": "0", "BILLING_DROP_MIN_INVOICES": "4"}, billing.DropGuard{MinInvoices: 4, Percent: 0}},
	} {
		got, err := loadBillingSettings(envFrom(fullBillingEnv(tc.extra)))
		if err != nil || !got.Enabled || got.DropGuard != tc.want {
			t.Errorf("%s: got %+v, %v; want DropGuard %+v", name, got, err, tc.want)
		}
		if opts := syncerOptions(nil, got); opts.DropGuard == nil || *opts.DropGuard != tc.want {
			t.Errorf("%s: SyncerOptions.DropGuard = %v, want %+v", name, opts.DropGuard, tc.want)
		}
	}
}

// Syncer, penyimpanan, dan sumber palsu untuk menguji nilai yang benar-benar
// dipakai Syncer, tanpa database.
type stubSource struct{ n int }

func (s stubSource) Invoices(context.Context) ([]billing.Invoice, billing.Stats, error) {
	list := make([]billing.Invoice, s.n)
	for i := range list {
		list[i] = billing.Invoice{Name: "p" + strconv.Itoa(i), Ref: "INV", Status: billing.StatusLunas}
	}
	return list, billing.Stats{Pages: 1, Rows: s.n}, nil
}

type stubStore struct {
	last     billing.SuccessRun
	has      bool
	applied  int
	failed   []string
	lastRead int
}

func (s *stubStore) BeginRun(context.Context, billing.Trigger, time.Time) (string, error) {
	return "run-1", nil
}
func (s *stubStore) LoadCustomers(context.Context) ([]billing.Customer, error) { return nil, nil }
func (s *stubStore) ApplySuccess(context.Context, string, billing.Result, time.Time) error {
	s.applied++
	return nil
}
func (s *stubStore) FailRun(_ context.Context, _ string, cause error, _ time.Time) error {
	s.failed = append(s.failed, cause.Error())
	return nil
}
func (s *stubStore) PruneRuns(context.Context, int) (int, error) { return 0, nil }
func (s *stubStore) LastSuccess(context.Context) (billing.SuccessRun, bool, error) {
	s.lastRead++
	return s.last, s.has, nil
}

// syncOnce menjalankan satu sinkron yang membaca `current` tagihan setelah sinkron
// berhasil terakhir berisi `previous`, dengan opsi dari konfigurasi env.
func syncOnce(t *testing.T, env map[string]string, previous, current int) (billing.RunOutcome, *stubStore) {
	t.Helper()
	settings, err := loadBillingSettings(envFrom(fullBillingEnv(env)))
	if err != nil {
		t.Fatal(err)
	}
	store := &stubStore{last: billing.SuccessRun{Invoices: previous}, has: true}
	syncer, err := billing.NewSyncer(stubSource{n: current}, store, syncerOptions(nil, settings))
	if err != nil {
		t.Fatal(err)
	}
	out, _ := syncer.RunOnce(context.Background(), billing.TriggerSchedule)
	return out, store
}

func TestEnvDropGuardReachesTheSyncerAndMovesTheBoundary(t *testing.T) {
	cases := []struct {
		name              string
		env               map[string]string
		previous, current int
		rejected          bool
	}{
		{"bawaan: 5 dari 10 lolos", nil, 10, 5, false},
		{"bawaan: 4 dari 10 ditolak", nil, 10, 4, true},
		{"bawaan: 9 sebelumnya tidak dijaga", nil, 9, 1, false},
		{"persen 0: penurunan besar lolos", map[string]string{"BILLING_DROP_PERCENT": "0"}, 1000, 1, false},
		{"persen 80: 8 dari 10 lolos", map[string]string{"BILLING_DROP_PERCENT": "80"}, 10, 8, false},
		{"persen 80: 7 dari 10 ditolak", map[string]string{"BILLING_DROP_PERCENT": "80"}, 10, 7, true},
		{"persen 10: 2 dari 20 lolos", map[string]string{"BILLING_DROP_PERCENT": "10"}, 20, 2, false},
		{"persen 10: 1 dari 20 ditolak", map[string]string{"BILLING_DROP_PERCENT": "10"}, 20, 1, true},
		{"persen 100: sama lolos", map[string]string{"BILLING_DROP_PERCENT": "100"}, 20, 20, false},
		{"persen 100: kurang satu ditolak", map[string]string{"BILLING_DROP_PERCENT": "100"}, 20, 19, true},
		{"minimum 3: 3 sebelumnya dijaga", map[string]string{"BILLING_DROP_MIN_INVOICES": "3"}, 3, 1, true},
		{"minimum 3: 2 sebelumnya tidak dijaga", map[string]string{"BILLING_DROP_MIN_INVOICES": "3"}, 2, 1, false},
		{"minimum 50: 40 sebelumnya tidak dijaga", map[string]string{"BILLING_DROP_MIN_INVOICES": "50"}, 40, 1, false},
		{"minimum 50: 50 sebelumnya dijaga", map[string]string{"BILLING_DROP_MIN_INVOICES": "50"}, 50, 24, true},
		{"kombinasi 60%/min 5: 3 dari 5 lolos", map[string]string{"BILLING_DROP_PERCENT": "60", "BILLING_DROP_MIN_INVOICES": "5"}, 5, 3, false},
		{"kombinasi 60%/min 5: 2 dari 5 ditolak", map[string]string{"BILLING_DROP_PERCENT": "60", "BILLING_DROP_MIN_INVOICES": "5"}, 5, 2, true},
	}
	for _, c := range cases {
		out, store := syncOnce(t, c.env, c.previous, c.current)
		if c.rejected {
			if out.Status != billing.RunFailed || out.Failure.Kind != billing.FailureAnomalousDrop || store.applied != 0 || len(store.failed) != 1 {
				t.Errorf("%s: outcome = %+v, diterapkan %d, gagal %v; want ditolak", c.name, out, store.applied, store.failed)
			}
			continue
		}
		if out.Status != billing.RunSuccess || store.applied != 1 {
			t.Errorf("%s: outcome = %+v, diterapkan %d; want lolos", c.name, out, store.applied)
		}
		if c.env["BILLING_DROP_PERCENT"] == "0" && store.lastRead != 0 {
			t.Errorf("%s: pembanding dibaca walau penjaga mati", c.name)
		}
	}
}

// Pesan penjaga menunjuk variabel yang mengaturnya.
func TestDropMessagePointsAtTheSettingThatFixesIt(t *testing.T) {
	out, store := syncOnce(t, nil, 20, 2)
	if len(store.failed) != 1 || !strings.Contains(store.failed[0], "BILLING_DROP_PERCENT") || !strings.Contains(out.Failure.Message, "dari 20 ke 2") {
		t.Errorf("pesan = %v, Failure = %+v", store.failed, out.Failure)
	}
}

func TestSyncerOptionsDoNotShareMemoryWithSettings(t *testing.T) {
	settings, err := loadBillingSettings(envFrom(fullBillingEnv(map[string]string{"BILLING_DROP_PERCENT": "70"})))
	if err != nil {
		t.Fatal(err)
	}
	opts := syncerOptions(nil, settings)
	settings.DropGuard.Percent = 1
	if opts.DropGuard.Percent != 70 {
		t.Errorf("opsi ikut berubah: %+v", opts.DropGuard)
	}
}

func TestStartBillingDisabledLogsExactlyOneLineAndStartsNothing(t *testing.T) {
	logger, logs := testLogger()
	wait, err := startBilling(context.Background(), logger, billingSettings{}, nil)
	if err != nil {
		t.Fatalf("startBilling: %v", err)
	}
	waited := make(chan struct{})
	go func() { wait(); close(waited) }()
	select {
	case <-waited:
	case <-time.After(5 * time.Second):
		t.Fatal("wait tidak kembali walau tidak ada yang dijalankan")
	}

	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("log = %d baris, want 1:\n%s", len(lines), logs)
	}
	for _, want := range []string{
		"level=INFO",
		"sinkron billing dimatikan (BILLING_URL, BILLING_USERNAME, BILLING_PASSWORD belum diatur)",
	} {
		if !strings.Contains(lines[0], want) {
			t.Errorf("baris log %q tidak memuat %q", lines[0], want)
		}
	}
}

// Billing mati tetap mati walau database tersedia.
func TestStartBillingDisabledIgnoresDatabase(t *testing.T) {
	pool, err := openArchivePool(context.Background(), "postgres://noc:rahasia-sekali@127.0.0.1:1/noc?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	logger, logs := testLogger()
	wait, err := startBilling(context.Background(), logger, billingSettings{}, pool)
	if err != nil {
		t.Fatal(err)
	}
	wait()
	if lines := strings.Split(strings.TrimSpace(logs.String()), "\n"); len(lines) != 1 || !strings.Contains(lines[0], "dimatikan") {
		t.Errorf("log = %q", logs)
	}
}

func TestStartBillingWithoutDatabaseWarnsAndStartsNothing(t *testing.T) {
	logger, logs := testLogger()
	settings, err := loadBillingSettings(envFrom(fullBillingEnv(nil)))
	if err != nil {
		t.Fatal(err)
	}
	wait, err := startBilling(context.Background(), logger, settings, nil)
	if err != nil {
		t.Fatalf("startBilling: %v", err)
	}
	wait()
	out := logs.String()
	if strings.Count(out, "\n") != 1 || !strings.Contains(out, "level=WARN") || !strings.Contains(out, "DATABASE_URL") {
		t.Errorf("log = %q; want satu peringatan yang menyebut DATABASE_URL", out)
	}
	if strings.Contains(out, "kata-sandi-rahasia-123") {
		t.Errorf("log membocorkan kata sandi: %q", out)
	}
}

func TestStartBillingRefusesAnUnusableScraperConfig(t *testing.T) {
	pool, err := openArchivePool(context.Background(), "postgres://noc:rahasia-sekali@127.0.0.1:1/noc?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	logger, _ := testLogger()
	settings := billingSettings{
		Enabled: true,
		Config:  billing.Config{BaseURL: "ftp://billing.example.com", Username: "u", Password: "p"},
		Minute:  5,
	}
	wait, err := startBilling(context.Background(), logger, settings, pool)
	if err == nil || !errors.Is(err, billing.ErrInvalidConfig) {
		t.Fatalf("startBilling = %v, want galat yang membungkus ErrInvalidConfig", err)
	}
	if wait != nil {
		t.Error("wait harus nil bila start gagal")
	}
}

// Penjadwal berjalan di goroutine sendiri dan berhenti bersama konteks; wait
// kembali sesudahnya. Database dan sistem billing sengaja tidak tersedia: backend
// harus tetap naik dan berhenti dengan rapi.
func TestStartBillingRunsAndStopsWithTheContext(t *testing.T) {
	const password = "kata-sandi-rahasia-123"
	pool, err := openArchivePool(context.Background(), "postgres://noc:rahasia-sekali@127.0.0.1:1/noc?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	logger, logs := testLogger()
	settings, err := loadBillingSettings(envFrom(fullBillingEnv(map[string]string{
		"BILLING_URL": "http://127.0.0.1:1", "BILLING_SYNC_MINUTE": "17",
		"BILLING_DROP_PERCENT": "0", "BILLING_DROP_MIN_INVOICES": "7",
	})))
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wait, err := startBilling(ctx, logger, settings, pool)
	if err != nil {
		t.Fatalf("startBilling: %v", err)
	}
	cancel()
	waited := make(chan struct{})
	go func() { wait(); close(waited) }()
	select {
	case <-waited:
	case <-time.After(30 * time.Second):
		t.Fatal("wait tidak kembali sesudah konteks dibatalkan")
	}

	out := logs.String()
	if !strings.Contains(out, "sinkron billing aktif") || !strings.Contains(out, "menit=17") {
		t.Errorf("log harus menyebut sinkron aktif dan menitnya:\n%s", out)
	}
	// Penjaga yang dimatikan harus terlihat jelas di log, dan nilainya ikut dicatat.
	if !strings.Contains(out, "penjaga_persen=0") || !strings.Contains(out, "penjaga_minimum_tagihan=7") ||
		!strings.Contains(out, "level=WARN") || !strings.Contains(out, "BILLING_DROP_PERCENT=0") {
		t.Errorf("log harus menyebut penjaga yang dimatikan:\n%s", out)
	}
	if strings.Contains(out, password) {
		t.Errorf("log membocorkan kata sandi billing:\n%s", out)
	}
	if strings.Contains(out, "level=ERROR") {
		t.Errorf("penutupan normal tidak boleh mencatat galat:\n%s", out)
	}
}

// wait harus benar-benar menunggu: main menutup pool database sesudahnya, dan
// sinkron yang berhenti perlu menulis catatan gagalnya lebih dulu.
func TestRunInBackgroundWaitBlocksUntilRunAndCleanupFinish(t *testing.T) {
	logger, logs := testLogger()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	blocked := make(chan struct{})
	release := make(chan struct{})
	var mu sync.Mutex
	var steps []string
	record := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		steps = append(steps, s)
	}
	wait := runInBackground(ctx, logger, func(ctx context.Context) error {
		<-ctx.Done()
		close(blocked) // sudah melihat pembatalan, tetapi belum selesai menulis catatan
		<-release
		record("run selesai")
		return ctx.Err()
	}, func() { record("cleanup") })

	started := make(chan struct{})
	returned := make(chan struct{})
	go func() {
		close(started)
		wait()
		close(returned)
	}()
	<-started
	cancel()
	<-blocked
	for i := 0; i < 2000; i++ {
		runtime.Gosched()
	}
	select {
	case <-returned:
		t.Fatal("wait kembali selagi run masih menulis catatan gagalnya")
	default:
	}

	close(release)
	select {
	case <-returned:
	case <-time.After(10 * time.Second):
		t.Fatal("wait tidak kembali sesudah run selesai")
	}
	mu.Lock()
	defer mu.Unlock()
	if strings.Join(steps, ",") != "run selesai,cleanup" {
		t.Errorf("urutan = %v, want run selesai lalu cleanup", steps)
	}
	if strings.Contains(logs.String(), "level=ERROR") {
		t.Errorf("pembatalan bukan galat:\n%s", logs)
	}
}

func TestRunInBackgroundLogsUnexpectedErrorsOnly(t *testing.T) {
	logger, logs := testLogger()
	runInBackground(context.Background(), logger, func(context.Context) error { return errors.New("jadwal rusak") }, func() {})()
	if out := logs.String(); !strings.Contains(out, "level=ERROR") || !strings.Contains(out, "jadwal rusak") {
		t.Errorf("galat tak terduga harus dicatat:\n%s", out)
	}

	logger, logs = testLogger()
	runInBackground(context.Background(), logger, func(context.Context) error { return context.Canceled }, func() {})()
	if out := logs.String(); out != "" {
		t.Errorf("pembatalan tidak boleh dicatat:\n%s", out)
	}
}
