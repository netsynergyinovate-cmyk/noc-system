package ontweb

// Klien halaman web admin ZTE F609 versi MediaTek (dilaporkan OLT sebagai "MTKc F609"): server Boa, halaman
// `/cgi-bin/*.asp` sekeluarga ZIMLINK ZL-2113X, tetapi login-nya berbeda. Protokolnya dibaca dari halaman modem
// itu sendiri dan DIBUKTIKAN dengan peramban asli (permintaan dibatalkan sebelum sampai ke modem); fixture di
// testdata/f609:
//
//	GET  /cgi-bin/index2.asp          halaman login; `var rand = "…"` acak per pemuatan
//	POST /cgi-bin/check_auth.json     Username=U&Logoff=0&hLoginTimes=0&hLoginTimes_Zero=0&value_one=1&Password1=
//	                                  &Password2=&logintype=usr&LoginFailTime=0&hLoginFailTime=0&Password=md5(sandi+rand)
//	                                  dengan cookie loginTimes=0; LoginFailTime=0 (dipasang halaman sebelum mengirim; tanpanya
//	                                  modem menjawab Privilege 0). Jawab JSON {Locked, Logged, Privilege, ecntToken}; ecntToken
//	                                  menjadi cookie
//	GET  /cgi-bin/content.asp         kerangka
//	GET  /cgi-bin/net-tr069.asp       HTML dengan formulir ConfigForm (nilai sekarang)
//	POST /cgi-bin/net-tr069.asp       formulir yang sama dengan SaveFlag=1, cookie EBOOVALUE=crc32(nama+nilai semua
//	                                  field, hex huruf kecil): halaman memasangnya sebelum submit (setEBooValueCookie)
//	GET  /cgi-bin/sta-acs.asp         status CWMP (kode sama dengan ZIMLINK)
//	GET  /cgi-bin/logout.cgi
//
// WAN pelanggan TIDAK pernah diubah; dengan EnsureWAN WAN BARU bertipe TR069 (DHCP, tanpa VLAN) ditambahkan lewat
// net-wanset.asp (f609_wan.go).

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

var (
	f609Rand    = regexp.MustCompile(`var\s+rand\s*=\s*"([0-9A-Za-z]{4,32})"`)
	f609Marker1 = "/cgi-bin/check_auth.json"
	f609Marker2 = "/JS/encryption.js"
)

// IsF609LoginPage: halaman login terbuka tanpa kredensial berformulir check_auth.json dengan rand dan encryption.js.
func IsF609LoginPage(body []byte) bool {
	s := string(body)
	return strings.Contains(s, f609Marker1) && strings.Contains(s, f609Marker2) && f609Rand.MatchString(s)
}

// F609Client memanggil satu modem ZTE F609 (MediaTek).
type F609Client struct {
	BaseURL string
	HTTP    *http.Client
	cookies map[string]string
}

func NewF609Client(baseURL string, timeout time.Duration) *F609Client {
	return &F609Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		cookies: map[string]string{},
	}
}

func (c *F609Client) cookieHeader(extra map[string]string) string {
	var parts []string
	for _, k := range []string{"ecntToken", "LOGFLAG", "LoginFailTime"} {
		if v, ok := c.cookies[k]; ok {
			parts = append(parts, k+"="+v)
		}
	}
	for k, v := range extra {
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, "; ")
}

func (c *F609Client) do(req *http.Request) (*http.Response, []byte, error) {
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %w", ErrUnreachable, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		return nil, nil, fmt.Errorf("%w: baca jawaban: %w", ErrUnreachable, err)
	}
	for _, ck := range res.Cookies() {
		c.cookies[ck.Name] = ck.Value
	}
	if res.StatusCode >= 400 {
		return res, data, fmt.Errorf("%w: HTTP %d", ErrUnexpected, res.StatusCode)
	}
	return res, data, nil
}

func (c *F609Client) get(ctx context.Context, path, referer string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	if referer != "" {
		req.Header.Set("Referer", c.BaseURL+referer)
	}
	if ck := c.cookieHeader(nil); ck != "" {
		req.Header.Set("Cookie", ck)
	}
	_, body, err := c.do(req)
	return body, err
}

// checkModel: halaman login terbuka tanpa kredensial; menolak perangkat yang bukan keluarga ini.
func (c *F609Client) checkModel(ctx context.Context) error {
	body, err := c.get(ctx, "/cgi-bin/index2.asp", "")
	if err != nil {
		if errors.Is(err, ErrUnexpected) {
			return fmt.Errorf("%w: tidak menjawab seperti web admin modem", ErrWrongDevice)
		}
		return err
	}
	if !IsF609LoginPage(body) {
		return fmt.Errorf("%w (bukan ZTE F609 MediaTek)", ErrWrongDevice)
	}
	return nil
}

// f609Hash meniru encryption(): md5(sandi + rand) dalam hex huruf kecil.
func f609Hash(password, rand string) string {
	sum := md5.Sum([]byte(password + rand))
	return hex.EncodeToString(sum[:])
}

type f609AuthResult struct {
	Locked    json.RawMessage `json:"Locked"`
	Logged    json.RawMessage `json:"Logged"`
	Privilege json.RawMessage `json:"Privilege"`
	EcntToken string          `json:"ecntToken"`
}

// asStr membaca nilai JSON yang bisa berupa string atau angka ("1" atau 1).
func asStr(r json.RawMessage) string {
	s := strings.TrimSpace(string(r))
	return strings.Trim(s, `"`)
}

// login meniru doLogin(). Tanpa percobaan ulang: halaman mengunci 1 menit setelah 3 kali salah.
func (c *F609Client) login(ctx context.Context, username, password string) error {
	if username == "" || password == "" {
		return errors.New("ontweb: nama pengguna/kata sandi modem kosong")
	}
	if len(username) > 64 || len(password) > 64 {
		return fmt.Errorf("%w: kredensial terlalu panjang", ErrBadCredentials)
	}
	page, err := c.get(ctx, "/cgi-bin/index2.asp", "")
	if err != nil {
		return err
	}
	m := f609Rand.FindSubmatch(page)
	if m == nil {
		return fmt.Errorf("%w: login tanpa rand", ErrUnexpected)
	}
	rows := [][2]string{
		{"Username", username}, {"Logoff", "0"}, {"hLoginTimes", "0"}, {"hLoginTimes_Zero", "0"}, {"value_one", "1"},
		{"Password1", ""}, {"Password2", ""}, {"logintype", "usr"}, {"LoginFailTime", "0"}, {"hLoginFailTime", "0"},
		{"Password", f609Hash(password, string(m[1]))},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/cgi-bin/check_auth.json", strings.NewReader(encodeFormRows(rows)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
	req.Header.Set("Referer", c.BaseURL+"/cgi-bin/index2.asp")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	// doLogin() memasang dua cookie ini SEBELUM mengirim; tanpa keduanya modem menjawab Privilege 0 untuk
	// kata sandi yang benar (diukur di F609 asli).
	req.Header.Set("Cookie", "loginTimes=0; LoginFailTime=0")
	req.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")
	_, body, err := c.do(req)
	if err != nil {
		return err
	}
	var res f609AuthResult
	if err := json.Unmarshal(body, &res); err != nil {
		return fmt.Errorf("%w: jawaban login bukan JSON", ErrUnexpected)
	}
	switch {
	case asStr(res.Locked) == "1":
		return ErrLocked
	case asStr(res.Logged) == "1" || asStr(res.Logged) == "2":
		return ErrSessionBusy
	case asStr(res.Privilege) == "1" || asStr(res.Privilege) == "2":
		if res.EcntToken == "" {
			return fmt.Errorf("%w: login berhasil tanpa token", ErrUnexpected)
		}
		c.cookies["ecntToken"] = res.EcntToken
		// Peramban membuka kerangka halaman sesudah login.
		if _, err := c.get(ctx, "/cgi-bin/content.asp", "/cgi-bin/index2.asp"); err != nil {
			return err
		}
		return nil
	case asStr(res.Privilege) == "0":
		return ErrBadCredentials
	}
	// Gagal tertutup: jawaban yang tidak dikenal bukan tanda sukses.
	return fmt.Errorf("%w: jawaban login tidak dikenal", ErrUnexpected)
}

func (c *F609Client) logout() {
	if c.cookies["ecntToken"] == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = c.get(ctx, "/cgi-bin/logout.cgi", "/cgi-bin/content.asp")
	delete(c.cookies, "ecntToken")
}

// crc32JS meniru crc32() halaman: CRC-32 IEEE atas kode karakter (hanya 8 bit rendah tiap unit UTF-16 yang
// dipakai oleh skrip aslinya), hasil hex huruf kecil tanpa nol di depan.
func crc32JS(s string) string {
	var table [256]uint32
	for i := range table {
		c := uint32(i)
		for k := 0; k < 8; k++ {
			if c&1 == 1 {
				c = 0xEDB88320 ^ (c >> 1)
			} else {
				c >>= 1
			}
		}
		table[i] = c
	}
	crc := uint32(0xFFFFFFFF)
	for _, u := range utf16.Encode([]rune(s)) {
		crc = (crc >> 8) ^ table[(crc^uint32(u))&0xFF]
	}
	return strconv.FormatUint(uint64(crc^0xFFFFFFFF), 16)
}

// ebooValue: isi cookie EBOOVALUE untuk satu pengiriman formulir (setEBooValueCookie).
func ebooValue(rows [][2]string) string {
	var sb strings.Builder
	for _, r := range rows {
		sb.WriteString(r[0])
		sb.WriteString(r[1])
	}
	return crc32JS(sb.String())
}

// postCookieForm mengirim formulir halaman menu seperti peramban: cookie sesi + EBOOVALUE (CRC isi formulir).
func (c *F609Client) postCookieForm(ctx context.Context, path string, rows [][2]string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, strings.NewReader(encodeFormRows(rows)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", c.BaseURL+path)
	req.Header.Set("Origin", c.BaseURL)
	req.Header.Set("Cookie", c.cookieHeader(map[string]string{"EBOOVALUE": ebooValue(rows)}))
	_, _, err = c.do(req)
	return err
}

func (c *F609Client) postTR069(ctx context.Context, rows [][2]string) error {
	return c.postCookieForm(ctx, "/cgi-bin/net-tr069.asp", rows)
}

// f609TR069Fields: susunan field formulir yang sudah DIBUKTIKAN (urutan DOM = urutan yang dikirim peramban).
var f609TR069Fields = []string{
	"Tr069Enable", "EnTr069Flag", "ActiveCwmpFlag", "isMidwareSupported", "MiddlewareAddress", "MiddlewarePort",
	"PeriodicInformEnable", "PeriodicInformInterval", "PeriodicInformTime", "URL", "Username", "Password",
	"ConnectionRequestUsername", "ConnectionRequestPassword", "X_ATP_SSLCertEnable", "SaveFlag",
}

// checkF609Fields menolak susunan formulir yang berbeda dari yang terverifikasi (firmware lain).
func checkF609Fields(fields []formField) error {
	rows := serializeForm(fields, nil)
	got := make([]string, len(rows))
	for i, r := range rows {
		got[i] = r[0]
	}
	if strings.Join(got, ",") != strings.Join(f609TR069Fields, ",") {
		return fmt.Errorf("%w: susunan formulir TR-069 berbeda dari yang terverifikasi", ErrNotSupportedConfig)
	}
	return nil
}

func (c *F609Client) acsStatus(ctx context.Context) (code, text string) {
	page, err := c.get(ctx, "/cgi-bin/sta-acs.asp", "/cgi-bin/content.asp")
	if err != nil {
		return "", ""
	}
	code, text, _ = parseACSStatus(page)
	return code, text
}

// ApplyTR069 memeriksa model, login, mengisi menu TR-069 (hanya bila ada yang berbeda), membaca ulang untuk
// memastikan, lalu membaca status lapor. Selalu logout. WAN tidak diubah.
func (c *F609Client) ApplyTR069(ctx context.Context, username, password string, want Settings) (Result, error) {
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
	if err := checkF609Fields(fields); err != nil {
		return Result{}, err
	}
	rows, changed, err := planTR069(fields, want)
	if err != nil {
		return Result{}, err
	}
	res := Result{TR069Enable: true}
	if rows != nil {
		postErr := c.postTR069(ctx, rows)
		if postErr != nil && !errors.Is(postErr, ErrUnreachable) {
			return Result{}, postErr
		}
		// Terputus sesudah mengirim bukan penolakan: baca ulang untuk memastikan.
		after, err := c.get(ctx, "/cgi-bin/net-tr069.asp", "/cgi-bin/content.asp")
		if err != nil {
			if postErr != nil {
				return Result{}, postErr
			}
			return Result{}, err
		}
		afterFields, err := parseFormFields(after)
		if err != nil {
			return Result{}, err
		}
		if got, _ := effective(afterFields, "URL"); got != want.ACSURL {
			return Result{}, ErrNotApplied
		}
		if want.InformInterval > 0 {
			if got, _ := effective(afterFields, "PeriodicInformInterval"); got != strconv.Itoa(want.InformInterval) {
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
	if !want.EnsureWAN && (code == "1" || code == "2") {
		res.WANNote = "Modem melaporkan tidak ada WAN pembawa TR-069. Aktifkan opsi memastikan WAN TR-069: aplikasi menambahkan WAN baru (DHCP, tanpa VLAN) tanpa mengubah WAN pelanggan."
	}
	return res, nil
}
