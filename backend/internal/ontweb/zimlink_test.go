package ontweb

import (
	"context"
	"encoding/json"
	"errors"
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

const fixtureDir = "testdata/zl2113x"

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(fixtureDir, name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type wanFixture struct {
	WanJSON map[string]string `json:"wanJson"`
	Rows    [][2]string       `json:"rows"`
}

func wanFixtures(t *testing.T) map[string]wanFixture {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(fixtureDir, "wan-*.json"))
	if err != nil || len(files) < 12 {
		t.Fatalf("fixture WAN: %d berkas, err=%v", len(files), err)
	}
	out := map[string]wanFixture{}
	for _, f := range files {
		var fx wanFixture
		if err := json.Unmarshal(readFixture(t, filepath.Base(f)), &fx); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		out[filepath.Base(f)] = fx
	}
	return out
}

// Inti bukti: untuk 12 modem nyata (6 varian firmware), isi formulir WAN yang dibentuk kode ini
// SAMA byte demi byte dengan yang dikirim halaman web asli (urutan field dan nilai).
func TestPlanZLWANMatchesWhatTheRealPageSends(t *testing.T) {
	for name, fx := range wanFixtures(t) {
		rows, svc, err := planZLWAN(zlWAN(fx.WanJSON))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if svc != "TR069_INTERNET" {
			t.Fatalf("%s: layanan = %q", name, svc)
		}
		if len(rows) != len(fx.Rows) {
			t.Fatalf("%s: jumlah field %d, halaman asli %d\nkode : %v\nasli : %v", name, len(rows), len(fx.Rows), rows, fx.Rows)
		}
		for i := range rows {
			if rows[i] != fx.Rows[i] {
				t.Fatalf("%s: field ke-%d berbeda: kode %v, halaman asli %v", name, i, rows[i], fx.Rows[i])
			}
		}
	}
}

func TestPlanZLWANAlreadyHasTR069(t *testing.T) {
	for _, svc := range []string{"TR069", "TR069_INTERNET", "TR069_VOICE_INTERNET"} {
		j := zlWAN{"ServiceList": svc}
		rows, to, err := planZLWAN(j)
		if err != nil || rows != nil || to != "" {
			t.Fatalf("%s: rows=%v to=%q err=%v", svc, rows, to, err)
		}
	}
}

// Gerbang: perubahan sekecil apa pun dari yang pernah teramati harus DITOLAK, bukan ditebak.
func TestPlanZLWANRefusesAnythingUnverified(t *testing.T) {
	var base wanFixture
	for _, fx := range wanFixtures(t) {
		base = fx
		break
	}
	mutate := func(f func(zlWAN)) zlWAN {
		j := zlWAN{}
		for k, v := range base.WanJSON {
			j[k] = v
		}
		f(j)
		return j
	}
	cases := map[string]zlWAN{
		"WAN lebih dari satu":    mutate(func(j zlWAN) { j["EntryNum"] = "2" }),
		"bukan PPPoE":            mutate(func(j zlWAN) { j["LinkMode"] = "linkIP" }),
		"mode bridge":            mutate(func(j zlWAN) { j["WanMode"] = "Bridge" }),
		"VLAN bertag":            mutate(func(j zlWAN) { j["VLANMode"] = "TAG" }),
		"IPv6 ikut":              mutate(func(j zlWAN) { j["IPVERSION"] = "IPv4/IPv6" }),
		"MTU lain":               mutate(func(j zlWAN) { j["MTU"] = "1400" }),
		"NAT mati":               mutate(func(j zlWAN) { j["NATENABLE"] = "Disable" }),
		"kunci tak dikenal":      mutate(func(j zlWAN) { j["VLANID"] = "100" }),
		"layanan suara":          mutate(func(j zlWAN) { j["ServiceList"] = "VOICE_INTERNET" }),
		"layanan OTHER":          mutate(func(j zlWAN) { j["ServiceList"] = "OTHER" }),
		"PPPoE tanpa kata sandi": mutate(func(j zlWAN) { j["PASSWORD"] = "" }),
		"PPPoE kata sandi N/A":   mutate(func(j zlWAN) { j["PASSWORD"] = "N/A" }),
		"tanpa nama PPPoE":       mutate(func(j zlWAN) { delete(j, "USERNAME") }),
		"indeks aneh":            mutate(func(j zlWAN) { j["ValidIFIndex"] = "8;drop" }),
		"WAN tidak aktif":        mutate(func(j zlWAN) { j["Active"] = "No" }),
		"multicast VLAN":         mutate(func(j zlWAN) { j["MulticastVID"] = "300" }),
		"DHCPv6 aktif":           mutate(func(j zlWAN) { j["DHCPv6"] = "Yes" }),
		"opsi 60 terisi":         mutate(func(j zlWAN) { j["Option60Enable1"] = "1" }),
		"nilai bukan teks":       nil,
	}
	delete(cases, "nilai bukan teks")
	for name, j := range cases {
		if _, _, err := planZLWAN(j); !errors.Is(err, ErrNotSupportedConfig) {
			t.Errorf("%s: harus ditolak (ErrNotSupportedConfig), dapat %v", name, err)
		}
	}
	if _, err := parseZLWAN([]byte(`{"EntryNum": 1}`)); !errors.Is(err, ErrNotSupportedConfig) {
		t.Errorf("nilai bukan teks harus ditolak: %v", err)
	}
	if _, err := parseZLWAN([]byte(`<html>`)); !errors.Is(err, ErrUnexpected) {
		t.Errorf("bukan JSON: %v", err)
	}
}

func TestTR069FormParsedFromRealPageAndMatchesRealSubmission(t *testing.T) {
	fields, err := parseFormFields(readFixture(t, "tr069-page.html"))
	if err != nil {
		t.Fatal(err)
	}
	var cap struct {
		Rows [][2]string `json:"rows"`
	}
	if err := json.Unmarshal(readFixture(t, "tr069-capture.json"), &cap); err != nil {
		t.Fatal(err)
	}
	rows, changed, err := planTR069(fields, Settings{
		ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != len(cap.Rows) {
		t.Fatalf("jumlah field %d, halaman asli %d\nkode: %v\nasli: %v", len(rows), len(cap.Rows), rows, cap.Rows)
	}
	for i := range rows {
		if rows[i] != cap.Rows[i] {
			t.Fatalf("field ke-%d: kode %v, halaman asli %v", i, rows[i], cap.Rows[i])
		}
	}
	for _, want := range []string{"URL", "Username", "Password", "PeriodicInformInterval"} {
		found := false
		for _, c := range changed {
			found = found || c == want
		}
		if !found {
			t.Errorf("%s harus tercatat berubah: %v", want, changed)
		}
	}
	// PeriodicInformEnable sudah "Yes" di halaman asli: tidak dihitung berubah.
	for _, c := range changed {
		if c == "PeriodicInformEnable" {
			t.Errorf("PeriodicInformEnable sudah Yes, tidak berubah: %v", changed)
		}
	}
}

func TestTR069PlanIsNoopWhenAlreadyCorrect(t *testing.T) {
	fields, _ := parseFormFields(readFixture(t, "tr069-page.html"))
	cur := func(n string) string { v, _ := effective(fields, n); return v }
	rows, changed, err := planTR069(fields, Settings{ACSURL: cur("URL"), ACSUsername: cur("Username"), ACSPassword: cur("Password"), InformInterval: 43200})
	if err != nil || rows != nil || changed != nil {
		t.Fatalf("rows=%v changed=%v err=%v", rows, changed, err)
	}
}

func TestTR069PlanValidation(t *testing.T) {
	fields, _ := parseFormFields(readFixture(t, "tr069-page.html"))
	bad := []Settings{
		{ACSURL: "ftp://x:7547"},
		{ACSURL: "http://x y:7547"},
		{ACSURL: "http://x:7547/?a=b&c=d"},
		{ACSURL: "http://172.16.0.1:7547", ACSUsername: "bad user"},
		{ACSURL: "http://172.16.0.1:7547", ACSPassword: "a'b"},
		{ACSURL: "http://172.16.0.1:7547", InformInterval: 2147483648},
	}
	for _, s := range bad {
		if _, _, err := planTR069(fields, s); !errors.Is(err, ErrNotSupportedConfig) {
			t.Errorf("%+v: harus ditolak, dapat %v", s, err)
		}
	}
}

func TestParseFormIgnoresHTMLInsideScripts(t *testing.T) {
	page := []byte(`<form name="ConfigForm"><input name=A value="1"><script>x.innerHTML = "<input id=\"Z\" name=\"Z\" value=1>";</script>
		<input type=radio name=R value=a><input type=radio name=R value=b checked><input type=checkbox name=C><input type=button name=B value=x></form>`)
	f, err := parseFormFields(page)
	if err != nil {
		t.Fatal(err)
	}
	rows := serializeForm(f, nil)
	if len(rows) != 2 || rows[0] != [2]string{"A", "1"} || rows[1] != [2]string{"R", "b"} {
		t.Fatalf("rows = %v", rows)
	}
	if _, err := parseFormFields([]byte("<html>tanpa formulir</html>")); !errors.Is(err, ErrUnexpected) {
		t.Fatalf("err = %v", err)
	}
}

func TestACSStatusParsedFromRealPage(t *testing.T) {
	code, text, ok := parseACSStatus(readFixture(t, "sta-acs.html"))
	if !ok || code != "1" || !strings.Contains(text, "No remote management WAN connection") {
		t.Fatalf("code=%q text=%q ok=%v", code, text, ok)
	}
	if _, _, ok := parseACSStatus([]byte("<html>")); ok {
		t.Fatal("halaman lain tidak boleh dikenali")
	}
}

func TestJSEscapeAndFormEncoding(t *testing.T) {
	if got := jsEscape("Abc-1_2.3@x*+/ !#é"); got != "Abc-1_2.3@x*+/%20%21%23%E9" {
		t.Fatalf("jsEscape = %q", got)
	}
	if got := encodeFormRows([][2]string{{"b", "x y"}, {"a", "N/A"}, {"c", ""}}); got != "b=x+y&a=N%2FA&c=" {
		t.Fatalf("encode = %q (urutan harus dipertahankan)", got)
	}
}

func TestIsZimlinkLoginPage(t *testing.T) {
	if m, ok := IsZimlinkLoginPage(readFixture(t, "index2.html")); !ok || m != "ZL-2113X" {
		t.Fatalf("m=%q ok=%v", m, ok)
	}
	if _, ok := IsZimlinkLoginPage([]byte(`var RES_TITLE_NAME = "HG8245";`)); ok {
		t.Fatal("model lain tidak boleh dikenali")
	}
}

// --- modem Boa palsu: halaman asli dari fixture, status dapat berubah ---

type fakeBoa struct {
	t        *testing.T
	mu       sync.Mutex
	user     string
	pass     string
	busy     bool
	loggedIn bool
	framed   bool // content.asp sudah dibuka sesudah login (modem asli menolak halaman lain sebelum itu)
	logins   int
	logouts  int
	url      string
	username string
	password string
	interval string
	acsCode  string
	wan      map[string]string
	wanRows  [][2]string // isi formulir WAN yang DIHARAPKAN (dari halaman asli)
	wanPosts int
	wanSink  bool // POST WAN diputus tanpa jawaban
	wanStall bool // POST WAN diterapkan lalu jawaban DITAHAN di tengah (header terkirim, isi tidak selesai)
	rejectTR bool // POST TR-069 diabaikan (tidak disimpan)
	trPosts  [][][2]string
	badLogin bool
}

func newFakeBoa(t *testing.T) *fakeBoa {
	var fx wanFixture
	for _, f := range wanFixtures(t) {
		fx = f
		break
	}
	wan := map[string]string{}
	for k, v := range fx.WanJSON {
		wan[k] = v
	}
	return &fakeBoa{
		t: t, user: "superadmin", pass: "superoem",
		url: "http://devacs.edatahome.com:9090/ACS-server/ACS", username: "hgw", password: "hgw", interval: "43200",
		acsCode: "1", wan: wan, wanRows: fx.Rows,
	}
}

func (m *fakeBoa) tr069Page() []byte {
	page := string(readFixture(m.t, "tr069-page.html"))
	sub := func(name, val string) {
		re := regexp.MustCompile(`(?i)(name="?` + name + `"?\s+value=")[^"]*(")`)
		if !re.MatchString(page) {
			m.t.Fatalf("fixture tidak memuat %s", name)
		}
		page = re.ReplaceAllString(page, `${1}`+val+`${2}`)
	}
	sub("URL", m.url)
	sub("Username", m.username)
	sub("PeriodicInformInterval", m.interval)
	// Password: ada dua pola (name="Password" di dalam span) — ganti yang dalam HTML, bukan skrip.
	re := regexp.MustCompile(`(?i)(name="?Password"?\s+value=")[^"]*(")`)
	page = re.ReplaceAllString(page, `${1}`+m.password+`${2}`)
	return []byte(page)
}

func (m *fakeBoa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	hasSession := strings.Contains(r.Header.Get("Cookie"), "SESSIONID=boasid")
	// Hanya POST login yang boleh membawa LoginTimes; halaman asli membuangnya sesudah login
	// dan modem asli menjawab 401 bila cookie itu ikut terkirim.
	if !(r.URL.Path == "/cgi-bin/index2.asp" && r.Method == http.MethodPost) && strings.Contains(r.Header.Get("Cookie"), "LoginTimes") {
		m.t.Errorf("cookie LoginTimes ikut terkirim ke %s", r.URL.Path)
	}
	switch {
	case r.URL.Path == "/cgi-bin/index2.asp" && r.Method == http.MethodGet:
		_, _ = w.Write(readFixture(m.t, "index2.html"))
	case r.URL.Path == "/cgi-bin/index2.asp" && r.Method == http.MethodPost:
		_ = r.ParseForm()
		m.logins++
		ck := r.Header.Get("Cookie")
		okCookie := hasSession && strings.Contains(ck, "UID="+r.PostForm.Get("Username")) && strings.Contains(ck, "PSW=")
		if m.badLogin || !okCookie || r.PostForm.Get("Username") != m.user || r.PostForm.Get("Password") != m.pass ||
			r.PostForm.Get("Password1") != m.pass || r.PostForm.Get("hLoginTimes") != "1" || r.PostForm.Get("logintype") != "usr" {
			_, _ = w.Write([]byte(`<html><script>function userPSWST(st){}</script>login gagal</html>`))
			return
		}
		if m.busy {
			_, _ = w.Write([]byte(`<script>userlogin(1);userPSWST(1);gotomain_set();</script>`))
			return
		}
		m.loggedIn = true
		m.framed = false
		_, _ = w.Write([]byte(`<script>function refreshself(){} userPSWST(1);gotomain_set(); </script>`))
	case !hasSession || !m.loggedIn:
		w.WriteHeader(http.StatusUnauthorized)
	case r.URL.Path == "/cgi-bin/content.asp":
		m.framed = true
		_, _ = w.Write([]byte("<frameset></frameset>"))
	case r.URL.Path != "/cgi-bin/logout.cgi" && !m.framed:
		// ZL-2113X asli: login lolos tetapi halaman lain 401 sampai content.asp dibuka.
		w.WriteHeader(http.StatusUnauthorized)
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
		m.trPosts = append(m.trPosts, rows)
		if !m.rejectTR {
			for _, kv := range rows {
				switch kv[0] {
				case "URL":
					m.url = kv[1]
				case "Username":
					m.username = kv[1]
				case "Password":
					m.password = kv[1]
				case "PeriodicInformInterval":
					m.interval = kv[1]
				}
			}
		}
		_, _ = w.Write([]byte("ok"))
	case r.URL.Path == "/cgi-bin/sta-acs.asp":
		page := string(readFixture(m.t, "sta-acs.html"))
		i := strings.Index(page, "Inform Status")
		re := regexp.MustCompile(`var result = "\d"`)
		loc := re.FindStringIndex(page[i:])
		page = page[:i+loc[0]] + `var result = "` + m.acsCode + `"` + page[i+loc[1]:]
		_, _ = w.Write([]byte(page))
	case r.URL.Path == "/cgi-bin/get_node_foreach_info.json":
		_ = json.NewEncoder(w).Encode(m.wan)
	case r.URL.Path == "/cgi-bin/net-wanset.asp" && r.Method == http.MethodPost:
		m.wanPosts++
		body, _ := readAll(r)
		var got [][2]string
		for _, kv := range strings.Split(body, "&") {
			p := strings.SplitN(kv, "=", 2)
			k, _ := url.QueryUnescape(p[0])
			v, _ := url.QueryUnescape(p[1])
			got = append(got, [2]string{k, v})
		}
		if len(got) != len(m.wanRows) {
			m.t.Errorf("POST WAN: %d field, harapan %d", len(got), len(m.wanRows))
		} else {
			for i := range got {
				if got[i] != m.wanRows[i] {
					m.t.Errorf("POST WAN field %d: %v, harapan %v", i, got[i], m.wanRows[i])
				}
			}
		}
		if m.wanStall {
			// Dialami di ZL-2113X asli: perubahan masuk, modem menyambung ulang PPPoE dan jawaban
			// tidak pernah selesai, sehingga klien kehabisan waktu SAAT MEMBACA isi jawaban.
			m.wan["ServiceList"] = "TR069_INTERNET"
			w.Header().Set("Content-Length", "5000")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html>"))
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			time.Sleep(3500 * time.Millisecond)
			return
		}
		if m.wanSink {
			if hj, ok := w.(http.Hijacker); ok {
				if conn, _, err := hj.Hijack(); err == nil {
					_ = conn.Close()
				}
			}
			m.wan["ServiceList"] = "TR069_INTERNET"
			return
		}
		m.wan["ServiceList"] = "TR069_INTERNET"
		_, _ = w.Write([]byte("ok"))
	default:
		http.NotFound(w, r)
	}
}

func readAll(r *http.Request) (string, error) {
	var sb strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := r.Body.Read(buf)
		sb.Write(buf[:n])
		if err != nil {
			return sb.String(), nil
		}
	}
}

func setupBoa(t *testing.T) (*fakeBoa, *ZimlinkClient) {
	t.Helper()
	wanRecheckDelay = time.Millisecond
	wanPostTimeout = 2 * time.Second
	m := newFakeBoa(t)
	srv := httptest.NewServer(m)
	t.Cleanup(srv.Close)
	return m, NewZimlinkClient(srv.URL, 5*time.Second)
}

var zlWant = Settings{ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300}

func TestZimlinkApplyWritesTR069AndLogsOut(t *testing.T) {
	m, c := setupBoa(t)
	res, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", zlWant)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Changed || res.ACSURL != zlWant.ACSURL {
		t.Fatalf("res = %+v", res)
	}
	if m.url != zlWant.ACSURL || m.username != "admin" || m.password != "admin" || m.interval != "300" {
		t.Fatalf("modem: url=%q user=%q pass=%q interval=%q", m.url, m.username, m.password, m.interval)
	}
	if len(m.trPosts) != 1 || len(m.trPosts[0]) != 16 {
		t.Fatalf("satu POST 16 field, dapat %d: %v", len(m.trPosts), m.trPosts)
	}
	if m.logouts != 1 || m.loggedIn {
		t.Fatal("harus logout agar slot login pelanggan tidak tertahan")
	}
	if m.wanPosts != 0 {
		t.Fatal("WAN tidak boleh disentuh tanpa EnsureWAN")
	}
	if res.ACSStatus == "" || res.Informing {
		t.Fatalf("status ACS harus terbaca dan belum 'Reported successfully': %+v", res)
	}
}

func TestZimlinkApplyIsIdempotent(t *testing.T) {
	m, c := setupBoa(t)
	if _, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", zlWant); err != nil {
		t.Fatal(err)
	}
	m.trPosts = nil
	m.acsCode = "8"
	res, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", zlWant)
	if err != nil || res.Changed || len(m.trPosts) != 0 {
		t.Fatalf("res=%+v err=%v posts=%d", res, err, len(m.trPosts))
	}
	if !res.Informing {
		t.Fatal("kode 8 = Reported successfully")
	}
}

func TestZimlinkBadCredentialsNeverRetried(t *testing.T) {
	m, c := setupBoa(t)
	_, err := c.ApplyTR069(context.Background(), "superadmin", "salah", zlWant)
	if !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("err = %v", err)
	}
	if m.logins != 1 {
		t.Fatalf("login %d kali; halaman mengunci setelah 3 salah", m.logins)
	}
	if m.logouts != 0 {
		t.Fatal("tanpa sesi tidak perlu logout")
	}
}

func TestZimlinkSessionBusy(t *testing.T) {
	m, c := setupBoa(t)
	m.busy = true
	if _, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", zlWant); !errors.Is(err, ErrSessionBusy) {
		t.Fatalf("err = %v", err)
	}
}

func TestZimlinkNotAppliedIsReported(t *testing.T) {
	m, c := setupBoa(t)
	m.rejectTR = true
	_, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", zlWant)
	if !errors.Is(err, ErrNotApplied) {
		t.Fatalf("err = %v", err)
	}
	if m.logouts != 1 {
		t.Fatal("logout tetap harus jalan saat gagal")
	}
}

func TestZimlinkWrongDeviceNeverReceivesCredentials(t *testing.T) {
	logins := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			logins++
		}
		_, _ = w.Write([]byte(`<html>var RES_TITLE_NAME = "HG8245H";</html>`))
	}))
	defer srv.Close()
	_, err := NewZimlinkClient(srv.URL, time.Second).ApplyTR069(context.Background(), "superadmin", "superoem", zlWant)
	if !errors.Is(err, ErrWrongDevice) || logins != 0 {
		t.Fatalf("err=%v logins=%d", err, logins)
	}
}

func TestZimlinkEnsureWANChangesServiceWithRealPageBody(t *testing.T) {
	m, c := setupBoa(t)
	w := zlWant
	w.EnsureWAN = true
	res, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", w)
	if err != nil {
		t.Fatal(err)
	}
	if !res.WANChanged || res.WANNote != "" || m.wanPosts != 1 {
		t.Fatalf("res=%+v posts=%d", res, m.wanPosts)
	}
	if m.wan["ServiceList"] != "TR069_INTERNET" {
		t.Fatal("WAN tidak berubah")
	}
}

func TestZimlinkEnsureWANSecondRunSendsNothing(t *testing.T) {
	m, c := setupBoa(t)
	w := zlWant
	w.EnsureWAN = true
	if _, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", w); err != nil {
		t.Fatal(err)
	}
	m.wanPosts = 0
	res, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", w)
	if err != nil || res.WANChanged || res.WANNote != "" || m.wanPosts != 0 {
		t.Fatalf("res=%+v err=%v posts=%d", res, err, m.wanPosts)
	}
}

func TestZimlinkEnsureWANConnectionDroppedAfterApplyIsSuccess(t *testing.T) {
	m, c := setupBoa(t)
	m.wanSink = true
	w := zlWant
	w.EnsureWAN = true
	res, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", w)
	if err != nil || !res.WANChanged || res.WANNote != "" {
		t.Fatalf("putus sesudah perubahan masuk harus sukses: res=%+v err=%v", res, err)
	}
}

func TestZimlinkEnsureWANUnsupportedShapeIsLeftAloneWithNote(t *testing.T) {
	m, c := setupBoa(t)
	m.wan["VLANMode"] = "TAG"
	w := zlWant
	w.EnsureWAN = true
	res, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", w)
	if err != nil {
		t.Fatal(err)
	}
	if res.WANChanged || m.wanPosts != 0 || !strings.Contains(res.WANNote, "TR069_INTERNET") {
		t.Fatalf("WAN di luar yang terverifikasi tidak boleh disentuh: res=%+v posts=%d", res, m.wanPosts)
	}
	if !res.Changed {
		t.Fatal("TR-069 tetap harus tersimpan")
	}
}

func TestDetectChoosesDriverWithoutCredentials(t *testing.T) {
	boa, _ := setupBoa(t)
	srv := httptest.NewServer(boa)
	defer srv.Close()
	d, kind, err := Detect(context.Background(), srv.URL, 3*time.Second)
	if err != nil || kind != KindZimlink {
		t.Fatalf("kind=%q err=%v", kind, err)
	}
	if _, ok := d.(*ZimlinkClient); !ok {
		t.Fatalf("driver = %T", d)
	}
	if boa.logins != 0 {
		t.Fatal("deteksi tidak boleh mengirim kredensial")
	}

	f := newFakeONT()
	fsrv := httptest.NewServer(f)
	defer fsrv.Close()
	d, kind, err = Detect(context.Background(), fsrv.URL, 3*time.Second)
	if err != nil || kind != KindFD511GW {
		t.Fatalf("kind=%q err=%v", kind, err)
	}
	if _, ok := d.(*Client); !ok {
		t.Fatalf("driver = %T", d)
	}
	if f.logins != 0 {
		t.Fatal("deteksi tidak boleh mengirim kredensial")
	}

	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("router lain")) }))
	defer other.Close()
	if _, _, err := Detect(context.Background(), other.URL, time.Second); !errors.Is(err, ErrWrongDevice) {
		t.Fatalf("err = %v", err)
	}
	if _, _, err := Detect(context.Background(), "http://127.0.0.1:1", time.Second); !errors.Is(err, ErrUnreachable) {
		t.Fatalf("err = %v", err)
	}
}

func TestZimlinkEnsureWANStalledAnswerAfterApplyIsSuccess(t *testing.T) {
	m, c := setupBoa(t)
	m.wanStall = true
	w := zlWant
	w.EnsureWAN = true
	res, err := c.ApplyTR069(context.Background(), "superadmin", "superoem", w)
	if err != nil {
		t.Fatal(err)
	}
	if !res.WANChanged || strings.Contains(res.WANNote, "menolak") || res.WANNote != "" {
		t.Fatalf("jawaban yang tertahan sesudah perubahan masuk bukan penolakan: %+v", res)
	}
	if !res.Changed || m.url != zlWant.ACSURL {
		t.Fatalf("TR-069 tetap harus tersimpan: %+v url=%q", res, m.url)
	}
}

func TestBodyReadTimeoutIsAConnectionDropNotAnUnexpectedAnswer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "100")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("x"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		time.Sleep(2 * time.Second)
	}))
	defer srv.Close()
	zl := NewZimlinkClient(srv.URL, 300*time.Millisecond)
	if _, err := zl.get(context.Background(), "/x", ""); !errors.Is(err, ErrUnreachable) || errors.Is(err, ErrUnexpected) {
		t.Fatalf("ZIMLINK: err = %v", err)
	}
	fd := NewClient(srv.URL, 300*time.Millisecond)
	if err := fd.get(context.Background(), "x", nil); !errors.Is(err, ErrUnreachable) || errors.Is(err, ErrUnexpected) {
		t.Fatalf("FD511GW: err = %v", err)
	}
}
