package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/hub"
	"noc-isp/backend/internal/state"
)

func newTestHandler(logs *bytes.Buffer) http.Handler {
	logger := slog.New(slog.NewTextHandler(logs, nil))
	return NewHandler(Options{Logger: logger, Version: "test"})
}

func TestHealthz(t *testing.T) {
	handler := newTestHandler(&bytes.Buffer{})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Errorf("Content-Type = %q, want JSON", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}

	var body healthResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Status != "ok" || body.Version != "test" || body.UptimeSeconds < 0 {
		t.Errorf("body = %+v, want status ok, version test, uptime >= 0", body)
	}
}

func TestHealthzRejectsOtherMethods(t *testing.T) {
	handler := newTestHandler(&bytes.Buffer{})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/healthz", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != "GET, HEAD" {
		t.Errorf("Allow = %q, want %q", got, "GET, HEAD")
	}
}

func TestUnknownRouteReturnsJSON404(t *testing.T) {
	handler := newTestHandler(&bytes.Buffer{})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/tidak-ada", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	var body errorResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Error != "not_found" {
		t.Errorf("error = %q, want not_found", body.Error)
	}
}

func TestRequestLogOmitsQueryString(t *testing.T) {
	var logs bytes.Buffer
	handler := newTestHandler(&logs)
	handler.ServeHTTP(
		httptest.NewRecorder(),
		httptest.NewRequest(http.MethodGet, "/healthz?token=rahasia", nil),
	)

	line := logs.String()
	if !strings.Contains(line, "path=/healthz") || !strings.Contains(line, "status=200") {
		t.Errorf("log %q should record path and status", line)
	}
	if strings.Contains(line, "rahasia") {
		t.Errorf("log %q must not contain the query string", line)
	}
}

const wsTestSecret = "0123456789abcdef0123456789abcdef"

// syncBuffer aman dipakai dari goroutine server dan test sekaligus.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func newWebSocketServer(t *testing.T, logs io.Writer) (*httptest.Server, *auth.Tokens) {
	t.Helper()
	tokens, err := auth.NewTokens(wsTestSecret)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(logs, nil))
	dashboardHub := hub.New(state.NewManager(), hub.Options{Verifier: tokens, Logger: logger})
	server := httptest.NewServer(NewHandler(Options{Logger: logger, WebSocket: dashboardHub}))
	t.Cleanup(server.Close)
	return server, tokens
}

// Upgrade WebSocket harus tetap jalan melalui middleware log dan header
// keamanan; middleware yang membungkus ResponseWriter bisa merusaknya.
func TestWebSocketUpgradeWorksThroughMiddleware(t *testing.T) {
	logs := &syncBuffer{}
	server, tokens := newWebSocketServer(t, logs)

	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial /ws: %v", err)
	}
	defer conn.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Errorf("status = %d, want 101", resp.StatusCode)
	}

	token, _ := tokens.Issue("user-1", time.Now(), time.Minute)
	if err := conn.WriteJSON(map[string]string{"type": "auth", "token": token}); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("baca snapshot: %v", err)
	}
	if !strings.Contains(string(data), `"type":"snapshot"`) {
		t.Errorf("pesan pertama = %s, want snapshot", data)
	}

	// Baris log permintaan ditulis saat handler selesai, yaitu saat koneksi ditutup.
	conn.Close()
	deadline := time.Now().Add(3 * time.Second)
	for !strings.Contains(logs.String(), "status=101") {
		if time.Now().After(deadline) {
			t.Fatalf("log %q should record the upgrade as path=/ws status=101", logs.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
	if line := logs.String(); !strings.Contains(line, "path=/ws") {
		t.Errorf("log %q should name path=/ws", line)
	}
}

func TestWebSocketEndpointAbsentWithoutHub(t *testing.T) {
	handler := newTestHandler(&bytes.Buffer{})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/ws", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 bila WebSocket tidak dikonfigurasi", rec.Code)
	}
}

func TestPlainHTTPRequestToWebSocketEndpointIsRejected(t *testing.T) {
	server, _ := newWebSocketServer(t, &bytes.Buffer{})
	resp, err := http.Get(server.URL + "/ws")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 untuk permintaan non-WebSocket", resp.StatusCode)
	}
}

func TestPPPWebhookIsMountedOnlyWhenProvided(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))

	without := NewHandler(Options{Logger: logger})
	rec := httptest.NewRecorder()
	without.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/hooks/ppp", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("tanpa webhook: status = %d, want 404", rec.Code)
	}

	hook := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
	with := NewHandler(Options{Logger: logger, PPPWebhook: hook})
	rec = httptest.NewRecorder()
	with.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/hooks/ppp", nil))
	if rec.Code != http.StatusTeapot {
		t.Errorf("dengan webhook: status = %d, want handler webhook dipanggil", rec.Code)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("webhook juga harus melewati middleware header keamanan")
	}
}
