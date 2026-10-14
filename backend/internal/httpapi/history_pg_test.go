package httpapi

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"noc-isp/backend/internal/archive"
)

// pgTestPool membuka pool ke database uji; test dilewati bila tidak ada.
func pgTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL tidak diatur; jalankan lewat npm test")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// insertRouter mendaftarkan router uji dan menghapusnya (beserta arsipnya) di akhir.
func insertRouter(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	host := fmt.Sprintf("10.251.%d.%d-%d", time.Now().UnixNano()%250, time.Now().UnixNano()/1000%250, time.Now().UnixNano())
	if err := pool.QueryRow(ctx,
		`INSERT INTO routers (name, host, username, password_enc) VALUES ($1, $2, 'api', 'enc') RETURNING id::text`,
		name, host).Scan(&id); err != nil {
		t.Fatalf("buat router uji: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM routers WHERE id = $1`, id) })
	return id
}

// Jalur lengkap: tiket, HTTP, PGStore, dan PostgreSQL sungguhan dengan skema
// proyek. Dijalankan otomatis oleh `npm test` (database sekali pakai) dan
// dilewati bila TEST_DATABASE_URL tidak diatur.
func TestHistoryEndToEndFromPostgres(t *testing.T) {
	ctx := context.Background()
	pool := pgTestPool(t)
	routerID := insertRouter(t, pool, "Uji histori HTTP")

	// 10 jam lalu, tepat di jam bulat: lebih baru dari masa simpan minimum arsip,
	// jadi pembersihan oleh test paket lain (yang berbagi database ini) tidak
	// bisa menghapusnya, dan tidak melewati batas "to di masa depan".
	start := time.Now().UTC().Add(-10 * time.Hour).Truncate(time.Hour)
	store := archive.NewPGStore(pool)
	samples := make([]archive.Sample, 0, 120)
	for i := 0; i < 120; i++ {
		samples = append(samples, archive.Sample{
			RouterID: routerID, At: start.Add(time.Duration(i) * time.Second), RxMbps: float64(100 + i), TxMbps: 10,
		})
	}
	if _, err := store.Insert(ctx, samples); err != nil {
		t.Fatal(err)
	}

	h := newAPIHarnessWithHistory(t, store)
	query := fmt.Sprintf("/api/v1/traffic/history?router=%s&step=60&from=%d&to=%d",
		routerID, start.Unix(), start.Add(3*time.Minute).Unix())
	rec := h.get(query)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body %s", rec.Code, rec.Body)
	}
	body := decode[historyBody](t, rec)
	// Menit pertama: 100..159 (rata-rata 129,5); menit kedua: 160..219 (189,5);
	// menit ketiga tidak punya sampel, jadi tidak muncul.
	if len(body.Data.Times) != 2 ||
		body.Data.Times[0] != start.Unix() || body.Data.Times[1] != start.Unix()+60 ||
		math.Abs(body.Data.Rx[0]-129.5) > 1e-9 || math.Abs(body.Data.Rx[1]-189.5) > 1e-9 ||
		body.Data.Tx[0] != 10 || body.Data.Step != 60 || body.Data.From != start.Unix() {
		t.Errorf("data = %+v", body.Data)
	}

	// Pintasan range=24h dengan langkah otomatis menjangkau data yang sama.
	rec = h.get("/api/v1/traffic/history?range=24h&router=" + routerID)
	if rec.Code != http.StatusOK {
		t.Fatalf("range=24h: status = %d; body %s", rec.Code, rec.Body)
	}
	body = decode[historyBody](t, rec)
	if body.Data.Step != 300 {
		t.Errorf("step = %d, want 300", body.Data.Step)
	}
	found := false
	for i, at := range body.Data.Times {
		if at == start.Unix() {
			// 120 detik terisi dari 300 detik bucket: rata-rata sampel yang ada.
			found = math.Abs(body.Data.Rx[i]-159.5) < 1e-9
		}
	}
	if !found {
		t.Errorf("bucket %s tidak ditemukan atau salah rata-rata (want 159,5): %+v", start, body.Data)
	}

	// Router lain yang valid tetapi tanpa data memberi larik kosong, bukan error.
	rec = h.get("/api/v1/traffic/history?range=1h&router=00000000-0000-4000-8000-000000000000")
	if rec.Code != http.StatusOK || decode[historyBody](t, rec).Data.Times == nil {
		t.Errorf("router tanpa data: status %d body %s", rec.Code, rec.Body)
	}
}
