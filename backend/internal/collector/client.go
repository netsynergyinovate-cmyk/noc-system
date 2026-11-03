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
	BaseURL  string
	Username string
	Password string
}

// Client mengambil data dari satu router lewat REST API RouterOS v7. Semua
// permintaan berupa GET dengan .proplist, supaya jawaban hanya memuat kolom
// yang dibutuhkan.
type Client struct {
	base     *url.URL
	username string
	password string
	http     *http.Client
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
	return &Client{base: base, username: t.Username, password: t.Password, http: httpClient}, nil
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
	endpoint := c.base.JoinPath(append([]string{"rest"}, segments...)...)
	q := url.Values{".proplist": {proplist}}
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
