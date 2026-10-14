package billing

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"noc-isp/backend/internal/wire"
)

// Pembaca status billing untuk endpoint GET /api/v1/billing dan
// GET /api/v1/billing/sync. Ia hanya MEMBACA: tidak menulis apa pun, tidak
// memanggil billing, dan tidak tahu kapan sinkron berikutnya (itu diberikan
// pemanggil sebagai nextRunAt, dari Scheduler.NextRunAt).

const (
	// HistoryRuns adalah jumlah sinkron selesai yang dilaporkan di riwayat, sama
	// dengan BILLING_HISTORY_RUNS di src/lib/dashboard/billing.ts.
	HistoryRuns = 24

	// unknownRouterName menggantikan nama router yang tidak ditemukan. Mustahil
	// terjadi (customers.router_id berkunci asing "restrict"); ada supaya satu
	// baris yatim tidak menjatuhkan seluruh halaman, dan kalimatnya sama dengan
	// data tiruan di frontend.
	unknownRouterName = "Router tidak dikenal"
)

// ErrInvalidData berarti baris di database melanggar kontrak yang dijaga check
// constraint-nya (mis. status di luar lunas/isolir). Pemanggil menjawab 500; jangan
// mengirim teks galatnya ke klien.
var ErrInvalidData = errors.New("billing: data di database tidak sah")

// ReadDB adalah bagian pgxpool.Pool yang dipakai Reader. *pgxpool.Pool
// memenuhinya. Dipisah dari DB supaya penulis (Store) tidak perlu BeginTx.
type ReadDB interface {
	BeginTx(ctx context.Context, txOptions pgx.TxOptions) (pgx.Tx, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// queryer adalah yang dibutuhkan satu pembacaan: pool atau transaksi.
type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Reader membaca status billing untuk dashboard.
type Reader struct {
	db ReadDB
}

// NewReader membungkus pool koneksi. Pool dibuat dan ditutup oleh pemanggil.
func NewReader(db ReadDB) *Reader { return &Reader{db: db} }

// Overview menjawab GET /api/v1/billing: keadaan sinkron, satu baris untuk TIAP
// pelanggan, dan tagihan tak bertuan dari sinkron berhasil terakhir.
//
// ISOLASI. Semua pembacaan berjalan dalam SATU transaksi REPEATABLE READ
// read-only, jadi melihat satu potret database. Perlu karena ApplySuccess
// menulis log sinkron, billing_status, customers, dan billing_mismatches dalam
// satu transaksi: dengan query terpisah di READ COMMITTED, satu jawaban bisa
// memuat baris dari sinkron N-1 tetapi riwayat dan tagihan tak bertuan dari
// sinkron N (atau sebaliknya). Satu query bergabung tidak dipilih karena
// bentuknya tiga daftar berbeda; transaksi tanpa penulisan tidak menahan
// penulis (PostgreSQL MVCC), ongkosnya hanya BEGIN dan COMMIT.
//
// nextRunAt adalah saat sinkron terjadwal berikutnya; pemanggil menjaminnya
// setelah saat jawaban dibuat.
func (r *Reader) Overview(ctx context.Context, nextRunAt time.Time) (wire.BillingOverview, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return wire.BillingOverview{}, wrapDB("mulai pembacaan status billing", err)
	}
	// Tidak ada yang ditulis, jadi Rollback setelah Commit tidak berbahaya.
	defer func() { _ = tx.Rollback(ctx) }()

	sync, err := readSyncState(ctx, tx, nextRunAt)
	if err != nil {
		return wire.BillingOverview{}, err
	}
	rows, err := readRows(ctx, tx)
	if err != nil {
		return wire.BillingOverview{}, err
	}
	unmatched, err := readUnmatched(ctx, tx)
	if err != nil {
		return wire.BillingOverview{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return wire.BillingOverview{}, wrapDB("akhiri pembacaan status billing", err)
	}
	return wire.BillingOverview{Sync: sync, Rows: rows, Unmatched: unmatched}, nil
}

// SyncState menjawab GET /api/v1/billing/sync: hanya keadaan sinkron. Satu
// pernyataan SQL (lihat syncStateSQL), jadi potretnya konsisten tanpa transaksi.
func (r *Reader) SyncState(ctx context.Context, nextRunAt time.Time) (wire.BillingSyncState, error) {
	return readSyncState(ctx, r.db, nextRunAt)
}

// syncStateSQL membaca sinkron yang berjalan DAN HistoryRuns sinkron selesai
// terbaru dalam SATU pernyataan, supaya satu sinkron yang selesai di tengah
// pembacaan tidak muncul di kedua daftar atau di tidak satu pun. Cabang kedua
// memakai indeks parsial billing_sync_runs_finished_idx (finished_at DESC); syarat
// "finished_at IS NOT NULL" wajib ada agar indeks itu boleh dipakai.
const syncStateSQL = `
SELECT grp, id::text, started_at, finished_at, status, error_message,
       invoices_total, matched_exact, matched_normalized,
       unmatched_unknown, unmatched_duplicate, unmatched_ambiguous, customers_without_invoice
FROM (
  (SELECT 0 AS grp, id, started_at, finished_at, status, error_message,
          invoices_total, matched_exact, matched_normalized,
          unmatched_unknown, unmatched_duplicate, unmatched_ambiguous, customers_without_invoice
   FROM billing_sync_runs WHERE status = 'running')
  UNION ALL
  (SELECT 1 AS grp, id, started_at, finished_at, status, error_message,
          invoices_total, matched_exact, matched_normalized,
          unmatched_unknown, unmatched_duplicate, unmatched_ambiguous, customers_without_invoice
   FROM billing_sync_runs WHERE finished_at IS NOT NULL
   ORDER BY finished_at DESC, id DESC LIMIT $1)
) s
ORDER BY grp, finished_at DESC NULLS LAST, id DESC`

func readSyncState(ctx context.Context, q queryer, nextRunAt time.Time) (wire.BillingSyncState, error) {
	const step = "baca keadaan sinkron"
	rows, err := q.Query(ctx, syncStateSQL, HistoryRuns)
	if err != nil {
		return wire.BillingSyncState{}, wrapDB(step, err)
	}
	defer rows.Close()

	state := wire.BillingSyncState{
		IntervalSeconds: int64(SyncInterval / time.Second),
		NextRunAt:       nextRunAt.Unix(),
		Runs:            []wire.BillingSyncRun{},
	}
	for rows.Next() {
		var (
			group                               int
			id, status                          string
			startedAt                           time.Time
			finishedAt                          *time.Time
			message                             *string
			invoices, exact, normalized         *int
			unknown, duplicate, ambiguous, free *int
		)
		if err := rows.Scan(&group, &id, &startedAt, &finishedAt, &status, &message,
			&invoices, &exact, &normalized, &unknown, &duplicate, &ambiguous, &free); err != nil {
			return wire.BillingSyncState{}, wrapDB(step, err)
		}

		if group == 0 {
			// Sinkron yang berjalan. Indeks unik billing_sync_runs_running_unique
			// menjamin paling banyak satu.
			if status != "running" || finishedAt != nil {
				return wire.BillingSyncState{}, fmt.Errorf("%w: sinkron %s berstatus %q", ErrInvalidData, id, status)
			}
			if state.Running == nil {
				state.Running = &wire.BillingRunning{StartedAt: startedAt.Unix()}
			}
			continue
		}

		run, err := buildRun(id, status, startedAt, finishedAt, message,
			invoices, exact, normalized, unknown, duplicate, ambiguous, free)
		if err != nil {
			return wire.BillingSyncState{}, err
		}
		state.Runs = append(state.Runs, run)
	}
	if err := rows.Err(); err != nil {
		return wire.BillingSyncState{}, wrapDB(step, err)
	}
	return state, nil
}

// buildRun memeriksa satu baris sinkron selesai dan mengubahnya ke bentuk kawat.
func buildRun(id, status string, startedAt time.Time, finishedAt *time.Time, message *string,
	invoices, exact, normalized, unknown, duplicate, ambiguous, free *int) (wire.BillingSyncRun, error) {
	if finishedAt == nil {
		return wire.BillingSyncRun{}, fmt.Errorf("%w: sinkron selesai %s tanpa waktu selesai", ErrInvalidData, id)
	}
	run := wire.BillingSyncRun{
		ID: id, StartedAt: startedAt.Unix(), FinishedAt: finishedAt.Unix(), Status: status,
	}
	switch status {
	case "success":
		if message != nil || hasNil(invoices, exact, normalized, unknown, duplicate, ambiguous, free) {
			return wire.BillingSyncRun{}, fmt.Errorf("%w: sinkron berhasil %s tidak lengkap", ErrInvalidData, id)
		}
		result := wire.BillingSyncResult{
			Invoices:       *invoices,
			Matched:        *exact + *normalized,
			Unmatched:      *unknown + *duplicate + *ambiguous,
			WithoutInvoice: *free,
		}
		if result.Invoices != result.Matched+result.Unmatched {
			return wire.BillingSyncRun{}, fmt.Errorf("%w: sinkron %s: tagihan %d bukan cocok %d + tak cocok %d",
				ErrInvalidData, id, result.Invoices, result.Matched, result.Unmatched)
		}
		run.Result = &result
	case "failed":
		if message == nil {
			return wire.BillingSyncRun{}, fmt.Errorf("%w: sinkron gagal %s tanpa pesan", ErrInvalidData, id)
		}
		text := *message
		run.Error = &text
	default:
		return wire.BillingSyncRun{}, fmt.Errorf("%w: sinkron selesai %s berstatus %q", ErrInvalidData, id, status)
	}
	return run, nil
}

// Runs menjawab GET /api/v1/billing/history: sinkron SELESAI (berhasil atau
// gagal; yang masih berjalan tidak ikut), terbaru lebih dulu, berhalaman. total
// adalah jumlah seluruh sinkron selesai. Total dan halaman dibaca dalam satu
// transaksi supaya konsisten.
func (r *Reader) Runs(ctx context.Context, limit, offset int) ([]wire.BillingSyncRun, int, error) {
	const step = "baca riwayat sinkron"
	if limit < 1 || offset < 0 {
		return nil, 0, fmt.Errorf("billing: limit/offset riwayat tidak sah: %d/%d", limit, offset)
	}
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, 0, wrapDB(step, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var total int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM billing_sync_runs WHERE finished_at IS NOT NULL`).Scan(&total); err != nil {
		return nil, 0, wrapDB(step, err)
	}

	rows, err := tx.Query(ctx, `
		SELECT id::text, started_at, finished_at, status, error_message,
		       invoices_total, matched_exact, matched_normalized,
		       unmatched_unknown, unmatched_duplicate, unmatched_ambiguous, customers_without_invoice
		FROM billing_sync_runs
		WHERE finished_at IS NOT NULL
		ORDER BY started_at DESC, id DESC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, 0, wrapDB(step, err)
	}
	defer rows.Close()

	runs := []wire.BillingSyncRun{}
	for rows.Next() {
		var (
			id, status                          string
			startedAt                           time.Time
			finishedAt                          *time.Time
			message                             *string
			invoices, exact, normalized         *int
			unknown, duplicate, ambiguous, free *int
		)
		if err := rows.Scan(&id, &startedAt, &finishedAt, &status, &message,
			&invoices, &exact, &normalized, &unknown, &duplicate, &ambiguous, &free); err != nil {
			return nil, 0, wrapDB(step, err)
		}
		run, err := buildRun(id, status, startedAt, finishedAt, message,
			invoices, exact, normalized, unknown, duplicate, ambiguous, free)
		if err != nil {
			return nil, 0, err
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, wrapDB(step, err)
	}
	rows.Close()
	if err := tx.Commit(ctx); err != nil {
		return nil, 0, wrapDB(step, err)
	}
	return runs, total, nil
}

func hasNil(values ...*int) bool {
	for _, v := range values {
		if v == nil {
			return true
		}
	}
	return false
}

// rowsSQL membaca SETIAP pelanggan. billing_status berisi paling banyak satu
// baris per pelanggan (unik) dan hanya hasil sinkron berhasil terakhir:
// ApplySuccess membuang barisnya bila pelanggan tidak mendapat tagihan.
// Status tagihan menang atas customers.billing_status bila ada. ORDER BY id hanya
// membuat urutan dasar deterministik; urutan jawaban ditentukan sortRows.
const rowsSQL = `
SELECT c.id::text, c.name, c.pppoe_username, c.router_id::text, coalesce(r.name, $1),
       coalesce(bs.status, c.billing_status), bs.match_kind, bs.invoice_ref, bs.billing_name
FROM customers c
LEFT JOIN billing_status bs ON bs.customer_id = c.id
LEFT JOIN routers r ON r.id = c.router_id
ORDER BY c.id`

func readRows(ctx context.Context, q queryer) ([]wire.BillingRow, error) {
	const step = "baca status billing pelanggan"
	rows, err := q.Query(ctx, rowsSQL, unknownRouterName)
	if err != nil {
		return nil, wrapDB(step, err)
	}
	defer rows.Close()

	out := []wire.BillingRow{}
	for rows.Next() {
		var (
			row         wire.BillingRow
			kind        *string
			invoiceRef  *string
			billingName *string
		)
		if err := rows.Scan(&row.CustomerID, &row.Name, &row.PPPoEUsername, &row.RouterID, &row.RouterName,
			&row.Status, &kind, &invoiceRef, &billingName); err != nil {
			return nil, wrapDB(step, err)
		}
		if !Status(row.Status).Valid() {
			return nil, fmt.Errorf("%w: pelanggan %s berstatus %q", ErrInvalidData, row.CustomerID, row.Status)
		}
		switch {
		case kind == nil:
			// Tanpa tagihan, atau baris lama sebelum migrasi 0006 yang belum punya
			// match_kind: dibaca "none". Kode tagihannya TIDAK diteruskan, karena
			// kontraknya menyatakan invoiceRef dan billingName null tepat bila match
			// "none".
			row.Match = "none"
		case *kind == string(MatchExact) || *kind == string(MatchNormalized):
			row.Match = *kind
			row.InvoiceRef = invoiceRef
			row.BillingName = billingName
		default:
			return nil, fmt.Errorf("%w: pelanggan %s dengan match_kind %q", ErrInvalidData, row.CustomerID, *kind)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, wrapDB(step, err)
	}

	sortRows(out)
	return out, nil
}

// sortRows mengurutkan baris menurut nama, lalu username PPPoE, lalu id pelanggan,
// dengan urutan teks newTextComparer: sama dengan matchBilling di billing.ts.
// Stabil, jadi pasangan yang benar-benar sama tetap dalam urutan masuknya (urutan
// id dari SQL).
func sortRows(rows []wire.BillingRow) {
	cmp := newTextComparer()
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if c := cmp(a.Name, b.Name); c != 0 {
			return c < 0
		}
		if c := cmp(a.PPPoEUsername, b.PPPoEUsername); c != 0 {
			return c < 0
		}
		return cmp(a.CustomerID, b.CustomerID) < 0
	})
}

// unmatchedSQL membaca tagihan tak bertuan milik sinkron berhasil TERBARU saja.
// Sinkron lama menyimpan hasilnya sendiri di billing_mismatches sampai dipangkas;
// tagihan yang sudah cocok pada sinkron berikutnya tidak boleh muncul lagi.
// Tanpa sinkron berhasil, subquery-nya NULL dan tidak ada baris yang cocok.
const unmatchedSQL = `
SELECT coalesce(m.invoice_ref, ''), m.invoice_name, m.invoice_status, m.reason
FROM billing_mismatches m
WHERE m.run_id = (
  SELECT id FROM billing_sync_runs WHERE status = 'success'
  ORDER BY finished_at DESC, id DESC LIMIT 1)
ORDER BY m.id`

func readUnmatched(ctx context.Context, q queryer) ([]wire.BillingUnmatched, error) {
	const step = "baca tagihan yang tidak cocok"
	rows, err := q.Query(ctx, unmatchedSQL)
	if err != nil {
		return nil, wrapDB(step, err)
	}
	defer rows.Close()

	out := []wire.BillingUnmatched{}
	for rows.Next() {
		var item wire.BillingUnmatched
		if err := rows.Scan(&item.InvoiceRef, &item.PPPoEUsername, &item.Status, &item.Reason); err != nil {
			return nil, wrapDB(step, err)
		}
		if !Status(item.Status).Valid() {
			return nil, fmt.Errorf("%w: tagihan %q berstatus %q", ErrInvalidData, item.PPPoEUsername, item.Status)
		}
		switch Reason(item.Reason) {
		case ReasonUnknown, ReasonDuplicate, ReasonAmbiguous:
		default:
			return nil, fmt.Errorf("%w: tagihan %q beralasan %q", ErrInvalidData, item.PPPoEUsername, item.Reason)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, wrapDB(step, err)
	}

	sortUnmatched(out)
	return out, nil
}

// sortUnmatched mengurutkan tagihan tak bertuan menurut kode tagihan, lalu nama
// (urutan teks yang sama dengan sortRows).
func sortUnmatched(items []wire.BillingUnmatched) {
	cmp := newTextComparer()
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if c := cmp(a.InvoiceRef, b.InvoiceRef); c != 0 {
			return c < 0
		}
		if c := cmp(a.PPPoEUsername, b.PPPoEUsername); c != 0 {
			return c < 0
		}
		// Dua tagihan yang sama kode dan namanya hanya beda status atau alasan; ini
		// penentu seri supaya urutannya tidak bergantung pada urutan baca database.
		if a.Status != b.Status {
			return a.Status < b.Status
		}
		return a.Reason < b.Reason
	})
}

// newTextComparer memberi pembanding teks yang urutannya sama dengan
// a.localeCompare(b, "id", { numeric: true }) di billing.ts, yang menentukan
// urutan baris dan tagihan di halaman: tanpa memedulikan huruf besar-kecil di
// tingkat utama, "Budi 2" sebelum "Budi 10", dan huruf beraksen dekat huruf
// dasarnya. Urutan basis data (COLLATE) tidak dipakai karena bergantung pada
// pengaturan server. collate.Collator tidak aman dipakai bersamaan, jadi tiap
// pembacaan membuat sendiri.
func newTextComparer() func(a, b string) int {
	c := collate.New(language.Indonesian, collate.Numeric)
	return c.CompareString
}
