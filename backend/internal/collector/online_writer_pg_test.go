package collector

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Menjalankan SQL event koneksi dan membuktikan aturan deduplikasi ke PostgreSQL sungguhan.
// Dilewati bila TEST_DATABASE_URL tidak diatur atau tabel customer_connection_events belum ada (migrasi 0038).
func TestOnlineWriterPostgresDeduplication(t *testing.T) {
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

	var reg *string
	if err := pool.QueryRow(ctx, `SELECT to_regclass('customer_connection_events')`).Scan(&reg); err != nil || reg == nil {
		t.Skip("tabel customer_connection_events belum ada (migrasi 0038 belum diterapkan)")
	}

	var routerID string
	err = pool.QueryRow(ctx, `INSERT INTO routers (name, host, username, password_enc)
		VALUES ('online-uji', 'online-uji-' || gen_random_uuid(), 'x', 'x') RETURNING id`).Scan(&routerID)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM routers WHERE id = $1`, routerID)

	var customerID string
	err = pool.QueryRow(ctx, `INSERT INTO customers (name, pppoe_username, router_id)
		VALUES ('cust-online', 'cust-online-' || gen_random_uuid(), $1) RETURNING id`, routerID).Scan(&customerID)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM customers WHERE id = $1::uuid`, customerID)

	w := NewOnlineWriter(pool, discard)
	t0 := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	w.now = func() time.Time { return t0 }

	// 1. Event pertama: down -> 1 baris
	w.writeChange(ctx, change(customerID, true, false))

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customer_connection_events WHERE customer_id = $1::uuid`, customerID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("setelah down pertama harus 1 baris, dapat %d", count)
	}

	// 2. Event down kedua berturut-turut (misal backend restart) -> tetap 1 baris (terdeduplikasi)
	w.now = func() time.Time { return t0.Add(5 * time.Minute) }
	w.writeChange(ctx, change(customerID, true, false))

	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customer_connection_events WHERE customer_id = $1::uuid`, customerID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("setelah down kedua harus tetap 1 baris (dedupe), dapat %d", count)
	}

	// 3. Event up -> 2 baris (down lalu up)
	w.now = func() time.Time { return t0.Add(10 * time.Minute) }
	w.writeChange(ctx, change(customerID, false, true))

	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customer_connection_events WHERE customer_id = $1::uuid`, customerID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("setelah transisi up harus 2 baris, dapat %d", count)
	}

	// 4. Event up kedua berturut-turut -> tetap 2 baris (terdeduplikasi)
	w.now = func() time.Time { return t0.Add(15 * time.Minute) }
	w.writeChange(ctx, change(customerID, false, true))

	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customer_connection_events WHERE customer_id = $1::uuid`, customerID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("setelah up kedua harus tetap 2 baris (dedupe), dapat %d", count)
	}

	// Periksa urutan dan jenis event
	var kinds []string
	rows, err := pool.Query(ctx, `SELECT kind FROM customer_connection_events WHERE customer_id = $1::uuid ORDER BY occurred_at ASC`, customerID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		kinds = append(kinds, k)
	}
	if len(kinds) != 2 || kinds[0] != "down" || kinds[1] != "up" {
		t.Fatalf("event harus ['down', 'up'], dapat %v", kinds)
	}
}
