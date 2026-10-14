package httpapi

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/billing"
	"noc-isp/backend/internal/wire"
)

// Tes jalur HTTP endpoint billing dengan sumber palsu (tanpa database): tiket,
// metode, header, 503, 500 tanpa bocor, batas waktu, dan jadwal. Isi jawaban dari
// PostgreSQL sungguhan diuji di billing_pg_test.go.

// billingNow adalah jam tetap untuk tes: sebuah sinkron baru akan mulai 55 menit lagi.
var billingNow = time.Date(2026, 5, 1, 10, 5, 3, 0, time.UTC)

// billingNext adalah saat sinkron berikutnya menurut jam di atas.
var billingNext = time.Date(2026, 5, 1, 11, 5, 0, 0, time.UTC)

// fakeBilling mencatat panggilan dan menjawab sesuai isian.
type fakeBilling struct {
	mu       sync.Mutex
	overview wire.BillingOverview
	sync     wire.BillingSyncState
	err      error

	calls    []string
	nextRuns []time.Time
	deadline time.Time
	// block, bila diisi, menahan jawaban sampai konteks permintaan selesai;
	// started diberi tanda saat panggilan masuk.
	block   bool
	started chan struct{}
}

func (f *fakeBilling) record(ctx context.Context, name string, next time.Time) error {
	f.mu.Lock()
	f.calls = append(f.calls, name)
	f.nextRuns = append(f.nextRuns, next)
	f.deadline, _ = ctx.Deadline()
	f.mu.Unlock()
	if f.started != nil {
		f.started <- struct{}{}
	}
	if f.block {
		<-ctx.Done()
		return ctx.Err()
	}
	return f.err
}

func (f *fakeBilling) Overview(ctx context.Context, next time.Time) (wire.BillingOverview, error) {
	if err := f.record(ctx, "overview", next); err != nil {
		return wire.BillingOverview{}, err
	}
	return f.overview, nil
}

func (f *fakeBilling) SyncState(ctx context.Context, next time.Time) (wire.BillingSyncState, error) {
	if err := f.record(ctx, "sync", next); err != nil {
		return wire.BillingSyncState{}, err
	}
	return f.sync, nil
}

func (f *fakeBilling) Runs(ctx context.Context, limit, offset int) ([]wire.BillingSyncRun, int, error) {
	if err := f.record(ctx, "runs", time.Time{}); err != nil {
		return nil, 0, err
	}
	all := f.sync.Runs
	start := min(offset, len(all))
	end := min(start+limit, len(all))
	return all[start:end], len(all), nil
}

func (f *fakeBilling) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

type billingHarness struct {
	*apiHarness
	logs *bytes.Buffer
}

// newBillingHarness memasang handler lengkap (CORS, tiket, header) dengan jam
// tetap. Bila source nil, Billing dibiarkan kosong (fitur mati).
func newBillingHarness(t *testing.T, source BillingSource, nextRun func(time.Time) time.Time) *billingHarness {
	t.Helper()
	h := newAPIHarness(t)
	logs := &bytes.Buffer{}
	opts := Options{
		Logger:         slog.New(slog.NewTextHandler(logs, nil)),
		Data:           h.mgr,
		Verifier:       h.tokens,
		AllowedOrigins: []string{apiOrigin},
		BillingNextRun: nextRun,
		Now:            func() time.Time { return billingNow },
	}
	if source != nil {
		opts.Billing = source
	}
	h.handler = NewHandler(opts)
	return &billingHarness{apiHarness: h, logs: logs}
}

func fixedNextRun(time.Time) time.Time { return billingNext }

var billingPaths = []string{"/api/v1/billing", "/api/v1/billing/sync"}

func sampleOverview() wire.BillingOverview {
	ref, name := "INV-1", "agus.firmansyah014"
	failure := "Sistem billing tidak dapat dihubungi."
	return wire.BillingOverview{
		Sync: wire.BillingSyncState{
			IntervalSeconds: 3600,
			Running:         &wire.BillingRunning{StartedAt: billingNow.Unix() - 3},
			NextRunAt:       billingNext.Unix(),
			Runs: []wire.BillingSyncRun{
				{ID: "r2", StartedAt: 100, FinishedAt: 110, Status: "failed", Error: &failure},
				{ID: "r1", StartedAt: 10, FinishedAt: 20, Status: "success",
					Result: &wire.BillingSyncResult{Invoices: 3, Matched: 2, Unmatched: 1, WithoutInvoice: 1}},
			},
		},
		Rows: []wire.BillingRow{{
			CustomerID: "c1", Name: "Agus", PPPoEUsername: name, RouterID: "r1", RouterName: "RTR-1",
			Status: "lunas", Match: "exact", InvoiceRef: &ref, BillingName: &name,
		}},
		Unmatched: []wire.BillingUnmatched{{InvoiceRef: "INV-9", PPPoEUsername: "x", Status: "isolir", Reason: "unknown"}},
	}
}

func TestBillingRequiresAValidTicket(t *testing.T) {
	source := &fakeBilling{overview: sampleOverview(), sync: sampleOverview().Sync}
	h := newBillingHarness(t, source, fixedNextRun)
	expired, _ := h.tokens.Issue("user-1", time.Now().Add(-time.Hour), time.Minute)
	foreignTokens, _ := auth.NewTokens("ffffffffffffffffffffffffffffffff")
	foreign, _ := foreignTokens.Issue("user-1", time.Now(), time.Minute)

	headers := map[string]string{
		"tanpa header":      "",
		"skema Basic":       "Basic dXNlcjpwYXNz",
		"Bearer kosong":     "Bearer ",
		"hanya kata Bearer": "Bearer",
		"tiket sampah":      "Bearer asal.asalan",
		"tiket kedaluwarsa": "Bearer " + expired,
		"rahasia lain":      "Bearer " + foreign,
	}
	for _, path := range billingPaths {
		for name, header := range headers {
			headerMap := map[string]string{}
			if header != "" {
				headerMap["Authorization"] = header
			}
			rec := h.do(http.MethodGet, path, "", headerMap)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s (%s): status = %d, want 401", path, name, rec.Code)
			}
			if rec.Header().Get("WWW-Authenticate") != "Bearer" || strings.TrimSpace(rec.Body.String()) != `{"error":"unauthorized"}` {
				t.Errorf("%s (%s): jawaban = %q / %q", path, name, rec.Header().Get("WWW-Authenticate"), rec.Body)
			}
			if strings.Contains(rec.Body.String(), "data") {
				t.Errorf("%s (%s): jawaban 401 memuat data: %s", path, name, rec.Body)
			}
		}
	}
	if n := source.callCount(); n != 0 {
		t.Errorf("sumber dipanggil %d kali tanpa tiket yang sah", n)
	}

	for _, path := range billingPaths {
		if rec := h.get(path); rec.Code != http.StatusOK {
			t.Errorf("%s dengan tiket: status = %d, want 200; body %s", path, rec.Code, rec.Body)
		}
	}
}

// Penonton hanya-lihat (tiket tanpa izin mengubah) boleh membaca status billing:
// halaman Billing adalah halaman baca-saja untuk semua peran.
func TestBillingViewOnlyTicketMayRead(t *testing.T) {
	source := &fakeBilling{overview: sampleOverview(), sync: sampleOverview().Sync}
	h := newBillingHarness(t, source, fixedNextRun)
	viewOnly, err := h.tokens.Issue("viewer", time.Now(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	withPerms, err := h.tokens.IssueWithPerms("operator", []string{"alert:handle"}, time.Now(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	for name, ticket := range map[string]string{"hanya-lihat": viewOnly, "dengan izin": withPerms} {
		for _, path := range billingPaths {
			if rec := h.do(http.MethodGet, path, ticket, nil); rec.Code != http.StatusOK {
				t.Errorf("%s %s: status = %d, want 200; body %s", name, path, rec.Code, rec.Body)
			}
		}
	}
}

func TestBillingOnlyAcceptsReadMethods(t *testing.T) {
	source := &fakeBilling{overview: sampleOverview(), sync: sampleOverview().Sync}
	h := newBillingHarness(t, source, fixedNextRun)
	for _, path := range billingPaths {
		methods := []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions, "TRACE"}
		wantAllow := "GET, HEAD"
		if path == "/api/v1/billing/sync" {
			// POST di sini adalah sinkron manual (tes sendiri di bawah).
			methods, wantAllow = methods[1:], "GET, HEAD, POST"
		}
		for _, method := range methods {
			rec := h.do(method, path, h.ticket(), nil)
			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s: status = %d, want 405", method, path, rec.Code)
			}
			if got := rec.Header().Get("Allow"); got != wantAllow {
				t.Errorf("%s %s: Allow = %q, want %q", method, path, got, wantAllow)
			}
			if strings.TrimSpace(rec.Body.String()) != `{"error":"method_not_allowed"}` {
				t.Errorf("%s %s: body = %q", method, path, rec.Body)
			}
		}
	}
	if n := source.callCount(); n != 0 {
		t.Errorf("metode yang ditolak tetap memanggil sumber %d kali", n)
	}

	// HEAD diterima dan tidak membawa badan.
	for _, path := range billingPaths {
		rec := h.do(http.MethodHead, path, h.ticket(), nil)
		if rec.Code != http.StatusOK {
			t.Errorf("HEAD %s: status = %d, want 200", path, rec.Code)
		}
	}

	// Preflight CORS dari origin yang sah hanya menawarkan metode baca.
	rec := h.do(http.MethodOptions, "/api/v1/billing", "", map[string]string{
		"Origin": apiOrigin, "Access-Control-Request-Method": "POST",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight: status = %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got != "GET, HEAD, OPTIONS" || strings.Contains(got, "POST") {
		t.Errorf("Access-Control-Allow-Methods = %q", got)
	}
}

func TestBillingAnswersJSONWithSafeHeaders(t *testing.T) {
	source := &fakeBilling{overview: sampleOverview(), sync: sampleOverview().Sync}
	h := newBillingHarness(t, source, fixedNextRun)
	for _, path := range billingPaths {
		rec := h.get(path)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d; body %s", path, rec.Code, rec.Body)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Errorf("%s: Content-Type = %q", path, ct)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control = %q, want no-store", path, got)
		}
		if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options = %q", path, got)
		}
	}

	// Jawaban kesalahan juga tidak boleh disimpan.
	for _, rec := range []*httptest.ResponseRecorder{
		h.do(http.MethodGet, "/api/v1/billing", "", nil),
		h.do(http.MethodPost, "/api/v1/billing", h.ticket(), nil),
	} {
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("status %d: Cache-Control = %q, want no-store", rec.Code, got)
		}
	}

	// /billing memuat sync, rows, unmatched; /billing/sync hanya objek sync yang sama.
	type body[T any] struct {
		Data T `json:"data"`
	}
	overview := decode[body[wire.BillingOverview]](t, h.get("/api/v1/billing")).Data
	syncOnly := decode[body[wire.BillingSyncState]](t, h.get("/api/v1/billing/sync")).Data
	if overview.Sync.NextRunAt != billingNext.Unix() {
		t.Errorf("nextRunAt = %d, want %d", overview.Sync.NextRunAt, billingNext.Unix())
	}
	if len(overview.Rows) != 1 || len(overview.Unmatched) != 1 {
		t.Errorf("overview = %+v", overview)
	}
	if syncOnly.IntervalSeconds != 3600 || len(syncOnly.Runs) != 2 || syncOnly.Running == nil {
		t.Errorf("sync = %+v", syncOnly)
	}
	raw := h.get("/api/v1/billing/sync").Body.String()
	for _, absent := range []string{`"rows"`, `"unmatched":[`} {
		if strings.Contains(raw, absent) {
			t.Errorf("/billing/sync memuat %s: %s", absent, raw)
		}
	}
}

// Daftar kosong dari sumber (nil) tetap ditulis [], bukan null: tipe TypeScript-nya
// BillingRow[] tidak mengizinkan null.
func TestBillingNeverWritesNullForLists(t *testing.T) {
	h := newBillingHarness(t, &fakeBilling{}, fixedNextRun)
	for _, path := range billingPaths {
		raw := h.get(path).Body.String()
		// Satu-satunya null yang sah di sini adalah sinkron yang tidak berjalan.
		if strings.Contains(strings.ReplaceAll(raw, `"running":null`, ""), "null") {
			t.Errorf("%s memuat null: %s", path, raw)
		}
		if !strings.Contains(raw, `"runs":[]`) {
			t.Errorf("%s tanpa \"runs\":[]: %s", path, raw)
		}
	}
	raw := h.get("/api/v1/billing").Body.String()
	for _, list := range []string{`"rows":[]`, `"unmatched":[]`} {
		if !strings.Contains(raw, list) {
			t.Errorf("/api/v1/billing tanpa %s: %s", list, raw)
		}
	}
}

func TestBillingPassesTheScheduleFromTheInjectedFunction(t *testing.T) {
	source := &fakeBilling{}
	var asked []time.Time
	h := newBillingHarness(t, source, func(now time.Time) time.Time {
		asked = append(asked, now)
		return now.Add(55*time.Minute + 57*time.Second)
	})
	for _, path := range billingPaths {
		if rec := h.get(path); rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d; body %s", path, rec.Code, rec.Body)
		}
	}
	want := billingNow.Add(55*time.Minute + 57*time.Second)
	if len(asked) != 2 || !asked[0].Equal(billingNow) || !asked[1].Equal(billingNow) {
		t.Errorf("fungsi jadwal ditanya dengan %v, want dua kali %v", asked, billingNow)
	}
	if len(source.nextRuns) != 2 || !source.nextRuns[0].Equal(want) || !source.nextRuns[1].Equal(want) {
		t.Errorf("sumber menerima nextRunAt %v, want %v", source.nextRuns, want)
	}
}

// Kontrak: nextRunAt selalu setelah saat jawaban dibuat. Fungsi jadwal yang
// melanggarnya adalah galat pemrograman: 500, bukan jawaban dengan waktu lampau.
func TestBillingRefusesAScheduleThatIsNotInTheFuture(t *testing.T) {
	for name, next := range map[string]time.Time{
		"sama dengan sekarang": billingNow,
		"sebelum sekarang":     billingNow.Add(-time.Second),
		"waktu nol":            {},
	} {
		source := &fakeBilling{}
		h := newBillingHarness(t, source, func(time.Time) time.Time { return next })
		for _, path := range billingPaths {
			rec := h.get(path)
			if rec.Code != http.StatusInternalServerError || strings.TrimSpace(rec.Body.String()) != `{"error":"internal"}` {
				t.Errorf("%s %s: status %d body %q, want 500 internal", name, path, rec.Code, rec.Body)
			}
		}
		if source.callCount() != 0 {
			t.Errorf("%s: sumber dipanggil walau jadwalnya tidak masuk akal", name)
		}
		if !strings.Contains(h.logs.String(), "tidak setelah sekarang") {
			t.Errorf("%s: galat jadwal tidak dicatat: %s", name, h.logs)
		}
	}
}

func TestBillingDisabledAnswers503WithoutStoppingTheServer(t *testing.T) {
	source := &fakeBilling{overview: sampleOverview(), sync: sampleOverview().Sync}
	cases := map[string]struct {
		source  BillingSource
		nextRun func(time.Time) time.Time
	}{
		"tanpa sumber dan jadwal": {nil, nil},
		"sumber tanpa jadwal":     {source, nil},
		"jadwal tanpa sumber":     {nil, fixedNextRun},
	}
	for name, tc := range cases {
		h := newBillingHarness(t, tc.source, tc.nextRun)
		for _, path := range billingPaths {
			rec := h.get(path)
			if rec.Code != http.StatusServiceUnavailable || strings.TrimSpace(rec.Body.String()) != `{"error":"billing_disabled"}` {
				t.Errorf("%s %s: status %d body %q, want 503 billing_disabled", name, path, rec.Code, rec.Body)
			}
			// Tanpa tiket tetap 401: keadaan fitur tidak dibuka ke orang asing.
			if rec := h.do(http.MethodGet, path, "", nil); rec.Code != http.StatusUnauthorized {
				t.Errorf("%s %s tanpa tiket: status = %d, want 401", name, path, rec.Code)
			}
			// Metode tulis tetap ditolak (405; POST sinkron manual: 403 tanpa izin).
			wantPost := http.StatusMethodNotAllowed
			if path == "/api/v1/billing/sync" {
				wantPost = http.StatusForbidden
			}
			if rec := h.do(http.MethodPost, path, h.ticket(), nil); rec.Code != wantPost {
				t.Errorf("%s POST %s: status = %d, want %d", name, path, rec.Code, wantPost)
			}
			if got := rec.Header().Get("Cache-Control"); got != "no-store" {
				t.Errorf("%s %s: Cache-Control = %q", name, path, got)
			}
		}
		// Rute lain tetap hidup.
		if rec := h.get("/api/v1/summary"); rec.Code != http.StatusOK {
			t.Errorf("%s: /api/v1/summary status = %d, want 200", name, rec.Code)
		}
	}
	if source.callCount() != 0 {
		t.Error("sumber dipanggil walau billing mati")
	}
}

func TestBillingDatabaseErrorDoesNotLeakItsText(t *testing.T) {
	secret := `billing: baca status billing pelanggan: ERROR: relation "customers" does not exist (SQLSTATE 42P01) host=10.9.8.7 password=hunter2`
	source := &fakeBilling{err: errors.New(secret)}
	h := newBillingHarness(t, source, fixedNextRun)
	for _, path := range billingPaths {
		rec := h.get(path)
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("%s: status = %d, want 500", path, rec.Code)
		}
		if got := rec.Body.String(); got != "{\"error\":\"internal\"}\n" {
			t.Errorf("%s: body = %q, want exactly {\"error\":\"internal\"}", path, got)
		}
		for _, leak := range []string{"customers", "hunter2", "10.9.8.7", "SQLSTATE", "relation", "password", "billing:"} {
			if strings.Contains(rec.Body.String(), leak) {
				t.Errorf("%s: jawaban membocorkan %q: %s", path, leak, rec.Body)
			}
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control = %q", path, got)
		}
	}
	// Detailnya ada di log server, untuk operator.
	if !strings.Contains(h.logs.String(), `relation \"customers\" does not exist`) {
		t.Errorf("galat tidak dicatat di log: %s", h.logs)
	}
}

func TestBillingReadsAreBoundedInTime(t *testing.T) {
	source := &fakeBilling{}
	h := newBillingHarness(t, source, fixedNextRun)
	before := time.Now()
	if rec := h.get("/api/v1/billing"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	after := time.Now()
	source.mu.Lock()
	deadline := source.deadline
	source.mu.Unlock()
	if deadline.IsZero() {
		t.Fatal("pembacaan database tanpa batas waktu")
	}
	if deadline.Before(before.Add(billingTimeout-time.Second)) || deadline.After(after.Add(billingTimeout)) {
		t.Errorf("batas waktu = %s dari sekarang, want sekitar %s", deadline.Sub(before), billingTimeout)
	}
}

// Klien yang sudah pergi tidak menerima apa pun, dan pembacaan dihentikan
// bersama permintaannya (konteks permintaan diteruskan ke sumber).
func TestBillingStopsReadingWhenTheClientLeaves(t *testing.T) {
	source := &fakeBilling{block: true, started: make(chan struct{}, 1)}
	h := newBillingHarness(t, source, fixedNextRun)
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+h.ticket())
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		h.handler.ServeHTTP(rec, req)
		close(done)
	}()
	select {
	case <-source.started:
	case <-time.After(5 * time.Second):
		t.Fatal("sumber tidak dipanggil")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("handler tidak berhenti setelah klien pergi")
	}
	if rec.Body.Len() != 0 {
		t.Errorf("klien yang sudah pergi menerima %q", rec.Body)
	}
	if strings.Contains(h.logs.String(), "level=ERROR") {
		t.Errorf("klien yang pergi dicatat sebagai galat server: %s", h.logs)
	}
}

func TestBillingRejectsUnknownOrRepeatedParameters(t *testing.T) {
	source := &fakeBilling{}
	h := newBillingHarness(t, source, fixedNextRun)
	for _, path := range billingPaths {
		for _, query := range []string{"?x=1", "?limit=5", "?_=123", "?a=1&a=2"} {
			rec := h.get(path + query)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("%s%s: status = %d, want 400", path, query, rec.Code)
			}
		}
	}
	if source.callCount() != 0 {
		t.Errorf("sumber dipanggil %d kali untuk permintaan yang ditolak", source.callCount())
	}
}

func TestBillingExtraPathsAreNotFound(t *testing.T) {
	source := &fakeBilling{}
	h := newBillingHarness(t, source, fixedNextRun)
	for _, path := range []string{"/api/v1/billing/", "/api/v1/billing/other", "/api/v1/billing/sync/", "/api/v1/billing/sync/x", "/api/v1/billingx"} {
		rec := h.get(path)
		if rec.Code != http.StatusNotFound || strings.TrimSpace(rec.Body.String()) != `{"error":"not_found"}` {
			t.Errorf("%s: status %d body %q, want 404 not_found", path, rec.Code, rec.Body)
		}
	}
	if source.callCount() != 0 {
		t.Error("sumber dipanggil untuk alamat yang tidak ada")
	}
}

type fakeTrigger struct {
	calls int
	err   error
}

func (f *fakeTrigger) TriggerManual(context.Context) (billing.RunOutcome, error) {
	f.calls++
	return billing.RunOutcome{}, f.err
}

func TestBillingManualSync(t *testing.T) {
	source := &fakeBilling{}
	trig := &fakeTrigger{}
	h := newBillingHarness(t, source, fixedNextRun)
	h.handler = NewHandler(Options{
		Logger: slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
		Data:   h.mgr, Verifier: h.tokens, AllowedOrigins: []string{apiOrigin},
		Billing: source, BillingNextRun: fixedNextRun, BillingTrigger: trig,
		Now: func() time.Time { return billingNow },
	})
	const path = "/api/v1/billing/sync"
	issue := func(perms ...string) string {
		tk, err := h.tokens.IssueWithPerms("u", perms, time.Now(), time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		return tk
	}

	if rec := h.do(http.MethodPost, path, "", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonim: status = %d, want 401", rec.Code)
	}
	for name, tk := range map[string]string{"hanya-lihat": h.ticket(), "izin lain": issue("alert:handle")} {
		if rec := h.do(http.MethodPost, path, tk, nil); rec.Code != http.StatusForbidden {
			t.Errorf("%s: status = %d, want 403", name, rec.Code)
		}
	}
	if trig.calls != 0 {
		t.Fatalf("pemicu dipanggil %d kali tanpa izin", trig.calls)
	}

	rec := h.do(http.MethodPost, path, issue("billing:manage"), nil)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"message":"sinkronisasi manual berhasil dijalankan","ok":true}` {
		t.Errorf("sukses: status %d body %q", rec.Code, rec.Body)
	}

	trig.err = fmt.Errorf("lapisan: %w", billing.ErrRunInProgress)
	rec = h.do(http.MethodPost, path, issue("billing:manage"), nil)
	if rec.Code != http.StatusConflict || strings.TrimSpace(rec.Body.String()) != `{"error":"sinkronisasi sedang berjalan"}` {
		t.Errorf("berjalan: status %d body %q", rec.Code, rec.Body)
	}

	trig.err = errors.New("host=10.9.8.7 password=hunter2")
	rec = h.do(http.MethodPost, path, issue("billing:manage"), nil)
	if rec.Code != http.StatusBadGateway || strings.Contains(rec.Body.String(), "hunter2") || strings.Contains(rec.Body.String(), "10.9.8.7") {
		t.Errorf("gagal: status %d body %q", rec.Code, rec.Body)
	}
}
