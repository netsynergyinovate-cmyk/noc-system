package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/ontweb"
)

// ontWebTimeout membatasi seluruh sesi: login, baca, tulis, baca ulang, logout.
const ontWebTimeout = 45 * time.Second

// ontWebPort: halaman admin FD511GW. Dikunci, bukan dari permintaan, supaya
// endpoint ini tidak bisa dipakai memindai port.
const ontWebPort = "80"

// OntWebAPI melayani POST /api/v1/ont-web/tr069: backend login ke halaman web
// admin satu modem dan mengisi menu TR-069 dengan alamat GenieACS dari konfigurasi
// server. Izin cpe:manage diperiksa sebelum tubuh permintaan dibaca.
//
// ACS dan kredensial admin modem dibaca dari tabel ont_web_settings pada SETIAP
// permintaan (kata sandi dibuka dengan DEVICE_SECRET), jadi perubahan di aplikasi
// langsung berlaku tanpa restart.
type OntWebAPI struct {
	db           collector.Querier
	deviceSecret string
	nets         []*net.IPNet
	logger       *slog.Logger
	// load dan newClient dapat diganti tes; bawaannya membaca database dan klien
	// nyata ke http://IP:80.
	load func(ctx context.Context) (ontweb.Config, error)
	// newDriver mengenali jenis modem di alamat itu TANPA kredensial (FD511GW, ZIMLINK, GGCLink atau F609) dan
	// mengembalikan klien yang cocok; bawaannya ontweb.Detect.
	newDriver func(ctx context.Context, baseURL string) (ontweb.Driver, string, error)
	// resolveHost mencari IP modem dari id ONU (olt_onus.id); bawaannya lewat
	// sesi PPPoE aktif pelanggan di MikroTik.
	resolveHost func(ctx context.Context, onuID string) (string, error)
}

var (
	errOnuUnmapped = errors.New("onu belum dipetakan ke pelanggan")
	// errNotConnected membawa nama PPPoE agar pesan ke petugas bisa menyebutnya.
	errNotConnected = errors.New("pelanggan tidak punya sesi PPPoE aktif")
	uuidRE          = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// Satu baris per ONU yang ada: nama PPPoE pelanggannya (kosong bila belum dipetakan)
// dan serial ONU di OLT (MAC pada EPON).
const onuPPPoESQL = `SELECT COALESCE(c.pppoe_username, ''), COALESCE(o.serial_number, ''), COALESCE(o.model, '')
	FROM olt_onus o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1::uuid`

// macLookupAllowed: pencarian lewat MAC hanya untuk ONU yang sudah terukur (lihat bawah). Diukur
// terhadap data nyata: 14 dari 14 ONU CDTC terpetakan menghasilkan IP yang sama dengan
// pencarian lewat nama PPPoE, sedangkan satu ONU HSGQ menghasilkan IP milik modem lain.
// Menebak modem pelanggan lain tidak boleh terjadi.
func macLookupAllowed(model string) bool {
	m := strings.ToUpper(strings.TrimSpace(model))
	// CDTC = C-Data (FD511GW); HWTC H113 = ZIMLINK ZL-2113X. Untuk H113 diukur 22 dari 22 ONU
	// terpetakan menghasilkan IP yang sama dengan pencarian lewat nama PPPoE (caller-id = MAC ONU + 1).
	return strings.HasPrefix(m, "CDTC") || strings.HasPrefix(m, "HWTC H113")
}

// macMaxDelta: selisih terjauh antara MAC ONU di OLT dan caller-id modem di router.
const macMaxDelta = 3

const ontWebSettingsSQL = `SELECT acs_url, COALESCE(acs_username, ''), COALESCE(acs_password_enc, ''),
	inform_interval, COALESCE(web_username, ''), COALESCE(web_password_enc, ''),
	COALESCE(zimlink_username, ''), COALESCE(zimlink_password_enc, ''),
	COALESCE(ggclink_username, ''), COALESCE(ggclink_password_enc, ''),
	COALESCE(f609_username, ''), COALESCE(f609_password_enc, '')
	FROM ont_web_settings WHERE id = 'default'`

var errOntWebNotConfigured = errors.New("ont_web_settings kosong")

// NewOntWebAPI: db hanya dipakai membaca ont_web_settings; nets dari
// ontweb.PolicyFromEnv (batas jaringan modem).
func NewOntWebAPI(db collector.Querier, deviceSecret string, nets []*net.IPNet, logger *slog.Logger) *OntWebAPI {
	a := &OntWebAPI{
		db: db, deviceSecret: deviceSecret, nets: nets, logger: logger,
		newDriver: func(ctx context.Context, base string) (ontweb.Driver, string, error) {
			return ontweb.Detect(ctx, base, 10*time.Second)
		},
	}
	a.load = a.loadFromDB
	a.resolveHost = a.resolveFromPPPoE
	return a
}

// resolveFromPPPoE: ONU -> pelanggan -> nama PPPoE -> alamat sesi aktif di router.
// WAN modem ber-PPPoE (nama koneksi "TR069_INTERNET"), jadi alamat sesi itulah IP
// halaman web modem; dicek terhadap FD511GW asli. ONU yang belum dipetakan (atau
// namanya tidak sedang aktif) dicari lewat MAC: caller-id sesi PPPoE berdekatan
// dengan MAC ONU di OLT.
func (a *OntWebAPI) resolveFromPPPoE(ctx context.Context, onuID string) (string, error) {
	rows, err := a.db.Query(ctx, onuPPPoESQL, onuID)
	if err != nil {
		return "", err
	}
	var username, serial, model string
	found := false
	for rows.Next() {
		found = true
		if err := rows.Scan(&username, &serial, &model); err != nil {
			rows.Close()
			return "", err
		}
		break
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", err
	}
	if !found {
		return "", errOnuUnmapped
	}
	targets, err := collector.LoadTargets(ctx, a.db, a.deviceSecret, a.logger)
	if err != nil {
		return "", err
	}
	var lastErr error
	for _, t := range targets {
		client, err := collector.NewClient(t, collector.DefaultHTTPClient())
		if err != nil {
			lastErr = err
			continue
		}
		var addr string
		var ok bool
		if username != "" {
			addr, ok, err = client.PPPActiveAddress(ctx, username)
		}
		if err == nil && !ok && macLookupAllowed(model) {
			addr, ok, err = client.PPPActiveByMAC(ctx, serial, macMaxDelta)
		}
		if err != nil {
			lastErr = err
			continue
		}
		if ok {
			// Alamat dari RouterOS bisa berbentuk "ip" saja; buang bila ada "/prefix".
			return strings.SplitN(addr, "/", 2)[0], nil
		}
	}
	if lastErr != nil {
		return "", fmt.Errorf("baca sesi PPPoE: %w", lastErr)
	}
	if username == "" {
		return "", errOnuUnmapped
	}
	return "", fmt.Errorf("%w (%s)", errNotConnected, username)
}

func (a *OntWebAPI) loadFromDB(ctx context.Context) (ontweb.Config, error) {
	rows, err := a.db.Query(ctx, ontWebSettingsSQL)
	if err != nil {
		return ontweb.Config{}, err
	}
	defer rows.Close()
	var cfg ontweb.Config
	var acsPassEnc, webPassEnc, zlPassEnc, ggPassEnc, f6PassEnc string
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return ontweb.Config{}, err
		}
		return ontweb.Config{}, errOntWebNotConfigured
	}
	if err := rows.Scan(&cfg.ACSURL, &cfg.ACSUsername, &acsPassEnc, &cfg.InformInterval, &cfg.Username, &webPassEnc, &cfg.ZimlinkUsername, &zlPassEnc, &cfg.GGCLinkUsername, &ggPassEnc, &cfg.F609Username, &f6PassEnc); err != nil {
		return ontweb.Config{}, err
	}
	if err := ontweb.ValidateACSURL(cfg.ACSURL); err != nil {
		return ontweb.Config{}, fmt.Errorf("ont_web_settings.acs_url tidak sah: %w", err)
	}
	if acsPassEnc != "" {
		if cfg.ACSPassword, err = collector.DecryptCredential(acsPassEnc, a.deviceSecret); err != nil {
			return ontweb.Config{}, fmt.Errorf("buka kata sandi ACS: %w", err)
		}
	}
	if zlPassEnc != "" {
		if cfg.ZimlinkPassword, err = collector.DecryptCredential(zlPassEnc, a.deviceSecret); err != nil {
			return ontweb.Config{}, fmt.Errorf("buka kata sandi admin ZIMLINK: %w", err)
		}
	}
	if ggPassEnc != "" {
		if cfg.GGCLinkPassword, err = collector.DecryptCredential(ggPassEnc, a.deviceSecret); err != nil {
			return ontweb.Config{}, fmt.Errorf("buka kata sandi admin GGCLink: %w", err)
		}
	}
	if f6PassEnc != "" {
		if cfg.F609Password, err = collector.DecryptCredential(f6PassEnc, a.deviceSecret); err != nil {
			return ontweb.Config{}, fmt.Errorf("buka kata sandi admin F609: %w", err)
		}
	}
	if webPassEnc != "" {
		if cfg.Password, err = collector.DecryptCredential(webPassEnc, a.deviceSecret); err != nil {
			return ontweb.Config{}, fmt.Errorf("buka kata sandi admin modem: %w", err)
		}
	}
	cfg.AllowedNets = a.nets
	return cfg, nil
}

func (a *OntWebAPI) register(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/ont-web/tr069", http.HandlerFunc(a.install))
}

type ontWebRequest struct {
	// OnuID (olt_onus.id): IP modem dicari otomatis dari sesi PPPoE pelanggannya.
	// Host (IPv4) menimpa pencarian itu bila diisi petugas.
	OnuID string `json:"onuId"`
	Host  string `json:"host"`
	// Username/Password: kredensial admin modem ini. Kosong = pakai bawaan
	// server (ONT_WEB_USERNAME/PASSWORD). Tidak pernah dicatat atau disimpan.
	Username string `json:"username"`
	Password string `json:"password"`
	// EnsureWAN: bila modem belum punya WAN pembawa TR-069, ubah WAN internetnya
	// jadi TR069_INTERNET (PPPoE sambung ulang beberapa detik).
	EnsureWAN bool `json:"ensureWan"`
}

func (a *OntWebAPI) install(w http.ResponseWriter, r *http.Request) {
	identity, ok := identityFrom(r.Context())
	if !ok {
		unauthorized(w)
		return
	}
	if !identity.Can(cpeManagePerm) {
		forbidden(w)
		return
	}
	cfg, err := a.load(r.Context())
	if errors.Is(err, errOntWebNotConfigured) {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{
			Error: "acs_not_configured", Message: "Alamat GenieACS belum diatur. Isi di bagian Pengaturan pada dialog ini.",
		})
		return
	}
	if err != nil {
		a.logger.Error("pasang TR-069 lewat web ONT: baca pengaturan gagal", "error", err.Error())
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req ontWebRequest
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "tubuh permintaan tidak sah"})
		return
	}
	hostIn := strings.TrimSpace(req.Host)
	if hostIn == "" {
		if !uuidRE.MatchString(req.OnuID) {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "isi onuId atau host"})
			return
		}
		resolved, rerr := a.resolveHost(r.Context(), req.OnuID)
		switch {
		case errors.Is(rerr, errOnuUnmapped):
			writeJSON(w, http.StatusConflict, errorResponse{
				Error: "onu_unmapped", Message: "IP modem tidak ketemu: ONU ini belum dipetakan ke pelanggan dan tidak ada sesi PPPoE yang cocok dengan MAC-nya. Petakan dulu, atau isi IP manual di Lanjutan.",
			})
			return
		case errors.Is(rerr, errNotConnected):
			writeJSON(w, http.StatusConflict, errorResponse{
				Error: "customer_offline", Message: "Pelanggan tidak sedang terhubung (tidak ada sesi PPPoE aktif), jadi IP modem tidak diketahui. Isi IP manual bila tahu.",
			})
			return
		case rerr != nil:
			if r.Context().Err() != nil {
				return
			}
			a.logger.Warn("cari IP modem dari PPPoE gagal", "onu", req.OnuID, "error", rerr.Error())
			writeJSON(w, http.StatusBadGateway, errorResponse{
				Error: "ip_lookup_failed", Message: "Gagal mencari IP modem dari router. Isi IP manual bila tahu.",
			})
			return
		}
		hostIn = resolved
	}
	host, err := cfg.ParseTarget(hostIn)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_host", Message: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), ontWebTimeout)
	defer cancel()
	// Kenali jenis modem DULU, tanpa kredensial: kredensial hanya dikirim ke modem yang dikenal,
	// dan tiap jenis punya akun admin sendiri.
	driver, kind, err := a.newDriver(ctx, "http://"+host+":"+ontWebPort)
	if err != nil {
		a.fail(w, r, host, err)
		return
	}
	username, password := req.Username, req.Password
	if username == "" && password == "" {
		switch kind {
		case ontweb.KindZimlink:
			username, password = cfg.ZimlinkUsername, cfg.ZimlinkPassword
		case ontweb.KindGGCLink:
			username, password = cfg.GGCLinkUsername, cfg.GGCLinkPassword
		case ontweb.KindF609:
			username, password = cfg.F609Username, cfg.F609Password
		default:
			username, password = cfg.Username, cfg.Password
		}
	}
	if username == "" || password == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{
			Error: "credentials_required", Message: "Isi nama pengguna dan kata sandi admin untuk modem " + ontweb.KindLabel(kind) + " (di Pengaturan GenieACS atau di Lanjutan)",
		})
		return
	}
	res, err := driver.ApplyTR069(ctx, username, password, ontweb.Settings{
		ACSURL: cfg.ACSURL, ACSUsername: cfg.ACSUsername, ACSPassword: cfg.ACSPassword,
		InformInterval: cfg.InformInterval, EnsureWAN: req.EnsureWAN,
	})
	if err != nil {
		a.fail(w, r, host, err)
		return
	}
	msg := "Modem sudah memakai pengaturan ini; tidak ada yang diubah."
	switch {
	case kind == ontweb.KindGGCLink && res.WANChanged:
		// WAN baru (DHCP), WAN pelanggan tidak disentuh: tidak ada sambung ulang PPPoE.
		msg = "TR-069 dipasang dan WAN TR-069 (DHCP) ditambahkan. WAN pelanggan tidak diubah. Modem mendapat IP manajemen dari router, lalu lapor ke GenieACS dalam beberapa menit."
	case res.Changed && res.WANChanged:
		msg = "TR-069 dan WAN modem sudah diatur. Modem menyambung ulang PPPoE; tunggu sekitar satu menit lalu modem lapor ke GenieACS."
	case res.WANChanged:
		msg = "WAN modem diubah agar membawa TR-069. Modem menyambung ulang PPPoE; tunggu sekitar satu menit lalu modem lapor ke GenieACS."
	case res.Changed:
		msg = "TR-069 dipasang di modem. Modem akan lapor ke GenieACS dalam beberapa menit."
	}
	if res.WANNote != "" && !res.WANChanged {
		msg += " Perhatian: " + res.WANNote
	}
	if res.ACSStatus != "" && !res.Informing {
		msg += " Status ACS di modem: " + res.ACSStatus + "."
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "changed": res.Changed, "fields": res.Fields, "host": host,
		"informing": res.Informing, "message": msg, "model": ontweb.KindLabel(kind), "acsStatus": res.ACSStatus,
		"wanChanged": res.WANChanged, "wanNote": res.WANNote,
	})
}

// fail memetakan galat ke status + pesan untuk petugas. Rincian teknis hanya
// di log; kata sandi tidak pernah ada di galat ontweb.
func (a *OntWebAPI) fail(w http.ResponseWriter, r *http.Request, host string, err error) {
	switch {
	case errors.Is(err, ontweb.ErrBadCredentials):
		writeJSON(w, http.StatusUnprocessableEntity, errorResponse{
			Error: "ont_login_rejected", Message: "Nama pengguna atau kata sandi admin modem salah. Jangan coba berulang: modem mengunci setelah 3 kali salah.",
		})
	case errors.Is(err, ontweb.ErrSessionBusy):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: "ont_session_busy", Message: "Modem sedang dipakai sesi lain atau batas login tercapai. Coba lagi sebentar.",
		})
	case errors.Is(err, ontweb.ErrLocked):
		writeJSON(w, http.StatusLocked, errorResponse{
			Error: "ont_locked", Message: "Login modem terkunci sementara. Tunggu beberapa menit.",
		})
	default:
		if r.Context().Err() != nil {
			return // petugas sudah pergi
		}
		a.logger.Warn("pasang TR-069 lewat web ONT gagal", "host", host, "error", err.Error())
		status, code, msg := http.StatusBadGateway, "ont_failed", "Gagal memasang TR-069 di modem."
		if errors.Is(err, ontweb.ErrUnexpected) {
			code, msg = "ont_unsupported", "Alamat itu tidak menjawab seperti web admin FD511GW yang didukung."
		} else if errors.Is(err, ontweb.ErrWrongDevice) {
			status, code, msg = http.StatusUnprocessableEntity, "ont_wrong_device", "Alamat itu bukan modem FD511GW, jadi kredensial tidak dikirim. Periksa IP atau pakai IP manual."
		} else if errors.Is(err, ontweb.ErrNotApplied) {
			code, msg = "ont_not_applied", "Modem menerima perintah tetapi pengaturannya tidak tersimpan."
		} else if errors.Is(err, context.DeadlineExceeded) {
			status, code, msg = http.StatusGatewayTimeout, "ont_timeout", "Modem tidak menjawab tepat waktu."
		} else {
			code, msg = "ont_unreachable", "Modem tidak terjangkau dari server. Periksa alamat IP dan jaringan."
		}
		writeJSON(w, status, errorResponse{Error: code, Message: msg})
	}
}
