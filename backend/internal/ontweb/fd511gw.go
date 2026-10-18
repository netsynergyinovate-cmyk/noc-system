// Package ontweb mengatur modem (ONT) lewat halaman web admin-nya, bukan lewat
// OLT atau TR-069. Dipakai satu tujuan: memasang alamat ACS (GenieACS) di menu
// TR-069 modem yang belum pernah menghubungi ACS, sama seperti teknisi yang
// login ke halaman web modem lalu mengisi Settings > TR-069.
//
// Protokolnya dibaca dari JavaScript halaman "ONU Web Management System" milik
// CDTC FD511GW (firmware 1.0.0.2) dan dicek lewat tes terhadap ONT palsu:
//
//	POST /post.json {"module":"login","username":U,"encryPassword":md5hex(P)}
//	     -> {"code":0,"token":"..."}; token dikirim sebagai header Authorization
//	GET  /get.json?module=tr069_config  -> bentuk pengaturan sekarang
//	POST /post.json {"module":"tr069_config", ...hanya bagian yang berubah}
//	POST /post.json {"module":"logout"}
//
// Kesalahan kredensial TIDAK pernah diulang: modem menghitung salah sandi dan
// mengunci login setelah 3 kali.
package ontweb

import (
	"bytes"
	"context"
	"crypto/md5" //nolint:gosec // bukan keamanan: modem sendiri mewajibkan md5 hex sebagai "encryPassword"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Galat yang dibedakan supaya UI bisa memberi saran yang tepat.
var (
	ErrBadCredentials = errors.New("ontweb: nama pengguna atau kata sandi modem salah")
	ErrSessionBusy    = errors.New("ontweb: modem menolak sesi baru (ada sesi lain atau batas login tercapai)")
	ErrLocked         = errors.New("ontweb: login modem terkunci")
	ErrUnexpected     = errors.New("ontweb: jawaban modem tidak sesuai dugaan")
	// ErrUnreachable: tidak ada jawaban sama sekali (putus, timeout). Sesudah
	// mengubah WAN itu BUKAN penolakan: modem menyambung ulang PPPoE dan
	// memutus koneksi yang sedang berjalan, sering kali SESUDAH perubahan masuk.
	ErrUnreachable = errors.New("ontweb: modem tidak terjangkau")
	// ErrWrongDevice: alamat itu menjawab, tetapi bukan web admin FD511GW. Kredensial
	// TIDAK dikirim: bisa jadi perangkat milik pelanggan lain atau merek lain.
	ErrWrongDevice = errors.New("ontweb: perangkat di alamat itu bukan FD511GW")
	ErrNotApplied  = errors.New("ontweb: modem menerima perintah tetapi pengaturan tidak berubah")
)

// Kode galat dari modem (lihat halaman login-nya).
const (
	codeOK            = 0
	codeBadUser       = 10001
	codeBadPassword   = 10002
	codeOtherLogin    = 10003
	codeTooManyLogins = 10004
	codeLocked        = 10005
)

const maxBody = 1 << 20 // jawaban modem jauh lebih kecil; batas melindungi memori

// Settings adalah isi menu TR-069 yang dipasang. Field kosong tidak disentuh.
type Settings struct {
	ACSURL         string
	ACSUsername    string
	ACSPassword    string
	InformInterval int // detik; 0 = jangan ubah

	// EnsureWAN: modem hanya melapor ke ACS lewat WAN yang bertipe TR069 (mis.
	// "TR069_INTERNET"). Bila tak satu pun WAN membawa TR-069 dan ada TEPAT satu
	// WAN INTERNET, tipenya diubah (PPPoE tersambung ulang beberapa detik).
	EnsureWAN bool
}

// Result menjelaskan apa yang terjadi, tanpa membawa kata sandi apa pun.
type Result struct {
	Changed     bool     // false: modem sudah berisi pengaturan ini, tidak ada yang ditulis
	Fields      []string // nama field yang diubah, mis. "acs.acsurl"
	ACSURL      string   // acsurl yang tersimpan di modem sesudah selesai
	Informing   bool     // sudah menghubungi ACS pada saat dicek (best effort)
	TR069Enable bool

	// ACSStatus: teks status lapor CWMP yang dilaporkan modem sendiri (hanya ZIMLINK).
	ACSStatus string

	// WAN: apa yang terjadi pada WAN (hanya bila EnsureWAN). WANChanged = tipe WAN
	// diubah; WANNote menjelaskan kasus yang butuh perhatian petugas.
	WANChanged bool
	WANNote    string
}

// NewClient membuat klien untuk satu modem. Pengalihan (redirect) tidak diikuti:
// modem yang menjawab 30x ke host lain tidak boleh membuat backend ikut pergi.
func NewClient(baseURL string, timeout time.Duration) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// Client memanggil satu modem. Aman dipakai satu goroutine per modem.
type Client struct {
	// BaseURL tanpa garis miring penutup, mis. "http://172.16.15.248".
	BaseURL string
	HTTP    *http.Client
	token   string
}

// ApplyTR069 login, membaca menu TR-069, menulis hanya bagian yang berbeda,
// membaca ulang untuk memastikan, lalu logout (selalu, agar sesi modem yang
// terbatas tidak habis).
func (c *Client) ApplyTR069(ctx context.Context, username, password string, want Settings) (Result, error) {
	if strings.TrimSpace(want.ACSURL) == "" {
		return Result{}, errors.New("ontweb: ACS URL kosong")
	}
	// Periksa dulu SEBELUM kredensial dikirim: public_info terbuka tanpa login dan
	// memuat nama model. Alamat hasil pencarian otomatis (PPPoE/MAC) bisa saja
	// menunjuk perangkat lain.
	if err := c.checkModel(ctx); err != nil {
		return Result{}, err
	}
	if err := c.login(ctx, username, password); err != nil {
		return Result{}, err
	}
	defer c.logout()

	cur, err := c.getTR069(ctx)
	if err != nil {
		return Result{}, err
	}
	res := Result{ACSURL: cur.acsURL(), TR069Enable: cur.enabled()}
	patch, fields := diff(cur, want)
	if len(patch) > 0 {
		patch["module"] = "tr069_config"
		if err := c.post(ctx, patch, nil); err != nil {
			return Result{}, err
		}
		after, err := c.getTR069(ctx)
		if err != nil {
			return Result{}, err
		}
		if after.acsURL() != want.ACSURL || !after.enabled() {
			return Result{}, ErrNotApplied
		}
		res.Changed, res.Fields, res.ACSURL, res.TR069Enable = true, fields, after.acsURL(), true
	}
	// WAN terakhir: mengubahnya menyambung ulang PPPoE, dan halaman web ini
	// dijangkau lewat WAN itu juga, jadi tidak ada yang boleh dikerjakan sesudahnya
	// selain membaca ulang yang boleh gagal.
	if want.EnsureWAN {
		res.WANChanged, res.WANNote = c.ensureTR069WAN(ctx)
	}
	res.Informing = c.informing(ctx)
	return res, nil
}

// tr069Config: bentuk jawaban get.json?module=tr069_config. Field yang tak
// dikenal dibiarkan; hanya yang dipakai di sini yang dibaca.
// supportedModel: web admin yang protokolnya dipetakan di paket ini.
var supportedModel = regexp.MustCompile(`(?i)^FD511GW`)

func (c *Client) checkModel(ctx context.Context) error {
	var info struct {
		Model string `json:"model"`
	}
	if err := c.get(ctx, "public_info", &info); err != nil {
		if errors.Is(err, ErrUnexpected) {
			return fmt.Errorf("%w: tidak menjawab seperti web admin modem", ErrWrongDevice)
		}
		return err
	}
	if !supportedModel.MatchString(strings.TrimSpace(info.Model)) {
		return fmt.Errorf("%w (model %q)", ErrWrongDevice, info.Model)
	}
	return nil
}

type tr069Config struct {
	Enable *int `json:"tr069enable"`
	ACS    struct {
		URL      string `json:"acsurl"`
		Name     string `json:"acsname"`
		Passwd   string `json:"acspasswd"`
		InformOn *int   `json:"informenable"`
		Interval *int   `json:"informinterval"`
	} `json:"acs"`
}

func (t tr069Config) enabled() bool  { return t.Enable != nil && *t.Enable == 1 }
func (t tr069Config) acsURL() string { return t.ACS.URL }

// diff membuat tubuh POST yang hanya memuat field yang berbeda dari kondisi
// modem (meniru $differ halaman web) dan daftar namanya. Kata sandi ACS tidak
// bisa dibandingkan dengan aman, jadi hanya dikirim bila diminta dan berbeda
// dari yang dilaporkan modem.
func diff(cur tr069Config, want Settings) (map[string]any, []string) {
	patch := map[string]any{}
	var fields []string
	acs := map[string]any{}
	if !cur.enabled() {
		patch["tr069enable"] = 1
		fields = append(fields, "tr069enable")
	}
	if cur.ACS.URL != want.ACSURL {
		acs["acsurl"] = want.ACSURL
		fields = append(fields, "acs.acsurl")
	}
	if want.ACSUsername != "" && cur.ACS.Name != want.ACSUsername {
		acs["acsname"] = want.ACSUsername
		fields = append(fields, "acs.acsname")
	}
	if want.ACSPassword != "" && cur.ACS.Passwd != want.ACSPassword {
		acs["acspasswd"] = want.ACSPassword
		fields = append(fields, "acs.acspasswd")
	}
	if want.InformInterval > 0 {
		if cur.ACS.InformOn == nil || *cur.ACS.InformOn != 1 {
			acs["informenable"] = 1
			fields = append(fields, "acs.informenable")
		}
		if cur.ACS.Interval == nil || *cur.ACS.Interval != want.InformInterval {
			acs["informinterval"] = want.InformInterval
			fields = append(fields, "acs.informinterval")
		}
	}
	if len(acs) > 0 {
		patch["acs"] = acs
	}
	return patch, fields
}

func (c *Client) login(ctx context.Context, username, password string) error {
	sum := md5.Sum([]byte(password)) //nolint:gosec // lihat komentar impor
	var out struct {
		Token string `json:"token"`
	}
	err := c.post(ctx, map[string]any{
		"module": "login", "username": username, "encryPassword": hex.EncodeToString(sum[:]),
	}, &out)
	if err != nil {
		return err
	}
	if out.Token == "" {
		return fmt.Errorf("%w: login tanpa token", ErrUnexpected)
	}
	c.token = out.Token
	return nil
}

// logout best effort dengan konteks sendiri: dipanggil saat konteks permintaan
// mungkin sudah dibatalkan, dan sesi yang tertinggal menghabiskan jatah login.
func (c *Client) logout() {
	if c.token == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = c.post(ctx, map[string]any{"module": "logout"}, nil)
	c.token = ""
}

func (c *Client) getTR069(ctx context.Context) (tr069Config, error) {
	var cfg tr069Config
	if err := c.get(ctx, "tr069_config", &cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}

// informing: status "berhasil lapor" (3) dari tr069_status. Hanya petunjuk; modem
// perlu beberapa detik sesudah simpan, jadi false bukan berarti gagal.
func (c *Client) informing(ctx context.Context) bool {
	var st struct {
		Inform  *int `json:"tr069Inform"`
		Connect *int `json:"tr069Connect"`
	}
	if err := c.get(ctx, "tr069_status", &st); err != nil {
		return false
	}
	return st.Inform != nil && *st.Inform == 3
}

func (c *Client) get(ctx context.Context, module string, out any) error {
	u := c.BaseURL + "/get.json?module=" + url.QueryEscape(module)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	return c.do(req, out)
}

func (c *Client) post(ctx context.Context, body map[string]any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/post.json", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

func (c *Client) do(req *http.Request, out any) error {
	// Modem menolak (kode 10104 "No token carried") setiap permintaan TANPA header
	// Authorization, termasuk login. Halaman webnya mengirim teks "null" sebelum
	// login (axios menulis nilai null apa adanya), dan itu yang diterima modem.
	auth := c.token
	if auth == "" {
		auth = "null"
	}
	req.Header.Set("Authorization", auth)
	// Tanpa Referer modem menjawab 10104 "Referer is null." (dicek terhadap modem asli).
	req.Header.Set("Referer", c.BaseURL+"/")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrUnreachable, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		// Putus atau timeout di tengah jawaban = koneksi terputus, BUKAN jawaban yang aneh: modem
		// yang menyambung ulang PPPoE memutus koneksi sebelum selesai menjawab.
		return fmt.Errorf("%w: baca jawaban: %w", ErrUnreachable, err)
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: HTTP %d", ErrUnexpected, res.StatusCode)
	}
	var env struct {
		Code *int `json:"code"`
	}
	if err := json.Unmarshal(data, &env); err != nil || env.Code == nil {
		return fmt.Errorf("%w: bukan JSON modem", ErrUnexpected)
	}
	switch *env.Code {
	case codeOK:
	case codeBadUser, codeBadPassword:
		return ErrBadCredentials
	case codeOtherLogin, codeTooManyLogins:
		return ErrSessionBusy
	case codeLocked:
		return ErrLocked
	default:
		return fmt.Errorf("%w: kode %d", ErrUnexpected, *env.Code)
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("%w: %v", ErrUnexpected, err)
		}
	}
	return nil
}

// --- WAN ---

// Nilai connection_type ("Service Type" di form WAN modem): 1 TR069, 2 INTERNET,
// 3 TR069_INTERNET, 8 VOICE, 9 VOICE_TR069, 10 VOICE_INTERNET,
// 11 VOICE_TR069_INTERNET. Dibaca dari JS halaman WAN modem.
func carriesTR069(ct int) bool { return ct == 1 || ct == 3 || ct == 9 || ct == 11 }

// withTR069 memetakan tipe INTERNET ke padanannya yang membawa TR-069.
func withTR069(ct int) (int, bool) {
	switch ct {
	case 2:
		return 3, true
	case 10:
		return 11, true
	}
	return 0, false
}

type wanEntry struct {
	Hidden         int             `json:"hidden"`
	ConnectionType int             `json:"connection_type"`
	ServiceType    int             `json:"service_type"`
	MTU            *int            `json:"mtu"`
	IPProtocol     *int            `json:"ip_protocol"`
	IPv4           map[string]any  `json:"ipv4"`
	IPv6           map[string]any  `json:"ipv6"`
	PortBinding    json.RawMessage `json:"port_binding"`
	Interface      string          `json:"interface"`
}

type wanConfig struct {
	WAN []wanEntry `json:"wan"`
}

// ensureTR069WAN mengembalikan (diubah, catatan). Tidak pernah menebak: hanya
// bertindak bila TEPAT satu WAN INTERNET dan tak ada WAN yang sudah membawa TR-069.
// Galat tidak menggagalkan pemasangan TR-069-nya; dikembalikan sebagai catatan.
func (c *Client) ensureTR069WAN(ctx context.Context) (bool, string) {
	var cfg wanConfig
	if err := c.get(ctx, "wan_confignew", &cfg); err != nil {
		return false, "Gagal membaca WAN modem: " + err.Error()
	}
	idx := -1
	visible := 0
	for i, w := range cfg.WAN {
		if w.Hidden != 0 {
			continue
		}
		visible++
		if carriesTR069(w.ConnectionType) {
			return false, "" // sudah ada jalur TR-069
		}
		if _, ok := withTR069(w.ConnectionType); ok {
			if idx != -1 {
				return false, "Modem punya lebih dari satu WAN internet; ubah service type salah satunya jadi TR069_INTERNET secara manual."
			}
			idx = i
		}
	}
	if idx == -1 {
		return false, "Modem tidak punya WAN internet yang bisa dipakai untuk TR-069; atur WAN manual."
	}
	w := cfg.WAN[idx]
	target, _ := withTR069(w.ConnectionType)

	// Persis yang dikirim halaman WAN modem saat hanya Service Type diubah:
	// elemen sebelumnya {} (urutan = indeks WAN), lalu selisih + port_binding, mtu,
	// ip_protocol dan blok ipv4/ipv6 sesuai protokol.
	patch := map[string]any{"connection_type": target}
	if len(w.PortBinding) > 0 && string(w.PortBinding) != "null" {
		patch["port_binding"] = w.PortBinding
	} else {
		patch["port_binding"] = []any{}
	}
	if w.MTU != nil {
		patch["mtu"] = *w.MTU
	}
	proto := 1
	if w.IPProtocol != nil {
		proto = *w.IPProtocol
	}
	if proto == 1 && w.ServiceType != 0 {
		patch["ip_protocol"] = 1
	}
	if (proto == 1 || proto == 3) && w.IPv4 != nil {
		patch["ipv4"] = w.IPv4
	}
	if (proto == 2 || proto == 3) && w.IPv6 != nil {
		patch["ipv6"] = w.IPv6
	}
	list := make([]any, idx+1)
	for i := 0; i < idx; i++ {
		list[i] = map[string]any{}
	}
	list[idx] = patch
	// Modem menyambung ulang PPPoE begitu menerima perubahan ini dan sering
	// memutus koneksi sebelum sempat menjawab (dialami di FD511GW asli: POST
	// kehabisan waktu padahal perubahan sudah masuk). Putus/timeout karena itu
	// bukan penolakan; hanya jawaban modem yang berisi galat yang dianggap ditolak.
	postCtx, cancel := context.WithTimeout(ctx, wanPostTimeout)
	err := c.post(postCtx, map[string]any{"module": "wan_confignew", "wan": list}, nil)
	cancel()
	if err != nil && !errors.Is(err, ErrUnreachable) {
		return false, "Modem menolak perubahan WAN: " + err.Error()
	}

	// Baca ulang sebentar-sebentar untuk memastikan; boleh gagal selama PPPoE
	// tersambung ulang.
	for try := 0; try < wanRechecks; try++ {
		select {
		case <-ctx.Done():
			return true, wanUnconfirmedNote
		case <-time.After(wanRecheckDelay):
		}
		getCtx, cancelGet := context.WithTimeout(ctx, wanPostTimeout)
		var after wanConfig
		gerr := c.get(getCtx, "wan_confignew", &after)
		cancelGet()
		if gerr != nil || idx >= len(after.WAN) {
			continue
		}
		if after.WAN[idx].ConnectionType == target {
			return true, ""
		}
	}
	if err != nil {
		// Tidak ada jawaban atas penulisan DAN tidak bisa dibuktikan sesudahnya.
		return false, wanUnconfirmedNote
	}
	return true, wanReconnectNote
}

// wanRecheckDelay: jeda antar-bacaan ulang WAN sesudah diubah (PPPoE sambung ulang).
// var agar tes bisa memendekkannya.
var wanRecheckDelay = 4 * time.Second

// wanPostTimeout membatasi satu permintaan WAN (tulis atau baca ulang).
var wanPostTimeout = 8 * time.Second

// wanRechecks: berapa kali WAN dibaca ulang sesudah penulisan.
const wanRechecks = 4

const wanUnconfirmedNote = "Perintah ubah WAN dikirim tetapi modem tidak menjawab dan hasilnya belum bisa dibaca (kemungkinan sedang menyambung ulang PPPoE). Tunggu sekitar satu menit lalu cek apakah modem muncul di GenieACS."

const wanReconnectNote = "WAN modem diubah ke TR069_INTERNET; modem sedang menyambung ulang PPPoE, jadi hasilnya belum bisa dibaca. Tunggu sekitar satu menit."
