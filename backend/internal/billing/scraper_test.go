package billing

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// ---- alur sukses ----

func TestInvoicesFullFlowNumberedPages(t *testing.T) {
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, nil)

	got, st, err := s.Invoices(testCtx(t))
	if err != nil {
		t.Fatalf("Invoices: %v", err)
	}
	if want := sampleWant(); !reflect.DeepEqual(got, want) {
		t.Errorf("invoices:\n got %#v\nwant %#v", got, want)
	}
	// 3 halaman berisi + 1 halaman penutup yang kosong.
	if want := (Stats{Pages: 4, Rows: 7, Skipped: 0, Relogins: 0}); st != want {
		t.Errorf("stats = %+v, want %+v", st, want)
	}

	c := f.snapshot()
	if c.loginGets != 1 || c.loginPosts != 1 {
		t.Errorf("login GET/POST = %d/%d, want 1/1", c.loginGets, c.loginPosts)
	}
	if c.postsWithCookie != c.loginPosts {
		t.Errorf("POST login tanpa cookie sesi: %d dari %d (cookiejar tidak dipakai)", c.loginPosts-c.postsWithCookie, c.loginPosts)
	}
	if c.unauthedInvoiceHits != 0 {
		t.Errorf("%d permintaan tagihan tiba tanpa sesi sah: cookie tidak dibawa", c.unauthedInvoiceHits)
	}
	if want := []string{"page=1", "page=2", "page=3", "page=4"}; !reflect.DeepEqual(f.invoiceHits, want) {
		t.Errorf("halaman yang diminta = %v, want %v", f.invoiceHits, want)
	}
	if len(f.violations) != 0 {
		t.Errorf("pelanggaran protokol: %v", f.violations)
	}
	// Kredensial dan token terkirim persis seperti seharusnya.
	form := f.postForms[0]
	if form.Get("username") != fakeUser || form.Get("password") != fakePass || form.Get("_token") == "" {
		t.Errorf("form login tidak lengkap: %v", form)
	}
}

func TestInvoicesFollowNextLink(t *testing.T) {
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, func(c *Config) {
		c.Profile = DefaultProfile()
		c.Profile.InvoicesPath = "/invoices"
		c.Profile.NextSelector = `a[rel="next"]`
	})
	got, st, err := s.Invoices(testCtx(t))
	if err != nil {
		t.Fatalf("Invoices: %v", err)
	}
	if !reflect.DeepEqual(got, sampleWant()) {
		t.Errorf("invoices = %#v", got)
	}
	if st.Pages != 3 || st.Rows != 7 {
		t.Errorf("stats = %+v, want 3 halaman 7 baris (tanpa halaman penutup)", st)
	}
	if want := []string{"", "page=2", "page=3"}; !reflect.DeepEqual(f.invoiceHits, want) {
		t.Errorf("permintaan = %q, want %q", f.invoiceHits, want)
	}
}

func TestInvoicesSinglePageWithoutPagePlaceholder(t *testing.T) {
	f := newFake(t, sampleRows())
	f.pageSize = 100
	s := newTestScraper(t, f, func(c *Config) {
		c.Profile = DefaultProfile()
		c.Profile.InvoicesPath = "/invoices?page=1"
	})
	got, st, err := s.Invoices(testCtx(t))
	if err != nil || len(got) != 7 || st.Pages != 1 {
		t.Fatalf("got %d tagihan, stats %+v, err %v", len(got), st, err)
	}
}

func TestInvoicesDirtyHTML(t *testing.T) {
	f := newFake(t, []fakeRow{
		{Name: "\n   BUDI01 \n", Ref: "  INV-001 ", Status: "  LUNAS "},
		{Name: "Dewi&amp;Co", Ref: "INV-002", Status: "belum   lunas"},
		{Name: "&nbsp;agus03", Ref: "", Status: "Isolir"},
		{Name: "siti04", Ref: "INV-004", Status: "<b>Menunggak</b>"},
	})
	f.dirty = true
	s := newTestScraper(t, f, nil)

	got, st, err := s.Invoices(testCtx(t))
	if err != nil {
		t.Fatalf("Invoices: %v", err)
	}
	want := []Invoice{
		{Name: "BUDI01", Ref: "INV-001", Status: StatusLunas},
		{Name: "Dewi&Co", Ref: "INV-002", Status: StatusIsolir},
		{Name: "\u00a0agus03", Ref: "", Status: StatusIsolir},
		{Name: "siti04", Ref: "INV-004", Status: StatusIsolir},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("invoices:\n got %#v\nwant %#v", got, want)
	}
	// Tiap halaman berisi: baris pemisah colspan dan baris tanpa nama dilewati.
	// 2 halaman x (baris asli + 2 baris dilewati) = 4 + 4 = 8.
	if st.Rows != 8 || st.Skipped != 4 || st.Pages != 3 {
		t.Errorf("stats = %+v, want Rows 8, Skipped 4, Pages 3", st)
	}
}

func TestInvoicesEmptyList(t *testing.T) {
	f := newFake(t, nil)
	f.emptyMarker = true

	// Tanpa penanda di profil, daftar kosong terlihat seperti struktur yang berubah.
	s := newTestScraper(t, f, nil)
	if got, _, err := s.Invoices(testCtx(t)); !errors.Is(err, ErrUnexpectedPage) || got != nil {
		t.Errorf("tanpa EmptySelector: got %v err %v, want ErrUnexpectedPage", got, err)
	}

	s = newTestScraper(t, f, func(c *Config) {
		c.Profile = DefaultProfile()
		c.Profile.EmptySelector = ".empty-state"
	})
	got, st, err := s.Invoices(testCtx(t))
	if err != nil {
		t.Fatalf("Invoices: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Errorf("daftar kosong yang sah harus slice kosong non-nil, dapat %#v", got)
	}
	if st.Pages != 1 || st.Rows != 0 {
		t.Errorf("stats = %+v", st)
	}
}

func TestSessionIsReusedAcrossCalls(t *testing.T) {
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, nil)
	ctx := testCtx(t)
	for i := 0; i < 3; i++ {
		got, _, err := s.Invoices(ctx)
		if err != nil || len(got) != 7 {
			t.Fatalf("panggilan %d: %d tagihan, err %v", i, len(got), err)
		}
	}
	if c := f.snapshot(); c.loginPosts != 1 {
		t.Errorf("login %d kali untuk 3 pembacaan; sesi harus dipakai ulang", c.loginPosts)
	}
}

func TestExplicitLoginThenInvoices(t *testing.T) {
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, nil)
	ctx := testCtx(t)
	if err := s.Login(ctx); err != nil {
		t.Fatalf("Login: %v", err)
	}
	if _, _, err := s.Invoices(ctx); err != nil {
		t.Fatalf("Invoices: %v", err)
	}
	if c := f.snapshot(); c.loginPosts != 1 {
		t.Errorf("login %d kali, want 1", c.loginPosts)
	}
}

func TestConcurrentCallsAreSerialized(t *testing.T) {
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, nil)
	ctx := testCtx(t)

	var wg sync.WaitGroup
	results := make([][]Invoice, 6)
	errs := make([]error, 6)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], _, errs[i] = s.Invoices(ctx)
		}()
	}
	wg.Wait()
	for i := range results {
		if errs[i] != nil || !reflect.DeepEqual(results[i], sampleWant()) {
			t.Errorf("goroutine %d: %d tagihan, err %v", i, len(results[i]), errs[i])
		}
	}
	if c := f.snapshot(); c.loginPosts != 1 {
		t.Errorf("login %d kali, want 1", c.loginPosts)
	}
}

func TestExtraLoginFieldsAndPostPath(t *testing.T) {
	f := newFake(t, sampleRows())
	f.requireExtra = map[string]string{"remember": "1"}

	// Tanpa kolom tambahan, server menolak: tes ini membuktikan kolomnya terkirim.
	plain := newTestScraper(t, f, nil)
	if err := plain.Login(testCtx(t)); !errors.Is(err, ErrHTTPStatus) {
		t.Fatalf("tanpa kolom tambahan: err = %v, want ErrHTTPStatus (400 dari server)", err)
	}

	s := newTestScraper(t, f, func(c *Config) {
		c.Profile = DefaultProfile()
		c.Profile.LoginExtraFields = map[string]string{"remember": "1"}
		c.Profile.LoginPostPath = "/session"
	})
	if _, _, err := s.Invoices(testCtx(t)); err != nil {
		t.Fatalf("Invoices: %v", err)
	}
	last := len(f.postPaths) - 1
	if f.postPaths[last] != "/session" {
		t.Errorf("POST login ke %q, want /session", f.postPaths[last])
	}
	if f.postForms[last].Get("remember") != "1" {
		t.Errorf("kolom tambahan tidak terkirim: %v", f.postForms[last])
	}
}

func TestCSRFFromMetaTag(t *testing.T) {
	f := newFake(t, sampleRows())
	f.csrf = "meta"
	s := newTestScraper(t, f, func(c *Config) {
		c.Profile = DefaultProfile()
		c.Profile.CSRFSelector = `meta[name="csrf-token"]`
		c.Profile.CSRFAttr = "content"
	})
	if got, _, err := s.Invoices(testCtx(t)); err != nil || len(got) != 7 {
		t.Fatalf("%d tagihan, err %v", len(got), err)
	}
}

func TestCustomProfileEndToEnd(t *testing.T) {
	// Server yang sama, dibaca dengan profil lain: selektor dan peta status sendiri.
	f := newFake(t, []fakeRow{
		{Name: "kita", Ref: "A1", Status: "Lunas"},
		{Name: "kamu", Ref: "A2", Status: "Putus"},
	})
	s := newTestScraper(t, f, func(c *Config) {
		c.Profile = DefaultProfile()
		c.Profile.RowSelector = "table tbody tr"
		c.Profile.NameSelector = "td:nth-child(4)"
		c.Profile.StatusSelector = "span.badge"
		c.Profile.RefSelector = "td:nth-child(2)"
		c.Profile.StatusMap = map[string]Status{"lunas": StatusLunas, "putus": StatusIsolir}
	})
	got, _, err := s.Invoices(testCtx(t))
	if err != nil {
		t.Fatal(err)
	}
	want := []Invoice{{Name: "kita", Ref: "A1", Status: StatusLunas}, {Name: "kamu", Ref: "A2", Status: StatusIsolir}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v, want %#v", got, want)
	}
}

func TestBasePathPrefix(t *testing.T) {
	s, err := New(Config{BaseURL: "https://billing.example.com/app/", Username: "u", Password: "p"})
	if err != nil {
		t.Fatal(err)
	}
	third, err := s.invoicesURL(3)
	if err != nil {
		t.Fatal(err)
	}
	for got, want := range map[string]string{
		s.loginURL.String():     "https://billing.example.com/app/login",
		s.loginPostURL.String(): "https://billing.example.com/app/login",
		third.String():          "https://billing.example.com/app/invoices?page=3",
	} {
		if got != want {
			t.Errorf("URL = %q, want %q", got, want)
		}
	}
}

// ---- cookiejar dan CSRF pada server tiruan ----

// Membuktikan server tiruan memang menolak yang seharusnya ditolak; kalau tidak,
// tes lain yang bergantung padanya tidak berarti apa-apa.
func TestFakeBillingRejectsWrongTokenAndMissingCookie(t *testing.T) {
	f := newFake(t, sampleRows())
	post := func(client *http.Client, token string) int {
		form := url.Values{"username": {fakeUser}, "password": {fakePass}, "_token": {token}}
		resp, err := client.PostForm(f.srv.URL+"/login", form)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}
	noRedirect := func(jar http.CookieJar) *http.Client {
		return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	tokenOf := func(client *http.Client) string {
		resp, err := client.Get(f.srv.URL + "/login")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		const marker = `name="_token" value="`
		i := strings.Index(string(body), marker)
		return string(body)[i+len(marker) : i+len(marker)+32]
	}

	a, b := noRedirect(newJar()), noRedirect(newJar())
	tokenA, tokenB := tokenOf(a), tokenOf(b)
	if tokenA == tokenB {
		t.Fatal("token harus berbeda tiap sesi")
	}
	if got := post(a, tokenB); got != 419 {
		t.Errorf("token sesi lain: status %d, want 419", got)
	}
	if got := post(a, ""); got != 419 {
		t.Errorf("tanpa token: status %d, want 419", got)
	}
	if got := post(noRedirect(nil), tokenA); got != 419 {
		t.Errorf("tanpa cookie: status %d, want 419", got)
	}
	if got := post(a, tokenA); got != http.StatusFound {
		t.Errorf("token dan cookie benar: status %d, want 302", got)
	}
}

func TestLoginRotatesSessionAndTokenPerSession(t *testing.T) {
	f := newFake(t, sampleRows())
	f.expireAfter, f.expireTimes = 1, 1
	s := newTestScraper(t, f, nil)
	if _, _, err := s.Invoices(testCtx(t)); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, secret := range f.secrets() {
		if seen[secret] {
			t.Errorf("rahasia %q dikeluarkan dua kali: token/sesi harus berbeda tiap sesi", secret)
		}
		seen[secret] = true
	}
}

// ---- login gagal ----

func TestWrongCredentialsFailOnceWithoutRetry(t *testing.T) {
	for _, style := range []string{"redirect", "rerender", "422"} {
		for _, bad := range []string{"password", "username"} {
			t.Run(style+"/"+bad, func(t *testing.T) {
				f := newFake(t, sampleRows())
				f.loginFail = style
				s := newTestScraper(t, f, func(c *Config) {
					if bad == "password" {
						c.Password = "salah-" + fakePass
					} else {
						c.Username = "bukan-" + fakeUser
					}
				})
				got, _, err := s.Invoices(testCtx(t))
				if !errors.Is(err, ErrLoginFailed) {
					t.Fatalf("err = %v, want ErrLoginFailed", err)
				}
				if got != nil {
					t.Errorf("tagihan harus nil saat galat, dapat %v", got)
				}
				c := f.snapshot()
				if c.loginPosts != 1 {
					t.Errorf("POST login %d kali; kredensial yang ditolak tidak boleh diulang", c.loginPosts)
				}
				if c.invoiceHits != 0 {
					t.Errorf("halaman tagihan diminta %d kali setelah login gagal", c.invoiceHits)
				}
				// Tiap pemanggilan baru memang mencoba sekali lagi, tetapi hanya sekali.
				_, _, _ = s.Invoices(testCtx(t))
				if c := f.snapshot(); c.loginPosts != 2 {
					t.Errorf("dua panggilan harus berarti dua POST, dapat %d", c.loginPosts)
				}
			})
		}
	}
}

func TestCSRFTokenMissingFromLoginPage(t *testing.T) {
	for _, mode := range []string{"none", "empty"} {
		f := newFake(t, sampleRows())
		f.csrf = mode
		s := newTestScraper(t, f, nil)
		_, _, err := s.Invoices(testCtx(t))
		if !errors.Is(err, ErrCSRFNotFound) {
			t.Errorf("mode %s: err = %v, want ErrCSRFNotFound", mode, err)
		}
		if c := f.snapshot(); c.loginPosts != 0 {
			t.Errorf("mode %s: kredensial dikirim (%d POST) padahal tidak ada token", mode, c.loginPosts)
		}
	}
}

func TestStaleCSRFTokenIsRejectedWithoutRetry(t *testing.T) {
	f := newFake(t, sampleRows())
	f.breakToken = true
	s := newTestScraper(t, f, nil)
	_, _, err := s.Invoices(testCtx(t))
	if !errors.Is(err, ErrLoginFailed) || !strings.Contains(err.Error(), "419") {
		t.Fatalf("err = %v, want ErrLoginFailed (HTTP 419)", err)
	}
	if c := f.snapshot(); c.loginPosts != 1 {
		t.Errorf("POST %d kali, want 1", c.loginPosts)
	}
}

func TestLoginAlwaysInstallsFreshCookieJar(t *testing.T) {
	// Sisi server menolak POST login tanpa cookie sesi, jadi Scraper harus
	// memasang cookiejar sendiri di setiap login, bagaimanapun keadaan klien.
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, nil)
	s.client.Jar = nil
	if err := s.Login(testCtx(t)); err != nil {
		t.Fatalf("Login: %v", err)
	}
	if c := f.snapshot(); c.loginPosts != 1 || c.postsWithCookie != 1 {
		t.Errorf("POST login %d, membawa cookie %d; want 1 dan 1", c.loginPosts, c.postsWithCookie)
	}
	first := s.client.Jar
	if err := s.Login(testCtx(t)); err != nil {
		t.Fatalf("Login kedua: %v", err)
	}
	if s.client.Jar == first {
		t.Error("tiap login harus memulai sesi baru dengan cookiejar baru")
	}
}

// ---- sesi berakhir ----

func TestSessionExpiresMidwayReloginsExactlyOnce(t *testing.T) {
	for _, status := range []int{0, http.StatusUnauthorized} {
		t.Run(fmt.Sprintf("status-%d", status), func(t *testing.T) {
			f := newFake(t, sampleRows())
			f.expireAfter, f.expireTimes = 1, 1 // mati setelah halaman 1, sekali saja
			f.unauthStatus = status
			s := newTestScraper(t, f, nil)

			got, st, err := s.Invoices(testCtx(t))
			if err != nil {
				t.Fatalf("Invoices: %v", err)
			}
			if !reflect.DeepEqual(got, sampleWant()) {
				t.Errorf("hasil setelah login ulang harus lengkap, berurutan, tanpa ganda:\n got %#v", got)
			}
			if st.Relogins != 1 {
				t.Errorf("Relogins = %d, want 1", st.Relogins)
			}
			c := f.snapshot()
			if c.loginPosts != 2 {
				t.Errorf("login %d kali, want 2 (awal + satu login ulang)", c.loginPosts)
			}
			if c.unauthedInvoiceHits != 1 {
				t.Errorf("%d permintaan tak berizin, want tepat 1 (halaman yang tertunda)", c.unauthedInvoiceHits)
			}
			// Halaman 2 diminta dua kali: ditolak lalu diulang setelah login ulang.
			if want := []string{"page=1", "page=2", "page=2", "page=3", "page=4"}; !reflect.DeepEqual(f.invoiceHits, want) {
				t.Errorf("permintaan = %v, want %v", f.invoiceHits, want)
			}
		})
	}
}

func TestSessionLostAgainAfterReloginIsAnError(t *testing.T) {
	f := newFake(t, sampleRows())
	f.denyInvoices = true
	f.loginCap = 20 // pagar: bila login ulang tak berbatas, server menjawab 500 dan tes tetap berakhir
	s := newTestScraper(t, f, nil)

	got, st, err := s.Invoices(testCtx(t))
	if !errors.Is(err, ErrSessionLost) {
		t.Fatalf("err = %v, want ErrSessionLost", err)
	}
	if got != nil {
		t.Errorf("tagihan harus nil: %v", got)
	}
	c := f.snapshot()
	if c.loginPosts != 2 {
		t.Errorf("login %d kali, want tepat 2 (awal + SATU login ulang)", c.loginPosts)
	}
	if st.Relogins != 1 || c.invoiceHits != 2 {
		t.Errorf("Relogins %d, permintaan tagihan %d; want 1 dan 2", st.Relogins, c.invoiceHits)
	}
}

func TestSessionExpiryBudgetIsPerCall(t *testing.T) {
	f := newFake(t, sampleRows())
	f.expireAfter, f.expireTimes = 1, 1
	s := newTestScraper(t, f, nil)
	ctx := testCtx(t)
	if _, st, err := s.Invoices(ctx); err != nil || st.Relogins != 1 {
		t.Fatalf("panggilan 1: stats %+v err %v", st, err)
	}
	// Kedaluwarsa lagi di panggilan berikutnya: anggaran login ulang baru.
	f.mu.Lock()
	f.expireTimes = 1
	for _, sess := range f.sessions {
		sess.served = 0
	}
	f.mu.Unlock()
	if got, st, err := s.Invoices(ctx); err != nil || st.Relogins != 1 || len(got) != 7 {
		t.Fatalf("panggilan 2: %d tagihan, stats %+v err %v", len(got), st, err)
	}
}

func TestSessionLoginFormInPlaceCountsAsExpiry(t *testing.T) {
	// Situs yang menampilkan form login di URL tagihan yang sama (status 200).
	f := newFake(t, sampleRows())
	var served atomic.Int32
	f.override = func(w http.ResponseWriter, r *http.Request) {
		if served.Add(1) == 2 { // permintaan ke-2 (halaman 2) mendapat form login
			fmt.Fprint(w, `<html><body><form><input type="password" name="password"></form></body></html>`)
			return
		}
		f.mu.Lock()
		body := f.invoicesHTML(r)
		f.mu.Unlock()
		fmt.Fprint(w, body)
	}
	s := newTestScraper(t, f, nil)
	got, st, err := s.Invoices(testCtx(t))
	if err != nil || len(got) != 7 || st.Relogins != 1 {
		t.Fatalf("%d tagihan, stats %+v, err %v", len(got), st, err)
	}
}

// ---- isi tak terduga ----

func TestUnknownStatusStopsEverythingAndReturnsNothing(t *testing.T) {
	rows := sampleRows()
	rows[4].Status = "Aktif" // halaman 2, baris 2
	f := newFake(t, rows)
	s := newTestScraper(t, f, nil)

	got, st, err := s.Invoices(testCtx(t))
	var unknown *UnknownStatusError
	if !errors.As(err, &unknown) || !errors.Is(err, ErrUnknownStatus) {
		t.Fatalf("err = %v, want ErrUnknownStatus", err)
	}
	if unknown.Value != "Aktif" || unknown.Page != 2 || unknown.Row != 2 {
		t.Errorf("detail = %+v", *unknown)
	}
	if got != nil {
		t.Errorf("tidak boleh ada hasil sebagian: %v", got)
	}
	if want := []string{"page=1", "page=2"}; !reflect.DeepEqual(f.invoiceHits, want) {
		t.Errorf("harus berhenti di halaman 2, permintaan = %v", f.invoiceHits)
	}
	if st.Pages != 2 || st.Rows != 3 {
		t.Errorf("Stats = %+v, want Pages 2 (yang sudah diminta) dan Rows 3 (yang selesai dibaca)", st)
	}
}

func TestUnexpectedPageStructure(t *testing.T) {
	f := newFake(t, sampleRows())
	f.override = func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><body><h1>Sedang dalam pemeliharaan</h1></body></html>`)
	}
	s := newTestScraper(t, f, nil)
	got, _, err := s.Invoices(testCtx(t))
	if !errors.Is(err, ErrUnexpectedPage) || got != nil {
		t.Errorf("got %v err %v, want ErrUnexpectedPage", got, err)
	}
}

func TestHTTPStatusErrorsCarryOnlyMethodPathAndCode(t *testing.T) {
	for _, code := range []int{http.StatusForbidden, http.StatusNotFound, http.StatusInternalServerError, http.StatusBadGateway} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			f := newFake(t, sampleRows())
			f.override = func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(code)
				fmt.Fprint(w, "debug: password="+fakePass+" trace=RAHASIA-DALAM-TUBUH")
			}
			s := newTestScraper(t, f, nil)
			got, _, err := s.Invoices(testCtx(t))
			var se *StatusError
			if !errors.As(err, &se) || !errors.Is(err, ErrHTTPStatus) {
				t.Fatalf("err = %v, want *StatusError", err)
			}
			if se.Code != code || se.Path != "/invoices" || se.Method != http.MethodGet {
				t.Errorf("detail = %+v", *se)
			}
			if got != nil {
				t.Errorf("tagihan harus nil: %v", got)
			}
			for _, leak := range []string{fakePass, "RAHASIA-DALAM-TUBUH", "page=1"} {
				if strings.Contains(err.Error(), leak) {
					t.Errorf("pesan memuat %q: %v", leak, err)
				}
			}
		})
	}
}

func TestHTTPStatusOnLoginPage(t *testing.T) {
	f := newFake(t, sampleRows())
	f.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	})
	s := newTestScraper(t, f, nil)
	err := s.Login(testCtx(t))
	var se *StatusError
	if !errors.As(err, &se) || se.Code != http.StatusServiceUnavailable || se.Path != "/login" {
		t.Errorf("err = %v", err)
	}
}

// ---- batas ----

func TestBodySizeLimit(t *testing.T) {
	t.Run("tubuh mengalir tanpa akhir", func(t *testing.T) {
		f := newFake(t, sampleRows())
		var written atomic.Int64
		finished := make(chan struct{})
		f.override = func(w http.ResponseWriter, r *http.Request) {
			defer close(finished)
			chunk := bytes.Repeat([]byte("<tr><td>x</td></tr>\n"), 3000) // ~60 KB
			for i := 0; i < 1000; i++ {                                  // sampai ~60 MB
				n, err := w.Write(chunk)
				written.Add(int64(n))
				if err != nil {
					return
				}
			}
		}
		s := newTestScraper(t, f, func(c *Config) { c.MaxBodyBytes = 64 << 10 })
		got, _, err := s.Invoices(testCtx(t))
		if !errors.Is(err, ErrTooLarge) || got != nil {
			t.Fatalf("got %v err %v, want ErrTooLarge", got, err)
		}
		select {
		case <-finished:
		case <-time.After(10 * time.Second):
			t.Fatal("server masih menulis: klien tidak menutup koneksi setelah melewati batas")
		}
		if written.Load() > 40<<20 {
			t.Errorf("server sempat menulis %d byte; klien harus berhenti membaca di dekat batas", written.Load())
		}
	})

	t.Run("batas bawaan 5 MB", func(t *testing.T) {
		f := newFake(t, sampleRows())
		f.override = func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, "<html><body>")
			w.Write(bytes.Repeat([]byte("a"), 6<<20))
		}
		s := newTestScraper(t, f, nil)
		if _, _, err := s.Invoices(testCtx(t)); !errors.Is(err, ErrTooLarge) {
			t.Errorf("err = %v, want ErrTooLarge", err)
		}
	})

	t.Run("Content-Length melebihi batas ditolak tanpa dibaca", func(t *testing.T) {
		f := newFake(t, sampleRows())
		f.override = func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Length", "10485760")
			w.Write([]byte("<html>")) // lalu koneksi ditutup server
		}
		s := newTestScraper(t, f, nil)
		if _, _, err := s.Invoices(testCtx(t)); !errors.Is(err, ErrTooLarge) {
			t.Errorf("err = %v, want ErrTooLarge", err)
		}
	})

	t.Run("bom gzip dihitung setelah dekompresi", func(t *testing.T) {
		f := newFake(t, sampleRows())
		f.override = func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Encoding", "gzip")
			zw := gzip.NewWriter(w)
			zero := make([]byte, 1<<20)
			for i := 0; i < 40; i++ { // 40 MB terdekompresi, hanya puluhan KB di kabel
				if _, err := zw.Write(zero); err != nil {
					return
				}
			}
			zw.Close()
		}
		s := newTestScraper(t, f, nil)
		if _, _, err := s.Invoices(testCtx(t)); !errors.Is(err, ErrTooLarge) {
			t.Errorf("err = %v, want ErrTooLarge", err)
		}
	})

	t.Run("tepat di batas lolos, satu byte lebih tidak", func(t *testing.T) {
		body := "<html><body>" + strings.Repeat("a", 1000) + "</body></html>"
		for _, streamed := range []bool{false, true} {
			f := newFake(t, sampleRows())
			f.override = func(w http.ResponseWriter, r *http.Request) {
				if !streamed {
					fmt.Fprint(w, body) // Content-Length diketahui
					return
				}
				half := len(body) / 2
				fmt.Fprint(w, body[:half])
				w.(http.Flusher).Flush() // memaksa chunked: panjang tidak diketahui
				fmt.Fprint(w, body[half:])
			}
			limit := int64(len(body))
			// Di batas: lolos pemeriksaan ukuran, lalu gagal karena isinya bukan tabel.
			_, _, err := newTestScraper(t, f, func(c *Config) { c.MaxBodyBytes = limit }).Invoices(testCtx(t))
			if errors.Is(err, ErrTooLarge) || !errors.Is(err, ErrUnexpectedPage) {
				t.Errorf("streamed=%v tepat di batas: err = %v, want ErrUnexpectedPage", streamed, err)
			}
			_, _, err = newTestScraper(t, f, func(c *Config) { c.MaxBodyBytes = limit - 1 }).Invoices(testCtx(t))
			if !errors.Is(err, ErrTooLarge) {
				t.Errorf("streamed=%v satu byte di atas batas: err = %v, want ErrTooLarge", streamed, err)
			}
		}
	})
}

func TestPageLimit(t *testing.T) {
	t.Run("halaman tanpa akhir (nomor)", func(t *testing.T) {
		f := newFake(t, nil)
		f.endless = true
		s := newTestScraper(t, f, func(c *Config) { c.MaxPages = 5 })
		got, st, err := s.Invoices(testCtx(t))
		if !errors.Is(err, ErrTooLarge) || got != nil {
			t.Fatalf("got %v err %v, want ErrTooLarge", got, err)
		}
		if st.Pages != 5 {
			t.Errorf("Stats.Pages = %d, want 5", st.Pages)
		}
		if c := f.snapshot(); c.invoiceHits != 5 {
			t.Errorf("server menerima %d permintaan halaman, want tepat 5 (batas harus menahan klien)", c.invoiceHits)
		}
	})

	t.Run("halaman tanpa akhir (tautan berikutnya)", func(t *testing.T) {
		f := newFake(t, nil)
		f.endless = true
		s := newTestScraper(t, f, func(c *Config) {
			c.MaxPages = 5
			c.Profile = DefaultProfile()
			c.Profile.InvoicesPath = "/invoices"
			c.Profile.NextSelector = `a[rel="next"]`
		})
		if _, _, err := s.Invoices(testCtx(t)); !errors.Is(err, ErrTooLarge) {
			t.Fatalf("err = %v, want ErrTooLarge", err)
		}
		if c := f.snapshot(); c.invoiceHits != 5 {
			t.Errorf("server menerima %d permintaan, want 5", c.invoiceHits)
		}
	})

	t.Run("tepat di batas", func(t *testing.T) {
		// 7 tagihan = 3 halaman berisi + 1 halaman penutup = 4 halaman dibaca.
		f := newFake(t, sampleRows())
		if _, st, err := newTestScraper(t, f, func(c *Config) { c.MaxPages = 4 }).Invoices(testCtx(t)); err != nil || st.Pages != 4 {
			t.Errorf("MaxPages=4: stats %+v err %v, want lolos", st, err)
		}
		if _, _, err := newTestScraper(t, f, func(c *Config) { c.MaxPages = 3 }).Invoices(testCtx(t)); !errors.Is(err, ErrTooLarge) {
			t.Errorf("MaxPages=3: err = %v, want ErrTooLarge", err)
		}
	})

	t.Run("tautan berputar", func(t *testing.T) {
		f := newFake(t, sampleRows())
		f.cycleNext = true
		s := newTestScraper(t, f, func(c *Config) {
			c.Profile = DefaultProfile()
			c.Profile.InvoicesPath = "/invoices?page=1"
			c.Profile.NextSelector = `a[rel="next"]`
		})
		_, _, err := s.Invoices(testCtx(t))
		if !errors.Is(err, ErrUnexpectedPage) || !strings.Contains(err.Error(), "dua kali") {
			t.Errorf("err = %v, want ErrUnexpectedPage (halaman dibaca dua kali)", err)
		}
		if c := f.snapshot(); c.invoiceHits != 3 {
			t.Errorf("%d permintaan, want 3 (berhenti begitu halaman berulang)", c.invoiceHits)
		}
	})
}

func TestRowLimit(t *testing.T) {
	f := newFake(t, sampleRows())
	if _, _, err := newTestScraper(t, f, func(c *Config) { c.MaxRows = 7 }).Invoices(testCtx(t)); err != nil {
		t.Errorf("MaxRows=7 dengan 7 baris harus lolos: %v", err)
	}
	got, _, err := newTestScraper(t, f, func(c *Config) { c.MaxRows = 6 }).Invoices(testCtx(t))
	if !errors.Is(err, ErrTooLarge) || got != nil {
		t.Errorf("MaxRows=6: got %v err %v, want ErrTooLarge", got, err)
	}
}

func TestRedirectLimits(t *testing.T) {
	chain := func(n int) func(*Config) {
		return func(c *Config) {
			c.Profile = DefaultProfile()
			c.Profile.InvoicesPath = fmt.Sprintf("/chain/%d", n)
		}
	}
	t.Run("rantai pas di batas bawaan (5)", func(t *testing.T) {
		f := newFake(t, sampleRows())
		// /chain/4 -> 3 -> 2 -> 1 -> 0 -> /invoices?page=1 = 5 pengalihan.
		got, _, err := newTestScraper(t, f, chain(4)).Invoices(testCtx(t))
		if err != nil || len(got) != 3 {
			t.Errorf("%d tagihan, err %v; 5 pengalihan harus lolos", len(got), err)
		}
	})
	t.Run("satu lebih dari batas", func(t *testing.T) {
		f := newFake(t, sampleRows())
		got, _, err := newTestScraper(t, f, chain(5)).Invoices(testCtx(t))
		if !errors.Is(err, ErrTooManyRedirects) || got != nil {
			t.Errorf("got %v err %v, want ErrTooManyRedirects", got, err)
		}
	})
	t.Run("batas diatur", func(t *testing.T) {
		f := newFake(t, sampleRows())
		with := func(n int, c func(*Config)) func(*Config) {
			return func(cfg *Config) { c(cfg); cfg.MaxRedirects = n }
		}
		if _, _, err := newTestScraper(t, f, with(2, chain(1))).Invoices(testCtx(t)); err != nil {
			t.Errorf("2 pengalihan dengan batas 2: %v", err)
		}
		if _, _, err := newTestScraper(t, f, with(2, chain(2))).Invoices(testCtx(t)); !errors.Is(err, ErrTooManyRedirects) {
			t.Errorf("3 pengalihan dengan batas 2: err = %v", err)
		}
	})
	t.Run("pengalihan berputar", func(t *testing.T) {
		f := newFake(t, sampleRows())
		s := newTestScraper(t, f, func(c *Config) {
			c.Profile = DefaultProfile()
			c.Profile.InvoicesPath = "/loop/a"
		})
		start := time.Now()
		_, _, err := s.Invoices(testCtx(t))
		if !errors.Is(err, ErrTooManyRedirects) {
			t.Errorf("err = %v, want ErrTooManyRedirects", err)
		}
		if time.Since(start) > 5*time.Second {
			t.Error("pengalihan berputar tidak berhenti dengan cepat")
		}
	})
	t.Run("pengalihan setelah login", func(t *testing.T) {
		f := newFake(t, sampleRows())
		f.loginRedirectTo = "/loop/a"
		s := newTestScraper(t, f, nil)
		if err := s.Login(testCtx(t)); !errors.Is(err, ErrTooManyRedirects) {
			t.Errorf("err = %v, want ErrTooManyRedirects", err)
		}
	})
}

// ---- pengalihan lintas host ----

// otherHost adalah server kedua yang mencatat SETIAP permintaan yang masuk.
// Tes lintas host mensyaratkan ia tidak menerima apa pun.
type otherHost struct {
	srv  *httptest.Server
	mu   sync.Mutex
	seen []string // "METHOD path cookie=... auth=... bodyLen=..."
}

func newOtherHost(t *testing.T) *otherHost {
	t.Helper()
	o := &otherHost{}
	o.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		o.mu.Lock()
		o.seen = append(o.seen, fmt.Sprintf("%s %s cookie=%q auth=%q body=%q", r.Method, r.URL.String(), r.Header.Get("Cookie"), r.Header.Get("Authorization"), body))
		o.mu.Unlock()
		fmt.Fprint(w, `<html><body>host lain</body></html>`)
	}))
	t.Cleanup(o.srv.Close)
	return o
}

func (o *otherHost) requests() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]string(nil), o.seen...)
}

func TestCrossHostRedirectIsRejectedAndNothingLeaks(t *testing.T) {
	cases := map[string]func(f *fakeBilling, o *otherHost){
		"tagihan dialihkan ke host lain": func(f *fakeBilling, o *otherHost) {
			f.invoicesRedirect = o.srv.URL + "/curi?x=1"
		},
		"POST login dialihkan ke host lain": func(f *fakeBilling, o *otherHost) {
			f.loginRedirectTo = o.srv.URL + "/mendarat"
		},
		"tautan berikutnya ke host lain": func(f *fakeBilling, o *otherHost) {
			f.nextHost = o.srv.URL
		},
		"host sama, nama lain (localhost vs 127.0.0.1)": func(f *fakeBilling, o *otherHost) {
			f.invoicesRedirect = strings.Replace(f.srv.URL, "127.0.0.1", "localhost", 1) + "/invoices?page=1"
		},
	}
	for name, setup := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFake(t, sampleRows())
			o := newOtherHost(t)
			setup(f, o)
			s := newTestScraper(t, f, func(c *Config) {
				if name == "tautan berikutnya ke host lain" {
					c.Profile = DefaultProfile()
					c.Profile.InvoicesPath = "/invoices"
					c.Profile.NextSelector = `a[rel="next"]`
				}
			})
			got, _, err := s.Invoices(testCtx(t))
			if !errors.Is(err, ErrCrossHostRedirect) {
				t.Fatalf("err = %v, want ErrCrossHostRedirect", err)
			}
			if errors.Is(err, ErrLoginFailed) {
				t.Errorf("pengalihan lintas host bukan login ditolak: %v", err)
			}
			if got != nil {
				t.Errorf("tagihan harus nil: %v", got)
			}
			if seen := o.requests(); len(seen) != 0 {
				t.Errorf("host kedua menerima %d permintaan (cookie/kredensial bocor): %q", len(seen), seen)
			}
			if strings.Contains(err.Error(), o.srv.URL) || strings.Contains(err.Error(), "/curi") {
				t.Errorf("pesan memuat tujuan pengalihan: %v", err)
			}
		})
	}
}

func TestCheckRedirectOrigins(t *testing.T) {
	https, err := New(Config{BaseURL: "https://Billing.Example.com", Username: "u", Password: "p"})
	if err != nil {
		t.Fatal(err)
	}
	http80, err := New(Config{BaseURL: "http://10.0.0.5:8080", Username: "u", Password: "p"})
	if err != nil {
		t.Fatal(err)
	}
	req := func(raw string) *http.Request {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		return &http.Request{URL: u}
	}
	for _, tc := range []struct {
		s   *Scraper
		url string
	}{
		{https, "https://billing.example.com/dashboard"},
		{https, "https://BILLING.EXAMPLE.COM:443/dashboard"}, // huruf besar dan port bawaan eksplisit
		{http80, "http://10.0.0.5:8080/x"},
	} {
		if err := tc.s.checkRedirect(req(tc.url), nil); err != nil {
			t.Errorf("%s harus diizinkan: %v", tc.url, err)
		}
	}

	rejected := []struct {
		s   *Scraper
		url string
	}{
		{https, "http://billing.example.com/dashboard"},      // turun ke http
		{https, "https://billing.example.com:8443/x"},        // port lain
		{https, "https://billing.example.com.evil.test/x"},   // akhiran
		{https, "https://evil.test/x"},                       // host lain
		{https, "https://sub.billing.example.com/x"},         // subdomain
		{https, "ftp://billing.example.com/x"},               // skema lain
		{http80, "http://10.0.0.5:8081/x"},                   // port lain
		{http80, "http://10.0.0.5/x"},                        // port bawaan 80, bukan 8080
		{http80, "https://10.0.0.5:8080/x"},                  // skema lain
		{https, "https://billing.example.com@evil.test/x"},   // userinfo menyamar
		{https, "https://evil.test\\@billing.example.com/x"}, // trik backslash
	}
	for _, tc := range rejected {
		u, err := url.Parse(tc.url)
		if err != nil {
			continue // tidak bisa diurai: Go tidak akan mengirimnya juga
		}
		if err := tc.s.checkRedirect(&http.Request{URL: u}, nil); !errors.Is(err, ErrCrossHostRedirect) {
			t.Errorf("%s harus ditolak, err = %v", tc.url, err)
		}
	}

	// Batas jumlah: len(via) adalah pengalihan yang sudah diikuti.
	via := func(n int) []*http.Request { return make([]*http.Request, n) }
	same := req("https://billing.example.com/x")
	if err := https.checkRedirect(same, via(DefaultMaxRedirects)); err != nil {
		t.Errorf("pengalihan ke-%d harus lolos: %v", DefaultMaxRedirects, err)
	}
	if err := https.checkRedirect(same, via(DefaultMaxRedirects+1)); !errors.Is(err, ErrTooManyRedirects) {
		t.Errorf("pengalihan ke-%d harus ditolak: %v", DefaultMaxRedirects+1, err)
	}
}

func TestNextURL(t *testing.T) {
	s, err := New(Config{BaseURL: "https://billing.example.com", Username: "u", Password: "p", Profile: func() Profile {
		p := DefaultProfile()
		p.InvoicesPath = "/invoices"
		p.NextSelector = "a.next"
		return p
	}()})
	if err != nil {
		t.Fatal(err)
	}
	pageAt := func(html string) *page {
		u, _ := url.Parse("https://billing.example.com/invoices?page=2")
		return &page{status: 200, url: u, doc: docOf(t, "<html><body>"+html+"</body></html>")}
	}

	for _, end := range []string{
		``,                               // tidak ada tautan
		`<a class="next" href="">x</a>`,  // href kosong
		`<a class="next" href="#">x</a>`, // href #
		`<a class="next" href="  #  ">x</a>`,
		`<a class="next">x</a>`, // tanpa href
		`<a class="next" href="javascript:void(0)">x</a>`,
		`<a class="next" href="JavaScript:void(0)">x</a>`,
	} {
		if next, err := s.nextURL(pageAt(end)); next != nil || err != nil {
			t.Errorf("%q: next %v err %v, want akhir (nil, nil)", end, next, err)
		}
	}

	ok := map[string]string{
		`<a class="next" href="/invoices?page=3">`:                                "https://billing.example.com/invoices?page=3",
		`<a class="next" href="?page=3">`:                                         "https://billing.example.com/invoices?page=3",
		`<a class="next" href="page3.html#atas">`:                                 "https://billing.example.com/page3.html",
		`<a class="next" href="https://billing.example.com:443/invoices?page=3">`: "https://billing.example.com:443/invoices?page=3",
		`<a class="next" href="//billing.example.com/invoices?page=3">`:           "https://billing.example.com/invoices?page=3",
	}
	for html, want := range ok {
		next, err := s.nextURL(pageAt(html))
		if err != nil || next == nil || next.String() != want {
			t.Errorf("%q: got %v err %v, want %s", html, next, err, want)
		}
	}

	for _, bad := range []string{
		`<a class="next" href="https://evil.test/invoices?page=3">`,
		`<a class="next" href="http://billing.example.com/invoices?page=3">`,
		`<a class="next" href="https://billing.example.com:8443/invoices">`,
		`<a class="next" href="//evil.test/x">`,
		`<a class="next" href="ftp://billing.example.com/x">`,
		`<a class="next" href="mailto:a@b.c">`,
	} {
		if next, err := s.nextURL(pageAt(bad)); !errors.Is(err, ErrCrossHostRedirect) || next != nil {
			t.Errorf("%q: next %v err %v, want ErrCrossHostRedirect", bad, next, err)
		}
	}
	if _, err := s.nextURL(pageAt(`<a class="next" href="http://[::1">`)); !errors.Is(err, ErrUnexpectedPage) {
		t.Errorf("href tak terbaca: err = %v", err)
	}
}

// ---- konteks, timeout, jaringan ----

func TestContextCanceledBeforeCallSendsNothing(t *testing.T) {
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, _, err := s.Invoices(ctx)
	if !errors.Is(err, context.Canceled) || got != nil {
		t.Errorf("got %v err %v, want context.Canceled", got, err)
	}
	if err := s.Login(ctx); !errors.Is(err, context.Canceled) {
		t.Errorf("Login err = %v, want context.Canceled", err)
	}
	if c := f.snapshot(); c.loginGets != 0 || c.invoiceHits != 0 {
		t.Errorf("konteks yang sudah batal tetap mengirim permintaan: %+v", c)
	}
}

func TestContextCanceledDuringRequestReturnsPromptly(t *testing.T) {
	f := newFake(t, sampleRows())
	started := make(chan struct{})
	var once sync.Once
	f.override = func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { close(started) })
		select {
		case <-r.Context().Done():
		case <-time.After(10 * time.Second):
		}
	}
	s := newTestScraper(t, f, nil)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go func() {
		<-started
		cancel()
	}()
	begin := time.Now()
	got, _, err := s.Invoices(ctx)
	if !errors.Is(err, context.Canceled) || got != nil {
		t.Errorf("got %v err %v, want context.Canceled", got, err)
	}
	if took := time.Since(begin); took > 3*time.Second {
		t.Errorf("pembatalan butuh %s; harus segera", took)
	}
}

func TestContextCanceledBetweenPagesStopsFetching(t *testing.T) {
	f := newFake(t, sampleRows())
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	f.onInvoice = func(hit int) {
		if hit == 2 {
			cancel() // batal saat halaman 2 dilayani
		}
	}
	s := newTestScraper(t, f, nil)
	got, _, err := s.Invoices(ctx)
	if !errors.Is(err, context.Canceled) || got != nil {
		t.Errorf("got %v err %v, want context.Canceled", got, err)
	}
	if c := f.snapshot(); c.invoiceHits != 2 {
		t.Errorf("%d permintaan tagihan; harus berhenti di 2 setelah batal", c.invoiceHits)
	}
}

func TestContextDeadlineIsReported(t *testing.T) {
	f := newFake(t, sampleRows())
	f.override = func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}
	s := newTestScraper(t, f, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	_, _, err := s.Invoices(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("err = %v, want context.DeadlineExceeded", err)
	}
}

func TestPerRequestTimeout(t *testing.T) {
	f := newFake(t, sampleRows())
	f.override = func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}
	s := newTestScraper(t, f, func(c *Config) { c.Timeout = 200 * time.Millisecond })
	begin := time.Now()
	got, _, err := s.Invoices(testCtx(t))
	if !errors.Is(err, ErrNetwork) || got != nil {
		t.Fatalf("got %v err %v, want ErrNetwork", got, err)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("penyebab timeout harus ikut terbungkus: %v", err)
	}
	if !strings.Contains(err.Error(), "batas waktu habis") {
		t.Errorf("pesan harus menyebut batas waktu: %v", err)
	}
	if took := time.Since(begin); took > 3*time.Second {
		t.Errorf("timeout 200ms butuh %s", took)
	}
}

func TestSlowBodyAlsoTimesOut(t *testing.T) {
	// Header cepat, tubuh menetes: Timeout total mencakup pembacaan tubuh.
	f := newFake(t, sampleRows())
	f.override = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fl := w.(http.Flusher)
		fmt.Fprint(w, "<html><body>")
		fl.Flush()
		for i := 0; i < 50; i++ {
			select {
			case <-r.Context().Done():
				return
			case <-time.After(100 * time.Millisecond):
			}
			fmt.Fprint(w, " ")
			fl.Flush()
		}
	}
	s := newTestScraper(t, f, func(c *Config) { c.Timeout = 300 * time.Millisecond })
	begin := time.Now()
	_, _, err := s.Invoices(testCtx(t))
	if !errors.Is(err, ErrNetwork) {
		t.Fatalf("err = %v, want ErrNetwork", err)
	}
	if took := time.Since(begin); took > 3*time.Second {
		t.Errorf("tubuh yang menetes menahan %s", took)
	}
}

func TestConnectionRefusedHidesAddress(t *testing.T) {
	f := newFake(t, sampleRows())
	addr := f.srv.Listener.Addr().String()
	f.srv.Close()
	s := newTestScraper(t, f, nil)
	_, _, err := s.Invoices(testCtx(t))
	if !errors.Is(err, ErrNetwork) {
		t.Fatalf("err = %v, want ErrNetwork", err)
	}
	var netErr *networkError
	if !errors.As(err, &netErr) || netErr.cause == nil {
		t.Fatalf("penyebab asli harus tersedia lewat errors.As/Unwrap: %v", err)
	}
	for _, leak := range []string{addr, "127.0.0.1", "http://"} {
		if strings.Contains(err.Error(), leak) {
			t.Errorf("pesan memuat %q: %v", leak, err)
		}
	}
	if !strings.Contains(err.Error(), "GET /login") {
		t.Errorf("pesan harus menyebut metode dan path: %v", err)
	}
}

// ---- TLS ----

func TestTLSVerificationStaysOn(t *testing.T) {
	f := newFakeWith(t, sampleRows(), true)

	t.Run("sertifikat tak dipercaya ditolak", func(t *testing.T) {
		s := newTestScraper(t, f, nil) // transport bawaan: tanpa CA server tiruan
		got, _, err := s.Invoices(testCtx(t))
		if !errors.Is(err, ErrNetwork) || got != nil {
			t.Fatalf("got %v err %v, want ErrNetwork", got, err)
		}
		var certErr *tls.CertificateVerificationError
		var unknown x509.UnknownAuthorityError
		if !errors.As(err, &certErr) && !errors.As(err, &unknown) {
			t.Errorf("penyebabnya harus kegagalan verifikasi sertifikat: %v", err)
		}
		if !strings.Contains(err.Error(), "sertifikat TLS") {
			t.Errorf("pesan harus menjelaskan: %v", err)
		}
		if c := f.snapshot(); c.loginGets != 0 || c.loginPosts != 0 {
			t.Errorf("handler tersentuh (%+v) padahal jabat tangan TLS harus gagal; kredensial tidak boleh dikirim", c)
		}
	})

	t.Run("dipercaya lewat transport server tiruan", func(t *testing.T) {
		s := newTestScraper(t, f, nil, WithTransport(f.srv.Client().Transport))
		got, _, err := s.Invoices(testCtx(t))
		if err != nil || !reflect.DeepEqual(got, sampleWant()) {
			t.Fatalf("%d tagihan, err %v", len(got), err)
		}
		if f.srv.TLS == nil {
			t.Error("server tiruan harus TLS")
		}
	})
}

// ---- rahasia tidak bocor ----

type leakCase struct {
	name  string
	setup func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config)
	run   func(t *testing.T, s *Scraper) error
}

func TestSecretsNeverAppearInErrorsOrLogs(t *testing.T) {
	invoices := func(t *testing.T, s *Scraper) error {
		_, _, err := s.Invoices(testCtx(t))
		return err
	}
	cases := []leakCase{
		{name: "kata sandi salah", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			return func(c *Config) { c.Password = "salah-" + fakePass }
		}, run: invoices},
		{name: "CSRF basi", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.breakToken = true
			return nil
		}, run: invoices},
		{name: "CSRF hilang", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.csrf = "none"
			return nil
		}, run: invoices},
		{name: "login rerender", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.loginFail = "rerender"
			return func(c *Config) { c.Password = "salah" }
		}, run: invoices},
		{name: "sesi hilang terus", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.denyInvoices = true
			return nil
		}, run: invoices},
		{name: "status tak dikenal", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.rows[1].Status = "Aneh"
			return nil
		}, run: invoices},
		{name: "HTTP 500 dengan rahasia di tubuh", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.override = func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(500)
				fmt.Fprint(w, "password="+fakePass+" cookie sid=abc token=def")
			}
			return nil
		}, run: invoices},
		{name: "halaman tak terduga memuat token", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.override = func(w http.ResponseWriter, r *http.Request) {
				f.mu.Lock()
				secrets := strings.Join(f.issued, " ")
				f.mu.Unlock()
				fmt.Fprint(w, "<html><body>"+secrets+" "+fakePass+"</body></html>")
			}
			return nil
		}, run: invoices},
		{name: "lintas host", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.invoicesRedirect = o.srv.URL + "/?sid=bocor"
			return nil
		}, run: invoices},
		{name: "terlalu banyak pengalihan", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			return func(c *Config) {
				c.Profile = DefaultProfile()
				c.Profile.InvoicesPath = "/loop/a"
			}
		}, run: invoices},
		{name: "terlalu besar", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			return func(c *Config) { c.MaxBodyBytes = 100 }
		}, run: invoices},
		{name: "batas halaman", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			return func(c *Config) { c.MaxPages = 1 }
		}, run: invoices},
		{name: "timeout", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.override = func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }
			return func(c *Config) { c.Timeout = 150 * time.Millisecond }
		}, run: invoices},
		{name: "server mati", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			f.srv.Close()
			return nil
		}, run: invoices},
		{name: "login langsung", setup: func(t *testing.T, f *fakeBilling, o *otherHost) func(*Config) {
			return func(c *Config) { c.Password = "salah" }
		}, run: func(t *testing.T, s *Scraper) error { return s.Login(testCtx(t)) }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFake(t, sampleRows())
			o := newOtherHost(t)
			mutate := tc.setup(t, f, o)
			var logs syncBuffer
			logger := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
			s := newTestScraper(t, f, mutate, WithLogger(logger))

			err := tc.run(t, s)
			if err == nil {
				t.Fatal("skenario ini harus menghasilkan galat")
			}
			secrets := append(f.secrets(), "salah-"+fakePass, "token=def", "sid=abc")
			for _, view := range []string{err.Error(), fmt.Sprintf("%v", err), logs.String()} {
				for _, secret := range secrets {
					if secret != "" && strings.Contains(view, secret) {
						t.Errorf("rahasia %q muncul di: %s", secret, view)
					}
				}
				for _, bad := range []string{"127.0.0.1", "Set-Cookie", "sid="} {
					if strings.Contains(view, bad) {
						t.Errorf("%q muncul di: %s", bad, view)
					}
				}
			}
			if s.String() != fmt.Sprint(s) || strings.Contains(s.String(), fakePass) {
				t.Errorf("String() membocorkan: %s", s.String())
			}
		})
	}
}

func TestLogsOnSuccessAndReloginHaveNoSecrets(t *testing.T) {
	f := newFake(t, sampleRows())
	f.expireAfter, f.expireTimes = 1, 1
	var logs syncBuffer
	logger := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	s := newTestScraper(t, f, nil, WithLogger(logger))
	if _, _, err := s.Invoices(testCtx(t)); err != nil {
		t.Fatal(err)
	}
	out := logs.String()
	for _, want := range []string{"login billing berhasil", "halaman tagihan dibaca", "sesi billing berakhir, login ulang", "tagihan billing dibaca"} {
		if !strings.Contains(out, want) {
			t.Errorf("log tidak memuat %q:\n%s", want, out)
		}
	}
	for _, secret := range f.secrets() {
		if strings.Contains(out, secret) {
			t.Errorf("log memuat rahasia %q:\n%s", secret, out)
		}
	}
	if strings.Contains(strings.ToLower(out), "cookie") {
		t.Errorf("log menyebut cookie:\n%s", out)
	}
}

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

// ---- penilaian login ----

func TestCheckLogin(t *testing.T) {
	newS := func(mutate func(*Profile)) *Scraper {
		p := DefaultProfile()
		if mutate != nil {
			mutate(&p)
		}
		s, err := New(Config{BaseURL: "https://billing.example.com", Username: "u", Password: "p", Profile: p})
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	pg := func(status int, path, html string) *page {
		u, _ := url.Parse("https://billing.example.com" + path)
		p := &page{status: status, url: u}
		if status >= 200 && status <= 299 {
			p.doc = docOf(t, "<html><body>"+html+"</body></html>")
		}
		return p
	}
	loggedIn := `<a href="/logout">Keluar</a>`
	withPassword := `<a href="/logout">Keluar</a><input type="password" name="new">`

	cases := []struct {
		name    string
		s       *Scraper
		page    *page
		wantErr error // nil = berhasil
	}{
		{"dasbor", newS(nil), pg(200, "/dashboard", loggedIn), nil},
		{"masih di halaman login", newS(nil), pg(200, "/login", loggedIn), ErrLoginFailed},
		{"login dengan garis miring", newS(nil), pg(200, "/login/", loggedIn), ErrLoginFailed},
		{"form login ditampilkan ulang di tempat lain", newS(nil), pg(200, "/dashboard", `<input type="password" name="password">`), ErrLoginFailed},
		{"kotak sandi huruf besar", newS(nil), pg(200, "/dashboard", `<INPUT TYPE="PASSWORD">`), ErrLoginFailed},
		{"401", newS(nil), pg(401, "/login", ""), ErrLoginFailed},
		{"403", newS(nil), pg(403, "/login", ""), ErrLoginFailed},
		{"419", newS(nil), pg(419, "/login", ""), ErrLoginFailed},
		{"422", newS(nil), pg(422, "/login", ""), ErrLoginFailed},
		{"500", newS(nil), pg(500, "/login", ""), ErrHTTPStatus},
		{"404", newS(nil), pg(404, "/dashboard", ""), ErrHTTPStatus},
		{"post path sebagai halaman login", newS(func(p *Profile) { p.LoginPostPath = "/session" }), pg(200, "/session", loggedIn), ErrLoginFailed},
		{"landing cocok", newS(func(p *Profile) { p.LoginSuccess.LandingPath = "/dashboard" }), pg(200, "/dashboard", loggedIn), nil},
		{"landing tidak cocok", newS(func(p *Profile) { p.LoginSuccess.LandingPath = "/dashboard" }), pg(200, "/beranda", loggedIn), ErrLoginFailed},
		{"penanda sukses ada", newS(func(p *Profile) { p.LoginSuccess.SuccessSelector = `a[href="/logout"]` }), pg(200, "/beranda", loggedIn), nil},
		{"penanda sukses tidak ada", newS(func(p *Profile) { p.LoginSuccess.SuccessSelector = `a[href="/logout"]` }), pg(200, "/beranda", `<p>halo</p>`), ErrLoginFailed},
		{"penanda sukses menggantikan heuristik kotak sandi", newS(func(p *Profile) { p.LoginSuccess.SuccessSelector = `a[href="/logout"]` }), pg(200, "/beranda", withPassword), nil},
		{"penanda gagal", newS(func(p *Profile) { p.LoginSuccess.FailureSelector = ".alert-danger" }), pg(200, "/dashboard", loggedIn+`<div class="alert-danger">x</div>`), ErrLoginFailed},
		{"penanda gagal menang atas landing", newS(func(p *Profile) {
			p.LoginSuccess = LoginSuccess{LandingPath: "/dashboard", FailureSelector: ".alert-danger"}
		}), pg(200, "/dashboard", `<div class="alert-danger">x</div>`), ErrLoginFailed},
		{"penanda gagal tidak ada", newS(func(p *Profile) { p.LoginSuccess.FailureSelector = ".alert-danger" }), pg(200, "/dashboard", loggedIn), nil},
	}
	for _, tc := range cases {
		err := tc.s.checkLogin(tc.page)
		switch {
		case tc.wantErr == nil && err != nil:
			t.Errorf("%s: err = %v, want sukses", tc.name, err)
		case tc.wantErr != nil && !errors.Is(err, tc.wantErr):
			t.Errorf("%s: err = %v, want %v", tc.name, err, tc.wantErr)
		}
	}
}

// ---- mengenali sesi yang berakhir ----

func TestLoggedOutDetection(t *testing.T) {
	s, err := New(Config{BaseURL: "https://billing.example.com", Username: "u", Password: "p"})
	if err != nil {
		t.Fatal(err)
	}
	pg := func(status int, path, html string) *page {
		u, _ := url.Parse("https://billing.example.com" + path)
		p := &page{status: status, url: u}
		if status >= 200 && status <= 299 {
			p.doc = docOf(t, "<html><body>"+html+"</body></html>")
		}
		return p
	}
	const table = `<table class="invoices"><tbody><tr><td class="pppoe">a</td><td class="status">lunas</td></tr></tbody></table>`

	cases := []struct {
		name string
		page *page
		want bool
	}{
		{"halaman tagihan biasa", pg(200, "/invoices", table), false},
		{"dialihkan ke /login (halaman kosong, tanpa kotak sandi)", pg(200, "/login", `<div id="app"></div>`), true},
		{"dialihkan ke /login/ dengan garis miring", pg(200, "/login/", ""), true},
		{"401", pg(401, "/invoices", ""), true},
		{"form login di tempat (kotak sandi, tanpa baris)", pg(200, "/invoices", `<form><input type="password"></form>`), true},
		{"kotak sandi tetapi ada baris tagihan", pg(200, "/invoices", table+`<input type="password" name="ganti">`), false},
		{"halaman pemeliharaan 200 tanpa kotak sandi", pg(200, "/invoices", `<h1>Pemeliharaan</h1>`), false},
		{"403 bukan sesi berakhir", pg(403, "/invoices", ""), false},
		{"500 bukan sesi berakhir", pg(500, "/invoices", ""), false},
	}
	for _, tc := range cases {
		if got := s.loggedOut(tc.page); got != tc.want {
			t.Errorf("%s: loggedOut = %v, want %v", tc.name, got, tc.want)
		}
	}
}
