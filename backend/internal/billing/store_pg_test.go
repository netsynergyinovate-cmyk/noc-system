package billing

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Tes penyimpanan memakai PostgreSQL sungguhan dengan skema proyek. Dijalankan
// otomatis oleh `npm test` (database sekali pakai) dan dilewati bila
// TEST_DATABASE_URL tidak diatur. Paket lain tidak menyentuh tabel billing, dan
// tes di paket ini berjalan berurutan, jadi tiap tes boleh mengosongkan tabel
// log dan status billing di awal dan akhirnya.

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

// t0 adalah waktu dasar; tiap tes menambahkan selang supaya urutan sinkron jelas.
var t0 = time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)

type pgFixture struct {
	t        *testing.T
	ctx      context.Context
	pool     *pgxpool.Pool
	store    *Store
	routerID string
	prefix   string
	custs    []Customer // pelanggan yang dibuat tes ini, urutan pembuatan
}

func newPGFixture(t *testing.T) *pgFixture {
	t.Helper()
	pool := pgTestPool(t)
	f := &pgFixture{
		t: t, ctx: context.Background(), pool: pool, store: NewStore(pool),
		prefix: fmt.Sprintf("t%x", time.Now().UnixNano()),
	}
	f.clear()
	if err := pool.QueryRow(f.ctx,
		`INSERT INTO routers (name, host, username, password_enc) VALUES ('Uji billing', $1, 'api', 'enc') RETURNING id::text`,
		f.prefix+"-host").Scan(&f.routerID); err != nil {
		t.Fatalf("buat router uji: %v", err)
	}
	t.Cleanup(func() {
		f.clear()
		_, _ = pool.Exec(f.ctx, `DELETE FROM customers WHERE router_id = $1::uuid`, f.routerID)
		_, _ = pool.Exec(f.ctx, `DELETE FROM routers WHERE id = $1::uuid`, f.routerID)
	})
	return f
}

// clear mengosongkan log sinkron (beserta ketidakcocokannya) dan status billing.
func (f *pgFixture) clear() {
	f.t.Helper()
	for _, q := range []string{`DELETE FROM billing_sync_runs`, `DELETE FROM billing_status`} {
		if _, err := f.pool.Exec(f.ctx, q); err != nil {
			f.t.Fatalf("%s: %v", q, err)
		}
	}
}

// name menghasilkan nama PPPoE yang unik untuk tes ini.
func (f *pgFixture) name(label string) string { return f.prefix + "-" + label }

func (f *pgFixture) addCustomer(label string, status Status) Customer {
	f.t.Helper()
	c := Customer{PPPoE: f.name(label), Status: status}
	if err := f.pool.QueryRow(f.ctx,
		`INSERT INTO customers (name, pppoe_username, router_id, billing_status) VALUES ($1, $2, $3::uuid, $4) RETURNING id::text`,
		"Uji "+label, c.PPPoE, f.routerID, string(status)).Scan(&c.ID); err != nil {
		f.t.Fatalf("buat pelanggan uji: %v", err)
	}
	f.custs = append(f.custs, c)
	return c
}

func (f *pgFixture) ids() []string {
	ids := make([]string, len(f.custs))
	for i, c := range f.custs {
		ids[i] = c.ID
	}
	return ids
}

// mine membaca pelanggan milik tes ini lewat Store.LoadCustomers.
func (f *pgFixture) mine() []Customer {
	f.t.Helper()
	all, err := f.store.LoadCustomers(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	own := map[string]bool{}
	for _, id := range f.ids() {
		own[id] = true
	}
	var out []Customer
	for _, c := range all {
		if own[c.ID] {
			out = append(out, c)
		}
	}
	return out
}

// cycle menjalankan satu sinkron berhasil seperti yang akan dilakukan pemanggil:
// baca pelanggan, cocokkan, mulai, terapkan.
func (f *pgFixture) cycle(invoices []Invoice, started time.Time) (string, Result) {
	f.t.Helper()
	res := MatchInvoices(invoices, f.mine())
	runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, started)
	if err != nil {
		f.t.Fatalf("BeginRun: %v", err)
	}
	if err := f.store.ApplySuccess(f.ctx, runID, res, started.Add(5*time.Second)); err != nil {
		f.t.Fatalf("ApplySuccess: %v", err)
	}
	return runID, res
}

func (f *pgFixture) customerStatuses() map[string]Status {
	f.t.Helper()
	out := map[string]Status{}
	for _, c := range f.mine() {
		out[c.ID] = c.Status
	}
	return out
}

// xmins memberi versi baris tiap pelanggan: berubah bila dan hanya bila barisnya
// ditulis, walau nilainya sama.
func (f *pgFixture) xmins() map[string]string {
	f.t.Helper()
	rows, err := f.pool.Query(f.ctx, `SELECT id::text, xmin::text FROM customers WHERE router_id = $1::uuid`, f.routerID)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, x string
		if err := rows.Scan(&id, &x); err != nil {
			f.t.Fatal(err)
		}
		out[id] = x
	}
	return out
}

func (f *pgFixture) query(sql string, args ...any) []string {
	f.t.Helper()
	rows, err := f.pool.Query(f.ctx, sql, args...)
	if err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			f.t.Fatal(err)
		}
		out = append(out, fmt.Sprint(vals...))
	}
	if err := rows.Err(); err != nil {
		f.t.Fatal(err)
	}
	return out
}

// dataSnapshot merangkum semua yang boleh ditulis ApplySuccess (selain log):
// status billing, pelanggan beserta versi barisnya, dan ketidakcocokan.
func (f *pgFixture) dataSnapshot() string {
	f.t.Helper()
	parts := [][]string{
		f.query(`SELECT customer_id::text, status, coalesce(invoice_ref, '~'), coalesce(match_kind, '~'),
		                coalesce(billing_name, '~'), coalesce(run_id::text, '~'), synced_at::text
		         FROM billing_status ORDER BY customer_id`),
		f.query(`SELECT id::text, billing_status, xmin::text, last_updated_at::text FROM customers
		         WHERE router_id = $1::uuid ORDER BY id`, f.routerID),
		f.query(`SELECT id::text FROM billing_mismatches ORDER BY id`),
	}
	var b strings.Builder
	for _, p := range parts {
		b.WriteString(strings.Join(p, "\n"))
		b.WriteString("\n--\n")
	}
	return b.String()
}

func (f *pgFixture) runsSnapshot() string {
	f.t.Helper()
	return strings.Join(f.query(`SELECT id::text, status, coalesce(started_at::text, '~'), coalesce(finished_at::text, '~'),
		coalesce(error_message, '~'), coalesce(invoices_total::text, '~'), coalesce(statuses_changed::text, '~')
		FROM billing_sync_runs ORDER BY id`), "\n")
}

type runRow struct {
	Status                                                     string
	Trigger                                                    string
	StartedAt                                                  time.Time
	FinishedAt                                                 *time.Time
	Error                                                      *string
	Invoices, Exact, Normalized, Unknown, Duplicate, Ambiguous *int
	Without, Changed                                           *int
}

func (f *pgFixture) run(runID string) runRow {
	f.t.Helper()
	var r runRow
	err := f.pool.QueryRow(f.ctx, `
		SELECT status, trigger, started_at, finished_at, error_message, invoices_total, matched_exact, matched_normalized,
		       unmatched_unknown, unmatched_duplicate, unmatched_ambiguous, customers_without_invoice, statuses_changed
		FROM billing_sync_runs WHERE id = $1::uuid`, runID).Scan(
		&r.Status, &r.Trigger, &r.StartedAt, &r.FinishedAt, &r.Error, &r.Invoices, &r.Exact, &r.Normalized,
		&r.Unknown, &r.Duplicate, &r.Ambiguous, &r.Without, &r.Changed)
	if err != nil {
		f.t.Fatalf("baca sinkron %s: %v", runID, err)
	}
	return r
}

func (f *pgFixture) countRuns(where string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM billing_sync_runs WHERE `+where, args...).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

// verifyApplied memeriksa bahwa isi database sama dengan yang dijanjikan
// ApplySuccess untuk res: baris status, status pelanggan, ketidakcocokan, dan
// log. before adalah status pelanggan sebelum diterapkan.
func (f *pgFixture) verifyApplied(runID string, res Result, before map[string]Status, finished time.Time) {
	f.t.Helper()
	t := f.t

	// billing_status: tepat satu baris per Match, dan tidak ada yang lain.
	type statusRow struct {
		status, kind, name, run string
		ref                     *string
		syncedAt                time.Time
	}
	rows, err := f.pool.Query(f.ctx, `
		SELECT customer_id::text, status, invoice_ref, match_kind, billing_name, run_id::text, synced_at
		FROM billing_status WHERE customer_id = ANY($1::text[]::uuid[])`, f.ids())
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]statusRow{}
	for rows.Next() {
		var id string
		var r statusRow
		if err := rows.Scan(&id, &r.status, &r.ref, &r.kind, &r.name, &r.run, &r.syncedAt); err != nil {
			t.Fatal(err)
		}
		got[id] = r
	}
	rows.Close()
	if len(got) != len(res.Matches) {
		t.Errorf("baris billing_status = %d, want %d", len(got), len(res.Matches))
	}
	for _, m := range res.Matches {
		r, ok := got[m.CustomerID]
		if !ok {
			t.Errorf("pelanggan %s tidak punya baris billing_status", m.CustomerID)
			continue
		}
		wantRef := (*string)(nil)
		if m.Invoice.Ref != "" {
			wantRef = &m.Invoice.Ref
		}
		if r.status != string(m.Invoice.Status) || r.kind != string(m.Kind) || r.name != m.Invoice.Name ||
			r.run != runID || !r.syncedAt.Equal(finished) || !reflect.DeepEqual(r.ref, wantRef) {
			t.Errorf("baris %s = %+v, want %+v", m.CustomerID, r, m)
		}
	}

	// Pelanggan: hanya Changes yang berubah.
	want := map[string]Status{}
	for id, s := range before {
		want[id] = s
	}
	for _, ch := range res.Changes {
		want[ch.CustomerID] = ch.To
	}
	if now := f.customerStatuses(); !reflect.DeepEqual(now, want) {
		t.Errorf("status pelanggan = %v, want %v", now, want)
	}

	// Ketidakcocokan.
	mismatchRows, err := f.pool.Query(f.ctx, `
		SELECT invoice_name, invoice_ref, invoice_status, reason, customer_ids::text[]
		FROM billing_mismatches WHERE run_id = $1::uuid`, runID)
	if err != nil {
		t.Fatal(err)
	}
	var gotMismatches []string
	for mismatchRows.Next() {
		var name, status, reason string
		var ref *string
		var ids []string
		if err := mismatchRows.Scan(&name, &ref, &status, &reason, &ids); err != nil {
			t.Fatal(err)
		}
		r := ""
		if ref != nil {
			r = "=" + *ref
		}
		sort.Strings(ids)
		gotMismatches = append(gotMismatches, fmt.Sprintf("%q%s|%s|%s|%v", name, r, status, reason, ids))
	}
	mismatchRows.Close()
	var wantMismatches []string
	for _, u := range res.Unmatched {
		r := ""
		if u.Invoice.Ref != "" {
			r = "=" + u.Invoice.Ref
		}
		ids := append([]string{}, u.CustomerIDs...)
		sort.Strings(ids)
		wantMismatches = append(wantMismatches, fmt.Sprintf("%q%s|%s|%s|%v", u.Invoice.Name, r, u.Invoice.Status, u.Reason, ids))
	}
	sort.Strings(gotMismatches)
	sort.Strings(wantMismatches)
	if !reflect.DeepEqual(gotMismatches, wantMismatches) {
		t.Errorf("ketidakcocokan = %v, want %v", gotMismatches, wantMismatches)
	}

	// Log.
	run := f.run(runID)
	c := res.Counts
	if run.Status != "success" || run.FinishedAt == nil || !run.FinishedAt.Equal(finished) || run.Error != nil ||
		run.Invoices == nil || *run.Invoices != c.Invoices || *run.Exact != c.MatchedExact || *run.Normalized != c.MatchedNormalized ||
		*run.Unknown != c.UnmatchedUnknown || *run.Duplicate != c.UnmatchedDuplicate || *run.Ambiguous != c.UnmatchedAmbiguous ||
		*run.Without != c.WithoutInvoice || *run.Changed != c.StatusesChanged {
		t.Errorf("log sinkron = %+v, want hitungan %+v selesai %s", run, c, finished)
	}
}

// --- Memulai sinkron --------------------------------------------------------

func TestStoreBeginRunAllowsOnlyOneRunning(t *testing.T) {
	f := newPGFixture(t)
	id, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0)
	if err != nil {
		t.Fatal(err)
	}
	r := f.run(id)
	if r.Status != "running" || r.Trigger != "schedule" || !r.StartedAt.Equal(t0) || r.FinishedAt != nil || r.Error != nil || r.Invoices != nil {
		t.Errorf("sinkron baru = %+v", r)
	}
	if _, err := f.store.BeginRun(f.ctx, TriggerManual, t0.Add(time.Second)); !errors.Is(err, ErrRunInProgress) {
		t.Errorf("BeginRun kedua = %v, want ErrRunInProgress", err)
	}
	if n := f.countRuns(`true`); n != 1 {
		t.Errorf("baris log = %d, want 1", n)
	}

	// Sesudah selesai, apa pun hasilnya, sinkron baru boleh mulai.
	if err := f.store.FailRun(f.ctx, id, errors.New("gagal"), t0.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	second, err := f.store.BeginRun(f.ctx, TriggerManual, t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("setelah gagal: %v", err)
	}
	if got := f.run(second); got.Trigger != "manual" {
		t.Errorf("pemicu = %q", got.Trigger)
	}
	if err := f.store.ApplySuccess(f.ctx, second, MatchInvoices(nil, nil), t0.Add(time.Minute+time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(2*time.Minute)); err != nil {
		t.Errorf("setelah berhasil: %v", err)
	}
}

func TestStoreBeginRunRejectsUnknownTrigger(t *testing.T) {
	f := newPGFixture(t)
	if _, err := f.store.BeginRun(f.ctx, Trigger("cron"), t0); err == nil {
		t.Error("pemicu yang tidak dikenal seharusnya ditolak")
	}
	if n := f.countRuns(`true`); n != 0 {
		t.Errorf("baris log = %d, want 0", n)
	}
}

func TestStoreBeginRunConcurrentExactlyOneWins(t *testing.T) {
	f := newPGFixture(t)
	for round := 0; round < 5; round++ {
		const callers = 8
		var wg sync.WaitGroup
		start := make(chan struct{})
		ids := make([]string, callers)
		errs := make([]error, callers)
		for i := 0; i < callers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				ids[i], errs[i] = f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(time.Duration(round)*time.Hour))
			}()
		}
		close(start)
		wg.Wait()

		winners, winner := 0, ""
		for i := range errs {
			switch {
			case errs[i] == nil:
				winners++
				winner = ids[i]
			case !errors.Is(errs[i], ErrRunInProgress):
				t.Fatalf("putaran %d: galat tak terduga: %v", round, errs[i])
			}
		}
		if winners != 1 {
			t.Fatalf("putaran %d: %d pemenang, want 1", round, winners)
		}
		if n := f.countRuns(`status = 'running'`); n != 1 {
			t.Fatalf("putaran %d: %d sinkron running", round, n)
		}
		if err := f.store.FailRun(f.ctx, winner, errors.New("selesai"), t0.Add(time.Duration(round)*time.Hour+time.Second)); err != nil {
			t.Fatal(err)
		}
	}
}

// --- Memulihkan sinkron yang terputus ---------------------------------------

func TestStoreRecoverStaleRuns(t *testing.T) {
	f := newPGFixture(t)

	// Tanpa sinkron running: tidak ada yang berubah.
	if n, err := f.store.RecoverStaleRuns(f.ctx, t0); err != nil || n != 0 {
		t.Fatalf("RecoverStaleRuns kosong = %d, %v", n, err)
	}

	done, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.ApplySuccess(f.ctx, done, MatchInvoices(nil, nil), t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	failed, _ := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(time.Hour))
	if err := f.store.FailRun(f.ctx, failed, errors.New("kegagalan lama"), t0.Add(time.Hour+time.Second)); err != nil {
		t.Fatal(err)
	}
	beforeDone, beforeFailed := f.run(done), f.run(failed)

	stale, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	// Indeks unik memblokir sinkron baru selama sisa itu ada.
	if _, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(2*time.Hour)); !errors.Is(err, ErrRunInProgress) {
		t.Fatalf("BeginRun = %v, want ErrRunInProgress", err)
	}

	restart := t0.Add(2*time.Hour + 30*time.Second)
	n, err := f.store.RecoverStaleRuns(f.ctx, restart)
	if err != nil || n != 1 {
		t.Fatalf("RecoverStaleRuns = %d, %v; want 1", n, err)
	}
	r := f.run(stale)
	if r.Status != "failed" || r.Error == nil || *r.Error != "Sinkron terputus karena backend dimulai ulang." ||
		r.FinishedAt == nil || !r.FinishedAt.Equal(restart) || r.Invoices != nil {
		t.Errorf("sinkron yang dipulihkan = %+v", r)
	}
	if !reflect.DeepEqual(f.run(done), beforeDone) || !reflect.DeepEqual(f.run(failed), beforeFailed) {
		t.Error("sinkron yang sudah selesai ikut berubah")
	}
	if n := f.countRuns(`status = 'running'`); n != 0 {
		t.Errorf("masih ada %d sinkron running", n)
	}
	if _, err := f.store.BeginRun(f.ctx, TriggerSchedule, restart); err != nil {
		t.Errorf("sinkron baru setelah pemulihan: %v", err)
	}
	// Dipanggil lagi hanya menandai yang baru saja dimulai itu.
	if n, err := f.store.RecoverStaleRuns(f.ctx, restart.Add(time.Second)); err != nil || n != 1 {
		t.Errorf("pemulihan kedua = %d, %v", n, err)
	}
}

// Jam pemanggil yang mundur (atau waktu uji yang lebih awal dari waktu mulai)
// tidak boleh membuat penutupan gagal oleh check finished_at >= started_at, atau
// baris running akan menghalangi sinkron berikutnya selamanya.
func TestStoreFinishingNeverPrecedesStart(t *testing.T) {
	f := newPGFixture(t)
	early := t0.Add(-time.Hour)
	for name, finish := range map[string]func(string) error{
		"recover": func(string) error { _, err := f.store.RecoverStaleRuns(f.ctx, early); return err },
		"fail":    func(id string) error { return f.store.FailRun(f.ctx, id, errors.New("x"), early) },
		"success": func(id string) error { return f.store.ApplySuccess(f.ctx, id, MatchInvoices(nil, nil), early) },
	} {
		id, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0)
		if err != nil {
			t.Fatal(err)
		}
		if err := finish(id); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		r := f.run(id)
		if r.FinishedAt == nil || r.FinishedAt.Before(r.StartedAt) {
			t.Errorf("%s: selesai %v sebelum mulai %v", name, r.FinishedAt, r.StartedAt)
		}
	}
}

// --- Membaca pelanggan ------------------------------------------------------

func TestStoreLoadCustomers(t *testing.T) {
	f := newPGFixture(t)
	a := f.addCustomer("a", StatusLunas)
	b := f.addCustomer("B", StatusIsolir)
	got := f.mine()
	if len(got) != 2 {
		t.Fatalf("pelanggan = %+v", got)
	}
	byID := map[string]Customer{got[0].ID: got[0], got[1].ID: got[1]}
	if byID[a.ID] != a || byID[b.ID] != b {
		t.Errorf("pelanggan = %+v, want %+v dan %+v", got, a, b)
	}
	all, err := f.store.LoadCustomers(f.ctx)
	if err != nil || !sort.SliceIsSorted(all, func(i, j int) bool { return all[i].ID < all[j].ID }) {
		t.Errorf("LoadCustomers tidak terurut menurut ID: %v", err)
	}
}

// --- Menerapkan hasil -------------------------------------------------------

type scenario struct {
	a, b, c, d, e, g, h Customer
	first, second       []Invoice
}

// newScenario menyiapkan pelanggan dan dua daftar tagihan: sinkron pertama
// mengisi billing_status untuk A, D, dan E; sinkron kedua menghapus baris D dan E.
func newScenario(f *pgFixture) scenario {
	s := scenario{
		a: f.addCustomer("a", StatusLunas),
		b: f.addCustomer("b", StatusIsolir),
		c: f.addCustomer("c", StatusLunas),
		d: f.addCustomer("d", StatusLunas),
		e: f.addCustomer("e-pelanggan", StatusIsolir),
		g: f.addCustomer("Twin", StatusLunas),
		h: f.addCustomer("twin", StatusLunas),
	}
	s.first = []Invoice{
		{Name: s.a.PPPoE, Ref: "OLD-A", Status: StatusLunas},
		{Name: s.d.PPPoE, Ref: "OLD-D", Status: StatusLunas},
		{Name: s.e.PPPoE, Ref: "OLD-E", Status: StatusIsolir},
	}
	s.second = []Invoice{
		{Name: s.a.PPPoE, Ref: "INV-1", Status: StatusIsolir},                                 // persis, berubah
		{Name: strings.ToUpper(s.b.PPPoE), Ref: "INV-2", Status: StatusLunas},                 // dirapikan, berubah
		{Name: s.c.PPPoE, Ref: "INV-3", Status: StatusLunas},                                  // persis, tetap
		{Name: s.e.PPPoE[:len(s.e.PPPoE)-1], Ref: "", Status: StatusLunas},                    // salah ketik, tanpa kode
		{Name: " " + strings.ToUpper(s.a.PPPoE), Ref: "INV-5", Status: StatusLunas},           // ganda dari A
		{Name: strings.ToUpper(s.g.PPPoE), Ref: "INV-6", Status: StatusIsolir},                // ambigu: G dan H
		{Name: f.name("tidak-ada"), Ref: "INV-7", Status: StatusIsolir},                       // tak dikenal
		{Name: "  " + strings.ToUpper(s.c.PPPoE) + " \t", Ref: "INV-8", Status: StatusIsolir}, // ganda dari C
	}
	return s
}

func TestStoreApplySuccessWritesEverything(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)

	run1, res1 := f.cycle(s.first, t0)
	f.verifyApplied(run1, res1, map[string]Status{
		s.a.ID: StatusLunas, s.b.ID: StatusIsolir, s.c.ID: StatusLunas, s.d.ID: StatusLunas,
		s.e.ID: StatusIsolir, s.g.ID: StatusLunas, s.h.ID: StatusLunas,
	}, t0.Add(5*time.Second))
	if len(res1.Matches) != 3 || len(res1.Changes) != 0 {
		t.Fatalf("sinkron pertama = %+v", res1)
	}

	before := f.customerStatuses()
	run2, res2 := f.cycle(s.second, t0.Add(time.Hour))
	if res2.Counts != (Counts{
		Invoices: 8, MatchedExact: 2, MatchedNormalized: 1, UnmatchedUnknown: 2, UnmatchedDuplicate: 2, UnmatchedAmbiguous: 1,
		WithoutInvoice: 4, StatusesChanged: 2,
	}) {
		t.Fatalf("hitungan sinkron kedua = %+v", res2.Counts)
	}
	f.verifyApplied(run2, res2, before, t0.Add(time.Hour+5*time.Second))

	// Baris D dan E (punya baris dari sinkron pertama, kini tanpa tagihan) sudah
	// dibuang, begitu juga baris pelanggan yang tidak punya tagihan sama sekali.
	var rowsFor int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM billing_status WHERE customer_id = ANY($1::text[]::uuid[]) AND customer_id::text <> ALL($2::text[])`,
		f.ids(), []string{s.a.ID, s.b.ID, s.c.ID}).Scan(&rowsFor); err != nil || rowsFor != 0 {
		t.Errorf("baris yang seharusnya dibuang masih %d (%v)", rowsFor, err)
	}
	want := map[string]Status{
		s.a.ID: StatusIsolir, s.b.ID: StatusLunas, s.c.ID: StatusLunas, s.d.ID: StatusLunas,
		s.e.ID: StatusIsolir, s.g.ID: StatusLunas, s.h.ID: StatusLunas,
	}
	if got := f.customerStatuses(); !reflect.DeepEqual(got, want) {
		t.Errorf("status pelanggan = %v, want %v", got, want)
	}
	// Log sinkron pertama tidak disentuh.
	if r := f.run(run1); r.Status != "success" || *r.Invoices != 3 {
		t.Errorf("sinkron pertama = %+v", r)
	}
}

func TestStoreApplySuccessTouchesOnlyChangedCustomers(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)
	f.cycle(s.first, t0)

	xminBefore := f.xmins()
	updatedBefore := f.query(`SELECT id::text, last_updated_at::text FROM customers WHERE router_id = $1::uuid ORDER BY id`, f.routerID)
	_, res := f.cycle(s.second, t0.Add(time.Hour))
	xminAfter := f.xmins()

	changed := map[string]bool{}
	for _, ch := range res.Changes {
		changed[ch.CustomerID] = true
	}
	if len(changed) != 2 || !changed[s.a.ID] || !changed[s.b.ID] {
		t.Fatalf("perubahan = %+v", res.Changes)
	}
	for _, c := range f.custs {
		if changed[c.ID] && xminAfter[c.ID] == xminBefore[c.ID] {
			t.Errorf("baris %s seharusnya ditulis", c.PPPoE)
		}
		if !changed[c.ID] && xminAfter[c.ID] != xminBefore[c.ID] {
			t.Errorf("baris %s tidak ada di Changes tetapi ditulis", c.PPPoE)
		}
	}
	// Penanda waktu data pelanggan tidak ikut diubah.
	updatedAfter := f.query(`SELECT id::text, last_updated_at::text FROM customers WHERE router_id = $1::uuid ORDER BY id`, f.routerID)
	if !reflect.DeepEqual(updatedBefore, updatedAfter) {
		t.Error("last_updated_at berubah")
	}
}

func TestStoreApplySuccessStoresMismatchesByReason(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)
	run, res := f.cycle(s.second, t0)
	rows, err := f.pool.Query(f.ctx, `SELECT reason, customer_ids::text[] FROM billing_mismatches WHERE run_id = $1::uuid`, run)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := map[Reason]int{}
	for rows.Next() {
		var reason Reason
		var ids []string
		if err := rows.Scan(&reason, &ids); err != nil {
			t.Fatal(err)
		}
		seen[reason]++
		switch reason {
		case ReasonUnknown:
			if len(ids) != 0 {
				t.Errorf("unknown dengan kandidat %v", ids)
			}
		case ReasonDuplicate:
			if len(ids) != 1 || (ids[0] != s.a.ID && ids[0] != s.c.ID) {
				t.Errorf("duplicate dengan kandidat %v", ids)
			}
		case ReasonAmbiguous:
			sort.Strings(ids)
			want := []string{s.g.ID, s.h.ID}
			sort.Strings(want)
			if !reflect.DeepEqual(ids, want) {
				t.Errorf("ambiguous dengan kandidat %v, want %v", ids, want)
			}
		}
	}
	if seen[ReasonUnknown] != 2 || seen[ReasonDuplicate] != 2 || seen[ReasonAmbiguous] != 1 {
		t.Errorf("alasan = %v", seen)
	}
	// Kode tagihan kosong tersimpan sebagai NULL.
	var nulls int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM billing_mismatches WHERE run_id = $1::uuid AND invoice_ref IS NULL`, run).Scan(&nulls); err != nil || nulls != 1 {
		t.Errorf("kode kosong = %d (%v), want 1", nulls, err)
	}
	f.verifyApplied(run, res, map[string]Status{
		s.a.ID: StatusLunas, s.b.ID: StatusIsolir, s.c.ID: StatusLunas, s.d.ID: StatusLunas,
		s.e.ID: StatusIsolir, s.g.ID: StatusLunas, s.h.ID: StatusLunas,
	}, t0.Add(5*time.Second))
}

// Satu langkah yang gagal di tengah tidak boleh meninggalkan jejak: tidak ada
// status yang berubah, tidak ada baris ditulis atau dibuang, tidak ada
// ketidakcocokan, dan sinkron tetap running supaya pemanggil bisa menutupnya
// sebagai gagal.
func TestStoreApplySuccessIsAtomic(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)
	f.cycle(s.first, t0)
	before := f.customerStatuses()

	good := MatchInvoices(s.second, f.mine())
	if len(good.Changes) == 0 || len(good.Unmatched) == 0 || len(good.WithoutInvoice) == 0 {
		t.Fatalf("hasil dasar kurang lengkap: %+v", good)
	}
	clone := func() Result {
		r := good
		r.Matches = append([]Match(nil), good.Matches...)
		r.Unmatched = append([]Unmatched(nil), good.Unmatched...)
		r.Changes = append([]StatusChange(nil), good.Changes...)
		r.WithoutInvoice = append([]string(nil), good.WithoutInvoice...)
		return r
	}
	corruptions := []struct {
		name   string
		mutate func(r *Result)
	}{
		// Gagal di langkah terakhir, setelah semua yang lain sudah ditulis.
		{"kandidat duplicate kosong", func(r *Result) {
			r.Unmatched[len(r.Unmatched)-1] = Unmatched{
				Invoice: Invoice{Name: "x", Ref: "X", Status: StatusLunas}, Reason: ReasonDuplicate, CustomerIDs: []string{},
			}
		}},
		{"kandidat bukan UUID", func(r *Result) {
			last := &r.Unmatched[len(r.Unmatched)-1]
			last.Reason, last.CustomerIDs = ReasonDuplicate, []string{"bukan-uuid"}
		}},
		{"nama tagihan memuat NUL", func(r *Result) {
			r.Unmatched[len(r.Unmatched)-1].Invoice.Name = "ab\x00cd"
		}},
		// Gagal setelah status billing ditulis dan baris lama dibuang.
		{"status baru tidak sah di Changes", func(r *Result) {
			r.Changes[0].To = Status("menunggak")
		}},
		// Gagal pada penulisan status billing.
		{"pelanggan yang sama dua kali", func(r *Result) {
			r.Matches = append(r.Matches, r.Matches[0])
		}},
		{"ID pelanggan bukan UUID", func(r *Result) {
			r.Matches[len(r.Matches)-1].CustomerID = "zzz-bukan-uuid"
		}},
		{"status tagihan tidak sah", func(r *Result) {
			r.Matches[0].Invoice.Status = Status("menunggak")
		}},
	}

	snapshot, runs := f.dataSnapshot(), ""
	for i, c := range corruptions {
		at := t0.Add(time.Duration(i+1) * time.Hour)
		runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, at)
		if err != nil {
			t.Fatalf("%s: BeginRun: %v", c.name, err)
		}
		runs = f.runsSnapshot()
		res := clone()
		c.mutate(&res)
		res.Counts = countsOf(res) // lolos pemeriksaan Counts; yang gagal adalah database
		err = f.store.ApplySuccess(f.ctx, runID, res, at.Add(time.Second))
		if err == nil {
			t.Fatalf("%s: ApplySuccess seharusnya gagal", c.name)
		}
		if errors.Is(err, ErrInconsistentResult) || errors.Is(err, ErrRunNotRunning) {
			t.Fatalf("%s: gagal bukan karena database: %v", c.name, err)
		}
		if got := f.dataSnapshot(); got != snapshot {
			t.Errorf("%s: data berubah walau gagal:\nsebelum:\n%s\nsesudah:\n%s", c.name, snapshot, got)
		}
		if got := f.runsSnapshot(); got != runs {
			t.Errorf("%s: log berubah walau gagal:\nsebelum:\n%s\nsesudah:\n%s", c.name, runs, got)
		}
		if r := f.run(runID); r.Status != "running" || r.FinishedAt != nil || r.Invoices != nil {
			t.Errorf("%s: sinkron tidak lagi running: %+v", c.name, r)
		}
		if _, err := f.store.BeginRun(f.ctx, TriggerSchedule, at); !errors.Is(err, ErrRunInProgress) {
			t.Errorf("%s: sinkron lain boleh mulai padahal yang ini belum ditutup: %v", c.name, err)
		}
		// Pemanggil menutupnya sebagai gagal; itu pun tidak menyentuh data.
		if err := f.store.FailRun(f.ctx, runID, err, at.Add(2*time.Second)); err != nil {
			t.Fatalf("%s: FailRun: %v", c.name, err)
		}
		if got := f.dataSnapshot(); got != snapshot {
			t.Errorf("%s: FailRun mengubah data", c.name)
		}
	}

	// Setelah semua kegagalan itu, hasil yang sah tetap bisa diterapkan.
	runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(48*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.ApplySuccess(f.ctx, runID, good, t0.Add(48*time.Hour+time.Second)); err != nil {
		t.Fatalf("hasil sah ditolak: %v", err)
	}
	f.verifyApplied(runID, good, before, t0.Add(48*time.Hour+time.Second))
}

func TestStoreApplySuccessRejectsInconsistentCounts(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)
	f.cycle(s.first, t0)
	snapshot := f.dataSnapshot()

	runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	good := MatchInvoices(s.second, f.mine())
	for name, mutate := range map[string]func(c *Counts){
		"tagihan lebih":         func(c *Counts) { c.Invoices++ },
		"cocok kurang":          func(c *Counts) { c.MatchedExact-- },
		"perubahan melebihi":    func(c *Counts) { c.StatusesChanged = c.MatchedExact + c.MatchedNormalized + 1 },
		"negatif":               func(c *Counts) { c.UnmatchedUnknown = -1 },
		"tanpa tagihan berbeda": func(c *Counts) { c.WithoutInvoice += 3 },
	} {
		res := good
		mutate(&res.Counts)
		err := f.store.ApplySuccess(f.ctx, runID, res, t0.Add(time.Hour+time.Second))
		if !errors.Is(err, ErrInconsistentResult) {
			t.Errorf("%s: ApplySuccess = %v, want ErrInconsistentResult", name, err)
		}
		if got := f.dataSnapshot(); got != snapshot {
			t.Errorf("%s: data berubah", name)
		}
		if r := f.run(runID); r.Status != "running" {
			t.Errorf("%s: sinkron = %+v", name, r)
		}
	}
	// Hitungan dari MatchInvoices selalu lolos check database.
	if err := f.store.ApplySuccess(f.ctx, runID, good, t0.Add(time.Hour+time.Second)); err != nil {
		t.Fatal(err)
	}
}

func TestStoreApplySuccessNeedsARunningRun(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)
	f.cycle(s.first, t0)
	res := MatchInvoices(s.second, f.mine())
	snapshot := f.dataSnapshot()
	stamp := t0.Add(time.Hour)

	// Sinkron yang tidak ada.
	if err := f.store.ApplySuccess(f.ctx, "00000000-0000-4000-8000-000000000000", res, stamp); !errors.Is(err, ErrRunNotRunning) {
		t.Errorf("sinkron tak ada: %v", err)
	}
	// Sinkron yang sudah gagal.
	failed, _ := f.store.BeginRun(f.ctx, TriggerSchedule, stamp)
	if err := f.store.FailRun(f.ctx, failed, errors.New("x"), stamp); err != nil {
		t.Fatal(err)
	}
	if err := f.store.ApplySuccess(f.ctx, failed, res, stamp); !errors.Is(err, ErrRunNotRunning) {
		t.Errorf("sinkron gagal: %v", err)
	}
	if got := f.dataSnapshot(); got != snapshot {
		t.Error("data berubah")
	}

	// Sinkron yang sudah berhasil tidak bisa diterapkan lagi (satu sinkron, satu penerapan).
	runID, _ := f.store.BeginRun(f.ctx, TriggerSchedule, stamp.Add(time.Hour))
	if err := f.store.ApplySuccess(f.ctx, runID, res, stamp.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	applied := f.dataSnapshot()
	if err := f.store.ApplySuccess(f.ctx, runID, res, stamp.Add(2*time.Hour)); !errors.Is(err, ErrRunNotRunning) {
		t.Errorf("penerapan kedua pada sinkron yang sama: %v", err)
	}
	if got := f.dataSnapshot(); got != applied {
		t.Error("penerapan kedua mengubah data")
	}
	if r := f.run(runID); !r.FinishedAt.Equal(stamp.Add(time.Hour)) {
		t.Errorf("waktu selesai berubah: %v", r.FinishedAt)
	}
	// Ditutup oleh yang lain sebelum FailRun.
	if err := f.store.FailRun(f.ctx, runID, errors.New("terlambat"), stamp.Add(3*time.Hour)); !errors.Is(err, ErrRunNotRunning) {
		t.Errorf("FailRun pada sinkron berhasil: %v", err)
	}
	if r := f.run(runID); r.Status != "success" || r.Error != nil {
		t.Errorf("sinkron berhasil berubah: %+v", r)
	}
	// ID yang bukan UUID adalah galat, bukan panik.
	if err := f.store.ApplySuccess(f.ctx, "bukan-uuid", res, stamp); err == nil {
		t.Error("ID bukan UUID seharusnya galat")
	}
}

// Menerapkan hasil yang sama dua kali berturut-turut tidak mengubah status
// pelanggan untuk kedua kalinya.
func TestStoreApplySuccessTwiceChangesNothingNew(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)
	f.cycle(s.first, t0)

	run1, res1 := f.cycle(s.second, t0.Add(time.Hour))
	if len(res1.Changes) != 2 {
		t.Fatalf("perubahan pertama = %+v", res1.Changes)
	}
	statuses, xmins := f.customerStatuses(), f.xmins()

	// Satu putaran penuh lagi dengan tagihan yang sama: dibaca ulang, tidak ada beda.
	run2, res2 := f.cycle(s.second, t0.Add(2*time.Hour))
	if len(res2.Changes) != 0 || res2.Counts.StatusesChanged != 0 {
		t.Fatalf("perubahan kedua = %+v", res2.Changes)
	}
	if !reflect.DeepEqual(f.customerStatuses(), statuses) || !reflect.DeepEqual(f.xmins(), xmins) {
		t.Error("putaran kedua menulis baris pelanggan")
	}
	if r := f.run(run2); *r.Changed != 0 || *r.Invoices != 8 {
		t.Errorf("log sinkron kedua = %+v", r)
	}
	f.verifyApplied(run2, res2, statuses, t0.Add(2*time.Hour+5*time.Second))
	// Baris sinkron pertama hanya ketidakcocokan yang masih tersimpan di log-nya.
	var firstMismatches int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM billing_mismatches WHERE run_id = $1::uuid`, run1).Scan(&firstMismatches); err != nil || firstMismatches != len(res1.Unmatched) {
		t.Errorf("ketidakcocokan sinkron pertama = %d (%v), want %d", firstMismatches, err, len(res1.Unmatched))
	}

	// Hasil yang SAMA (dengan daftar Changes lama) diterapkan lagi pada sinkron baru:
	// baris pelanggan tidak ditulis ulang karena statusnya sudah demikian.
	run3, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(3*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.ApplySuccess(f.ctx, run3, res1, t0.Add(3*time.Hour+time.Second)); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.customerStatuses(), statuses) || !reflect.DeepEqual(f.xmins(), xmins) {
		t.Error("hasil yang sama diterapkan lagi dan menulis ulang baris pelanggan")
	}
}

func TestStoreApplySuccessEmptyResultClearsStatuses(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)
	f.cycle(s.first, t0)
	before := f.customerStatuses()
	run, res := f.cycle(nil, t0.Add(time.Hour))
	if res.Counts != (Counts{WithoutInvoice: len(f.custs)}) {
		t.Fatalf("hitungan = %+v", res.Counts)
	}
	f.verifyApplied(run, res, before, t0.Add(time.Hour+5*time.Second))

	// Tanpa pelanggan dan tanpa tagihan pun lolos.
	run2, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.ApplySuccess(f.ctx, run2, MatchInvoices(nil, nil), t0.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
}

// Pelanggan yang dihapus antara membaca dan menerapkan tidak menggagalkan sinkron.
func TestStoreApplySuccessSkipsVanishedCustomer(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)
	res := MatchInvoices(s.second, f.mine())
	if _, err := f.pool.Exec(f.ctx, `DELETE FROM customers WHERE id = $1::uuid`, s.b.ID); err != nil {
		t.Fatal(err)
	}
	runID, _ := f.store.BeginRun(f.ctx, TriggerSchedule, t0)
	if err := f.store.ApplySuccess(f.ctx, runID, res, t0.Add(time.Second)); err != nil {
		t.Fatalf("ApplySuccess: %v", err)
	}
	var rows int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM billing_status WHERE customer_id = $1::uuid`, s.b.ID).Scan(&rows); err != nil || rows != 0 {
		t.Errorf("baris untuk pelanggan yang hilang: %d (%v)", rows, err)
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM billing_status WHERE customer_id = ANY($1::text[]::uuid[])`, []string{s.a.ID, s.c.ID}).Scan(&rows); err != nil || rows != 2 {
		t.Errorf("baris pelanggan lain: %d (%v), want 2", rows, err)
	}
	if r := f.run(runID); r.Status != "success" {
		t.Errorf("sinkron = %+v", r)
	}
}

// remap mengganti ID pelanggan dalam res menurut peta (ID buatan skenario ke ID
// pelanggan sungguhan di database).
func remap(res Result, ids map[string]string) Result {
	out := res
	out.Matches = make([]Match, len(res.Matches))
	for i, m := range res.Matches {
		m.CustomerID = ids[m.CustomerID]
		out.Matches[i] = m
	}
	out.Unmatched = make([]Unmatched, len(res.Unmatched))
	for i, u := range res.Unmatched {
		mapped := make([]string, len(u.CustomerIDs))
		for k, id := range u.CustomerIDs {
			mapped[k] = ids[id]
		}
		u.CustomerIDs = mapped
		out.Unmatched[i] = u
	}
	out.WithoutInvoice = make([]string, len(res.WithoutInvoice))
	for i, id := range res.WithoutInvoice {
		out.WithoutInvoice[i] = ids[id]
	}
	out.Changes = make([]StatusChange, len(res.Changes))
	for i, ch := range res.Changes {
		ch.CustomerID = ids[ch.CustomerID]
		out.Changes[i] = ch
	}
	return out
}

// Hitungan, kandidat, dan nama billing dari ratusan hasil acak lolos check
// database, dan isi database sesudahnya sama dengan hasilnya.
func TestStoreApplySuccessAcceptsEveryRandomResult(t *testing.T) {
	f := newPGFixture(t)
	for seed := uint64(1); seed <= 60; seed++ {
		invoices, customers := randomScenario(seed)
		ids := map[string]string{}
		for _, c := range customers {
			ids[c.ID] = f.addCustomer(fmt.Sprintf("s%d-%s", seed, c.ID), c.Status).ID
		}
		res := remap(MatchInvoices(invoices, customers), ids)
		before := f.customerStatuses()
		started := t0.Add(time.Duration(seed) * time.Hour)
		runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, started)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		if err := f.store.ApplySuccess(f.ctx, runID, res, started.Add(time.Second)); err != nil {
			t.Fatalf("seed %d: ApplySuccess: %v\nhitungan %+v", seed, err, res.Counts)
		}
		f.verifyApplied(runID, res, before, started.Add(time.Second))
		if t.Failed() {
			t.Fatalf("seed %d: isi database tidak sesuai", seed)
		}
	}
}

// --- Sinkron gagal ----------------------------------------------------------

func TestStoreFailRunLeavesStatusesAlone(t *testing.T) {
	f := newPGFixture(t)
	s := newScenario(f)
	f.cycle(s.second, t0)
	snapshot := f.dataSnapshot()

	runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	cause := fmt.Errorf("sinkron: %w", ErrLoginFailed)
	if err := f.store.FailRun(f.ctx, runID, cause, t0.Add(time.Hour+3*time.Second)); err != nil {
		t.Fatal(err)
	}
	r := f.run(runID)
	if r.Status != "failed" || r.Error == nil || *r.Error != cause.Error() || r.FinishedAt == nil ||
		!r.FinishedAt.Equal(t0.Add(time.Hour+3*time.Second)) || r.Invoices != nil || r.Changed != nil {
		t.Errorf("sinkron gagal = %+v", r)
	}
	if got := f.dataSnapshot(); got != snapshot {
		t.Errorf("FailRun mengubah data:\nsebelum:\n%s\nsesudah:\n%s", snapshot, got)
	}
	// Dua kali tidak bisa.
	if err := f.store.FailRun(f.ctx, runID, errors.New("lagi"), t0.Add(2*time.Hour)); !errors.Is(err, ErrRunNotRunning) {
		t.Errorf("FailRun kedua = %v", err)
	}
	if r2 := f.run(runID); *r2.Error != cause.Error() {
		t.Errorf("pesan berubah: %q", *r2.Error)
	}
}

func TestStoreFailRunMessageIsCountedInCharacters(t *testing.T) {
	f := newPGFixture(t)
	cases := []struct {
		name  string
		cause error
		want  string
	}{
		{"CJK 3 byte", errors.New(strings.Repeat("界", 700)), strings.Repeat("界", 500)},
		{"emoji 4 byte", errors.New(strings.Repeat("😀", 501)), strings.Repeat("😀", 500)},
		{"campuran", errors.New(strings.Repeat("aé界😀", 200)), string([]rune(strings.Repeat("aé界😀", 200))[:500])},
		{"tepat 500", errors.New(strings.Repeat("é", 500)), strings.Repeat("é", 500)},
		{"kosong", errors.New(""), FallbackFailureMessage},
		{"spasi", errors.New(" \n\t "), FallbackFailureMessage},
		{"nil", nil, FallbackFailureMessage},
		{"UTF-8 rusak", errors.New("abc\xff\xfedef"), "abc" + string(utf8.RuneError) + "def"},
		{"NUL", errors.New("a\x00b"), "ab"},
	}
	for i, c := range cases {
		runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, t0.Add(time.Duration(i)*time.Hour))
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if err := f.store.FailRun(f.ctx, runID, c.cause, t0.Add(time.Duration(i)*time.Hour+time.Second)); err != nil {
			t.Fatalf("%s: FailRun: %v", c.name, err)
		}
		var msg string
		var chars, bytes int
		if err := f.pool.QueryRow(f.ctx, `SELECT error_message, char_length(error_message), octet_length(error_message) FROM billing_sync_runs WHERE id = $1::uuid`, runID).Scan(&msg, &chars, &bytes); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if msg != c.want {
			t.Errorf("%s: pesan %q (%d karakter), want %q", c.name, truncateForLog(msg), chars, truncateForLog(c.want))
		}
		if chars > 500 {
			t.Errorf("%s: %d karakter", c.name, chars)
		}
		if c.name == "CJK 3 byte" && (chars != 500 || bytes != 1500) {
			t.Errorf("%s: %d karakter, %d byte; want 500 dan 1500", c.name, chars, bytes)
		}
	}
}

// --- Memangkas riwayat ------------------------------------------------------

// finishRun membuat satu sinkron selesai pada waktu tertentu: success dengan
// satu tagihan tak dikenal (supaya ada ketidakcocokan yang ikut terhapus), atau
// failed.
func (f *pgFixture) finishRun(at time.Time, success bool, label string) string {
	f.t.Helper()
	runID, err := f.store.BeginRun(f.ctx, TriggerSchedule, at)
	if err != nil {
		f.t.Fatalf("%s: BeginRun: %v", label, err)
	}
	if success {
		res := MatchInvoices([]Invoice{{Name: f.name("asing-" + label), Ref: label, Status: StatusLunas}}, nil)
		err = f.store.ApplySuccess(f.ctx, runID, res, at.Add(time.Second))
	} else {
		err = f.store.FailRun(f.ctx, runID, errors.New("gagal "+label), at.Add(time.Second))
	}
	if err != nil {
		f.t.Fatalf("%s: %v", label, err)
	}
	return runID
}

func (f *pgFixture) runIDs() map[string]bool {
	f.t.Helper()
	out := map[string]bool{}
	for _, id := range f.query(`SELECT id::text FROM billing_sync_runs`) {
		out[id] = true
	}
	return out
}

func TestStorePruneRunsKeepsNewestFinishedAndLatestSuccess(t *testing.T) {
	f := newPGFixture(t)
	hour := func(n int) time.Time { return t0.Add(time.Duration(n) * time.Hour) }
	// Dari yang terlama: dua sinkron berhasil (S1 lama, S2 sesudahnya), lalu empat gagal.
	s1 := f.finishRun(hour(1), true, "S1")
	s2 := f.finishRun(hour(2), true, "S2")
	f3 := f.finishRun(hour(3), false, "F3")
	f4 := f.finishRun(hour(4), false, "F4")
	f5 := f.finishRun(hour(5), false, "F5")
	f6 := f.finishRun(hour(6), false, "F6")
	running, err := f.store.BeginRun(f.ctx, TriggerSchedule, hour(7))
	if err != nil {
		t.Fatal(err)
	}

	// keep=2 menyimpan F6 dan F5, ditambah S2 (success terbaru) walau lebih tua.
	n, err := f.store.PruneRuns(f.ctx, 2)
	if err != nil || n != 3 {
		t.Fatalf("PruneRuns(2) = %d, %v; want 3", n, err)
	}
	if got, want := f.runIDs(), map[string]bool{f6: true, f5: true, s2: true, running: true}; !reflect.DeepEqual(got, want) {
		t.Errorf("sisa = %v, want %v (yang dibuang: s1=%s f3=%s f4=%s)", got, want, s1, f3, f4)
	}
	// Ketidakcocokan sinkron yang dibuang ikut terhapus; milik S2 tetap.
	var mismatches int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM billing_mismatches WHERE run_id = $1::uuid`, s1).Scan(&mismatches); err != nil || mismatches != 0 {
		t.Errorf("ketidakcocokan S1 = %d (%v)", mismatches, err)
	}
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM billing_mismatches WHERE run_id = $1::uuid`, s2).Scan(&mismatches); err != nil || mismatches != 1 {
		t.Errorf("ketidakcocokan S2 = %d (%v), want 1", mismatches, err)
	}

	// Diulang tidak membuang lagi.
	if n, err := f.store.PruneRuns(f.ctx, 2); err != nil || n != 0 {
		t.Errorf("PruneRuns kedua = %d, %v", n, err)
	}
	// keep=0: hanya success terbaru yang tersisa (dan yang sedang berjalan).
	if n, err := f.store.PruneRuns(f.ctx, 0); err != nil || n != 2 {
		t.Errorf("PruneRuns(0) = %d, %v; want 2", n, err)
	}
	if got, want := f.runIDs(), map[string]bool{s2: true, running: true}; !reflect.DeepEqual(got, want) {
		t.Errorf("sisa = %v, want %v", got, want)
	}
	if _, err := f.store.PruneRuns(f.ctx, -1); err == nil {
		t.Error("keep negatif seharusnya galat")
	}
}

func TestStorePruneRunsWithoutAnySuccessOrWithLargeKeep(t *testing.T) {
	f := newPGFixture(t)
	hour := func(n int) time.Time { return t0.Add(time.Duration(n) * time.Hour) }
	a := f.finishRun(hour(1), false, "A")
	b := f.finishRun(hour(2), false, "B")
	c := f.finishRun(hour(3), false, "C")

	if n, err := f.store.PruneRuns(f.ctx, 10); err != nil || n != 0 {
		t.Fatalf("PruneRuns(10) = %d, %v", n, err)
	}
	if n, err := f.store.PruneRuns(f.ctx, 2); err != nil || n != 1 {
		t.Fatalf("PruneRuns(2) = %d, %v; want 1", n, err)
	}
	if got, want := f.runIDs(), map[string]bool{b: true, c: true}; !reflect.DeepEqual(got, want) {
		t.Errorf("sisa = %v, want %v (a=%s)", got, want, a)
	}
	// Tanpa sinkron success sama sekali, keep=0 membuang semuanya yang selesai.
	if n, err := f.store.PruneRuns(f.ctx, 0); err != nil || n != 2 {
		t.Fatalf("PruneRuns(0) = %d, %v; want 2", n, err)
	}
	if len(f.runIDs()) != 0 {
		t.Errorf("sisa = %v", f.runIDs())
	}
}

// Yang dipertahankan sebagai "success terbaru" adalah yang terbaru selesai,
// bukan yang terbaru dibuat atau yang kebetulan pertama.
func TestStorePruneRunsKeepsTheLatestFinishedSuccess(t *testing.T) {
	f := newPGFixture(t)
	hour := func(n int) time.Time { return t0.Add(time.Duration(n) * time.Hour) }
	old := f.finishRun(hour(1), true, "old")
	newest := f.finishRun(hour(2), true, "new")
	f.finishRun(hour(3), false, "fail1")
	f.finishRun(hour(4), false, "fail2")
	if _, err := f.store.PruneRuns(f.ctx, 1); err != nil {
		t.Fatal(err)
	}
	got := f.runIDs()
	if !got[newest] || got[old] || len(got) != 2 {
		t.Errorf("sisa = %v; success terbaru %s harus tetap dan %s harus hilang", got, newest, old)
	}
}
