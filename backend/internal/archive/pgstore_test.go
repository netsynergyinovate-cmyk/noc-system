package archive

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Test ini memakai PostgreSQL sungguhan dengan skema proyek (migrasi 0004).
// Dijalankan otomatis oleh `npm test` (yang menyiapkan database sekali pakai)
// dan dilewati bila TEST_DATABASE_URL tidak diatur.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL tidak diatur; jalankan lewat npm test")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("buka pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// newRouter mendaftarkan router uji dan menghapusnya (beserta arsipnya) di akhir.
func newRouter(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	host := fmt.Sprintf("10.250.%d.%d", time.Now().UnixNano()%250, time.Now().UnixNano()/1000%250)
	err := pool.QueryRow(context.Background(),
		`INSERT INTO routers (name, host, username, password_enc) VALUES ('Uji arsip', $1, 'api', 'enc') RETURNING id::text`,
		host+fmt.Sprint(time.Now().UnixNano()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("buat router uji: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM routers WHERE id = $1`, id)
	})
	return id
}

func countRows(t *testing.T, pool *pgxpool.Pool, routerID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM traffic_samples WHERE router_id = $1`, routerID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPGStoreInsertsAndReplacesSamples(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	router := newRouter(t, pool)
	ctx := context.Background()
	at := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)

	written, err := store.Insert(ctx, []Sample{
		{RouterID: router, At: at, RxMbps: 120.5, TxMbps: 20.25},
		{RouterID: router, At: at.Add(time.Second), RxMbps: 121, TxMbps: 21},
	})
	if err != nil || written != 2 {
		t.Fatalf("Insert = %d, %v; want 2, nil", written, err)
	}

	// Menulis ulang detik yang sama menggantikan nilainya dan tidak menambah baris.
	if written, err = store.Insert(ctx, []Sample{{RouterID: router, At: at, RxMbps: 130, TxMbps: 30}}); err != nil || written != 1 {
		t.Fatalf("Insert ulang = %d, %v", written, err)
	}
	if n := countRows(t, pool, router); n != 2 {
		t.Errorf("jumlah baris = %d, want 2", n)
	}
	var rx, tx float64
	if err := pool.QueryRow(ctx,
		`SELECT rx_mbps, tx_mbps FROM traffic_samples WHERE router_id = $1 AND sampled_at = $2`, router, at).Scan(&rx, &tx); err != nil {
		t.Fatal(err)
	}
	if rx != 130 || tx != 30 {
		t.Errorf("nilai = %v/%v, want 130/30 (yang terbaru)", rx, tx)
	}

	if written, err := store.Insert(ctx, nil); err != nil || written != 0 {
		t.Errorf("batch kosong = %d, %v; want 0, nil", written, err)
	}
}

func TestPGStoreSkipsUnknownRoutersWithoutFailingTheBatch(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	known := newRouter(t, pool)
	at := time.Date(2026, 10, 7, 11, 0, 0, 0, time.UTC)

	written, err := store.Insert(context.Background(), []Sample{
		{RouterID: known, At: at, RxMbps: 1, TxMbps: 1},
		{RouterID: "99999999-9999-4999-8999-999999999999", At: at, RxMbps: 1, TxMbps: 1}, // tidak ada di tabel routers
		{RouterID: known, At: at.Add(time.Second), RxMbps: 2, TxMbps: 2},
	})
	if err != nil {
		t.Fatalf("satu router yang belum terdaftar menggagalkan seluruh batch: %v", err)
	}
	if written != 2 || countRows(t, pool, known) != 2 {
		t.Errorf("tersimpan = %d, baris = %d; want 2 dan 2", written, countRows(t, pool, known))
	}
}

func TestPGStoreRejectsABatchWithAnInvalidRouterIDWithoutPanicking(t *testing.T) {
	store := NewPGStore(testPool(t))
	_, err := store.Insert(context.Background(), []Sample{{RouterID: "bukan-uuid", At: time.Now(), RxMbps: 1, TxMbps: 1}})
	if err == nil {
		t.Error("ID router yang bukan UUID seharusnya menghasilkan error")
	}
}

func TestPGStoreHandlesAFullBatch(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	router := newRouter(t, pool)
	start := time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC)

	samples := make([]Sample, defaultBatchSize)
	for i := range samples {
		samples[i] = Sample{RouterID: router, At: start.Add(time.Duration(i) * time.Second), RxMbps: float64(i), TxMbps: 1}
	}
	written, err := store.Insert(context.Background(), samples)
	if err != nil || written != defaultBatchSize {
		t.Fatalf("Insert = %d, %v; want %d, nil", written, err, defaultBatchSize)
	}
	if n := countRows(t, pool, router); n != defaultBatchSize {
		t.Errorf("baris = %d, want %d", n, defaultBatchSize)
	}
}

func TestPGStorePurgeRemovesOnlyOldSamplesInBatches(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	router := newRouter(t, pool)
	now := time.Now().UTC().Truncate(time.Second)

	// 10 sampel lama (lebih dari 30 hari) dan 3 yang masih baru.
	var samples []Sample
	for i := 0; i < 10; i++ {
		samples = append(samples, Sample{RouterID: router, At: now.Add(-40*24*time.Hour + time.Duration(i)*time.Second), RxMbps: 1, TxMbps: 1})
	}
	for _, age := range []time.Duration{29 * 24 * time.Hour, time.Hour, 0} {
		samples = append(samples, Sample{RouterID: router, At: now.Add(-age), RxMbps: 1, TxMbps: 1})
	}
	if _, err := store.Insert(context.Background(), samples); err != nil {
		t.Fatal(err)
	}

	// Batch 3 memaksa beberapa putaran hapus (3 + 3 + 3 + 1).
	deleted, err := store.Purge(context.Background(), now.Add(-30*24*time.Hour), 3)
	if err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if deleted != 10 {
		t.Errorf("terhapus = %d, want 10", deleted)
	}
	if n := countRows(t, pool, router); n != 3 {
		t.Errorf("baris setelah Purge = %d, want 3 (yang berumur kurang dari 30 hari)", n)
	}

	// Tidak ada lagi yang lama: aman dijalankan ulang.
	if again, err := store.Purge(context.Background(), now.Add(-30*24*time.Hour), 3); err != nil || again != 0 {
		t.Errorf("Purge ulang = %d, %v; want 0, nil", again, err)
	}
}

func TestPGStorePurgeRefusesACutoffThatWouldDeleteRecentData(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	router := newRouter(t, pool)
	now := time.Now().UTC().Truncate(time.Second)
	if _, err := store.Insert(context.Background(), []Sample{{RouterID: router, At: now.Add(-time.Hour), RxMbps: 1, TxMbps: 1}}); err != nil {
		t.Fatal(err)
	}
	for _, cutoff := range []time.Time{now, now.Add(time.Hour), now.Add(-time.Hour), now.Add(-23 * time.Hour)} {
		if _, err := store.Purge(context.Background(), cutoff, 10); err == nil {
			t.Errorf("batas %v seharusnya ditolak (lebih baru dari masa simpan minimum)", cutoff)
		}
	}
	if n := countRows(t, pool, router); n != 1 {
		t.Errorf("baris = %d, want 1: data yang masih dipakai ikut terhapus", n)
	}
}

func TestPGStoreApplyRetentionOnPlainPostgresChangesNothing(t *testing.T) {
	pool := testPool(t)
	var hasTimescale bool
	if err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')`).Scan(&hasTimescale); err != nil {
		t.Fatal(err)
	}
	if hasTimescale {
		t.Skip("database ini memakai TimescaleDB; lihat TestPGStoreApplyRetentionManagesTheTimescalePolicy")
	}
	store := NewPGStore(pool)
	for _, enforce := range []bool{false, true} {
		managed, err := store.ApplyRetention(context.Background(), 7*24*time.Hour, enforce)
		if err != nil {
			t.Fatalf("ApplyRetention(enforce=%v): %v", enforce, err)
		}
		if managed {
			t.Errorf("ApplyRetention(enforce=%v) = true pada PostgreSQL biasa; penulis yang harus menghapus", enforce)
		}
	}
}

// Hanya berjalan pada database TimescaleDB (migrasi 0004 membuat hypertable
// dengan retensi 30 hari). Dilewati pada PostgreSQL biasa.
func TestPGStoreApplyRetentionManagesTheTimescalePolicy(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	var isHypertable bool
	err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')`).Scan(&isHypertable)
	if err != nil || !isHypertable {
		t.Skip("memerlukan TimescaleDB")
	}
	store := NewPGStore(pool)
	// Dibandingkan sebagai detik: "7 days" dan "168:00:00" adalah interval yang sama.
	dropAfter := func() time.Duration {
		var seconds float64
		if err := pool.QueryRow(ctx, `SELECT extract(epoch FROM (config->>'drop_after')::interval) FROM timescaledb_information.jobs
			WHERE hypertable_name = 'traffic_samples' AND proc_name = 'policy_retention'`).Scan(&seconds); err != nil {
			t.Fatal(err)
		}
		return time.Duration(seconds) * time.Second
	}
	jobID := func() int {
		var id int
		if err := pool.QueryRow(ctx, `SELECT job_id FROM timescaledb_information.jobs
			WHERE hypertable_name = 'traffic_samples' AND proc_name = 'policy_retention'`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}

	// Tanpa enforce: kebijakan bawaan migrasi (30 hari) dibiarkan walau berbeda.
	if managed, err := store.ApplyRetention(ctx, 7*24*time.Hour, false); err != nil || !managed {
		t.Fatalf("ApplyRetention(false) = %v, %v; want true, nil", managed, err)
	}
	if got := dropAfter(); got != 30*24*time.Hour {
		t.Errorf("kebijakan = %s setelah enforce=false, want tetap 30 hari", got)
	}

	// Dengan enforce: kebijakan disamakan dengan masa simpan yang diminta.
	if managed, err := store.ApplyRetention(ctx, 7*24*time.Hour, true); err != nil || !managed {
		t.Fatalf("ApplyRetention(true) = %v, %v; want true, nil", managed, err)
	}
	if got := dropAfter(); got != 7*24*time.Hour {
		t.Errorf("kebijakan = %s, want 7 hari", got)
	}

	// Sudah sama: tidak diganti lagi (job yang sama).
	before := jobID()
	if _, err := store.ApplyRetention(ctx, 7*24*time.Hour, true); err != nil {
		t.Fatal(err)
	}
	if jobID() != before {
		t.Error("kebijakan yang sudah sama diganti ulang tanpa perlu")
	}

	// Kembalikan ke 30 hari agar tidak memengaruhi test lain.
	if _, err := store.ApplyRetention(ctx, 30*24*time.Hour, true); err != nil {
		t.Fatal(err)
	}
	if got := dropAfter(); got != 30*24*time.Hour {
		t.Errorf("kebijakan = %s setelah dikembalikan, want 30 hari", got)
	}
}

// Writer dan penyimpanan PostgreSQL bersama-sama: dari Enqueue sampai baris di
// tabel, termasuk penyimpanan akhir saat berhenti.
func TestWriterToPostgresEndToEnd(t *testing.T) {
	pool := testPool(t)
	router := newRouter(t, pool)
	w := newWriter(NewPGStore(pool), func(o *Options) { o.FlushInterval = time.Hour })
	stop := run(t, w)

	start := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 300; i++ { // satu jendela 5 menit pada 1 sampel per detik
		w.Enqueue(router, start.Add(time.Duration(i)*time.Second), float64(i), 1)
	}
	w.Enqueue(router, start, 777, 1) // menimpa detik pertama
	stop()

	if n := countRows(t, pool, router); n != 300 {
		t.Errorf("baris = %d, want 300", n)
	}
	var rx float64
	if err := pool.QueryRow(context.Background(),
		`SELECT rx_mbps FROM traffic_samples WHERE router_id = $1 AND sampled_at = $2`, router, start).Scan(&rx); err != nil {
		t.Fatal(err)
	}
	if rx != 777 {
		t.Errorf("rx detik pertama = %v, want 777 (yang terakhir menang)", rx)
	}
	if s := w.Stats(); s.Written != 300 || s.Failures != 0 || s.Skipped != 0 {
		t.Errorf("Stats = %+v", s)
	}
}
