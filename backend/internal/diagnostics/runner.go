package diagnostics

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Reader adalah gerbang baca router yang sama dengan yang dipakai API Go
// (/api/v1/routers/{id}/read dan /measure). *routerproxy.Source memenuhinya.
type Reader interface {
	Read(ctx context.Context, routerID, restPath string, query url.Values) ([]byte, error)
	Measure(ctx context.Context, routerID, restPath string, body map[string]any) ([]byte, error)
}

type Runner struct {
	store  *Store
	reader Reader
	logger *slog.Logger
	now    func() time.Time
}

func NewRunner(store *Store, reader Reader, logger *slog.Logger) *Runner {
	return &Runner{store: store, reader: reader, logger: logger, now: time.Now}
}

type runState struct {
	ctx          context.Context
	runner       *Runner
	runID        string
	target       Target
	now          time.Time
	complaintAt  time.Time
	onu          *OnuRow
	session      map[string]any
	queue        map[string]any
	routerErr    string
	measureOK    bool
	fasttrack    *bool
	filterRules  []map[string]any
	filterLoaded bool
}

// Run menjalankan satu run yang sudah queued. Aman dipanggil dari worker queue.
func (r *Runner) Run(ctx context.Context, runID string) {
	run, ok, err := r.store.Claim(ctx, runID)
	if err != nil {
		r.logger.Error("diagnosa: gagal claim run", "run", runID, "error", err)
		return
	}
	if !ok {
		return // sudah dijalankan proses lain
	}
	if run.CustomerID == nil || *run.CustomerID == "" {
		_ = r.store.Fail(ctx, runID, errors.New("run tidak memiliki pelanggan"))
		return
	}
	target, err := r.loadTarget(ctx, *run.CustomerID)
	if err != nil {
		_ = r.store.Fail(ctx, runID, fmt.Errorf("pelanggan tidak ditemukan: %w", err))
		return
	}
	onu, _ := r.loadOnu(ctx, target.CustomerID)
	complaint := run.CreatedAt
	if run.ComplaintAt != nil {
		complaint = *run.ComplaintAt
	}
	state := &runState{
		ctx: ctx, runner: r, runID: runID, target: target, now: r.now(),
		complaintAt: complaint, onu: onu,
	}

	var findings []Finding
	for _, layer := range LayerOrder {
		found := state.runLayer(layer)
		if len(found) == 0 {
			found = []Finding{unchecked(layer, "kosong", layer.Label(), "Lapisan tidak menghasilkan temuan")}
		}
		for i := range found {
			if found[i].Detail == "" {
				found[i].Detail = "alasan tidak dicatat"
			}
			if found[i].Status == StatusUnchecked && found[i].Detail == "" {
				found[i].Detail = "alasan tidak dicatat"
			}
		}
		findings = append(findings, found...)
		if err := r.store.InsertFindings(ctx, runID, found); err != nil {
			r.logger.Warn("diagnosa: simpan temuan gagal", "run", runID, "layer", layer, "error", err)
		}
	}

	policy, _ := r.store.Policy(ctx)
	evidence := r.loadScopeEvidence(ctx, target, onu, policy.MassWindowMinutes)
	previous, _ := r.store.PreviousVerdict(ctx, target.CustomerID, runID)
	verdict := DecideVerdict(findings, evidence, previous, r.now())
	timeline := r.timeline(ctx, target, complaint)
	if err := r.store.Finish(ctx, runID, verdict, target.Name, timeline); err != nil {
		r.logger.Error("diagnosa: gagal menyelesaikan run", "run", runID, "error", err)
	}
}

func (s *runState) runLayer(layer Layer) []Finding {
	switch layer {
	case LayerHulu:
		return s.layerHulu()
	case LayerMikrotik:
		return s.layerMikrotik()
	case LayerLog:
		return s.layerLog()
	case LayerFirewall:
		return s.layerFirewall()
	case LayerOptik:
		return s.layerOptik()
	case LayerOnt:
		return s.layerOnt()
	case LayerTrafik:
		return s.layerTrafik()
	case LayerAktif:
		return s.layerAktif()
	case LayerBilling:
		return s.layerBilling()
	}
	return nil
}

const targetSQL = `SELECT c.id::text, c.name, c.pppoe_username, c.router_id::text,
	COALESCE(r.name, ''), COALESCE(r.status, ''), COALESCE(r.host, ''),
	COALESCE(c.address, ''), COALESCE(c.odp_name, ''),
	COALESCE(c.billing_status, ''), c.is_online
	FROM customers c LEFT JOIN routers r ON r.id = c.router_id WHERE c.id = $1::uuid`

func (r *Runner) loadTarget(ctx context.Context, customerID string) (Target, error) {
	var t Target
	err := r.store.db.QueryRow(ctx, targetSQL, customerID).Scan(
		&t.CustomerID, &t.Name, &t.PPPoE, &t.RouterID, &t.RouterName,
		&t.RouterStatus, &t.RouterHost, &t.Address, &t.ODP, &t.BillingStatus, &t.IsOnline,
	)
	return t, err
}

func (r *Runner) loadOnu(ctx context.Context, customerID string) (*OnuRow, error) {
	var o OnuRow
	err := r.store.db.QueryRow(ctx, `SELECT o.olt_id::text, COALESCE(ol.name, ''), o.pon_index,
		o.onu_index, COALESCE(o.status, ''), o.rx_power::float8, o.captured_at, o.customer_id::text
		FROM olt_onus o LEFT JOIN olts ol ON ol.id = o.olt_id
		WHERE o.customer_id = $1::uuid
		ORDER BY o.captured_at DESC NULLS LAST LIMIT 1`, customerID).Scan(
		&o.OltID, &o.OltName, &o.PON, &o.ONU, &o.Status, &o.RxPower, &o.CapturedAt, &o.CustomerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &o, err
}

// loadScopeEvidence menghitung pelanggan terdampak di router/PON yang sama.
// Bukti ini hanya dari tabel alerts, seperti desain TS sebelumnya.
func (r *Runner) loadScopeEvidence(ctx context.Context, t Target, onu *OnuRow, windowMinutes int) ScopeEvidence {
	if windowMinutes <= 0 {
		windowMinutes = 5
	}
	ev := ScopeEvidence{WindowMinutes: windowMinutes}
	if t.RouterID != "" {
		var served int
		_ = r.store.db.QueryRow(ctx, `SELECT count(*) FROM customers WHERE router_id = $1::uuid`, t.RouterID).Scan(&served)
		var affected int
		_ = r.store.db.QueryRow(ctx, `SELECT count(DISTINCT customer_id) FROM alerts
			WHERE router_id = $1::uuid AND customer_id IS NOT NULL AND customer_id <> $2::uuid
			AND status = 'active' AND detected_at > now() - ($3 || ' minutes')::interval`,
			t.RouterID, t.CustomerID, windowMinutes).Scan(&affected)
		ev.Router = &ScopeCount{Name: t.RouterName, Affected: affected, Served: served}
	}
	if onu != nil {
		var served int
		_ = r.store.db.QueryRow(ctx, `SELECT count(*) FROM olt_onus
			WHERE olt_id = $1::uuid AND pon_index = $2 AND customer_id IS NOT NULL`,
			onu.OltID, onu.PON).Scan(&served)
		var affected int
		_ = r.store.db.QueryRow(ctx, `SELECT count(DISTINCT a.customer_id) FROM alerts a
			JOIN olt_onus o ON o.customer_id = a.customer_id
			WHERE o.olt_id = $1::uuid AND o.pon_index = $2 AND a.customer_id <> $3::uuid
			AND a.status = 'active' AND a.detected_at > now() - ($4 || ' minutes')::interval`,
			onu.OltID, onu.PON, t.CustomerID, windowMinutes).Scan(&affected)
		ev.PON = &ScopeCount{Name: fmt.Sprintf("%d/%d", onu.PON, onu.ONU), Affected: affected, Served: served}
	}
	return ev
}

type timelineItem struct {
	At     string `json:"at"`
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	Detail string `json:"detail"`
	Source string `json:"source"`
}

func (r *Runner) timeline(ctx context.Context, t Target, complaint time.Time) json.RawMessage {
	rows, err := r.store.db.Query(ctx, `SELECT type, started_at, COALESCE(title, ''), COALESCE(message, '')
		FROM alerts WHERE customer_id = $1::uuid
		AND started_at BETWEEN $2 AND now()
		ORDER BY started_at ASC LIMIT 50`, t.CustomerID, complaint.Add(-2*time.Hour))
	if err == nil {
		defer rows.Close()
		items := []timelineItem{}
		for rows.Next() {
			var typ, label, detail string
			var at time.Time
			if rows.Scan(&typ, &at, &label, &detail) == nil {
				items = append(items, timelineItem{
					At: at.Format(time.RFC3339), Kind: "alert", Label: typ + ": " + label,
					Detail: detail, Source: "alerts",
				})
			}
		}
		raw, _ := json.Marshal(items)
		return raw
	}
	return json.RawMessage("[]")
}

// isRouterDown membedakan router yang benar-benar tidak terjangkau dari galat
// satu query (mis. filter/path tidak didukung). Galat query tidak boleh
// membuat semua lapisan lain ikut unchecked.
func isRouterDown(err error) bool {
	msg := strings.ToLower(err.Error())
	for _, marker := range []string{
		"menolak login", "tidak menjawab", "timeout", "menutup koneksi",
		"connection reset", "forcibly closed", "eof", "dial tcp", "no route",
	} {
		if strings.Contains(msg, marker) {
			return true
		}
	}
	return false
}

func unchecked(layer Layer, metric, label, reason string, source ...*string) Finding {
	f := Finding{
		Layer: layer, Metric: metric, Label: label, Status: StatusUnchecked,
		Detail: reason,
	}
	if len(source) > 0 && source[0] != nil {
		f.SourceRef = source[0]
	}
	return f
}
