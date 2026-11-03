package netflow

import (
	"context"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SQL penyimpan agregat ke PostgreSQL sungguhan (migrasi 0036).
// Dilewati bila TEST_DATABASE_URL tidak diatur; jalankan lewat npm test.
func TestAggregatorStorePostgres(t *testing.T) {
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
	var routerID, customerID string
	if err := pool.QueryRow(ctx, `INSERT INTO routers (name, host, username, password_enc)
		VALUES ('nf-uji', 'nf-uji-' || gen_random_uuid(), 'x', 'x') RETURNING id`).Scan(&routerID); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM routers WHERE id = $1`, routerID)
	if err := pool.QueryRow(ctx, `INSERT INTO customers (name, pppoe_username, router_id)
		VALUES ('nf', 'nf-' || gen_random_uuid(), $1) RETURNING id`, routerID).Scan(&customerID); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM customers WHERE id = $1`, customerID)

	a := NewAggregator(nil, pool, 7*24*time.Hour, slog.New(slog.NewTextHandler(io.Discard, nil)))
	bucket := time.Now().UTC().Truncate(BucketSize)
	a.store(ctx, []Row{
		{Bucket: bucket, RouterID: routerID, CustomerID: customerID, Direction: "down", SrcIP: "142.250.0.1", DstIP: "172.16.0.9", Port: 443, Proto: "TCP", Bytes: 5_000_000_000, Packets: 9, Flows: 3},
		{Bucket: bucket.Add(-8 * 24 * time.Hour), RouterID: routerID, CustomerID: customerID, Direction: "up", SrcIP: "172.16.0.9", DstIP: "0.0.0.0", Port: 0, Proto: "lainnya", Bytes: 1, Packets: 1, Flows: 1},
	})
	var n int
	var bytes int64
	if err := pool.QueryRow(ctx, `SELECT count(*), max(bytes) FROM netflow_samples WHERE customer_id = $1`, customerID).Scan(&n, &bytes); err != nil {
		t.Fatal(err)
	}
	if n != 2 || bytes != 5_000_000_000 {
		t.Fatalf("tersimpan %d baris, bytes %d", n, bytes)
	}
	a.purge(ctx)
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM netflow_samples WHERE customer_id = $1`, customerID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("sesudah retensi tersisa %d baris, mau 1", n)
	}
}
