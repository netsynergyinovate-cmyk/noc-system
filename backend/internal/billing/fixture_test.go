package billing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// Server billing tiruan. Meniru situs berbasis Laravel: halaman login membawa
// token CSRF yang berbeda untuk tiap sesi dan terikat ke cookie sesi; POST login
// memeriksa cookie + token + kredensial; halaman tagihan berpaginasi dan hanya
// terbuka untuk sesi yang sudah login. Server mencatat apa yang diterimanya
// supaya tes bisa menegaskan cookie benar-benar dipakai.

const (
	fakeUser = "operator-billing"
	fakePass = "S3kr3t!Pass-xyz"
)

// fakeRow berisi HTML mentah untuk tiap sel, supaya tes mengatur sendiri entitas
// dan spasinya.
type fakeRow struct {
	Name, Ref, Status string
}

type fakeSession struct {
	token    string
	loggedIn bool
	served   int // halaman tagihan yang sudah dilayani di sesi ini
}

type fakeBilling struct {
	t   *testing.T
	srv *httptest.Server

	mu       sync.Mutex
	sessions map[string]*fakeSession

	// Isi.
	rows     []fakeRow
	pageSize int

	// Pengatur perilaku (diatur sebelum Scraper dipakai).
	csrf             string // "input" (bawaan), "meta", "none", "empty"
	loginFail        string // "redirect" (bawaan), "rerender", "422"
	unauthStatus     int    // 0: dialihkan ke /login; 401: jawab 401
	expireAfter      int    // sesi mati setelah melayani N halaman tagihan
	expireTimes      int    // berapa kali itu terjadi; -1 selamanya
	denyInvoices     bool   // halaman tagihan selalu minta login
	dirty            bool   // sisipkan HTML kotor
	cycleNext        bool   // tautan "berikutnya" halaman terakhir menunjuk ke halaman 1
	endless          bool   // setiap nomor halaman punya baris, tanpa akhir
	endlessCap       int    // setelah sekian permintaan, halaman kosong
	loginRedirectTo  string // tujuan setelah login berhasil (bawaan /dashboard)
	invoicesRedirect string // bila diisi, /invoices (yang sudah login) dialihkan ke sini
	requireExtra     map[string]string
	override         http.HandlerFunc // bila diisi, menjawab /invoices setelah sesi dinilai sah
	breakToken       bool             // token di halaman login sudah basi saat POST tiba
	loginCap         int              // bila > 0, POST login ke-(cap+1) dan seterusnya dijawab 500
	nextHost         string           // bila diisi, tautan "berikutnya" menunjuk ke host ini
	emptyMarker      bool             // halaman 1 tanpa tagihan memuat penanda "belum ada tagihan"
	onInvoice        func(hit int)    // dipanggil (tanpa kunci) tiap permintaan /invoices yang sah

	// Catatan.
	loginGets, loginPosts int
	postsWithCookie       int
	rejectedPosts         int
	invoiceHits           []string // query tiap permintaan /invoices
	unauthedInvoiceHits   int
	authedInvoiceHits     int
	issued                []string // semua token dan id sesi yang pernah dikeluarkan
	postForms             []url.Values
	postPaths             []string
	violations            []string
}

func newFake(t *testing.T, rows []fakeRow) *fakeBilling {
	t.Helper()
	return newFakeWith(t, rows, false)
}

func newFakeWith(t *testing.T, rows []fakeRow, useTLS bool) *fakeBilling {
	t.Helper()
	f := &fakeBilling{
		t:          t,
		sessions:   map[string]*fakeSession{},
		rows:       rows,
		pageSize:   3,
		csrf:       "input",
		endlessCap: 50,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/login", f.handleLogin)
	mux.HandleFunc("/session", f.handleLogin)
	mux.HandleFunc("/dashboard", f.handleDashboard)
	mux.HandleFunc("/invoices", f.handleInvoices)
	mux.HandleFunc("/loop/a", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/loop/b", http.StatusFound) })
	mux.HandleFunc("/loop/b", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/loop/a", http.StatusFound) })
	mux.HandleFunc("/chain/", func(w http.ResponseWriter, r *http.Request) {
		n, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/chain/"))
		if err != nil || n < 0 {
			http.NotFound(w, r)
			return
		}
		if n == 0 {
			http.Redirect(w, r, "/invoices?page=1", http.StatusFound)
			return
		}
		http.Redirect(w, r, fmt.Sprintf("/chain/%d", n-1), http.StatusFound)
	})
	f.srv = httptest.NewUnstartedServer(mux)
	if useTLS {
		// Jabat tangan yang ditolak klien memang diharapkan; jangan ramaikan keluaran tes.
		f.srv.Config.ErrorLog = log.New(io.Discard, "", 0)
		f.srv.StartTLS()
	} else {
		f.srv.Start()
	}
	t.Cleanup(f.srv.Close)
	return f
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// sessionFor mengembalikan sesi dari cookie, atau nil. Pemanggil memegang f.mu.
func (f *fakeBilling) sessionFor(r *http.Request) *fakeSession {
	c, err := r.Cookie("sid")
	if err != nil {
		return nil
	}
	return f.sessions[c.Value]
}

// newSession membuat sesi dan memasang cookie-nya. Pemanggil memegang f.mu.
func (f *fakeBilling) newSession(w http.ResponseWriter) *fakeSession {
	sid, token := randomHex(16), randomHex(16)
	sess := &fakeSession{token: token}
	f.sessions[sid] = sess
	f.issued = append(f.issued, sid, token)
	http.SetCookie(w, &http.Cookie{Name: "sid", Value: sid, Path: "/", HttpOnly: true})
	return sess
}

func (f *fakeBilling) violate(format string, args ...any) {
	f.violations = append(f.violations, fmt.Sprintf(format, args...))
}

func (f *fakeBilling) handleLogin(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch r.Method {
	case http.MethodGet:
		f.loginGets++
		sess := f.sessionFor(r)
		if sess == nil {
			sess = f.newSession(w)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, f.loginHTML(sess, ""))
		if f.breakToken {
			sess.token = randomHex(16)
			f.issued = append(f.issued, sess.token)
		}
	case http.MethodPost:
		f.loginPosts++
		f.postPaths = append(f.postPaths, r.URL.Path)
		if f.loginCap > 0 && f.loginPosts > f.loginCap {
			http.Error(w, "terlalu banyak login", http.StatusInternalServerError)
			return
		}
		sess := f.sessionFor(r)
		if sess != nil {
			f.postsWithCookie++
		}
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		f.postForms = append(f.postForms, r.PostForm)
		token := r.PostFormValue("_token")
		if sess == nil || token == "" || token != sess.token {
			f.rejectedPosts++
			http.Error(w, "Page Expired", 419)
			return
		}
		for k, v := range f.requireExtra {
			if r.PostFormValue(k) != v {
				f.rejectedPosts++
				http.Error(w, "missing extra field", http.StatusBadRequest)
				return
			}
		}
		if r.PostFormValue("username") != fakeUser || r.PostFormValue("password") != fakePass {
			f.rejectedPosts++
			switch f.loginFail {
			case "rerender":
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				fmt.Fprint(w, f.loginHTML(sess, "Kredensial salah."))
			case "422":
				http.Error(w, "invalid credentials", http.StatusUnprocessableEntity)
			default:
				http.Redirect(w, r, "/login", http.StatusFound)
			}
			return
		}
		// Login berhasil: ganti id sesi (mencegah session fixation).
		delete(f.sessions, cookieValue(r))
		fresh := f.newSession(w)
		fresh.loggedIn = true
		dest := f.loginRedirectTo
		if dest == "" {
			dest = "/dashboard"
		}
		http.Redirect(w, r, dest, http.StatusFound)
	default:
		http.Error(w, "method", http.StatusMethodNotAllowed)
	}
}

func cookieValue(r *http.Request) string {
	if c, err := r.Cookie("sid"); err == nil {
		return c.Value
	}
	return ""
}

func (f *fakeBilling) loginHTML(sess *fakeSession, errMsg string) string {
	var b strings.Builder
	b.WriteString(`<!doctype html><html><head><title>Masuk</title>`)
	if f.csrf == "meta" {
		fmt.Fprintf(&b, `<meta name="csrf-token" content="%s">`, sess.token)
	}
	b.WriteString(`</head><body>`)
	if errMsg != "" {
		fmt.Fprintf(&b, `<div class="alert alert-danger">%s</div>`, errMsg)
	}
	b.WriteString(`<form method="post" action="/login">`)
	switch f.csrf {
	case "input":
		fmt.Fprintf(&b, `<input type="hidden" name="_token" value="%s">`, sess.token)
	case "empty":
		b.WriteString(`<input type="hidden" name="_token" value="">`)
	}
	b.WriteString(`<input type="text" name="username"><input type="password" name="password"><button>Masuk</button></form></body></html>`)
	return b.String()
}

func (f *fakeBilling) handleDashboard(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	sess := f.sessionFor(r)
	if sess == nil || !sess.loggedIn {
		http.Redirect(w, r, "/login", http.StatusFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, `<!doctype html><html><body><h1>Dasbor</h1><a href="/logout">Keluar</a></body></html>`)
}

func (f *fakeBilling) pageCount() int {
	if f.pageSize <= 0 {
		return 1
	}
	return (len(f.rows) + f.pageSize - 1) / f.pageSize
}

func (f *fakeBilling) handleInvoices(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.invoiceHits = append(f.invoiceHits, r.URL.RawQuery)
	sess := f.sessionFor(r)
	valid := sess != nil && sess.loggedIn && !f.denyInvoices
	if valid && f.expireAfter > 0 && sess.served >= f.expireAfter && f.expireTimes != 0 {
		sess.loggedIn = false
		if f.expireTimes > 0 {
			f.expireTimes--
		}
		valid = false
	}
	if !valid {
		f.unauthedInvoiceHits++
		f.mu.Unlock()
		if f.unauthStatus == http.StatusUnauthorized {
			http.Error(w, "Unauthenticated", http.StatusUnauthorized)
			return
		}
		http.Redirect(w, r, "/login", http.StatusFound)
		return
	}
	f.authedInvoiceHits++
	sess.served++
	override, redirect, onInvoice := f.override, f.invoicesRedirect, f.onInvoice
	hit := len(f.invoiceHits)
	body := f.invoicesHTML(r)
	f.mu.Unlock()

	if onInvoice != nil {
		onInvoice(hit)
	}

	if redirect != "" {
		http.Redirect(w, r, redirect, http.StatusFound)
		return
	}
	if override != nil {
		override(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, body)
}

// rowsForPage mengembalikan baris halaman p (mulai 1). Pemanggil memegang f.mu.
func (f *fakeBilling) rowsForPage(p int) []fakeRow {
	if f.endless {
		if len(f.invoiceHits) > f.endlessCap {
			return nil
		}
		return []fakeRow{
			{Name: fmt.Sprintf("endless-%d-a", p), Ref: fmt.Sprintf("E%d-a", p), Status: "Lunas"},
			{Name: fmt.Sprintf("endless-%d-b", p), Ref: fmt.Sprintf("E%d-b", p), Status: "Lunas"},
		}
	}
	start := (p - 1) * f.pageSize
	if p < 1 || start >= len(f.rows) {
		return nil
	}
	end := min(start+f.pageSize, len(f.rows))
	return f.rows[start:end]
}

func (f *fakeBilling) invoicesHTML(r *http.Request) string {
	p, err := strconv.Atoi(r.URL.Query().Get("page"))
	if err != nil || p < 1 {
		p = 1
	}
	var b strings.Builder
	b.WriteString(`<!doctype html><html><head><title>Tagihan</title></head><body>`)
	b.WriteString(`<a href="/logout">Keluar</a><h1>Daftar Tagihan</h1>`)
	b.WriteString(`<table class="invoices"><thead><tr><th>No</th><th>Ref</th><th>Paket</th><th>PPPoE</th><th>Status</th></tr></thead><tbody>`)
	rows := f.rowsForPage(p)
	for i, row := range rows {
		if f.dirty && i == 0 {
			// Judul yang diulang di dalam tbody, <tr> kosong, dan baris pemisah.
			b.WriteString(`<tr><th>No</th><th>Ref</th><th>Paket</th><th>PPPoE</th><th>Status</th></tr><tr></tr>`)
			b.WriteString(`<tr><td colspan="5">&nbsp;</td></tr>`)
		}
		fmt.Fprintf(&b,
			`<tr><td class="no">%d</td><td class="ref">%s</td><td class="plan">Paket 20 Mbps &amp; Bonus<br>Rumah</td><td class="pppoe">%s</td><td class="status"><span class="badge">%s</span></td></tr>`,
			(p-1)*f.pageSize+i+1, row.Ref, row.Name, row.Status)
		if f.dirty {
			b.WriteString("<tr></tr>\n")
		}
	}
	if f.dirty && len(rows) > 0 {
		// Baris tanpa nama di ujung halaman.
		b.WriteString(`<tr><td class="no">0</td><td class="ref">INV-KOSONG</td><td class="plan">-</td><td class="pppoe">  </td><td class="status">Lunas</td></tr>`)
	}
	b.WriteString(`</tbody></table>`)
	if len(rows) == 0 && p == 1 && f.emptyMarker {
		b.WriteString(`<p class="empty-state">Belum ada tagihan.</p>`)
	}
	if len(rows) > 0 && (p < f.pageCount() || f.endless) {
		fmt.Fprintf(&b, `<nav class="pagination"><a rel="next" href="%s/invoices?page=%d">Berikutnya &raquo;</a></nav>`, f.nextHost, p+1)
	} else if len(rows) > 0 && f.cycleNext {
		b.WriteString(`<nav class="pagination"><a rel="next" href="/invoices?page=1">Berikutnya &raquo;</a></nav>`)
	} else {
		b.WriteString(`<nav class="pagination"><span class="next disabled">Berikutnya</span></nav>`)
	}
	b.WriteString(`</body></html>`)
	return b.String()
}

// secrets mengembalikan semua rahasia yang tidak boleh muncul di galat atau log.
func (f *fakeBilling) secrets() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []string{fakePass}
	out = append(out, f.issued...)
	return out
}

func (f *fakeBilling) snapshot() fakeCounts {
	f.mu.Lock()
	defer f.mu.Unlock()
	return fakeCounts{
		loginGets:           f.loginGets,
		loginPosts:          f.loginPosts,
		postsWithCookie:     f.postsWithCookie,
		invoiceHits:         len(f.invoiceHits),
		unauthedInvoiceHits: f.unauthedInvoiceHits,
		authedInvoiceHits:   f.authedInvoiceHits,
		issued:              len(f.issued),
	}
}

type fakeCounts struct {
	loginGets, loginPosts, postsWithCookie, invoiceHits, unauthedInvoiceHits, authedInvoiceHits, issued int
}

// ---- pembantu tes ----

func testCtx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	return ctx
}

// newTestScraper membuat Scraper ke server tiruan. mutate boleh mengubah Config.
func newTestScraper(t *testing.T, f *fakeBilling, mutate func(*Config), opts ...Option) *Scraper {
	t.Helper()
	cfg := Config{
		BaseURL:  f.srv.URL,
		Username: fakeUser,
		Password: fakePass,
		Timeout:  5 * time.Second,
	}
	if mutate != nil {
		mutate(&cfg)
	}
	s, err := New(cfg, opts...)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

// sampleRows adalah 7 tagihan (3 halaman dengan pageSize 3).
func sampleRows() []fakeRow {
	return []fakeRow{
		{Name: "budi01", Ref: "INV-001", Status: "Lunas"},
		{Name: "dewi02", Ref: "INV-002", Status: "Belum Lunas"},
		{Name: "agus03", Ref: "INV-003", Status: "Isolir"},
		{Name: "siti04", Ref: "INV-004", Status: "Menunggak"},
		{Name: "joko05", Ref: "INV-005", Status: "Terisolir"},
		{Name: "budi01", Ref: "INV-006", Status: "Lunas"}, // kembar: tetap dikembalikan
		{Name: "rina07", Ref: "INV-007", Status: "LUNAS"},
	}
}

func sampleWant() []Invoice {
	return []Invoice{
		{Name: "budi01", Ref: "INV-001", Status: StatusLunas},
		{Name: "dewi02", Ref: "INV-002", Status: StatusIsolir},
		{Name: "agus03", Ref: "INV-003", Status: StatusIsolir},
		{Name: "siti04", Ref: "INV-004", Status: StatusIsolir},
		{Name: "joko05", Ref: "INV-005", Status: StatusIsolir},
		{Name: "budi01", Ref: "INV-006", Status: StatusLunas},
		{Name: "rina07", Ref: "INV-007", Status: StatusLunas},
	}
}
