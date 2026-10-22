package collector

import (
	"context"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Menjalankan SQL penulis syslog ke PostgreSQL sungguhan (migrasi 0034).
// Dilewati bila TEST_DATABASE_URL tidak diatur; jalankan lewat npm test.
func TestSyslogWriterPostgres(t *testing.T) {
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

	var routerID string
	err = pool.QueryRow(ctx, `INSERT INTO routers (name, host, username, password_enc)
		VALUES ('syslog-uji', 'syslog-uji-' || gen_random_uuid(), 'x', 'x') RETURNING id`).Scan(&routerID)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM routers WHERE id = $1`, routerID)

	w := NewSyslogWriter(pool, 14*24*time.Hour, slog.New(slog.NewTextHandler(io.Discard, nil)))
	old := time.Now().Add(-15 * 24 * time.Hour)
	w.write(ctx, []SyslogLine{
		{RouterID: routerID, ReceivedAt: time.Now(), Facility: -1, Severity: -1, Message: "tanpa pri"},
		{RouterID: routerID, ReceivedAt: old, Facility: 3, Severity: 6, Topics: "pppoe,ppp,info", Message: "lama"},
	})

	var total, nullPri int
	if err := pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE facility IS NULL AND severity IS NULL) FROM syslog_events WHERE router_id = $1`, routerID).Scan(&total, &nullPri); err != nil {
		t.Fatal(err)
	}
	if total != 2 || nullPri != 1 {
		t.Fatalf("tersimpan %d baris, %d tanpa PRI; mau 2 dan 1", total, nullPri)
	}

	w.purge(ctx)
	var message string
	if err := pool.QueryRow(ctx, `SELECT string_agg(message, ',') FROM syslog_events WHERE router_id = $1`, routerID).Scan(&message); err != nil {
		t.Fatal(err)
	}
	if message != "tanpa pri" {
		t.Fatalf("sesudah retensi tersisa %q, mau hanya baris baru", message)
	}
}
