package collector

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"noc-isp/backend/internal/olt"
)

// OltTarget adalah satu OLT aktif yang harus dipoll.
type OltTarget struct {
	ID     string
	Name   string
	Driver string
	Config olt.Config
}

// oltRunner adalah satu OLT yang sedang dipoll; di tes diganti tiruan.
type oltRunner interface {
	PollOnce(ctx context.Context) error
	Close() error
}

type OltTargetLoader func(ctx context.Context) ([]OltTarget, error)

const (
	// oltTargetsSQL: hanya OLT aktif; kata sandi terenkripsi dibuka di memori.
	oltTargetsSQL = `SELECT id::text, name, host, driver, username, password_enc FROM olts WHERE status = 'aktif'`
	// DefaultOltPollEvery: kondisi optik berubah lambat; tiap 30 detik cukup dan
	// tidak membebani OLT yang CPU-nya kecil.
	DefaultOltPollEvery = 30 * time.Second
	oltTimeout          = 10 * time.Second
	// oltLogEvery membatasi log gagal berturut-turut supaya OLT mati tidak membanjiri log.
	oltLogEvery = 10
)

// LoadOltTargets membaca OLT aktif. OLT yang kata sandinya tidak bisa dibuka atau
// drivernya tidak terdaftar dilewati dengan catatan (tanpa rahasia).
func LoadOltTargets(ctx context.Context, q Querier, deviceSecret string, logger *slog.Logger) ([]OltTarget, error) {
	rows, err := q.Query(ctx, oltTargetsSQL)
	if err != nil {
		return nil, fmt.Errorf("baca OLT untuk dipoll: %w", err)
	}
	defer rows.Close()

	known := map[string]bool{}
	for _, name := range olt.Drivers() {
		known[name] = true
	}
	var out []OltTarget
	for rows.Next() {
		var id, name, host, driver, username, passwordEnc string
		if err := rows.Scan(&id, &name, &host, &driver, &username, &passwordEnc); err != nil {
			return nil, fmt.Errorf("baca baris OLT: %w", err)
		}
		if !known[driver] {
			logger.Warn("OLT dilewati: driver belum tersedia di backend", "olt", name, "driver", driver, "tersedia", olt.Drivers())
			continue
		}
		password, err := DecryptCredential(passwordEnc, deviceSecret)
		if err != nil {
			logger.Warn("OLT dilewati: kata sandi tidak bisa dibuka", "olt", name, "error", err)
			continue
		}
		out = append(out, OltTarget{
			ID: id, Name: name, Driver: driver,
			Config: olt.Config{Host: host, Username: username, Password: password, Timeout: oltTimeout},
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("baca OLT untuk dipoll: %w", err)
	}
	return out, nil
}

func oltFingerprint(t OltTarget) string {
	sum := sha256.Sum256([]byte(t.Driver + "\x00" + t.Config.Host + "\x00" + t.Config.Username + "\x00" + t.Config.Password))
	return hex.EncodeToString(sum[:])
}

type oltWorker struct {
	fingerprint string
	cancel      context.CancelFunc
	done        chan struct{}
}

// OltFleet menyamakan polling OLT dengan tabel olts: OLT baru mulai dipoll, yang
// alamat atau kredensialnya berubah dipoll ulang, yang dinonaktifkan atau dihapus
// dihentikan. Tiap OLT punya goroutine sendiri, jadi satu OLT yang macet tidak
// menahan yang lain.
type OltFleet struct {
	load    OltTargetLoader
	build   func(OltTarget) (oltRunner, error)
	every   time.Duration
	logger  *slog.Logger
	db      olt.Execer
	binder  *olt.AutoBinder
	mu      sync.Mutex
	workers map[string]*oltWorker
}

// NewOltFleet membuat fleet. every <= 0 memakai DefaultOltPollEvery.
func NewOltFleet(load OltTargetLoader, db olt.Execer, every time.Duration, logger *slog.Logger) *OltFleet {
	if every <= 0 {
		every = DefaultOltPollEvery
	}
	writer := olt.NewPGWriter(db)
	var fl *OltFleet
	fl = &OltFleet{
		load: load, every: every, logger: logger, db: db, workers: make(map[string]*oltWorker),
		build: func(t OltTarget) (oltRunner, error) {
			drv, err := olt.Get(t.Driver, t.Config)
			if err != nil {
				return nil, err
			}
			p, err := olt.NewPoller(olt.PollerOptions{
				Driver: drv, OltID: t.ID, Writer: writer, OnuWriter: writer, Logger: logger,
				AutoBind: fl.binder,
			})
			if err != nil {
				_ = drv.Close()
				return nil, err
			}
			return pollerRunner{p: p, d: drv}, nil
		},
	}
	return fl
}

// WithAutoBind menyalakan pengikatan profil TR-069 otomatis untuk ONU baru. Hanya
// jalan bila mode bukan off dan db bisa membaca (pgxpool). Dipanggil sebelum Run.
func (f *OltFleet) WithAutoBind(cfg olt.AutoBindConfig) *OltFleet {
	if cfg.Mode == olt.AutoBindOff {
		return f
	}
	db, ok := f.db.(olt.BindDB)
	if !ok {
		f.logger.Warn("pengikatan TR-069 dimatikan: koneksi database tidak mendukung query")
		return f
	}
	f.binder = olt.NewAutoBinder(cfg, olt.NewPGBindStore(db), f.logger)
	f.logger.Warn("pengikatan profil TR-069 otomatis AKTIF: backend akan MENULIS ke OLT (hanya perintah ikat profil)",
		"mode", string(cfg.Mode), "profil", cfg.ProfileID, "maks_per_putaran", cfg.MaxPerRound)
	return f
}

type pollerRunner struct {
	p *olt.Poller
	d olt.Driver
}

func (r pollerRunner) PollOnce(ctx context.Context) error { return r.p.PollOnce(ctx) }
func (r pollerRunner) Close() error                       { return r.d.Close() }

// Running mengembalikan jumlah OLT yang sedang dipoll.
func (f *OltFleet) Running() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.workers)
}

// Reconcile menyamakan worker dengan daftar OLT saat ini. Aman dipanggil berulang.
func (f *OltFleet) Reconcile(ctx context.Context) error {
	targets, err := f.load(ctx)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	want := make(map[string]struct{}, len(targets))
	for _, t := range targets {
		want[t.ID] = struct{}{}
		fp := oltFingerprint(t)
		if cur, ok := f.workers[t.ID]; ok {
			if cur.fingerprint == fp {
				continue
			}
			f.stopLocked(t.ID)
			f.logger.Info("OLT dipoll ulang karena alamat atau kredensial berubah", "olt", t.Name)
		}
		runner, err := f.build(t)
		if err != nil {
			f.logger.Warn("OLT tidak bisa mulai dipoll", "olt", t.Name, "error", err)
			continue
		}
		wctx, cancel := context.WithCancel(ctx)
		w := &oltWorker{fingerprint: fp, cancel: cancel, done: make(chan struct{})}
		f.workers[t.ID] = w
		go f.run(wctx, w, t, runner)
		f.logger.Info("polling OLT dimulai", "olt", t.Name, "driver", t.Driver, "tiap", f.every.String())
	}
	for id := range f.workers {
		if _, ok := want[id]; !ok {
			f.stopLocked(id)
			f.logger.Info("polling OLT dihentikan (dinonaktifkan atau dihapus)", "olt", id)
		}
	}
	return nil
}

func (f *OltFleet) stopLocked(id string) {
	if w, ok := f.workers[id]; ok {
		w.cancel()
		delete(f.workers, id)
	}
}

func (f *OltFleet) run(ctx context.Context, w *oltWorker, t OltTarget, runner oltRunner) {
	defer close(w.done)
	defer runner.Close()
	failures := 0
	poll := func() {
		pctx, cancel := context.WithTimeout(ctx, 2*oltTimeout+f.every)
		defer cancel()
		if err := runner.PollOnce(pctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			failures++
			if failures == 1 || failures%oltLogEvery == 0 {
				f.logger.Warn("polling OLT gagal", "olt", t.Name, "berturut_turut", failures, "error", err)
			}
			return
		}
		if failures > 0 {
			f.logger.Info("polling OLT pulih", "olt", t.Name, "setelah_gagal", failures)
		}
		failures = 0
	}
	poll()
	tick := time.NewTicker(f.every)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			poll()
		}
	}
}

// Run menyamakan sekarang lalu tiap interval sampai ctx selesai.
func (f *OltFleet) Run(ctx context.Context, interval time.Duration) {
	step := func() {
		if err := f.Reconcile(ctx); err != nil && ctx.Err() == nil {
			f.logger.Warn("gagal menyamakan daftar OLT yang dipoll", "error", err)
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
