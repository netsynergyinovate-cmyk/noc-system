package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/PuerkitoBio/goquery"
)

const userAgent = "noc-isp-billing/1.0"

// Option mengubah Scraper saat dibuat.
type Option func(*Scraper)

// WithTransport mengganti http.RoundTripper bawaan (salinan http.DefaultTransport
// dengan verifikasi TLS penuh). Dipakai tes untuk mempercayai sertifikat server
// tiruan (httptest.Server.Client().Transport). Cookiejar, batas waktu, dan
// aturan pengalihan tetap milik Scraper, jadi tidak bisa dilewati lewat sini.
// Jangan memberi transport yang mematikan verifikasi TLS.
func WithTransport(rt http.RoundTripper) Option {
	return func(s *Scraper) { s.transport = rt }
}

// WithLogger mengaktifkan log langkah (login, halaman dibaca, sesi berakhir).
// Log hanya memuat path, nomor halaman, dan hitungan; tidak pernah kata sandi,
// token CSRF, atau cookie. Tanpa opsi ini Scraper tidak mencatat apa pun.
func WithLogger(l *slog.Logger) Option {
	return func(s *Scraper) {
		if l != nil {
			s.logger = l
		}
	}
}

// WithSessionCallback mendaftarkan fungsi yang dipanggil setiap login berhasil
// dengan cookie sesi baru dan token CSRF dari form login. Dipakai pemanggil untuk
// menyimpan sesi (lihat ExportCookiesJSON). Dipanggil dengan mutex Scraper
// dipegang, jadi fn TIDAK boleh memanggil metode Scraper. Galat dari fn hanya
// dicatat di log, tidak menggagalkan login. Cookie rahasia: jangan dicatat.
func WithSessionCallback(fn func(cookies []*http.Cookie, csrf string) error) Option {
	return func(s *Scraper) { s.onSessionUpdate = fn }
}

// credentials memegang rahasia di balik pointer, supaya mencetak Scraper (atau
// salinannya) lewat fmt hanya menampilkan alamat, bukan isinya.
type credentials struct {
	username string
	password string
}

func (credentials) String() string   { return "billing.credentials{[disembunyikan]}" }
func (credentials) GoString() string { return "billing.credentials{[disembunyikan]}" }

// Scraper masuk ke satu sistem billing dan membaca tabel tagihannya. Satu
// Scraper memegang satu cookiejar (sesi). Metodenya diserialisasi dengan mutex,
// jadi aman dipanggil dari beberapa goroutine tetapi berjalan bergantian.
type Scraper struct {
	cfg    Config // tanpa Password dan tanpa Profile
	creds  *credentials
	prof   compiledProfile
	base   *url.URL
	prefix string
	origin string

	loginURL, loginPostURL *url.URL
	landingPath            string

	transport http.RoundTripper
	client    *http.Client
	logger    *slog.Logger

	onSessionUpdate func(cookies []*http.Cookie, csrf string) error

	mu       sync.Mutex
	loggedIn bool
	lastCSRF string
}

// New memeriksa cfg (lihat Config.Validate) dan menyiapkan Scraper. Tidak ada
// permintaan jaringan di sini. Galatnya membungkus ErrInvalidConfig, atau
// ErrNotConfigured bila cfg kosong sama sekali.
func New(cfg Config, opts ...Option) (*Scraper, error) {
	p, err := cfg.prepare()
	if err != nil {
		return nil, err
	}
	s := &Scraper{
		cfg:    p.cfg,
		creds:  &credentials{username: p.cfg.Username, password: p.cfg.Password},
		prof:   p.prof,
		base:   p.base,
		prefix: p.prefix,
		origin: originOf(p.base),
		logger: slog.New(slog.DiscardHandler),
	}
	s.cfg.Password = ""
	s.cfg.Profile = Profile{}
	for _, opt := range opts {
		opt(s)
	}
	if s.transport == nil {
		if dt, ok := http.DefaultTransport.(*http.Transport); ok {
			s.transport = dt.Clone()
		} else {
			s.transport = &http.Transport{Proxy: http.ProxyFromEnvironment}
		}
	}

	if s.loginURL, err = s.resolve(s.prof.LoginPath); err != nil {
		return nil, err
	}
	postPath := s.prof.LoginPostPath
	if postPath == "" {
		postPath = s.prof.LoginPath
	}
	if s.loginPostURL, err = s.resolve(postPath); err != nil {
		return nil, err
	}
	if s.prof.LoginSuccess.LandingPath != "" {
		landing, err := s.resolve(s.prof.LoginSuccess.LandingPath)
		if err != nil {
			return nil, err
		}
		s.landingPath = landing.Path
	}
	if _, err := s.invoicesURL(1); err != nil {
		return nil, err
	}

	s.client = &http.Client{
		Transport:     s.transport,
		Timeout:       s.cfg.Timeout,
		CheckRedirect: s.checkRedirect,
	}
	s.client.Jar = newJar()
	return s, nil
}

// newJar membuat cookiejar kosong. Dipanggil di tiap login supaya sesi lama
// (mungkin setengah mati) tidak terbawa ke sesi baru.
func newJar() http.CookieJar {
	jar, _ := cookiejar.New(nil) // dengan opsi nil, New tidak pernah gagal
	return jar
}

// Close menutup koneksi menganggur. Scraper masih bisa dipakai sesudahnya.
func (s *Scraper) Close() { s.client.CloseIdleConnections() }

// String mencetak Scraper tanpa kredensial.
func (s *Scraper) String() string {
	return fmt.Sprintf("billing.Scraper{BaseURL: %s, Username: %s}", safeBaseURL(s.cfg.BaseURL), s.creds.username)
}

// GoString lihat String.
func (s *Scraper) GoString() string { return s.String() }

// Login mengambil halaman login, membaca token CSRF, mengirim kredensial, dan
// memastikan login berhasil menurut Profile.LoginSuccess. Memanggilnya memulai
// sesi baru (cookiejar baru). Kredensial yang ditolak mengembalikan
// ErrLoginFailed dan tidak diulang. Invoices memanggil ini sendiri bila perlu;
// memanggilnya langsung berguna untuk menguji kredensial.
func (s *Scraper) Login(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.login(ctx)
}

// Cookies mengembalikan cookie sesi yang sedang dipegang jar untuk BaseURL.
func (s *Scraper) Cookies() []*http.Cookie {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cookies()
}

// CSRFToken mengembalikan token CSRF aktif yang terakhir diekstrak dari halaman
// atau respons server. Kosong bila situs tidak memakai CSRF.
func (s *Scraper) CSRFToken() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastCSRF
}

// updateCSRF membaca token CSRF dari dokumen HTML (lewat selektor profil atau meta tag umum).
// Dipanggil saat memegang s.mu atau dari fetch.
func (s *Scraper) updateCSRF(doc *goquery.Document) {
	if doc == nil {
		return
	}
	// 1. Coba lewat selektor yang ditentukan di profil (misal input[name="_token"]).
	if tok, err := s.prof.csrfToken(doc); err == nil && tok != "" {
		s.lastCSRF = tok
		return
	}
	// 2. Coba lewat meta tag HTML umum (meta[name="csrf-token"], meta[name="_token"]).
	for _, sel := range []string{`meta[name="csrf-token"]`, `meta[name="_token"]`, `meta[name="csrf_token"]`} {
		meta := doc.Find(sel)
		if meta.Length() > 0 {
			if content, ok := meta.Attr("content"); ok {
				if content = trimMarkup(content); content != "" {
					s.lastCSRF = content
					return
				}
			}
		}
	}
}

// cookies adalah Cookies tanpa kunci; pemanggil memegang s.mu.
func (s *Scraper) cookies() []*http.Cookie {
	if s.client.Jar == nil {
		return nil
	}
	return s.client.Jar.Cookies(s.base)
}

// SetCookies mengganti sesi dengan cookie yang diberikan (cookiejar baru) dan
// menganggap Scraper sudah login. Bila cookie ternyata basi, Invoices
// mendeteksinya dan login ulang otomatis.
func (s *Scraper) SetCookies(cookies []*http.Cookie) {
	s.mu.Lock()
	defer s.mu.Unlock()
	jar := newJar()
	jar.SetCookies(s.base, cookies)
	s.client.Jar = jar
	s.loggedIn = true
}

// ExportCookiesJSON menyerialkan cookie sesi menjadi JSON {"nama":"nilai"},
// format yang sama dengan serializeCookies di sisi TypeScript. Isinya rahasia.
func (s *Scraper) ExportCookiesJSON() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := make(map[string]string)
	for _, c := range s.cookies() {
		m[c.Name] = c.Value
	}
	b, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ImportCookiesJSON memuat cookie dari JSON {"nama":"nilai"} (lihat
// ExportCookiesJSON). Galat tidak memuat isi JSON.
func (s *Scraper) ImportCookiesJSON(jsonStr string) error {
	var m map[string]string
	if err := json.Unmarshal([]byte(jsonStr), &m); err != nil || m == nil {
		return errors.New("billing: format cookie sesi tidak valid")
	}
	// cookiejar membuang cookie ber-Domain untuk host alamat IP (RFC 6265), jadi
	// Domain hanya diisi untuk nama host.
	domain := s.base.Hostname()
	if net.ParseIP(domain) != nil {
		domain = ""
	}
	cookies := make([]*http.Cookie, 0, len(m))
	for name, value := range m {
		cookies = append(cookies, &http.Cookie{Name: name, Value: value, Domain: domain, Path: "/"})
	}
	s.SetCookies(cookies)
	return nil
}

func (s *Scraper) login(ctx context.Context) error {
	s.loggedIn = false
	s.client.Jar = newJar()

	formPage, err := s.fetch(ctx, http.MethodGet, s.loginURL, nil, "")
	if err != nil {
		return err
	}
	if !success(formPage.status) {
		return &StatusError{Method: http.MethodGet, Path: s.loginURL.Path, Code: formPage.status}
	}
	token, err := s.prof.csrfToken(formPage.doc)
	if err != nil {
		return err
	}
	s.lastCSRF = token

	form := url.Values{}
	for k, v := range s.prof.LoginExtraFields {
		form.Set(k, v)
	}
	form.Set(s.prof.UsernameField, s.creds.username)
	form.Set(s.prof.PasswordField, s.creds.password)
	form.Set(s.prof.CSRFField, token)

	result, err := s.fetch(ctx, http.MethodPost, s.loginPostURL, form, s.loginURL.String())
	if err != nil {
		return err
	}
	if err := s.checkLogin(result); err != nil {
		return err
	}
	s.loggedIn = true
	s.logger.Info("login billing berhasil", "path", s.loginPostURL.Path, "status", result.status)
	if s.onSessionUpdate != nil {
		if err := s.onSessionUpdate(s.cookies(), s.lastCSRF); err != nil {
			s.logger.Warn("callback sesi billing gagal", "error", err.Error())
		}
	}
	return nil
}

// checkLogin menilai halaman akhir setelah POST login.
func (s *Scraper) checkLogin(pg *page) error {
	rejected := func(why string) error {
		return fmt.Errorf("%w: %s; periksa %s dan %s", ErrLoginFailed, why, EnvUsername, EnvPassword)
	}
	switch pg.status {
	case http.StatusUnauthorized, http.StatusForbidden, 419, http.StatusUnprocessableEntity:
		// 419 adalah "Page Expired" Laravel: token CSRF atau sesi ditolak.
		return rejected(fmt.Sprintf("HTTP %d", pg.status))
	}
	if !success(pg.status) {
		return &StatusError{Method: http.MethodPost, Path: s.loginPostURL.Path, Code: pg.status}
	}
	if samePath(pg.url.Path, s.loginURL.Path) || samePath(pg.url.Path, s.loginPostURL.Path) {
		return rejected("halaman setelah login masih halaman login")
	}
	if s.prof.failure != nil && pg.doc.FindMatcher(s.prof.failure).Length() > 0 {
		return rejected("halaman memuat penanda gagal login")
	}
	explicit := false
	if s.landingPath != "" {
		explicit = true
		if !samePath(pg.url.Path, s.landingPath) {
			return rejected("halaman setelah login bukan LandingPath")
		}
	}
	if s.prof.success != nil {
		explicit = true
		if pg.doc.FindMatcher(s.prof.success).Length() == 0 {
			return rejected("penanda berhasil login tidak ada")
		}
	}
	if !explicit && pg.doc.FindMatcher(s.prof.passwordInput).Length() > 0 {
		return rejected("halaman setelah login masih memuat kotak kata sandi")
	}
	return nil
}

// Invoices membaca semua halaman tagihan dan mengembalikannya sesuai urutan di
// situs, termasuk tagihan kembar (pencocokan yang memutuskan). Bila belum login,
// login dilakukan lebih dulu. Bila sesi berakhir di tengah jalan, login ulang
// dilakukan SATU kali per pemanggilan lalu pembacaan dilanjutkan dari halaman
// yang tertunda; bila sesi berakhir lagi, hasilnya ErrSessionLost.
//
// Hasilnya semua-atau-tidak-sama-sekali: bila ada galat, daftar tagihan nil
// (tidak pernah sebagian, supaya tidak ada yang menulis data yang terpotong).
// Stats dikembalikan juga saat galat, untuk log.
//
// Pembacaan yang gagal membuang sesinya: pemanggilan berikutnya (ulangan dalam
// sinkron yang sama atau sinkron jam berikutnya) login dari awal dengan cookiejar
// baru, tidak memakai sesi yang mungkin setengah rusak. Pembacaan yang berhasil
// meninggalkan sesinya untuk dipakai ulang.
func (s *Scraper) Invoices(ctx context.Context) ([]Invoice, Stats, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	out, st, err := s.readInvoices(ctx)
	if err != nil {
		s.loggedIn = false
	}
	return out, st, err
}

// readInvoices adalah isi Invoices; pemanggil memegang s.mu.
func (s *Scraper) readInvoices(ctx context.Context) ([]Invoice, Stats, error) {
	var st Stats
	if !s.loggedIn {
		if err := s.login(ctx); err != nil {
			return nil, st, err
		}
	}

	target, err := s.invoicesURL(1)
	if err != nil {
		return nil, st, err
	}
	out := make([]Invoice, 0, 64)
	visited := make(map[string]struct{})
	relogged := false

	for pageNo := 1; ; pageNo++ {
		if st.Pages >= s.cfg.MaxPages {
			return nil, st, fmt.Errorf("%w: lebih dari %d halaman tagihan", ErrTooLarge, s.cfg.MaxPages)
		}
		key := target.String()
		if _, seen := visited[key]; seen {
			return nil, st, fmt.Errorf("%w: halaman %s dibaca dua kali (tautan berputar)", ErrUnexpectedPage, target.Path)
		}
		visited[key] = struct{}{}

		pg, err := s.fetchAuthed(ctx, target, &st, &relogged)
		if err != nil {
			return nil, st, err
		}
		st.Pages++

		res, err := s.prof.parseInvoices(pg.doc, pageNo, pageNo == 1, s.cfg.MaxRows-st.Rows)
		if err != nil {
			return nil, st, err
		}
		st.Rows += res.dataRows
		st.Skipped += res.skipped
		out = append(out, res.invoices...)
		s.logger.Debug("halaman tagihan dibaca", "page", pageNo, "path", target.Path, "rows", res.dataRows, "skipped", res.skipped)

		if res.empty {
			break
		}
		if s.prof.next != nil {
			next, err := s.nextURL(pg)
			if err != nil {
				return nil, st, err
			}
			if next == nil {
				break
			}
			target = next
			continue
		}
		if !s.prof.paged {
			break
		}
		if target, err = s.invoicesURL(pageNo + 1); err != nil {
			return nil, st, err
		}
	}

	s.logger.Info("tagihan billing dibaca",
		"pages", st.Pages, "rows", st.Rows, "skipped", st.Skipped, "relogins", st.Relogins, "invoices", len(out))
	return out, st, nil
}

// fetchAuthed mengambil halaman yang butuh sesi. Bila yang kembali adalah halaman
// login, sesi dianggap berakhir: login ulang sekali (relogged dibagi satu
// pemanggilan Invoices) lalu minta halaman yang sama lagi.
func (s *Scraper) fetchAuthed(ctx context.Context, target *url.URL, st *Stats, relogged *bool) (*page, error) {
	for {
		pg, err := s.fetch(ctx, http.MethodGet, target, nil, "")
		if err != nil {
			return nil, err
		}
		if s.loggedOut(pg) {
			s.loggedIn = false
			if *relogged {
				return nil, fmt.Errorf("%w: sesi hilang lagi setelah login ulang (%s)", ErrSessionLost, target.Path)
			}
			*relogged = true
			st.Relogins++
			s.logger.Warn("sesi billing berakhir, login ulang", "path", target.Path, "status", pg.status)
			s.client.Jar = newJar()
			if err := s.login(ctx); err != nil {
				return nil, err
			}
			continue // ulangi fetch halaman yang sama dengan sesi baru
		}
		if !success(pg.status) {
			return nil, &StatusError{Method: http.MethodGet, Path: target.Path, Code: pg.status}
		}
		return pg, nil
	}
}

// loggedOut mengenali sesi yang berakhir: dialihkan ke halaman login, status
// 401, atau halaman dengan kotak kata sandi dan tanpa satu pun baris tagihan
// (situs yang menampilkan form login di tempat).
func (s *Scraper) loggedOut(pg *page) bool {
	if pg.status == http.StatusUnauthorized || samePath(pg.url.Path, s.loginURL.Path) {
		return true
	}
	return pg.doc != nil &&
		pg.doc.FindMatcher(s.prof.passwordInput).Length() > 0 &&
		pg.doc.FindMatcher(s.prof.row).Length() == 0
}

// invoicesURL membentuk URL halaman tagihan ke-n.
func (s *Scraper) invoicesURL(n int) (*url.URL, error) {
	raw := s.prof.InvoicesPath
	if s.prof.paged {
		raw = strings.Replace(raw, pageToken, strconv.Itoa(n), 1)
	}
	return s.resolve(raw)
}

// nextURL membaca tautan "berikutnya"; nil berarti halaman terakhir. Tautan ke
// asal lain ditolak seperti pengalihan.
func (s *Scraper) nextURL(pg *page) (*url.URL, error) {
	link := pg.doc.FindMatcher(s.prof.next)
	if link.Length() == 0 {
		return nil, nil
	}
	href, _ := link.Attr("href")
	href = trimMarkup(href)
	if href == "" || href == "#" || strings.HasPrefix(strings.ToLower(href), "javascript:") {
		return nil, nil
	}
	ref, err := url.Parse(href)
	if err != nil {
		return nil, fmt.Errorf("%w: tautan halaman berikutnya tidak dapat dibaca (%s)", ErrUnexpectedPage, pg.url.Path)
	}
	next := pg.url.ResolveReference(ref)
	next.Fragment = ""
	if (next.Scheme != "http" && next.Scheme != "https") || originOf(next) != s.origin {
		return nil, fmt.Errorf("%w: tautan halaman berikutnya (%s) menuju asal lain", ErrCrossHostRedirect, pg.url.Path)
	}
	return next, nil
}

// page adalah satu jawaban setelah semua pengalihan.
type page struct {
	status int
	url    *url.URL
	// doc ada hanya untuk status 2xx.
	doc *goquery.Document
}

func success(status int) bool { return status >= 200 && status <= 299 }

// fetch mengirim satu permintaan (dengan form untuk POST) dan mengembalikan
// jawaban akhirnya. Status di luar 2xx BUKAN galat di sini; pemanggil menilainya.
// Galat hanya untuk jaringan, batas ukuran, dan aturan pengalihan.
func (s *Scraper) fetch(ctx context.Context, method string, target *url.URL, form url.Values, referer string) (*page, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("billing: dibatalkan sebelum %s %s: %w", method, target.Path, err)
	}
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		// Galat dari NewRequest memuat URL, jadi penyebabnya diganti kalimat tetap.
		return nil, &networkError{method: method, path: target.Path, cause: errors.New("permintaan tidak dapat dibuat")}
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if referer != "" {
		req.Header.Set("Referer", referer)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, s.requestError(ctx, method, target, err)
	}
	defer resp.Body.Close()

	pg := &page{status: resp.StatusCode, url: resp.Request.URL}
	// Token dari header dibaca di tiap jawaban (juga non-2xx, mis. 419 yang
	// membawa token baru). Header menang atas HTML karena paling segar.
	headerToken := s.headerCSRF(resp.Header)
	if headerToken != "" {
		s.lastCSRF = headerToken
	}
	if !success(resp.StatusCode) {
		// Isi jawaban galat tidak dibaca ke mana pun; cukup dikuras sedikit supaya
		// koneksi bisa dipakai ulang.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return pg, nil
	}

	limit := s.cfg.MaxBodyBytes
	if resp.ContentLength > limit {
		return nil, tooLarge(method, target, limit)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, s.requestError(ctx, method, target, err)
	}
	if int64(len(data)) > limit {
		return nil, tooLarge(method, target, limit)
	}
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: HTML tidak dapat dibaca (%s %s)", ErrUnexpectedPage, method, target.Path)
	}
	pg.doc = doc

	// Tanpa token di header, ambil dari dokumen HTML (selektor profil atau meta).
	if headerToken == "" {
		s.updateCSRF(doc)
	}

	return pg, nil
}

// headerCSRF membaca token dari header X-CSRF-TOKEN, lalu X-XSRF-TOKEN.
// Pemanggil memegang s.mu. Nilainya tidak pernah dicatat di log.
func (s *Scraper) headerCSRF(h http.Header) string {
	for _, name := range []string{"X-CSRF-TOKEN", "X-XSRF-TOKEN"} {
		if tok := trimMarkup(h.Get(name)); tok != "" {
			return tok
		}
	}
	return ""
}

func tooLarge(method string, target *url.URL, limit int64) error {
	return fmt.Errorf("%w: tubuh jawaban %s %s lebih dari %d byte", ErrTooLarge, method, target.Path, limit)
}

// requestError mengubah galat transport menjadi galat paket ini tanpa URL
// (url.Error memuat URL lengkap beserta query) dan tanpa alamat jaringan.
func (s *Scraper) requestError(ctx context.Context, method string, target *url.URL, err error) error {
	if cerr := ctx.Err(); cerr != nil {
		return fmt.Errorf("billing: dibatalkan saat %s %s: %w", method, target.Path, cerr)
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		err = urlErr.Err
	}
	if errors.Is(err, ErrTooManyRedirects) || errors.Is(err, ErrCrossHostRedirect) {
		return fmt.Errorf("%s %s: %w", method, target.Path, err)
	}
	return &networkError{method: method, path: target.Path, cause: err}
}

// checkRedirect membatasi pengalihan: tidak boleh keluar dari asal BaseURL
// (host, port, atau skema berbeda, termasuk turun dari https ke http) dan tidak
// boleh melewati MaxRedirects. Dipanggil SEBELUM permintaan berikutnya dikirim,
// jadi host lain tidak pernah menerima cookie atau kredensial.
func (s *Scraper) checkRedirect(req *http.Request, via []*http.Request) error {
	if originOf(req.URL) != s.origin {
		return fmt.Errorf("%w: skema, host, atau port berbeda dari BaseURL", ErrCrossHostRedirect)
	}
	if len(via) > s.cfg.MaxRedirects {
		return fmt.Errorf("%w: lebih dari %d pengalihan", ErrTooManyRedirects, s.cfg.MaxRedirects)
	}
	return nil
}

// resolve menggabungkan path profil dengan BaseURL (termasuk awalan path-nya).
func (s *Scraper) resolve(p string) (*url.URL, error) {
	u, err := url.Parse(s.base.Scheme + "://" + s.base.Host + s.prefix + p)
	if err != nil {
		return nil, fmt.Errorf("%w: path %q tidak dapat digabung dengan BaseURL", ErrInvalidConfig, p)
	}
	return u, nil
}

// originOf mengembalikan "skema://host:port" dengan port bawaan diisi, supaya
// "https://a" dan "https://a:443" dianggap sama.
func originOf(u *url.URL) string {
	scheme := strings.ToLower(u.Scheme)
	port := u.Port()
	if port == "" {
		switch scheme {
		case "http":
			port = "80"
		case "https":
			port = "443"
		}
	}
	return scheme + "://" + net.JoinHostPort(strings.ToLower(u.Hostname()), port)
}

// samePath membandingkan dua path tanpa memedulikan garis miring di ujung.
func samePath(a, b string) bool {
	trim := func(s string) string {
		if t := strings.TrimRight(s, "/"); t != "" {
			return t
		}
		return "/"
	}
	return trim(a) == trim(b)
}
