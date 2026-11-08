package engine

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type execCall struct {
	sql  string
	args []any
}

// recordingExec mencatat panggilan dan menjawab jumlah baris dari antrean.
type recordingExec struct {
	calls []execCall
	rows  []int64 // jawaban berurutan; habis berarti 0 baris
	err   error
}

func (r *recordingExec) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	r.calls = append(r.calls, execCall{sql, args})
	if r.err != nil {
		return pgconn.CommandTag{}, r.err
	}
	n := int64(0)
	if len(r.rows) > 0 {
		n, r.rows = r.rows[0], r.rows[1:]
	}
	return pgconn.NewCommandTag("UPDATE " + string(rune('0'+n))), nil
}

var persistLogger = slog.New(slog.NewTextHandler(io.Discard, nil))

func alertEv(kind string, active bool) Event {
	t0 := time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)
	return Event{
		ID: "k#1", Kind: kind, Severity: "warning", Active: active,
		RouterID: "11111111-1111-1111-1111-111111111111", CustomerID: "22222222-2222-2222-2222-222222222222",
		Time: t0.Add(time.Minute), StartedAt: t0, Detail: map[string]any{"seconds": 45},
	}
}

func TestStartInsertsWhenNoActiveAlertExists(t *testing.T) {
	db := &recordingExec{rows: []int64{0}} // sentuhan 0 baris -> buat baru
	NewAlertWriter(db, persistLogger).Record(context.Background(), []Event{alertEv("offline", true)})
	if len(db.calls) != 2 {
		t.Fatalf("harus sentuh lalu sisip, got %d panggilan", len(db.calls))
	}
	if !strings.Contains(db.calls[0].sql, "UPDATE alerts") || !strings.Contains(db.calls[1].sql, "INSERT INTO alerts") {
		t.Fatalf("urutan SQL salah: %q / %q", db.calls[0].sql, db.calls[1].sql)
	}
	ins := db.calls[1].args
	if ins[0] != "offline" || ins[4] != "Pelanggan offline" || ins[7] != 30 {
		t.Errorf("argumen sisip salah: %v", ins)
	}
	if !strings.Contains(ins[8].(string), `"source":"engine"`) || !strings.Contains(ins[8].(string), `"seconds":45`) {
		t.Errorf("detail harus memuat source engine dan detail aturan: %v", ins[8])
	}
}

func TestStartReusesExistingActiveAlert(t *testing.T) {
	db := &recordingExec{rows: []int64{1}}
	NewAlertWriter(db, persistLogger).Record(context.Background(), []Event{alertEv("queue", true)})
	if len(db.calls) != 1 {
		t.Fatalf("alert aktif yang sama dipakai ulang, tanpa sisip; got %d panggilan", len(db.calls))
	}
}

func TestEndResolvesByNaturalKeyAndOnlyEngineRows(t *testing.T) {
	db := &recordingExec{}
	NewAlertWriter(db, persistLogger).Record(context.Background(), []Event{alertEv("cpu", false)})
	if len(db.calls) != 1 || !strings.Contains(db.calls[0].sql, "status = 'resolved'") {
		t.Fatalf("calls=%+v", db.calls)
	}
	for _, c := range []string{touchActiveSQL, resolveSQL, closeStaleSQL} {
		if !strings.Contains(c, "detail->>'source' = 'engine'") {
			t.Errorf("SQL harus dibatasi ke baris engine (alert manual tidak boleh disentuh): %s", c)
		}
	}
	if db.calls[0].args[4] != 5 {
		t.Errorf("ketidakpastian CPU harus 5 detik, got %v", db.calls[0].args[4])
	}
}

func TestEmptyIDsBecomeNullAndUnsupportedKindsAreSkipped(t *testing.T) {
	db := &recordingExec{rows: []int64{1}}
	e := alertEv("cpu", true)
	e.CustomerID = "" // gangguan router tidak punya pelanggan
	NewAlertWriter(db, persistLogger).Record(context.Background(), []Event{e, alertEv("billing_mismatch", true), alertEv("tidak-dikenal", false)})
	if len(db.calls) != 1 {
		t.Fatalf("jenis tak didukung dilewati; got %d panggilan", len(db.calls))
	}
	if db.calls[0].args[2] != nil {
		t.Errorf("customer kosong harus NULL, got %v", db.calls[0].args[2])
	}
}

func TestFailureIsLoggedAndDoesNotStopTheBatch(t *testing.T) {
	db := &recordingExec{err: errors.New("db mati")}
	NewAlertWriter(db, persistLogger).Record(context.Background(), []Event{alertEv("offline", true), alertEv("offline", false)})
	if len(db.calls) != 2 {
		t.Fatalf("event berikutnya tetap dicoba; got %d panggilan", len(db.calls))
	}
}

func TestCloseStale(t *testing.T) {
	db := &recordingExec{rows: []int64{3}}
	now := time.Now()
	n, err := NewAlertWriter(db, persistLogger).CloseStale(context.Background(), now, now.Add(-time.Minute))
	if err != nil || n != 3 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if !strings.Contains(db.calls[0].sql, "updated_at < $2") {
		t.Errorf("hanya yang tidak disentuh sejak boot: %s", db.calls[0].sql)
	}
}

func TestSaveOLTAlarm(t *testing.T) {
	// 1. Insert when no active alert
	db := &recordingExec{rows: []int64{0}}
	w := NewAlertWriter(db, persistLogger)
	err := w.SaveOLTAlarm(context.Background(), OLTAlarmEvent{
		OLTIP:    "10.0.0.10",
		Type:     "fiber_cut",
		Severity: "critical",
		Status:   "active",
		PonPort:  "0/1",
		OnuID:    "3",
		RawMsg:   "LOS alarm",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.calls) != 2 {
		t.Fatalf("harus touch lalu insert, got %d calls", len(db.calls))
	}
	if !strings.Contains(db.calls[0].sql, "UPDATE alerts SET updated_at") {
		t.Errorf("call 0 bukan touch: %s", db.calls[0].sql)
	}
	if !strings.Contains(db.calls[1].sql, "INSERT INTO alerts") {
		t.Errorf("call 1 bukan insert: %s", db.calls[1].sql)
	}
	if db.calls[1].args[0] != "optical" {
		t.Errorf("alert type harus optical, got %v", db.calls[1].args[0])
	}

	// 2. Touch when active alert already exists
	dbTouch := &recordingExec{rows: []int64{1}}
	wTouch := NewAlertWriter(dbTouch, persistLogger)
	err = wTouch.SaveOLTAlarm(context.Background(), OLTAlarmEvent{
		OLTIP:    "10.0.0.10",
		Type:     "fiber_cut",
		Severity: "critical",
		Status:   "active",
		PonPort:  "0/1",
		OnuID:    "3",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(dbTouch.calls) != 1 {
		t.Fatalf("harus touch saja tanpa insert ulang, got %d calls", len(dbTouch.calls))
	}

	// 3. Resolve alert
	dbResolve := &recordingExec{rows: []int64{1}}
	wResolve := NewAlertWriter(dbResolve, persistLogger)
	err = wResolve.SaveOLTAlarm(context.Background(), OLTAlarmEvent{
		OLTIP:   "10.0.0.10",
		Status:  "resolved",
		PonPort: "0/1",
		OnuID:   "3",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(dbResolve.calls) != 1 || !strings.Contains(dbResolve.calls[0].sql, "status = 'resolved'") {
		t.Fatalf("harus update resolve, calls=%+v", dbResolve.calls)
	}
}

func TestSaveOLTAlarmPostgres(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL tidak diatur; jalankan lewat npm test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	w := NewAlertWriter(pool, persistLogger)
	oltIP := "10.254.254.1"
	pon := "0/1"
	onu := "99"

	// Bersihkan data uji sebelumnya jika ada
	_, _ = pool.Exec(ctx, `DELETE FROM alerts WHERE detail->>'source' = 'syslog_olt' AND detail->>'olt_ip' = $1`, oltIP)
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM alerts WHERE detail->>'source' = 'syslog_olt' AND detail->>'olt_ip' = $1`, oltIP)
	}()

	// 1. Sisip alarm LOS aktif
	err = w.SaveOLTAlarm(ctx, OLTAlarmEvent{
		OLTIP:    oltIP,
		Type:     "fiber_cut",
		Severity: "critical",
		Status:   "active",
		PonPort:  pon,
		OnuID:    onu,
		RawMsg:   "ONU 0/1:99 LOS",
	})
	if err != nil {
		t.Fatalf("sisip pertama gagal: %v", err)
	}

	var count int
	var status, severity string
	err = pool.QueryRow(ctx, `SELECT count(*), status, severity FROM alerts
		WHERE detail->>'source' = 'syslog_olt' AND detail->>'olt_ip' = $1 AND detail->>'pon' = $2 AND detail->>'onu' = $3
		GROUP BY status, severity`, oltIP, pon, onu).Scan(&count, &status, &severity)
	if err != nil || count != 1 || status != "active" || severity != "critical" {
		t.Fatalf("setelah sisip: count=%d, status=%s, sev=%s, err=%v", count, status, severity, err)
	}

	// 2. Kirim ulang alarm LOS yang sama (harus touch tanpa menambah baris)
	err = w.SaveOLTAlarm(ctx, OLTAlarmEvent{
		OLTIP:    oltIP,
		Type:     "fiber_cut",
		Severity: "critical",
		Status:   "active",
		PonPort:  pon,
		OnuID:    onu,
		RawMsg:   "ONU 0/1:99 LOS repeat",
	})
	if err != nil {
		t.Fatalf("touch ulang gagal: %v", err)
	}

	var totalRows int
	err = pool.QueryRow(ctx, `SELECT count(*) FROM alerts
		WHERE detail->>'source' = 'syslog_olt' AND detail->>'olt_ip' = $1 AND detail->>'pon' = $2 AND detail->>'onu' = $3`,
		oltIP, pon, onu).Scan(&totalRows)
	if err != nil || totalRows != 1 {
		t.Fatalf("deduplikasi gagal: ada %d baris, harusnya 1", totalRows)
	}

	// 3. Pulihkan alarm (resolve)
	err = w.SaveOLTAlarm(ctx, OLTAlarmEvent{
		OLTIP:   oltIP,
		Status:  "resolved",
		PonPort: pon,
		OnuID:   onu,
	})
	if err != nil {
		t.Fatalf("resolve gagal: %v", err)
	}

	var resolvedStatus string
	var endedAt *time.Time
	err = pool.QueryRow(ctx, `SELECT status, ended_at FROM alerts
		WHERE detail->>'source' = 'syslog_olt' AND detail->>'olt_ip' = $1 AND detail->>'pon' = $2 AND detail->>'onu' = $3`,
		oltIP, pon, onu).Scan(&resolvedStatus, &endedAt)
	if err != nil || resolvedStatus != "resolved" || endedAt == nil {
		t.Fatalf("status setelah resolve salah: status=%s endedAt=%v err=%v", resolvedStatus, endedAt, err)
	}
}
