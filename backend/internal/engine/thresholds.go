package engine

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"noc-isp/backend/internal/state"
)

// physicalInterface membatasi aturan port ke antarmuka fisik. Penghitung error
// pada wg/bridge/vlan/pppoe ikut bergerak karena enkapsulasi dan antrean
// software, bukan karena kabel/optik rusak; memasukkannya membuat alert palsu.
// Tipe kosong (sumber lama yang tidak mengirim type) tetap dievaluasi.
func physicalInterface(kind string) bool {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "", "ether", "sfp", "combo":
		return true
	default:
		return false
	}
}

// defaultPortSampleAge: sampel interface diambil tiap 10 detik. Sampel yang
// lebih tua dari ini berarti router tidak terbaca; aturan port tidak boleh
// memakai angka lama untuk membuat atau mempertahankan alert.
const defaultPortSampleAge = time.Minute

// PortRule menandai interface dengan kenaikan error di atas ThresholdErrors per
// menit selama After. Kenaikan dihitung dari dua sampel /interface berurutan;
// counter yang turun (router reboot) dilewati, bukan dianggap error negatif.
type PortRule struct {
	ThresholdErrors float64       // <= 0 memakai 20
	After           time.Duration // <= 0 memakai 1 menit
	MaxSampleAge    time.Duration // <= 0 memakai 1 menit

	mu   sync.Mutex
	last map[string]portSample
}

// portSample adalah penghitung error satu router pada satu waktu pengambilan,
// beserta laju terakhir tiap interface. Laju disimpan supaya kondisi tetap
// benar di antara dua sampel: engine mengevaluasi tiap detik, sedangkan sampel
// /interface hanya datang tiap 10 detik. Tanpa ini kondisi hilang-muncul dan
// syarat "selama 1 menit" tidak pernah tercapai.
type portSample struct {
	at     time.Time
	errors map[string]uint64
	rates  map[string]float64
}

func (*PortRule) Name() string { return "port" }

// Evaluate membandingkan sampel interface terbaru dengan sampel sebelumnya.
func (r *PortRule) Evaluate(obs Observation, now time.Time) []Condition {
	limit := r.ThresholdErrors
	if limit <= 0 {
		limit = 20
	}
	after := r.After
	if after <= 0 {
		after = time.Minute
	}
	maxAge := r.MaxSampleAge
	if maxAge <= 0 {
		maxAge = defaultPortSampleAge
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.last == nil {
		r.last = make(map[string]portSample)
	}
	// Router yang sudah tidak ada tidak boleh menyisakan sampel lama.
	for id := range r.last {
		if _, ok := obs.Interfaces[id]; !ok {
			delete(r.last, id)
		}
	}

	var conds []Condition
	for _, router := range obs.Routers {
		sample, ok := obs.Interfaces[router.ID]
		if !ok || sample.At.IsZero() || !router.Active {
			delete(r.last, router.ID)
			continue
		}
		if now.Sub(sample.At) > maxAge {
			delete(r.last, router.ID)
			continue
		}
		current := make(map[string]uint64, len(sample.Interfaces))
		for _, iface := range sample.Interfaces {
			if iface.Disabled || !physicalInterface(iface.Type) {
				continue
			}
			current[iface.Name] = iface.RxError + iface.TxError
		}
		prev, hadPrev := r.last[router.ID]
		if !hadPrev || sample.At.After(prev.at) {
			// Sampel baru: hitung kenaikan terhadap sampel sebelumnya.
			rates := make(map[string]float64, len(current))
			if hadPrev {
				minutes := sample.At.Sub(prev.at).Minutes()
				if minutes > 0 {
					for name, total := range current {
						before, ok := prev.errors[name]
						if !ok || total < before {
							continue // interface baru, atau counter ter-reset saat reboot
						}
						rates[name] = float64(total-before) / minutes
					}
				}
			}
			prev = portSample{at: sample.At, errors: current, rates: rates}
			r.last[router.ID] = prev
		}
		// Emit ulang laju terakhir pada setiap evaluasi, bukan hanya saat sampel
		// baru datang, supaya kondisi bertahan sampai sampel berikutnya.
		for name, rate := range prev.rates {
			if rate <= limit {
				continue
			}
			conds = append(conds, Condition{
				Key:      "port:" + router.ID + ":" + name,
				Kind:     "port",
				Severity: "warning",
				RouterID: router.ID,
				For:      after,
				Detail: map[string]any{
					"name":            router.Name,
					"host":            router.Host,
					"interface":       name,
					"errorsPerMinute": rate,
				},
			})
		}
	}
	return conds
}

// pastikan *state.Manager memenuhi sumber sampel interface yang dipakai aturan port.
var _ InterfaceSource = (*state.Manager)(nil)

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
		RouterUnreachableRule{},
		QueueRule{ThresholdRatio: cfg.QueueRatio, After: cfg.QueueAfter},
		CpuRule{ThresholdPercent: cfg.CpuPercent, After: cfg.CpuAfter},
		OpticalRule{ThresholdDbm: cfg.OpticalDbm, After: cfg.OpticalAfter},
		&PortRule{ThresholdErrors: cfg.PortErrors, After: cfg.PortAfter},
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
