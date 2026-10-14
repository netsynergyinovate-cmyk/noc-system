package billing

import (
	"math/rand"
	"slices"
	"testing"

	"noc-isp/backend/internal/wire"
)

// Urutan teks yang dipakai pembaca harus sama dengan
// a.localeCompare(b, "id", { numeric: true }) di billing.ts, karena urutan itu
// yang tampil di halaman. Daftar ini diurutkan oleh Node (ICU 78, CLDR 48) dari
// daftar yang sama dengan:
//
//	list.sort((a, b) => a.localeCompare(b, "id", { numeric: true }))
//
// dan dibuktikan lebih luas (600 teks acak) saat pembaca ini ditulis. Bila tes ini
// gagal setelah golang.org/x/text diperbarui, urutan di halaman Billing akan
// berbeda dengan urutan di frontend.
var javaScriptOrder = []string{
	"Agus Firmansyah",
	"agus_firmansyah014",
	"agus-firmansyah014",
	"agus.firmansyah014",
	"Agus.Firmansyah014",
	"BUDI 1",
	"budi 2",
	"Budi 2",
	"budi 10",
	"budi01",
	"Citra 01",
	"citra01",
	"Citra01",
	"Dewi  Lestari",
	"dewi lestari",
	"Dewi Lestari",
	"Edi",
	"Édi",
	"Edo",
	"eka putri",
	"Eka Putri",
	"Éka Putri",
	"Eko",
	"Noño",
	"Ñoño",
	"Zaki",
	"zaki 01",
	"Zaki 1",
}

func TestTextComparerFollowsJavaScriptLocaleCompare(t *testing.T) {
	cmp := newTextComparer()
	rng := rand.New(rand.NewSource(7))
	for round := 0; round < 100; round++ {
		shuffled := slices.Clone(javaScriptOrder)
		rng.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
		slices.SortStableFunc(shuffled, cmp)
		if !slices.Equal(shuffled, javaScriptOrder) {
			t.Fatalf("ronde %d: urutan = %q\nwant %q", round, shuffled, javaScriptOrder)
		}
	}
}

func TestTextComparerIgnoresLeadingZerosAndCanonicalForm(t *testing.T) {
	cmp := newTextComparer()
	// Sama seperti localeCompare numerik di JavaScript, yang memberi 0 untuk
	// keduanya: angka dibandingkan menurut nilainya, dan e + trema terpisah sama
	// dengan ë utuh. Pasangan seperti ini lalu dipisahkan oleh kunci berikutnya
	// (username PPPoE, lalu id), di kedua sisi.
	if got := cmp("Budi 2", "Budi 02"); got != 0 {
		t.Errorf(`cmp("Budi 2", "Budi 02") = %d, want 0`, got)
	}
	if got := cmp("budi1", "budi01"); got != 0 {
		t.Errorf(`cmp("budi1", "budi01") = %d, want 0`, got)
	}
	if got := cmp("Zoë", "Zoë"); got != 0 {
		t.Errorf("ë utuh dan e + trema terpisah: %d, want 0", got)
	}
}

func TestTextComparerIsNotCodePointOrder(t *testing.T) {
	cmp := newTextComparer()
	// Urutan titik kode menaruh semua huruf besar sebelum huruf kecil dan "10"
	// sebelum "2"; halaman tidak boleh begitu.
	if cmp("Budi 2", "Budi 10") >= 0 {
		t.Error(`"Budi 2" harus sebelum "Budi 10"`)
	}
	if cmp("agus", "Budi") >= 0 {
		t.Error(`"agus" harus sebelum "Budi" (huruf besar-kecil tidak menentukan urutan utama)`)
	}
	if cmp("Eka", "Éka") >= 0 || cmp("Éka", "Eko") >= 0 {
		t.Error(`"Éka" harus di antara "Eka" dan "Eko"`)
	}
}

func TestSortRowsBreaksTiesByUsernameThenID(t *testing.T) {
	row := func(id, name, pppoe string) wire.BillingRow {
		return wire.BillingRow{CustomerID: id, Name: name, PPPoEUsername: pppoe}
	}
	rows := []wire.BillingRow{
		row("c3", "Dewi Lestari", "dewi.lestari02"),
		row("c2", "Dewi Lestari", "dewi.lestari01"),
		// Sama menurut urutan teks (ë utuh dan e + trema terpisah), beda byte:
		// hanya id yang memisahkan.
		row("f2", "Zoë", "zoë"),
		row("f1", "Zoë", "zoë"),
		row("c1", "Agus", "agus"),
	}
	sortRows(rows)
	var ids []string
	for _, r := range rows {
		ids = append(ids, r.CustomerID)
	}
	if want := []string{"c1", "c2", "c3", "f1", "f2"}; !slices.Equal(ids, want) {
		t.Errorf("urutan id = %v, want %v", ids, want)
	}
}

func TestSortUnmatchedOrdersByInvoiceRefNumericallyThenNameThenStatusAndReason(t *testing.T) {
	item := func(ref, name, status, reason string) wire.BillingUnmatched {
		return wire.BillingUnmatched{InvoiceRef: ref, PPPoEUsername: name, Status: status, Reason: reason}
	}
	items := []wire.BillingUnmatched{
		item("INV-90001", "x", "lunas", "unknown"),
		item("INV-10099", "x", "lunas", "unknown"),
		item("INV-9005", "x", "lunas", "unknown"),
		item("INV-10", "b", "lunas", "unknown"),
		item("INV-10", "a", "lunas", "unknown"),
		item("", "z", "lunas", "unknown"),
		item("same", "n", "lunas", "unknown"),
		item("same", "n", "isolir", "unknown"),
		item("same", "n", "isolir", "duplicate"),
	}
	sortUnmatched(items)
	var got []string
	for _, u := range items {
		got = append(got, u.InvoiceRef+"/"+u.PPPoEUsername+"/"+u.Status+"/"+u.Reason)
	}
	want := []string{
		"/z/lunas/unknown", // kosong paling awal
		"INV-10/a/lunas/unknown",
		"INV-10/b/lunas/unknown",
		"INV-9005/x/lunas/unknown", // 10 < 9005 < 10099 < 90001
		"INV-10099/x/lunas/unknown",
		"INV-90001/x/lunas/unknown",
		"same/n/isolir/duplicate",
		"same/n/isolir/unknown",
		"same/n/lunas/unknown",
	}
	if !slices.Equal(got, want) {
		t.Errorf("urutan = %q\nwant   %q", got, want)
	}
}
