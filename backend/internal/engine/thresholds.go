package engine

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// PortRule menandai port dengan error di atas ThresholdErrors per menit selama
// After. Backend belum mengumpulkan counter error port, jadi aturan ini belum
// menghasilkan kondisi; ambangnya sudah siap dari tabel alert_thresholds.
type PortRule struct {
	ThresholdErrors float64       // <= 0 memakai 20
	After           time.Duration // <= 0 memakai 1 menit
}

func (PortRule) Name() string { return "port" }

// Evaluate belum punya sumber data port (ponytail: isi bila collector port ada).
func (PortRule) Evaluate(Observation, time.Time) []Condition { return nil }

// ThresholdConfig adalah ambang semua aturan.
type ThresholdConfig struct {
	QueueRatio   float64
	QueueAfter   time.Duration
	CpuPercent   float64
	CpuAfter     time.Duration
	OpticalDbm   float64
	OpticalAfter time.Duration
	OfflineAfter time.Duration
	PortErrors   float64
	PortAfter    time.Duration
}

// DefaultThresholdConfig sama dengan angka PRD dan bawaan di dashboard.
func DefaultThresholdConfig() ThresholdConfig {
	return ThresholdConfig{
		QueueRatio:   0.95,
		QueueAfter:   DefaultQueueAfter,
		CpuPercent:   85,
		CpuAfter:     DefaultCpuAfter,
		OpticalDbm:   -25,
		OpticalAfter: 0,
		OfflineAfter: DefaultOfflineAfter,
		PortErrors:   20,
		PortAfter:    time.Minute,
	}
}

// MakeRules membuat aturan engine dari ambang.
func MakeRules(cfg ThresholdConfig) []Rule {
	return []Rule{
		OfflineRule{After: cfg.OfflineAfter},
		QueueRule{ThresholdRatio: cfg.QueueRatio, After: cfg.QueueAfter},
		CpuRule{ThresholdPercent: cfg.CpuPercent, After: cfg.CpuAfter},
		OpticalRule{ThresholdDbm: cfg.OpticalDbm, After: cfg.OpticalAfter},
		PortRule{ThresholdErrors: cfg.PortErrors, After: cfg.PortAfter},
		BillingMismatchRule{},
	}
}

// Querier adalah bagian pgxpool.Pool yang dibutuhkan pemuat ambang.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// LoadThresholdsFromDB membaca alert_thresholds. Nilai yang tidak ada di tabel
// tetap bawaan. Pada error, mengembalikan bawaan beserta error-nya.
func LoadThresholdsFromDB(ctx context.Context, db Querier) (ThresholdConfig, error) {
	cfg := DefaultThresholdConfig()
	rows, err := db.Query(ctx, `SELECT rule_kind, threshold, for_seconds FROM alert_thresholds`)
	if err != nil {
		return DefaultThresholdConfig(), err
	}
	defer rows.Close()
	for rows.Next() {
		var kind string
		var threshold *float64
		var forSeconds int
		if err := rows.Scan(&kind, &threshold, &forSeconds); err != nil {
			return DefaultThresholdConfig(), err
		}
		after := time.Duration(forSeconds) * time.Second
		switch kind {
		case "queue":
			if threshold != nil {
				cfg.QueueRatio = *threshold / 100 // tabel menyimpan persen
			}
			cfg.QueueAfter = after
		case "cpu":
			if threshold != nil {
				cfg.CpuPercent = *threshold
			}
			cfg.CpuAfter = after
		case "optical":
			if threshold != nil {
				cfg.OpticalDbm = *threshold
			}
			cfg.OpticalAfter = after
		case "offline":
			cfg.OfflineAfter = after
		case "port":
			if threshold != nil {
				cfg.PortErrors = *threshold
			}
			cfg.PortAfter = after
		}
	}
	if err := rows.Err(); err != nil {
		return DefaultThresholdConfig(), err
	}
	return cfg, nil
}
