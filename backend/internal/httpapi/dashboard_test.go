package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/state"
)

const (
	apiSecret = "0123456789abcdef0123456789abcdef"
	apiOrigin = "http://localhost:3000"
)

type apiHarness struct {
	t       *testing.T
	handler http.Handler
	tokens  *auth.Tokens
	mgr     *state.Manager
}

func newAPIHarness(t *testing.T) *apiHarness {
	t.Helper()
	tokens, err := auth.NewTokens(apiSecret)
	if err != nil {
		t.Fatal(err)
	}
	mgr := state.NewManager()
	for _, r := range []state.Router{
		{ID: "r1", Name: "RTR-1", Host: "10.0.0.1", Active: true},
		{ID: "r2", Name: "RTR-2", Host: "10.0.0.2", Active: false},
	} {
		if err := mgr.UpsertRouter(r); err != nil {
			t.Fatal(err)
		}
	}
	customers := []state.Customer{
		{ID: "c1", Name: "budi Santoso", PPPoEUsername: "budi.santoso001", Address: "Jl. Mawar 1", ODPName: "ODP-MWR-01", RouterID: "r1", IsOnline: true, HasOptical: true, OpticalPowerDbm: -20},
		{ID: "c2", Name: "Siti Wati", PPPoEUsername: "siti.wati002", Address: "Jl. Melati 9", RouterID: "r2", IsOnline: true, HasOptical: true, OpticalPowerDbm: -27},
		{ID: "c3", Name: "Agus Hidayat", PPPoEUsername: "agus.hidayat003", Address: "Jl. Mawar 7", RouterID: "r1", IsOnline: false},
		{ID: "c4", Name: "Andi", PPPoEUsername: "andi004", RouterID: "r2", IsOnline: true},
		{ID: "c5", Name: "Dewi", PPPoEUsername: "dewi005", RouterID: "r1", IsOnline: false},
	}
	for _, c := range customers {
		if err := mgr.UpsertCustomer(c); err != nil {
			t.Fatal(err)
		}
	}
	for s := int64(100); s < 110; s++ {
		_, _ = mgr.RecordTraffic("r1", state.TrafficPoint{Time: s, RxMbps: 10, TxMbps: 1})
		_, _ = mgr.RecordTraffic("r2", state.TrafficPoint{Time: s, RxMbps: float64(s - 100), TxMbps: 2})
	}

	handler := NewHandler(Options{
		Logger:         slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
		Data:           mgr,
		Verifier:       tokens,
		AllowedOrigins: []string{apiOrigin},
	})
	return &apiHarness{t: t, handler: handler, tokens: tokens, mgr: mgr}
}

func (h *apiHarness) ticket() string {
	token, err := h.tokens.Issue("user-1", time.Now(), time.Minute)
	if err != nil {
		h.t.Fatal(err)
	}
	return token
}

// do mengirim permintaan; ticket kosong berarti tanpa header Authorization.
func (h *apiHarness) do(method, path, ticket string, headers map[string]string) *httptest.ResponseRecorder {
	h.t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if ticket != "" {
		req.Header.Set("Authorization", "Bearer "+ticket)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

func (h *apiHarness) get(path string) *httptest.ResponseRecorder {
	h.t.Helper()
	return h.do(http.MethodGet, path, h.ticket(), nil)
}

type customersBody struct {
	Data []struct {
		ID            string `json:"id"`
		PPPoEUsername string `json:"pppoeUsername"`
		OdpName       string `json:"odpName"`
	} `json:"data"`
	Meta pageMeta `json:"meta"`
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func customerIDs(body customersBody) string {
	ids := ""
	for _, c := range body.Data {
		ids += c.ID + " "
	}
	return ids
}

func TestAPIRequiresAValidTicket(t *testing.T) {
	h := newAPIHarness(t)
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
	for _, path := range []string{"/api/v1/summary", "/api/v1/routers", "/api/v1/customers", "/api/v1/traffic", "/api/v1/tidak-ada"} {
		for name, authorization := range headers {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			if authorization != "" {
				req.Header.Set("Authorization", authorization)
			}
			rec := httptest.NewRecorder()
			h.handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s (%s): status = %d, want 401", path, name, rec.Code)
			}
			if got := rec.Header().Get("WWW-Authenticate"); got != "Bearer" {
				t.Errorf("%s (%s): WWW-Authenticate = %q, want Bearer", path, name, got)
			}
			if strings.Contains(rec.Body.String(), "budi") || strings.Contains(rec.Body.String(), `"data"`) {
				t.Errorf("%s (%s): respons 401 membocorkan data: %s", path, name, rec.Body.String())
			}
		}
	}
}

func TestAPIAcceptsBearerSchemeInAnyCase(t *testing.T) {
	h := newAPIHarness(t)
	rec := h.do(http.MethodGet, "/api/v1/summary", "", map[string]string{"Authorization": "bearer " + h.ticket()})
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestAPIEndpointsAbsentWithoutVerifier(t *testing.T) {
	handler := NewHandler(Options{Logger: slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)), Data: state.NewManager()})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/customers", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404: data tidak boleh dilayani tanpa pemeriksaan tiket", rec.Code)
	}
}

func TestAPIOnlyAllowsReads(t *testing.T) {
	h := newAPIHarness(t)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := h.do(method, "/api/v1/customers", h.ticket(), nil)
		if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != "GET, HEAD" {
			t.Errorf("%s: status = %d, Allow = %q; want 405 dan GET, HEAD", method, rec.Code, rec.Header().Get("Allow"))
		}
	}
	if rec := h.do(http.MethodHead, "/api/v1/summary", h.ticket(), nil); rec.Code != http.StatusOK {
		t.Errorf("HEAD: status = %d, want 200", rec.Code)
	}
}

func TestAPIUnknownPathWithTicketIs404JSON(t *testing.T) {
	rec := newAPIHarness(t).get("/api/v1/tidak-ada")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"not_found"`) {
		t.Errorf("status = %d, body = %s; want 404 JSON", rec.Code, rec.Body.String())
	}
}

func TestSummary(t *testing.T) {
	rec := newAPIHarness(t).get("/api/v1/summary")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body := decode[dataResponse[summaryData]](t, rec)
	want := `{"online":3,"offline":2,"weakSignal":1,"activeRouters":1,"totalRouters":2}`
	got, _ := json.Marshal(body.Data.Counts)
	if string(got) != want {
		t.Errorf("counts = %s, want %s", got, want)
	}
	if body.Data.GeneratedAt == 0 {
		t.Error("generatedAt kosong")
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

func TestRouters(t *testing.T) {
	rec := newAPIHarness(t).get("/api/v1/routers")
	body := decode[struct {
		Data []struct {
			ID     string `json:"id"`
			Active bool   `json:"active"`
		} `json:"data"`
	}](t, rec)
	if len(body.Data) != 2 || body.Data[0].ID != "r1" || !body.Data[0].Active || body.Data[1].Active {
		t.Errorf("routers = %+v", body.Data)
	}
}

func TestCustomersDefaultsSortedByNameWithMeta(t *testing.T) {
	body := decode[customersBody](t, newAPIHarness(t).get("/api/v1/customers"))
	// Agus, Andi, budi, Dewi, Siti (tanpa memedulikan huruf besar/kecil).
	if got := customerIDs(body); got != "c3 c4 c1 c5 c2 " {
		t.Errorf("urutan = %q, want %q", got, "c3 c4 c1 c5 c2 ")
	}
	if body.Meta != (pageMeta{Limit: 50, Offset: 0, Total: 5, HasMore: false}) {
		t.Errorf("meta = %+v", body.Meta)
	}
}

// Nama ODP ikut dalam daftar pelanggan (sumber tooltip peta); pelanggan yang
// ODP-nya belum diketahui menerima teks kosong.
func TestCustomersCarryTheirODPName(t *testing.T) {
	body := decode[customersBody](t, newAPIHarness(t).get("/api/v1/customers"))
	odp := map[string]string{}
	for _, c := range body.Data {
		odp[c.ID] = c.OdpName
	}
	if odp["c1"] != "ODP-MWR-01" || odp["c2"] != "" {
		t.Errorf("ODP per pelanggan = %v; c1 harus ODP-MWR-01 dan c2 kosong", odp)
	}
}

func TestCustomersFilters(t *testing.T) {
	h := newAPIHarness(t)
	tests := map[string]struct {
		path  string
		want  string
		total int
	}{
		"offline":         {"/api/v1/customers?status=offline", "c3 c5 ", 2},
		"online":          {"/api/v1/customers?status=online", "c4 c1 c2 ", 3},
		"sinyal lemah":    {"/api/v1/customers?status=weak", "c2 ", 1},
		"router":          {"/api/v1/customers?router=r2", "c4 c2 ", 2},
		"cari nama":       {"/api/v1/customers?q=BUDI", "c1 ", 1},
		"cari alamat":     {"/api/v1/customers?q=mawar", "c3 c1 ", 2},
		"gabungan":        {"/api/v1/customers?q=mawar&status=online&router=r1", "c1 ", 1},
		"tidak ada hasil": {"/api/v1/customers?q=zzzz", "", 0},
		"q dengan spasi":  {"/api/v1/customers?q=%20siti%20", "c2 ", 1},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			rec := h.get(tt.path)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
			body := decode[customersBody](t, rec)
			if got := customerIDs(body); got != tt.want || body.Meta.Total != tt.total {
				t.Errorf("hasil = %q (total %d), want %q (total %d)", got, body.Meta.Total, tt.want, tt.total)
			}
		})
	}
}

func TestCustomersEmptyResultIsAnArrayNotNull(t *testing.T) {
	rec := newAPIHarness(t).get("/api/v1/customers?q=zzzz")
	if !strings.Contains(rec.Body.String(), `"data":[]`) {
		t.Errorf("body = %s, want data kosong berupa []", rec.Body.String())
	}
}

func TestCustomersPagination(t *testing.T) {
	h := newAPIHarness(t)
	var seen []string
	for offset := 0; ; offset += 2 {
		rec := h.get("/api/v1/customers?limit=2&offset=" + strconv.Itoa(offset))
		body := decode[customersBody](t, rec)
		if body.Meta.Limit != 2 || body.Meta.Offset != offset || body.Meta.Total != 5 {
			t.Fatalf("meta = %+v pada offset %d", body.Meta, offset)
		}
		for _, c := range body.Data {
			seen = append(seen, c.ID)
		}
		wantMore := offset+2 < 5
		if body.Meta.HasMore != wantMore {
			t.Errorf("offset %d: hasMore = %v, want %v", offset, body.Meta.HasMore, wantMore)
		}
		if !body.Meta.HasMore {
			break
		}
	}
	if got := strings.Join(seen, " "); got != "c3 c4 c1 c5 c2" {
		t.Errorf("semua halaman = %q, want tiap pelanggan tepat sekali dalam urutan yang sama", got)
	}

	past := decode[customersBody](t, h.get("/api/v1/customers?offset=999"))
	if len(past.Data) != 0 || past.Meta.Total != 5 || past.Meta.HasMore {
		t.Errorf("offset melewati total: %+v", past)
	}
}

func TestCustomersRejectsInvalidParameters(t *testing.T) {
	h := newAPIHarness(t)
	bad := []string{
		"limit=0", "limit=201", "limit=abc", "limit=-1", "limit=1.5",
		"offset=-1", "offset=abc", "offset=1000001",
		"status=mati", "status=ONLINE",
		"q=" + strings.Repeat("a", 101),
		"stats=offline",   // salah ketik: jangan diabaikan diam-diam
		"limit=1&limit=2", // parameter diulang
		"status=online&status=offline",
	}
	for _, query := range bad {
		rec := h.get("/api/v1/customers?" + query)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("?%s: status = %d, want 400", query, rec.Code)
			continue
		}
		var body errorResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Error != "invalid_request" || body.Message == "" {
			t.Errorf("?%s: body = %s, want error invalid_request dengan pesan", query, rec.Body.String())
		}
	}
	// q tepat 100 karakter masih boleh.
	if rec := h.get("/api/v1/customers?q=" + strings.Repeat("a", 100)); rec.Code != http.StatusOK {
		t.Errorf("q 100 karakter: status = %d, want 200", rec.Code)
	}
}

func TestOtherEndpointsRejectUnknownParameters(t *testing.T) {
	h := newAPIHarness(t)
	for _, path := range []string{"/api/v1/summary?x=1", "/api/v1/routers?x=1", "/api/v1/traffic?x=1"} {
		if rec := h.get(path); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", path, rec.Code)
		}
	}
}

type trafficBody struct {
	Data struct {
		Times []int64   `json:"times"`
		Rx    []float64 `json:"rx"`
		Tx    []float64 `json:"tx"`
	} `json:"data"`
}

func TestTrafficSumsRoutersAndSupportsSeconds(t *testing.T) {
	h := newAPIHarness(t)
	all := decode[trafficBody](t, h.get("/api/v1/traffic"))
	if len(all.Data.Times) != 10 || all.Data.Times[0] != 100 || all.Data.Times[9] != 109 {
		t.Fatalf("times = %v", all.Data.Times)
	}
	// Detik 103: r1 10 + r2 3 = 13 Mbps unduh, 1 + 2 = 3 unggah.
	if all.Data.Rx[3] != 13 || all.Data.Tx[3] != 3 {
		t.Errorf("detik 103: rx=%v tx=%v, want 13 dan 3", all.Data.Rx[3], all.Data.Tx[3])
	}

	last3 := decode[trafficBody](t, h.get("/api/v1/traffic?seconds=3"))
	if len(last3.Data.Times) != 3 || last3.Data.Times[0] != 107 || last3.Data.Times[2] != 109 {
		t.Errorf("seconds=3: times = %v, want [107 108 109]", last3.Data.Times)
	}
	if len(last3.Data.Rx) != 3 || len(last3.Data.Tx) != 3 {
		t.Errorf("kolom tidak sejajar: %+v", last3.Data)
	}
}

func TestTrafficValidationAndEmptyState(t *testing.T) {
	h := newAPIHarness(t)
	for _, q := range []string{"seconds=0", "seconds=301", "seconds=abc", "seconds=1&seconds=2"} {
		if rec := h.get("/api/v1/traffic?" + q); rec.Code != http.StatusBadRequest {
			t.Errorf("?%s: status = %d, want 400", q, rec.Code)
		}
	}

	empty := NewHandler(Options{
		Logger: slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
		Data:   state.NewManager(), Verifier: h.tokens, AllowedOrigins: []string{apiOrigin},
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/traffic", nil)
	req.Header.Set("Authorization", "Bearer "+h.ticket())
	rec := httptest.NewRecorder()
	empty.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `{"times":[],"rx":[],"tx":[]}`) {
		t.Errorf("status = %d, body = %s; want kolom kosong berupa []", rec.Code, rec.Body.String())
	}
}

func TestResponsesReflectLiveStateChanges(t *testing.T) {
	h := newAPIHarness(t)
	if _, err := h.mgr.SetOnline("budi.santoso001", false); err != nil {
		t.Fatal(err)
	}
	summary := decode[dataResponse[summaryData]](t, h.get("/api/v1/summary"))
	if summary.Data.Counts.Online != 2 || summary.Data.Counts.Offline != 3 {
		t.Errorf("counts = %+v, want online 2 offline 3 setelah pelanggan putus", summary.Data.Counts)
	}
}

func TestCORSPreflightNeedsNoTicketForAllowedOrigin(t *testing.T) {
	h := newAPIHarness(t)
	rec := h.do(http.MethodOptions, "/api/v1/customers", "", map[string]string{
		"Origin":                         apiOrigin,
		"Access-Control-Request-Method":  "GET",
		"Access-Control-Request-Headers": "authorization",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	header := rec.Header()
	if header.Get("Access-Control-Allow-Origin") != apiOrigin {
		t.Errorf("Allow-Origin = %q, want %q", header.Get("Access-Control-Allow-Origin"), apiOrigin)
	}
	if !strings.Contains(header.Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Errorf("Allow-Headers = %q, harus memuat Authorization", header.Get("Access-Control-Allow-Headers"))
	}
	if !strings.Contains(header.Get("Vary"), "Origin") {
		t.Errorf("Vary = %q, harus memuat Origin", header.Get("Vary"))
	}
}

func TestCORSRejectsOtherOriginsEvenWithValidTicket(t *testing.T) {
	h := newAPIHarness(t)
	for _, method := range []string{http.MethodGet, http.MethodOptions} {
		rec := h.do(method, "/api/v1/customers", h.ticket(), map[string]string{
			"Origin":                        "http://jahat.example",
			"Access-Control-Request-Method": "GET",
		})
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s dari origin asing: status = %d, want 403", method, rec.Code)
		}
		if rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("%s dari origin asing mendapat Allow-Origin", method)
		}
		if strings.Contains(rec.Body.String(), "budi") {
			t.Errorf("%s dari origin asing mendapat data", method)
		}
	}
}

func TestCORSHeadersOnAllowedOriginAndNoneWithoutOrigin(t *testing.T) {
	h := newAPIHarness(t)
	withOrigin := h.do(http.MethodGet, "/api/v1/summary", h.ticket(), map[string]string{"Origin": apiOrigin})
	if withOrigin.Code != http.StatusOK || withOrigin.Header().Get("Access-Control-Allow-Origin") != apiOrigin {
		t.Errorf("origin sah: status = %d, Allow-Origin = %q", withOrigin.Code, withOrigin.Header().Get("Access-Control-Allow-Origin"))
	}
	without := h.get("/api/v1/summary")
	if without.Code != http.StatusOK || without.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("tanpa Origin: status = %d, Allow-Origin = %q, want 200 tanpa header CORS", without.Code, without.Header().Get("Access-Control-Allow-Origin"))
	}
}
