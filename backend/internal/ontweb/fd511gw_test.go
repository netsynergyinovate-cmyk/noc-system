package ontweb

import (
	"context"
	"crypto/md5" //nolint:gosec // sama dengan modem
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeONT meniru web admin FD511GW: login md5, token di header, tr069_config
// yang bisa dibaca dan ditulis sebagian, logout.
type fakeONT struct {
	mu        sync.Mutex
	user      string
	pass      string
	token     string
	loggedIn  bool
	logouts   int
	logins    int
	posts     []map[string]any
	cfg       map[string]any // bentuk jawaban get.json (tanpa "code")
	inform    int
	ignoreSet bool // modem menjawab OK tetapi tidak menyimpan

	model      string           // jawaban public_info (bawaan FD511GW)
	wan        []map[string]any // jawaban get.json?module=wan_confignew ("wan")
	wanPosts   []map[string]any
	wanDropped bool // setelah menulis WAN, modem "menyambung ulang": bacaan WAN gagal
	// wanHang: penulisan WAN diterapkan tetapi koneksi diputus tanpa jawaban
	// (yang terjadi di FD511GW asli). wanHangForever: bahkan tidak diterapkan.
	wanHang        bool
	wanReject      bool // modem menjawab galat eksplisit (kode 10106 "sedang mengonfigurasi")
	wanHangForever bool
	wanWrote       bool
}

func newFakeONT() *fakeONT {
	return &fakeONT{
		user: "admin", pass: "Rahasia#1", token: "tok-123", model: "FD511GW",
		cfg: map[string]any{
			"tr069enable": 0,
			"acs":         map[string]any{"acsurl": "", "acsname": "", "acspasswd": "", "informenable": 0, "informinterval": 43200},
			"cwmp":        map[string]any{"cwmpname": "x", "cwmppasswd": "y", "cwmppath": "/tr069", "cwmpport": 7547},
		},
	}
}

func (f *fakeONT) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	reply := func(code int, extra map[string]any) {
		out := map[string]any{"code": code}
		for k, v := range extra {
			out[k] = v
		}
		_ = json.NewEncoder(w).Encode(out)
	}
	// Seperti modem asli: tanpa header Authorization APA PUN jawabannya 10104,
	// termasuk untuk login. Sebelum login halaman web mengirim teks "null".
	if r.Header.Get("Authorization") == "" {
		reply(10104, nil)
		return
	}
	if r.Header.Get("Referer") == "" {
		reply(10104, nil)
		return
	}
	authed := f.loggedIn && r.Header.Get("Authorization") == f.token
	if r.Method == http.MethodGet && r.URL.Path == "/get.json" && r.URL.Query().Get("module") == "public_info" {
		// Terbuka tanpa login, seperti modem asli.
		reply(0, map[string]any{"model": f.model})
		return
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/post.json":
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch body["module"] {
		case "login":
			f.logins++
			sum := md5.Sum([]byte(f.pass)) //nolint:gosec
			if body["username"] != f.user {
				reply(10001, nil)
			} else if body["encryPassword"] != hex.EncodeToString(sum[:]) {
				reply(10002, nil)
			} else {
				f.loggedIn = true
				reply(0, map[string]any{"token": f.token, "role": "admin"})
			}
		case "wan_confignew":
			if !authed {
				reply(10102, nil)
				return
			}
			f.wanPosts = append(f.wanPosts, body)
			if f.wanReject {
				reply(10106, nil)
				return
			}
			if !f.wanHangForever {
				list, _ := body["wan"].([]any)
				for i, e := range list {
					patch, _ := e.(map[string]any)
					for k, v := range patch {
						f.wan[i][k] = v
					}
				}
				f.wanWrote = true
			}
			if f.wanHang || f.wanHangForever {
				// Putus tanpa jawaban, seperti modem yang menyambung ulang PPPoE.
				if hj, ok := w.(http.Hijacker); ok {
					if conn, _, err := hj.Hijack(); err == nil {
						_ = conn.Close()
					}
				}
				return
			}
			reply(0, nil)
		case "logout":
			f.logouts++
			f.loggedIn = false
			reply(0, nil)
		case "tr069_config":
			if !authed {
				reply(10102, nil)
				return
			}
			f.posts = append(f.posts, body)
			if !f.ignoreSet {
				if v, ok := body["tr069enable"]; ok {
					f.cfg["tr069enable"] = v
				}
				if acs, ok := body["acs"].(map[string]any); ok {
					cur := f.cfg["acs"].(map[string]any)
					for k, v := range acs {
						cur[k] = v
					}
				}
			}
			reply(0, nil)
		default:
			reply(10104, nil)
		}
	case r.Method == http.MethodGet && r.URL.Path == "/get.json":
		if !authed {
			reply(10102, nil)
			return
		}
		switch r.URL.Query().Get("module") {
		case "tr069_config":
			reply(0, f.cfg)
		case "wan_confignew":
			if f.wanWrote && f.wanDropped {
				http.Error(w, "reconnecting", http.StatusBadGateway)
				return
			}
			reply(0, map[string]any{"wan": f.wan})
		case "tr069_status":
			reply(0, map[string]any{"tr069Inform": f.inform, "tr069Connect": 2})
		case "public_info":
			reply(0, map[string]any{"model": f.model})
		default:
			reply(10104, nil)
		}
	default:
		http.NotFound(w, r)
	}
}

func internetWAN() map[string]any {
	return map[string]any{
		"hidden": 0, "interface": "1_INTERNET_R_VID_", "service_type": 2, "connection_type": 2, "mtu": 1492,
		"ip_protocol": 1, "port_binding": []any{}, "ppp": map[string]any{"username": "u@x", "password": "RAHASIA-PPPOE"},
		"ipv4": map[string]any{"dhcp_enable": 0, "ip_address": "172.16.15.239", "gateway": "172.16.0.1", "request_dns": 0, "dns": []any{"1.1.1.1", "8.8.8.8"}},
	}
}

func setup(t *testing.T) (*fakeONT, *Client) {
	t.Helper()
	wanRecheckDelay = time.Millisecond
	wanPostTimeout = 2 * time.Second
	f := newFakeONT()
	f.wan = []map[string]any{internetWAN()}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return f, NewClient(srv.URL, 5*time.Second)
}

var want = Settings{ACSURL: "http://10.0.0.5:7547", InformInterval: 300}

func TestApplyTR069WritesOnlyDifferences(t *testing.T) {
	f, c := setup(t)
	res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", want)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Changed || res.ACSURL != want.ACSURL || !res.TR069Enable {
		t.Fatalf("hasil: %+v", res)
	}
	if len(f.posts) != 1 {
		t.Fatalf("harus satu penulisan, dapat %d", len(f.posts))
	}
	p := f.posts[0]
	if _, has := p["cwmp"]; has {
		t.Fatal("bagian cwmp tidak boleh disentuh")
	}
	acs := p["acs"].(map[string]any)
	if _, has := acs["acspasswd"]; has {
		t.Fatal("kata sandi ACS tidak diminta, tidak boleh dikirim")
	}
	if acs["acsurl"] != want.ACSURL || acs["informinterval"].(float64) != 300 || acs["informenable"].(float64) != 1 {
		t.Fatalf("acs: %v", acs)
	}
	if p["tr069enable"].(float64) != 1 {
		t.Fatal("TR-069 harus dinyalakan")
	}
	if f.logouts != 1 || f.loggedIn {
		t.Fatal("harus logout")
	}
}

func TestApplyTR069IdempotentWritesNothing(t *testing.T) {
	f, c := setup(t)
	if _, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", want); err != nil {
		t.Fatal(err)
	}
	f.posts = nil
	f.inform = 3
	res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", want)
	if err != nil {
		t.Fatal(err)
	}
	if res.Changed || len(f.posts) != 0 {
		t.Fatalf("tidak boleh menulis lagi: %+v posts=%d", res, len(f.posts))
	}
	if !res.Informing {
		t.Fatal("status lapor 3 harus terbaca")
	}
}

func TestApplyTR069SendsACSCredentialsOnlyWhenGiven(t *testing.T) {
	f, c := setup(t)
	s := want
	s.ACSUsername, s.ACSPassword = "acs", "pw-acs"
	if _, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", s); err != nil {
		t.Fatal(err)
	}
	acs := f.posts[0]["acs"].(map[string]any)
	if acs["acsname"] != "acs" || acs["acspasswd"] != "pw-acs" {
		t.Fatalf("acs: %v", acs)
	}
}

func TestBadCredentialsAreNotRetried(t *testing.T) {
	for _, tc := range []struct{ user, pass string }{{"salah", "Rahasia#1"}, {"admin", "salah"}} {
		f, c := setup(t)
		_, err := c.ApplyTR069(context.Background(), tc.user, tc.pass, want)
		if !errors.Is(err, ErrBadCredentials) {
			t.Fatalf("err = %v", err)
		}
		if f.logins != 1 {
			t.Fatalf("login diulang %d kali; modem mengunci setelah 3 salah", f.logins)
		}
		if f.logouts != 0 {
			t.Fatal("tanpa token tidak perlu logout")
		}
	}
}

func TestNotAppliedIsReported(t *testing.T) {
	f, c := setup(t)
	f.ignoreSet = true
	_, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", want)
	if !errors.Is(err, ErrNotApplied) {
		t.Fatalf("err = %v", err)
	}
	if f.logouts != 1 {
		t.Fatal("logout tetap harus jalan saat gagal")
	}
}

func TestEmptyACSURLRefusedBeforeAnyRequest(t *testing.T) {
	f, c := setup(t)
	if _, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", Settings{}); err == nil {
		t.Fatal("harus ditolak")
	}
	if f.logins != 0 {
		t.Fatal("tidak boleh login bila ACS URL kosong")
	}
}

func TestUnreachableAndNonModemAnswers(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", time.Second)
	if _, err := c.ApplyTR069(context.Background(), "a", "b", want); err == nil {
		t.Fatal("harus gagal")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>router lain</html>"))
	}))
	defer srv.Close()
	_, err := NewClient(srv.URL, time.Second).ApplyTR069(context.Background(), "a", "b", want)
	if !errors.Is(err, ErrWrongDevice) {
		t.Fatalf("err = %v", err)
	}
}

func TestRedirectIsNotFollowed(t *testing.T) {
	hit := false
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL, http.StatusFound)
	}))
	defer srv.Close()
	_, err := NewClient(srv.URL, time.Second).ApplyTR069(context.Background(), "a", "b", want)
	if !errors.Is(err, ErrWrongDevice) || hit {
		t.Fatalf("err=%v hit=%v", err, hit)
	}
}

func TestSessionBusyAndLocked(t *testing.T) {
	for code, want := range map[int]error{10003: ErrSessionBusy, 10004: ErrSessionBusy, 10005: ErrLocked} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet { // public_info lolos; penolakan terjadi di login
				_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "model": "FD511GW"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": code})
		}))
		_, err := NewClient(srv.URL, time.Second).ApplyTR069(context.Background(), "a", "b", Settings{ACSURL: "http://x"})
		srv.Close()
		if !errors.Is(err, want) {
			t.Fatalf("kode %d: err = %v", code, err)
		}
	}
}

func TestRequestsAlwaysCarryAuthorizationHeader(t *testing.T) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Get("Authorization"))
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 10001})
	}))
	defer srv.Close()
	_, _ = NewClient(srv.URL, time.Second).ApplyTR069(context.Background(), "a", "b", want)
	if len(seen) == 0 {
		t.Fatal("tidak ada permintaan")
	}
	for _, h := range seen {
		if h != "null" {
			t.Fatalf("sebelum login semua permintaan harus membawa Authorization: null, dapat %q", seen)
		}
	}
}

var wantWAN = Settings{ACSURL: "http://10.0.0.5:7547", InformInterval: 300, EnsureWAN: true}

func connType(f *fakeONT, i int) float64 {
	switch v := f.wan[i]["connection_type"].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	}
	return -1
}

func TestEnsureWANChangesOnlyServiceTypeWithUIShapedPayload(t *testing.T) {
	f, c := setup(t)
	res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if !res.WANChanged || res.WANNote != "" {
		t.Fatalf("res = %+v", res)
	}
	if len(f.wanPosts) != 1 {
		t.Fatalf("satu penulisan WAN, dapat %d", len(f.wanPosts))
	}
	list := f.wanPosts[0]["wan"].([]any)
	patch := list[0].(map[string]any)
	if patch["connection_type"].(float64) != 3 {
		t.Fatalf("connection_type = %v", patch["connection_type"])
	}
	for _, k := range []string{"port_binding", "mtu", "ip_protocol", "ipv4"} {
		if _, ok := patch[k]; !ok {
			t.Errorf("selisih harus memuat %s seperti form WAN modem", k)
		}
	}
	for _, k := range []string{"ppp", "service_type", "interface", "ipv6", "vlanId"} {
		if _, ok := patch[k]; ok {
			t.Errorf("%s tidak boleh dikirim (hanya service type yang berubah)", k)
		}
	}
	if raw, _ := json.Marshal(f.wanPosts); strings.Contains(string(raw), "RAHASIA-PPPOE") {
		t.Fatal("kata sandi PPPoE tidak boleh ikut dikirim ulang")
	}
	if connType(f, 0) != 3 {
		t.Fatalf("modem tidak berubah: %v", f.wan[0]["connection_type"])
	}
}

func TestEnsureWANIdempotentWhenAlreadyCarryingTR069(t *testing.T) {
	f, c := setup(t)
	f.wan[0]["connection_type"] = 3
	res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN)
	if err != nil || res.WANChanged || res.WANNote != "" || len(f.wanPosts) != 0 {
		t.Fatalf("res=%+v err=%v posts=%d", res, err, len(f.wanPosts))
	}
}

func TestEnsureWANOffByDefault(t *testing.T) {
	f, c := setup(t)
	if _, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", want); err != nil {
		t.Fatal(err)
	}
	if len(f.wanPosts) != 0 {
		t.Fatal("WAN tidak boleh disentuh tanpa EnsureWAN")
	}
}

func TestEnsureWANRunsEvenWhenTR069ConfigAlreadyCorrect(t *testing.T) {
	f, c := setup(t)
	if _, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", want); err != nil {
		t.Fatal(err)
	}
	res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN)
	if err != nil || res.Changed || !res.WANChanged || len(f.wanPosts) != 1 {
		t.Fatalf("res=%+v err=%v posts=%d", res, err, len(f.wanPosts))
	}
}

func TestEnsureWANRefusesToGuess(t *testing.T) {
	voice := internetWAN()
	voice["connection_type"] = 8
	hidden := internetWAN()
	hidden["hidden"] = 1
	for name, wans := range map[string][]map[string]any{
		"dua WAN internet":   {internetWAN(), internetWAN()},
		"tanpa WAN internet": {voice},
		"hanya tersembunyi":  {hidden},
	} {
		f, c := setup(t)
		f.wan = wans
		res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN)
		if err != nil || res.WANChanged || res.WANNote == "" || len(f.wanPosts) != 0 {
			t.Errorf("%s: res=%+v err=%v posts=%d", name, res, err, len(f.wanPosts))
		}
	}
}

func TestEnsureWANVoiceInternetBecomesVoiceTR069Internet(t *testing.T) {
	f, c := setup(t)
	f.wan[0]["connection_type"] = 10
	if _, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN); err != nil {
		t.Fatal(err)
	}
	if got := f.wanPosts[0]["wan"].([]any)[0].(map[string]any)["connection_type"].(float64); got != 11 {
		t.Fatalf("connection_type = %v", got)
	}
}

func TestEnsureWANReconnectIsNotAFailure(t *testing.T) {
	f, c := setup(t)
	f.wanDropped = true
	res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN)
	if err != nil {
		t.Fatalf("modem sambung ulang bukan galat: %v", err)
	}
	if !res.WANChanged || !strings.Contains(res.WANNote, "menyambung ulang") {
		t.Fatalf("res = %+v", res)
	}
}

func TestEnsureWANSecondWANKeepsIndexOrder(t *testing.T) {
	f, c := setup(t)
	other := internetWAN()
	other["connection_type"] = 8
	f.wan = []map[string]any{other, internetWAN()}
	if _, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN); err != nil {
		t.Fatal(err)
	}
	list := f.wanPosts[0]["wan"].([]any)
	if len(list) != 2 || len(list[0].(map[string]any)) != 0 || list[1].(map[string]any)["connection_type"].(float64) != 3 {
		t.Fatalf("elemen sebelum indeks harus {} dan target di indeks 1: %v", list)
	}
}

func TestEnsureWANConnectionDroppedAfterApplyIsSuccess(t *testing.T) {
	f, c := setup(t)
	f.wanHang = true
	res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if !res.WANChanged || res.WANNote != "" {
		t.Fatalf("putus sesudah perubahan masuk harus sukses tanpa catatan galat: %+v", res)
	}
	if connType(f, 0) != 3 {
		t.Fatal("modem palsu seharusnya sudah berubah")
	}
}

func TestEnsureWANConnectionDroppedAndNotApplied(t *testing.T) {
	f, c := setup(t)
	f.wanHangForever = true
	res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if res.WANChanged || res.WANNote == "" || strings.Contains(res.WANNote, "menolak") {
		t.Fatalf("tidak terbukti: harus catatan netral, bukan klaim berhasil/ditolak: %+v", res)
	}
}

func TestEnsureWANExplicitRejectionIsStillRejection(t *testing.T) {
	f, c := setup(t)
	f.wanReject = true
	res, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", wantWAN)
	if err != nil || res.WANChanged || !strings.Contains(res.WANNote, "menolak") {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestWrongModelNeverReceivesCredentials(t *testing.T) {
	for _, model := range []string{"HG8145V5", "F609", "", "XFD511GW"} {
		f, c := setup(t)
		f.model = model
		_, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", want)
		if !errors.Is(err, ErrWrongDevice) {
			t.Fatalf("model %q: err = %v", model, err)
		}
		if f.logins != 0 {
			t.Fatalf("model %q: kredensial dikirim ke perangkat yang salah (%d login)", model, f.logins)
		}
	}
}

func TestModelCheckIsCaseInsensitiveAndAllowsSuffix(t *testing.T) {
	for _, model := range []string{"FD511GW", "fd511gw", "FD511GW-X1"} {
		f, c := setup(t)
		f.model = model
		if _, err := c.ApplyTR069(context.Background(), "admin", "Rahasia#1", want); err != nil {
			t.Fatalf("model %q: %v", model, err)
		}
	}
}

func TestNonModemAnswerOnPublicInfoIsWrongDevice(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>router lain</html>"))
	}))
	defer srv.Close()
	_, err := NewClient(srv.URL, time.Second).ApplyTR069(context.Background(), "a", "b", want)
	if !errors.Is(err, ErrWrongDevice) {
		t.Fatalf("err = %v", err)
	}
}
