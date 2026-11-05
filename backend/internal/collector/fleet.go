package collector

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

// Starter adalah bagian Poller yang dipakai Fleet; di tes diganti tiruan.
type Starter interface {
	Start(ctx context.Context, t Target) error
	Stop(routerID string)
}

// TargetLoader membaca daftar router yang harus dipoll saat ini.
type TargetLoader func(ctx context.Context) ([]Target, error)

// Fleet menyamakan polling dengan tabel routers: router baru mulai dipoll,
// router yang alamat atau kredensialnya berubah dipoll ulang, router yang
// dinonaktifkan atau dihapus dihentikan. Aman dipanggil berulang.
type Fleet struct {
	poller Starter
	load   TargetLoader
	logger *slog.Logger

	mu      sync.Mutex
	running map[string]string // routerID -> sidik jari target (tidak memuat kata sandi)
}

// NewFleet membuat Fleet tanpa router berjalan.
func NewFleet(poller Starter, load TargetLoader, logger *slog.Logger) *Fleet {
	return &Fleet{poller: poller, load: load, logger: logger, running: make(map[string]string)}
}

// fingerprint berubah bila alamat, username, atau kata sandi berubah. Hanya
// disimpan di memori, tidak pernah dicatat.
func fingerprint(t Target) string {
	sum := sha256.Sum256([]byte(t.BaseURL + "\x00" + t.Protocol + "\x00" + t.Username + "\x00" + t.Password))
	return hex.EncodeToString(sum[:])
}

// Reconcile menyamakan poller dengan daftar target saat ini.
func (f *Fleet) Reconcile(ctx context.Context) error {
	targets, err := f.load(ctx)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	want := make(map[string]struct{}, len(targets))
	for _, t := range targets {
		want[t.RouterID] = struct{}{}
		fp := fingerprint(t)
		if cur, ok := f.running[t.RouterID]; ok {
			if cur == fp {
				continue
			}
			f.poller.Stop(t.RouterID)
			delete(f.running, t.RouterID)
			f.logger.Info("router dipoll ulang karena alamat atau kredensial berubah", "router", t.RouterID)
		}
		if err := f.poller.Start(ctx, t); err != nil {
			f.logger.Warn("router tidak bisa mulai dipoll", "router", t.RouterID, "error", err)
			continue
		}
		f.running[t.RouterID] = fp
		f.logger.Info("polling router dimulai", "router", t.RouterID)
	}
	for id := range f.running {
		if _, ok := want[id]; ok {
			continue
		}
		f.poller.Stop(id)
		delete(f.running, id)
		f.logger.Info("polling router dihentikan (dinonaktifkan atau dihapus)", "router", id)
	}
	return nil
}

// Running mengembalikan jumlah router yang sedang dipoll.
func (f *Fleet) Running() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.running)
}

// Run memanggil Reconcile sekarang lalu tiap interval sampai ctx selesai.
// Galat hanya dicatat; putaran berikutnya tetap jalan.
func (f *Fleet) Run(ctx context.Context, interval time.Duration) {
	step := func() {
		if err := f.Reconcile(ctx); err != nil && ctx.Err() == nil {
			f.logger.Warn("gagal menyamakan daftar router yang dipoll", "error", err)
		}
	}
	step()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			step()
		}
	}
}

// targetsSQL: hanya router aktif. Kata sandi terenkripsi dibaca di sini dan
// dibuka di memori; tidak pernah dicatat.
const targetsSQL = `SELECT id::text, name, host, username, password_enc, protocol FROM routers WHERE status = 'aktif'`

// LoadTargets membaca router aktif dan menyiapkan Target-nya. Router yang
// alamatnya salah, memakai port API biner, atau kata sandinya tidak bisa dibuka
// dicatat (tanpa rahasia) dan dilewati; router lain tetap dipoll.
func LoadTargets(ctx context.Context, q Querier, deviceSecret string, logger *slog.Logger) ([]Target, error) {
	rows, err := q.Query(ctx, targetsSQL)
	if err != nil {
		return nil, fmt.Errorf("baca router untuk dipoll: %w", err)
	}
	defer rows.Close()

	var out []Target
	for rows.Next() {
		var id, name, host, username, passwordEnc, protocol string
		if err := rows.Scan(&id, &name, &host, &username, &passwordEnc, &protocol); err != nil {
			return nil, fmt.Errorf("baca baris router: %w", err)
		}
		base, err := BaseURLFromHost(host)
		if err != nil {
			logger.Warn("router dilewati", "router", name, "error", err)
			continue
		}
		proto := normalizeProtocol(protocol)
		if proto == "api" {
			base, err = APIBaseURL(base)
			if err != nil {
				logger.Warn("router dilewati: alamat API tidak valid", "router", name, "error", err)
				continue
			}
		} else if isAPIProtocolPort(base) {
			logger.Warn("router dilewati: port 8728/8729 adalah API biner; pilih protokol Binary API untuk router ini", "router", name)
			continue
		}
		password, err := DecryptCredential(passwordEnc, deviceSecret)
		if err != nil {
			logger.Warn("router dilewati: kata sandi tidak bisa dibuka", "router", name, "error", err)
			continue
		}
		out = append(out, Target{RouterID: id, BaseURL: base, Protocol: proto, Username: username, Password: password})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("baca router untuk dipoll: %w", err)
	}
	return out, nil
}

// defaultRouterTransport adalah transport tunggal bersama untuk seluruh klien router,
// agar koneksi idle dapat di-reuse secara optimal dan tidak membuat transport baru berulang kali.
var defaultRouterTransport = &http.Transport{
	Proxy: http.ProxyFromEnvironment,
	DialContext: (&net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
	ForceAttemptHTTP2:     false,
	MaxIdleConns:          100,
	MaxIdleConnsPerHost:   20,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   5 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
	DisableCompression:    true,
}

// DefaultHTTPClient dipakai poller dan pengimpor. Verifikasi TLS tetap penuh;
// timeout total mencegah satu router yang macet menahan putaran selamanya.
func DefaultHTTPClient() *http.Client {
	return &http.Client{
		Transport: defaultRouterTransport,
		Timeout:   10 * time.Second,
	}
}

// PPPSecret adalah satu akun PPP (/ppp/secret) di router.
type PPPSecret struct {
	Name     string
	Comment  string
	Disabled bool
}

// PPPSecrets mengambil daftar akun PPP. RouterOS mengirim boolean sebagai teks.
func (c *Client) PPPSecrets(ctx context.Context) ([]PPPSecret, error) {
	body, err := c.get(ctx, "name,comment,disabled", "ppp", "secret")
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Name     string `json:"name"`
		Comment  string `json:"comment"`
		Disabled string `json:"disabled"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("jawaban /ppp/secret bukan daftar yang valid: %w", err)
	}
	out := make([]PPPSecret, 0, len(rows))
	for _, r := range rows {
		out = append(out, PPPSecret{Name: r.Name, Comment: r.Comment, Disabled: r.Disabled == "true"})
	}
	return out, nil
}
