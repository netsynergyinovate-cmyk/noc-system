package billing

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"noc-isp/backend/internal/wire"
)

// Tes Reader terhadap PostgreSQL sungguhan (skema proyek, tabel public; lihat
// store_pg_test.go untuk aturan berbagi tabel). Isi jawaban lewat HTTP dan data
// tetapnya diuji di internal/httpapi/billing_pg_test.go; di sini yang diuji hal
// yang hanya terlihat saat penulis dan pembaca berjalan bersamaan.

var readerNext = time.Date(2026, 5, 1, 11, 5, 0, 0, time.UTC)

// Tanpa satu pun sinkron: tidak ada yang berjalan, tidak ada riwayat, tidak ada
// tagihan tak bertuan, dan semua pelanggan tetap muncul dengan status tersimpan.
func TestReaderWithoutAnySyncStillListsCustomers(t *testing.T) {
	f := newPGFixture(t)
	a := f.addCustomer("a", StatusLunas)
	b := f.addCustomer("b", StatusIsolir)
	r := NewReader(f.pool)

	o, err := r.Overview(f.ctx, readerNext)
	if err != nil {
		t.Fatal(err)
	}
	if o.Sync.Running != nil || o.Sync.Runs == nil || len(o.Sync.Runs) != 0 {
		t.Errorf("sync = %+v, want tanpa running dan runs kosong yang bukan nil", o.Sync)
	}
	if o.Unmatched == nil || len(o.Unmatched) != 0 {
		t.Errorf("unmatched = %#v, want kosong yang bukan nil", o.Unmatched)
	}
	if o.Sync.NextRunAt != readerNext.Unix() || o.Sync.IntervalSeconds != 3600 {
		t.Errorf("jadwal = %+v", o.Sync)
	}
	got := map[string]wire.BillingRow{}
	for _, row := range o.Rows {
		got[row.CustomerID] = row
	}
	for _, c := range []Customer{a, b} {
		row, ok := got[c.ID]
		if !ok {
			t.Fatalf("pelanggan %s tidak ada di rows", c.ID)
		}
		if row.Match != "none" || row.Status != string(c.Status) || row.InvoiceRef != nil || row.BillingName != nil {
			t.Errorf("baris %s = %+v", c.ID, row)
		}
		if row.RouterName != "Uji billing" || row.RouterID != f.routerID {
			t.Errorf("router baris %s = %q (%s)", c.ID, row.RouterName, row.RouterID)
		}
	}

	s, err := r.SyncState(f.ctx, readerNext)
	if err != nil {
		t.Fatal(err)
	}
	if s.Running != nil || s.Runs == nil || len(s.Runs) != 0 {
		t.Errorf("SyncState = %+v", s)
	}
}

// Sinkron yang sedang berjalan dilaporkan dengan waktu mulainya dan tidak masuk
// riwayat; sinkron yang selesai masuk riwayat dan tidak lagi dianggap berjalan.
func TestReaderRunningRunIsNotInTheHistory(t *testing.T) {
	f := newPGFixture(t)
	r := NewReader(f.pool)
	started := t0.Add(time.Hour)
	runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, started)
	if err != nil {
		t.Fatal(err)
	}
	s, err := r.SyncState(f.ctx, readerNext)
	if err != nil {
		t.Fatal(err)
	}
	if s.Running == nil || s.Running.StartedAt != started.Unix() || len(s.Runs) != 0 {
		t.Fatalf("saat berjalan: %+v", s)
	}
	if err := f.store.FailRun(f.ctx, runID, fmt.Errorf("gagal"), started.Add(7*time.Second)); err != nil {
		t.Fatal(err)
	}
	s, err = r.SyncState(f.ctx, readerNext)
	if err != nil {
		t.Fatal(err)
	}
	if s.Running != nil || len(s.Runs) != 1 || s.Runs[0].ID != runID || s.Runs[0].Status != "failed" ||
		s.Runs[0].FinishedAt != started.Add(7*time.Second).Unix() || s.Runs[0].Error == nil {
		t.Errorf("setelah selesai: %+v", s)
	}
}

// INTI ISOLASI: sementara sinkron terus diterapkan (ApplySuccess menulis log,
// billing_status, dan billing_mismatches dalam satu transaksi), setiap jawaban
// harus berasal dari SATU potret. Sinkron ke-k menulis kode tagihan "INV-k-...",
// k%7+1 tagihan tak bertuan "MIS-k-j", dan mulai pada t0 + k menit. Jawaban yang
// menggabungkan dua sinkron akan memuat k yang berbeda di antara riwayat, baris,
// dan tagihan tak bertuan, atau jumlah tak bertuan yang tidak sama dengan
// hitungan sinkron terbarunya.
func TestReaderOverviewIsOneConsistentSnapshotWhileSyncsAreApplied(t *testing.T) {
	f := newPGFixture(t)
	customers := []Customer{f.addCustomer("a", StatusLunas), f.addCustomer("b", StatusLunas), f.addCustomer("c", StatusIsolir)}
	mine := map[string]string{}
	for _, c := range customers {
		mine[c.ID] = c.PPPoE
	}
	r := NewReader(f.pool)

	const syncs = 80
	var (
		wg        sync.WaitGroup
		writerErr error
		finished  = make(chan struct{})
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(finished)
		for k := 1; k <= syncs; k++ {
			invoices := []Invoice{}
			for i, c := range customers {
				invoices = append(invoices, Invoice{Name: c.PPPoE, Ref: fmt.Sprintf("INV-%d-%d", k, i), Status: StatusLunas})
			}
			for j := 0; j < k%7+1; j++ {
				invoices = append(invoices, Invoice{Name: fmt.Sprintf("%s-yatim-%d", f.prefix, j), Ref: fmt.Sprintf("MIS-%d-%d", k, j), Status: StatusIsolir})
			}
			res := MatchInvoices(invoices, f.mine())
			started := t0.Add(time.Duration(k) * time.Minute)
			runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, started)
			if err != nil {
				writerErr = err
				return
			}
			// Jeda singkat supaya keadaan "berjalan" sempat terbaca pembaca.
			time.Sleep(time.Millisecond)
			if err := f.store.ApplySuccess(f.ctx, runID, res, started.Add(5*time.Second)); err != nil {
				writerErr = err
				return
			}
		}
	}()

	checkOverview := func() error {
		o, err := r.Overview(f.ctx, readerNext)
		if err != nil {
			return err
		}
		if o.Sync.Running != nil {
			for _, run := range o.Sync.Runs {
				if run.StartedAt == o.Sync.Running.StartedAt {
					return fmt.Errorf("sinkron yang berjalan (mulai %d) juga ada di riwayat", run.StartedAt)
				}
			}
		}
		var latest *wire.BillingSyncRun
		for i := range o.Sync.Runs {
			if o.Sync.Runs[i].Status == "success" {
				latest = &o.Sync.Runs[i]
				break
			}
		}
		if latest == nil {
			if len(o.Unmatched) != 0 {
				return fmt.Errorf("tanpa sinkron berhasil tetapi ada %d tagihan tak bertuan", len(o.Unmatched))
			}
			return nil
		}
		k := int((latest.StartedAt - t0.Unix()) / 60)
		if latest.Result == nil || latest.Result.Unmatched != k%7+1 {
			return fmt.Errorf("sinkron terbaru k=%d: result = %+v, want unmatched %d", k, latest.Result, k%7+1)
		}
		if len(o.Unmatched) != latest.Result.Unmatched {
			return fmt.Errorf("riwayat menyebut sinkron k=%d dengan %d tak bertuan, tetapi daftar berisi %d", k, latest.Result.Unmatched, len(o.Unmatched))
		}
		for _, u := range o.Unmatched {
			if !strings.HasPrefix(u.InvoiceRef, fmt.Sprintf("MIS-%d-", k)) {
				return fmt.Errorf("riwayat menyebut sinkron k=%d tetapi tagihan tak bertuan %q dari sinkron lain", k, u.InvoiceRef)
			}
		}
		seen := 0
		for _, row := range o.Rows {
			if _, ok := mine[row.CustomerID]; !ok {
				continue
			}
			seen++
			if row.Match != "exact" || row.InvoiceRef == nil || !strings.HasPrefix(*row.InvoiceRef, fmt.Sprintf("INV-%d-", k)) {
				ref := "<nil>"
				if row.InvoiceRef != nil {
					ref = *row.InvoiceRef
				}
				return fmt.Errorf("riwayat menyebut sinkron k=%d tetapi baris pelanggan memuat %s/%s", k, row.Match, ref)
			}
		}
		if seen != len(customers) {
			return fmt.Errorf("baris pelanggan uji = %d, want %d", seen, len(customers))
		}
		return nil
	}

	lastTotal := 0
	checkSync := func() error {
		s, err := r.SyncState(f.ctx, readerNext)
		if err != nil {
			return err
		}
		total := len(s.Runs)
		if s.Running != nil {
			total++
			for _, run := range s.Runs {
				if run.StartedAt == s.Running.StartedAt {
					return fmt.Errorf("sinkron yang berjalan (mulai %d) juga ada di riwayat", run.StartedAt)
				}
			}
		}
		// Penulis hanya menambah sinkron (24 teratas bertambah sampai penuh), jadi
		// jumlah yang terlihat tidak pernah berkurang: sinkron yang selesai di antara
		// dua query akan hilang dari keduanya.
		if total < lastTotal && lastTotal <= 24 {
			return fmt.Errorf("jumlah sinkron yang terlihat turun dari %d ke %d", lastTotal, total)
		}
		lastTotal = total
		return nil
	}

	var readers sync.WaitGroup
	errs := make(chan error, 2)
	for name, check := range map[string]func() error{"Overview": checkOverview, "SyncState": checkSync} {
		readers.Add(1)
		go func() {
			defer readers.Done()
			reads := 0
			for {
				select {
				case <-finished:
					if reads == 0 {
						errs <- fmt.Errorf("%s: tidak sempat membaca saat penulis berjalan", name)
					}
					return
				default:
				}
				if err := check(); err != nil {
					errs <- fmt.Errorf("%s: %w", name, err)
					return
				}
				reads++
			}
		}()
	}
	readers.Wait()
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if writerErr != nil {
		t.Fatalf("penulis: %v", writerErr)
	}

	// Setelah semuanya selesai: sinkron terakhir, tepat.
	o, err := r.Overview(f.ctx, readerNext)
	if err != nil {
		t.Fatal(err)
	}
	if o.Sync.Running != nil || len(o.Sync.Runs) != 24 || o.Sync.Runs[0].StartedAt != t0.Add(syncs*time.Minute).Unix() {
		t.Errorf("keadaan akhir: running %v, %d sinkron, terbaru mulai %d", o.Sync.Running, len(o.Sync.Runs), o.Sync.Runs[0].StartedAt)
	}
	if len(o.Unmatched) != syncs%7+1 {
		t.Errorf("tak bertuan akhir = %d, want %d", len(o.Unmatched), syncs%7+1)
	}
}

// Pembacaan riwayat memakai indeks finished_at yang sudah ada, bukan memindai
// seluruh log (yang tumbuh sampai dua minggu x 24 sinkron). Dengan pemindaian
// berurutan dimatikan, planner memakai indeks bila ia bisa dipakai oleh
// pernyataan ini; bila syaratnya tidak cocok dengan indeks parsial, ia terpaksa
// memindai.
func TestReaderHistoryQueryUsesTheFinishedIndex(t *testing.T) {
	f := newPGFixture(t)
	for k := 1; k <= 60; k++ {
		started := t0.Add(time.Duration(k) * time.Hour)
		id, err := f.store.BeginRun(f.ctx, TriggerSchedule, started)
		if err != nil {
			t.Fatal(err)
		}
		if err := f.store.FailRun(f.ctx, id, fmt.Errorf("gagal %d", k), started.Add(9*time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(f.ctx) }()
	for _, q := range []string{`SET LOCAL enable_seqscan = off`, `SET LOCAL enable_bitmapscan = off`} {
		if _, err := tx.Exec(f.ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := tx.Query(f.ctx, `EXPLAIN `+syncStateSQL, HistoryRuns)
	if err != nil {
		t.Fatal(err)
	}
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line + "\n")
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.String(), "billing_sync_runs_finished_idx") {
		t.Errorf("riwayat tidak memakai billing_sync_runs_finished_idx:\n%s", plan.String())
	}
	if strings.Contains(plan.String(), "Seq Scan") {
		t.Errorf("rencana memuat Seq Scan:\n%s", plan.String())
	}

	// Dan jawabannya tetap benar: 24 terbaru, menurun.
	s, err := NewReader(f.pool).SyncState(f.ctx, readerNext)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Runs) != 24 {
		t.Fatalf("runs = %d, want 24", len(s.Runs))
	}
	for i, run := range s.Runs {
		want, _ := strconv.Atoi(strings.TrimPrefix(*run.Error, "gagal "))
		if want != 60-i {
			t.Errorf("runs[%d] = sinkron %d, want %d", i, want, 60-i)
		}
	}
}

// Overview meminta SATU transaksi REPEATABLE READ read-only: potret yang
// konsisten, dan PostgreSQL sendiri menolak penulisan di dalamnya.
func TestReaderAsksForOneRepeatableReadReadOnlyTransaction(t *testing.T) {
	f := newPGFixture(t)
	db := &recordingReadDB{ReadDB: f.pool}
	if _, err := NewReader(db).Overview(f.ctx, readerNext); err != nil {
		t.Fatal(err)
	}
	if db.begins != 1 {
		t.Fatalf("transaksi dibuka %d kali, want 1", db.begins)
	}
	if got := db.options.IsoLevel; got != pgx.RepeatableRead {
		t.Errorf("tingkat isolasi = %q, want %q", got, pgx.RepeatableRead)
	}
	if got := db.options.AccessMode; got != pgx.ReadOnly {
		t.Errorf("mode akses = %q, want %q", got, pgx.ReadOnly)
	}
}

// recordingReadDB mencatat opsi transaksi yang diminta pembaca.
type recordingReadDB struct {
	ReadDB
	begins  int
	options pgx.TxOptions
}

func (d *recordingReadDB) BeginTx(ctx context.Context, options pgx.TxOptions) (pgx.Tx, error) {
	d.begins++
	d.options = options
	return d.ReadDB.BeginTx(ctx, options)
}

func TestReaderStopsWhenTheContextIsCanceled(t *testing.T) {
	f := newPGFixture(t)
	f.addCustomer("a", StatusLunas)
	ctx, cancel := context.WithCancel(f.ctx)
	cancel()
	r := NewReader(f.pool)
	if _, err := r.Overview(ctx, readerNext); err == nil {
		t.Error("Overview dengan konteks yang sudah dibatalkan seharusnya galat")
	}
	if _, err := r.SyncState(ctx, readerNext); err == nil {
		t.Error("SyncState dengan konteks yang sudah dibatalkan seharusnya galat")
	}
}
