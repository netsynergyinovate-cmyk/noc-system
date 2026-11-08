package diagnostics

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store { return &Store{db: db} }

func (s *Store) DB() *pgxpool.Pool { return s.db }

const runColumns = `id::text, customer_id::text, router_id::text, trigger_mode,
	triggered_by, triggered_by_user_id, trigger_reason, trigger_source_ref,
	dedupe_key, merged_count, last_merged_at, priority, status, error, created_at, started_at,
	finished_at, complaint_at, COALESCE(timeline, '[]'::jsonb),
	verdict_layer, verdict_detail, verdict_scope, verdict_root,
	COALESCE(verdict_secondary, '[]'::jsonb), verdict_held, is_shared_fault,
	COALESCE((SELECT name FROM customers c WHERE c.id = customer_id), ''),
	COALESCE((SELECT pppoe_username FROM customers c WHERE c.id = customer_id), '')`

func scanRun(row pgx.Row) (Run, error) {
	var r Run
	err := row.Scan(
		&r.ID, &r.CustomerID, &r.RouterID, &r.TriggerMode,
		&r.TriggeredBy, &r.TriggeredByUserID, &r.TriggerReason, &r.TriggerSourceRef,
		&r.DedupeKey, &r.MergedCount, &r.LastMergedAt, &r.Priority, &r.Status, &r.Error, &r.CreatedAt,
		&r.StartedAt, &r.FinishedAt, &r.ComplaintAt, &r.Timeline,
		&r.VerdictLayer, &r.VerdictDetail, &r.VerdictScope, &r.VerdictRoot,
		&r.VerdictSecondary, &r.VerdictHeld, &r.IsSharedFault,
		&r.CustomerName, &r.PPPoEUsername,
	)
	if err != nil {
		return Run{}, err
	}
	return r, nil
}

// CreateManual membuat run manual. Bila run manual pelanggan itu masih
// queued/running, run yang sama dikembalikan (reused=true), sama dengan UI lama.
func (s *Store) CreateManual(ctx context.Context, customerID, userID, userName string, complaintAt *time.Time) (Run, bool, error) {
	var existing Run
	row := s.db.QueryRow(ctx, `SELECT `+runColumns+` FROM diagnostic_runs
		WHERE customer_id = $1::uuid AND trigger_mode = 'manual' AND status IN ('queued','running')
		ORDER BY created_at DESC LIMIT 1`, customerID)
	existing, err := scanRun(row)
	if err == nil {
		return existing, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Run{}, false, err
	}

	row = s.db.QueryRow(ctx, `INSERT INTO diagnostic_runs
		(customer_id, router_id, trigger_mode, triggered_by, triggered_by_user_id, trigger_reason,
		 priority, status, complaint_at)
		VALUES ($1::uuid, (SELECT router_id FROM customers WHERE id = $1::uuid),
		 'manual', $2, $3, 'manual', 0, 'queued', COALESCE($4, now()))
		RETURNING `+runColumns, customerID, userName, userID, complaintAt)
	r, err := scanRun(row)
	return r, false, err
}

// CreateAuto membuat run otomatis dengan dedupe_key. Bila kunci yang sama sudah
// ada, run itu yang dipakai dan merged_count dinaikkan.
func (s *Store) CreateAuto(ctx context.Context, customerID, routerID, reason, sourceRef, dedupeKey string, complaintAt *time.Time) (Run, bool, error) {
	row := s.db.QueryRow(ctx, `INSERT INTO diagnostic_runs
		(customer_id, router_id, trigger_mode, trigger_reason, trigger_source_ref,
		 dedupe_key, priority, status, complaint_at)
		VALUES ($1::uuid, NULLIF($2,'')::uuid, 'auto', $3, $4, $5, 10, 'queued', COALESCE($6, now()))
		ON CONFLICT (dedupe_key) DO UPDATE SET
			merged_count = diagnostic_runs.merged_count + 1,
			last_merged_at = now()
		RETURNING `+runColumns+`, (xmax <> 0) AS merged`,
		customerID, routerID, reason, nullable(sourceRef), dedupeKey, complaintAt)
	var r Run
	var merged bool
	err := row.Scan(
		&r.ID, &r.CustomerID, &r.RouterID, &r.TriggerMode,
		&r.TriggeredBy, &r.TriggeredByUserID, &r.TriggerReason, &r.TriggerSourceRef,
		&r.DedupeKey, &r.MergedCount, &r.LastMergedAt, &r.Priority, &r.Status, &r.Error, &r.CreatedAt,
		&r.StartedAt, &r.FinishedAt, &r.ComplaintAt, &r.Timeline,
		&r.VerdictLayer, &r.VerdictDetail, &r.VerdictScope, &r.VerdictRoot,
		&r.VerdictSecondary, &r.VerdictHeld, &r.IsSharedFault,
		&r.CustomerName, &r.PPPoEUsername, &merged,
	)
	return r, merged, err
}

// Claim mengubah run queued menjadi running. false bila run sudah diambil.
func (s *Store) Claim(ctx context.Context, runID string) (*Run, bool, error) {
	row := s.db.QueryRow(ctx, `UPDATE diagnostic_runs
		SET status = 'running', started_at = now()
		WHERE id = $1::uuid AND status = 'queued'
		RETURNING `+runColumns, runID)
	r, err := scanRun(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &r, true, nil
}

func (s *Store) InsertFindings(ctx context.Context, runID string, findings []Finding) error {
	if len(findings) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, f := range findings {
		batch.Queue(`INSERT INTO diagnostic_findings
			(run_id, layer, metric, label, value, threshold, comparator, status,
			 detail, source_ref, sampled_at, checked_at)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
			runID, string(f.Layer), f.Metric, f.Label, f.Value, f.Threshold,
			f.Comparator, string(f.Status), f.Detail, f.SourceRef, f.SampledAt)
	}
	results := s.db.SendBatch(ctx, batch)
	defer results.Close()
	for range findings {
		if _, err := results.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Finish(ctx context.Context, runID string, v Verdict, targetName string, timeline json.RawMessage) error {
	root := v.Root
	if root != nil && root.Kind == "customer" {
		root.Name = targetName
	}
	rawRoot := []byte("null")
	if root != nil {
		rawRoot, _ = json.Marshal(root)
	}
	rawSecondary, _ := json.Marshal(v.Secondary)
	held := v.Held
	shared := v.Scope == "shared"
	_, err := s.db.Exec(ctx, `UPDATE diagnostic_runs
		SET status = 'done', finished_at = now(),
			verdict_layer = $2, verdict_detail = $3, verdict_scope = $4,
			verdict_root = $5::jsonb, verdict_secondary = $6::jsonb,
			verdict_held = $7, is_shared_fault = $8, timeline = $9::jsonb
		WHERE id = $1::uuid`,
		runID, v.Layer, nullableString(v.Detail), nullableString(v.Scope),
		string(rawRoot), string(rawSecondary), held, shared, string(timeline))
	return err
}

func (s *Store) Fail(ctx context.Context, runID string, err error) error {
	_, e := s.db.Exec(ctx, `UPDATE diagnostic_runs
		SET status = 'failed', finished_at = now(), error = $2
		WHERE id = $1::uuid`, runID, err.Error())
	return e
}

func (s *Store) Get(ctx context.Context, runID string) (*Run, []Finding, error) {
	row := s.db.QueryRow(ctx, `SELECT `+runColumns+` FROM diagnostic_runs WHERE id = $1::uuid`, runID)
	r, err := scanRun(row)
	if err != nil {
		return nil, nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT layer::text, metric, label, value, threshold,
		comparator, status::text, detail, source_ref, sampled_at
		FROM diagnostic_findings WHERE run_id = $1::uuid
		ORDER BY checked_at, id`, runID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var f Finding
		var layer, status string
		if err := rows.Scan(&layer, &f.Metric, &f.Label, &f.Value, &f.Threshold,
			&f.Comparator, &status, &f.Detail, &f.SourceRef, &f.SampledAt); err != nil {
			return nil, nil, err
		}
		f.Layer, f.Status = Layer(layer), Status(status)
		out = append(out, f)
	}
	return &r, out, rows.Err()
}

func (s *Store) List(ctx context.Context, customerID string, limit int) ([]Run, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	q := `SELECT ` + runColumns + ` FROM diagnostic_runs`
	args := []any{}
	if customerID != "" {
		q += ` WHERE customer_id = $1::uuid`
		args = append(args, customerID)
	}
	q += ` ORDER BY created_at DESC LIMIT $` + fmt.Sprint(len(args)+1)
	args = append(args, limit)
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Run
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) Policy(ctx context.Context) (Policy, error) {
	var p Policy
	err := s.db.QueryRow(ctx, `SELECT id, trigger_alert, trigger_ticket, trigger_billing,
		dedupe_minutes, mass_threshold, mass_window_minutes, updated_by, updated_at
		FROM diagnostic_policy WHERE id = 1`).Scan(
		&p.ID, &p.TriggerAlert, &p.TriggerTicket, &p.TriggerBilling,
		&p.DedupeMinutes, &p.MassThreshold, &p.MassWindowMinutes, &p.UpdatedBy, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = s.db.Exec(ctx, `INSERT INTO diagnostic_policy (id) VALUES (1) ON CONFLICT DO NOTHING`)
		return Policy{ID: 1, TriggerAlert: true, TriggerTicket: true, TriggerBilling: true,
			DedupeMinutes: 15, MassThreshold: 10, MassWindowMinutes: 5, UpdatedAt: time.Now()}, nil
	}
	return p, err
}

func (s *Store) UpdatePolicy(ctx context.Context, p Policy, updatedBy string) (Policy, error) {
	_, err := s.db.Exec(ctx, `INSERT INTO diagnostic_policy
		(id, trigger_alert, trigger_ticket, trigger_billing, dedupe_minutes,
		 mass_threshold, mass_window_minutes, updated_by, updated_at)
		VALUES (1, $1, $2, $3, $4, $5, $6, $7, now())
		ON CONFLICT (id) DO UPDATE SET
			trigger_alert = EXCLUDED.trigger_alert,
			trigger_ticket = EXCLUDED.trigger_ticket,
			trigger_billing = EXCLUDED.trigger_billing,
			dedupe_minutes = EXCLUDED.dedupe_minutes,
			mass_threshold = EXCLUDED.mass_threshold,
			mass_window_minutes = EXCLUDED.mass_window_minutes,
			updated_by = EXCLUDED.updated_by,
			updated_at = now()`,
		p.TriggerAlert, p.TriggerTicket, p.TriggerBilling, p.DedupeMinutes,
		p.MassThreshold, p.MassWindowMinutes, updatedBy)
	if err != nil {
		return Policy{}, err
	}
	return s.Policy(ctx)
}

type FirewallRuleHit struct {
	Table, Chain, RuleID, Action, Scope, Summary, Comment string
	Index                                                 int
	Disabled                                              bool
	Packets, Bytes                                        int64
	Stale                                                 bool
}

type FirewallSnapshotInput struct {
	RunID          string
	RouterID       string
	CustomerID     string
	CustomerIP     string
	TakenAt        time.Time
	Fasttrack      bool
	ConntrackCount int
	ConntrackTotal *int
	ConntrackMax   *int
	RawDrop        bool
	AddressLists   []string
	Hits           []FirewallRuleHit
}

// SaveFirewallSnapshot menyimpan potret firewall + rule yang mengenai
// pelanggan, supaya tabel rule di UI terisi dan bisa dibandingkan antar-run.
func (s *Store) SaveFirewallSnapshot(ctx context.Context, in FirewallSnapshotInput) error {
	if in.RunID == "" {
		return nil
	}
	if in.AddressLists == nil {
		in.AddressLists = []string{}
	}
	var snapshotID string
	err := s.db.QueryRow(ctx, `INSERT INTO firewall_snapshots
		(run_id, router_id, customer_id, taken_at, customer_ip, fasttrack_active,
		 conntrack_count, conntrack_total, conntrack_max, raw_drop_matched, address_list_matched)
		VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id::text`,
		in.RunID, in.RouterID, in.CustomerID, in.TakenAt, in.CustomerIP, in.Fasttrack,
		in.ConntrackCount, in.ConntrackTotal, in.ConntrackMax, in.RawDrop, in.AddressLists).Scan(&snapshotID)
	if err != nil {
		return err
	}
	if len(in.Hits) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, h := range in.Hits {
		batch.Queue(`INSERT INTO firewall_rule_hits
			(snapshot_id, table, chain, rule_index, rule_id, action, scope, summary,
			 comment, disabled, matched_packets, matched_bytes, is_stale)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			snapshotID, h.Table, h.Chain, h.Index, h.RuleID, h.Action, h.Scope,
			h.Summary, h.Comment, h.Disabled, h.Packets, h.Bytes, h.Stale)
	}
	results := s.db.SendBatch(ctx, batch)
	defer results.Close()
	for range in.Hits {
		if _, err := results.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) PreviousVerdict(ctx context.Context, customerID, excludeRunID string) (*PreviousVerdict, error) {
	var layer *string
	var finished *time.Time
	err := s.db.QueryRow(ctx, `SELECT verdict_layer, finished_at FROM diagnostic_runs
		WHERE customer_id = $1::uuid AND id <> $2::uuid AND status = 'done'
		ORDER BY finished_at DESC NULLS LAST LIMIT 1`, customerID, excludeRunID).Scan(&layer, &finished)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &PreviousVerdict{Layer: layer, FinishedAt: finished}, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
