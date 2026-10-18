package ontweb

// Klien halaman web admin GGCLink GM220-S XPON (dilaporkan OLT sebagai "ZICG GM22"): firmware
// keluarga ZTE ("Mini web server 1.0 ZTE corp"), bukan JSON API dan bukan Boa. Protokolnya dibaca
// dari halaman modem itu sendiri dan DIBUKTIKAN dengan menangkap isi formulir yang dikirim halaman
// asli (peramban asli, permintaan dibatalkan sebelum sampai ke modem), lalu dicocokkan byte demi
// byte dengan keluaran kode ini lewat fixture di testdata/gm22:
//
//	GET  /                          halaman login; token login ada di skripnya (Frm_Logintoken)
//	POST /                          frashnum=&action=login&Frm_Logintoken=N&username=U&Password=P
//	                                berhasil: 302 ke /start.ghtml; gagal: 200 + halaman login
//	GET  /getpage.gch?pid=1002&nextpage=net_tr069_basic_t.gch   menu Network > Remote Management > ITMS
//	POST (alamat yang sama)         formulir fSubmit, IF_ACTION=apply, token sesi di ujung
//	GET  /getpage.gch?pid=1002&nextpage=manager_act_inform_t.gch status lapor ke ITMS (InfoStat/InfoDesc)
//	POST /                          logout=1&_SESSION_TOKEN=...
//
// Tidak ada cookie: sesi dikenali modem dari alamat pengirim. Tiap halaman memuat token sesi di
// skripnya (session_token) yang harus ikut di setiap POST.
//
// Halaman TR-069 tidak mengubah WAN. Modem ini tidak mengizinkan service list WAN PPPoE yang sudah
// ada diubah dari web (kolomnya terkunci), jadi WAN pelanggan TIDAK pernah disentuh. Dengan
// EnsureWAN, WAN BARU bertipe TR069 (DHCP, tanpa VLAN) ditambahkan (ggclink_wan.go); router
// menjawab DHCP-nya di VLAN PON (lihat backend/README.md, "Jaringan manajemen ONT").

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	ggcTitle        = regexp.MustCompile(`(?is)<title>\s*(GM220[-A-Za-z0-9 ]*?)\s*</title>`)
	ggcLoginToken   = regexp.MustCompile(`getObj\("Frm_Logintoken"\)\.value\s*=\s*"(\d+)"`)
	ggcLockedCall   = regexp.MustCompile(`(?m)^\s*SetDisabled\(\)\s*;?\s*$`)
	ggcBadCreds     = regexp.MustCompile(`User information is error`)
	ggcBusy         = regexp.MustCompile(`(?i)(already|other user|another user|is online|logged in)`)
	ggcSessionToken = regexp.MustCompile(`var\s+session_token\s*=\s*"(\d+)"\s*;`)
	ggcMeaning      = regexp.MustCompile(`Transfer_meaning\('([^']*)','((?:[^'\\]|\\.)*)'\)`)
	ggcForm         = regexp.MustCompile(`(?is)<form\s+name=fSubmit\b.*?</form>`)
	ggcHidden       = regexp.MustCompile(`(?is)<input\s+type=['"]?hidden['"]?\s+name=['"]?([A-Za-z0-9_]+)`)
	ggcHexEscape    = regexp.MustCompile(`\\x([0-9a-fA-F]{2})`)
	ggcDefaultWanOn = regexp.MustCompile(`(?i)EnDisplay\([^)]*TR_DefaultWan`)
)

// IsGGCLinkLoginPage: halaman login terbuka tanpa kredensial, berjudul GM220-... dan berformulir
// ZTE (Frm_Username + Frm_Logintoken).
func IsGGCLinkLoginPage(body []byte) (model string, ok bool) {
	m := ggcTitle.FindSubmatch(body)
	if m == nil {
		return "", false
	}
	s := string(body)
	if !strings.Contains(s, "Frm_Username") || !strings.Contains(s, "Frm_Logintoken") {
		return "", false
	}
	return string(m[1]), true
}

// GGCLinkClient memanggil satu modem GM220-S XPON.
type GGCLinkClient struct {
	BaseURL  string
	HTTP     *http.Client
	token    string // session_token dari halaman terakhir yang dimuat
	loggedIn bool
	lastURL  string // halaman terakhir (untuk Referer)
}

func NewGGCLinkClient(baseURL string, timeout time.Duration) *GGCLinkClient {
	return &GGCLinkClient{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (c *GGCLinkClient) do(req *http.Request) (int, http.Header, []byte, error) {
	res, err := c.HTTP.Do(req)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("%w: %w", ErrUnreachable, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		// Putus atau timeout di tengah jawaban = koneksi terputus, BUKAN jawaban yang aneh.
		return 0, nil, nil, fmt.Errorf("%w: baca jawaban: %w", ErrUnreachable, err)
	}
	if res.StatusCode >= 400 {
		return res.StatusCode, res.Header, data, fmt.Errorf("%w: HTTP %d", ErrUnexpected, res.StatusCode)
	}
	return res.StatusCode, res.Header, data, nil
}

func (c *GGCLinkClient) get(ctx context.Context, path, referer string) (int, http.Header, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return 0, nil, nil, err
	}
	if referer != "" {
		req.Header.Set("Referer", c.BaseURL+referer)
	}
	return c.do(req)
}

func (c *GGCLinkClient) postForm(ctx context.Context, path, referer string, rows [][2]string) (int, http.Header, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, strings.NewReader(encodeFormRows(rows)))
	if err != nil {
		return 0, nil, nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", c.BaseURL+referer)
	return c.do(req)
}

// checkModel membaca halaman login (tanpa kredensial) dan menolak perangkat yang bukan GM220-S.
func (c *GGCLinkClient) checkModel(ctx context.Context) error {
	_, _, body, err := c.get(ctx, "/", "")
	if err != nil {
		if errors.Is(err, ErrUnexpected) {
			return fmt.Errorf("%w: tidak menjawab seperti web admin modem", ErrWrongDevice)
		}
		return err
	}
	if _, ok := IsGGCLinkLoginPage(body); !ok {
		return fmt.Errorf("%w (bukan GGCLink GM220-S XPON)", ErrWrongDevice)
	}
	return nil
}

// login meniru dosubmit() halaman. Tanpa percobaan ulang: halaman mengunci 1 menit setelah 3 kali salah.
func (c *GGCLinkClient) login(ctx context.Context, username, password string) error {
	if username == "" || password == "" {
		return errors.New("ontweb: nama pengguna/kata sandi modem kosong")
	}
	if len(username) > 64 || len(password) > 64 {
		return fmt.Errorf("%w: kredensial terlalu panjang", ErrBadCredentials)
	}
	_, _, page, err := c.get(ctx, "/", "")
	if err != nil {
		return err
	}
	m := ggcLoginToken.FindSubmatch(page)
	if m == nil {
		return fmt.Errorf("%w: login tanpa token", ErrUnexpected)
	}
	status, hdr, body, err := c.postForm(ctx, "/", "/", [][2]string{
		{"frashnum", ""}, {"action", "login"}, {"Frm_Logintoken", string(m[1])},
		{"username", username}, {"Password", password},
	})
	if err != nil {
		return err
	}
	if status == http.StatusFound && strings.HasSuffix(strings.SplitN(hdr.Get("Location"), "?", 2)[0], "/start.ghtml") {
		// Peramban membuka kerangka halaman sesudah login; sesi baru dianggap lengkap sesudah itu.
		if _, _, _, err := c.get(ctx, "/start.ghtml", "/"); err != nil {
			return err
		}
		c.loggedIn = true
		return nil
	}
	switch {
	case ggcLockedCall.Match(body):
		return ErrLocked
	case ggcBadCreds.Match(body):
		return ErrBadCredentials
	case ggcBusy.Match(body):
		return ErrSessionBusy
	}
	// Gagal tertutup: jawaban yang tidak dikenal bukan tanda sukses.
	return fmt.Errorf("%w: jawaban login tidak dikenal (HTTP %d)", ErrUnexpected, status)
}

func (c *GGCLinkClient) logout() {
	if !c.loggedIn {
		return
	}
	c.loggedIn = false
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, _, _ = c.postForm(ctx, "/", c.lastURL, [][2]string{{"logout", "1"}, {"_SESSION_TOKEN", c.token}})
}

// page memuat satu halaman menu dan menyimpan token sesinya. Halaman login (sesi hilang) = galat.
func (c *GGCLinkClient) page(ctx context.Context, next string) ([]byte, error) {
	path := "/getpage.gch?pid=1002&nextpage=" + next
	_, _, body, err := c.get(ctx, path, "/start.ghtml")
	if err != nil {
		return nil, err
	}
	if _, isLogin := IsGGCLinkLoginPage(body); isLogin {
		return nil, fmt.Errorf("%w: sesi ditolak (modem meminta login lagi)", ErrUnexpected)
	}
	m := ggcSessionToken.FindSubmatch(body)
	if m == nil {
		return nil, fmt.Errorf("%w: halaman tanpa token sesi", ErrUnexpected)
	}
	c.token = string(m[1])
	c.lastURL = path
	return body, nil
}

// ---------------------------------------------------------------------------
// Halaman TR-069 (formulir fSubmit)
// ---------------------------------------------------------------------------

// ggcTR069Fields: urutan field formulir yang sudah DIBUKTIKAN (cocok dengan yang dikirim halaman
// asli). Susunan lain = firmware yang belum diperiksa, jadi tidak dikirim apa pun.
var ggcTR069Fields = []string{
	"IF_ACTION", "IF_ERRORSTR", "IF_ERRORPARAM", "IF_ERRORTYPE",
	"URL", "UserName", "UserPassword", "PeriodicInformEnable", "PeriodicInformInterval",
	"ParameterKey", "ConnectionRequestURL", "ConnectionRequestUsername", "ConnectionRequestPassword",
	"UpgradesManaged", "DefaultWan", "SupportCertAuth", "ConnectionRequestPort",
	"IF_PAGE", "IF_URLATTR", "IF_UsernameATTR", "IF_PasswordATTR",
	"IF_ConnectionRequestUsernameATTR", "IF_ConnectionRequestPasswordATTR",
}

func ggcUnescape(s string) string {
	return ggcHexEscape.ReplaceAllStringFunc(s, func(m string) string {
		n, _ := strconv.ParseUint(m[2:], 16, 8)
		return string(rune(n))
	})
}

// ggcTR069Page: isi formulir + token sesi dari halaman net_tr069_basic_t.gch.
type ggcTR069Page struct {
	Data  map[string]string // nilai sekarang (Transfer_meaning terakhir menang), sandi tetap base64
	Token string
}

func parseGGCTR069(page []byte) (*ggcTR069Page, error) {
	text := string(page)
	form := ggcForm.FindString(text)
	if form == "" {
		return nil, fmt.Errorf("%w: formulir fSubmit tidak ditemukan", ErrUnexpected)
	}
	var order []string
	for _, m := range ggcHidden.FindAllStringSubmatch(form, -1) {
		order = append(order, m[1])
	}
	if strings.Join(order, ",") != strings.Join(ggcTR069Fields, ",") {
		return nil, fmt.Errorf("%w: susunan formulir TR-069 berbeda dari yang terverifikasi", ErrNotSupportedConfig)
	}
	if !strings.Contains(text, `setValue("IF_ACTION", "apply")`) {
		return nil, fmt.Errorf("%w: halaman TR-069 tidak mengirim IF_ACTION=apply seperti yang terverifikasi", ErrNotSupportedConfig)
	}
	if ggcDefaultWanOn.MatchString(text) {
		return nil, fmt.Errorf("%w: pilihan WAN TR-069 tampil di halaman (belum terverifikasi)", ErrNotSupportedConfig)
	}
	tok := ggcSessionToken.FindStringSubmatch(text)
	if tok == nil {
		return nil, fmt.Errorf("%w: halaman tanpa token sesi", ErrUnexpected)
	}
	data := map[string]string{}
	for _, m := range ggcMeaning.FindAllStringSubmatch(form, -1) {
		data[m[1]] = ggcUnescape(m[2])
	}
	return &ggcTR069Page{Data: data, Token: tok[1]}, nil
}

// ggcCR: isian "Access to Onu" (connection request) yang HANYA dipakai uji pembuktian terhadap
// tangkapan peramban asli; ApplyTR069 tidak pernah mengubahnya (GenieACS mengaturnya sendiri lewat
// provisioning noc-connreq).
type ggcCR struct{ Username, Password string }

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

// planGGCTR069 menyusun isi formulir persis seperti pageSubmit() halaman: field yang tidak disentuh
// dikirim "NULL" (sandi) atau nilai sekarang (nama pengguna), field di luar TR069_PARA dibawa apa adanya.
// rows=nil bila modem sudah berisi pengaturan ini.
func planGGCTR069(p *ggcTR069Page, want Settings, cr ggcCR) (rows [][2]string, changed []string, err error) {
	if !zlSafeURL.MatchString(want.ACSURL) {
		return nil, nil, fmt.Errorf("%w: ACS URL hanya boleh huruf, angka dan : / - . _ (diawali http:// atau https://)", ErrNotSupportedConfig)
	}
	if len(want.ACSURL) > 256 {
		return nil, nil, fmt.Errorf("%w: ACS URL terlalu panjang (modem membatasi 256 karakter)", ErrNotSupportedConfig)
	}
	d := p.Data
	val := map[string]string{"IF_ACTION": "apply"}
	for _, k := range []string{"ParameterKey", "ConnectionRequestURL", "UpgradesManaged", "DefaultWan"} {
		val[k] = "NULL"
	}
	mark := func(label string) { changed = append(changed, label) }

	val["URL"] = want.ACSURL
	if d["URL"] != want.ACSURL {
		mark("URL")
	}

	val["UserName"] = d["UserName"]
	if want.ACSUsername != "" {
		if !zlSafeCreds.MatchString(want.ACSUsername) {
			return nil, nil, fmt.Errorf("%w: nama pengguna ACS tidak didukung modem", ErrNotSupportedConfig)
		}
		val["UserName"] = want.ACSUsername
		if d["UserName"] != want.ACSUsername {
			mark("Username")
		}
	}
	if val["UserName"] == "" {
		return nil, nil, fmt.Errorf("%w: modem mewajibkan nama pengguna ACS", ErrNotSupportedConfig)
	}

	// Sandi: halaman mengirim "NULL" bila kolom tidak disentuh dan nilai yang diketik bila diubah.
	// Data tersimpan di modem berbentuk base64.
	val["UserPassword"] = "NULL"
	if want.ACSPassword != "" {
		if !zlSafeCreds.MatchString(want.ACSPassword) {
			return nil, nil, fmt.Errorf("%w: kata sandi ACS tidak didukung modem", ErrNotSupportedConfig)
		}
		if d["UserPassword"] != b64(want.ACSPassword) {
			val["UserPassword"] = want.ACSPassword
			mark("Password")
		}
	}

	val["PeriodicInformEnable"] = d["PeriodicInformEnable"]
	val["PeriodicInformInterval"] = d["PeriodicInformInterval"]
	if want.InformInterval > 0 {
		if want.InformInterval > 42949672 {
			return nil, nil, fmt.Errorf("%w: interval terlalu besar", ErrNotSupportedConfig)
		}
		if d["PeriodicInformEnable"] != "1" {
			mark("PeriodicInformEnable")
		}
		val["PeriodicInformEnable"] = "1"
		iv := strconv.Itoa(want.InformInterval)
		if d["PeriodicInformInterval"] != iv {
			mark("PeriodicInformInterval")
		}
		val["PeriodicInformInterval"] = iv
	}

	val["ConnectionRequestUsername"] = d["ConnectionRequestUsername"]
	val["ConnectionRequestPassword"] = "NULL"
	if cr.Username != "" {
		val["ConnectionRequestUsername"] = cr.Username
	}
	if cr.Password != "" {
		val["ConnectionRequestPassword"] = cr.Password
	}
	val["SupportCertAuth"] = d["SupportCertAuth"]

	if len(changed) == 0 && cr == (ggcCR{}) {
		return nil, nil, nil
	}
	for _, name := range ggcTR069Fields {
		v, ok := val[name]
		if !ok {
			v = d[name] // field di luar TR069_PARA: dibawa apa adanya dari data halaman
		}
		rows = append(rows, [2]string{name, v})
	}
	rows = append(rows, [2]string{"_SESSION_TOKEN", p.Token})
	return rows, changed, nil
}

// ---------------------------------------------------------------------------
// Status lapor ke ITMS (Diagnosis > Inform)
// ---------------------------------------------------------------------------

// ggcInformText: arti InfoStat/InfoDesc di halaman manager_act_inform_t.gch (dibaca dari skripnya).
func ggcInformText(stat, desc string) string {
	switch stat {
	case "0":
		return map[string]string{
			"0": "Unreported (Terminal is starting)",
			"1": "Unreported",
			"2": "Unreported (No Wan Connection for TR069)",
			"3": "Unreported (The Wan Connection for ITMS doesn't work)",
			"4": "Unreported (No DNS information)",
			"5": "Unreported (None ACS Configuration)",
		}[desc]
	case "1":
		return "Reporting TR069 Inform"
	case "2":
		return map[string]string{
			"6": "No Response (from ACS)",
			"7": "Interrupted",
			"8": "Authentication Failure",
			"9": "Unreported (Failed to analyze ACS Domain Name)",
		}[desc]
	case "3":
		return "Succeed to report"
	}
	return ""
}

// parseGGCInform mengembalikan teks status dan apakah modem sudah berhasil melapor.
func parseGGCInform(page []byte) (text string, reported, ok bool) {
	data := map[string]string{}
	for _, m := range ggcMeaning.FindAllStringSubmatch(string(page), -1) {
		data[m[1]] = ggcUnescape(m[2])
	}
	stat, hasStat := data["InfoStat"]
	if !hasStat {
		return "", false, false
	}
	return ggcInformText(stat, data["InfoDesc"]), stat == "3", true
}

// ggcStatusPolls/ggcStatusGap: modem butuh beberapa detik menilai ulang statusnya sesudah ACS diganti.
var (
	ggcStatusPolls = 3
	ggcStatusGap   = 2 * time.Second
)

func (c *GGCLinkClient) informStatus(ctx context.Context) (text string, reported bool) {
	for i := 0; i < ggcStatusPolls; i++ {
		if i > 0 {
			select {
			case <-ctx.Done():
				return text, reported
			case <-time.After(ggcStatusGap):
			}
		}
		page, err := c.page(ctx, "manager_act_inform_t.gch")
		if err != nil {
			return text, reported
		}
		t, rep, ok := parseGGCInform(page)
		if !ok {
			return text, reported
		}
		text, reported = t, rep
		if reported || !strings.Contains(text, "starting") {
			break
		}
	}
	return text, reported
}

// ApplyTR069 memeriksa model, login, mengisi menu TR-069 (hanya bila ada yang berbeda), membaca
// ulang untuk memastikan, lalu membaca status lapor modem. Selalu logout. WAN tidak diubah.
func (c *GGCLinkClient) ApplyTR069(ctx context.Context, username, password string, want Settings) (Result, error) {
	if strings.TrimSpace(want.ACSURL) == "" {
		return Result{}, errors.New("ontweb: ACS URL kosong")
	}
	if err := c.checkModel(ctx); err != nil {
		return Result{}, err
	}
	if err := c.login(ctx, username, password); err != nil {
		return Result{}, err
	}
	defer c.logout()

	body, err := c.page(ctx, "net_tr069_basic_t.gch")
	if err != nil {
		return Result{}, err
	}
	cur, err := parseGGCTR069(body)
	if err != nil {
		return Result{}, err
	}
	rows, changed, err := planGGCTR069(cur, want, ggcCR{})
	if err != nil {
		return Result{}, err
	}
	res := Result{TR069Enable: true}
	if rows != nil {
		_, _, _, postErr := c.postForm(ctx, "/getpage.gch?pid=1002&nextpage=net_tr069_basic_t.gch", c.lastURL, rows)
		if postErr != nil && !errors.Is(postErr, ErrUnreachable) {
			return Result{}, postErr
		}
		// Terputus sesudah mengirim bukan penolakan: baca ulang untuk memastikan.
		after, err := c.page(ctx, "net_tr069_basic_t.gch")
		if err != nil {
			if postErr != nil {
				return Result{}, postErr
			}
			return Result{}, err
		}
		now, err := parseGGCTR069(after)
		if err != nil {
			return Result{}, err
		}
		if now.Data["URL"] != want.ACSURL {
			return Result{}, ErrNotApplied
		}
		if want.InformInterval > 0 && now.Data["PeriodicInformInterval"] != strconv.Itoa(want.InformInterval) {
			return Result{}, ErrNotApplied
		}
		res.Changed, res.Fields = true, changed
		cur = now
	}
	res.ACSURL = cur.Data["URL"]

	if want.EnsureWAN {
		res.WANChanged, res.WANNote = c.ensureTR069WAN(ctx)
	}
	text, reported := c.informStatus(ctx)
	res.ACSStatus = text
	res.Informing = reported
	if !want.EnsureWAN && strings.Contains(text, "No Wan Connection for TR069") {
		res.WANNote = "Modem melaporkan tidak ada WAN pembawa TR-069. Aktifkan opsi memastikan WAN TR-069: aplikasi menambahkan WAN baru (DHCP, tanpa VLAN) tanpa mengubah WAN pelanggan."
	}
	return res, nil
}
