package diagnostics

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// Service adalah satu pintu untuk manual, otomatis, API, dan worker diagnosa.
// Semua analisis berjalan di proses Go ini; Next.js hanya memanggil API.
type Service struct {
	store  *Store
	runner *Runner
	logger *slog.Logger
	queue  chan string
	wg     sync.WaitGroup
	once   sync.Once
}

func NewService(store *Store, runner *Runner, logger *slog.Logger) *Service {
	return &Service{
		store: store, runner: runner, logger: logger,
		queue: make(chan string, 256),
	}
}

// Start menjalankan worker antrean. Satu run per waktu; manual dan otomatis
// memakai antrean yang sama supaya router tidak dibanjiri.
func (s *Service) Start(ctx context.Context) {
	s.once.Do(func() {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case runID := <-s.queue:
					s.runner.Run(ctx, runID)
				}
			}
		}()
	})
}

func (s *Service) Wait() { s.wg.Wait() }

func (s *Service) enqueue(runID string) {
	select {
	case s.queue <- runID:
	default:
		s.logger.Warn("antrean diagnosa penuh, run dibiarkan queued", "run", runID)
	}
}

func (s *Service) StartManual(ctx context.Context, customerID, userID, userName string, complaintAt *time.Time) (Run, bool, error) {
	if strings.TrimSpace(customerID) == "" {
		return Run{}, false, errors.New("customerId wajib")
	}
	run, reused, err := s.store.CreateManual(ctx, customerID, userID, userName, complaintAt)
	if err != nil {
		return Run{}, false, err
	}
	if !reused {
		s.enqueue(run.ID)
	}
	return run, reused, nil
}

func (s *Service) StartAuto(ctx context.Context, customerID, routerID, reason, sourceRef string, complaintAt *time.Time) (Run, bool, error) {
	policy, err := s.store.Policy(ctx)
	if err != nil {
		return Run{}, false, err
	}
	switch {
	case strings.HasPrefix(reason, "alert_") && !policy.TriggerAlert:
		return Run{}, false, nil
	case reason == "billing_isolir" && !policy.TriggerBilling:
		return Run{}, false, nil
	case reason == "ticket" && !policy.TriggerTicket:
		return Run{}, false, nil
	}
	key := autoDedupeKey(customerID, time.Now(), policy.DedupeMinutes)
	run, merged, err := s.store.CreateAuto(ctx, customerID, routerID, reason, sourceRef, key, complaintAt)
	if err != nil {
		return Run{}, false, err
	}
	if !merged {
		s.enqueue(run.ID)
	}
	return run, merged, nil
}

// StartAutoForAlert dipakai tiket keluhan: cari pelanggan/router dari alert,
// lalu buat run otomatis. Keputusan trigger tetap di Go.
func (s *Service) StartAutoForAlert(ctx context.Context, alertID, reason string) (Run, bool, error) {
	var customerID, routerID string
	var startedAt *time.Time
	err := s.store.db.QueryRow(ctx, `SELECT COALESCE(customer_id::text,''), COALESCE(router_id::text,''),
		started_at FROM alerts WHERE id = $1::uuid`, alertID).Scan(&customerID, &routerID, &startedAt)
	if err != nil {
		return Run{}, false, errors.New("alert tidak ditemukan")
	}
	if customerID == "" {
		return Run{}, false, errors.New("alert bukan milik pelanggan")
	}
	if reason == "" {
		reason = "ticket"
	}
	return s.StartAuto(ctx, customerID, routerID, reason, "alert:"+alertID, startedAt)
}

func (s *Service) Get(ctx context.Context, runID string) (*Run, []Finding, error) {
	return s.store.Get(ctx, runID)
}

func (s *Service) List(ctx context.Context, customerID string, limit int) ([]Run, error) {
	return s.store.List(ctx, customerID, limit)
}

func (s *Service) Policy(ctx context.Context) (Policy, error) { return s.store.Policy(ctx) }

func (s *Service) UpdatePolicy(ctx context.Context, p Policy, updatedBy string) (Policy, error) {
	if p.DedupeMinutes < 1 || p.DedupeMinutes > 1440 {
		return Policy{}, errors.New("dedupeMinutes harus 1–1440")
	}
	if p.MassThreshold < 2 || p.MassThreshold > 1000 {
		return Policy{}, errors.New("massThreshold harus 2–1000")
	}
	if p.MassWindowMinutes < 1 || p.MassWindowMinutes > 60 {
		return Policy{}, errors.New("massWindowMinutes harus 1–60")
	}
	return s.store.UpdatePolicy(ctx, p, updatedBy)
}

// Attach menambahkan ringkasan run ke catatan tiket alert pelanggan yang sama.
func (s *Service) Attach(ctx context.Context, runID, alertID, userName string) (string, error) {
	run, findings, err := s.store.Get(ctx, runID)
	if err != nil {
		return "", err
	}
	if run.CustomerID == nil || *run.CustomerID == "" {
		return "", errors.New("run tidak memiliki pelanggan")
	}
	var customerID *string
	err = s.store.db.QueryRow(ctx, `SELECT customer_id::text FROM alerts WHERE id = $1::uuid`, alertID).Scan(&customerID)
	if err != nil {
		return "", errors.New("alert tidak ditemukan")
	}
	if customerID == nil || *customerID != *run.CustomerID {
		return "", errors.New("alert bukan milik pelanggan run ini")
	}
	summary := runSummaryText(run, findings)
	var notes *string
	err = s.store.db.QueryRow(ctx, `UPDATE alerts
		SET ticket_notes = CASE WHEN ticket_notes IS NULL OR ticket_notes = ''
			THEN $2 ELSE ticket_notes || E'\n\n' || $2 END,
			updated_at = now()
		WHERE id = $1::uuid RETURNING ticket_notes`, alertID, summary).Scan(&notes)
	if err != nil {
		return "", err
	}
	out := ""
	if notes != nil {
		out = *notes
	}
	return out, nil
}

func runSummaryText(run *Run, findings []Finding) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Diagnosa %s (%s)", run.CreatedAt.Format("02/01/2006 15:04"), run.ID)
	if run.VerdictDetail != nil && *run.VerdictDetail != "" {
		b.WriteString("\nKesimpulan: " + *run.VerdictDetail)
	}
	for _, f := range findings {
		if f.Status == StatusUnchecked {
			continue
		}
		fmt.Fprintf(&b, "\n- %s/%s: %s", f.Layer.Label(), f.Label, f.Status)
		if f.Value != nil && *f.Value != "" {
			b.WriteString(" (" + *f.Value + ")")
		}
	}
	return b.String()
}

func autoDedupeKey(customerID string, now time.Time, minutes int) string {
	if minutes <= 0 {
		minutes = 15
	}
	return fmt.Sprintf("auto:%s:%d", customerID, now.Unix()/(int64(minutes)*60))
}

// StartAutoTrigger membaca alert baru dan perubahan billing, lalu membuat run
// otomatis di Go. Kejadian sebelum proses ini mulai tidak diputar ulang.
func (s *Service) StartAutoTrigger(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	alertCursor := time.Now()
	billingCursor := time.Now()
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.pollAlerts(ctx, &alertCursor)
				s.pollBilling(ctx, &billingCursor)
			}
		}
	}()
}

func (s *Service) pollAlerts(ctx context.Context, cursor *time.Time) {
	rows, err := s.store.db.Query(ctx, `SELECT id::text, customer_id::text, router_id::text,
		type, created_at, started_at FROM alerts
		WHERE customer_id IS NOT NULL AND created_at > $1
		AND type IN ('offline','optical','queue')
		ORDER BY created_at ASC LIMIT 500`, *cursor)
	if err != nil {
		s.logger.Warn("diagnosa otomatis: gagal membaca alert", "error", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, customerID, routerID, typ string
		var createdAt, startedAt time.Time
		if rows.Scan(&id, &customerID, &routerID, &typ, &createdAt, &startedAt) != nil {
			continue
		}
		*cursor = createdAt
		reason := "alert_" + typ
		if typ != "offline" && typ != "optical" && typ != "queue" {
			continue
		}
		if _, _, err := s.StartAuto(ctx, customerID, routerID, reason, "alert:"+id, &startedAt); err != nil {
			s.logger.Warn("diagnosa otomatis: gagal membuat run", "alert", id, "error", err)
		}
	}
}

func (s *Service) pollBilling(ctx context.Context, cursor *time.Time) {
	rows, err := s.store.db.Query(ctx, `SELECT customer_id::text, run_id::text, synced_at
		FROM billing_status WHERE status = 'isolir' AND synced_at > $1
		ORDER BY synced_at ASC LIMIT 500`, *cursor)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var customerID string
		var runID *string
		var syncedAt time.Time
		if rows.Scan(&customerID, &runID, &syncedAt) != nil {
			continue
		}
		*cursor = syncedAt
		source := ""
		if runID != nil {
			source = "billing_sync:" + *runID
		}
		if _, _, err := s.StartAuto(ctx, customerID, "", "billing_isolir", source, &syncedAt); err != nil {
			s.logger.Warn("diagnosa otomatis: gagal membuat run billing", "customer", customerID, "error", err)
		}
	}
}
