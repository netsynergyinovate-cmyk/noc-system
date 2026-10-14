package httpapi

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/archive"
	"noc-isp/backend/internal/state"
)

// historyNow adalah "sekarang" tetap untuk test histori; sengaja bukan
// kelipatan langkah mana pun supaya pembulatan ikut teruji.
var historyNow = time.Date(2026, 10, 7, 12, 34, 57, 0, time.UTC)

const routerUUID = "11111111-2222-4333-8444-555555555555"

// fakeHistory mencatat query terakhir dan menjawab sesuai isian.
type fakeHistory struct {
	mu       sync.Mutex
	queries  []archive.HistoryQuery
	deadline time.Time
	points   []archive.HistoryPoint
	err      error
	// block, bila diisi, menahan jawaban sampai ditutup; started diberi tanda
	// setiap kali ada query yang masuk.
	block   chan struct{}
	started chan struct{}
}

func (f *fakeHistory) History(ctx context.Context, q archive.HistoryQuery) ([]archive.HistoryPoint, error) {
	f.mu.Lock()
	f.queries = append(f.queries, q)
	f.deadline, _ = ctx.Deadline()
	f.mu.Unlock()
	if f.started != nil {
		f.started <- struct{}{}
	}
	if f.block != nil {
		select {
		case <-f.block:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return f.points, f.err
}

func (f *fakeHistory) last(t *testing.T) archive.HistoryQuery {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.queries) == 0 {
		t.Fatal("sumber histori tidak dipanggil")
	}
	return f.queries[len(f.queries)-1]
}

func (f *fakeHistory) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.queries)
}

type historyHarness struct {
	t    *testing.T
	api  *historyAPI
	mux  http.Handler
	logs *bytes.Buffer
}

// newHistoryHarness memasang rute histori langsung (tanpa pemeriksaan tiket,
// yang diuji terpisah) dengan jam tetap.
func newHistoryHarness(t *testing.T, source HistorySource) *historyHarness {
	t.Helper()
	logs := &bytes.Buffer{}
	api := newHistoryAPI(source, slog.New(slog.NewTextHandler(logs, nil)))
	api.now = func() time.Time { return historyNow }
	return &historyHarness{t: t, api: api, mux: newDashboardMux(state.NewManager(), api), logs: logs}
}

func (h *historyHarness) do(method, query string) *httptest.ResponseRecorder {
	h.t.Helper()
	req := httptest.NewRequest(method, "/api/v1/traffic/history"+query, nil)
	rec := httptest.NewRecorder()
	h.mux.ServeHTTP(rec, req)
	return rec
}

func (h *historyHarness) get(query string) *httptest.ResponseRecorder {
	h.t.Helper()
	return h.do(http.MethodGet, query)
}

type historyBody struct {
	Data struct {
		From  int64     `json:"from"`
		To    int64     `json:"to"`
		Step  int64     `json:"step"`
		Times []int64   `json:"times"`
		Rx    []float64 `json:"rx"`
		Tx    []float64 `json:"tx"`
	} `json:"data"`
}

func unix(offset time.Duration) string {
	return strconv.FormatInt(historyNow.Add(offset).Unix(), 10)
}

func TestHistoryRequiresAValidTicket(t *testing.T) {
	source := &fakeHistory{}
	h := newAPIHarnessWithHistory(t, source)
	for name, ticket := range map[string]string{"tanpa tiket": "", "tiket rusak": "bukan.tiket"} {
		rec := h.do(http.MethodGet, "/api/v1/traffic/history?range=1h", ticket, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", name, rec.Code)
		}
	}
	if source.calls() != 0 {
		t.Error("sumber dipanggil tanpa tiket yang sah")
	}
	rec := h.get("/api/v1/traffic/history?range=1h")
	if rec.Code != http.StatusOK {
		t.Errorf("dengan tiket: status = %d, want 200; body %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", rec.Header().Get("Cache-Control"))
	}
}

// newAPIHarnessWithHistory memakai handler lengkap (CORS, tiket, header) dan
// sumber histori palsu.
func newAPIHarnessWithHistory(t *testing.T, source HistorySource) *apiHarness {
	t.Helper()
	h := newAPIHarness(t)
	h.handler = NewHandler(Options{
		Logger:         slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
		Data:           h.mgr,
		Verifier:       h.tokens,
		AllowedOrigins: []string{apiOrigin},
		History:        source,
	})
	return h
}

func TestHistoryRangePicksTheAutomaticStepTheDashboardUses(t *testing.T) {
	// Langkah otomatis harus sama dengan yang dipakai pemilih rentang di
	// dashboard: 1 jam 10 dtk, 6 jam 1 mnt, 24 jam 5 mnt, 7 hari 30 mnt.
	cases := []struct {
		rng    string
		span   time.Duration
		step   int64
		maxPts int
		minPts int
	}{
		{"1h", time.Hour, 10, 360, 360},
		{"6h", 6 * time.Hour, 60, 360, 360},
		{"24h", 24 * time.Hour, 300, 288, 288},
		{"7d", 7 * 24 * time.Hour, 1800, 336, 336},
		{"30d", 30 * 24 * time.Hour, 7200, 360, 360},
	}
	for _, tc := range cases {
		t.Run(tc.rng, func(t *testing.T) {
			source := &fakeHistory{}
			h := newHistoryHarness(t, source)
			rec := h.get("?range=" + tc.rng)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d; body %s", rec.Code, rec.Body)
			}
			q := source.last(t)
			if q.Step != time.Duration(tc.step)*time.Second {
				t.Errorf("Step = %s, want %ds", q.Step, tc.step)
			}
			if !q.To.Equal(historyNow) || !q.From.Equal(historyNow.Add(-tc.span)) {
				t.Errorf("jendela = %s .. %s, want %s sebelum sekarang", q.From, q.To, tc.span)
			}
			body := decode[historyBody](t, rec)
			if body.Data.Step != tc.step || body.Data.To != historyNow.Unix() {
				t.Errorf("respons step/to = %d/%d", body.Data.Step, body.Data.To)
			}
			if body.Data.From%tc.step != 0 || body.Data.From > historyNow.Add(-tc.span).Unix() {
				t.Errorf("from = %d, want kelipatan %d dan tidak setelah awal jendela", body.Data.From, tc.step)
			}
			points := int((body.Data.To - body.Data.From + tc.step - 1) / tc.step)
			if points < tc.minPts || points > tc.maxPts+1 {
				t.Errorf("titik = %d, want sekitar %d", points, tc.maxPts)
			}
		})
	}
}

func TestHistoryFromToChoosesAStepForTheWindow(t *testing.T) {
	source := &fakeHistory{}
	h := newHistoryHarness(t, source)
	if rec := h.get("?from=" + unix(-2*time.Hour) + "&to=" + unix(0)); rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body %s", rec.Code, rec.Body)
	}
	q := source.last(t)
	// 7200 dtk: 15 dtk menghasilkan 480 titik (terlalu banyak), 30 dtk 240.
	if q.Step != 30*time.Second {
		t.Errorf("Step = %s, want 30s", q.Step)
	}
	if q.From.Unix() != historyNow.Add(-2*time.Hour).Unix() || q.To.Unix() != historyNow.Unix() {
		t.Errorf("jendela = %s .. %s", q.From, q.To)
	}

	// Jendela pendek memakai langkah satu detik.
	if rec := h.get("?from=" + unix(-5*time.Minute) + "&to=" + unix(0)); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := source.last(t).Step; got != time.Second {
		t.Errorf("Step jendela 5 menit = %s, want 1s", got)
	}

	// Jendela terpanjang tetap mendapat langkah yang sah.
	if rec := h.get("?from=" + unix(-archive.MaxHistoryRange) + "&to=" + unix(0)); rec.Code != http.StatusOK {
		t.Fatalf("jendela terpanjang: status = %d; body %s", rec.Code, rec.Body)
	}
}

func TestHistoryExplicitStepAndRouterReachTheSource(t *testing.T) {
	source := &fakeHistory{}
	h := newHistoryHarness(t, source)
	rec := h.get("?range=1h&step=60&router=" + routerUUID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body %s", rec.Code, rec.Body)
	}
	q := source.last(t)
	if q.Step != time.Minute || q.RouterID != routerUUID {
		t.Errorf("query = %+v, want step 1m dan router %s", q, routerUUID)
	}
	if body := decode[historyBody](t, rec); body.Data.Step != 60 {
		t.Errorf("step respons = %d, want 60", body.Data.Step)
	}
}

func TestHistoryAlignsFromToTheStepInTheResponse(t *testing.T) {
	h := newHistoryHarness(t, &fakeHistory{})
	from := historyNow.Add(-time.Hour).Unix()
	rec := h.get("?from=" + strconv.FormatInt(from, 10) + "&to=" + unix(0) + "&step=300")
	body := decode[historyBody](t, rec)
	if body.Data.From%300 != 0 || body.Data.From > from || from-body.Data.From >= 300 {
		t.Errorf("from = %d untuk permintaan %d; want kelipatan 300 tepat di bawahnya", body.Data.From, from)
	}
	if body.Data.To != historyNow.Unix() {
		t.Errorf("to = %d, want %d (apa adanya)", body.Data.To, historyNow.Unix())
	}
}

func TestHistoryReturnsTheSeriesAsAlignedColumns(t *testing.T) {
	at := time.Unix(1_790_000_000, 0).UTC()
	source := &fakeHistory{points: []archive.HistoryPoint{
		{At: at, RxMbps: 12.5, TxMbps: 1.25},
		{At: at.Add(10 * time.Second), RxMbps: 13.5, TxMbps: 2.25},
	}}
	rec := newHistoryHarness(t, source).get("?range=1h")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q", ct)
	}
	body := decode[historyBody](t, rec)
	if len(body.Data.Times) != 2 || body.Data.Times[0] != at.Unix() || body.Data.Times[1] != at.Unix()+10 ||
		body.Data.Rx[0] != 12.5 || body.Data.Rx[1] != 13.5 || body.Data.Tx[0] != 1.25 || body.Data.Tx[1] != 2.25 {
		t.Errorf("data = %+v", body.Data)
	}
}

func TestHistoryEmptyResultIsEmptyArraysNotNull(t *testing.T) {
	rec := newHistoryHarness(t, &fakeHistory{}).get("?range=1h")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	for _, field := range []string{`"times":[]`, `"rx":[]`, `"tx":[]`} {
		if !strings.Contains(rec.Body.String(), field) {
			t.Errorf("body %s tidak memuat %s (grafik di dashboard membutuhkan array)", rec.Body, field)
		}
	}
}

func TestHistoryRejectsBadRequestsWithoutCallingTheSource(t *testing.T) {
	cases := map[string]string{
		"tanpa parameter":            "",
		"parameter tak dikenal":      "?range=1h&limt=5",
		"parameter diulang":          "?range=1h&range=6h",
		"range tak dikenal":          "?range=2h",
		"range dan from":             "?range=1h&from=" + unix(-time.Hour),
		"range dan to":               "?range=1h&to=" + unix(0),
		"hanya from":                 "?from=" + unix(-time.Hour),
		"hanya to":                   "?to=" + unix(0),
		"from bukan angka":           "?from=kemarin&to=" + unix(0),
		"to bukan angka":             "?from=" + unix(-time.Hour) + "&to=nanti",
		"from negatif":               "?from=-5&to=" + unix(0),
		"from desimal":               "?from=1.5&to=" + unix(0),
		"to meluap":                  "?from=0&to=99999999999999",
		"from sama dengan to":        "?from=" + unix(-time.Hour) + "&to=" + unix(-time.Hour),
		"from setelah to":            "?from=" + unix(0) + "&to=" + unix(-time.Hour),
		"to di masa depan":           "?from=" + unix(-time.Hour) + "&to=" + unix(2*time.Minute),
		"jendela lebih dari 31 hari": "?from=" + unix(-archive.MaxHistoryRange-time.Second) + "&to=" + unix(0),
		"step nol":                   "?range=1h&step=0",
		"step negatif":               "?range=1h&step=-1",
		"step bukan angka":           "?range=1h&step=cepat",
		"step kosong":                "?range=1h&step=",
		"step lebih dari sehari":     "?range=30d&step=86401",
		"terlalu banyak titik":       "?range=7d&step=60",
		"2501 titik":                 "?from=" + unix(-2501*time.Second) + "&to=" + unix(0) + "&step=1",
		"router bukan UUID":          "?range=1h&router=r1",
		"router berisi SQL":          "?range=1h&router=" + url.QueryEscape("x'; DROP TABLE traffic_samples;--"),
	}
	for name, query := range cases {
		t.Run(name, func(t *testing.T) {
			source := &fakeHistory{}
			h := newHistoryHarness(t, source)
			rec := h.get(query)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body %s", rec.Code, rec.Body)
			}
			if got := decode[errorResponse](t, rec); got.Error != "invalid_request" || got.Message == "" {
				t.Errorf("error = %+v, want invalid_request dengan pesan", got)
			}
			if source.calls() != 0 {
				t.Error("sumber dipanggil untuk permintaan yang salah")
			}
		})
	}
}

func TestHistoryAcceptsTheBoundaries(t *testing.T) {
	cases := map[string]string{
		"to sedikit di depan (selisih jam)": "?from=" + unix(-time.Hour) + "&to=" + unix(30*time.Second),
		"jendela tepat 31 hari":             "?from=" + unix(-archive.MaxHistoryRange) + "&to=" + unix(0),
		"step satu detik":                   "?from=" + unix(-time.Minute) + "&to=" + unix(0) + "&step=1",
		"step sehari":                       "?range=30d&step=86400",
		"tepat 2500 titik":                  "?from=" + unix(-2500*time.Second) + "&to=" + unix(0) + "&step=1",
		"7 hari per 5 menit":                "?range=7d&step=300&router=" + routerUUID,
	}
	for name, query := range cases {
		t.Run(name, func(t *testing.T) {
			if rec := newHistoryHarness(t, &fakeHistory{}).get(query); rec.Code != http.StatusOK {
				t.Errorf("status = %d, want 200; body %s", rec.Code, rec.Body)
			}
		})
	}
}

func TestHistoryOnlyAllowsReads(t *testing.T) {
	source := &fakeHistory{}
	h := newHistoryHarness(t, source)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := h.do(method, "?range=1h")
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: status = %d, want 405", method, rec.Code)
		}
	}
	if rec := h.do(http.MethodHead, "?range=1h"); rec.Code != http.StatusOK {
		t.Errorf("HEAD: status = %d, want 200", rec.Code)
	}
	if source.calls() != 1 { // hanya HEAD yang sampai ke sumber
		t.Errorf("sumber dipanggil %d kali, want 1", source.calls())
	}
}

func TestHistoryWithoutAnArchiveSaysSoInsteadOfPretendingToBeEmpty(t *testing.T) {
	h := newHistoryHarness(t, nil)
	rec := h.get("?range=1h")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	got := decode[errorResponse](t, rec)
	if got.Error != "history_unavailable" || !strings.Contains(got.Message, "DATABASE_URL") {
		t.Errorf("error = %+v, want history_unavailable yang menyebut DATABASE_URL", got)
	}
	// Permintaan yang salah tetap dijawab 400, bukan 503.
	if rec := h.get("?range=2h"); rec.Code != http.StatusBadRequest {
		t.Errorf("permintaan salah tanpa arsip: status = %d, want 400", rec.Code)
	}
}

func TestHistorySourceFailureDoesNotLeakDetails(t *testing.T) {
	secret := "postgres://noc:rahasia-banget@10.1.2.3:5432/noc"
	source := &fakeHistory{err: errors.New("dial " + secret + ": connection refused")}
	h := newHistoryHarness(t, source)
	rec := h.get("?range=1h")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "rahasia") || strings.Contains(rec.Body.String(), "10.1.2.3") {
		t.Errorf("respons membocorkan detail database: %s", rec.Body)
	}
	if got := decode[errorResponse](t, rec); got.Error != "history_unavailable" {
		t.Errorf("error = %+v", got)
	}
	if !strings.Contains(h.logs.String(), "query histori traffic gagal") {
		t.Errorf("kegagalan tidak dicatat di log: %s", h.logs)
	}
}

func TestHistoryQueryHasADeadlineAndTimeoutsSaySo(t *testing.T) {
	source := &fakeHistory{err: context.DeadlineExceeded}
	h := newHistoryHarness(t, source)
	before := time.Now()
	rec := h.get("?range=1h")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if msg := decode[errorResponse](t, rec).Message; !strings.Contains(msg, "terlalu lama") {
		t.Errorf("pesan = %q, want menyebut query terlalu lama", msg)
	}
	source.mu.Lock()
	deadline := source.deadline
	source.mu.Unlock()
	if deadline.IsZero() {
		t.Fatal("context ke sumber tidak punya batas waktu")
	}
	if remaining := deadline.Sub(before); remaining < historyTimeout-time.Second || remaining > historyTimeout+time.Second {
		t.Errorf("batas waktu = %s dari sekarang, want sekitar %s", remaining, historyTimeout)
	}
}

func TestHistoryStaysSilentWhenTheClientHasGone(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	source := &fakeHistory{block: make(chan struct{}), started: make(chan struct{}, 1)}
	h := newHistoryHarness(t, source)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/traffic/history?range=1h", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		h.mux.ServeHTTP(rec, req)
		close(done)
	}()
	<-source.started
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler tidak berhenti setelah klien pergi")
	}
	if rec.Body.Len() != 0 || strings.Contains(h.logs.String(), "gagal") {
		t.Errorf("klien yang pergi dijawab/dicatat sebagai galat: body %q log %q", rec.Body, h.logs)
	}
}

func TestHistoryLimitsConcurrentQueries(t *testing.T) {
	source := &fakeHistory{block: make(chan struct{}), started: make(chan struct{}, maxConcurrentHistory)}
	h := newHistoryHarness(t, source)

	var wg sync.WaitGroup
	results := make([]*httptest.ResponseRecorder, maxConcurrentHistory)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = h.get("?range=1h")
		}()
	}
	for range maxConcurrentHistory {
		select {
		case <-source.started:
		case <-time.After(2 * time.Second):
			t.Fatal("query belum semuanya berjalan")
		}
	}

	rec := h.get("?range=1h")
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") != "1" {
		t.Errorf("saat penuh: status %d Retry-After %q; want 503 dan 1", rec.Code, rec.Header().Get("Retry-After"))
	}
	if got := decode[errorResponse](t, rec); got.Error != "busy" {
		t.Errorf("error = %+v, want busy", got)
	}
	if source.calls() != maxConcurrentHistory {
		t.Errorf("sumber dipanggil %d kali, want %d (yang ditolak tidak boleh sampai ke database)", source.calls(), maxConcurrentHistory)
	}

	close(source.block)
	wg.Wait()
	for i, r := range results {
		if r.Code != http.StatusOK {
			t.Errorf("query %d: status = %d, want 200", i, r.Code)
		}
	}
	// Slot dilepas: permintaan berikutnya dilayani lagi.
	source.started = nil
	if rec := h.get("?range=1h"); rec.Code != http.StatusOK {
		t.Errorf("setelah penuh: status = %d, want 200 (slot harus dilepas)", rec.Code)
	}
}

func TestHistorySlotIsReleasedAfterAFailure(t *testing.T) {
	source := &fakeHistory{err: errors.New("mati")}
	h := newHistoryHarness(t, source)
	for i := 0; i < maxConcurrentHistory*3; i++ {
		if rec := h.get("?range=1h"); rec.Code != http.StatusServiceUnavailable || decode[errorResponse](t, rec).Error != "history_unavailable" {
			t.Fatalf("permintaan %d: status %d %s; slot bocor bila berubah menjadi busy", i, rec.Code, rec.Body)
		}
	}
}

func TestHistoryUnknownSubpathIsNotFound(t *testing.T) {
	h := newHistoryHarness(t, &fakeHistory{})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/traffic/historyx", nil)
	rec := httptest.NewRecorder()
	h.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}
