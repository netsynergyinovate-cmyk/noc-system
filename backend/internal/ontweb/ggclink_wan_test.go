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

type ggcWANCapture struct {
	Body string      `json:"body"`
	Rows [][2]string `json:"rows"`
}

func ggcWANFixtures(t *testing.T) map[int]struct {
	page []byte
	cap  ggcWANCapture
} {
	t.Helper()
	out := map[int]struct {
		page []byte
		cap  ggcWANCapture
	}{}
	for _, n := range []int{1, 2} {
		var c ggcWANCapture
		if err := json.Unmarshal(ggcFixture(t, fmt.Sprintf("wan-create-capture-%d.json", n)), &c); err != nil {
			t.Fatal(err)
		}
		out[n] = struct {
			page []byte
			cap  ggcWANCapture
		}{ggcFixture(t, fmt.Sprintf("wan-page-%d.html", n)), c}
	}
	return out
}

// Bukti inti: untuk dua modem nyata, isi POST "Create WAN" yang dibentuk kode ini SAMA byte demi byte
// dengan yang dikirim halaman web asli di peramban asli.
func TestPlanGGCWANMatchesWhatTheRealPageSends(t *testing.T) {
	for n, fx := range ggcWANFixtures(t) {
		p, err := parseGGCWAN(fx.page)
		if err != nil {
			t.Fatalf("modem %d: %v", n, err)
		}
		rows, _, err := planGGCWAN(p)
		if err != nil {
			t.Fatalf("modem %d: %v", n, err)
		}
		assertRows(t, fmt.Sprintf("modem %d", n), rows, fx.cap.Rows)
		if got := encodeFormRows(rows); got != fx.cap.Body {
			t.Fatalf("modem %d: badan terkirim berbeda\nkode : %s\nasli : %s", n, got, fx.cap.Body)
		}
	}
}

func TestPlanGGCWANWanTR069AlreadyThere(t *testing.T) {
	page := string(ggcFixture(t, "wan-page-1.html"))
	page = strings.Replace(page, "Transfer_meaning('IF_INSTNUM','1')", "Transfer_meaning('IF_INSTNUM','2')", -1)
	page = strings.Replace(page, "</FORM>", "<script>Transfer_meaning('IF_WANNAME1','2\\x5fTR069\\x5fR\\x5fVID\\x5f');</script></FORM>", 1)
	p, err := parseGGCWAN([]byte(page))
	if err != nil {
		t.Fatal(err)
	}
	rows, note, err := planGGCWAN(p)
	if err != nil || rows != nil || note == "" {
		t.Fatalf("rows=%v note=%q err=%v", rows, note, err)
	}
}

func TestPlanGGCWANRefusesShapesNeverObserved(t *testing.T) {
	base := string(ggcFixture(t, "wan-page-1.html"))
	cases := map[string]string{
		"dua WAN tanpa TR069": strings.Replace(strings.Replace(base, "Transfer_meaning('IF_INSTNUM','1')", "Transfer_meaning('IF_INSTNUM','2')", -1),
			"</FORM>", "<script>Transfer_meaning('IF_WANNAME1','2\\x5fINTERNET\\x5fR\\x5fVID\\x5f');</script></FORM>", 1),
		"tanpa WAN":             strings.Replace(base, "Transfer_meaning('IF_INSTNUM','1')", "Transfer_meaning('IF_INSTNUM','0')", -1),
		"nama WAN aneh":         strings.Replace(base, "1\\x5fINTERNET\\x5fR\\x5fVID\\x5f", "1\\x5fOTHER\\x5fR\\x5fVID\\x5f", 1),
		"identitas aneh":        strings.Replace(base, "WCPPP1", "WCIP1", 1),
		"galat dilaporkan":      strings.Replace(base, "Transfer_meaning('IF_ERRORSTR','SUCC')", "Transfer_meaning('IF_ERRORSTR','009')", -1),
		"errortype bukan angka": strings.Replace(base, "Transfer_meaning('IF_ERRORTYPE','"+ggcErrorType(t, base)+"')", "Transfer_meaning('IF_ERRORTYPE','x;y')", 1),
	}
	for name, page := range cases {
		p, err := parseGGCWAN([]byte(page))
		if err == nil {
			_, _, err = planGGCWAN(p)
		}
		if !errors.Is(err, ErrNotSupportedConfig) && !errors.Is(err, ErrUnexpected) {
			t.Errorf("%s: err = %v (harus ditolak)", name, err)
		}
	}
}

func ggcErrorType(t *testing.T, page string) string {
	t.Helper()
	m := regexp.MustCompile(`Transfer_meaning\('IF_ERRORTYPE','(\d+)'\)`).FindStringSubmatch(page)
	if m == nil {
		t.Fatal("IF_ERRORTYPE angka tidak ada di fixture")
	}
	return m[1]
}

func TestParseGGCWANRefusesUnverifiedLayouts(t *testing.T) {
	base := string(ggcFixture(t, "wan-page-1.html"))
	for name, page := range map[string]string{
		"field baru":   strings.Replace(base, "<INPUT type='hidden' name=Enable1", "<INPUT type='hidden' name=Baru ID=Baru value=''>\n<INPUT type='hidden' name=Enable1", 1),
		"tanpa action": strings.Replace(base, `setValue("IF_ACTION","new")`, `setValue("IF_ACTION","x")`, 1),
	} {
		if _, err := parseGGCWAN([]byte(page)); !errors.Is(err, ErrNotSupportedConfig) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if _, err := parseGGCWAN([]byte("<html></html>")); !errors.Is(err, ErrUnexpected) {
		t.Errorf("tanpa form: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Modem tiruan dengan halaman WAN: menegakkan isi POST persis seperti tangkapan asli.
// ---------------------------------------------------------------------------

type ggcWANModem struct {
	*fakeGGC
	wans      []string // nama WAN yang ada
	wanPosts  int
	wanDrop   bool // putus setelah WAN dibuat
	wanIgnore bool // jawab 200 tetapi tidak membuat WAN
	errType   string
	badPosts  []string
}

func newGGCWANModem(t *testing.T) *ggcWANModem {
	return &ggcWANModem{fakeGGC: newFakeGGC(t), wans: []string{"1_INTERNET_R_VID_"}, errType: "1718872"}
}

func (m *ggcWANModem) wanPage() []byte {
	page := string(ggcFixture(m.t, "wan-page-1.html"))
	page = strings.Replace(page, "Transfer_meaning('IF_INSTNUM','1')", fmt.Sprintf("Transfer_meaning('IF_INSTNUM','%d')", len(m.wans)), -1)
	page = regexp.MustCompile(`Transfer_meaning\('IF_ERRORTYPE','\d+'\)`).ReplaceAllString(page, "Transfer_meaning('IF_ERRORTYPE','"+m.errType+"')")
	extra := ""
	for i, n := range m.wans {
		extra += fmt.Sprintf("<script>Transfer_meaning('IF_WANNAME%d','%s');Transfer_meaning('IF_WANIDENTITY%d','IGD\\x2eWD1\\x2eWCD%d\\x2eWCPPP1');</script>", i, strings.ReplaceAll(n, "_", "\\x5f"), i, i+1)
	}
	page = strings.Replace(page, "</FORM>", extra+"</FORM>", 1)
	m.token++
	m.pageToken = fmt.Sprintf("%016d", 7000000000000000+m.token)
	return []byte(strings.Replace(page, "1111222233334444", m.pageToken, 1))
}

func (m *ggcWANModem) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	isWAN := r.URL.Path == "/getpage.gch" && r.URL.Query().Get("nextpage") == "net_ethwan_conf_t.gch"
	if !isWAN {
		m.fakeGGC.ServeHTTP(w, r)
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.loggedIn {
		_, _ = w.Write(ggcFixture(m.t, "login-full.html"))
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
	// Harapan: tangkapan asli dengan nilai dinamis dari halaman yang dilayani.
	var want ggcWANCapture
	_ = json.Unmarshal(ggcFixture(m.t, "wan-create-capture-1.json"), &want)
	for i := range want.Rows {
		switch want.Rows[i][0] {
		case "IF_ERRORTYPE":
			want.Rows[i][1] = m.errType
		case "_SESSION_TOKEN":
			want.Rows[i][1] = m.pageToken
		case "IF_INSTNUM", "IF_INDEX":
			want.Rows[i][1] = fmt.Sprint(len(m.wans))
		}
	}
	if len(rows) != len(want.Rows) {
		m.t.Errorf("POST WAN: %d field, harapan %d", len(rows), len(want.Rows))
	} else {
		for i := range rows {
			if rows[i] != want.Rows[i] {
				m.t.Errorf("POST WAN field %d: %v, harapan %v", i, rows[i], want.Rows[i])
			}
		}
	}
	if !m.wanIgnore {
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

func ggcWANClient(m *ggcWANModem) (*GGCLinkClient, func()) {
	srv := httptest.NewServer(m)
	return NewGGCLinkClient(srv.URL, 5*time.Second), srv.Close
}

func fastGGCWAN(t *testing.T) {
	t.Helper()
	fastGGCStatus(t)
	oldN, oldG := ggcWANRechecks, ggcWANRecheckGap
	ggcWANRechecks, ggcWANRecheckGap = 3, time.Millisecond
	t.Cleanup(func() { ggcWANRechecks, ggcWANRecheckGap = oldN, oldG })
}

var ggcWantWAN = Settings{ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300, EnsureWAN: true}

func TestGGCApplyAddsTR069WANWithoutTouchingTheCustomerWAN(t *testing.T) {
	fastGGCWAN(t)
	m := newGGCWANModem(t)
	c, done := ggcWANClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if !res.WANChanged || !strings.Contains(res.WANNote, "WAN pelanggan tidak diubah") || m.wanPosts != 1 {
		t.Fatalf("res=%+v posts=%d", res, m.wanPosts)
	}
	if len(m.wans) != 2 || m.wans[0] != "1_INTERNET_R_VID_" {
		t.Fatalf("WAN pelanggan harus tetap: %v", m.wans)
	}
	if m.logouts != 1 {
		t.Fatalf("logout = %d", m.logouts)
	}
}

func TestGGCApplyWANIsIdempotent(t *testing.T) {
	fastGGCWAN(t)
	m := newGGCWANModem(t)
	c, done := ggcWANClient(m)
	defer done()
	if _, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWantWAN); err != nil {
		t.Fatal(err)
	}
	c2 := NewGGCLinkClient(c.BaseURL, 5*time.Second)
	res, err := c2.ApplyTR069(context.Background(), "admin", "admin", ggcWantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if res.WANChanged || res.WANNote != "" || m.wanPosts != 1 {
		t.Fatalf("kali kedua: res=%+v posts=%d (tidak boleh membuat WAN lagi)", res, m.wanPosts)
	}
}

func TestGGCApplyWANNotRequestedIsNeverCreated(t *testing.T) {
	fastGGCWAN(t)
	m := newGGCWANModem(t)
	m.infoStat, m.infoDesc = "0", "2"
	c, done := ggcWANClient(m)
	defer done()
	w := ggcWantWAN
	w.EnsureWAN = false
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", w)
	if err != nil {
		t.Fatal(err)
	}
	if m.wanPosts != 0 || res.WANChanged || !strings.Contains(res.WANNote, "opsi") {
		t.Fatalf("res=%+v posts=%d", res, m.wanPosts)
	}
}

func TestGGCApplyWANDropAfterWriteIsVerifiedByReading(t *testing.T) {
	fastGGCWAN(t)
	m := newGGCWANModem(t)
	m.wanDrop = true
	c, done := ggcWANClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWantWAN)
	if err != nil || !res.WANChanged {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestGGCApplyWANNotVisibleIsReportedHonestly(t *testing.T) {
	fastGGCWAN(t)
	m := newGGCWANModem(t)
	m.wanIgnore = true
	c, done := ggcWANClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if res.WANChanged || !strings.Contains(res.WANNote, "belum terlihat") {
		t.Fatalf("res=%+v", res)
	}
}

func TestGGCApplyWANUnsupportedShapeSendsNothing(t *testing.T) {
	fastGGCWAN(t)
	m := newGGCWANModem(t)
	m.wans = []string{"1_INTERNET_R_VID_", "2_INTERNET_R_VID_"}
	c, done := ggcWANClient(m)
	defer done()
	res, err := c.ApplyTR069(context.Background(), "admin", "admin", ggcWantWAN)
	if err != nil {
		t.Fatal(err)
	}
	if res.WANChanged || m.wanPosts != 0 || !strings.Contains(res.WANNote, "tidak ditambahkan") {
		t.Fatalf("res=%+v posts=%d", res, m.wanPosts)
	}
	if !res.Changed {
		t.Error("pengaturan TR-069 tetap harus terpasang walau WAN tidak didukung")
	}
}
