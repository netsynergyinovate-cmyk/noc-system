package ontweb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

const f609Dir = "testdata/f609"

func f609Fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(f609Dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type f609Capture struct {
	Body      string            `json:"body"`
	Rows      [][2]string       `json:"rows"`
	EbooValue string            `json:"ebooValue"`
	Want      map[string]string `json:"want"`
}

func f609CaptureFixture(t *testing.T) f609Capture {
	t.Helper()
	var c f609Capture
	if err := json.Unmarshal(f609Fixture(t, "tr069-capture.json"), &c); err != nil {
		t.Fatal(err)
	}
	return c
}

// Bukti inti 1: CRC cookie EBOOVALUE yang dihitung kode ini SAMA dengan yang dipasang halaman asli.
func TestEbooValueMatchesTheRealPage(t *testing.T) {
	c := f609CaptureFixture(t)
	if got := ebooValue(c.Rows); got != c.EbooValue {
		t.Fatalf("EBOOVALUE = %q, peramban asli %q", got, c.EbooValue)
	}
	// vektor CRC-32 IEEE baku, juga untuk nilai dengan nol di depan (toString(16) tidak memberi padding)
	for in, want := range map[string]string{"": "0", "123456789": "cbf43926", "a": "e8b7be43"} {
		if got := crc32JS(in); got != want {
			t.Errorf("crc32JS(%q) = %q, want %q", in, got, want)
		}
	}
}

// Bukti inti 2: isi formulir yang dibentuk kode ini SAMA byte demi byte dengan yang dikirim halaman asli.
func TestPlanF609TR069MatchesWhatTheRealPageSends(t *testing.T) {
	c := f609CaptureFixture(t)
	fields, err := parseFormFields(f609Fixture(t, "tr069-page.html"))
	if err != nil {
		t.Fatal(err)
	}
	if err := checkF609Fields(fields); err != nil {
		t.Fatal(err)
	}
	rows, _, err := planTR069(fields, Settings{ACSURL: c.Want["url"], ACSUsername: c.Want["user"], ACSPassword: c.Want["pass"], InformInterval: 300})
	if err != nil {
		t.Fatal(err)
	}
	assertRows(t, "F609", rows, c.Rows)
	if got := encodeFormRows(rows); got != c.Body {
		t.Fatalf("badan terkirim berbeda\nkode : %s\nasli : %s", got, c.Body)
	}
}

func TestF609FormParsingIgnoresCommentedInputs(t *testing.T) {
	fields, err := parseFormFields(f609Fixture(t, "tr069-page.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range fields {
		if f.Name == "PasswordAuthFlag" || f.Name == "PasswordAuthFlag_check" {
			t.Fatalf("input di dalam komentar HTML ikut terbaca: %s", f.Name)
		}
	}
}

func TestCheckF609FieldsRefusesOtherLayouts(t *testing.T) {
	page := string(f609Fixture(t, "tr069-page.html"))
	for name, mod := range map[string]string{
		"field baru":   strings.Replace(page, `<input type="hidden" name="SaveFlag"`, `<input type="hidden" name="Baru" value="1"><input type="hidden" name="SaveFlag"`, 1),
		"field hilang": strings.Replace(page, `name="MiddlewarePort"`, `name="Lain"`, 1),
	} {
		fields, err := parseFormFields([]byte(mod))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if err := checkF609Fields(fields); !errors.Is(err, ErrNotSupportedConfig) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestIsF609LoginPage(t *testing.T) {
	if !IsF609LoginPage(f609Fixture(t, "login-page.html")) {
		t.Fatal("halaman login F609 tidak dikenali")
	}
	if IsF609LoginPage(readFixture(t, "index2.html")) {
		t.Fatal("halaman login ZIMLINK terbaca sebagai F609")
	}
	if IsF609LoginPage(ggcFixture(t, "login-full.html")) {
		t.Fatal("halaman login GGCLink terbaca sebagai F609")
	}
}

func TestF609HashIsMD5OfPasswordPlusRand(t *testing.T) {
	// nilai nyata dari peramban asli: rand 20563ad0, sandi admin
	if got := f609Hash("admin", "20563ad0"); got != "75f4780024c1785e36aae8f439e08c44" {
		t.Fatalf("hash = %s", got)
	}
}

func TestF609ACSStatusFromThePage(t *testing.T) {
	code, text, ok := parseACSStatus(f609Fixture(t, "sta-acs.html"))
	// halaman asli F609 yang ACS-nya sudah diisi tetapi belum punya WAN TR-069
	if !ok || code != "1" || !strings.Contains(text, "No remote management WAN connection") {
		t.Fatalf("code=%q text=%q ok=%v", code, text, ok)
	}
}

// ---------------------------------------------------------------------------
// Modem tiruan: menegakkan aturan yang diamati di F609 asli.
// ---------------------------------------------------------------------------

type fakeF609 struct {
	t  *testing.T
	mu sync.Mutex

	user, pass string
	rand       string
	locked     bool
	busy       bool
	loggedIn   bool
	token      string

	url, acsUser, acsPass, interval, enable string
	acsCode                                 string

	posts, logins, logouts int
	dropAfter, ignore      bool
	badCookie              int
}

func newFakeF609(t *testing.T) *fakeF609 {
	return &fakeF609{t: t, user: "admin", pass: "admin", rand: "20563ad0", token: "ecnt0123456789abcdef0123456789ab", acsUser: "cpe", acsPass: "cpe", interval: "43200", enable: "Yes", acsCode: "4"}
}

func (m *fakeF609) tr069Page() []byte {
	page := string(f609Fixture(m.t, "tr069-page.html"))
	set := func(name, value string) {
		re := regexp.MustCompile(`(?is)(name="?` + name + `"?\s+value=")[^"]*(")`)
		page = re.ReplaceAllString(page, "${1}"+value+"${2}")
	}
	set("URL", m.url)
	set("Username", m.acsUser)
	set("Password", m.acsPass)
	set("PeriodicInformInterval", m.interval)
	return []byte(page)
}

func (m *fakeF609) hasCookie(r *http.Request, name, want string) bool {
	c, err := r.Cookie(name)
	return err == nil && c.Value == want
}

func (m *fakeF609) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w.Header().Set("Server", "Boa/0.94.13")
	switch {
	case r.URL.Path == "/cgi-bin/index2.asp":
		page := string(f609Fixture(m.t, "login-page.html"))
		page = regexp.MustCompile(`var rand = "[^"]*"`).ReplaceAllString(page, `var rand = "`+m.rand+`"`)
		_, _ = w.Write([]byte(page))
	case r.URL.Path == "/cgi-bin/check_auth.json" && r.Method == http.MethodPost:
		_ = r.ParseForm()
		m.logins++
		f := r.PostForm
		if f.Get("logintype") != "usr" || f.Get("Logoff") != "0" || f.Get("value_one") != "1" || f.Get("hLoginTimes") != "0" {
			m.t.Errorf("login tidak seperti halaman asli: %v", f)
		}
		ck := r.Header.Get("Cookie")
		if !strings.Contains(ck, "loginTimes=0") || !strings.Contains(ck, "LoginFailTime=0") {
			// F609 asli: tanpa cookie ini kata sandi yang benar pun dijawab Privilege 0
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"Locked":"0","Logged":"0","Privilege":"0"}`))
			return
		}
		if f.Get("Password1") != "" || f.Get("Password2") != "" {
			m.t.Errorf("Password1/2 harus kosong seperti halaman asli: %v", f)
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case m.locked:
			_, _ = w.Write([]byte(`{"Locked":"1","Logged":"0","Privilege":"0"}`))
		case m.busy:
			_, _ = w.Write([]byte(`{"Locked":"0","Logged":"2","Privilege":"0"}`))
		case f.Get("Username") != m.user || f.Get("Password") != f609Hash(m.pass, m.rand):
			_, _ = w.Write([]byte(`{"Locked":"0","Logged":"0","Privilege":"0"}`))
		default:
			m.loggedIn = true
			http.SetCookie(w, &http.Cookie{Name: "LOGFLAG", Value: "logged", Path: "/"})
			_, _ = fmt.Fprintf(w, `{"Locked":"0","Logged":"0","Privilege":"1","ecntToken":%q}`, m.token)
		}
	case !m.hasCookie(r, "ecntToken", m.token) || !m.loggedIn:
		w.WriteHeader(http.StatusUnauthorized)
	case r.URL.Path == "/cgi-bin/content.asp":
		_, _ = w.Write([]byte("<frameset></frameset>"))
	case r.URL.Path == "/cgi-bin/logout.cgi":
		m.logouts++
		m.loggedIn = false
		_, _ = w.Write([]byte("bye"))
	case r.URL.Path == "/cgi-bin/net-tr069.asp" && r.Method == http.MethodGet:
		_, _ = w.Write(m.tr069Page())
	case r.URL.Path == "/cgi-bin/net-tr069.asp" && r.Method == http.MethodPost:
		body, _ := readAll(r)
		var rows [][2]string
		for _, kv := range strings.Split(body, "&") {
			p := strings.SplitN(kv, "=", 2)
			k, _ := url.QueryUnescape(p[0])
			v, _ := url.QueryUnescape(p[1])
			rows = append(rows, [2]string{k, v})
		}
		m.posts++
		// halaman asli: urutan field DOM, dan EBOOVALUE = crc32 nama+nilai
		got := make([]string, len(rows))
		for i, r := range rows {
			got[i] = r[0]
		}
		if strings.Join(got, ",") != strings.Join(f609TR069Fields, ",") {
			m.t.Errorf("urutan field POST: %v", got)
		}
		if !m.hasCookie(r, "EBOOVALUE", ebooValue(rows)) {
			m.badCookie++
			_, _ = w.Write([]byte("<html>ditolak: EBOOVALUE salah</html>"))
			return
		}
		if !m.ignore {
			for _, kv := range rows {
				switch kv[0] {
				case "URL":
					m.url = kv[1]
				case "Username":
					m.acsUser = kv[1]
				case "Password":
					m.acsPass = kv[1]
				case "PeriodicInformInterval":
					m.interval = kv[1]
				case "PeriodicInformEnable":
					m.enable = kv[1]
				}
			}
		}
		if m.dropAfter {
			if hj, ok := w.(http.Hijacker); ok {
				if conn, _, err := hj.Hijack(); err == nil {
					_ = conn.Close()
					return
				}
			}
		}
		_, _ = w.Write([]byte("<html>ok</html>"))
	case r.URL.Path == "/cgi-bin/sta-acs.asp":
		page := string(f609Fixture(m.t, "sta-acs.html"))
		i := strings.Index(page, "Inform Status")
		re := regexp.MustCompile(`var result = "\d"`)
		loc := re.FindStringIndex(page[i:])
		page = page[:i+loc[0]] + `var result = "` + m.acsCode + `"` + page[i+loc[1]:]
		_, _ = w.Write([]byte(page))
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func f609Client(m *fakeF609) (*F609Client, func()) {
	srv := httptest.NewServer(m)
	return NewF609Client(srv.URL, 5*time.Second), srv.Close
}

var f609Want = Settings{ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300}

func TestF609ApplyWritesTheRealFormAndVerifiesByReading(t *testing.T) {
	m := newFakeF609(t)
	c, done := f609Client(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", f609Want)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Changed || res.ACSURL != f609Want.ACSURL || m.posts != 1 || m.badCookie != 0 || m.logouts != 1 {
		t.Fatalf("res=%+v posts=%d badCookie=%d logouts=%d", res, m.posts, m.badCookie, m.logouts)
	}
	if m.url != f609Want.ACSURL || m.interval != "300" || m.acsUser != "admin" || m.acsPass != "admin" {
		t.Fatalf("modem: url=%q interval=%q user=%q", m.url, m.interval, m.acsUser)
	}
	for _, f := range res.Fields {
		if strings.Contains(strings.ToLower(f), "admin") {
			t.Fatalf("nilai bocor ke hasil: %q", f)
		}
	}
	if !strings.Contains(res.ACSStatus, "No ACS configuration") || res.Informing {
		t.Fatalf("status = %q informing=%v", res.ACSStatus, res.Informing)
	}
}

func TestF609ApplyIsIdempotent(t *testing.T) {
	m := newFakeF609(t)
	c, done := f609Client(m)
	defer done()
	if _, err := c.ApplyTR069(context.Background(), "admin", "admin", f609Want); err != nil {
		t.Fatal(err)
	}
	res, err := NewF609Client(c.BaseURL, 5*time.Second).ApplyTR069(context.Background(), "admin", "admin", f609Want)
	if err != nil {
		t.Fatal(err)
	}
	if res.Changed || m.posts != 1 || m.logouts != 2 {
		t.Fatalf("kali kedua: changed=%v posts=%d logouts=%d", res.Changed, m.posts, m.logouts)
	}
}

func TestF609LoginFailures(t *testing.T) {
	for _, c := range []struct {
		name string
		mod  func(*fakeF609)
		pass string
		want error
	}{
		{"sandi salah", func(*fakeF609) {}, "salah", ErrBadCredentials},
		{"terkunci", func(m *fakeF609) { m.locked = true }, "admin", ErrLocked},
		{"sesi lain", func(m *fakeF609) { m.busy = true }, "admin", ErrSessionBusy},
	} {
		m := newFakeF609(t)
		c.mod(m)
		cl, done := f609Client(m)
		_, err := cl.ApplyTR069(context.Background(), "admin", c.pass, f609Want)
		done()
		if !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v", c.name, err)
		}
		if m.posts != 0 || m.logins != 1 {
			t.Errorf("%s: posts=%d logins=%d (tidak boleh mengulang login)", c.name, m.posts, m.logins)
		}
	}
}

func TestF609NeverSendsCredentialsToWrongDevice(t *testing.T) {
	var sawPost bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			sawPost = true
		}
		_, _ = w.Write([]byte("<html><title>Router lain</title></html>"))
	}))
	defer srv.Close()
	_, err := NewF609Client(srv.URL, 2*time.Second).ApplyTR069(context.Background(), "admin", "admin", f609Want)
	if !errors.Is(err, ErrWrongDevice) || sawPost {
		t.Fatalf("err=%v post=%v", err, sawPost)
	}
}

func TestF609DropAfterWriteIsVerifiedByReading(t *testing.T) {
	m := newFakeF609(t)
	m.dropAfter = true
	c, done := f609Client(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", f609Want)
	if err != nil || !res.Changed {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestF609NotAppliedIsReported(t *testing.T) {
	m := newFakeF609(t)
	m.ignore = true
	c, done := f609Client(m)
	defer done()
	if _, err := c.ApplyTR069(context.Background(), "admin", "admin", f609Want); !errors.Is(err, ErrNotApplied) {
		t.Fatalf("err = %v", err)
	}
	if m.logouts != 1 {
		t.Fatalf("logout = %d", m.logouts)
	}
}

func TestF609RefusesUnverifiedFormWithoutWriting(t *testing.T) {
	m := newFakeF609(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cgi-bin/net-tr069.asp" && r.Method == http.MethodGet && m.loggedIn {
			page := strings.Replace(string(m.tr069Page()), `<input type="hidden" name="SaveFlag"`, `<input type="hidden" name="Baru" value="1"><input type="hidden" name="SaveFlag"`, 1)
			_, _ = w.Write([]byte(page))
			return
		}
		m.ServeHTTP(w, r)
	}))
	defer srv.Close()
	_, err := NewF609Client(srv.URL, 5*time.Second).ApplyTR069(context.Background(), "admin", "admin", f609Want)
	if !errors.Is(err, ErrNotSupportedConfig) || m.posts != 0 || m.logouts != 1 {
		t.Fatalf("err=%v posts=%d logouts=%d", err, m.posts, m.logouts)
	}
}

func TestDetectFindsF609AndNotTheOthers(t *testing.T) {
	m := newFakeF609(t)
	srv := httptest.NewServer(m)
	defer srv.Close()
	d, kind, err := Detect(context.Background(), srv.URL, 3*time.Second)
	if err != nil || kind != KindF609 {
		t.Fatalf("kind=%q err=%v", kind, err)
	}
	if _, ok := d.(*F609Client); !ok {
		t.Fatalf("driver = %T", d)
	}
	if m.logins != 0 {
		t.Fatal("Detect tidak boleh login")
	}
	if KindLabel(KindF609) != "ZTE F609 (MTKc)" {
		t.Fatal(KindLabel(KindF609))
	}
	// modem lain tetap dikenali sebagai dirinya sendiri
	gg := httptest.NewServer(newFakeGGC(t))
	defer gg.Close()
	if _, k, err := Detect(context.Background(), gg.URL, 3*time.Second); err != nil || k != KindGGCLink {
		t.Fatalf("GGCLink: kind=%q err=%v", k, err)
	}
}
