package engine

import "time"

// DefaultOfflineAfter adalah batas pelanggan dianggap offline lama (PRD: 30 detik).
const DefaultOfflineAfter = 30 * time.Second

// OfflineRule menandai pelanggan yang terputus lebih lama dari After. Pelanggan
// yang hanya terputus sebentar lalu tersambung lagi tidak pernah menjadi event,
// jadi koneksi yang berkedip tidak membunyikan alert.
type OfflineRule struct {
	// After adalah lama terputus sebelum menjadi gangguan; 0 memakai
	// DefaultOfflineAfter.
	After time.Duration
}

// Name mengenali aturan di log.
func (OfflineRule) Name() string { return "offline" }

// Evaluate mengembalikan satu kondisi untuk tiap pelanggan yang sedang offline.
// Lamanya dihitung dari kapan pelanggan benar-benar putus (StatusSince), bukan
// dari kapan engine mulai berjalan.
func (r OfflineRule) Evaluate(obs Observation, now time.Time) []Condition {
	after := r.After
	if after <= 0 {
		after = DefaultOfflineAfter
	}
	var conds []Condition
	for _, c := range obs.Customers {
		if c.IsOnline {
			continue
		}
		conds = append(conds, Condition{
			Key:        "offline:" + c.ID,
			Kind:       "offline",
			Severity:   "warning",
			RouterID:   c.RouterID,
			CustomerID: c.ID,
			For:        after,
			Since:      c.StatusSince,
			Detail: map[string]any{
				"name":          c.Name,
				"pppoeUsername": c.PPPoEUsername,
			},
		})
	}
	return conds
}

// DefaultQueueAfter adalah batas antrean penuh dianggap macet (PRD: 30 detik).
const DefaultQueueAfter = 30 * time.Second

// QueueRule mendeteksi bila pelanggan menggunakan lebih dari 95% batas queue
// (upload atau download) selama lebih dari After.
type QueueRule struct {
	// ThresholdRatio adalah batas pemakaian queue (0-1); <= 0 memakai 0.95.
	ThresholdRatio float64
	After          time.Duration
	// MaxAge menolak rasio queue yang sudah basi (polling queue gagal). <= 0
	// memakai 30 detik; QueueAt kosong (sumber lama) tetap dievaluasi.
	MaxAge time.Duration
}

func (QueueRule) Name() string { return "queue" }

func (r QueueRule) Evaluate(obs Observation, now time.Time) []Condition {
	ratio := r.ThresholdRatio
	if ratio <= 0 {
		ratio = 0.95
	}
	after := r.After
	if after <= 0 {
		after = DefaultQueueAfter
	}
	maxAge := r.MaxAge
	if maxAge <= 0 {
		maxAge = 30 * time.Second
	}
	var conds []Condition
	for _, c := range obs.Customers {
		if !c.IsOnline || !c.HasQueue {
			continue
		}
		if !c.QueueAt.IsZero() && now.Sub(c.QueueAt) > maxAge {
			continue // rasio lama; polling queue tidak memberi data baru
		}
		if c.QueueUpRatio > ratio || c.QueueDownRatio > ratio {
			cause := "Download"
			if c.QueueUpRatio > ratio && c.QueueDownRatio > ratio {
				cause = "Upload dan download"
			} else if c.QueueUpRatio > ratio {
				cause = "Upload"
			}

			conds = append(conds, Condition{
				Key:        "queue:" + c.ID,
				Kind:       "queue",
				Severity:   "warning",
				RouterID:   c.RouterID,
				CustomerID: c.ID,
				For:        after,
				Detail: map[string]any{
					"name":          c.Name,
					"pppoeUsername": c.PPPoEUsername,
					"upRatio":       c.QueueUpRatio,
					"downRatio":     c.QueueDownRatio,
					"cause":         cause,
				},
			})
		}
	}
	return conds
}

// DefaultCpuAfter adalah batas beban CPU tinggi dianggap gangguan (PRD: 3 menit).
const DefaultCpuAfter = 3 * time.Minute

// CpuRule mendeteksi bila beban CPU router berada di atas 85% selama lebih dari After.
type CpuRule struct {
	// ThresholdPercent adalah batas beban CPU; <= 0 memakai 85.
	ThresholdPercent float64
	After            time.Duration
	// MaxAge menolak pembacaan resource yang sudah basi (router tidak terbaca).
	// Tanpa ini CPU tinggi terakhir bisa membuat alert yang tidak pernah selesai.
	// <= 0 memakai 1 menit; Resource.At kosong (sumber lama) tetap dievaluasi.
	MaxAge time.Duration
}

func (CpuRule) Name() string { return "cpu" }

func (r CpuRule) Evaluate(obs Observation, now time.Time) []Condition {
	limit := r.ThresholdPercent
	if limit <= 0 {
		limit = 85.0
	}
	after := r.After
	if after <= 0 {
		after = DefaultCpuAfter
	}
	maxAge := r.MaxAge
	if maxAge <= 0 {
		maxAge = time.Minute
	}
	var conds []Condition
	for _, router := range obs.Routers {
		if !router.Active || !router.HasResource {
			continue
		}
		if !router.Resource.At.IsZero() && now.Sub(router.Resource.At) > maxAge {
			continue // pembacaan lama; jangan pertahankan alert CPU dari data basi
		}

		if float64(router.Resource.CPULoad) > limit {
			conds = append(conds, Condition{
				Key:        "cpu:" + router.ID,
				Kind:       "cpu",
				Severity:   "warning",
				RouterID:   router.ID,
				CustomerID: "",
				For:        after,
				Since:      router.Resource.At,
				Detail: map[string]any{
					"name":    router.Name,
					"host":    router.Host,
					"cpuLoad": router.Resource.CPULoad,
				},
			})
		}
	}
	return conds
}

// OpticalRule mendeteksi bila daya sinyal optik ONU pelanggan lemah.
type OpticalRule struct {
	// ThresholdDbm adalah batas daya lemah; 0 memakai -25.
	ThresholdDbm float64
	After        time.Duration
}

func (OpticalRule) Name() string { return "optical" }

func (r OpticalRule) Evaluate(obs Observation, now time.Time) []Condition {
	limit := r.ThresholdDbm
	if limit == 0 {
		limit = -25.0
	}
	var conds []Condition
	for _, c := range obs.Customers {
		if !c.IsOnline || !c.HasOptical {
			continue
		}

		// Ambang batas naik persatuan: jika limit = -25 dBm, baru masuk deteksi pada <= -26 dBm, atau loss <= -30 dBm
		stepLimit := limit - 1.0
		if c.OpticalPowerDbm <= stepLimit || c.OpticalPowerDbm <= -30.0 {
			severity := "warning"
			if c.OpticalPowerDbm <= -30.0 {
				severity = "critical"
			}
			conds = append(conds, Condition{
				Key:        "optical:" + c.ID,
				Kind:       "optical",
				Severity:   severity,
				RouterID:   c.RouterID,
				CustomerID: c.ID,
				For:        r.After,
				Detail: map[string]any{
					"name":            c.Name,
					"pppoeUsername":   c.PPPoEUsername,
					"opticalPowerDbm": c.OpticalPowerDbm,
				},
			})
		}
	}
	return conds
}

// BillingMismatchRule menandai pelanggan berstatus isolir yang koneksinya masih
// online: layanan seharusnya sudah diputus.
type BillingMismatchRule struct{}

func (BillingMismatchRule) Name() string { return "billing_mismatch" }

func (r BillingMismatchRule) Evaluate(obs Observation, now time.Time) []Condition {
	var conds []Condition
	for _, c := range obs.Customers {
		if c.BillingStatus != "isolir" || !c.IsOnline {
			continue
		}
		conds = append(conds, Condition{
			Key:        "billing_mismatch:isolir:" + c.ID,
			Kind:       "billing_mismatch",
			Severity:   "warning",
			RouterID:   c.RouterID,
			CustomerID: c.ID,
			Since:      c.StatusSince,
			Detail: map[string]any{
				"name":          c.Name,
				"pppoeUsername": c.PPPoEUsername,
				"type":          "isolir_online",
			},
		})
	}
	return conds
}

// DefaultRouterUnreachableAfter: poller sudah menunggu beberapa kegagalan berturut-turut
// (anti-flapping) sebelum menandai router tidak terjangkau; ini jeda tambahan kecil.
const DefaultRouterUnreachableAfter = 15 * time.Second

// RouterUnreachableRule menandai router aktif yang tidak bisa dibaca backend (alamat
// berubah, IP server tidak diizinkan, router mati, jaringan putus). Tanpa aturan ini
// dasbor diam-diam menampilkan data lama: status pelanggan membeku dan alert lain
// tidak mungkin berubah. Berjenis "offline" tanpa pelanggan (alert tingkat router).
type RouterUnreachableRule struct {
	After time.Duration // <= 0 memakai DefaultRouterUnreachableAfter
}

func (RouterUnreachableRule) Name() string { return "router_unreachable" }

func (r RouterUnreachableRule) Evaluate(obs Observation, now time.Time) []Condition {
	after := r.After
	if after <= 0 {
		after = DefaultRouterUnreachableAfter
	}
	var conds []Condition
	for _, rt := range obs.Routers {
		if !rt.Active || rt.Reachable {
			continue
		}
		detail := map[string]any{
			"name":        rt.Name,
			"host":        rt.Host,
			"failures":    rt.ConsecutiveFailures,
			"lastError":   rt.LastError,
			"routerAlert": true,
		}
		if rt.LastOKAt > 0 {
			detail["lastOkAt"] = rt.LastOKAt
		}
		cond := Condition{
			Key:      "router-unreachable:" + rt.ID,
			Kind:     "offline",
			Severity: "critical",
			RouterID: rt.ID,
			For:      after,
			Detail:   detail,
		}
		// Mulai dihitung dari pembacaan terakhir yang berhasil, bila diketahui.
		if rt.LastOKAt > 0 {
			cond.Since = time.Unix(rt.LastOKAt, 0)
		}
		conds = append(conds, cond)
	}
	return conds
}
