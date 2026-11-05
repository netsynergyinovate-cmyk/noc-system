package collector

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// maxResponseBytes membatasi jawaban router yang dibaca. 2.000 queue sekitar
// 300 KB; batas ini jauh di atasnya tetapi mencegah router yang rusak atau
// palsu menghabiskan memori backend.
const maxResponseBytes = 16 << 20

// Target adalah satu router yang dipoll.
type Target struct {
	RouterID string
	// BaseURL berbentuk "https://10.0.0.1" atau "http://10.0.0.1:8080". HTTP polos
	// hanya untuk jaringan manajemen tepercaya karena kata sandi dikirim tanpa
	// enkripsi; karena itu harus ditulis eksplisit.
	BaseURL string
	// Protocol "rest" (bawaan) atau "api" (API biner 8728/8729). API biner
	// memakai satu soket TCP yang dipertahankan, jadi tidak ada handshake ulang
	// tiap detik dan trafik interface bisa dialirkan lewat monitor-traffic.
	Protocol string
	Username string
	Password string
}

// Client mengambil data dari satu router lewat REST API RouterOS v7 (bawaan)
// atau API biner. Semua permintaan baca memakai .proplist, supaya jawaban hanya
// memuat kolom yang dibutuhkan.
type Client struct {
	base     *url.URL
	username string
	password string
	http     *http.Client

	// Diisi bila Target.Protocol = "api".
	api     *apiConn
	apiMu   sync.Mutex
	apiHost string
	apiPort int
	apiTLS  bool
}

// NewClient memeriksa target dan menyiapkan klien. httpClient menentukan
// timeout dan kepercayaan TLS; nil berarti klien bawaan dengan verifikasi TLS
// penuh. Verifikasi TLS tidak pernah dimatikan di sini.
func NewClient(t Target, httpClient *http.Client) (*Client, error) {
	if t.RouterID == "" {
		return nil, errors.New("collector: RouterID kosong")
	}
	base, err := url.Parse(t.BaseURL)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		return nil, fmt.Errorf("collector: BaseURL router %q harus berbentuk https://host atau http://host", t.RouterID)
	}
	if base.User != nil || base.RawQuery != "" || (base.Path != "" && base.Path != "/") {
		return nil, fmt.Errorf("collector: BaseURL router %q tidak boleh memuat kredensial, path, atau query", t.RouterID)
	}
	if t.Username == "" {
		return nil, fmt.Errorf("collector: username router %q kosong", t.RouterID)
	}
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	c := &Client{base: base, username: t.Username, password: t.Password, http: httpClient}
	proto := strings.ToLower(strings.TrimSpace(t.Protocol))
	if proto == "api" || (proto == "" && isAPIProtocolPort(t.BaseURL)) {
		host := base.Hostname()
		if host == "" {
			return nil, fmt.Errorf("collector: BaseURL router %q tidak memuat host", t.RouterID)
		}
		port := 8728
		if p := base.Port(); p != "" {
			n, err := strconv.Atoi(p)
			if err != nil || n < 1 || n > 65535 {
				return nil, fmt.Errorf("collector: port API router %q tidak valid", t.RouterID)
			}
			port = n
		}
		useTLS := port == 8729 || base.Scheme == "https"
		c.apiHost, c.apiPort, c.apiTLS = host, port, useTLS
	}
	return c, nil
}

// usesBinaryAPI benar bila klien ini berbicara lewat API biner.
func (c *Client) usesBinaryAPI() bool { return c.apiHost != "" }

// PostRaw menjalankan perintah ukur (POST) yang tidak mengubah konfigurasi,
// mis. /rest/tool/ping. Path memakai bentuk REST yang sama supaya pemanggil
// tidak perlu tahu transport-nya. Hanya path di daftar yang diteruskan.
func (c *Client) PostRaw(ctx context.Context, restPath string, body map[string]any) ([]byte, error) {
	restPath = "/" + strings.TrimPrefix(strings.TrimSpace(restPath), "/")
	if !strings.HasPrefix(restPath, "/rest/") {
		return nil, errors.New("path harus di bawah /rest/")
	}
	if !allowedMeasurePath(restPath) {
		return nil, fmt.Errorf("perintah %q tidak diizinkan", restPath)
	}
	if c.usesBinaryAPI() {
		segments := strings.Split(strings.TrimPrefix(restPath, "/rest/"), "/")
		words := make([]string, 0, len(body)+1)
		words = append(words, "/"+strings.Join(segments, "/"))
		for k, v := range body {
			words = append(words, "="+k+"="+fmt.Sprint(v))
		}
		conn, err := c.ensureAPI(ctx)
		if err != nil {
			return nil, err
		}
		rows, err := conn.exec(ctx, words)
		if err != nil {
			return nil, err
		}
		return json.Marshal(rows)
	}

	endpoint := c.base.JoinPath(strings.TrimPrefix(restPath, "/"))
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hubungi router: %w", sanitize(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("router menjawab HTTP %d untuk perintah ukur", resp.StatusCode)
	}
	out, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("baca jawaban router: %w", sanitize(err))
	}
	if len(out) > maxResponseBytes {
		return nil, fmt.Errorf("jawaban router lebih dari %d MB", maxResponseBytes>>20)
	}
	return out, nil
}

// allowedMeasurePath membatasi perintah POST ke pengukuran baca-saja.
func allowedMeasurePath(p string) bool {
	switch "/" + strings.TrimPrefix(p, "/") {
	case "/rest/tool/ping", "/rest/tool/traceroute", "/rest/interface/ethernet/monitor":
		return true
	}
	return false
}

// get meminta /rest/<segments...>?.proplist=<proplist> dan mengembalikan isi
// jawaban. Pesan error ditulis supaya bisa langsung ditampilkan ke petugas dan
// tidak memuat kata sandi, URL, atau isi jawaban error router.
func (c *Client) get(ctx context.Context, proplist string, segments ...string) ([]byte, error) {
	return c.GetQuery(ctx, proplist, nil, segments...)
}

// GetQuery seperti get, dengan penyaring tambahan (mis. name=ether2) supaya router
// hanya mengirim baris yang dibutuhkan.
func (c *Client) GetQuery(ctx context.Context, proplist string, filter url.Values, segments ...string) ([]byte, error) {
	return c.getQuery(ctx, proplist, filter, segments...)
}

func (c *Client) getQuery(ctx context.Context, proplist string, filter url.Values, segments ...string) ([]byte, error) {
	if c.usesBinaryAPI() {
		f := make(map[string][]string, len(filter))
		for k, v := range filter {
			f[k] = v
		}
		return c.apiGet(ctx, proplist, f, segments)
	}
	endpoint := c.base.JoinPath(append([]string{"rest"}, segments...)...)
	q := url.Values{}
	if proplist != "" {
		q.Set(".proplist", proplist)
	}
	for k, v := range filter {
		q[k] = v
	}
	endpoint.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hubungi router: %w", sanitize(err))
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Isi jawaban error tidak dibaca ke log karena bisa memuat data router.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		switch resp.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return nil, fmt.Errorf("router menolak login (HTTP %d): periksa username dan kata sandi", resp.StatusCode)
		case http.StatusNotFound:
			return nil, fmt.Errorf("router menjawab HTTP 404: layanan REST (www/www-ssl) belum aktif atau RouterOS di bawah v7.1")
		}
		return nil, fmt.Errorf("router menjawab HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("baca jawaban router: %w", sanitize(err))
	}
	if len(body) > maxResponseBytes {
		return nil, fmt.Errorf("jawaban router lebih dari %d MB", maxResponseBytes>>20)
	}
	return body, nil
}

// sanitize membuang URL dari error jaringan supaya log tidak memuat alamat
// lengkap beserta query-nya. Alamat router sudah ada di konteks pemanggil.
func sanitize(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return urlErr.Err
	}
	return err
}

// TorchEntry mencatat satu baris aliran yang ditangkap oleh /rest/tool/torch RouterOS.
type TorchEntry struct {
	SrcAddress string `json:"src-address"`
	DstAddress string `json:"dst-address"`
	Protocol   string `json:"protocol"`
	SrcPort    int    `json:"src-port"`
	DstPort    int    `json:"dst-port"`
	Port       int    `json:"port"`
	Tx         uint64 `json:"tx"`
	Rx         uint64 `json:"rx"`
	TxPackets  uint64 `json:"tx-packets"`
	RxPackets  uint64 `json:"rx-packets"`
}

// DNSCacheEntry mencatat entri pemetaan nama domain ke IP pada DNS cache MikroTik.
type DNSCacheEntry struct {
	Name    string `json:"name"`
	Data    string `json:"data"`
	Address string `json:"address"`
	Type    string `json:"type"`
}

// IPOrTarget mengembalikan data IP (RouterOS v7) atau address (RouterOS v6).
func (e DNSCacheEntry) IPOrTarget() string {
	if e.Data != "" {
		return e.Data
	}
	return e.Address
}

// DNSCache membaca entri DNS cache dari MikroTik untuk memetakan IP tujuan ke nama domain.
func (c *Client) DNSCache(ctx context.Context) ([]DNSCacheEntry, error) {
	data, err := c.get(ctx, "name,data,address,type", "ip", "dns", "cache")
	if err != nil {
		return nil, err
	}
	var entries []DNSCacheEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// Torch menjalankan /rest/tool/torch pada antarmuka pelanggan dengan durasi tertentu.
func (c *Client) Torch(ctx context.Context, iface string, duration time.Duration) ([]TorchEntry, error) {
	if c.usesBinaryAPI() {
		return c.apiTorch(ctx, iface, duration)
	}
	// Batas waktu kesiapan (hubungi + kirim perintah) 5 detik; durasi capture
	// tetap sesuai permintaan. Pembatalan ctx langsung memutus TCP sehingga
	// torch di router ikut berhenti.
	ctx, cancel := context.WithTimeout(ctx, duration+5*time.Second)
	defer cancel()
	endpoint := c.base.JoinPath("rest", "tool", "torch")
	durSec := int(duration.Seconds())
	if durSec <= 0 {
		durSec = 15
	}
	payload := map[string]string{
		"interface":   iface,
		"src-address": "0.0.0.0/0",
		"dst-address": "0.0.0.0/0",
		"port":        "any",
		"ip-protocol": "any",
		"duration":    fmt.Sprintf("%ds", durSec),
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	torchClient := &http.Client{
		Timeout: duration + 10*time.Second,
	}

	resp, err := torchClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("torch: %w", sanitize(err))
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("router torch HTTP %d: %s", resp.StatusCode, string(errBody))
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("baca torch: %w", sanitize(err))
	}

	var rawList []map[string]any
	if err := json.Unmarshal(data, &rawList); err != nil {
		return nil, fmt.Errorf("parse torch JSON: %w", err)
	}

	entries := make([]TorchEntry, 0, len(rawList))
	for _, m := range rawList {
		proto := strVal(m["ip-protocol"])
		if proto == "" {
			proto = strVal(m["protocol"])
		}
		entry := TorchEntry{
			SrcAddress: strVal(m["src-address"]),
			DstAddress: strVal(m["dst-address"]),
			Protocol:   proto,
			SrcPort:    intVal(m["src-port"]),
			DstPort:    intVal(m["dst-port"]),
			Port:       intVal(m["port"]),
			Tx:         uintVal(m["tx"]),
			Rx:         uintVal(m["rx"]),
			TxPackets:  uintVal(m["tx-packets"]),
			RxPackets:  uintVal(m["rx-packets"]),
		}
		if entry.DstPort == 0 && entry.Port > 0 {
			entry.DstPort = entry.Port
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func strVal(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func intVal(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		// Tangani format RouterOS seperti "443 (https)" atau "53 (dns)"
		fields := strings.Fields(n)
		if len(fields) > 0 {
			i, _ := strconv.Atoi(fields[0])
			return i
		}
	}
	return 0
}

func uintVal(v any) uint64 {
	switch n := v.(type) {
	case float64:
		return uint64(n)
	case string:
		u, _ := strconv.ParseUint(n, 10, 64)
		return u
	}
	return 0
}
