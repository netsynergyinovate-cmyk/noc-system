package netflow

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestReaderQueriesPostgres(t *testing.T) {
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

	var routerID, customerID, oltID string
	if err := pool.QueryRow(ctx, `INSERT INTO routers (name, host, username, password_enc)
		VALUES ('rtr-read-test', 'nf-uji-' || gen_random_uuid(), 'x', 'x') RETURNING id`).Scan(&routerID); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM routers WHERE id = $1`, routerID)

	if err := pool.QueryRow(ctx, `INSERT INTO customers (name, pppoe_username, router_id, odp_name)
		VALUES ('Pelanggan Uji Netflow', 'user-nf-' || gen_random_uuid(), $1, 'ODP-TEST-01') RETURNING id`, routerID).Scan(&customerID); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM customers WHERE id = $1`, customerID)

	if err := pool.QueryRow(ctx, `INSERT INTO olts (name, host, brand, driver, username, password_enc)
		VALUES ('olt-read-test', 'olt-uji-' || gen_random_uuid(), 'hsgq', 'hsgq', 'x', 'x') RETURNING id`).Scan(&oltID); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM olts WHERE id = $1`, oltID)

	_, err = pool.Exec(ctx, `INSERT INTO olt_onus (olt_id, pon_index, onu_index, customer_id, description)
		VALUES ($1, 3, 1, $2, 'ONU-TEST-01')`, oltID, customerID)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM olt_onus WHERE customer_id = $1`, customerID)
	// Masukkan sampel netflow uji
	now := time.Now().UTC()
	_, err = pool.Exec(ctx, `
		INSERT INTO netflow_samples (router_id, customer_id, direction, src_ip, dst_ip, src_port, dst_port, protocol, bytes, packets, flows, captured_at)
		VALUES
		($1, $2, 'down', '1.1.1.1', '10.10.1.2', 443, 54321, 'TCP', 1000000, 100, 10, $3),
		($1, $2, 'up', '10.10.1.2', '1.1.1.1', 54321, 443, 'TCP', 200000, 20, 2, $3)
	`, routerID, customerID, now)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM netflow_samples WHERE customer_id = $1`, customerID)

	r := NewReader(pool)

	// 1. Uji Summary
	summary, err := r.Summary(ctx, "1h", routerID)
	if err != nil {
		t.Fatalf("Summary failed: %v", err)
	}
	if summary.RxBytes < 1000000 || summary.TxBytes < 200000 {
		t.Errorf("Summary rx/tx unexpected: %+v", summary)
	}

	// 2. Uji TopTalkers
	topTalkers, err := r.TopTalkers(ctx, "1h", routerID, 10)
	if err != nil {
		t.Fatalf("TopTalkers failed: %v", err)
	}
	if len(topTalkers) == 0 {
		t.Fatalf("TopTalkers empty, expected at least 1")
	}
	if topTalkers[0].CustomerID == nil || *topTalkers[0].CustomerID != customerID {
		t.Errorf("TopTalkers customerID mismatch: %+v", topTalkers[0])
	}

	// 3. Uji CustomerUsage
	usage, err := r.CustomerUsage(ctx, "1h", 10)
	if err != nil {
		t.Fatalf("CustomerUsage failed: %v", err)
	}
	if len(usage) == 0 {
		t.Fatalf("CustomerUsage empty, expected at least 1")
	}
	if usage[0].CustomerID != customerID || usage[0].TotalBytes < 1200000 {
		t.Errorf("CustomerUsage mismatch: %+v", usage[0])
	}
	expectedPeak := float64(1200000*8) / 300.0
	if usage[0].PeakThroughputBps == nil || *usage[0].PeakThroughputBps != expectedPeak {
		t.Errorf("Peak throughput salah: got %v, want %f", usage[0].PeakThroughputBps, expectedPeak)
	}
	if usage[0].PeakTime == nil {
		t.Errorf("PeakTime nil pada CustomerUsage")
	}
	// 4. Uji Sessions
	sessions, err := r.Sessions(ctx, SessionFilter{
		RangeStr:   "1h",
		RouterID:   routerID,
		CustomerID: customerID,
		Limit:      10,
	})
	if err != nil {
		t.Fatalf("Sessions failed: %v", err)
	}
	if len(sessions) < 2 {
		t.Errorf("Expected 2 sessions, got %d", len(sessions))
	}
	if sessions[0].PonPort == nil || *sessions[0].PonPort != "PON-3" {
		t.Errorf("Expected PonPort PON-3, got %v", sessions[0].PonPort)
	}

	// 5. Uji filter PonPort
	ponSessions, err := r.Sessions(ctx, SessionFilter{
		RangeStr: "1h",
		PonPort:  "PON-3",
		Limit:    10,
	})
	if err != nil {
		t.Fatalf("Sessions by PonPort failed: %v", err)
	}
	if len(ponSessions) < 2 {
		t.Errorf("Expected at least 2 sessions for PON-3, got %d", len(ponSessions))
	}
}
