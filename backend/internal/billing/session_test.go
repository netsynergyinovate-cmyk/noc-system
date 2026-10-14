package billing

import (
	"encoding/json"
	"net/http"
	"reflect"
	"sync"
	"testing"
)

// seedSession membuat sesi sah di server tiruan dan mengembalikan id-nya.
func seedSession(f *fakeBilling, loggedIn bool) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	sid := randomHex(16)
	f.sessions[sid] = &fakeSession{token: randomHex(16), loggedIn: loggedIn}
	return sid
}

func cookieJSON(sid string) string {
	b, _ := json.Marshal(map[string]string{"sid": sid})
	return string(b)
}

func TestScraperImportExportCookies(t *testing.T) {
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, nil)

	sid := seedSession(f, true)
	if err := s.ImportCookiesJSON(cookieJSON(sid)); err != nil {
		t.Fatalf("ImportCookiesJSON: %v", err)
	}

	got, _, err := s.Invoices(testCtx(t))
	if err != nil {
		t.Fatalf("Invoices: %v", err)
	}
	if !reflect.DeepEqual(got, sampleWant()) {
		t.Fatalf("tagihan = %+v", got)
	}
	c := f.snapshot()
	if c.loginGets != 0 || c.loginPosts != 0 {
		t.Fatalf("login seharusnya dilewati: gets=%d posts=%d", c.loginGets, c.loginPosts)
	}
	if c.unauthedInvoiceHits != 0 {
		t.Fatalf("unauthedInvoiceHits = %d, want 0", c.unauthedInvoiceHits)
	}

	out, err := s.ExportCookiesJSON()
	if err != nil {
		t.Fatalf("ExportCookiesJSON: %v", err)
	}
	if want := cookieJSON(sid); out != want {
		t.Fatalf("export = %s, want %s", out, want)
	}
	if cs := s.Cookies(); len(cs) != 1 || cs[0].Name != "sid" || cs[0].Value != sid {
		t.Fatalf("Cookies() = %+v", cs)
	}

	for _, bad := range []string{``, `null`, `[]`, `{"sid":1}`, `bukan json`} {
		if err := s.ImportCookiesJSON(bad); err == nil {
			t.Errorf("ImportCookiesJSON(%q) seharusnya galat", bad)
		}
	}
}

func TestScraperSessionExpiryAutoRelogin(t *testing.T) {
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, nil)

	stale := seedSession(f, false) // cookie ada tapi sesi sudah mati di server
	if err := s.ImportCookiesJSON(cookieJSON(stale)); err != nil {
		t.Fatal(err)
	}

	got, st, err := s.Invoices(testCtx(t))
	if err != nil {
		t.Fatalf("Invoices: %v", err)
	}
	if !reflect.DeepEqual(got, sampleWant()) {
		t.Fatalf("tagihan = %+v", got)
	}
	if st.Relogins != 1 {
		t.Fatalf("Relogins = %d, want 1", st.Relogins)
	}
	c := f.snapshot()
	if c.unauthedInvoiceHits != 1 || c.loginPosts != 1 {
		t.Fatalf("unauthed=%d posts=%d, want 1 dan 1", c.unauthedInvoiceHits, c.loginPosts)
	}

	out, err := s.ExportCookiesJSON()
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatal(err)
	}
	if m["sid"] == "" || m["sid"] == stale {
		t.Fatalf("cookie baru diharapkan berbeda dari yang basi: %v", m)
	}
}

func TestScraperOnSessionUpdateCallback(t *testing.T) {
	f := newFake(t, sampleRows())

	var (
		mu      sync.Mutex
		calls   int
		cookies []*http.Cookie
		csrf    string
	)
	s := newTestScraper(t, f, nil, WithSessionCallback(func(cs []*http.Cookie, token string) error {
		mu.Lock()
		defer mu.Unlock()
		calls++
		cookies, csrf = cs, token
		return nil
	}))

	if err := s.Login(testCtx(t)); err != nil {
		t.Fatalf("Login: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("callback dipanggil %d kali, want 1", calls)
	}
	if csrf == "" {
		t.Fatal("csrf kosong")
	}
	if len(cookies) != 1 || cookies[0].Name != "sid" || cookies[0].Value == "" {
		t.Fatalf("cookies = %+v", cookies)
	}
	// Token CSRF berasal dari form login (token sesi pra-login), cookie dari sesi baru.
	found := false
	for _, id := range f.secrets() {
		if id == csrf {
			found = true
		}
	}
	if !found {
		t.Fatal("csrf bukan token yang dikeluarkan server")
	}
}
