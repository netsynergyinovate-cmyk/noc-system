package diagnostics

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	SharedMinAffected = 3
	SharedMinRatio    = 0.2
	SharedPONRatio    = 0.3
	VerdictHold       = 15 * time.Minute
)

func layerRank(l Layer, s Status) int {
	if s == StatusFail {
		switch l {
		case LayerBilling:
			return 0
		case LayerHulu:
			return 1
		case LayerOptik:
			return 2
		case LayerOnt:
			return 3
		case LayerMikrotik:
			return 4
		case LayerFirewall:
			return 5
		case LayerLog:
			return 6
		case LayerTrafik:
			return 7
		case LayerAktif:
			return 8
		}
	}
	switch l {
	case LayerHulu:
		return 1
	case LayerOptik:
		return 2
	case LayerOnt:
		return 3
	case LayerMikrotik:
		return 4
	case LayerFirewall:
		return 5
	case LayerLog:
		return 6
	case LayerTrafik:
		return 7
	case LayerAktif:
		return 8
	case LayerBilling:
		return 9
	}
	return 99
}

func compareFindings(a, b Finding) bool {
	if a.Status != b.Status {
		if a.Status == StatusFail {
			return true
		}
		if b.Status == StatusFail {
			return false
		}
	}
	if ra, rb := layerRank(a.Layer, a.Status), layerRank(b.Layer, b.Status); ra != rb {
		return ra < rb
	}
	if a.Metric != b.Metric {
		return a.Metric < b.Metric
	}
	return a.Label < b.Label
}

func compareSecondary(a, b Finding) bool {
	if ra, rb := layerRank(a.Layer, a.Status), layerRank(b.Layer, b.Status); ra != rb {
		return ra < rb
	}
	if a.Status != b.Status {
		if a.Status == StatusFail {
			return true
		}
		if b.Status == StatusFail {
			return false
		}
	}
	if a.Metric != b.Metric {
		return a.Metric < b.Metric
	}
	return a.Label < b.Label
}

// DecideVerdict adalah port dari decideVerdict TypeScript: urutan sebab
// deterministik, anti-flapping, cakupan own/shared/unknown, dan maksimal 6
// temuan sekunder.
func DecideVerdict(findings []Finding, evidence ScopeEvidence, previous *PreviousVerdict, now time.Time) Verdict {
	nonOK := make([]Finding, 0, len(findings))
	for _, f := range findings {
		if f.Status == StatusFail || f.Status == StatusWarn {
			nonOK = append(nonOK, f)
		}
	}
	if len(nonOK) == 0 {
		checked := map[Layer]bool{}
		for _, f := range findings {
			if f.Status != StatusUnchecked {
				checked[f.Layer] = true
			}
		}
		blind := 0
		for _, l := range LayerOrder {
			if !checked[l] {
				blind++
			}
		}
		detail := "Semua lapisan normal."
		switch {
		case len(checked) == 0:
			detail = "Tidak ada lapisan yang dapat diperiksa; belum ada kesimpulan."
		case blind > 0:
			detail = fmt.Sprintf("Tidak ada temuan bermasalah pada %d lapisan yang diperiksa; %d lapisan tidak dapat diperiksa, jadi kesimpulan belum lengkap.", len(checked), blind)
		}
		scope := "unknown"
		if evidence.Router != nil {
			scope = "own"
		}
		return Verdict{Detail: detail, Scope: scope, Secondary: []VerdictSecondary{}}
	}

	sort.SliceStable(nonOK, func(i, j int) bool { return compareFindings(nonOK[i], nonOK[j]) })
	candidate := nonOK[0]
	C := candidate.Layer

	held := false
	chosen := candidate
	if previous != nil && previous.Layer != nil && previous.FinishedAt != nil {
		within := !now.Before(*previous.FinishedAt) && now.Sub(*previous.FinishedAt) <= VerdictHold
		P := Layer(*previous.Layer)
		if within && C != P {
			var pWorst *Finding
			for i := range nonOK {
				if nonOK[i].Layer == P {
					pWorst = &nonOK[i]
					break
				}
			}
			if pWorst != nil {
				candidateFailPWarn := candidate.Status == StatusFail && pWorst.Status == StatusWarn
				if !candidateFailPWarn {
					chosen = *pWorst
					held = true
				}
			}
		}
	}

	secondary := make([]VerdictSecondary, 0, 6)
	for _, f := range nonOK {
		if f.Layer == chosen.Layer && f.Metric == chosen.Metric && f.Label == chosen.Label {
			continue
		}
		if len(secondary) >= 6 {
			break
		}
		secondary = append(secondary, VerdictSecondary{
			Layer: f.Layer, Label: f.Label, Status: f.Status,
			Value: f.Value, Threshold: f.Threshold,
		})
	}
	sort.SliceStable(secondary, func(i, j int) bool {
		return layerRank(secondary[i].Layer, secondary[i].Status) < layerRank(secondary[j].Layer, secondary[j].Status)
	})

	scope := "unknown"
	var root *VerdictRoot
	routerMet := evidence.Router != nil &&
		evidence.Router.Affected >= SharedMinAffected && evidence.Router.Served > 0 &&
		float64(evidence.Router.Affected)/float64(evidence.Router.Served) >= SharedMinRatio
	ponMet := evidence.PON != nil &&
		evidence.PON.Affected >= SharedMinAffected && evidence.PON.Served > 0 &&
		float64(evidence.PON.Affected)/float64(evidence.PON.Served) >= SharedPONRatio

	switch {
	case chosen.Layer == LayerBilling && chosen.Status == StatusFail:
		scope = "own"
		root = &VerdictRoot{Kind: "customer", Affected: 1, Served: 1}
	case chosen.Layer == LayerHulu:
		scope = "shared"
		root = &VerdictRoot{Kind: "uplink"}
		if evidence.Router != nil {
			root.Name, root.Affected, root.Served = evidence.Router.Name, evidence.Router.Affected, evidence.Router.Served
		}
	case ponMet:
		scope = "shared"
		root = &VerdictRoot{Kind: "odp", Name: evidence.PON.Name, Affected: evidence.PON.Affected, Served: evidence.PON.Served}
	case routerMet:
		scope = "shared"
		root = &VerdictRoot{Kind: "router", Name: evidence.Router.Name, Affected: evidence.Router.Affected, Served: evidence.Router.Served}
	case evidence.Router != nil:
		scope = "own"
		root = &VerdictRoot{Kind: "customer", Affected: 1, Served: 1}
	}

	var prefix string
	if scope == "shared" {
		if chosen.Layer == LayerHulu {
			prefix = "Gangguan bersama: "
		} else if root != nil {
			target := "router " + root.Name
			if root.Kind == "odp" {
				target = "PON " + root.Name
			}
			prefix = fmt.Sprintf("Gangguan bersama: %d dari %d pelanggan di %s terdampak; temuan lokal kemungkinan akibat gangguan bersama. ", root.Affected, root.Served, target)
		}
	} else if scope == "unknown" {
		prefix = "Cakupan gangguan tidak diketahui (bukti router tidak tersedia): "
	}

	thresh := strings.TrimSpace(joinNonEmpty(deref(chosen.Comparator), deref(chosen.Threshold)))
	numbers := ""
	switch {
	case chosen.Value != nil && thresh != "":
		numbers = fmt.Sprintf(" %s (ambang %s)", *chosen.Value, thresh)
	case chosen.Value != nil:
		numbers = " " + *chosen.Value
	case thresh != "":
		numbers = " (ambang " + thresh + ")"
	}
	statusWord := "Bermasalah"
	if chosen.Status == StatusWarn {
		statusWord = "Peringatan"
	}
	detail := prefix + fmt.Sprintf("%s di %s: %s%s.", statusWord, chosen.Layer.Label(), chosen.Label, numbers)
	if chosen.Detail != "" {
		detail += " " + chosen.Detail
	}
	if len(secondary) > 0 {
		seen := map[Layer]bool{}
		var layers []string
		for _, s := range secondary {
			if !seen[s.Layer] {
				seen[s.Layer] = true
				layers = append(layers, s.Layer.Label())
			}
		}
		detail += " Temuan terkait: " + strings.Join(layers, ", ") + "."
	}
	if held {
		detail += " Kesimpulan dipertahankan dari diagnosa sebelumnya (anti-flapping)."
	}
	layer := chosen.Layer
	return Verdict{Layer: &layer, Detail: detail, Scope: scope, Root: root, Secondary: secondary, Held: held}
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func joinNonEmpty(parts ...string) string {
	out := ""
	for _, p := range parts {
		if p == "" {
			continue
		}
		if out != "" {
			out += " "
		}
		out += p
	}
	return out
}
