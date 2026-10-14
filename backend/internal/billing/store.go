package billing

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Galat penyimpanan dibedakan dengan errors.Is.
var (
	// ErrRunInProgress berarti sudah ada sinkron yang berjalan; indeks unik parsial
	// billing_sync_runs_running_unique menolak baris running kedua.
	ErrRunInProgress = errors.New("billing: sudah ada sinkron yang berjalan")
	// ErrRunNotRunning berarti sinkron yang akan ditutup tidak ada atau sudah
	// selesai (berhasil atau gagal). Sebuah sinkron hanya bisa ditutup sekali.
	ErrRunNotRunning = errors.New("billing: sinkron tidak sedang berjalan")
	// ErrInconsistentResult berarti Result.Counts tidak sama dengan isi daftarnya.
	// Penyebabnya galat pemrograman (Result dirakit atau diubah tangan), dan log
	// sinkron akan berbohong bila tetap disimpan.
	ErrInconsistentResult = errors.New("billing: hitungan hasil tidak sama dengan isinya")
)

const (
	// RecoveredRunMessage adalah pesan sinkron yang ditinggalkan proses yang mati.
	RecoveredRunMessage = "Sinkron terputus karena backend dimulai ulang."
	// FallbackFailureMessage dipakai bila galat sinkron tidak punya teks yang bisa
	// dibaca (kosong atau hanya spasi).
	FallbackFailureMessage = "Sinkron gagal."
	// MaxErrorLength adalah batas panjang pesan galat dalam KARAKTER, sama dengan
	// check billing_sync_runs_error_check (char_length).
	MaxErrorLength = 500

	runningUniqueIndex = "billing_sync_runs_running_unique"
	pgCheckViolation   = "23514"
	pgUniqueViolation  = "23505"
)

// Trigger menyebut siapa yang memulai sebuah sinkron (kolom trigger).
type Trigger string

const (
	// TriggerSchedule adalah sinkron terjadwal tiap jam.
	TriggerSchedule Trigger = "schedule"
	// TriggerManual disediakan untuk tombol sinkron yang mungkin ditambahkan nanti.
	TriggerManual Trigger = "manual"
)

// DB adalah bagian pgxpool.Pool yang dipakai Store, supaya Store bisa diuji dan
// diganti. *pgxpool.Pool memenuhinya.
type DB interface {
	Begin(ctx context.Context) (pgx.Tx, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Store menyimpan hasil sinkron billing di PostgreSQL: log sinkron
// (billing_sync_runs), status tagihan terbaru per pelanggan (billing_status),
// salinan statusnya di customers.billing_status, dan tagihan yang tidak cocok
// (billing_mismatches). Store tidak menjadwalkan apa pun dan tidak tahu cara
// membaca billing; pemanggilnyalah yang menjalankan urutan LoadCustomers,
// scraper, MatchInvoices, BeginRun, lalu ApplySuccess atau FailRun.
type Store struct {
	db DB
}

// NewStore membungkus pool koneksi. Pool dibuat dan ditutup oleh pemanggil.
func NewStore(db DB) *Store { return &Store{db: db} }

// RecoverStaleRuns menandai SEMUA sinkron yang masih running sebagai failed
// dengan RecoveredRunMessage dan waktu selesai now, dan melaporkan berapa
// banyak. Panggil sekali saat backend mulai: proses yang mati di tengah sinkron
// meninggalkan baris running, yang akan menghalangi sinkron berikutnya lewat
// indeks unik. Waktu selesai tidak pernah lebih awal dari waktu mulainya.
func (s *Store) RecoverStaleRuns(ctx context.Context, now time.Time) (int, error) {
	tag, err := s.db.Exec(ctx, `
		UPDATE billing_sync_runs
		SET status = 'failed', finished_at = GREATEST($1::timestamptz, started_at), error_message = $2
		WHERE status = 'running'`, now, RecoveredRunMessage)
	if err != nil {
		return 0, wrapDB("pulihkan sinkron terputus", err)
	}
	return int(tag.RowsAffected()), nil
}

// BeginRun mencatat sinkron baru berstatus running dan mengembalikan ID-nya.
// Bila sudah ada yang berjalan, hasilnya ErrRunInProgress dan tidak ada baris
// baru; dua pemanggil bersamaan tidak pernah sama-sama berhasil.
func (s *Store) BeginRun(ctx context.Context, trigger Trigger, now time.Time) (string, error) {
	if trigger != TriggerSchedule && trigger != TriggerManual {
		return "", fmt.Errorf("billing: pemicu sinkron tidak dikenal: %q", string(trigger))
	}
	var id string
	err := s.db.QueryRow(ctx, `
		INSERT INTO billing_sync_runs (started_at, status, trigger)
		VALUES ($1::timestamptz, 'running', $2)
		RETURNING id::text`, now, string(trigger)).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == runningUniqueIndex {
			return "", ErrRunInProgress
		}
		return "", wrapDB("mulai sinkron", err)
	}
	return id, nil
}

// LoadCustomers membaca semua pelanggan untuk dicocokkan, terurut menurut ID.
func (s *Store) LoadCustomers(ctx context.Context) ([]Customer, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id::text, pppoe_username, billing_status FROM customers ORDER BY id`)
	if err != nil {
		return nil, wrapDB("baca pelanggan", err)
	}
	defer rows.Close()
	customers := []Customer{}
	for rows.Next() {
		var c Customer
		var status string
		if err := rows.Scan(&c.ID, &c.PPPoE, &status); err != nil {
			return nil, wrapDB("baca pelanggan", err)
		}
		c.Status = Status(status)
		customers = append(customers, c)
	}
	if err := rows.Err(); err != nil {
		return nil, wrapDB("baca pelanggan", err)
	}
	return customers, nil
}

// ApplySuccess menerapkan hasil pencocokan dan menutup sinkron runID sebagai
// success, semuanya dalam SATU transaksi: bila satu langkah gagal, tidak ada
// yang berubah dan sinkron tetap running (pemanggil lalu memanggil FailRun).
//
//  1. Menutup log: success, now sebagai waktu selesai, dan hitungan dari
//     res.Counts. Dilakukan lebih dulu supaya hitungan yang melanggar check
//     database ditolak sebelum menulis apa pun; urutan di dalam transaksi tidak
//     memengaruhi atomisitas.
//  2. Upsert billing_status untuk tiap Match (status, kode tagihan, waktu,
//     cara cocok, nama persis di billing, dan sinkronnya).
//  3. Menghapus baris billing_status pelanggan yang tidak ada di Matches
//     (pelanggan tanpa tagihan dan pelanggan yang tagihannya tidak cocok).
//     Sinkron yang tagihannya kosong karena gagal dibaca tidak boleh sampai ke
//     sini: pemanggil harus memeriksanya, karena hasil kosong menghapus semuanya.
//  4. Memperbarui customers.billing_status hanya untuk pelanggan di Changes, dan
//     hanya bila nilainya sungguh berbeda saat itu (Result yang sama diterapkan
//     dua kali tidak menyentuh baris pelanggan lagi).
//  5. Menyimpan Unmatched ke billing_mismatches.
//
// Pelanggan yang dihapus antara LoadCustomers dan ApplySuccess dilewati, bukan
// menggagalkan sinkron. Hasil lama sinkron-sinkron sebelumnya di
// billing_mismatches dibiarkan; PruneRuns yang membuangnya bersama sinkronnya.
func (s *Store) ApplySuccess(ctx context.Context, runID string, res Result, now time.Time) error {
	if want := countsOf(res); res.Counts != want {
		return fmt.Errorf("%w: Counts %+v, isi %+v", ErrInconsistentResult, res.Counts, want)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return wrapDB("mulai transaksi", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	c := res.Counts
	tag, err := tx.Exec(ctx, `
		UPDATE billing_sync_runs
		SET status = 'success', finished_at = GREATEST($2::timestamptz, started_at), error_message = NULL,
		    invoices_total = $3, matched_exact = $4, matched_normalized = $5,
		    unmatched_unknown = $6, unmatched_duplicate = $7, unmatched_ambiguous = $8,
		    customers_without_invoice = $9, statuses_changed = $10
		WHERE id = $1::uuid AND status = 'running'`,
		runID, now, c.Invoices, c.MatchedExact, c.MatchedNormalized,
		c.UnmatchedUnknown, c.UnmatchedDuplicate, c.UnmatchedAmbiguous,
		c.WithoutInvoice, c.StatusesChanged)
	if err != nil {
		return wrapDB("tutup sinkron", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrRunNotRunning
	}

	// Diurutkan menurut ID supaya dua penulis yang menyentuh baris yang sama
	// mengunci dalam urutan yang sama.
	matches := append([]Match(nil), res.Matches...)
	sort.Slice(matches, func(i, j int) bool { return matches[i].CustomerID < matches[j].CustomerID })
	ids := make([]string, len(matches))
	statuses := make([]string, len(matches))
	refs := make([]string, len(matches))
	kinds := make([]string, len(matches))
	names := make([]string, len(matches))
	for i, m := range matches {
		ids[i], statuses[i], refs[i] = m.CustomerID, string(m.Invoice.Status), m.Invoice.Ref
		kinds[i], names[i] = string(m.Kind), m.Invoice.Name
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO billing_status (customer_id, status, invoice_ref, synced_at, match_kind, billing_name, run_id)
		SELECT t.customer_id, t.status, NULLIF(t.invoice_ref, ''), $2::timestamptz, t.match_kind, t.billing_name, $1::uuid
		FROM unnest($3::text[]::uuid[], $4::text[], $5::text[], $6::text[], $7::text[])
		  AS t(customer_id, status, invoice_ref, match_kind, billing_name)
		WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = t.customer_id)
		ON CONFLICT (customer_id) DO UPDATE SET
		  status = EXCLUDED.status, invoice_ref = EXCLUDED.invoice_ref, synced_at = EXCLUDED.synced_at,
		  match_kind = EXCLUDED.match_kind, billing_name = EXCLUDED.billing_name, run_id = EXCLUDED.run_id`,
		runID, now, ids, statuses, refs, kinds, names); err != nil {
		return wrapDB("simpan status tagihan", err)
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM billing_status WHERE NOT (customer_id = ANY($1::text[]::uuid[]))`, ids); err != nil {
		return wrapDB("buang status pelanggan tanpa tagihan", err)
	}

	changes := append([]StatusChange(nil), res.Changes...)
	sort.Slice(changes, func(i, j int) bool { return changes[i].CustomerID < changes[j].CustomerID })
	changeIDs := make([]string, len(changes))
	changeTo := make([]string, len(changes))
	for i, ch := range changes {
		changeIDs[i], changeTo[i] = ch.CustomerID, string(ch.To)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE customers AS c SET billing_status = u.to_status
		FROM unnest($1::text[]::uuid[], $2::text[]) AS u(id, to_status)
		WHERE c.id = u.id AND c.billing_status IS DISTINCT FROM u.to_status`,
		changeIDs, changeTo); err != nil {
		return wrapDB("perbarui status pelanggan", err)
	}

	if len(res.Unmatched) > 0 {
		batch := &pgx.Batch{}
		for _, u := range res.Unmatched {
			candidates := u.CustomerIDs
			if candidates == nil {
				candidates = []string{}
			}
			batch.Queue(`
				INSERT INTO billing_mismatches (run_id, invoice_name, invoice_ref, invoice_status, reason, customer_ids)
				VALUES ($1::uuid, $2, NULLIF($3, ''), $4, $5, $6::text[]::uuid[])`,
				runID, u.Invoice.Name, u.Invoice.Ref, string(u.Invoice.Status), string(u.Reason), candidates)
		}
		results := tx.SendBatch(ctx, batch)
		for range res.Unmatched {
			if _, err := results.Exec(); err != nil {
				_ = results.Close()
				return wrapDB("simpan tagihan yang tidak cocok", err)
			}
		}
		if err := results.Close(); err != nil {
			return wrapDB("simpan tagihan yang tidak cocok", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return wrapDB("selesaikan transaksi", err)
	}
	return nil
}

// FailRun menandai sinkron runID sebagai failed pada waktu now. Pesannya teks
// cause.Error() dipangkas 500 KARAKTER (bukan byte), tanpa tambahan apa pun;
// scraper sudah menjamin teks galatnya tidak memuat rahasia. Pesan yang kosong
// atau hanya spasi diganti FallbackFailureMessage, karena database menolaknya.
// FailRun tidak menyentuh billing_status maupun customers.
func (s *Store) FailRun(ctx context.Context, runID string, cause error, now time.Time) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE billing_sync_runs
		SET status = 'failed', finished_at = GREATEST($2::timestamptz, started_at), error_message = $3
		WHERE id = $1::uuid AND status = 'running'`, runID, now, failureMessage(cause))
	if err != nil {
		return wrapDB("catat sinkron gagal", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrRunNotRunning
	}
	return nil
}

// failureMessage membuat teks yang lolos check database: UTF-8 yang sah, tanpa
// NUL, paling banyak MaxErrorLength karakter, dan memuat minimal satu karakter
// yang terlihat.
func failureMessage(cause error) string {
	if cause == nil {
		return FallbackFailureMessage
	}
	msg := strings.ToValidUTF8(cause.Error(), "�")
	msg = strings.ReplaceAll(msg, "\x00", "")
	msg = scrubSensitive(msg)
	if runes := []rune(msg); len(runes) > MaxErrorLength {
		msg = string(runes[:MaxErrorLength])
	}
	if !strings.ContainsFunc(msg, func(r rune) bool { return unicode.IsGraphic(r) && !unicode.IsSpace(r) }) {
		return FallbackFailureMessage
	}
	return msg
}

var (
	reURLCreds = regexp.MustCompile(`([A-Za-z][A-Za-z0-9+.\-]*://[^\s/:@]+):[^\s/@]+@`)
	reBearer   = regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/=\-]+`)
	reKeyValue = regexp.MustCompile(`(?i)\b(token|password|passwd|pwd|secret|api[_-]?key)(\s*[=:]\s*)[^\s&,;]+`)
)

// scrubSensitive menutup rahasia yang bisa terselip di teks galat sebelum
// disimpan ke log sinkron: kata sandi di URL, Bearer token, dan pasangan
// token/password/secret/api_key = nilai.
func scrubSensitive(s string) string {
	s = reURLCreds.ReplaceAllString(s, "$1:[REDACTED]@")
	s = reBearer.ReplaceAllString(s, "Bearer [REDACTED]")
	return reKeyValue.ReplaceAllString(s, "$1$2[REDACTED]")
}

// PruneRuns membuang sinkron selesai yang lama dan melaporkan berapa yang
// dibuang. Yang dipertahankan: keep sinkron selesai terbaru, DAN selalu sinkron
// success terbaru walau lebih tua (pembaca memakai hasilnya, dan
// billing_status mencerminkannya). Sinkron yang sedang berjalan tidak pernah
// dibuang. Ketidakcocokan sinkron yang dibuang ikut terhapus (cascade).
func (s *Store) PruneRuns(ctx context.Context, keep int) (int, error) {
	if keep < 0 {
		return 0, fmt.Errorf("billing: jumlah sinkron yang disimpan tidak boleh negatif: %d", keep)
	}
	tag, err := s.db.Exec(ctx, `
		DELETE FROM billing_sync_runs
		WHERE status <> 'running'
		  AND id NOT IN (
		    SELECT id FROM billing_sync_runs WHERE status <> 'running'
		    ORDER BY finished_at DESC, id DESC LIMIT $1)
		  AND id NOT IN (
		    SELECT id FROM billing_sync_runs WHERE status = 'success'
		    ORDER BY finished_at DESC, id DESC LIMIT 1)`, keep)
	if err != nil {
		return 0, wrapDB("pangkas riwayat sinkron", err)
	}
	return int(tag.RowsAffected()), nil
}

// SuccessRun meringkas sinkron success terbaru.
type SuccessRun struct {
	// Invoices adalah invoices_total: jumlah tagihan yang terbaca pada sinkron itu.
	Invoices int
	// FinishedAt adalah waktu selesainya (UTC).
	FinishedAt time.Time
}

// LastSuccess memberi ringkasan sinkron success terbaru. Bool kedua salah bila
// belum pernah ada sinkron yang berhasil (atau riwayatnya sudah kosong). Tidak
// mengubah apa pun. Dipakai penjaga hasil yang menyusut (pembanding jumlah
// tagihan) dan, lewat LastSuccessAt, penjadwal.
func (s *Store) LastSuccess(ctx context.Context) (SuccessRun, bool, error) {
	var r SuccessRun
	err := s.db.QueryRow(ctx, `
		SELECT invoices_total, finished_at FROM billing_sync_runs
		WHERE status = 'success'
		ORDER BY finished_at DESC, id DESC LIMIT 1`).Scan(&r.Invoices, &r.FinishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return SuccessRun{}, false, nil
	}
	if err != nil {
		return SuccessRun{}, false, wrapDB("baca sinkron sukses terakhir", err)
	}
	r.FinishedAt = r.FinishedAt.UTC()
	return r, true, nil
}

// LastSuccessAt memberi waktu selesai sinkron success terbaru. Bool kedua salah
// bila belum pernah ada sinkron yang berhasil (atau riwayatnya sudah kosong).
// Dipakai penjadwal untuk memutuskan perlu tidaknya sinkron susulan saat backend
// baru hidup; tidak mengubah apa pun.
func (s *Store) LastSuccessAt(ctx context.Context) (time.Time, bool, error) {
	r, ok, err := s.LastSuccess(ctx)
	return r.FinishedAt, ok, err
}

// FinishedRun meringkas satu sinkron yang sudah selesai.
type FinishedRun struct {
	// Success benar bila statusnya success, salah bila failed.
	Success bool
	// StartedAt dan FinishedAt dalam UTC.
	StartedAt, FinishedAt time.Time
	// Message adalah error_message; kosong pada sinkron yang berhasil.
	Message string
}

// RecentFinishedRuns memberi paling banyak limit sinkron selesai (berhasil atau
// gagal; yang masih running tidak ikut), terbaru lebih dulu. limit harus positif.
// Dipakai penjadwal saat backend dimulai untuk menghitung ulang kegagalan login
// beruntun dari log, supaya mulai ulang tidak menghapus perlindungannya.
func (s *Store) RecentFinishedRuns(ctx context.Context, limit int) ([]FinishedRun, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("billing: jumlah sinkron yang dibaca harus positif: %d", limit)
	}
	rows, err := s.db.Query(ctx, `
		SELECT status = 'success', started_at, finished_at, coalesce(error_message, '')
		FROM billing_sync_runs
		WHERE status <> 'running'
		ORDER BY finished_at DESC, id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, wrapDB("baca sinkron selesai terakhir", err)
	}
	defer rows.Close()
	runs := []FinishedRun{}
	for rows.Next() {
		var r FinishedRun
		if err := rows.Scan(&r.Success, &r.StartedAt, &r.FinishedAt, &r.Message); err != nil {
			return nil, wrapDB("baca sinkron selesai terakhir", err)
		}
		r.StartedAt, r.FinishedAt = r.StartedAt.UTC(), r.FinishedAt.UTC()
		runs = append(runs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, wrapDB("baca sinkron selesai terakhir", err)
	}
	return runs, nil
}

// wrapDB membungkus galat database dengan nama langkahnya. Pelanggaran check
// menyebut nama check-nya supaya jelas aturan mana yang dilanggar. Teks galat pgx
// hanya memuat pesan dan kode, bukan nilai baris.
func wrapDB(step string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgCheckViolation {
		return fmt.Errorf("billing: %s melanggar aturan database %q: %w", step, pgErr.ConstraintName, err)
	}
	return fmt.Errorf("billing: %s: %w", step, err)
}
