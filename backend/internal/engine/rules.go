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
	var conds []Condition
	for _, c := range obs.Customers {
		if !c.IsOnline || !c.HasQueue {
			continue
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
	var conds []Condition
	for _, router := range obs.Routers {
		if !router.Active || !router.HasResource {
			continue
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

		if c.OpticalPowerDbm < limit {
			conds = append(conds, Condition{
				Key:        "optical:" + c.ID,
				Kind:       "optical",
				Severity:   "warning",
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