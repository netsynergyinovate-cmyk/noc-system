package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Execer adalah bagian pgxpool.Pool yang menulis; di tes diganti tiruan.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Jenis event yang disimpan sebagai alert. Selain ini (mis. billing_mismatch)
// punya tabel sendiri dan tidak masuk daftar alert jaringan.
var persistedKinds = map[string]string{
	"offline": "Pelanggan offline",
	"queue":   "Antrean penuh",
	"cpu":     "CPU router tinggi",
	"optical": "Sinyal optik lemah",
	"port":    "Error port tinggi",
}

// Selang polling tiap jenis (detik), dicatat sebagai ketidakpastian waktu: alert
// baru diketahui saat polling, jadi kejadian sebenarnya bisa lebih awal sejauh itu.
var pollSeconds = map[string]int{"offline": 30, "queue": 1, "cpu": 5, "optical": 30, "port": 10}

// Hanya baris buatan engine yang disentuh penulis ini. Alert yang dibuat
// manual lewat aplikasi (POST /api/alerts) tidak pernah ikut diubah atau ditutup.
const engineSource = `detail->>'source' = 'engine'`

// Alert yang sudah aktif untuk kunci alami yang sama dipakai ulang (restart
// backend tidak menggandakan alert); kalau belum ada, baris baru dibuat.
const touchActiveSQL = `UPDATE alerts SET updated_at = now(), severity = $4
WHERE status = 'active' AND type = $1 AND router_id IS NOT DISTINCT FROM $2::uuid
  AND customer_id IS NOT DISTINCT FROM $3::uuid AND ` + engineSource

const insertActiveSQL = `INSERT INTO alerts (router_id, customer_id, type, severity, status, title,
  started_at, detected_at, time_source, time_uncertainty_seconds,
  location_name, location_address, location_odp, latitude, longitude, detail)
SELECT $2::uuid, $3::uuid, $1, $4, 'active', $5, $6, $7, 'poll', $8,
  COALESCE(c.name, r.name), c.address, c.odp_name, c.latitude, c.longitude, $9::jsonb
FROM (SELECT 1) one
LEFT JOIN routers r ON r.id = $2::uuid
LEFT JOIN customers c ON c.id = $3::uuid`

const resolveSQL = `UPDATE alerts SET status = 'resolved', ended_at = $4, end_time_source = 'poll',
  end_time_uncertainty_seconds = $5, updated_at = now()
WHERE status = 'active' AND type = $1 AND router_id IS NOT DISTINCT FROM $2::uuid
  AND customer_id IS NOT DISTINCT FROM $3::uuid AND ` + engineSource

const closeStaleSQL = `UPDATE alerts SET status = 'resolved', ended_at = $1, end_time_source = 'poll',
  end_time_uncertainty_seconds = 30, updated_at = now()
WHERE status = 'active' AND updated_at < $2 AND ` + engineSource

const touchActiveOLTSQL = `UPDATE alerts SET updated_at = now(), severity = $2
WHERE status = 'active'
  AND type = $1
  AND detail->>'source' = 'syslog_olt'
  AND detail->>'olt_ip' = $3
  AND detail->>'pon' = $4
  AND detail->>'onu' = $5`

const insertActiveOLTSQL = `INSERT INTO alerts (
  type, severity, status, title, started_at, detected_at, time_source, time_uncertainty_seconds, detail
) VALUES (
  $1, $2, 'active', $3, now(), now(), 'event', 0, $4::jsonb
)`

const resolveOLTSQL = `UPDATE alerts SET
  status = 'resolved',
  ended_at = now(),
  end_time_source = 'event',
  end_time_uncertainty_seconds = 0,
  updated_at = now()
WHERE status = 'active'
  AND detail->>'source' = 'syslog_olt'
  AND detail->>'olt_ip' = $1
  AND detail->>'pon' = $2
  AND detail->>'onu' = $3`

// OLTAlarmEvent mewakili alarm dari OLT yang dikirim lewat syslog.
type OLTAlarmEvent struct {
	OLTID    string
	OLTIP    string
	Type     string
	Severity string
	Status   string
	PonPort  string
	OnuID    string
	RawMsg   string
}

// SaveOLTAlarm menyimpan alarm OLT secara idempoten (touch-or-insert atau resolve).
// router_id dibiarkan NULL karena ini alarm OLT (olt_id disimpan di dalam detail).
func (w *AlertWriter) SaveOLTAlarm(ctx context.Context, alarm OLTAlarmEvent) error {
	if alarm.Status == "resolved" {
		_, err := w.db.Exec(ctx, resolveOLTSQL, alarm.OLTIP, alarm.PonPort, alarm.OnuID)
		return err
	}

	alertType := "optical"
	if alarm.Type == "power_outage" || alarm.Type == "onu_offline" {
		alertType = "offline"
	}

	// 1. Touch alarm aktif yang sudah ada agar tidak menggandakan baris saat syslog mengirim ulang.
	tag, err := w.db.Exec(ctx, touchActiveOLTSQL, alertType, alarm.Severity, alarm.OLTIP, alarm.PonPort, alarm.OnuID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	// 2. Baris baru bila belum ada alarm aktif untuk OLT/PON/ONU ini.
	title := fmt.Sprintf("Gangguan OLT %s: PON %s", alarm.Type, alarm.PonPort)
	if alarm.OnuID != "" {
		title += fmt.Sprintf(" ONU %s", alarm.OnuID)
	}

	detailBytes, err := json.Marshal(map[string]any{
		"source":     "syslog_olt",
		"olt_ip":     alarm.OLTIP,
		"olt_id":     alarm.OLTID,
		"pon":        alarm.PonPort,
		"onu":        alarm.OnuID,
		"alarm_type": alarm.Type,
		"raw":        alarm.RawMsg,
	})
	if err != nil {
		return err
	}

	_, err = w.db.Exec(ctx, insertActiveOLTSQL, alertType, alarm.Severity, title, string(detailBytes))
	return err
}

// AlertWriter menyimpan event rule engine ke tabel alerts, yang dibaca halaman
// Alert dan Deteksi Anomali. Kegagalan hanya dicatat: event tetap sampai ke
// dashboard lewat WebSocket walau database sedang bermasalah.
type AlertWriter struct {
	db     Execer
	logger *slog.Logger
}

// NewAlertWriter membuat penulis. db tidak boleh nil.
func NewAlertWriter(db Execer, logger *slog.Logger) *AlertWriter {
	return &AlertWriter{db: db, logger: logger}
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Record menyimpan satu daftar event (mulai dan selesai) berurutan.
func (w *AlertWriter) Record(ctx context.Context, events []Event) {
	for _, e := range events {
		title, ok := persistedKinds[e.Kind]
		if !ok {
			continue
		}
		var err error
		if e.Active {
			err = w.start(ctx, e, title)
		} else {
			err = w.end(ctx, e)
		}
		if err != nil {
			w.logger.Warn("alert gagal disimpan", "kind", e.Kind, "active", e.Active, "error", err)
		}
		if ctx.Err() != nil {
			return
		}
	}
}

func (w *AlertWriter) start(ctx context.Context, e Event, title string) error {
	// "offline" tanpa pelanggan adalah alert tingkat router (router tidak terjangkau).
	if e.Kind == "offline" && e.CustomerID == "" {
		title = "Router tidak terjangkau"
	}
	tag, err := w.db.Exec(ctx, touchActiveSQL, e.Kind, nullable(e.RouterID), nullable(e.CustomerID), e.Severity)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	detail := map[string]any{"source": "engine", "eventId": e.ID}
	for k, v := range e.Detail {
		if k != "source" && k != "eventId" {
			detail[k] = v
		}
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	_, err = w.db.Exec(ctx, insertActiveSQL,
		e.Kind, nullable(e.RouterID), nullable(e.CustomerID), e.Severity, title,
		e.StartedAt.UTC(), e.Time.UTC(), pollSeconds[e.Kind], string(raw))
	return err
}

func (w *AlertWriter) end(ctx context.Context, e Event) error {
	_, err := w.db.Exec(ctx, resolveSQL,
		e.Kind, nullable(e.RouterID), nullable(e.CustomerID), e.Time.UTC(), pollSeconds[e.Kind])
	return err
}

// CloseStale menutup alert buatan engine yang masih berstatus aktif tetapi tidak
// disentuh sejak `since`. Dipanggil sekali beberapa menit setelah backend
// menyala: kondisi yang masih berlangsung sudah mengirim event mulai lagi dan
// "disentuh"; sisanya selesai selagi backend mati.
func (w *AlertWriter) CloseStale(ctx context.Context, now, since time.Time) (int64, error) {
	tag, err := w.db.Exec(ctx, closeStaleSQL, now.UTC(), since.UTC())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// StartStaleCleanup menjalankan CloseStale satu kali setelah `after` (harus lebih
// lama dari durasi terpanjang aturan, supaya kondisi nyata sempat terdeteksi ulang).
func (w *AlertWriter) StartStaleCleanup(ctx context.Context, bootAt time.Time, after time.Duration) {
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(after):
		}
		n, err := w.CloseStale(ctx, time.Now(), bootAt)
		switch {
		case err != nil && ctx.Err() == nil:
			w.logger.Warn("gagal menutup alert lama", "error", err)
		case n > 0:
			w.logger.Info("alert lama yang tidak terdeteksi lagi sejak backend menyala ditutup", "jumlah", n)
		}
	}()
}
