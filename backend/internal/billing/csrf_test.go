package billing

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestCSRFTokenExtractionFromMetaTagAndInput(t *testing.T) {
	var requestCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		switch r.URL.Path {
		case "/login":
			if r.Method == http.MethodGet {
				w.Header().Set("Content-Type", "text/html")
				_, _ = fmt.Fprint(w, `<html>
<head><meta name="csrf-token" content="csrf-meta-initial"></head>
<body>
  <form method="POST" action="/login">
    <input type="hidden" name="_token" value="csrf-input-token-123">
    <input type="text" name="username">
    <input type="password" name="password">
  </form>
</body></html>`)
				return
			}
			if r.Method == http.MethodPost {
				_ = r.ParseForm()
				if r.FormValue("_token") != "csrf-input-token-123" {
					http.Error(w, "CSRF token salah", 419)
					return
				}
				http.SetCookie(w, &http.Cookie{Name: "session", Value: "sess_ok"})
				http.Redirect(w, r, "/invoices?page=1", http.StatusFound)
				return
			}
		case "/invoices":
			// Halaman tagihan memperbarui CSRF via meta tag baru
			w.Header().Set("Content-Type", "text/html")
			if r.URL.Query().Get("page") != "1" {
				_, _ = fmt.Fprint(w, `<html><body><table class="invoices"><tbody></tbody></table></body></html>`)
				return
			}
			w.Header().Set("X-CSRF-TOKEN", "csrf-header-refreshed-456")
			_, _ = fmt.Fprint(w, `<html>
<head><meta name="csrf-token" content="csrf-meta-updated-789"></head>
<body>
  <table class="invoices">
    <tbody>
      <tr><td class="ref">INV-1</td><td class="pppoe">budi</td><td class="status">lunas</td></tr>
    </tbody>
  </table>
</body></html>`)
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	cfg := Config{
		BaseURL:  srv.URL,
		Username: "admin",
		Password: "secret",
		Profile:  DefaultProfile(),
	}
	s, err := New(cfg)
	if err != nil {
		t.Fatalf("New gagal: %v", err)
	}

	// Sebelum login: CSRFToken masih kosong
	if got := s.CSRFToken(); got != "" {
		t.Errorf("CSRFToken sebelum login = %q, want kosong", got)
	}

	// Jalankan Invoices -> alur login mengambil token awal, lalu halaman faktur memperbarui token
	invs, _, err := s.Invoices(context.Background())
	if err != nil {
		t.Fatalf("Invoices gagal: %v", err)
	}
	if len(invs) != 1 {
		t.Fatalf("jumlah faktur = %d, want 1", len(invs))
	}

	// Setelah membaca halaman faktur: token CSRF harus terbarui dari respons terbaru
	got := s.CSRFToken()
	if got == "" {
		t.Errorf("CSRFToken setelah scrape kosong, want token terbarui")
	}
	// Token harus salah satu dari token yang diperbarui di halaman faktur (header atau meta)
	if got != "csrf-header-refreshed-456" && got != "csrf-meta-updated-789" {
		t.Errorf("CSRFToken = %q, want token hasil pembaruan halaman faktur", got)
	}
}

func TestCSRFTokenGracefulWhenNoTokenPresent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = fmt.Fprint(w, `<html><body><h1>Portal Tanpa CSRF</h1></body></html>`)
	}))
	defer srv.Close()

	cfg := Config{
		BaseURL:  srv.URL,
		Username: "admin",
		Password: "secret",
		Profile:  DefaultProfile(),
	}
	s, err := New(cfg)
	if err != nil {
		t.Fatalf("New gagal: %v", err)
	}

	// updateCSRF dengan dokumen tanpa CSRF tidak boleh panik
	s.updateCSRF(nil)
	if s.CSRFToken() != "" {
		t.Errorf("CSRFToken harus tetap kosong")
	}
}

func TestCSRFTokenHeaderWinsAndNoLeakToLogs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		switch r.URL.Path {
		case "/login":
			if r.Method == http.MethodPost {
				http.Redirect(w, r, "/invoices?page=1", http.StatusFound)
				return
			}
			_, _ = fmt.Fprint(w, `<form><input name="_token" value="tok-login-SECRET"><input type="password" name="password"></form>`)
		default:
			if r.URL.Query().Get("page") == "1" {
				w.Header().Set("X-XSRF-TOKEN", "tok-xsrf-SECRET")
				_, _ = fmt.Fprint(w, `<meta name="csrf-token" content="tok-meta-SECRET"><table class="invoices"><tbody><tr><td class="ref">1</td><td class="pppoe">a</td><td class="status">lunas</td></tr></tbody></table>`)
				return
			}
			_, _ = fmt.Fprint(w, `<table class="invoices"><tbody></tbody></table>`)
		}
	}))
	defer srv.Close()

	var logs bytes.Buffer
	lg := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	s, err := New(Config{BaseURL: srv.URL, Username: "admin", Password: "pw", Profile: DefaultProfile()}, WithLogger(lg))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Invoices(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := s.CSRFToken(); got != "tok-xsrf-SECRET" {
		t.Errorf("CSRFToken = %q, want header X-XSRF-TOKEN menang atas meta", got)
	}
	if strings.Contains(logs.String(), "SECRET") {
		t.Errorf("token CSRF bocor ke log: %s", logs.String())
	}
}

func TestCSRFTokenConcurrentAccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		if r.URL.Path == "/login" && r.Method == http.MethodGet {
			_, _ = fmt.Fprint(w, `<form><input name="_token" value="t"><input type="password" name="password"></form>`)
			return
		}
		if r.URL.Path == "/login" {
			http.Redirect(w, r, "/invoices?page=1", http.StatusFound)
			return
		}
		w.Header().Set("X-CSRF-TOKEN", "t2")
		if r.URL.Query().Get("page") == "1" {
			_, _ = fmt.Fprint(w, `<table class="invoices"><tbody><tr><td class="ref">1</td><td class="pppoe">a</td><td class="status">lunas</td></tr></tbody></table>`)
			return
		}
		_, _ = fmt.Fprint(w, `<table class="invoices"><tbody></tbody></table>`)
	}))
	defer srv.Close()
	s, err := New(Config{BaseURL: srv.URL, Username: "admin", Password: "pw", Profile: DefaultProfile()})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); _, _, _ = s.Invoices(context.Background()) }()
		go func() { defer wg.Done(); _ = s.CSRFToken() }()
	}
	wg.Wait()
	if s.CSRFToken() != "t2" {
		t.Errorf("CSRFToken = %q, want t2", s.CSRFToken())
	}
}
