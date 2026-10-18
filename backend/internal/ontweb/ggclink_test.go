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

const ggcDir = "testdata/gm22"

func ggcFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(ggcDir, name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type ggcCapture struct {
	Want map[string]string `json:"want"`
	Body string            `json:"body"`
	Rows [][2]string       `json:"rows"`
}

func ggcCaptureFixture(t *testing.T, name string) ggcCapture {
	t.Helper()
	var c ggcCapture
	if err := json.Unmarshal(ggcFixture(t, name), &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func ggcPage(t *testing.T) *ggcTR069Page {
	t.Helper()
	p, err := parseGGCTR069(ggcFixture(t, "tr069-page.html"))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// Bukti inti: isi formulir yang dibentuk kode ini SAMA byte demi byte dengan yang dikirim halaman
// web asli di peramban asli (tangkapan dengan permintaan dibatalkan), untuk dua keadaan: semua kolom
// diketik ulang, dan hanya URL + interval yang diubah (kolom lain tidak disentuh).
func TestPlanGGCTR069MatchesWhatTheRealPageSends(t *testing.T) {
	p := ggcPage(t)

	full := ggcCaptureFixture(t, "tr069-capture.json")
	rows, _, err := planGGCTR069(p, Settings{ACSURL: full.Want["url"], ACSUsername: full.Want["user"], ACSPassword: full.Want["pass"], InformInterval: 300},
		ggcCR{Username: full.Want["crUser"], Password: full.Want["crPass"]})
	if err != nil {
		t.Fatal(err)
	}
	assertRows(t, "semua kolom diubah", rows, full.Rows)
	if got := encodeFormRows(rows); got != full.Body {
		t.Fatalf("badan terkirim berbeda\nkode : %s\nasli : %s", got, full.Body)
	}

	min := ggcCaptureFixture(t, "tr069-capture-minimal.json")
	rows, changed, err := planGGCTR069(p, Settings{ACSURL: min.Want["url"], InformInterval: 300}, ggcCR{})
	if err != nil {
		t.Fatal(err)
	}
	assertRows(t, "hanya URL dan interval", rows, min.Rows)
	if got := encodeFormRows(rows); got != min.Body {
		t.Fatalf("badan terkirim berbeda\nkode : %s\nasli : %s", got, min.Body)
	}
	if strings.Join(changed, ",") != "URL,PeriodicInformInterval" {
		t.Fatalf("yang berubah = %v", changed)
	}
}

func assertRows(t *testing.T, label string, got, want [][2]string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: %d field, halaman asli %d\nkode : %v\nasli : %v", label, len(got), len(want), got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("%s: field ke-%d berbeda: kode %v, halaman asli %v", label, i, got[i], want[i])
		}
	}
}

func TestPlanGGCTR069NothingToDoWhenAlreadyConfigured(t *testing.T) {
	p := ggcPage(t)
	p.Data["URL"] = "http://172.16.0.1:7547"
	p.Data["UserName"] = "admin"
	p.Data["UserPassword"] = b64("admin")
	p.Data["PeriodicInformEnable"] = "1"
	p.Data["PeriodicInformInterval"] = "300"
	rows, changed, err := planGGCTR069(p, Settings{ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300}, ggcCR{})
	if err != nil || rows != nil || changed != nil {
		t.Fatalf("rows=%v changed=%v err=%v", rows, changed, err)
	}
}

func TestPlanGGCTR069PasswordIsNULLUnlessChanged(t *testing.T) {
	p := ggcPage(t)
	p.Data["UserPassword"] = b64("same")
	rows, _, err := planGGCTR069(p, Settings{ACSURL: "http://172.16.0.1:7547", ACSPassword: "same"}, ggcCR{})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r[0] == "UserPassword" && r[1] != "NULL" {
			t.Fatalf("sandi tidak berubah tetapi dikirim: %q", r[1])
		}
		if r[0] == "ConnectionRequestPassword" && r[1] != "NULL" {
			t.Fatalf("sandi connection request tidak boleh disentuh: %q", r[1])
		}
	}
}

func TestPlanGGCTR069RejectsValuesThePageWouldRefuse(t *testing.T) {
	p := ggcPage(t)
	for name, w := range map[string]Settings{
		"url bukan http":      {ACSURL: "ftp://x"},
		"url berisi spasi":    {ACSURL: "http://a b"},
		"url terlalu panjang": {ACSURL: "http://" + strings.Repeat("a", 300)},
		"user aneh":           {ACSURL: "http://a", ACSUsername: "a&b=c"},
		"sandi aneh":          {ACSURL: "http://a", ACSPassword: "p&IF_ACTION=x"},
		"interval besar":      {ACSURL: "http://a", InformInterval: 42949673},
	} {
		if _, _, err := planGGCTR069(p, w, ggcCR{}); !errors.Is(err, ErrNotSupportedConfig) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestParseGGCTR069RefusesUnverifiedLayouts(t *testing.T) {
	page := string(ggcFixture(t, "tr069-page.html"))
	cases := map[string]string{
		"field baru":         strings.Replace(page, "<INPUT type='hidden' name=ParameterKey", "<INPUT type='hidden' name=Aneh ID=Aneh value=''>\n<INPUT type='hidden' name=ParameterKey", 1),
		"urutan berubah":     strings.Replace(strings.Replace(page, "name=URL ", "name=TMP ", 1), "name=UserName ", "name=URL ", 1),
		"tanpa form":         strings.Replace(page, "<FORM NAME=fSubmit", "<DIV NAME=fSubmit", 1),
		"tanpa apply":        strings.Replace(page, `setValue("IF_ACTION", "apply")`, `setValue("IF_ACTION", "x")`, 1),
		"pilihan WAN tampil": page + `<script>jslEnDisplay("TR_DefaultWan");</script>`,
	}
	for name, body := range cases {
		_, err := parseGGCTR069([]byte(body))
		if name == "tanpa form" {
			if !errors.Is(err, ErrUnexpected) {
				t.Errorf("%s: err = %v", name, err)
			}
			continue
		}
		if !errors.Is(err, ErrNotSupportedConfig) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestIsGGCLinkLoginPage(t *testing.T) {
	model, ok := IsGGCLinkLoginPage(ggcFixture(t, "login-full.html"))
	if !ok || model != "GM220-S XPON" {
		t.Fatalf("model=%q ok=%v", model, ok)
	}
	for name, body := range map[string]string{
		"judul lain":   strings.Replace(string(ggcFixture(t, "login-full.html")), "GM220-S XPON", "F660", 1),
		"tanpa token":  strings.Replace(string(ggcFixture(t, "login-full.html")), "Frm_Logintoken", "X", -1),
		"halaman acak": "<html><title>GM220</title></html>",
	} {
		if _, ok := IsGGCLinkLoginPage([]byte(body)); ok {
			t.Errorf("%s dikenali sebagai GM220", name)
		}
	}
	if ggcLockedCall.Match(ggcFixture(t, "login-full.html")) {
		t.Error("halaman login biasa terbaca sebagai terkunci")
	}
}

func TestParseGGCInform(t *testing.T) {
	text, rep, ok := parseGGCInform(ggcFixture(t, "inform-page.html"))
	if !ok || rep || text != "Unreported (Terminal is starting)" {
		t.Fatalf("text=%q rep=%v ok=%v", text, rep, ok)
	}
	mk := func(stat, desc string) []byte {
		return []byte(fmt.Sprintf("<script>Transfer_meaning('InfoStat','%s');Transfer_meaning('InfoDesc','%s');</script>", stat, desc))
	}
	for _, c := range []struct {
		stat, desc, text string
		rep              bool
	}{
		{"0", "2", "Unreported (No Wan Connection for TR069)", false},
		{"0", "5", "Unreported (None ACS Configuration)", false},
		{"1", "0", "Reporting TR069 Inform", false},
		{"2", "8", "Authentication Failure", false},
		{"2", "6", "No Response (from ACS)", false},
		{"3", "0", "Succeed to report", true},
	} {
		got, rep, ok := parseGGCInform(mk(c.stat, c.desc))
		if !ok || got != c.text || rep != c.rep {
			t.Errorf("%s/%s: %q %v %v", c.stat, c.desc, got, rep, ok)
		}
	}
	if _, _, ok := parseGGCInform([]byte("<html>tidak ada</html>")); ok {
		t.Error("halaman tanpa InfoStat dianggap valid")
	}
}

// ---------------------------------------------------------------------------
// Modem tiruan: menegakkan aturan yang diamati di GM220-S asli.
// ---------------------------------------------------------------------------

type fakeGGC struct {
	t  *testing.T
	mu sync.Mutex

	user, pass string
	fails      int // salah login berturut-turut
	locked     bool
	busy       bool
	loggedIn   bool

	url, acsUser, acsPassB64, enable, interval string
	infoStat, infoDesc                         string

	token       int
	pageToken   string
	posts       [][][2]string
	logins      int
	logouts     int
	dropAfter   bool // sambungan diputus setelah perubahan diterapkan
	ignoreApply bool // jawab 200 tetapi tidak menyimpan
	ignoreURL   bool // menyimpan semuanya kecuali URL
	badReferer  []string
}

func newFakeGGC(t *testing.T) *fakeGGC {
	return &fakeGGC{t: t, user: "admin", pass: "admin", url: "", acsUser: "acsuser", acsPassB64: "YWNzcGFzcw==", enable: "1", interval: "43200", infoStat: "0", infoDesc: "0"}
}

func (m *fakeGGC) tr069Page() []byte {
	page := string(ggcFixture(m.t, "tr069-page.html"))
	set := func(name, value string) {
		re := regexp.MustCompile(`Transfer_meaning\('` + name + `','[^']*'\)`)
		page = re.ReplaceAllStringFunc(page, func(string) string { return "Transfer_meaning('" + name + "','" + value + "')" })
	}
	set("URL", m.url)
	set("UserName", m.acsUser)
	set("UserPassword", m.acsPassB64)
	set("PeriodicInformEnable", m.enable)
	set("PeriodicInformInterval", m.interval)
	m.token++
	m.pageToken = fmt.Sprintf("%016d", 7000000000000000+m.token)
	return []byte(strings.Replace(page, "1111222233334444", m.pageToken, 1))
}

func (m *fakeGGC) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w.Header().Set("Server", "Mini web server 1.0 ZTE corp 2005.")
	switch {
	case r.URL.Path == "/" && r.Method == http.MethodGet:
		_, _ = w.Write(ggcFixture(m.t, "login-full.html"))
	case r.URL.Path == "/" && r.Method == http.MethodPost:
		_ = r.ParseForm()
		if r.PostForm.Get("logout") == "1" {
			if r.PostForm.Get("_SESSION_TOKEN") != m.pageToken {
				m.t.Errorf("logout dengan token salah: %q", r.PostForm.Get("_SESSION_TOKEN"))
			}
			m.logouts++
			m.loggedIn = false
			w.Header().Set("Location", "/getpage.gch?pid=1001&hidden=upgrade")
			w.WriteHeader(http.StatusFound)
			return
		}
		m.logins++
		if r.PostForm.Get("action") != "login" || !regexp.MustCompile(`^\d+$`).MatchString(r.PostForm.Get("Frm_Logintoken")) {
			m.t.Errorf("login tidak seperti halaman asli: %v", r.PostForm)
		}
		if m.locked {
			_, _ = w.Write([]byte("<script>\nSetDisabled();\n</script>"))
			return
		}
		if m.busy {
			_, _ = w.Write([]byte("<script>alert('The user has already logged in');</script>"))
			return
		}
		if r.PostForm.Get("username") != m.user || r.PostForm.Get("Password") != m.pass {
			m.fails++
			if m.fails >= 3 {
				m.locked = true
			}
			_, _ = w.Write([]byte(`<script>getObj("errmsg").innerHTML = "User information is error, please input again.";</script>`))
			return
		}
		m.fails = 0
		m.loggedIn = true
		w.Header().Set("Location", "/start.ghtml")
		w.WriteHeader(http.StatusFound)
	case !m.loggedIn && r.URL.Path != "/":
		_, _ = w.Write(ggcFixture(m.t, "login-full.html")) // sesi hilang: modem menampilkan login lagi
	case r.URL.Path == "/start.ghtml":
		_, _ = w.Write([]byte("<frameset></frameset>"))
	case r.URL.Path == "/getpage.gch" && r.URL.Query().Get("nextpage") == "net_tr069_basic_t.gch" && r.Method == http.MethodGet:
		_, _ = w.Write(m.tr069Page())
	case r.URL.Path == "/getpage.gch" && r.URL.Query().Get("nextpage") == "net_tr069_basic_t.gch" && r.Method == http.MethodPost:
		body, _ := readAll(r)
		var rows [][2]string
		for _, kv := range strings.Split(body, "&") {
			p := strings.SplitN(kv, "=", 2)
			k, _ := url.QueryUnescape(p[0])
			v, _ := url.QueryUnescape(p[1])
			rows = append(rows, [2]string{k, v})
		}
		m.posts = append(m.posts, rows)
		want := append(append([]string{}, ggcTR069Fields...), "_SESSION_TOKEN")
		if len(rows) != len(want) {
			m.t.Errorf("POST: %d field, harapan %d", len(rows), len(want))
		} else {
			for i := range rows {
				if rows[i][0] != want[i] {
					m.t.Errorf("POST: field %d = %s, harapan %s", i, rows[i][0], want[i])
				}
			}
		}
		get := func(k string) string {
			for _, r := range rows {
				if r[0] == k {
					return r[1]
				}
			}
			return ""
		}
		if get("_SESSION_TOKEN") != m.pageToken || get("IF_ACTION") != "apply" {
			m.t.Errorf("POST tanpa token sesi terbaru / IF_ACTION: %q %q", get("_SESSION_TOKEN"), get("IF_ACTION"))
			_, _ = w.Write([]byte("<html>ditolak</html>"))
			return
		}
		if !m.ignoreApply {
			if !m.ignoreURL {
				m.url = get("URL")
			}
			m.acsUser = get("UserName")
			if pw := get("UserPassword"); pw != "NULL" {
				m.acsPassB64 = b64(pw)
			}
			m.enable = get("PeriodicInformEnable")
			m.interval = get("PeriodicInformInterval")
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
	case r.URL.Path == "/getpage.gch" && r.URL.Query().Get("nextpage") == "manager_act_inform_t.gch":
		m.token++
		m.pageToken = fmt.Sprintf("%016d", 7000000000000000+m.token)
		page := string(ggcFixture(m.t, "inform-page.html"))
		page = strings.ReplaceAll(page, "Transfer_meaning('InfoStat','0')", "Transfer_meaning('InfoStat','"+m.infoStat+"')")
		page = strings.ReplaceAll(page, "Transfer_meaning('InfoDesc','0')", "Transfer_meaning('InfoDesc','"+m.infoDesc+"')")
		_, _ = w.Write([]byte(page + fmt.Sprintf("<script>var session_token = \"%s\";</script>", m.pageToken)))
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func ggcClient(m *fakeGGC) (*GGCLinkClient, func()) {
	srv := httptest.NewServer(m)
	return NewGGCLinkClient(srv.URL, 5*time.Second), srv.Close
}

func fastGGCStatus(t *testing.T) {
	t.Helper()
	oldN, oldG := ggcStatusPolls, ggcStatusGap
	ggcStatusPolls, ggcStatusGap = 3, time.Millisecond
	t.Cleanup(func() { ggcStatusPolls, ggcStatusGap = oldN, oldG })
}

var ggcWant = Settings{ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300}

func TestGGCApplyWritesTheRealFormAndVerifiesByReading(t *testing.T) {
	fastGGCStatus(t)
	m := newFakeGGC(t)
	c, done := ggcClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWant)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Changed || res.ACSURL != ggcWant.ACSURL || !res.TR069Enable {
		t.Fatalf("res = %+v", res)
	}
	if len(m.posts) != 1 || m.logouts != 1 {
		t.Fatalf("posts=%d logouts=%d", len(m.posts), m.logouts)
	}
	if m.url != ggcWant.ACSURL || m.interval != "300" || m.acsUser != "admin" || m.acsPassB64 != b64("admin") {
		t.Fatalf("modem: url=%q interval=%q user=%q", m.url, m.interval, m.acsUser)
	}
	for _, f := range res.Fields {
		if strings.Contains(strings.ToLower(f), "admin") {
			t.Fatalf("nilai bocor ke hasil: %q", f)
		}
	}
	if res.ACSStatus != "Unreported (Terminal is starting)" || res.Informing {
		t.Fatalf("status = %q informing=%v", res.ACSStatus, res.Informing)
	}
}

func TestGGCApplyIsIdempotent(t *testing.T) {
	fastGGCStatus(t)
	m := newFakeGGC(t)
	c, done := ggcClient(m)
	defer done()
	if _, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWant); err != nil {
		t.Fatal(err)
	}
	c2 := NewGGCLinkClient(c.BaseURL, 5*time.Second)
	res, err := c2.ApplyTR069(context.Background(), "admin", "admin", ggcWant)
	if err != nil {
		t.Fatal(err)
	}
	if res.Changed || len(m.posts) != 1 {
		t.Fatalf("kali kedua mengubah lagi: changed=%v posts=%d", res.Changed, len(m.posts))
	}
	if m.logouts != 2 {
		t.Fatalf("logout = %d", m.logouts)
	}
}

func TestGGCApplyReportsInformStatus(t *testing.T) {
	fastGGCStatus(t)
	for _, c := range []struct {
		stat, desc string
		informing  bool
		noteHas    string
	}{
		{"3", "0", true, ""},
		{"0", "2", false, "WAN pembawa TR-069"},
		{"2", "8", false, ""},
	} {
		m := newFakeGGC(t)
		m.infoStat, m.infoDesc = c.stat, c.desc
		cl, done := ggcClient(m)
		res, err := cl.ApplyTR069(context.Background(), "admin", "admin", ggcWant)
		done()
		if err != nil {
			t.Fatal(err)
		}
		if res.Informing != c.informing || !strings.Contains(res.WANNote, c.noteHas) || (c.noteHas == "" && res.WANNote != "") {
			t.Errorf("%s/%s: informing=%v note=%q status=%q", c.stat, c.desc, res.Informing, res.WANNote, res.ACSStatus)
		}
		if res.WANChanged {
			t.Error("WAN tidak boleh pernah diubah")
		}
	}
}

func TestGGCApplyLoginFailures(t *testing.T) {
	fastGGCStatus(t)
	cases := []struct {
		name string
		mod  func(*fakeGGC)
		user string
		pass string
		want error
	}{
		{"sandi salah", func(*fakeGGC) {}, "admin", "salah", ErrBadCredentials},
		{"terkunci", func(m *fakeGGC) { m.locked = true }, "admin", "admin", ErrLocked},
		{"sesi lain", func(m *fakeGGC) { m.busy = true }, "admin", "admin", ErrSessionBusy},
	}
	for _, c := range cases {
		m := newFakeGGC(t)
		c.mod(m)
		cl, done := ggcClient(m)
		_, err := cl.ApplyTR069(context.Background(), c.user, c.pass, ggcWant)
		done()
		if !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v", c.name, err)
		}
		if len(m.posts) != 0 || m.logins != 1 {
			t.Errorf("%s: posts=%d logins=%d (tidak boleh mengulang login)", c.name, len(m.posts), m.logins)
		}
	}
}

func TestGGCApplyNeverSendsCredentialsToWrongDevice(t *testing.T) {
	var sawPost bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			sawPost = true
		}
		_, _ = w.Write([]byte("<html><title>Router lain</title><input name=Frm_Username></html>"))
	}))
	defer srv.Close()
	_, err := NewGGCLinkClient(srv.URL, 2*time.Second).ApplyTR069(context.Background(), "admin", "admin", ggcWant)
	if !errors.Is(err, ErrWrongDevice) || sawPost {
		t.Fatalf("err=%v post=%v", err, sawPost)
	}
}

func TestGGCApplyNotAppliedIsReported(t *testing.T) {
	fastGGCStatus(t)
	m := newFakeGGC(t)
	m.ignoreApply = true
	c, done := ggcClient(m)
	defer done()
	if _, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWant); !errors.Is(err, ErrNotApplied) {
		t.Fatalf("err = %v", err)
	}
	if m.logouts != 1 {
		t.Fatalf("logout = %d", m.logouts)
	}
}

func TestGGCApplyNotAppliedWhenOnlyURLIsIgnored(t *testing.T) {
	fastGGCStatus(t)
	m := newFakeGGC(t)
	m.ignoreURL = true
	c, done := ggcClient(m)
	defer done()
	if _, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWant); !errors.Is(err, ErrNotApplied) {
		t.Fatalf("err = %v", err)
	}
}

// Sambungan terputus SESUDAH perubahan diterapkan bukan penolakan: hasilnya dipastikan dengan membaca ulang.
func TestGGCApplyDropAfterWriteIsVerifiedByReading(t *testing.T) {
	fastGGCStatus(t)
	m := newFakeGGC(t)
	m.dropAfter = true
	c, done := ggcClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWant)
	if err != nil || !res.Changed {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestGGCApplyRefusesUnverifiedPageWithoutWriting(t *testing.T) {
	fastGGCStatus(t)
	m := newFakeGGC(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/getpage.gch" && r.Method == http.MethodGet && r.URL.Query().Get("nextpage") == "net_tr069_basic_t.gch" {
			page := strings.Replace(string(m.tr069Page()), "<INPUT type='hidden' name=ParameterKey", "<INPUT type='hidden' name=Baru ID=Baru value=''>\n<INPUT type='hidden' name=ParameterKey", 1)
			_, _ = w.Write([]byte(page))
			return
		}
		m.ServeHTTP(w, r)
	}))
	defer srv.Close()
	_, err := NewGGCLinkClient(srv.URL, 5*time.Second).ApplyTR069(context.Background(), "admin", "admin", ggcWant)
	if !errors.Is(err, ErrNotSupportedConfig) || len(m.posts) != 0 {
		t.Fatalf("err=%v posts=%d", err, len(m.posts))
	}
	if m.logouts != 1 {
		t.Fatalf("logout = %d", m.logouts)
	}
}

func TestDetectFindsGGCLink(t *testing.T) {
	m := newFakeGGC(t)
	srv := httptest.NewServer(m)
	defer srv.Close()
	d, kind, err := Detect(context.Background(), srv.URL, 3*time.Second)
	if err != nil || kind != KindGGCLink {
		t.Fatalf("kind=%q err=%v", kind, err)
	}
	if _, ok := d.(*GGCLinkClient); !ok {
		t.Fatalf("driver = %T", d)
	}
	if KindLabel(KindGGCLink) != "GGCLink GM220-S XPON" {
		t.Fatal(KindLabel(KindGGCLink))
	}
	if m.logins != 0 {
		t.Fatal("Detect tidak boleh login")
	}
}
