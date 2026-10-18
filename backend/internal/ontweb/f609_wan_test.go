package ontweb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"
)

type f609WANCapture struct {
	Body      string      `json:"body"`
	Rows      [][2]string `json:"rows"`
	EbooValue string      `json:"ebooValue"`
}

func f609WANCaptureFixture(t *testing.T) f609WANCapture {
	t.Helper()
	var c f609WANCapture
	if err := json.Unmarshal(f609Fixture(t, "wan-create-capture.json"), &c); err != nil {
		t.Fatal(err)
	}
	return c
}

// Bukti inti: isi POST "New WAN" yang dibentuk kode ini dan cookie EBOOVALUE-nya SAMA dengan yang dikirim halaman
// asli di dua F609 nyata (kedua tangkapan identik).
func TestPlanF609WANMatchesWhatTheRealPageSends(t *testing.T) {
	c := f609WANCaptureFixture(t)
	p, err := parseF609WAN(f609Fixture(t, "wan-page.html"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := planF609WAN(p)
	if err != nil {
		t.Fatal(err)
	}
	assertRows(t, "WAN F609", rows, c.Rows)
	if got := encodeFormRows(rows); got != c.Body {
		t.Fatalf("badan terkirim berbeda\nkode : %s\nasli : %s", got, c.Body)
	}
	if got := ebooValue(rows); got != c.EbooValue {
		t.Fatalf("EBOOVALUE = %q, peramban asli %q", got, c.EbooValue)
	}
	for _, r := range rows {
		if (r[0] == "pppUserName" || r[0] == "pppPassword") && r[1] != "" {
			t.Fatalf("WAN DHCP tidak boleh membawa kredensial PPPoE: %s", r[0])
		}
	}
}

func TestMaxIFIdxMirrorsThePage(t *testing.T) {
	for _, c := range []struct {
		store int
		used  []int
		want  int
	}{
		{1, []int{1}, 2},       // modem nyata
		{1, []int{1, 2}, 3},    // 2 sudah dipakai
		{5, []int{1, 2, 3}, 6}, // mulai sesudah store
		{98, []int{99}, 1},     // 99 dipakai: halaman lanjut mencari dari 1
	} {
		p := &f609WANPage{Store: c.store, IFIdxes: c.used}
		got, ok := p.maxIFIdx()
		if !ok || got != c.want {
			t.Errorf("store %d used %v: got %d ok=%v, want %d", c.store, c.used, got, ok, c.want)
		}
	}
	full := &f609WANPage{Store: 1}
	for i := 1; i <= 99; i++ {
		full.IFIdxes = append(full.IFIdxes, i)
	}
	if _, ok := full.maxIFIdx(); ok {
		t.Error("tanpa nomor bebas harus gagal")
	}
}

func TestPlanF609WANRefusesShapesNeverObserved(t *testing.T) {
	base := string(f609Fixture(t, "wan-page.html"))
	for name, page := range map[string]string{
		"dua WAN tanpa TR069": withWANs(base, "1_INTERNET_R_VID_", "2_INTERNET_R_VID_"),
		"nama WAN aneh":       withWANs(base, "1_OTHER_B_VID_"),
		"tanpa WAN":           withWANs(base),
	} {
		p, err := parseF609WAN([]byte(page))
		if err == nil {
			_, err = planF609WAN(p)
		}
		if !errors.Is(err, ErrNotSupportedConfig) {
			t.Errorf("%s: err = %v (harus ditolak)", name, err)
		}
	}
	// sudah punya WAN TR069: tidak ada yang dikirim
	p, err := parseF609WAN([]byte(withWANs(base, "1_INTERNET_R_VID_", "2_TR069_R_VID_")))
	if err != nil {
		t.Fatal(err)
	}
	if rows, err := planF609WAN(p); err != nil || rows != nil {
		t.Fatalf("rows=%v err=%v", rows, err)
	}
}

func TestParseF609WANRefusesUnverifiedLayouts(t *testing.T) {
	base := string(f609Fixture(t, "wan-page.html"))
	for name, page := range map[string]string{
		"kontrol baru":   strings.Replace(base, "</FORM>", "<input name=Baru></FORM>", 1),
		"kontrol hilang": strings.Replace(base, "name=MulticastVID", "name=Lain", 1),
	} {
		if _, err := parseF609WAN([]byte(page)); !errors.Is(err, ErrNotSupportedConfig) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if _, err := parseF609WAN([]byte("<html></html>")); !errors.Is(err, ErrUnexpected) {
		t.Errorf("tanpa form: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Modem tiruan dengan halaman WAN
// ---------------------------------------------------------------------------

type f609WANModem struct {
	*fakeF609
	wans     []string
	wanPosts int
	wanDrop  bool
	wanSkip  bool
	badWAN   int
}

func newF609WANModem(t *testing.T) *f609WANModem {
	return &f609WANModem{fakeF609: newFakeF609(t), wans: []string{"1_INTERNET_R_VID_"}}
}

// withWANs mengganti daftar WAN di data skrip halaman ("// num 0": jumlah dan nama dipisah koma).
func withWANs(page string, names ...string) string {
	page = regexp.MustCompile(`var nEntryNum = "\d+";`).ReplaceAllString(page, fmt.Sprintf(`var nEntryNum = "%d";`, len(names)))
	list := ""
	for _, n := range names {
		list += n + ","
	}
	return regexp.MustCompile(`var vArrayStr = "[^"]*";`).ReplaceAllString(page, `var vArrayStr = "`+list+`";`)
}

func (m *f609WANModem) wanPage() []byte {
	return []byte(withWANs(string(f609Fixture(m.t, "wan-page.html")), m.wans...))
}

func (m *f609WANModem) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/cgi-bin/net-wanset.asp" {
		m.fakeF609.ServeHTTP(w, r)
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.hasCookie(r, "ecntToken", m.token) || !m.loggedIn {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if r.Method == http.MethodGet {
		_, _ = w.Write(m.wanPage())
		return
	}
	m.wanPosts++
	body, _ := readAll(r)
	var rows [][2]string
	for _, kv := range strings.Split(body, "&") {
		p := strings.SplitN(kv, "=", 2)
		k, _ := url.QueryUnescape(p[0])
		v, _ := url.QueryUnescape(p[1])
		rows = append(rows, [2]string{k, v})
	}
	var want f609WANCapture
	_ = json.Unmarshal(f609Fixture(m.t, "wan-create-capture.json"), &want)
	if len(rows) != len(want.Rows) {
		m.t.Errorf("POST WAN: %d field, harapan %d", len(rows), len(want.Rows))
	} else {
		for i := range rows {
			if rows[i] != want.Rows[i] {
				m.t.Errorf("POST WAN field %d: %v, harapan %v", i, rows[i], want.Rows[i])
			}
		}
	}
	if !m.hasCookie(r, "EBOOVALUE", ebooValue(rows)) {
		m.badWAN++
		_, _ = w.Write([]byte("<html>ditolak: EBOOVALUE salah</html>"))
		return
	}
	if !m.wanSkip {
		m.wans = append(m.wans, "2_TR069_R_VID_")
	}
	if m.wanDrop {
		if hj, ok := w.(http.Hijacker); ok {
			if conn, _, err := hj.Hijack(); err == nil {
				_ = conn.Close()
				return
			}
		}
	}
	_, _ = w.Write([]byte("<html>ok</html>"))
}

func f609WANClient(m *f609WANModem) (*F609Client, func()) {
	srv := httptest.NewServer(m)
	return NewF609Client(srv.URL, 5*time.Second), srv.Close
}

func fastF609WAN(t *testing.T) {
	t.Helper()
	old, oldGap := f609WANRechecks, f609WANRecheckGap
	f609WANRechecks, f609WANRecheckGap = 3, time.Millisecond
	t.Cleanup(func() { f609WANRechecks, f609WANRecheckGap = old, oldGap })
}

var f609WantWAN = Settings{ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300, EnsureWAN: true}

func TestF609ApplyAddsTR069WANWithoutTouchingTheCustomerWAN(t *testing.T) {
	fastF609WAN(t)
	m := newF609WANModem(t)
	c, done := f609WANClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", f609WantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if !res.WANChanged || !strings.Contains(res.WANNote, "WAN pelanggan tidak diubah") || m.wanPosts != 1 || m.badWAN != 0 {
		t.Fatalf("res=%+v posts=%d bad=%d", res, m.wanPosts, m.badWAN)
	}
	if len(m.wans) != 2 || m.wans[0] != "1_INTERNET_R_VID_" {
		t.Fatalf("WAN pelanggan harus tetap: %v", m.wans)
	}
	if m.logouts != 1 {
		t.Fatalf("logout = %d", m.logouts)
	}
}

func TestF609ApplyWANIsIdempotent(t *testing.T) {
	fastF609WAN(t)
	m := newF609WANModem(t)
	c, done := f609WANClient(m)
	defer done()
	if _, err := c.ApplyTR069(context.Background(), "admin", "admin", f609WantWAN); err != nil {
		t.Fatal(err)
	}
	res, err := NewF609Client(c.BaseURL, 5*time.Second).ApplyTR069(context.Background(), "admin", "admin", f609WantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if res.WANChanged || res.WANNote != "" || m.wanPosts != 1 {
		t.Fatalf("kali kedua: res=%+v posts=%d (tidak boleh membuat WAN lagi)", res, m.wanPosts)
	}
}

func TestF609ApplyWANNotRequestedIsNeverCreated(t *testing.T) {
	fastF609WAN(t)
	m := newF609WANModem(t)
	m.acsCode = "1"
	c, done := f609WANClient(m)
	defer done()
	w := f609WantWAN
	w.EnsureWAN = false
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", w)
	if err != nil {
		t.Fatal(err)
	}
	if m.wanPosts != 0 || res.WANChanged || !strings.Contains(res.WANNote, "opsi") {
		t.Fatalf("res=%+v posts=%d", res, m.wanPosts)
	}
}

func TestF609ApplyWANDropAfterWriteIsVerifiedByReading(t *testing.T) {
	fastF609WAN(t)
	m := newF609WANModem(t)
	m.wanDrop = true
	c, done := f609WANClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", f609WantWAN)
	if err != nil || !res.WANChanged {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestF609ApplyWANNotVisibleIsReportedHonestly(t *testing.T) {
	fastF609WAN(t)
	m := newF609WANModem(t)
	m.wanSkip = true
	c, done := f609WANClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", f609WantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if res.WANChanged || !strings.Contains(res.WANNote, "belum terlihat") {
		t.Fatalf("res=%+v", res)
	}
}

func TestF609ApplyWANUnsupportedShapeSendsNothing(t *testing.T) {
	fastF609WAN(t)
	m := newF609WANModem(t)
	m.wans = []string{"1_INTERNET_R_VID_", "2_INTERNET_R_VID_"}
	c, done := f609WANClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", f609WantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if res.WANChanged || m.wanPosts != 0 || !strings.Contains(res.WANNote, "tidak ditambahkan") || !res.Changed {
		t.Fatalf("res=%+v posts=%d (TR-069 tetap terpasang, WAN tidak dikirim)", res, m.wanPosts)
	}
}
