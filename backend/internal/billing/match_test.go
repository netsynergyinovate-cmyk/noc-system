package billing

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// --- Kesamaan dengan matchBilling TS ----------------------------------------

type fixtureCustomer struct {
	ID     string `json:"id"`
	PPPoE  string `json:"pppoe"`
	Status Status `json:"status"`
}

type fixtureInvoice struct {
	Name   string `json:"name"`
	Ref    string `json:"ref"`
	Status Status `json:"status"`
}

type fixtureMatch struct {
	CustomerID  string    `json:"customerId"`
	Kind        MatchKind `json:"kind"`
	BillingName string    `json:"billingName"`
	Status      Status    `json:"status"`
	Ref         string    `json:"ref"`
}

type fixtureUnmatched struct {
	Name        string   `json:"name"`
	Ref         string   `json:"ref"`
	Status      Status   `json:"status"`
	Reason      Reason   `json:"reason"`
	CustomerIDs []string `json:"customerIds"`
}

type fixtureChange struct {
	CustomerID string `json:"customerId"`
	From       Status `json:"from"`
	To         Status `json:"to"`
}

type fixtureCounts struct {
	Invoices           int `json:"invoices"`
	MatchedExact       int `json:"matchedExact"`
	MatchedNormalized  int `json:"matchedNormalized"`
	UnmatchedUnknown   int `json:"unmatchedUnknown"`
	UnmatchedDuplicate int `json:"unmatchedDuplicate"`
	UnmatchedAmbiguous int `json:"unmatchedAmbiguous"`
	WithoutInvoice     int `json:"withoutInvoice"`
	StatusesChanged    int `json:"statusesChanged"`
}

type fixtureExpected struct {
	Matches        []fixtureMatch     `json:"matches"`
	Unmatched      []fixtureUnmatched `json:"unmatched"`
	WithoutInvoice []string           `json:"withoutInvoice"`
	Changes        []fixtureChange    `json:"changes"`
	Counts         fixtureCounts      `json:"counts"`
}

type fixtureCase struct {
	Name      string            `json:"name"`
	Customers []fixtureCustomer `json:"customers"`
	Invoices  []fixtureInvoice  `json:"invoices"`
	Expected  fixtureExpected   `json:"expected"`
}

func loadFixture(t *testing.T) []fixtureCase {
	t.Helper()
	raw, err := os.ReadFile("testdata/match_cases.json")
	if err != nil {
		t.Fatalf("baca berkas contoh: %v", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var cases []fixtureCase
	if err := dec.Decode(&cases); err != nil {
		t.Fatalf("berkas contoh tidak terbaca: %v", err)
	}
	return cases
}

func (c fixtureCase) inputs() ([]Invoice, []Customer) {
	invoices := make([]Invoice, len(c.Invoices))
	for i, inv := range c.Invoices {
		invoices[i] = Invoice{Name: inv.Name, Ref: inv.Ref, Status: inv.Status}
	}
	customers := make([]Customer, len(c.Customers))
	for i, cu := range c.Customers {
		customers[i] = Customer{ID: cu.ID, PPPoE: cu.PPPoE, Status: cu.Status}
	}
	return invoices, customers
}

// toExpected mengubah Result ke bentuk berkas contoh.
func toExpected(r Result) fixtureExpected {
	e := fixtureExpected{
		Matches:        []fixtureMatch{},
		Unmatched:      []fixtureUnmatched{},
		WithoutInvoice: append([]string{}, r.WithoutInvoice...),
		Changes:        []fixtureChange{},
		Counts: fixtureCounts{
			Invoices: r.Counts.Invoices, MatchedExact: r.Counts.MatchedExact,
			MatchedNormalized: r.Counts.MatchedNormalized, UnmatchedUnknown: r.Counts.UnmatchedUnknown,
			UnmatchedDuplicate: r.Counts.UnmatchedDuplicate, UnmatchedAmbiguous: r.Counts.UnmatchedAmbiguous,
			WithoutInvoice: r.Counts.WithoutInvoice, StatusesChanged: r.Counts.StatusesChanged,
		},
	}
	for _, m := range r.Matches {
		e.Matches = append(e.Matches, fixtureMatch{
			CustomerID: m.CustomerID, Kind: m.Kind, BillingName: m.Invoice.Name, Status: m.Invoice.Status, Ref: m.Invoice.Ref,
		})
	}
	for _, u := range r.Unmatched {
		e.Unmatched = append(e.Unmatched, fixtureUnmatched{
			Name: u.Invoice.Name, Ref: u.Invoice.Ref, Status: u.Invoice.Status, Reason: u.Reason,
			CustomerIDs: append([]string{}, u.CustomerIDs...),
		})
	}
	for _, c := range r.Changes {
		e.Changes = append(e.Changes, fixtureChange{CustomerID: c.CustomerID, From: c.From, To: c.To})
	}
	return e
}

// Berkas contoh dibuat dari matchBilling TS yang asli (e2e/billing-conformance.
// spec.ts), jadi tes ini membuktikan MatchInvoices menjawab sama persis dengan
// aturan frontend, termasuk untuk huruf non-ASCII dan spasi yang tidak lazim.
func TestMatchInvoicesConformsToFixture(t *testing.T) {
	cases := loadFixture(t)
	if len(cases) < 450 {
		t.Fatalf("berkas contoh hanya %d kasus; jalankan UPDATE_BILLING_FIXTURE=1 npm run test:e2e -- e2e/billing-conformance.spec.ts", len(cases))
	}
	var totals fixtureCounts
	for _, c := range cases {
		invoices, customers := c.inputs()
		got := toExpected(MatchInvoices(invoices, customers))
		if !reflect.DeepEqual(got, c.Expected) {
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(c.Expected)
			t.Errorf("kasus %q\n  Go: %s\n  TS: %s", c.Name, gotJSON, wantJSON)
		}
		// Urutan pelanggan masukan tidak boleh berpengaruh.
		reversed := make([]Customer, len(customers))
		for i, cu := range customers {
			reversed[len(customers)-1-i] = cu
		}
		if again := toExpected(MatchInvoices(invoices, reversed)); !reflect.DeepEqual(again, got) {
			t.Errorf("kasus %q: hasil berubah bila urutan pelanggan dibalik", c.Name)
		}
		totals.MatchedExact += c.Expected.Counts.MatchedExact
		totals.MatchedNormalized += c.Expected.Counts.MatchedNormalized
		totals.UnmatchedUnknown += c.Expected.Counts.UnmatchedUnknown
		totals.UnmatchedDuplicate += c.Expected.Counts.UnmatchedDuplicate
		totals.UnmatchedAmbiguous += c.Expected.Counts.UnmatchedAmbiguous
		totals.WithoutInvoice += c.Expected.Counts.WithoutInvoice
		totals.StatusesChanged += c.Expected.Counts.StatusesChanged
	}
	// Berkas yang kosong atau dangkal membuat tes ini lolos tanpa membuktikan apa-apa.
	if totals.MatchedExact < 300 || totals.MatchedNormalized < 300 || totals.UnmatchedUnknown < 100 ||
		totals.UnmatchedDuplicate < 50 || totals.UnmatchedAmbiguous < 30 || totals.WithoutInvoice < 100 ||
		totals.StatusesChanged < 100 {
		t.Errorf("berkas contoh tidak cukup beragam: %+v", totals)
	}
}

// --- Perapian nama ----------------------------------------------------------

func TestNormalizePPPoEMatchesJavaScript(t *testing.T) {
	cases := []struct{ in, want string }{
		{"  Budi.Santoso001 ", "budi.santoso001"},
		{"a b", "a b"},
		{"", ""},
		{"\tUSER1\n", "user1"},
		// trim JavaScript membuang BOM dan semua Zs, tetapi tidak U+0085.
		{"\uFEFFUser1\uFEFF", "user1"},
		{"\u00A0User1\u3000", "user1"},
		{"\u2028User1\u2029", "user1"},
		{"\u2003User1\u200A", "user1"},
		{"\u0085User1\u0085", "\u0085user1\u0085"},
		{"\u200BUser1", "\u200Buser1"},
		{"\u180EUser1", "\u180Euser1"},
		{"User\u00A01", "user\u00A01"},
		// toLowerCase JavaScript memakai pemetaan penuh.
		{"İ", "i\u0307"},
		{"İSTANBUL", "i\u0307stanbul"},
		{"I", "i"},
		{"ı", "ı"},
		// Sigma akhir kata menjadi ς, selain itu σ.
		{"ΑΣ", "ας"},
		{"ΑΣΑ", "ασα"},
		{"Σ", "σ"},
		{"ΑΣ ΑΣ", "ας ας"},
		{"ΑΣ.", "ας."},
		{"Α.Σ", "α.ς"},
		{"ΑΣ.Α", "ασ.α"},
		{"ΑΣ1", "ας1"},
		{"1Σ", "1σ"},
		{"ΣΑ", "σα"},
		{"ΟΔΟΣ", "οδος"},
		// Selebihnya pemetaan huruf kecil sederhana.
		{"STRASSE", "strasse"},
		{"Straße", "straße"},
		{"KELVIN", "kelvin"},
		{"Ω", "ω"},
		{"ＵＳＥＲ１", "ｕｓｅｒ１"},
		{"𐐀𐐁", "𐐨𐐩"},
		{"ǅ", "ǆ"},
	}
	for _, c := range cases {
		if got := NormalizePPPoE(c.in); got != c.want {
			t.Errorf("NormalizePPPoE(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// --- Aturan, dengan kasus tangan --------------------------------------------

func cust(id, pppoe string, status Status) Customer {
	return Customer{ID: id, PPPoE: pppoe, Status: status}
}

func inv(ref, name string, status Status) Invoice {
	return Invoice{Name: name, Ref: ref, Status: status}
}

func matchOf(t *testing.T, r Result, customerID string) Match {
	t.Helper()
	for _, m := range r.Matches {
		if m.CustomerID == customerID {
			return m
		}
	}
	t.Fatalf("tidak ada cocok untuk %s: %+v", customerID, r.Matches)
	return Match{}
}

func TestMatchInvoicesExactBeatsNormalizedInAnyOrder(t *testing.T) {
	customers := []Customer{cust("c1", "user1", StatusLunas)}
	loose := inv("INV-A", "USER1", StatusLunas)
	exact := inv("INV-B", "user1", StatusIsolir)
	for _, invoices := range [][]Invoice{{loose, exact}, {exact, loose}} {
		r := MatchInvoices(invoices, customers)
		m := matchOf(t, r, "c1")
		if m.Kind != MatchExact || m.Invoice.Ref != "INV-B" {
			t.Errorf("cocok = %+v, want persis INV-B", m)
		}
		if len(r.Unmatched) != 1 || r.Unmatched[0].Invoice.Ref != "INV-A" || r.Unmatched[0].Reason != ReasonDuplicate ||
			!reflect.DeepEqual(r.Unmatched[0].CustomerIDs, []string{"c1"}) {
			t.Errorf("belum cocok = %+v", r.Unmatched)
		}
		if len(r.Changes) != 1 || r.Changes[0] != (StatusChange{CustomerID: "c1", From: StatusLunas, To: StatusIsolir}) {
			t.Errorf("perubahan = %+v", r.Changes)
		}
	}
}

func TestMatchInvoicesFirstOfEqualKindWins(t *testing.T) {
	customers := []Customer{cust("c1", "user1", StatusLunas)}
	for _, pair := range [][2]string{{"user1", "user1"}, {" user1", "USER1"}} {
		a, b := inv("INV-1", pair[0], StatusLunas), inv("INV-2", pair[1], StatusIsolir)
		forward := MatchInvoices([]Invoice{a, b}, customers)
		if forward.Matches[0].Invoice.Ref != "INV-1" || forward.Unmatched[0].Invoice.Ref != "INV-2" {
			t.Errorf("%q: yang pertama harus menang: %+v", pair, forward)
		}
		reversed := MatchInvoices([]Invoice{b, a}, customers)
		if reversed.Matches[0].Invoice.Ref != "INV-2" || reversed.Unmatched[0].Invoice.Ref != "INV-1" {
			t.Errorf("%q: urutan dibalik, yang kedua tadi harus menang: %+v", pair, reversed)
		}
	}
}

func TestMatchInvoicesAmbiguousListsEveryCandidateSorted(t *testing.T) {
	customers := []Customer{
		cust("c3", "BUDI01", StatusLunas), cust("c1", "Budi01", StatusLunas), cust("c2", "budi01", StatusLunas),
		cust("c9", "lain", StatusLunas),
	}
	r := MatchInvoices([]Invoice{inv("INV-1", "bUdI01", StatusLunas)}, customers)
	if len(r.Matches) != 0 || len(r.Unmatched) != 1 {
		t.Fatalf("hasil = %+v", r)
	}
	u := r.Unmatched[0]
	if u.Reason != ReasonAmbiguous || !reflect.DeepEqual(u.CustomerIDs, []string{"c1", "c2", "c3"}) {
		t.Errorf("belum cocok = %+v", u)
	}
	if !reflect.DeepEqual(r.WithoutInvoice, []string{"c1", "c2", "c3", "c9"}) {
		t.Errorf("tanpa tagihan = %v", r.WithoutInvoice)
	}
	// Yang ditulis persis tetap dikenali dan tidak menyentuh kembarannya.
	r = MatchInvoices([]Invoice{inv("INV-2", "budi01", StatusLunas), inv("INV-1", "Budi01", StatusLunas)}, customers)
	if len(r.Unmatched) != 0 || matchOf(t, r, "c2").Invoice.Ref != "INV-2" || matchOf(t, r, "c1").Invoice.Ref != "INV-1" {
		t.Errorf("hasil = %+v", r)
	}
}

func TestMatchInvoicesNormalizedNeedsExactlyOneCustomer(t *testing.T) {
	// Dua pelanggan yang hanya beda spasi di ujung: "USER1" cocok dengan keduanya.
	customers := []Customer{cust("c1", " user1", StatusLunas), cust("c2", "user1", StatusLunas)}
	r := MatchInvoices([]Invoice{inv("INV-1", "USER1", StatusLunas), inv("INV-2", " user1", StatusLunas)}, customers)
	if len(r.Unmatched) != 1 || r.Unmatched[0].Reason != ReasonAmbiguous {
		t.Errorf("belum cocok = %+v", r.Unmatched)
	}
	if len(r.Matches) != 1 || r.Matches[0].CustomerID != "c1" || r.Matches[0].Kind != MatchExact {
		t.Errorf("cocok = %+v", r.Matches)
	}
}

func TestMatchInvoicesUnmatchedIsNotGuessed(t *testing.T) {
	customers := []Customer{cust("c1", "user1", StatusIsolir), cust("c2", "user2", StatusLunas)}
	for _, written := range []string{"us er1", "user 1", "user", "user11", "user-1", ""} {
		r := MatchInvoices([]Invoice{inv("INV-1", written, StatusLunas)}, customers)
		if len(r.Matches) != 0 || len(r.Changes) != 0 {
			t.Errorf("%q: seharusnya tidak cocok: %+v", written, r)
		}
		if len(r.Unmatched) != 1 || r.Unmatched[0].Reason != ReasonUnknown || r.Unmatched[0].CustomerIDs == nil || len(r.Unmatched[0].CustomerIDs) != 0 {
			t.Errorf("%q: belum cocok = %+v", written, r.Unmatched)
		}
	}
}

func TestMatchInvoicesCustomerWithoutInvoiceKeepsItsStatus(t *testing.T) {
	r := MatchInvoices(
		[]Invoice{inv("INV-2", "user2", StatusLunas)},
		[]Customer{cust("c1", "user1", StatusIsolir), cust("c2", "user2", StatusLunas)},
	)
	if !reflect.DeepEqual(r.WithoutInvoice, []string{"c1"}) || len(r.Changes) != 0 {
		t.Errorf("hasil = %+v", r)
	}
}

func TestMatchInvoicesChangesOnlyRealDifferences(t *testing.T) {
	customers := []Customer{
		cust("c1", "a", StatusLunas), cust("c2", "b", StatusLunas), cust("c3", "c", StatusIsolir), cust("c4", "d", StatusIsolir),
	}
	invoices := []Invoice{
		inv("1", "a", StatusLunas), inv("2", "b", StatusIsolir), inv("3", "c", StatusLunas), inv("4", "d", StatusIsolir),
	}
	r := MatchInvoices(invoices, customers)
	want := []StatusChange{
		{CustomerID: "c2", From: StatusLunas, To: StatusIsolir},
		{CustomerID: "c3", From: StatusIsolir, To: StatusLunas},
	}
	if !reflect.DeepEqual(r.Changes, want) {
		t.Errorf("perubahan = %+v, want %+v", r.Changes, want)
	}
	if r.Counts.StatusesChanged != 2 || r.Counts.MatchedExact != 4 || r.Counts.Invoices != 4 {
		t.Errorf("hitungan = %+v", r.Counts)
	}
}

func TestMatchInvoicesEmptyInputs(t *testing.T) {
	r := MatchInvoices(nil, nil)
	if r.Matches == nil || r.Unmatched == nil || r.WithoutInvoice == nil || r.Changes == nil {
		t.Errorf("daftar kosong tidak boleh nil: %+v", r)
	}
	if r.Counts != (Counts{}) {
		t.Errorf("hitungan = %+v", r.Counts)
	}
	r = MatchInvoices([]Invoice{inv("1", "x", StatusLunas)}, nil)
	if r.Counts != (Counts{Invoices: 1, UnmatchedUnknown: 1}) {
		t.Errorf("hitungan = %+v", r.Counts)
	}
}

// Kolom customers.pppoe_username unik; bila masukan melanggarnya, hasilnya tetap
// tidak bergantung pada urutan pelanggan.
func TestMatchInvoicesDuplicateCustomerNamesAreDeterministic(t *testing.T) {
	a, b := cust("c1", "user1", StatusLunas), cust("c2", "user1", StatusLunas)
	invoices := []Invoice{inv("1", "user1", StatusIsolir)}
	r1 := MatchInvoices(invoices, []Customer{a, b})
	r2 := MatchInvoices(invoices, []Customer{b, a})
	if !reflect.DeepEqual(r1, r2) || r1.Matches[0].CustomerID != "c1" {
		t.Errorf("r1 = %+v, r2 = %+v", r1, r2)
	}
}

func TestMatchInvoicesDoesNotModifyInputs(t *testing.T) {
	customers := []Customer{cust("c2", "B", StatusLunas), cust("c1", "a", StatusIsolir)}
	invoices := []Invoice{inv("2", "b ", StatusIsolir), inv("1", "A", StatusLunas), inv("3", "zz", StatusLunas)}
	beforeC := append([]Customer(nil), customers...)
	beforeI := append([]Invoice(nil), invoices...)
	MatchInvoices(invoices, customers)
	if !reflect.DeepEqual(customers, beforeC) || !reflect.DeepEqual(invoices, beforeI) {
		t.Errorf("masukan berubah: %+v %+v", customers, invoices)
	}
}

// --- Sifat, terhadap acuan yang ditulis lain --------------------------------

// refOutcome adalah jawaban acuan untuk satu tagihan.
type refOutcome struct {
	customer   string // ID pelanggan yang dipakai; "" bila tidak dipakai
	kind       MatchKind
	reason     Reason
	candidates []string
}

// referenceMatch menuliskan aturan dari sisi PELANGGAN dan tanpa peta: tiap
// pelanggan mencari tagihannya sendiri (yang persis lebih dulu, lalu yang
// dirapikan), dan tagihan yang tidak terpilih diberi alasan dengan menyaring
// seluruh daftar pelanggan. Nama di tes ini hanya ASCII dengan spasi, tab, dan
// baris baru, jadi perapiannya cukup strings.Trim dan ToLower.
func referenceMatch(invoices []Invoice, customers []Customer) []refOutcome {
	norm := func(s string) string { return strings.ToLower(strings.Trim(s, " \t\r\n")) }
	exactOwners := func(name string) []Customer {
		var out []Customer
		for _, c := range customers {
			if c.PPPoE == name {
				out = append(out, c)
			}
		}
		return out
	}
	sameKey := func(name string) []Customer {
		var out []Customer
		for _, c := range customers {
			if norm(c.PPPoE) == norm(name) {
				out = append(out, c)
			}
		}
		return out
	}

	winner := map[string]int{} // ID pelanggan -> indeks tagihan
	for _, c := range customers {
		for i, in := range invoices {
			if in.Name == c.PPPoE {
				winner[c.ID] = i
				break
			}
		}
	}
	for _, c := range customers {
		if _, ok := winner[c.ID]; ok {
			continue
		}
		for i, in := range invoices {
			if len(exactOwners(in.Name)) > 0 || norm(in.Name) != norm(c.PPPoE) || len(sameKey(in.Name)) != 1 {
				continue
			}
			winner[c.ID] = i
			break
		}
	}

	out := make([]refOutcome, len(invoices))
	for i, in := range invoices {
		for id, w := range winner {
			if w == i {
				out[i] = refOutcome{customer: id, kind: MatchNormalized}
				if in.Name == customerByID(customers, id).PPPoE {
					out[i].kind = MatchExact
				}
			}
		}
		if out[i].customer != "" {
			continue
		}
		var ids []string
		if owners := exactOwners(in.Name); len(owners) > 0 {
			out[i].reason = ReasonDuplicate
			ids = []string{owners[0].ID}
		} else {
			keyed := sameKey(in.Name)
			for _, c := range keyed {
				ids = append(ids, c.ID)
			}
			switch len(keyed) {
			case 0:
				out[i].reason = ReasonUnknown
			case 1:
				out[i].reason = ReasonDuplicate
			default:
				out[i].reason = ReasonAmbiguous
			}
		}
		sort.Strings(ids)
		out[i].candidates = ids
	}
	return out
}

func customerByID(customers []Customer, id string) Customer {
	for _, c := range customers {
		if c.ID == id {
			return c
		}
	}
	return Customer{}
}

// Data acak yang sengaja penuh jebakan: kembar yang hanya beda huruf besar atau
// spasi, tagihan ganda, salah ketik, dan tagihan tanpa pelanggan.
func randomScenario(seed uint64) ([]Invoice, []Customer) {
	rng := rand.New(rand.NewPCG(seed, seed*7919+1))
	pick := func(items ...string) string { return items[rng.IntN(len(items))] }
	status := func(isolirOdds float64) Status {
		if rng.Float64() < isolirOdds {
			return StatusIsolir
		}
		return StatusLunas
	}
	respell := func(s string) string {
		return pick(strings.ToUpper(s), strings.ToLower(s), " "+s, s+" ", "\t"+s+"\n", "  "+strings.ToUpper(s)+"  ")
	}

	var customers []Customer
	taken := map[string]bool{}
	add := func(name string) {
		if taken[name] {
			return
		}
		taken[name] = true
		customers = append(customers, Customer{ID: fmt.Sprintf("c%03d", len(customers)+1), PPPoE: name, Status: status(0.3)})
	}
	for i, n := 0, rng.IntN(25); i < n; i++ {
		name := fmt.Sprintf("user%d", rng.IntN(30))
		if rng.IntN(4) == 0 {
			name = strings.ToUpper(name)
		}
		add(name)
	}
	for _, c := range append([]Customer(nil), customers...) {
		if rng.IntN(8) == 0 {
			add(pick(strings.ToUpper(c.PPPoE), " "+c.PPPoE))
		}
	}

	var invoices []Invoice
	addInvoice := func(name string) {
		invoices = append(invoices, Invoice{Name: name, Ref: fmt.Sprintf("INV-%03d", len(invoices)+1), Status: status(0.35)})
	}
	for _, c := range customers {
		switch roll := rng.Float64(); {
		case roll < 0.2:
			continue
		case roll < 0.5:
			addInvoice(c.PPPoE)
		case roll < 0.8:
			addInvoice(respell(c.PPPoE))
		default:
			addInvoice(c.PPPoE[:len(c.PPPoE)-1])
		}
		if rng.IntN(8) == 0 {
			addInvoice(respell(c.PPPoE))
		}
		if rng.IntN(16) == 0 {
			addInvoice(c.PPPoE)
		}
	}
	for i, n := 0, rng.IntN(4); i < n; i++ {
		addInvoice(fmt.Sprintf("orang.asing%d", i))
	}
	rng.Shuffle(len(invoices), func(i, j int) { invoices[i], invoices[j] = invoices[j], invoices[i] })
	rng.Shuffle(len(customers), func(i, j int) { customers[i], customers[j] = customers[j], customers[i] })
	return invoices, customers
}

const randomRounds = 500

func TestMatchInvoicesEqualsReferenceOnRandomData(t *testing.T) {
	var sawDuplicate, sawAmbiguous, sawNormalized, sawUnknown int
	for seed := uint64(1); seed <= randomRounds; seed++ {
		invoices, customers := randomScenario(seed)
		r := MatchInvoices(invoices, customers)
		want := referenceMatch(invoices, customers)

		// Tiap tagihan di tepat satu tempat, dalam urutan masukan.
		mi, ui := 0, 0
		for i, in := range invoices {
			w := want[i]
			if w.customer != "" {
				if mi >= len(r.Matches) || r.Matches[mi].Invoice != in {
					t.Fatalf("seed %d: tagihan %s seharusnya cocok pada urutan ini", seed, in.Ref)
				}
				m := r.Matches[mi]
				mi++
				if m.CustomerID != w.customer || m.Kind != w.kind {
					t.Fatalf("seed %d: %s cocok dengan %s/%s, want %s/%s", seed, in.Ref, m.CustomerID, m.Kind, w.customer, w.kind)
				}
				if m.Kind == MatchNormalized {
					sawNormalized++
				}
				continue
			}
			if ui >= len(r.Unmatched) || r.Unmatched[ui].Invoice != in {
				t.Fatalf("seed %d: tagihan %s seharusnya belum cocok pada urutan ini", seed, in.Ref)
			}
			u := r.Unmatched[ui]
			ui++
			if u.Reason != w.reason || !reflect.DeepEqual(append([]string{}, u.CustomerIDs...), append([]string{}, w.candidates...)) {
				t.Fatalf("seed %d: %s alasan %s %v, want %s %v", seed, in.Ref, u.Reason, u.CustomerIDs, w.reason, w.candidates)
			}
			switch u.Reason {
			case ReasonDuplicate:
				sawDuplicate++
			case ReasonAmbiguous:
				sawAmbiguous++
			case ReasonUnknown:
				sawUnknown++
			}
		}
		if mi != len(r.Matches) || ui != len(r.Unmatched) {
			t.Fatalf("seed %d: ada hasil berlebih: %d/%d cocok, %d/%d belum cocok", seed, mi, len(r.Matches), ui, len(r.Unmatched))
		}
		if len(r.Matches)+len(r.Unmatched) != len(invoices) {
			t.Fatalf("seed %d: jumlah tagihan tidak sama", seed)
		}

		// Tiap pelanggan paling banyak satu tagihan, dan tepat di satu daftar.
		used := map[string]bool{}
		for _, m := range r.Matches {
			if used[m.CustomerID] {
				t.Fatalf("seed %d: pelanggan %s dipakai dua tagihan", seed, m.CustomerID)
			}
			used[m.CustomerID] = true
		}
		for _, id := range r.WithoutInvoice {
			if used[id] {
				t.Fatalf("seed %d: pelanggan %s ada di dua daftar", seed, id)
			}
		}
		if len(used)+len(r.WithoutInvoice) != len(customers) {
			t.Fatalf("seed %d: pelanggan tidak semua terhitung", seed)
		}
		if !sort.StringsAreSorted(r.WithoutInvoice) {
			t.Fatalf("seed %d: WithoutInvoice tidak terurut", seed)
		}

		// Hitungan sesuai isi, dan jumlahnya lolos aturan database.
		if r.Counts != countsOf(r) {
			t.Fatalf("seed %d: hitungan %+v, isi %+v", seed, r.Counts, countsOf(r))
		}
		c := r.Counts
		if c.Invoices != len(invoices) ||
			c.Invoices != c.MatchedExact+c.MatchedNormalized+c.UnmatchedUnknown+c.UnmatchedDuplicate+c.UnmatchedAmbiguous ||
			c.StatusesChanged > c.MatchedExact+c.MatchedNormalized || c.WithoutInvoice != len(r.WithoutInvoice) {
			t.Fatalf("seed %d: hitungan tidak masuk akal: %+v", seed, c)
		}

		// Hanya perubahan nyata, dari status yang sebenarnya.
		statusOf := map[string]Status{}
		for _, cu := range customers {
			statusOf[cu.ID] = cu.Status
		}
		wantChanges := 0
		for _, m := range r.Matches {
			if statusOf[m.CustomerID] != m.Invoice.Status {
				wantChanges++
			}
		}
		if len(r.Changes) != wantChanges {
			t.Fatalf("seed %d: %d perubahan, want %d", seed, len(r.Changes), wantChanges)
		}
		for _, ch := range r.Changes {
			if ch.From == ch.To || ch.From != statusOf[ch.CustomerID] || ch.To != matchOf(t, r, ch.CustomerID).Invoice.Status {
				t.Fatalf("seed %d: perubahan salah: %+v", seed, ch)
			}
		}
	}
	// Datanya memuat semua keadaan, jadi pengujian ini bermakna.
	if sawDuplicate < 100 || sawAmbiguous < 20 || sawNormalized < 300 || sawUnknown < 200 {
		t.Errorf("data acak kurang beragam: duplikat %d, ambigu %d, dirapikan %d, tak dikenal %d",
			sawDuplicate, sawAmbiguous, sawNormalized, sawUnknown)
	}
}

func TestMatchInvoicesOrderIndependence(t *testing.T) {
	contested := 0
	for seed := uint64(1); seed <= randomRounds; seed++ {
		invoices, customers := randomScenario(seed)
		base := MatchInvoices(invoices, customers)

		// Urutan pelanggan tidak berpengaruh sama sekali.
		rng := rand.New(rand.NewPCG(seed, 99))
		shuffled := append([]Customer(nil), customers...)
		rng.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
		if got := MatchInvoices(invoices, shuffled); !reflect.DeepEqual(got, base) {
			t.Fatalf("seed %d: hasil berubah karena urutan pelanggan", seed)
		}

		// Urutan tagihan hanya menentukan pemenang bila ada yang berebut.
		reordered := append([]Invoice(nil), invoices...)
		rng.Shuffle(len(reordered), func(i, j int) { reordered[i], reordered[j] = reordered[j], reordered[i] })
		again := MatchInvoices(reordered, customers)
		customersOf := func(r Result) []string {
			var ids []string
			for _, m := range r.Matches {
				ids = append(ids, m.CustomerID)
			}
			sort.Strings(ids)
			return ids
		}
		if !reflect.DeepEqual(customersOf(again), customersOf(base)) || again.Counts.Invoices != base.Counts.Invoices ||
			again.Counts.MatchedExact != base.Counts.MatchedExact || again.Counts.MatchedNormalized != base.Counts.MatchedNormalized ||
			again.Counts.UnmatchedUnknown != base.Counts.UnmatchedUnknown || again.Counts.UnmatchedDuplicate != base.Counts.UnmatchedDuplicate ||
			again.Counts.UnmatchedAmbiguous != base.Counts.UnmatchedAmbiguous || !reflect.DeepEqual(again.WithoutInvoice, base.WithoutInvoice) {
			t.Fatalf("seed %d: pelanggan yang cocok atau hitungan berubah karena urutan tagihan", seed)
		}
		if base.Counts.UnmatchedDuplicate > 0 {
			contested++
			continue
		}
		// Tanpa rebutan, himpunan hasilnya sama persis.
		byRef := func(r Result) map[string]string {
			out := map[string]string{}
			for _, m := range r.Matches {
				out[m.Invoice.Ref] = fmt.Sprintf("m %s %s", m.CustomerID, m.Kind)
			}
			for _, u := range r.Unmatched {
				out[u.Invoice.Ref] = fmt.Sprintf("u %s %v", u.Reason, u.CustomerIDs)
			}
			return out
		}
		if !reflect.DeepEqual(byRef(again), byRef(base)) {
			t.Fatalf("seed %d: hasil per tagihan berubah padahal tak ada yang berebut", seed)
		}
	}
	if contested < 100 || contested > randomRounds-50 {
		t.Errorf("data acak tidak seimbang antara berebut (%d) dan tidak", contested)
	}
}

// Menerapkan hasil lalu mencocokkan lagi dengan masukan yang sama tidak
// menghasilkan perubahan baru dan tidak mengubah apa pun yang lain.
func TestMatchInvoicesAppliedTwiceChangesNothingNew(t *testing.T) {
	changedSomewhere := 0
	for seed := uint64(1); seed <= randomRounds; seed++ {
		invoices, customers := randomScenario(seed)
		first := MatchInvoices(invoices, customers)
		if len(first.Changes) > 0 {
			changedSomewhere++
		}
		applied := append([]Customer(nil), customers...)
		for i := range applied {
			for _, ch := range first.Changes {
				if applied[i].ID == ch.CustomerID {
					applied[i].Status = ch.To
				}
			}
		}
		second := MatchInvoices(invoices, applied)
		if len(second.Changes) != 0 || second.Counts.StatusesChanged != 0 {
			t.Fatalf("seed %d: penerapan kedua masih mengubah %+v", seed, second.Changes)
		}
		second.Changes, second.Counts.StatusesChanged = first.Changes, first.Counts.StatusesChanged
		if !reflect.DeepEqual(second, first) {
			t.Fatalf("seed %d: penerapan kedua mengubah hasil selain perubahan status", seed)
		}
	}
	if changedSomewhere < 300 {
		t.Errorf("hanya %d dari %d data acak yang punya perubahan", changedSomewhere, randomRounds)
	}
}
