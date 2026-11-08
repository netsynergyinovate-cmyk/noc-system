// Package diagnostics menjalankan diagnosa pelanggan berlapis sepenuhnya di
// backend Go. Next.js hanya menampilkan hasil dari tabel diagnostic_runs dan
// diagnostic_findings; tidak ada logika analisis di sana.
package diagnostics

import (
	"encoding/json"
	"strconv"
	"time"
)

// Layer adalah satu lapisan diagnosa, urut hulu ke hilir.
type Layer string

const (
	LayerHulu     Layer = "hulu"
	LayerMikrotik Layer = "mikrotik"
	LayerLog      Layer = "log"
	LayerFirewall Layer = "firewall"
	LayerOptik    Layer = "optik"
	LayerOnt      Layer = "ont"
	LayerTrafik   Layer = "trafik"
	LayerAktif    Layer = "aktif"
	LayerBilling  Layer = "billing"
)

// LayerOrder sama dengan diagnosticLayers di frontend lama.
var LayerOrder = []Layer{
	LayerHulu, LayerMikrotik, LayerLog, LayerFirewall, LayerOptik,
	LayerOnt, LayerTrafik, LayerAktif, LayerBilling,
}

var LayerLabels = map[Layer]string{
	LayerHulu:     "Hulu (uplink, BGP, IPv6)",
	LayerMikrotik: "MikroTik (PPPoE, queue, interface)",
	LayerLog:      "Log MikroTik",
	LayerFirewall: "Firewall & NAT",
	LayerOptik:    "Optik OLT/ONU",
	LayerOnt:      "ONT (TR-069)",
	LayerTrafik:   "Trafik & NetFlow",
	LayerAktif:    "Pengukuran aktif & baseline",
	LayerBilling:  "Billing & isolir",
}

func (l Layer) Label() string {
	if v, ok := LayerLabels[l]; ok {
		return v
	}
	return string(l)
}

func (l Layer) Index() int {
	for i, v := range LayerOrder {
		if v == l {
			return i
		}
	}
	return len(LayerOrder)
}

// Status temuan. unchecked WAJIB punya detail/alasan.
type Status string

const (
	StatusOK        Status = "ok"
	StatusWarn      Status = "warn"
	StatusFail      Status = "fail"
	StatusUnchecked Status = "unchecked"
)

type Finding struct {
	Layer      Layer      `json:"layer"`
	Metric     string     `json:"metric"`
	Label      string     `json:"label"`
	Value      *string    `json:"value"`
	Threshold  *string    `json:"threshold"`
	Comparator *string    `json:"comparator"`
	Status     Status     `json:"status"`
	Detail     string     `json:"detail"`
	SourceRef  *string    `json:"sourceRef"`
	SampledAt  *time.Time `json:"sampledAt"`
}

func String(v string) *string { return &v }

func formatFloat(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func Number(v float64) *string {
	s := formatFloat(v)
	return &s
}

// Run adalah satu baris diagnostic_runs.
type Run struct {
	ID                string          `json:"id"`
	CustomerID        *string         `json:"customerId"`
	CustomerName      string          `json:"customerName"`
	PPPoEUsername     string          `json:"pppoeUsername"`
	RouterID          *string         `json:"routerId"`
	TriggerMode       string          `json:"triggerMode"`
	TriggeredBy       *string         `json:"triggeredBy"`
	TriggeredByUserID *string         `json:"triggeredByUserId"`
	TriggerReason     string          `json:"triggerReason"`
	TriggerSourceRef  *string         `json:"triggerSourceRef"`
	DedupeKey         *string         `json:"dedupeKey"`
	MergedCount       int             `json:"mergedCount"`
	LastMergedAt      *time.Time      `json:"lastMergedAt"`
	Priority          int             `json:"priority"`
	Status            string          `json:"status"`
	Error             *string         `json:"error"`
	CreatedAt         time.Time       `json:"createdAt"`
	StartedAt         *time.Time      `json:"startedAt"`
	FinishedAt        *time.Time      `json:"finishedAt"`
	ComplaintAt       *time.Time      `json:"complaintAt"`
	Timeline          json.RawMessage `json:"timeline"`
	VerdictLayer      *string         `json:"verdictLayer"`
	VerdictDetail     *string         `json:"verdictDetail"`
	VerdictScope      *string         `json:"verdictScope"`
	VerdictRoot       json.RawMessage `json:"verdictRoot"`
	VerdictSecondary  json.RawMessage `json:"verdictSecondary"`
	VerdictHeld       bool            `json:"verdictHeld"`
	IsSharedFault     bool            `json:"isSharedFault"`
}

type Policy struct {
	ID                int       `json:"id"`
	TriggerAlert      bool      `json:"triggerAlert"`
	TriggerTicket     bool      `json:"triggerTicket"`
	TriggerBilling    bool      `json:"triggerBilling"`
	DedupeMinutes     int       `json:"dedupeMinutes"`
	MassThreshold     int       `json:"massThreshold"`
	MassWindowMinutes int       `json:"massWindowMinutes"`
	UpdatedBy         *string   `json:"updatedBy"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type ScopeCount struct {
	Name     string
	Affected int
	Served   int
}

type ScopeEvidence struct {
	Router        *ScopeCount
	PON           *ScopeCount
	WindowMinutes int
}

type VerdictRoot struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Affected int    `json:"affected"`
	Served   int    `json:"served"`
}

type VerdictSecondary struct {
	Layer     Layer   `json:"layer"`
	Label     string  `json:"label"`
	Status    Status  `json:"status"`
	Value     *string `json:"value"`
	Threshold *string `json:"threshold"`
}

type PreviousVerdict struct {
	Layer      *string
	FinishedAt *time.Time
}

type Verdict struct {
	Layer     *Layer
	Detail    string
	Scope     string
	Root      *VerdictRoot
	Secondary []VerdictSecondary
	Held      bool
}

// Target adalah pelanggan + router yang didiagnosa.
type Target struct {
	CustomerID    string
	Name          string
	PPPoE         string
	RouterID      string
	RouterName    string
	RouterStatus  string
	RouterHost    string
	Address       string
	ODP           string
	BillingStatus string
	IsOnline      bool
}

type OnuRow struct {
	OltID      string
	OltName    string
	PON        int
	ONU        int
	Status     string
	RxPower    *float64
	CapturedAt time.Time
	CustomerID string
}
