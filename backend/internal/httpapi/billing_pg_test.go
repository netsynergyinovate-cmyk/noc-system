package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"noc-isp/backend/internal/billing"
	"noc-isp/backend/internal/wire"
)

// Tes jalur lengkap endpoint billing: tiket nyata, handler HTTP, billing.Reader,
// dan PostgreSQL sungguhan dengan skema proyek (database sekali pakai dari
// `npm test`; dilewati tanpa TEST_DATABASE_URL).
//
// ISOLASI. Paket billing mengosongkan billing_sync_runs dan billing_status milik
// bersama, dan `go test ./...` menjalankan paket secara paralel, jadi tes di sini
// TIDAK memakai tabel di skema public. Tiap tes membuat skema sendiri berisi
// salinan lima tabel yang dibaca (CREATE TABLE ... LIKE public.x INCLUDING ALL:
// kolom, default, check, dan indeks yang sama; tanpa kunci asing) dan koneksinya
// memakai search_path ke skema itu. Hasilnya jawaban yang persis tetap (golden)
// walau paket lain sedang menulis di public.

var billingTables = []string{"routers", "customers", "billing_status", "billing_sync_runs", "billing_mismatches"}

func newBillingSchemaPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	admin := pgTestPool(t)
	ctx := context.Background()
	schema := fmt.Sprintf("billing_http_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("buat skema uji: %v", err)
	}
	for _, table := range billingTables {
		if _, err := admin.Exec(ctx, fmt.Sprintf("CREATE TABLE %s.%s (LIKE public.%s INCLUDING ALL)", schema, table, table)); err != nil {
			t.Fatalf("salin tabel %s: %v", table, err)
		}
	}
	cfg, err := pgxpool.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	})
	return pool
}

// --- Data uji ---------------------------------------------------------------
//
// Semua id tetap supaya jawabannya sama setiap kali (golden). Waktu "sekarang"
// adalah billingNow (10:05:03 UTC): sinkron ke-0 baru mulai tiga detik lalu, 30
// sinkron selesai di jam-jam sebelumnya, dan sinkron berikutnya pukul 11:05:00.

func testUUID(group string, n int) string {
	return fmt.Sprintf("%s-0000-4000-8000-%012x", group, n)
}

func routerUUID1(n int) string   { return testUUID("a0a0a0a0", n) }
func customerUUID1(n int) string { return testUUID("c0c0c0c0", n) }
func runUUID(k int) string       { return testUUID("5a5a5a5a", k) }
func mismatchUUID(n int) string  { return testUUID("e0e0e0e0", n) }

// billingSlot adalah awal sinkron ke-k jam sebelum yang sedang berjalan.
func billingSlot(k int) time.Time {
	return billingNow.Truncate(time.Hour).Add(5 * time.Minute).Add(-time.Duration(k) * time.Hour)
}

// billingFailures adalah pesan gagal yang disimpan Syncer (Classify), bergilir.
var billingFailures = []string{
	"Login ke sistem billing ditolak. Periksa BILLING_USERNAME dan BILLING_PASSWORD. Status lama dipertahankan.",
	"Sistem billing tidak dapat dihubungi (jaringan terputus atau layanan mati). Status lama dipertahankan.",
	"Tampilan sistem billing berubah; selektor profil perlu disesuaikan. Status lama dipertahankan.",
	"Sinkron melewati batas waktu.",
}

type testCustomer struct {
	n      int
	id     string // kosong berarti customerUUID1(n)
	name   string
	pppoe  string
	router int
	stored billing.Status // customers.billing_status
}

func (c testCustomer) uuid() string {
	if c.id != "" {
		return c.id
	}
	return customerUUID1(c.n)
}

// Dua pelanggan terakhir sengaja bernama sama menurut aturan urutan teks (satu
// memakai huruf ë utuh, satu huruf e + tanda trema terpisah) tetapi bukan byte
// yang sama, jadi hanya id yang menentukan urutannya. Yang bertrema terpisah
// diberi id lebih kecil walau dibuat belakangan.
var testCustomers = []testCustomer{
	{n: 1, name: "Agus Firmansyah", pppoe: "agus.firmansyah014", router: 1, stored: billing.StatusLunas},
	{n: 2, name: "agus firmansyah", pppoe: "agus.firmansyah015", router: 2, stored: billing.StatusLunas},
	{n: 3, name: "Budi 10", pppoe: "budi.10", router: 1, stored: billing.StatusLunas},
	{n: 4, name: "Budi 2", pppoe: "budi.2", router: 2, stored: billing.StatusIsolir},
	{n: 5, name: "Dewi Lestari", pppoe: "dewi.lestari01", router: 1, stored: billing.StatusLunas},
	{n: 6, name: "Dewi Lestari", pppoe: "dewi.lestari02", router: 3, stored: billing.StatusLunas},
	{n: 7, name: "\u00c9ka Putri", pppoe: "eka.putri", router: 1, stored: billing.StatusLunas},
	{n: 8, name: "Eka Putri", pppoe: "eka.putri.2", router: 2, stored: billing.StatusLunas},
	{n: 9, name: "Citra", pppoe: "Citra01", router: 3, stored: billing.StatusLunas},
	{n: 10, name: "Citra", pppoe: "citra01", router: 3, stored: billing.StatusIsolir},
	{n: 11, name: "Hendra Kusuma", pppoe: "hendra.k", router: 1, stored: billing.StatusLunas},
	{n: 12, name: "Zaki", pppoe: "zaki.01", router: 3, stored: billing.StatusLunas},
	{n: 13, name: "Wati", pppoe: "wati.07", router: 2, stored: billing.StatusIsolir},
	{n: 14, id: customerUUID1(0xf2), name: "Zo\u00eb Kusuma", pppoe: "zo\u00eb.kusuma", router: 1, stored: billing.StatusLunas},
	{n: 15, id: customerUUID1(0xf1), name: "Zoe\u0308 Kusuma", pppoe: "zoe\u0308.kusuma", router: 1, stored: billing.StatusLunas},
}

var testRouterNames = map[int]string{1: "RTR-Barat-02", 2: "RTR-Timur-01", 3: "RTR-Utara-03"}

// testInvoices adalah isi billing pada sinkron berhasil terakhir (sinkron ke-3).
// Daftar ini lewat billing.MatchInvoices yang asli, jadi baris billing_status,
// ketidakcocokan, dan hitungan sinkron persis seperti yang akan ditulis
// ApplySuccess.
var testInvoices = []billing.Invoice{
	{Name: "agus.firmansyah014", Ref: "INV-10014", Status: billing.StatusLunas},  // pelanggan 1, persis
	{Name: "AGUS.FIRMANSYAH015", Ref: "INV-10015", Status: billing.StatusIsolir}, // pelanggan 2, dirapikan
	{Name: "budi.10", Ref: "INV-10016", Status: billing.StatusLunas},             // pelanggan 3, persis
	{Name: "budi.10", Ref: "INV-10016-B", Status: billing.StatusIsolir},          // tagihan ganda
	{Name: "dewi.lestari01", Ref: "INV-10005", Status: billing.StatusIsolir},     // pelanggan 5
	{Name: "dewi.lestari02", Ref: "INV-10006", Status: billing.StatusLunas},      // pelanggan 6
	{Name: "eka.putri", Ref: "INV-10007", Status: billing.StatusLunas},           // pelanggan 7
	{Name: "zaki.01", Ref: "", Status: billing.StatusLunas},                      // pelanggan 12, tanpa kode tagihan
	{Name: "wati.07", Ref: "INV-10013", Status: billing.StatusLunas},             // pelanggan 13
	{Name: "CITRA01", Ref: "INV-10099", Status: billing.StatusLunas},             // cocok dengan dua pelanggan
	{Name: "mantan.pelanggan01", Ref: "INV-90001", Status: billing.StatusIsolir}, // tidak dikenal
	{Name: "pelanggan.baru02", Ref: "", Status: billing.StatusLunas},             // tidak dikenal, tanpa kode
	{Name: "tanpa.pemilik", Ref: "INV-9005", Status: billing.StatusLunas},        // tidak dikenal
}

const (
	latestSuccessRun = 3 // sinkron berhasil terakhir; ke-1 dan ke-2 gagal
	olderMismatchRun = 4 // sinkron berhasil lebih lama dengan ketidakcocokannya sendiri
	historyRunCount  = 30
)

func runFails(k int) bool { return k <= 2 || k%7 == 0 }

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", strings.Join(strings.Fields(sql), " "), err)
	}
}

// seedBilling mengisi skema uji. Mengembalikan hasil pencocokan sinkron terbaru.
func seedBilling(t *testing.T, pool *pgxpool.Pool) billing.Result {
	t.Helper()
	for id, name := range testRouterNames {
		mustExec(t, pool, `INSERT INTO routers (id, name, host, username, password_enc) VALUES ($1::uuid, $2, $3, 'api', 'enc')`,
			routerUUID1(id), name, fmt.Sprintf("10.20.0.%d", id))
	}
	var forMatching []billing.Customer
	for _, c := range testCustomers {
		mustExec(t, pool, `INSERT INTO customers (id, name, pppoe_username, router_id, billing_status) VALUES ($1::uuid, $2, $3, $4::uuid, $5)`,
			c.uuid(), c.name, c.pppoe, routerUUID1(c.router), string(c.stored))
		forMatching = append(forMatching, billing.Customer{ID: c.uuid(), PPPoE: c.pppoe, Status: c.stored})
	}
	res := billing.MatchInvoices(testInvoices, forMatching)

	// Riwayat: sinkron ke-0 sedang berjalan, ke-1..30 sudah selesai.
	mustExec(t, pool, `INSERT INTO billing_sync_runs (id, started_at, status, trigger) VALUES ($1::uuid, $2, 'running', 'schedule')`,
		runUUID(0), billingSlot(0))
	for k := 1; k <= historyRunCount; k++ {
		started := billingSlot(k)
		finished := started.Add(time.Duration(4+(k*7)%26) * time.Second)
		if runFails(k) {
			mustExec(t, pool, `INSERT INTO billing_sync_runs (id, started_at, finished_at, status, trigger, error_message)
				VALUES ($1::uuid, $2, $3, 'failed', 'schedule', $4)`,
				runUUID(k), started, finished, billingFailures[k%len(billingFailures)])
			continue
		}
		c := billing.Counts{
			MatchedExact: 6 + k%3, MatchedNormalized: k % 2, UnmatchedUnknown: 1 + k%2,
			UnmatchedDuplicate: map[bool]int{true: 1, false: 0}[k%3 == 0], WithoutInvoice: 7, StatusesChanged: k % 3,
		}
		if k == latestSuccessRun {
			c = res.Counts
		}
		c.Invoices = c.MatchedExact + c.MatchedNormalized + c.UnmatchedUnknown + c.UnmatchedDuplicate + c.UnmatchedAmbiguous
		mustExec(t, pool, `INSERT INTO billing_sync_runs (id, started_at, finished_at, status, trigger,
				invoices_total, matched_exact, matched_normalized, unmatched_unknown, unmatched_duplicate, unmatched_ambiguous,
				customers_without_invoice, statuses_changed)
			VALUES ($1::uuid, $2, $3, 'success', 'schedule', $4, $5, $6, $7, $8, $9, $10, $11)`,
			runUUID(k), started, finished, c.Invoices, c.MatchedExact, c.MatchedNormalized, c.UnmatchedUnknown,
			c.UnmatchedDuplicate, c.UnmatchedAmbiguous, c.WithoutInvoice, c.StatusesChanged)
	}

	// Hasil sinkron terbaru, seperti ApplySuccess menuliskannya.
	synced := billingSlot(latestSuccessRun)
	for _, m := range res.Matches {
		ref := any(m.Invoice.Ref)
		if m.Invoice.Ref == "" {
			ref = nil
		}
		mustExec(t, pool, `INSERT INTO billing_status (customer_id, status, invoice_ref, synced_at, match_kind, billing_name, run_id)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)`,
			m.CustomerID, string(m.Invoice.Status), ref, synced, string(m.Kind), m.Invoice.Name, runUUID(latestSuccessRun))
	}
	for i, u := range res.Unmatched {
		ref := any(u.Invoice.Ref)
		if u.Invoice.Ref == "" {
			ref = nil
		}
		mustExec(t, pool, `INSERT INTO billing_mismatches (id, run_id, invoice_name, invoice_ref, invoice_status, reason, customer_ids)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::text[]::uuid[])`,
			mismatchUUID(i+1), runUUID(latestSuccessRun), u.Invoice.Name, ref, string(u.Invoice.Status), string(u.Reason), u.CustomerIDs)
	}
	// Sinkron berhasil yang lebih lama: ketidakcocokannya TIDAK boleh muncul.
	mustExec(t, pool, `INSERT INTO billing_mismatches (id, run_id, invoice_name, invoice_ref, invoice_status, reason)
		VALUES ($1::uuid, $2::uuid, 'lama.sekali', 'INV-OLD-77', 'isolir', 'unknown')`,
		mismatchUUID(900), runUUID(olderMismatchRun))

	// Baris lama dari sebelum migrasi 0006: ada status, tetapi match_kind kosong.
	// Tidak ada hubungannya dengan sinkron terbaru; dibaca sebagai "none", dengan
	// status dari baris itu (bukan customers.billing_status) dan tanpa kode tagihan.
	mustExec(t, pool, `INSERT INTO billing_status (customer_id, status, invoice_ref, synced_at) VALUES ($1::uuid, 'isolir', 'INV-OLD-1', $2)`,
		customerUUID1(11), billingSlot(40))
	return res
}

// billingPGHarness memasang handler lengkap dengan billing.Reader sungguhan di
// atas pool uji dan jadwal Scheduler (menit ke-5 tiap jam UTC).
func billingPGHarness(t *testing.T, pool *pgxpool.Pool) *billingHarness {
	t.Helper()
	return newBillingHarness(t, billing.NewReader(pool), func(now time.Time) time.Time { return billing.NextRun(now, 5) })
}

// --- Golden -----------------------------------------------------------------

var nonASCII = regexp.MustCompile(`[^\x00-\x7f]`)

// goldenForm menormalkan badan jawaban untuk berkas golden: JSON diberi indentasi
// dua spasi (isinya tidak berubah, hanya spasi) dan semua karakter bukan-ASCII
// ditulis \uXXXX, sehingga berkas tidak berubah bila editor menormalkan Unicode.
func goldenForm(t *testing.T, body []byte) []byte {
	t.Helper()
	var indented bytes.Buffer
	if err := json.Indent(&indented, bytes.TrimSpace(body), "", "  "); err != nil {
		t.Fatalf("jawaban bukan JSON: %v\n%s", err, body)
	}
	text := nonASCII.ReplaceAllStringFunc(indented.String(), func(s string) string {
		var out strings.Builder
		for _, r := range s {
			if r > 0xffff {
				r -= 0x10000
				fmt.Fprintf(&out, `\u%04x\u%04x`, 0xd800+(r>>10), 0xdc00+(r&0x3ff))
				continue
			}
			fmt.Fprintf(&out, `\u%04x`, r)
		}
		return out.String()
	})
	return []byte(text + "\n")
}

// checkGolden membandingkan jawaban dengan testdata/<name> BYTE PER BYTE (setelah
// goldenForm; akhir baris CRLF akibat git autocrlf di Windows diabaikan). Berkasnya
// hanya ditulis ulang bila UPDATE_GOLDEN=1. e2e/billing-contract.spec.ts membaca
// berkas yang sama dan memeriksanya terhadap tipe TypeScript.
func checkGolden(t *testing.T, name string, body []byte) {
	t.Helper()
	got := goldenForm(t, body)
	path := filepath.Join("testdata", name)
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("golden %s ditulis ulang (UPDATE_GOLDEN=1)", name)
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("baca golden %s: %v (buat dengan UPDATE_GOLDEN=1)", name, err)
	}
	want := bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
	if bytes.Equal(got, want) {
		return
	}
	gotLines, wantLines := strings.Split(string(got), "\n"), strings.Split(string(want), "\n")
	for i := 0; i < max(len(gotLines), len(wantLines)); i++ {
		var g, w string
		if i < len(gotLines) {
			g = gotLines[i]
		}
		if i < len(wantLines) {
			w = wantLines[i]
		}
		if g != w {
			t.Fatalf("golden %s berbeda di baris %d:\n  jawaban: %s\n  berkas:  %s\n(jalankan dengan UPDATE_GOLDEN=1 hanya bila perubahan kontraknya disengaja)", name, i+1, g, w)
		}
	}
	t.Fatalf("golden %s berbeda (panjang %d vs %d)", name, len(got), len(want))
}

func TestBillingGoldenResponsesFromPostgres(t *testing.T) {
	pool := newBillingSchemaPool(t)
	seedBilling(t, pool)
	h := billingPGHarness(t, pool)

	overview := h.get("/api/v1/billing")
	if overview.Code != http.StatusOK {
		t.Fatalf("/api/v1/billing: status = %d; body %s", overview.Code, overview.Body)
	}
	checkGolden(t, "billing_overview.golden.json", overview.Body.Bytes())

	sync := h.get("/api/v1/billing/sync")
	if sync.Code != http.StatusOK {
		t.Fatalf("/api/v1/billing/sync: status = %d; body %s", sync.Code, sync.Body)
	}
	checkGolden(t, "billing_sync.golden.json", sync.Body.Bytes())
}

// --- Isi jawaban, dibaca satu per satu ---------------------------------------

type billingBody[T any] struct {
	Data T `json:"data"`
}

func TestBillingOverviewContentFromPostgres(t *testing.T) {
	pool := newBillingSchemaPool(t)
	res := seedBilling(t, pool)
	h := billingPGHarness(t, pool)

	rec := h.get("/api/v1/billing")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body %s", rec.Code, rec.Body)
	}
	got := decode[billingBody[wire.BillingOverview]](t, rec).Data

	// --- Baris: satu per pelanggan, dalam urutan nama lalu username lalu id.
	wantOrder := []int{
		2,  // "agus firmansyah" (huruf kecil lebih dulu daripada "Agus Firmansyah")
		1,  // "Agus Firmansyah"
		4,  // "Budi 2" sebelum "Budi 10" (urutan angka, bukan huruf demi huruf)
		3,  // "Budi 10"
		10, // "Citra" + "citra01" (huruf kecil dulu)
		9,  // "Citra" + "Citra01"
		5,  // "Dewi Lestari" + dewi.lestari01
		6,  // "Dewi Lestari" + dewi.lestari02: nama kembar, ditentukan username
		8,  // "Eka Putri"
		7,  // "\u00c9ka Putri": huruf beraksen setelah huruf dasarnya
		11, // "Hendra Kusuma"
		13, // "Wati"
		12, // "Zaki"
		15, // "Zoe\u0308 Kusuma" (id f1) dan
		14, // "Zo\u00eb Kusuma" (id f2): sama menurut urutan teks, ditentukan id
	}
	var order []int
	byNumber := map[string]int{}
	for _, c := range testCustomers {
		byNumber[c.uuid()] = c.n
	}
	for _, row := range got.Rows {
		order = append(order, byNumber[row.CustomerID])
	}
	if !slices.Equal(order, wantOrder) {
		t.Fatalf("urutan baris = %v, want %v", order, wantOrder)
	}
	if len(got.Rows) != len(testCustomers) {
		t.Errorf("jumlah baris = %d, want %d (satu per pelanggan)", len(got.Rows), len(testCustomers))
	}

	byID := map[int]wire.BillingRow{}
	for _, row := range got.Rows {
		byID[byNumber[row.CustomerID]] = row
	}
	str := func(s string) *string { return &s }
	wantRows := map[int]wire.BillingRow{
		// persis, status dari tagihan
		1: {Status: "lunas", Match: "exact", InvoiceRef: str("INV-10014"), BillingName: str("agus.firmansyah014")},
		// dirapikan: nama di billing dipertahankan persis seperti tertulis
		2: {Status: "isolir", Match: "normalized", InvoiceRef: str("INV-10015"), BillingName: str("AGUS.FIRMANSYAH015")},
		// tagihan ganda: yang pertama dipakai
		3: {Status: "lunas", Match: "exact", InvoiceRef: str("INV-10016"), BillingName: str("budi.10")},
		// tanpa tagihan: status yang tersimpan
		4: {Status: "isolir", Match: "none"},
		// dua pelanggan yang cocok dengan satu tagihan "CITRA01": tidak ditebak
		9:  {Status: "lunas", Match: "none"},
		10: {Status: "isolir", Match: "none"},
		// baris lama tanpa match_kind: "none", status dari billing_status (isolir)
		// walau customers.billing_status lunas, tanpa kode tagihan lamanya
		11: {Status: "isolir", Match: "none"},
		// persis tetapi tagihannya tanpa kode: invoiceRef null, billingName terisi
		12: {Status: "lunas", Match: "exact", InvoiceRef: nil, BillingName: str("zaki.01")},
		// status dari billing_status (lunas) menang atas customers.billing_status (isolir)
		13: {Status: "lunas", Match: "exact", InvoiceRef: str("INV-10013"), BillingName: str("wati.07")},
	}
	for n, want := range wantRows {
		row := byID[n]
		if row.Status != want.Status || row.Match != want.Match || !samePtr(row.InvoiceRef, want.InvoiceRef) || !samePtr(row.BillingName, want.BillingName) {
			t.Errorf("pelanggan %d = %s", n, rowString(row))
		}
	}
	for _, c := range testCustomers {
		row := byID[c.n]
		if row.Name != c.name || row.PPPoEUsername != c.pppoe || row.RouterID != routerUUID1(c.router) || row.RouterName != testRouterNames[c.router] {
			t.Errorf("pelanggan %d: identitas = %s", c.n, rowString(row))
		}
		// Aturan kontrak: invoiceRef dan billingName null tepat bila match "none"
		// (kecuali tagihan tanpa kode, yang hanya mengosongkan invoiceRef).
		if (row.Match == "none") != (row.BillingName == nil) {
			t.Errorf("pelanggan %d: billingName null tidak sejalan dengan match %q", c.n, row.Match)
		}
		if row.Match == "none" && row.InvoiceRef != nil {
			t.Errorf("pelanggan %d: match none tetapi invoiceRef = %q", c.n, *row.InvoiceRef)
		}
	}

	// --- Tagihan tak bertuan: hanya dari sinkron berhasil terakhir, urut kode.
	type pair struct{ ref, name, status, reason string }
	var unmatched []pair
	for _, u := range got.Unmatched {
		unmatched = append(unmatched, pair{u.InvoiceRef, u.PPPoEUsername, u.Status, u.Reason})
	}
	wantUnmatched := []pair{
		{"", "pelanggan.baru02", "lunas", "unknown"}, // tanpa kode: "" paling awal
		{"INV-9005", "tanpa.pemilik", "lunas", "unknown"},
		{"INV-10016-B", "budi.10", "isolir", "duplicate"}, // angka 9005 < 10016 < 10099 < 90001
		{"INV-10099", "CITRA01", "lunas", "ambiguous"},
		{"INV-90001", "mantan.pelanggan01", "isolir", "unknown"},
	}
	if !slices.Equal(unmatched, wantUnmatched) {
		t.Errorf("unmatched = %v\nwant       %v", unmatched, wantUnmatched)
	}
	if len(got.Unmatched) != res.Counts.UnmatchedUnknown+res.Counts.UnmatchedDuplicate+res.Counts.UnmatchedAmbiguous {
		t.Errorf("unmatched tidak sama dengan hitungan sinkron terbaru")
	}

	// --- Keadaan sinkron.
	assertSyncState(t, got.Sync, res)
	// Overview dan /sync memberi keadaan yang sama persis.
	syncOnly := decode[billingBody[wire.BillingSyncState]](t, h.get("/api/v1/billing/sync")).Data
	a, _ := json.Marshal(got.Sync)
	b, _ := json.Marshal(syncOnly)
	if !bytes.Equal(a, b) {
		t.Errorf("sync pada /billing berbeda dengan /billing/sync:\n%s\n%s", a, b)
	}
}

func assertSyncState(t *testing.T, s wire.BillingSyncState, latest billing.Result) {
	t.Helper()
	if s.IntervalSeconds != 3600 {
		t.Errorf("intervalSeconds = %d, want 3600", s.IntervalSeconds)
	}
	if want := billing.NextRun(billingNow, 5).Unix(); s.NextRunAt != want || s.NextRunAt <= billingNow.Unix() {
		t.Errorf("nextRunAt = %d, want %d (setelah %d)", s.NextRunAt, want, billingNow.Unix())
	}
	if s.Running == nil || s.Running.StartedAt != billingSlot(0).Unix() {
		t.Errorf("running = %+v, want mulai %d", s.Running, billingSlot(0).Unix())
	}
	if len(s.Runs) != 24 {
		t.Fatalf("jumlah runs = %d, want 24 (dari %d sinkron selesai)", len(s.Runs), historyRunCount)
	}
	for i, run := range s.Runs {
		k := i + 1 // terbaru lebih dulu: sinkron ke-1 jam sebelumnya, lalu ke-2, ...
		if run.ID != runUUID(k) {
			t.Errorf("runs[%d].id = %s, want %s", i, run.ID, runUUID(k))
			continue
		}
		wantFinish := billingSlot(k).Add(time.Duration(4+(k*7)%26) * time.Second)
		if run.StartedAt != billingSlot(k).Unix() || run.FinishedAt != wantFinish.Unix() {
			t.Errorf("runs[%d] waktu = %d..%d, want %d..%d", i, run.StartedAt, run.FinishedAt, billingSlot(k).Unix(), wantFinish.Unix())
		}
		if i > 0 && run.FinishedAt >= s.Runs[i-1].FinishedAt {
			t.Errorf("runs[%d] tidak lebih lama dari runs[%d]", i, i-1)
		}
		switch {
		case runFails(k):
			if run.Status != "failed" || run.Result != nil || run.Error == nil || *run.Error != billingFailures[k%len(billingFailures)] {
				t.Errorf("runs[%d] (k=%d) = %+v", i, k, run)
			}
		default:
			if run.Status != "success" || run.Error != nil || run.Result == nil || run.Result.Invoices != run.Result.Matched+run.Result.Unmatched {
				t.Errorf("runs[%d] (k=%d) = %+v", i, k, run)
			}
		}
	}
	// Hitungan sinkron berhasil terakhir mengikuti hasil pencocokan yang asli.
	last := s.Runs[latestSuccessRun-1]
	c := latest.Counts
	want := wire.BillingSyncResult{
		Invoices:  c.Invoices,
		Matched:   c.MatchedExact + c.MatchedNormalized,
		Unmatched: c.UnmatchedUnknown + c.UnmatchedDuplicate + c.UnmatchedAmbiguous, WithoutInvoice: c.WithoutInvoice,
	}
	if last.Result == nil || *last.Result != want {
		t.Errorf("hasil sinkron terakhir = %+v, want %+v", last.Result, want)
	}
}

func samePtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func rowString(r wire.BillingRow) string {
	ptr := func(p *string) string {
		if p == nil {
			return "null"
		}
		return fmt.Sprintf("%q", *p)
	}
	return fmt.Sprintf("{status:%s match:%s invoiceRef:%s billingName:%s name:%q pppoe:%q router:%s}",
		r.Status, r.Match, ptr(r.InvoiceRef), ptr(r.BillingName), r.Name, r.PPPoEUsername, r.RouterName)
}

// --- Bentuk JSON mentah -------------------------------------------------------

// Bentuknya diperiksa pada teks JSON, bukan pada struct Go yang sama dengan
// penulisnya: kunci persis, tidak ada kunci lain, waktu bilangan bulat detik, dan
// null (bukan hilang) untuk yang nullable.
func TestBillingRawJSONShapeFromPostgres(t *testing.T) {
	pool := newBillingSchemaPool(t)
	seedBilling(t, pool)
	h := billingPGHarness(t, pool)

	decodeRaw := func(path string) map[string]any {
		rec := h.get(path)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d", path, rec.Code)
		}
		dec := json.NewDecoder(rec.Body)
		dec.UseNumber()
		var top map[string]any
		if err := dec.Decode(&top); err != nil {
			t.Fatal(err)
		}
		return top
	}
	keys := func(where string, v any, want ...string) map[string]any {
		t.Helper()
		m, ok := v.(map[string]any)
		if !ok {
			t.Fatalf("%s bukan objek: %T", where, v)
		}
		var got []string
		for k := range m {
			got = append(got, k)
		}
		sort.Strings(got)
		sort.Strings(want)
		if !slices.Equal(got, want) {
			t.Fatalf("%s: kunci = %v, want %v", where, got, want)
		}
		return m
	}
	integer := func(where string, v any) int64 {
		t.Helper()
		n, ok := v.(json.Number)
		if !ok {
			t.Fatalf("%s bukan angka: %T %v", where, v, v)
		}
		i, err := n.Int64()
		if err != nil || strings.ContainsAny(n.String(), ".eE") {
			t.Fatalf("%s bukan bilangan bulat: %s", where, n)
		}
		return i
	}
	epoch := func(where string, v any) {
		t.Helper()
		// Detik epoch tahun 2001..2286; milidetik (1,7 triliun) tidak lolos.
		if i := integer(where, v); i < 1_000_000_000 || i > 10_000_000_000 {
			t.Errorf("%s = %d bukan detik epoch", where, i)
		}
	}
	checkSync := func(where string, v any) {
		t.Helper()
		sync := keys(where, v, "intervalSeconds", "running", "nextRunAt", "runs")
		integer(where+".intervalSeconds", sync["intervalSeconds"])
		epoch(where+".nextRunAt", sync["nextRunAt"])
		running := keys(where+".running", sync["running"], "startedAt")
		epoch(where+".running.startedAt", running["startedAt"])
		runs, ok := sync["runs"].([]any)
		if !ok || len(runs) != 24 {
			t.Fatalf("%s.runs = %T (%d)", where, sync["runs"], len(runs))
		}
		for i, r := range runs {
			w := fmt.Sprintf("%s.runs[%d]", where, i)
			run := keys(w, r, "id", "startedAt", "finishedAt", "status", "result", "error")
			epoch(w+".startedAt", run["startedAt"])
			epoch(w+".finishedAt", run["finishedAt"])
			switch run["status"] {
			case "success":
				result := keys(w+".result", run["result"], "invoices", "matched", "unmatched", "withoutInvoice")
				for k, v := range result {
					integer(w+".result."+k, v)
				}
				if run["error"] != nil {
					t.Errorf("%s: error harus null pada sinkron berhasil: %v", w, run["error"])
				}
			case "failed":
				if run["result"] != nil {
					t.Errorf("%s: result harus null pada sinkron gagal", w)
				}
				if s, ok := run["error"].(string); !ok || strings.TrimSpace(s) == "" {
					t.Errorf("%s: error = %v", w, run["error"])
				}
			default:
				t.Errorf("%s: status = %v", w, run["status"])
			}
		}
	}

	overview := keys("respons", decodeRaw("/api/v1/billing"), "data")["data"]
	body := keys("data", overview, "sync", "rows", "unmatched")
	checkSync("data.sync", body["sync"])
	rows, ok := body["rows"].([]any)
	if !ok || len(rows) != len(testCustomers) {
		t.Fatalf("rows = %T (%d)", body["rows"], len(rows))
	}
	nulls := 0
	for i, r := range rows {
		row := keys(fmt.Sprintf("rows[%d]", i), r, "customerId", "name", "pppoeUsername", "routerId", "routerName", "status", "match", "invoiceRef", "billingName")
		if row["invoiceRef"] == nil || row["billingName"] == nil {
			nulls++
		}
	}
	if nulls == 0 {
		t.Error("tidak ada baris dengan invoiceRef atau billingName null; null harus ditulis, bukan dihilangkan")
	}
	unmatched, ok := body["unmatched"].([]any)
	if !ok || len(unmatched) == 0 {
		t.Fatalf("unmatched = %T", body["unmatched"])
	}
	for i, u := range unmatched {
		keys(fmt.Sprintf("unmatched[%d]", i), u, "invoiceRef", "pppoeUsername", "status", "reason")
	}

	only := keys("respons sync", decodeRaw("/api/v1/billing/sync"), "data")["data"]
	checkSync("data", only)
}

// --- Kegagalan database -------------------------------------------------------

// Galat database sungguhan (tabel hilang) tidak boleh sampai ke klien: nama
// tabel, kode SQLSTATE, dan nama skema hanya ada di log server.
func TestBillingRealDatabaseFailureDoesNotLeak(t *testing.T) {
	pool := newBillingSchemaPool(t)
	seedBilling(t, pool)
	h := billingPGHarness(t, pool)
	if rec := h.get("/api/v1/billing"); rec.Code != http.StatusOK {
		t.Fatalf("sebelum rusak: status = %d", rec.Code)
	}

	mustExec(t, pool, `DROP TABLE billing_mismatches`)
	rec := h.get("/api/v1/billing")
	if rec.Code != http.StatusInternalServerError || rec.Body.String() != "{\"error\":\"internal\"}\n" {
		t.Fatalf("status %d body %q, want 500 {\"error\":\"internal\"}", rec.Code, rec.Body)
	}
	for _, leak := range []string{"billing_mismatches", "relation", "42P01", "SQLSTATE", "billing_http_", "ERROR", "does not exist"} {
		if strings.Contains(rec.Body.String(), leak) {
			t.Errorf("jawaban membocorkan %q: %s", leak, rec.Body)
		}
	}
	if !strings.Contains(h.logs.String(), "billing_mismatches") {
		t.Errorf("sebab galat tidak dicatat di log: %s", h.logs)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", rec.Header().Get("Cache-Control"))
	}
	// Endpoint sinkron tidak menyentuh tabel itu, jadi tetap menjawab.
	if rec := h.get("/api/v1/billing/sync"); rec.Code != http.StatusOK {
		t.Errorf("/billing/sync tanpa billing_mismatches: status = %d, want 200", rec.Code)
	}

	mustExec(t, pool, `DROP TABLE billing_sync_runs`)
	for _, path := range []string{"/api/v1/billing", "/api/v1/billing/sync"} {
		rec := h.get(path)
		if rec.Code != http.StatusInternalServerError || rec.Body.String() != "{\"error\":\"internal\"}\n" {
			t.Errorf("%s tanpa billing_sync_runs: status %d body %q", path, rec.Code, rec.Body)
		}
	}
}

// Pool yang sudah ditutup (koneksi putus) juga menjadi 500 polos.
func TestBillingClosedPoolIsAnInternalError(t *testing.T) {
	pool := newBillingSchemaPool(t)
	seedBilling(t, pool)
	h := billingPGHarness(t, pool)
	pool.Close()
	for _, path := range []string{"/api/v1/billing", "/api/v1/billing/sync"} {
		rec := h.get(path)
		if rec.Code != http.StatusInternalServerError || rec.Body.String() != "{\"error\":\"internal\"}\n" {
			t.Errorf("%s: status %d body %q", path, rec.Code, rec.Body)
		}
	}
}

// Baris yang melanggar kontrak (di sini check constraint dilepas lalu match_kind
// diisi nilai asing) tidak diteruskan sebagai data: 500, dan nilainya tidak bocor.
func TestBillingCorruptRowsAreNotForwarded(t *testing.T) {
	cases := map[string]string{
		"match_kind asing":     `UPDATE billing_status SET match_kind = 'bocor-match' WHERE customer_id = '` + customerUUID1(1) + `'`,
		"status pelanggan":     `UPDATE customers SET billing_status = 'bocor-status' WHERE id = '` + customerUUID1(4) + `'`,
		"alasan asing":         `UPDATE billing_mismatches SET reason = 'bocor-alasan' WHERE id = '` + mismatchUUID(1) + `'`,
		"status tagihan asing": `UPDATE billing_mismatches SET invoice_status = 'bocor-tagihan' WHERE id = '` + mismatchUUID(1) + `'`,
	}
	drops := map[string][]string{
		"match_kind asing":     {"billing_status_match_kind_check", "billing_status_billing_name_check"},
		"status pelanggan":     {"customers_billing_status_check"},
		"alasan asing":         {"billing_mismatches_reason_check", "billing_mismatches_candidates_check"},
		"status tagihan asing": {"billing_mismatches_status_check"},
	}
	tableOf := map[string]string{
		"match_kind asing": "billing_status", "status pelanggan": "customers",
		"alasan asing": "billing_mismatches", "status tagihan asing": "billing_mismatches",
	}
	for name, update := range cases {
		t.Run(name, func(t *testing.T) {
			pool := newBillingSchemaPool(t)
			seedBilling(t, pool)
			h := billingPGHarness(t, pool)
			for _, c := range drops[name] {
				mustExec(t, pool, fmt.Sprintf(`ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s`, tableOf[name], c))
			}
			mustExec(t, pool, update)
			rec := h.get("/api/v1/billing")
			if rec.Code != http.StatusInternalServerError || rec.Body.String() != "{\"error\":\"internal\"}\n" {
				t.Fatalf("status %d body %q, want 500 internal", rec.Code, rec.Body)
			}
			if strings.Contains(rec.Body.String(), "bocor") {
				t.Errorf("nilai rusak bocor: %s", rec.Body)
			}
		})
	}
}

// Tiket tetap diperiksa lebih dulu pada jalur database sungguhan.
func TestBillingFromPostgresStillNeedsATicket(t *testing.T) {
	pool := newBillingSchemaPool(t)
	seedBilling(t, pool)
	h := billingPGHarness(t, pool)
	for _, path := range []string{"/api/v1/billing", "/api/v1/billing/sync"} {
		rec := h.do(http.MethodGet, path, "", nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s tanpa tiket: status = %d, want 401", path, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "Agus") || strings.Contains(rec.Body.String(), "data") {
			t.Errorf("%s tanpa tiket membocorkan data: %s", path, rec.Body)
		}
		// /billing hanya baca (405); /billing/sync menerima POST tetapi butuh
		// billing:manage, jadi tiket viewer ditolak 403.
		wantPost := http.StatusMethodNotAllowed
		if path == "/api/v1/billing/sync" {
			wantPost = http.StatusForbidden
		}
		if rec := h.do(http.MethodPost, path, h.ticket(), nil); rec.Code != wantPost {
			t.Errorf("POST %s: status = %d, want %d", path, rec.Code, wantPost)
		}
		if rec := h.do(http.MethodPut, path, h.ticket(), nil); rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("PUT %s: status = %d, want 405", path, rec.Code)
		}
	}
}
