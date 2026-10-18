package ontweb

// Klien halaman web admin ZIMLINK ZL-2113X (dilaporkan OLT sebagai "HWTC H113"): server Boa,
// bukan JSON API seperti FD511GW. Protokolnya dibaca dari halaman modem itu sendiri dan
// DIBUKTIKAN dengan menangkap isi formulir yang dikirim halaman asli (permintaan dibatalkan
// sebelum sampai ke modem), lalu dicocokkan byte demi byte dengan keluaran kode ini lewat
// fixture di testdata/zl2113x:
//
//	POST /cgi-bin/index2.asp   form Username/Password/... + cookie SESSIONID/UID/PSW  (login)
//	GET  /cgi-bin/net-tr069.asp  HTML dengan formulir ConfigForm (nilai sekarang)
//	POST /cgi-bin/net-tr069.asp  formulir yang sama dengan SaveFlag=1
//	GET  /cgi-bin/sta-acs.asp    status CWMP ("Reported successfully" = kode 8)
//	GET  /cgi-bin/get_node_foreach_info.json?param1=waninfo_wanif&param2=NULL  (data WAN)
//	POST /cgi-bin/net-wanset.asp formulir WAN (lihat zimlink_wan.go)
//	GET  /cgi-bin/logout.cgi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ErrNotSupportedConfig: modem dikenali tetapi konfigurasinya di luar yang sudah terverifikasi.
var ErrNotSupportedConfig = errors.New("ontweb: konfigurasi modem di luar yang terverifikasi")

var zlModel = regexp.MustCompile(`RES_TITLE_NAME\s*=\s*"(ZL-2113[A-Za-z0-9]*)"`)

// IsZimlinkLoginPage: halaman login terbuka tanpa kredensial dan memuat nama model di skripnya.
func IsZimlinkLoginPage(body []byte) (model string, ok bool) {
	m := zlModel.FindSubmatch(body)
	if m == nil {
		return "", false
	}
	return string(m[1]), true
}

// ZimlinkClient memanggil satu modem ZL-2113X.
type ZimlinkClient struct {
	BaseURL string
	HTTP    *http.Client
	cookie  string
}

func NewZimlinkClient(baseURL string, timeout time.Duration) *ZimlinkClient {
	return &ZimlinkClient{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// jsEscape meniru escape() JavaScript: halaman login memasang sandi di cookie PSW lewat fungsi itu.
func jsEscape(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9', strings.ContainsRune("@*_+-./", r):
			b.WriteRune(r)
		case r < 256:
			fmt.Fprintf(&b, "%%%02X", r)
		default:
			fmt.Fprintf(&b, "%%u%04X", r)
		}
	}
	return b.String()
}

func (c *ZimlinkClient) do(req *http.Request) ([]byte, error) {
	if c.cookie != "" {
		req.Header.Set("Cookie", c.cookie)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUnreachable, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		// Putus atau timeout di tengah jawaban = koneksi terputus, BUKAN jawaban yang aneh: modem
		// yang menyambung ulang PPPoE memutus koneksi sebelum selesai menjawab.
		return nil, fmt.Errorf("%w: baca jawaban: %w", ErrUnreachable, err)
	}
	if res.StatusCode == http.StatusUnauthorized {
		return data, fmt.Errorf("%w: sesi ditolak (HTTP 401)", ErrUnexpected)
	}
	if res.StatusCode >= 400 {
		return data, fmt.Errorf("%w: HTTP %d", ErrUnexpected, res.StatusCode)
	}
	return data, nil
}

func (c *ZimlinkClient) get(ctx context.Context, path, referer string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	if referer != "" {
		req.Header.Set("Referer", c.BaseURL+referer)
	}
	return c.do(req)
}

func (c *ZimlinkClient) postForm(ctx context.Context, path, referer string, rows [][2]string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, strings.NewReader(encodeFormRows(rows)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", c.BaseURL+referer)
	return c.do(req)
}

// encodeFormRows: application/x-www-form-urlencoded dengan URUTAN field dipertahankan (url.Values
// mengurutkan kunci; halaman asli mengirim sesuai urutan formulir).
func encodeFormRows(rows [][2]string) string {
	parts := make([]string, len(rows))
	for i, r := range rows {
		parts[i] = url.QueryEscape(r[0]) + "=" + url.QueryEscape(r[1])
	}
	return strings.Join(parts, "&")
}

// checkModel membaca halaman login (tanpa kredensial) dan menolak perangkat yang bukan ZL-2113X.
func (c *ZimlinkClient) checkModel(ctx context.Context) error {
	body, err := c.get(ctx, "/cgi-bin/index2.asp", "")
	if err != nil {
		if errors.Is(err, ErrUnexpected) {
			return fmt.Errorf("%w: tidak menjawab seperti web admin modem", ErrWrongDevice)
		}
		return err
	}
	if _, ok := IsZimlinkLoginPage(body); !ok {
		return fmt.Errorf("%w (bukan ZIMLINK ZL-2113X)", ErrWrongDevice)
	}
	return nil
}

var (
	zlLoginOK   = regexp.MustCompile(`userPSWST\(1\)\s*;\s*gotomain_set\(\)\s*;`)
	zlLoginBusy = regexp.MustCompile(`userlogin\(\s*[12]\s*\)\s*;`)
)

// login meniru SubmitForm() halaman: cookie SESSIONID/UID/PSW lalu formulir ke index2.asp.
// Tanpa percobaan ulang: halaman mengunci 1 menit setelah 3 kali salah.
func (c *ZimlinkClient) login(ctx context.Context, username, password string) error {
	if username == "" || password == "" {
		return errors.New("ontweb: nama pengguna/kata sandi modem kosong")
	}
	if len(username) > 30 || len(password) > 30 {
		return fmt.Errorf("%w: halaman login membatasi 30 karakter", ErrBadCredentials)
	}
	raw := make([]byte, 4)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	c.cookie = "SESSIONID=boasid" + hex.EncodeToString(raw) + "; UID=" + username + "; PSW=" + jsEscape(password) + "; LoginTimes=1"
	body, err := c.postForm(ctx, "/cgi-bin/index2.asp", "/cgi-bin/index2.asp", [][2]string{
		{"Username", username}, {"Password", password}, {"Logoff", "0"}, {"hLoginTimes", "1"},
		{"hLoginTimes_Zero", "0"}, {"value_one", "1"}, {"Password1", password}, {"Password2", password},
		{"logintype", "usr"}, {"Language_Flag", "0"},
	})
	if err != nil {
		c.cookie = ""
		return err
	}
	switch {
	case zlLoginBusy.Match(body):
		c.cookie = ""
		return ErrSessionBusy
	case zlLoginOK.Match(body):
		// Halaman asli membuang cookie LoginTimes begitu login berhasil (rmCookie); bila ikut
		// terkirim di permintaan berikutnya modem menjawab 401 (dialami di ZL-2113X asli).
		c.cookie = "SESSIONID=boasid" + hex.EncodeToString(raw) + "; UID=" + username + "; PSW=" + jsEscape(password)
		// Peramban selalu membuka content.asp (kerangka) setelah login; sesi baru dianggap sah
		// sesudah itu.
		if _, err := c.get(ctx, "/cgi-bin/content.asp", "/cgi-bin/index2.asp"); err != nil {
			c.cookie = ""
			return err
		}
		return nil
	default:
		// Gagal tertutup: apa pun selain tanda sukses dianggap kredensial ditolak.
		c.cookie = ""
		return ErrBadCredentials
	}
}

func (c *ZimlinkClient) logout() {
	if c.cookie == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = c.get(ctx, "/cgi-bin/logout.cgi", "/cgi-bin/content.asp")
	c.cookie = ""
}

// ---------------------------------------------------------------------------
// Formulir HTML (halaman TR-069)
// ---------------------------------------------------------------------------

type formField struct {
	Name, Type, Value string
	Checked           bool
}

var (
	zlScript  = regexp.MustCompile(`(?is)<script\b.*?</script>`)
	zlComment = regexp.MustCompile(`(?s)<!--.*?-->`)
	zlForm    = regexp.MustCompile(`(?is)<form\b[^>]*\bname\s*=\s*"?ConfigForm"?[^>]*>(.*?)</form>`)
	zlInput   = regexp.MustCompile(`(?is)<input\b([^>]*)>`)
	zlAttr    = regexp.MustCompile(`(?is)([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?`)
)

// parseFormFields mengurai <input> di dalam <form name="ConfigForm"> menurut urutan dokumen.
// Blok <script> dibuang dulu: di dalamnya ada string HTML yang bukan bagian formulir.
func parseFormFields(page []byte) ([]formField, error) {
	// Komentar HTML tidak dikirim peramban (halaman F609 menyimpan input lama di dalam komentar).
	text := zlScript.ReplaceAllString(zlComment.ReplaceAllString(string(page), ""), "")
	m := zlForm.FindStringSubmatch(text)
	if m == nil {
		return nil, fmt.Errorf("%w: formulir ConfigForm tidak ditemukan", ErrUnexpected)
	}
	var out []formField
	for _, in := range zlInput.FindAllStringSubmatch(m[1], -1) {
		f := formField{Type: "text"}
		for _, a := range zlAttr.FindAllStringSubmatch(in[1], -1) {
			key := strings.ToLower(a[1])
			val := strings.Trim(a[2], `"'`)
			switch key {
			case "name":
				f.Name = val
			case "type":
				f.Type = strings.ToLower(val)
			case "value":
				f.Value = html.UnescapeString(val)
			case "checked":
				f.Checked = true
			}
		}
		if f.Name != "" {
			out = append(out, f)
		}
	}
	return out, nil
}

// serializeForm: yang dikirim peramban untuk submit. Radio/checkbox hanya bila dicentang;
// tombol, berkas, dan reset tidak ikut.
func serializeForm(fields []formField, override map[string]string) [][2]string {
	var rows [][2]string
	for _, f := range fields {
		switch f.Type {
		case "button", "submit", "reset", "file", "image":
			continue
		case "radio", "checkbox":
			if !f.Checked {
				continue
			}
		}
		v := f.Value
		if o, ok := override[f.Name]; ok {
			v = o
		}
		rows = append(rows, [2]string{f.Name, v})
	}
	return rows
}

// effective: nilai yang akan dikirim untuk nama itu (radio: yang dicentang).
func effective(fields []formField, name string) (string, bool) {
	for _, f := range fields {
		if f.Name != name {
			continue
		}
		if (f.Type == "radio" || f.Type == "checkbox") && !f.Checked {
			continue
		}
		return f.Value, true
	}
	return "", false
}

var (
	zlSafeURL   = regexp.MustCompile(`^https?://[A-Za-z0-9:/\-._]+$`)
	zlSafeCreds = regexp.MustCompile(`^[A-Za-z0-9._@\-]{1,64}$`)
)

// planTR069 menyusun isi formulir TR-069 dan daftar field yang berubah. Aturan validasi sama
// dengan CheckForm() halaman: karakter URL, bilangan bulat untuk interval.
func planTR069(fields []formField, want Settings) (rows [][2]string, changed []string, err error) {
	if !zlSafeURL.MatchString(want.ACSURL) {
		return nil, nil, fmt.Errorf("%w: ACS URL hanya boleh huruf, angka dan : / - . _ (diawali http:// atau https://)", ErrNotSupportedConfig)
	}
	override := map[string]string{}
	set := func(name, value, label string) {
		cur, _ := effective(fields, name)
		if cur != value {
			changed = append(changed, label)
		}
		override[name] = value
	}
	set("URL", want.ACSURL, "URL")
	if want.ACSUsername != "" {
		if !zlSafeCreds.MatchString(want.ACSUsername) {
			return nil, nil, fmt.Errorf("%w: nama pengguna ACS tidak didukung modem", ErrNotSupportedConfig)
		}
		set("Username", want.ACSUsername, "Username")
	}
	if want.ACSPassword != "" {
		if !zlSafeCreds.MatchString(want.ACSPassword) {
			return nil, nil, fmt.Errorf("%w: kata sandi ACS tidak didukung modem", ErrNotSupportedConfig)
		}
		set("Password", want.ACSPassword, "Password")
	}
	if want.InformInterval > 0 {
		if want.InformInterval > 2147483647 {
			return nil, nil, fmt.Errorf("%w: interval terlalu besar", ErrNotSupportedConfig)
		}
		set("PeriodicInformEnable", "Yes", "PeriodicInformEnable")
		set("PeriodicInformInterval", strconv.Itoa(want.InformInterval), "PeriodicInformInterval")
	}
	if len(changed) == 0 {
		return nil, nil, nil
	}
	override["SaveFlag"] = "1"
	return serializeForm(fields, override), changed, nil
}

// acsStatusText: arti kode "Inform Status" di halaman sta-acs.asp.
var acsStatusText = map[string]string{
	"0": "Unreported (E-home terminal is starting)",
	"1": "Unreported (No remote management WAN connection)",
	"2": "Unreported (Remote management WAN connection is not valid)",
	"3": "Unreported (No management channel DNS information)",
	"4": "Unreported (No ACS configuration parameters)",
	"5": "Unreported (ACS domain parsed failed)",
	"6": "Reported no response",
	"7": "Reporting process interrupt",
	"8": "Reported successfully",
}

var zlInformResult = regexp.MustCompile(`(?s)Inform Status.*?var\s+result\s*=\s*"(\d)"`)

// parseACSStatus mengembalikan kode dan teksnya; ok=false bila halaman tidak dikenali.
func parseACSStatus(page []byte) (code, text string, ok bool) {
	m := zlInformResult.FindSubmatch(page)
	if m == nil {
		return "", "", false
	}
	code = string(m[1])
	return code, acsStatusText[code], true
}

func (c *ZimlinkClient) acsStatus(ctx context.Context) (code, text string) {
	page, err := c.get(ctx, "/cgi-bin/sta-acs.asp", "/cgi-bin/content.asp")
	if err != nil {
		return "", ""
	}
	code, text, _ = parseACSStatus(page)
	return code, text
}

// ApplyTR069 memeriksa model, login, mengisi menu TR-069 (hanya bila ada yang berbeda), membaca
// ulang untuk memastikan, dan bila diminta memastikan ada WAN pembawa TR-069. Selalu logout.
func (c *ZimlinkClient) ApplyTR069(ctx context.Context, username, password string, want Settings) (Result, error) {
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

	page, err := c.get(ctx, "/cgi-bin/net-tr069.asp", "/cgi-bin/content.asp")
	if err != nil {
		return Result{}, err
	}
	fields, err := parseFormFields(page)
	if err != nil {
		return Result{}, err
	}
	rows, changed, err := planTR069(fields, want)
	if err != nil {
		return Result{}, err
	}
	res := Result{TR069Enable: true}
	if rows != nil {
		if _, err := c.postForm(ctx, "/cgi-bin/net-tr069.asp", "/cgi-bin/net-tr069.asp", rows); err != nil {
			return Result{}, err
		}
		after, err := c.get(ctx, "/cgi-bin/net-tr069.asp", "/cgi-bin/content.asp")
		if err != nil {
			return Result{}, err
		}
		afterFields, err := parseFormFields(after)
		if err != nil {
			return Result{}, err
		}
		for _, name := range []string{"URL", "PeriodicInformInterval"} {
			wantV := map[string]string{"URL": want.ACSURL, "PeriodicInformInterval": strconv.Itoa(want.InformInterval)}[name]
			if name == "PeriodicInformInterval" && want.InformInterval == 0 {
				continue
			}
			if got, _ := effective(afterFields, name); got != wantV {
				return Result{}, ErrNotApplied
			}
		}
		res.Changed, res.Fields = true, changed
		fields = afterFields
	}
	res.ACSURL, _ = effective(fields, "URL")

	if want.EnsureWAN {
		res.WANChanged, res.WANNote = c.ensureTR069WAN(ctx)
	}
	code, text := c.acsStatus(ctx)
	res.ACSStatus = text
	res.Informing = code == "8"
	return res, nil
}
