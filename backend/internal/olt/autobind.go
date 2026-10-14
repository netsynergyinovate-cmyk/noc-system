package olt

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// AutoBindMode menentukan ONU mana yang diikat ke profil TR-069.
type AutoBindMode string

const (
	// AutoBindOff: tidak menulis apa pun ke OLT (bawaan).
	AutoBindOff AutoBindMode = "off"
	// AutoBindNew: hanya ONU yang pertama terlihat sesudah fitur dinyalakan untuk
	// OLT itu. ONU yang sudah ada saat itu tidak disentuh.
	AutoBindNew AutoBindMode = "new"
	// AutoBindAll: semua ONU online yang belum terikat (sekali jalan, hati-hati).
	AutoBindAll AutoBindMode = "all"
)

// AutoBindConfig adalah pengaturan pengikatan otomatis.
type AutoBindConfig struct {
	Mode      AutoBindMode
	ProfileID int
	// MaxPerRound membatasi jumlah ONU per putaran polling per OLT.
	MaxPerRound int
}

const (
	defaultBindProfile  = 1
	defaultBindPerRound = 5
	// bindRetryAfter: ONU yang ditolak dicoba lagi paling cepat sesudah jeda ini,
	// supaya satu ONU bermasalah tidak mengulang perintah tulis tiap 30 detik.
	bindRetryAfter = 10 * time.Minute
	// missingLogEvery: peringatan "profil belum ada" tidak diulang tiap putaran.
	missingLogEvery = time.Hour
)

// AutoBindConfigFromEnv membaca OLT_TR069_AUTOBIND (off|new|all),
// OLT_TR069_PROFILE_ID (1-32) dan OLT_TR069_MAX_PER_ROUND (1-20). Nilai tidak
// valid mengembalikan error dan konfigurasi mati: menulis ke OLT tidak boleh
// jalan karena salah ketik.
func AutoBindConfigFromEnv(getenv func(string) string) (AutoBindConfig, error) {
	cfg := AutoBindConfig{Mode: AutoBindOff, ProfileID: defaultBindProfile, MaxPerRound: defaultBindPerRound}
	switch m := AutoBindMode(strings.ToLower(strings.TrimSpace(getenv("OLT_TR069_AUTOBIND")))); m {
	case "", AutoBindOff:
	case AutoBindNew, AutoBindAll:
		cfg.Mode = m
	default:
		return AutoBindConfig{Mode: AutoBindOff, ProfileID: defaultBindProfile, MaxPerRound: defaultBindPerRound},
			fmt.Errorf("OLT_TR069_AUTOBIND=%q tidak dikenal (pakai off, new, atau all); pengikatan dimatikan", m)
	}
	off := AutoBindConfig{Mode: AutoBindOff, ProfileID: defaultBindProfile, MaxPerRound: defaultBindPerRound}
	if v := strings.TrimSpace(getenv("OLT_TR069_PROFILE_ID")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxTR069Profile {
			return off, fmt.Errorf("OLT_TR069_PROFILE_ID=%q harus 1-%d; pengikatan dimatikan", v, maxTR069Profile)
		}
		cfg.ProfileID = n
	}
	if v := strings.TrimSpace(getenv("OLT_TR069_MAX_PER_ROUND")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 20 {
			return off, fmt.Errorf("OLT_TR069_MAX_PER_ROUND=%q harus 1-20; pengikatan dimatikan", v)
		}
		cfg.MaxPerRound = n
	}
	return cfg, nil
}

// BindStore adalah tempat AutoBinder mengingat ONU mana yang sudah diikat.
type BindStore interface {
	// EnsureSince menandai saat fitur pertama kali jalan untuk OLT ini (sekali).
	EnsureSince(ctx context.Context, oltID string) error
	// Candidates: ONU online, belum diikat, sesuai mode; terlama dulu.
	Candidates(ctx context.Context, oltID string, mode AutoBindMode, limit int) ([]OnuRef, error)
	MarkBound(ctx context.Context, oltID string, ref OnuRef) error
}

// BindDB adalah bagian pgxpool.Pool yang dipakai BindStore PostgreSQL.
type BindDB interface {
	Execer
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const (
	ensureSinceSQL = `UPDATE olts SET tr069_autobind_since = now() WHERE id = $1::uuid AND tr069_autobind_since IS NULL`
	// Mode "new" tanpa tr069_autobind_since menghasilkan nol baris (perbandingan NULL).
	candidatesSQL = `SELECT o.pon_index, o.onu_index
FROM olt_onus o JOIN olts t ON t.id = o.olt_id
WHERE o.olt_id = $1::uuid AND o.status = 'online' AND o.tr069_bound_at IS NULL
  AND ($2 = 'all' OR o.first_seen_at >= t.tr069_autobind_since)
ORDER BY o.first_seen_at, o.pon_index, o.onu_index
LIMIT $3`
	markBoundSQL = `UPDATE olt_onus SET tr069_bound_at = now() WHERE olt_id = $1::uuid AND pon_index = $2 AND onu_index = $3`
)

type pgBindStore struct{ db BindDB }

// NewPGBindStore membuat BindStore di atas PostgreSQL.
func NewPGBindStore(db BindDB) BindStore { return pgBindStore{db: db} }

func (s pgBindStore) EnsureSince(ctx context.Context, oltID string) error {
	_, err := s.db.Exec(ctx, ensureSinceSQL, oltID)
	return err
}

func (s pgBindStore) Candidates(ctx context.Context, oltID string, mode AutoBindMode, limit int) ([]OnuRef, error) {
	rows, err := s.db.Query(ctx, candidatesSQL, oltID, string(mode), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OnuRef
	for rows.Next() {
		var r OnuRef
		if err := rows.Scan(&r.Pon, &r.Onu); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s pgBindStore) MarkBound(ctx context.Context, oltID string, ref OnuRef) error {
	_, err := s.db.Exec(ctx, markBoundSQL, oltID, ref.Pon, ref.Onu)
	return err
}

// BindOne mengikat SATU ONU ke profil TR-069, dipanggil langsung (mis. tombol
// "Daftarkan ke GenieACS" di aplikasi). Independen dari AutoBinder/mode: jalan
// walau pengikatan otomatis sedang mati, karena ini perintah eksplisit operator.
// ErrTR069ProfileMissing dan ErrBindRejected dikembalikan apa adanya (pemanggil
// yang menerjemahkan ke jawaban HTTP).
func BindOne(ctx context.Context, drv Driver, store BindStore, oltID string, ref OnuRef, profileID int) error {
	binder, ok := drv.(TR069Binder)
	if !ok {
		return fmt.Errorf("driver %q: %w", drv.Name(), ErrNotSupported)
	}
	results, err := binder.BindTR069(ctx, profileID, []OnuRef{ref})
	if err != nil {
		return err
	}
	if len(results) != 1 {
		return fmt.Errorf("olt: hasil ikat tidak terduga (%d entri)", len(results))
	}
	if results[0].Err != nil {
		return results[0].Err
	}
	return store.MarkBound(ctx, oltID, ref)
}

// AutoBinder mengikat profil TR-069 ke ONU baru, sehingga modem pelanggan baru
// langsung tahu alamat ACS tanpa disentuh operator.
type AutoBinder struct {
	cfg    AutoBindConfig
	store  BindStore
	logger *slog.Logger
	now    func() time.Time

	mu          sync.Mutex
	retryAt     map[string]time.Time // oltID/pon/onu -> boleh dicoba lagi
	missingNext map[string]time.Time // oltID -> log berikutnya
}

// NewAutoBinder membuat pengikat. Mode off tetap valid (Run tidak melakukan apa-apa).
func NewAutoBinder(cfg AutoBindConfig, store BindStore, logger *slog.Logger) *AutoBinder {
	if logger == nil {
		logger = slog.Default()
	}
	return &AutoBinder{
		cfg: cfg, store: store, logger: logger, now: time.Now,
		retryAt: map[string]time.Time{}, missingNext: map[string]time.Time{},
	}
}

// Enabled: true bila mode bukan off.
func (b *AutoBinder) Enabled() bool { return b != nil && b.cfg.Mode != AutoBindOff }

func refKey(oltID string, r OnuRef) string { return fmt.Sprintf("%s/%d/%d", oltID, r.Pon, r.Onu) }

// Run dipanggil sesudah polling OLT sukses. Tidak membuka sesi telnet bila tidak
// ada ONU yang perlu diikat. Error dikembalikan untuk dicatat; polling tidak gagal karenanya.
func (b *AutoBinder) Run(ctx context.Context, oltID string, drv Driver) error {
	if !b.Enabled() {
		return nil
	}
	binder, ok := drv.(TR069Binder)
	if !ok {
		return fmt.Errorf("driver %q: %w", drv.Name(), ErrNotSupported)
	}
	if b.cfg.Mode == AutoBindNew {
		if err := b.store.EnsureSince(ctx, oltID); err != nil {
			return fmt.Errorf("tandai awal pengikatan TR-069: %w", err)
		}
	}
	cands, err := b.store.Candidates(ctx, oltID, b.cfg.Mode, b.cfg.MaxPerRound*4)
	if err != nil {
		return fmt.Errorf("cari ONU baru: %w", err)
	}
	now := b.now()
	var todo []OnuRef
	b.mu.Lock()
	for _, r := range cands {
		if t, wait := b.retryAt[refKey(oltID, r)]; wait && now.Before(t) {
			continue
		}
		todo = append(todo, r)
		if len(todo) == b.cfg.MaxPerRound {
			break
		}
	}
	b.mu.Unlock()
	if len(todo) == 0 {
		return nil
	}

	results, err := binder.BindTR069(ctx, b.cfg.ProfileID, todo)
	if errors.Is(err, ErrTR069ProfileMissing) {
		b.mu.Lock()
		due := !now.Before(b.missingNext[oltID])
		if due {
			b.missingNext[oltID] = now.Add(missingLogEvery)
		}
		b.mu.Unlock()
		if due {
			b.logger.Warn("ONU baru menunggu, tetapi profil TR-069 belum dibuat di OLT",
				"olt", oltID, "profil", b.cfg.ProfileID, "onu_menunggu", len(todo),
				"langkah", "buat profil: onu-tr069-profile add profile-id N profile-name X url http://ACS:7547")
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("ikat profil TR-069: %w", err)
	}
	for _, r := range results {
		key := refKey(oltID, r.Ref)
		if r.Err != nil {
			b.mu.Lock()
			b.retryAt[key] = now.Add(bindRetryAfter)
			b.mu.Unlock()
			b.logger.Warn("ikat profil TR-069 ke ONU gagal", "olt", oltID, "pon", r.Ref.Pon, "onu", r.Ref.Onu, "error", r.Err)
			continue
		}
		if err := b.store.MarkBound(ctx, oltID, r.Ref); err != nil {
			return fmt.Errorf("catat ONU %d/%d terikat: %w", r.Ref.Pon, r.Ref.Onu, err)
		}
		b.mu.Lock()
		delete(b.retryAt, key)
		b.mu.Unlock()
		b.logger.Info("profil TR-069 terikat ke ONU baru", "olt", oltID, "pon", r.Ref.Pon, "onu", r.Ref.Onu, "profil", b.cfg.ProfileID)
	}
	return nil
}
