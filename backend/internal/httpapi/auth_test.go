package httpapi

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/hub"
	"noc-isp/backend/internal/state"
)

const handlePerm = "alert:handle"

// permHarness memasang requirePerm pada rute contoh yang menerima GET dan POST
// (belum ada rute yang mengubah data di backend; middleware diuji sendiri).
type permHarness struct {
	t       *testing.T
	handler http.Handler
	tokens  *auth.Tokens
	calls   int
	lastID  auth.Identity
}

func newPermHarness(t *testing.T) *permHarness {
	t.Helper()
	tokens, err := auth.NewTokens(apiSecret)
	if err != nil {
		t.Fatal(err)
	}
	h := &permHarness{t: t, tokens: tokens}
	h.handler = requirePerm(tokens, handlePerm, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.calls++
		h.lastID, _ = identityFrom(r.Context())
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ya"})
	}))
	return h
}

func (h *permHarness) issue(perms ...string) string {
	h.t.Helper()
	token, err := h.tokens.IssueWithPerms("user-7", perms, time.Now(), time.Minute)
	if err != nil {
		h.t.Fatal(err)
	}
	return token
}

func (h *permHarness) do(method, authorization string, body *bytes.Buffer) *httptest.ResponseRecorder {
	h.t.Helper()
	var req *http.Request
	if body == nil {
		req = httptest.NewRequest(method, "/api/v1/contoh", nil)
	} else {
		req = httptest.NewRequest(method, "/api/v1/contoh", body)
	}
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

var allMethods = []string{
	http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete,
}

func TestRequirePermAllowsATicketWithThePermission(t *testing.T) {
	h := newPermHarness(t)
	for _, perms := range [][]string{
		{handlePerm},
		{"router:manage", handlePerm}, // izin lain tidak mengurangi
	} {
		ticket := h.issue(perms...)
		for _, method := range allMethods {
			before := h.calls
			rec := h.do(method, "Bearer "+ticket, nil)
			if rec.Code != http.StatusOK {
				t.Errorf("%s dengan izin %v: status = %d, want 200", method, perms, rec.Code)
			}
			if h.calls != before+1 {
				t.Errorf("%s dengan izin %v: handler dipanggil %d kali, want 1", method, perms, h.calls-before)
			}
			if h.lastID.UserID != "user-7" || !h.lastID.Can(handlePerm) {
				t.Errorf("%s: identitas di context = %+v, want user-7 dengan %s", method, h.lastID, handlePerm)
			}
		}
	}
	// Skema Bearer tidak peka huruf besar-kecil, sama dengan requireTicket.
	if rec := h.do(http.MethodPost, "bearer "+h.issue(handlePerm), nil); rec.Code != http.StatusOK {
		t.Errorf("skema bearer huruf kecil: status = %d, want 200", rec.Code)
	}
}

func TestRequirePermRejectsAValidTicketWithoutThePermissionWith403(t *testing.T) {
	h := newPermHarness(t)
	// Tanpa izin berarti payload tanpa kunci "perms", persis tiket yang
	// diterbitkan Next.js sebelum ada izin.
	tickets := map[string]string{
		"hanya-lihat (tanpa perms)":      h.issue(),
		"izin lain saja":                 h.issue("router:manage"),
		"izin mirip tetapi beda":         h.issue("alert:handl", "alert:handle2", "alert:Handle", "alert:*"),
		"sumber daya sama, aksi lain":    h.issue("alert:read"),
		"aksi sama, sumber daya lain":    h.issue("router:handle"),
		"hanya nama sumber daya":         h.issue("alert"),
		"izin dengan spasi di belakang":  h.issue("alert:handle "),
		"izin digabung dengan pemisah":   h.issue("alert:handle,router:manage"),
		"izin ada dua kali di nama lain": h.issue("x:alert:handle"),
	}
	for name, ticket := range tickets {
		for _, method := range allMethods {
			before := h.calls
			// Isi permintaan tidak boleh dibaca sama sekali sebelum izin diperiksa.
			body := &bytes.Buffer{}
			body.WriteString(`{"belum":"dibaca"}`)
			rec := h.do(method, "Bearer "+ticket, body)
			if rec.Code != http.StatusForbidden {
				t.Errorf("%s / %s: status = %d, want 403", name, method, rec.Code)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != `{"error":"forbidden"}` {
				t.Errorf("%s / %s: body = %s, want {\"error\":\"forbidden\"}", name, method, got)
			}
			if body.Len() != len(`{"belum":"dibaca"}`) {
				t.Errorf("%s / %s: isi permintaan dibaca sebelum izin diperiksa", name, method)
			}
			if h.calls != before {
				t.Errorf("%s / %s: handler dipanggil walau tanpa izin", name, method)
			}
			if rec.Header().Get("WWW-Authenticate") != "" {
				t.Errorf("%s / %s: 403 tidak boleh meminta login ulang", name, method)
			}
			if !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
				t.Errorf("%s / %s: Content-Type = %q, want JSON", name, method, rec.Header().Get("Content-Type"))
			}
		}
	}
}

func TestRequirePermRejectsMissingBrokenAndExpiredTicketsWith401(t *testing.T) {
	h := newPermHarness(t)
	expired, _ := h.tokens.IssueWithPerms("user-7", []string{handlePerm}, time.Now().Add(-time.Hour), time.Minute)
	foreignTokens, _ := auth.NewTokens("ffffffffffffffffffffffffffffffff")
	foreign, _ := foreignTokens.IssueWithPerms("user-7", []string{handlePerm}, time.Now(), time.Minute)
	valid := h.issue(handlePerm)
	readOnly := h.issue()
	// Izin disisipkan tanpa tanda tangan ulang: payload tiket berizin, tanda
	// tangan tiket hanya-lihat.
	payload, _, _ := strings.Cut(valid, ".")
	_, readOnlySig, _ := strings.Cut(readOnly, ".")

	headers := map[string]string{
		"tanpa header":             "",
		"skema Basic":              "Basic dXNlcjpwYXNz",
		"Bearer kosong":            "Bearer ",
		"hanya kata Bearer":        "Bearer",
		"tiket sampah":             "Bearer asal.asalan",
		"tiket kedaluwarsa":        "Bearer " + expired,
		"rahasia lain":             "Bearer " + foreign,
		"izin disisipkan":          "Bearer " + payload + "." + readOnlySig,
		"tiket tanpa skema":        valid,
		"skema salah dengan tiket": "Token " + valid,
	}
	for name, authorization := range headers {
		for _, method := range allMethods {
			rec := h.do(method, authorization, nil)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s / %s: status = %d, want 401", name, method, rec.Code)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != `{"error":"unauthorized"}` {
				t.Errorf("%s / %s: body = %s, want {\"error\":\"unauthorized\"}", name, method, got)
			}
			if got := rec.Header().Get("WWW-Authenticate"); got != "Bearer" {
				t.Errorf("%s / %s: WWW-Authenticate = %q, want Bearer", name, method, got)
			}
		}
	}
	if h.calls != 0 {
		t.Errorf("handler dipanggil %d kali untuk tiket yang tidak sah", h.calls)
	}

	// Pesan 401 sama dengan requireTicket: tidak membedakan penyebab.
	plain := requireTicket(h.tokens, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	rec := httptest.NewRecorder()
	plain.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := strings.TrimSpace(rec.Body.String()); got != `{"error":"unauthorized"}` || rec.Code != http.StatusUnauthorized {
		t.Errorf("requireTicket: status = %d, body = %s", rec.Code, got)
	}
}

func TestRequirePermJudgesTheTicketAtRequestTime(t *testing.T) {
	// Tiket yang berizin tetapi sudah habis tidak lagi membuka aksi; verifier
	// yang menjawab kedaluwarsa menghasilkan 401, bukan 403 dan bukan 200.
	verifier := verifierFunc(func(string, time.Time) (auth.Identity, error) {
		return auth.Identity{}, auth.ErrExpiredToken
	})
	called := false
	handler := requirePerm(verifier, handlePerm, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("Authorization", "Bearer apa-saja")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized || called {
		t.Errorf("status = %d, handler dipanggil = %v; want 401 dan tidak dipanggil", rec.Code, called)
	}

	// Kesalahan verifier apa pun diperlakukan sebagai tidak sah.
	broken := verifierFunc(func(string, time.Time) (auth.Identity, error) {
		return auth.Identity{UserID: "u", Perms: []string{handlePerm}}, errors.New("rusak")
	})
	rec = httptest.NewRecorder()
	requirePerm(broken, handlePerm, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized || called {
		t.Errorf("verifier galat: status = %d, handler dipanggil = %v; want 401", rec.Code, called)
	}
}

type verifierFunc func(token string, now time.Time) (auth.Identity, error)

func (f verifierFunc) Verify(token string, now time.Time) (auth.Identity, error) {
	return f(token, now)
}

// requireTicket meneruskan identitas ke handler, termasuk izinnya.
func TestRequireTicketPassesTheIdentityOn(t *testing.T) {
	h := newPermHarness(t)
	var got auth.Identity
	var ok bool
	handler := requireTicket(h.tokens, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok = identityFrom(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+h.issue("router:manage"))
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if !ok || got.UserID != "user-7" || !got.Can("router:manage") || got.Can(handlePerm) {
		t.Errorf("identitas = %+v (ok %v)", got, ok)
	}
	if _, ok := identityFrom(httptest.NewRequest(http.MethodGet, "/", nil).Context()); ok {
		t.Error("identityFrom harus false untuk context yang tidak melewati middleware")
	}
}

// --- Rute baca tetap terbuka bagi tiket hanya-lihat -------------------------

// Tiket tanpa izin (hanya-lihat) dan tiket berizin sama-sama boleh membaca
// semua rute /api/v1/ yang ada; izin tidak membuka rute mengubah data karena
// rute seperti itu belum ada (POST tetap 405).
func TestReadRoutesStayOpenToReadOnlyTickets(t *testing.T) {
	h := newAPIHarness(t)
	readOnly, _ := h.tokens.Issue("user-1", time.Now(), time.Minute)
	withPerm, _ := h.tokens.IssueWithPerms("user-1", []string{handlePerm}, time.Now(), time.Minute)

	reads := []string{
		"/api/v1/summary",
		"/api/v1/routers",
		"/api/v1/customers",
		"/api/v1/customers?status=offline&q=budi&limit=2",
		"/api/v1/traffic",
		"/api/v1/traffic?seconds=5",
	}
	for name, ticket := range map[string]string{"hanya-lihat": readOnly, "berizin": withPerm} {
		for _, path := range reads {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				rec := h.do(method, path, ticket, nil)
				if rec.Code != http.StatusOK {
					t.Errorf("%s %s %s: status = %d, want 200", name, method, path, rec.Code)
				}
			}
		}
		// Arsip tidak dikonfigurasi di harness ini: jawabannya 503 dari handler
		// arsip, artinya tiket hanya-lihat lolos sampai ke handler.
		rec := h.do(http.MethodGet, "/api/v1/traffic/history?range=1h", ticket, nil)
		if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "history_unavailable") {
			t.Errorf("%s history: status = %d, body = %s; want 503 history_unavailable dari handler", name, rec.Code, rec.Body.String())
		}
		writePaths := append([]string{"/api/v1/alerts/a-1/handle"}, reads...)
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			for _, path := range writePaths {
				rec := h.do(method, path, ticket, nil)
				if rec.Code == http.StatusOK || rec.Code == http.StatusCreated || rec.Code == http.StatusNoContent {
					t.Errorf("%s %s %s: status = %d; tidak boleh ada rute yang mengubah data", name, method, path, rec.Code)
				}
			}
		}
	}
	if rec := h.do(http.MethodPost, "/api/v1/alerts/a-1/handle", withPerm, nil); rec.Code != http.StatusNotFound {
		t.Errorf("rute handle belum ada: status = %d, want 404", rec.Code)
	}
}

func TestWebSocketAcceptsReadOnlyAndPermissionTickets(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	tokens, err := auth.NewTokens(wsTestSecret)
	if err != nil {
		t.Fatal(err)
	}
	dashboardHub := hub.New(state.NewManager(), hub.Options{Verifier: tokens, Logger: logger})
	server := httptest.NewServer(NewHandler(Options{Logger: logger, WebSocket: dashboardHub}))
	t.Cleanup(server.Close)
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"

	readOnly, _ := tokens.Issue("user-1", time.Now(), time.Minute)
	withPerm, _ := tokens.IssueWithPerms("user-2", []string{handlePerm}, time.Now(), time.Minute)
	for name, token := range map[string]string{"hanya-lihat": readOnly, "berizin": withPerm} {
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			t.Fatalf("%s: dial: %v", name, err)
		}
		if err := conn.WriteJSON(map[string]string{"type": "auth", "token": token}); err != nil {
			t.Fatalf("%s: kirim auth: %v", name, err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, data, err := conn.ReadMessage()
		conn.Close()
		if err != nil {
			t.Fatalf("%s: baca snapshot: %v", name, err)
		}
		if !strings.Contains(string(data), `"type":"snapshot"`) {
			t.Errorf("%s: pesan pertama = %s, want snapshot", name, data)
		}
	}
}
