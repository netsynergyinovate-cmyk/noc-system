package collector

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Execer adalah bagian pgxpool.Pool yang menulis; di tes diganti tiruan.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// pppSource adalah bagian Client yang dipakai pengimpor.
type pppSource interface {
	PPPSecrets(ctx context.Context) ([]PPPSecret, error)
	PPPActive(ctx context.Context) ([]PPPSession, error)
}

const (
	// defaultImportEvery: cek dan impor akun PPP / pelanggan baru tiap 30 detik.
	defaultImportEvery = 30 * time.Second
	// maxSecretsPerRouter membatasi satu putaran bila router mengirim daftar yang tidak wajar.
	maxSecretsPerRouter = 50000
	maxNameLength       = 200
)

// Hanya menambah pelanggan baru. Pelanggan yang sudah ada (nama, alamat,
// koordinat, ODP hasil isian petugas) tidak pernah ditimpa.
const importCustomerSQL = `INSERT INTO customers (name, pppoe_username, router_id, is_online)
VALUES ($1, $2, $3::uuid, $4)
ON CONFLICT (pppoe_username) DO NOTHING`

// Importer mengisi tabel customers dari router: akun PPP (/ppp/secret) dan
// sesi PPPoE yang sedang aktif (/ppp/active), karena router dengan RADIUS tidak
// punya akun lokal. Akun yang dinonaktifkan di router dilewati. Tidak ada yang
// dihapus.
type Importer struct {
	load      TargetLoader
	db        Execer
	logger    *slog.Logger
	newSource func(Target) (pppSource, error)
}

// NewImporter membuat pengimpor. httpClient nil memakai DefaultHTTPClient.
func NewImporter(load TargetLoader, db Execer, httpClient *http.Client, logger *slog.Logger) *Importer {
	return NewImporterWithPool(load, db, httpClient, nil, logger)
}

// NewImporterWithPool membuat pengimpor yang memakai client pool bersama.
// clients nil berarti perilaku lama (client baru per putaran).
func NewImporterWithPool(load TargetLoader, db Execer, httpClient *http.Client, clients *ClientPool, logger *slog.Logger) *Importer {
	if httpClient == nil {
		httpClient = DefaultHTTPClient()
	}
	newSource := func(t Target) (pppSource, error) { return NewClient(t, httpClient) }
	if clients != nil {
		newSource = func(t Target) (pppSource, error) { return clients.Get(t, httpClient) }
	}
	return &Importer{
		load: load, db: db, logger: logger,
		newSource: newSource,
	}
}

// ImportResult meringkas satu putaran.
type ImportResult struct {
	Routers  int // router yang berhasil dibaca
	Failed   int // router yang gagal dibaca
	Seen     int // akun PPP atau sesi PPPoE aktif yang ditemukan
	Imported int // pelanggan baru yang masuk ke database
}

// Once menjalankan satu putaran untuk semua router aktif. Kegagalan satu
// router dicatat dan tidak menghentikan router lain.
func (i *Importer) Once(ctx context.Context) (ImportResult, error) {
	var res ImportResult
	targets, err := i.load(ctx)
	if err != nil {
		return res, err
	}
	for _, t := range targets {
		if ctx.Err() != nil {
			return res, ctx.Err()
		}
		seen, imported, err := i.importRouter(ctx, t)
		if err != nil {
			res.Failed++
			i.logger.Warn("impor pelanggan PPPoE dari router gagal", "router", t.RouterID, "error", err)
			continue
		}
		res.Routers++
		res.Seen += seen
		res.Imported += imported
	}
	return res, nil
}

func (i *Importer) importRouter(ctx context.Context, t Target) (seen, imported int, err error) {
	src, err := i.newSource(t)
	if err != nil {
		return 0, 0, err
	}
	secrets, err := src.PPPSecrets(ctx)
	if err != nil {
		return 0, 0, err
	}
	if len(secrets) > maxSecretsPerRouter {
		return 0, 0, fmt.Errorf("router mengirim %d akun PPP, melebihi batas %d", len(secrets), maxSecretsPerRouter)
	}
	// Sesi aktif: sumber status online awal, dan sumber pelanggan bila router
	// memakai RADIUS (akun tidak ada di /ppp/secret, hanya muncul saat tersambung).
	// Kegagalan membacanya tidak membatalkan impor akun.
	online := map[string]bool{}
	if sessions, aerr := src.PPPActive(ctx); aerr != nil {
		i.logger.Warn("daftar sesi aktif tidak terbaca, pelanggan baru dianggap offline dulu", "router", t.RouterID, "error", aerr)
	} else {
		for _, s := range sessions {
			// Sesi VPN (pptp, l2tp, ...) bukan pelanggan PPPoE.
			if s.Service == "" || strings.EqualFold(s.Service, "pppoe") {
				online[s.Name] = true
			}
		}
	}

	type candidate struct{ name, user string }
	var list []candidate
	listed := make(map[string]struct{}, len(secrets)+len(online))
	for _, s := range secrets {
		if s.Disabled || !validUser(s.Name) {
			continue
		}
		name := strings.TrimSpace(s.Comment)
		if name == "" {
			name = s.Name
		}
		list = append(list, candidate{name, s.Name})
		listed[s.Name] = struct{}{}
	}
	// Urutan tetap supaya hasil dan log tidak berubah-ubah antar putaran.
	active := make([]string, 0, len(online))
	for user := range online {
		active = append(active, user)
	}
	sort.Strings(active)
	for _, user := range active {
		if _, dup := listed[user]; dup || !validUser(user) {
			continue
		}
		list = append(list, candidate{user, user})
	}

	for _, c := range list {
		seen++
		name := c.name
		if r := []rune(name); len(r) > maxNameLength {
			name = string(r[:maxNameLength])
		}
		tag, err := i.db.Exec(ctx, importCustomerSQL, name, c.user, t.RouterID, online[c.user])
		if err != nil {
			return seen, imported, fmt.Errorf("simpan pelanggan: %w", err)
		}
		imported += int(tag.RowsAffected())
	}
	return seen, imported, nil
}

// Run mengimpor sekarang lalu tiap interval sampai ctx selesai. every <= 0
// memakai bawaan. Hasil hanya dicatat bila ada yang baru atau gagal.
func (i *Importer) Run(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = defaultImportEvery
	}
	step := func() {
		res, err := i.Once(ctx)
		if err != nil {
			if ctx.Err() == nil {
				i.logger.Warn("impor pelanggan PPPoE gagal", "error", err)
			}
			return
		}
		if res.Imported > 0 || res.Failed > 0 {
			i.logger.Info("impor pelanggan PPPoE selesai",
				"routers", res.Routers, "gagal", res.Failed, "akun_aktif", res.Seen, "pelanggan_baru", res.Imported)
		}
	}
	step()
	t := time.NewTicker(every)
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
