package archive

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// insertSQL menyimpan satu batch dalam satu perintah. Sampel milik router yang
// tidak ada di tabel routers dilewati lewat EXISTS (bila tidak, satu router yang
// belum terdaftar akan menggagalkan seluruh batch karena kunci asing). Detik
// yang sudah ada diganti: penulis boleh mengulang tanpa membuat baris ganda.
const insertSQL = `
INSERT INTO traffic_samples (router_id, sampled_at, rx_mbps, tx_mbps)
SELECT t.router_id, t.sampled_at, t.rx_mbps, t.tx_mbps
FROM unnest($1::uuid[], $2::timestamptz[], $3::float8[], $4::float8[])
  AS t(router_id, sampled_at, rx_mbps, tx_mbps)
WHERE EXISTS (SELECT 1 FROM routers r WHERE r.id = t.router_id)
ON CONFLICT (router_id, sampled_at)
DO UPDATE SET rx_mbps = EXCLUDED.rx_mbps, tx_mbps = EXCLUDED.tx_mbps`

// PGStore menyimpan arsip di PostgreSQL (dengan atau tanpa TimescaleDB).
type PGStore struct {
	pool *pgxpool.Pool
}

// NewPGStore membungkus pool koneksi. Pool dibuat dan ditutup oleh pemanggil.
func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

// Insert menyimpan batch dengan satu perintah SQL.
func (s *PGStore) Insert(ctx context.Context, samples []Sample) (int, error) {
	if len(samples) == 0 {
		return 0, nil
	}
	routers := make([]pgtype.UUID, len(samples))
	times := make([]time.Time, len(samples))
	rx := make([]float64, len(samples))
	tx := make([]float64, len(samples))
	for i, sample := range samples {
		if err := routers[i].Scan(sample.RouterID); err != nil {
			return 0, fmt.Errorf("router %q bukan UUID: %w", sample.RouterID, err)
		}
		times[i], rx[i], tx[i] = sample.At, sample.RxMbps, sample.TxMbps
	}
	tag, err := s.pool.Exec(ctx, insertSQL, routers, times, rx, tx)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// maxPurgeBatches membatasi kerja satu pembersihan (200 batch, sekitar 10 juta
// baris pada batch bawaan); sisanya dilanjutkan pada putaran berikutnya.
const maxPurgeBatches = 200

// ApplyRetention melaporkan apakah database sendiri yang membersihkan data
// lama, yaitu hypertable TimescaleDB dengan kebijakan retensi. Bila enforce
// benar, kebijakan itu disamakan dengan retention (dibuat bila hypertable belum
// punya, diganti bila berbeda); bila salah, kebijakan yang ada tidak disentuh.
// Pada PostgreSQL biasa hasilnya false dan tidak ada yang diubah.
func (s *PGStore) ApplyRetention(ctx context.Context, retention time.Duration, enforce bool) (bool, error) {
	// View timescaledb_information.* tidak ada tanpa ekstensi, dan query yang
	// menyebutnya gagal saat di-parse; jadi periksa ekstensi dulu, terpisah.
	var hasTimescale bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')`,
	).Scan(&hasTimescale); err != nil {
		return false, err
	}
	if !hasTimescale {
		return false, nil
	}

	var hypertable bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'traffic_samples')`,
	).Scan(&hypertable); err != nil {
		return false, err
	}
	if !hypertable {
		return false, nil
	}

	interval := fmt.Sprintf("%d seconds", int64(retention.Seconds()))
	var hasPolicy, policyMatches bool
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) > 0, coalesce(bool_and((config->>'drop_after')::interval = $1::interval), false)
		FROM timescaledb_information.jobs
		WHERE hypertable_name = 'traffic_samples' AND proc_name = 'policy_retention'`, interval,
	).Scan(&hasPolicy, &policyMatches); err != nil {
		return false, err
	}
	if hasPolicy && (policyMatches || !enforce) {
		return true, nil
	}
	if !hasPolicy && !enforce {
		return false, nil // hypertable tanpa kebijakan: penulis yang menghapus
	}

	// Ganti kebijakan dalam satu transaksi supaya tidak ada saat tanpa kebijakan.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT remove_retention_policy('traffic_samples', if_exists => true)`); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `SELECT add_retention_policy('traffic_samples', $1::interval)`, interval); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

// Purge menghapus sampel yang lebih tua dari before, sebanyak batch baris per
// perintah, sampai habis atau mencapai maxPurgeBatches. Penghapusan lewat kunci
// utama, bukan ctid: pada hypertable ctid dari chunk berbeda bisa bertabrakan.
// Batas waktu yang lebih baru dari MinRetention ditolak, supaya kesalahan
// menghitung waktu tidak bisa menghapus data yang masih dipakai.
func (s *PGStore) Purge(ctx context.Context, before time.Time, batch int) (int64, error) {
	if before.After(time.Now().Add(-MinRetention)) {
		return 0, fmt.Errorf("batas hapus %s lebih baru dari masa simpan minimum %s; ditolak",
			before.UTC().Format(time.RFC3339), MinRetention)
	}
	if batch <= 0 {
		batch = defaultPurgeBatch
	}
	var total int64
	for i := 0; i < maxPurgeBatches; i++ {
		tag, err := s.pool.Exec(ctx, `
			DELETE FROM traffic_samples t
			USING (SELECT router_id, sampled_at FROM traffic_samples
			       WHERE sampled_at < $1 ORDER BY sampled_at LIMIT $2) old
			WHERE t.router_id = old.router_id AND t.sampled_at = old.sampled_at`, before, batch)
		if err != nil {
			return total, err
		}
		n := tag.RowsAffected()
		total += n
		if n < int64(batch) {
			return total, nil
		}
		select { // beri napas pada database di antara batch
		case <-ctx.Done():
			return total, ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
	return total, nil
}
