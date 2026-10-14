package billing

import (
	"sort"
	"strings"
	"unicode"
)

// Pencocokan tagihan dengan pelanggan lewat nama koneksi PPPoE. Aturannya
// IDENTIK dengan matchBilling di src/lib/dashboard/billing.ts; bila salah satu
// diubah, ubah keduanya dan perbarui testdata/match_cases.json (lihat
// e2e/billing-conformance.spec.ts, yang membuat berkas itu dari fungsi TS, dan
// TestMatchInvoicesConformsToFixture, yang membuktikan fungsi ini
// menghasilkan jawaban yang sama).
//
//  1. Nama di tagihan sama persis dengan Customer.PPPoE: cocok MatchExact.
//  2. Bila tidak ada pelanggan bernama persis itu, nama dirapikan (NormalizePPPoE)
//     lalu dibandingkan dengan nama pelanggan yang dirapikan juga. Cocok dengan
//     TEPAT SATU pelanggan: MatchNormalized.
//  3. Tagihan yang tidak bisa dipasangkan tidak dipaksakan, melainkan dilaporkan
//     dengan alasannya (Reason): tidak ada pelanggan sama sekali (unknown),
//     pelanggannya sudah dipakai tagihan lain (duplicate), atau setelah dirapikan
//     cocok dengan lebih dari satu pelanggan (ambiguous).
//  4. Pelanggan tanpa tagihan tidak diubah: statusnya dibiarkan.
//
// Satu pelanggan dipakai paling banyak satu tagihan. Bila dua tagihan berebut
// satu pelanggan, yang PERSIS menang atas yang dirapikan, berapa pun urutannya;
// di antara yang sama jenisnya, yang lebih dulu dalam daftar tagihan menang.
// Hanya itulah satu-satunya tempat urutan tagihan berpengaruh.

// MatchKind menyebut cara sebuah tagihan dipasangkan dengan pelanggannya.
type MatchKind string

const (
	// MatchExact berarti nama di billing sama persis dengan nama PPPoE pelanggan.
	MatchExact MatchKind = "exact"
	// MatchNormalized berarti cocok setelah huruf kecil dan spasi di ujung
	// dirapikan, dan hanya satu pelanggan yang cocok dengan cara itu.
	MatchNormalized MatchKind = "normalized"
)

// Reason menyebut mengapa sebuah tagihan tidak mendapat pelanggan.
type Reason string

const (
	// ReasonUnknown berarti tidak ada pelanggan dengan nama itu (CustomerIDs kosong).
	ReasonUnknown Reason = "unknown"
	// ReasonDuplicate berarti pelanggannya sudah dipasangkan dengan tagihan lain
	// pada sinkron yang sama (CustomerIDs berisi pelanggan itu, satu saja).
	ReasonDuplicate Reason = "duplicate"
	// ReasonAmbiguous berarti setelah dirapikan nama itu cocok dengan lebih dari satu
	// pelanggan, jadi tidak ditebak (CustomerIDs berisi semua kandidat, terurut).
	ReasonAmbiguous Reason = "ambiguous"
)

// Customer adalah bagian pelanggan yang dibutuhkan pencocokan.
type Customer struct {
	ID string
	// PPPoE adalah customers.pppoe_username. Kolomnya unik, jadi dua pelanggan tidak
	// punya nama yang sama persis; bila masukan melanggarnya, pelanggan dengan ID
	// terkecil yang dipakai untuk pencocokan persis supaya hasilnya tetap tidak
	// bergantung pada urutan masukan.
	PPPoE string
	// Status adalah customers.billing_status saat ini.
	Status Status
}

// Match adalah tagihan yang dipasangkan dengan satu pelanggan.
type Match struct {
	CustomerID string
	Invoice    Invoice
	Kind       MatchKind
}

// Unmatched adalah tagihan yang tidak mendapat pelanggan.
type Unmatched struct {
	Invoice Invoice
	Reason  Reason
	// CustomerIDs adalah kandidat menurut alasan: kosong untuk unknown, satu untuk
	// duplicate, dua atau lebih untuk ambiguous. Selalu terurut menurut ID dan
	// tidak pernah nil.
	CustomerIDs []string
}

// StatusChange adalah pelanggan cocok yang statusnya berbeda dari yang tersimpan.
type StatusChange struct {
	CustomerID string
	From, To   Status
}

// Counts sesuai kolom log billing_sync_runs. Invoices selalu jumlah kelima
// bagian tagihan, dan StatusesChanged tidak pernah melebihi yang cocok; keduanya
// juga dijaga check database.
type Counts struct {
	Invoices           int
	MatchedExact       int
	MatchedNormalized  int
	UnmatchedUnknown   int
	UnmatchedDuplicate int
	UnmatchedAmbiguous int
	WithoutInvoice     int
	StatusesChanged    int
}

// Result adalah hasil satu pencocokan. Urutannya tertentu supaya hasil sama untuk
// masukan yang sama dan tidak bergantung pada urutan pelanggan.
type Result struct {
	// Matches mengikuti urutan tagihan masukan.
	Matches []Match
	// Unmatched mengikuti urutan tagihan masukan.
	Unmatched []Unmatched
	// WithoutInvoice adalah ID pelanggan tanpa tagihan, terurut menurut ID.
	WithoutInvoice []string
	// Changes hanya memuat pelanggan cocok yang statusnya benar-benar berbeda,
	// dalam urutan Matches.
	Changes []StatusChange
	Counts  Counts
}

// claim mencatat tagihan mana (indeks dalam daftar masukan) yang dipakai sebuah
// pelanggan dan dengan cara apa.
type claim struct {
	invoice int
	kind    MatchKind
}

// MatchInvoices memasangkan tagihan dengan pelanggan menurut aturan di atas.
// Murni: tidak mengubah masukannya, tidak memakai database, jaringan, jam, atau
// bilangan acak.
func MatchInvoices(invoices []Invoice, customers []Customer) Result {
	// byExact memetakan nama persis ke pelanggan (indeks dalam customers).
	// byNormalized memetakan nama yang dirapikan ke semua pelanggan yang cocok.
	byExact := make(map[string]int, len(customers))
	byNormalized := make(map[string][]int, len(customers))
	for i, c := range customers {
		if j, ok := byExact[c.PPPoE]; !ok || c.ID < customers[j].ID {
			byExact[c.PPPoE] = i
		}
		key := NormalizePPPoE(c.PPPoE)
		byNormalized[key] = append(byNormalized[key], i)
	}

	claimed := make(map[int]claim, len(invoices)) // pelanggan -> tagihan yang memakainya
	reasons := make([]Reason, len(invoices))      // "" bila tagihan itu dipasangkan
	candidates := make([][]string, len(invoices))

	// Putaran pertama: yang persis. Tagihan persis menang atas yang dirapikan
	// berapa pun urutannya, karena putaran ini selesai sebelum putaran kedua.
	for i, inv := range invoices {
		c, ok := byExact[inv.Name]
		if !ok {
			continue
		}
		if _, taken := claimed[c]; taken {
			reasons[i] = ReasonDuplicate
			candidates[i] = []string{customers[c].ID}
		} else {
			claimed[c] = claim{invoice: i, kind: MatchExact}
		}
	}

	// Putaran kedua: sisanya, setelah dirapikan.
	for i, inv := range invoices {
		if _, ok := byExact[inv.Name]; ok {
			continue
		}
		group := byNormalized[NormalizePPPoE(inv.Name)]
		switch {
		case len(group) == 0:
			reasons[i] = ReasonUnknown
			candidates[i] = []string{}
		case len(group) > 1:
			ids := make([]string, len(group))
			for k, c := range group {
				ids[k] = customers[c].ID
			}
			sort.Strings(ids)
			reasons[i] = ReasonAmbiguous
			candidates[i] = ids
		default:
			if _, taken := claimed[group[0]]; taken {
				reasons[i] = ReasonDuplicate
				candidates[i] = []string{customers[group[0]].ID}
			} else {
				claimed[group[0]] = claim{invoice: i, kind: MatchNormalized}
			}
		}
	}

	// Sebaliknya dari claimed: tagihan -> pelanggan yang memakainya.
	holder := make(map[int]int, len(claimed))
	for c, cl := range claimed {
		holder[cl.invoice] = c
	}

	res := Result{
		Matches:        make([]Match, 0, len(claimed)),
		Unmatched:      make([]Unmatched, 0, len(invoices)-len(claimed)),
		WithoutInvoice: make([]string, 0, len(customers)-len(claimed)),
		Changes:        []StatusChange{},
	}
	for i, inv := range invoices {
		if c, ok := holder[i]; ok {
			cl := claimed[c]
			res.Matches = append(res.Matches, Match{CustomerID: customers[c].ID, Invoice: inv, Kind: cl.kind})
			if customers[c].Status != inv.Status {
				res.Changes = append(res.Changes, StatusChange{
					CustomerID: customers[c].ID, From: customers[c].Status, To: inv.Status,
				})
			}
			continue
		}
		res.Unmatched = append(res.Unmatched, Unmatched{Invoice: inv, Reason: reasons[i], CustomerIDs: candidates[i]})
	}
	for i, c := range customers {
		if _, ok := claimed[i]; !ok {
			res.WithoutInvoice = append(res.WithoutInvoice, c.ID)
		}
	}
	sort.Strings(res.WithoutInvoice)

	res.Counts = countsOf(res)
	return res
}

// countsOf menghitung Counts dari isi sebuah Result. Dipakai MatchInvoices untuk
// mengisinya, dan penyimpanan untuk memastikan hitungan yang dikirim kepadanya
// sungguh sesuai daftarnya.
func countsOf(r Result) Counts {
	n := Counts{
		Invoices:        len(r.Matches) + len(r.Unmatched),
		WithoutInvoice:  len(r.WithoutInvoice),
		StatusesChanged: len(r.Changes),
	}
	for _, m := range r.Matches {
		if m.Kind == MatchExact {
			n.MatchedExact++
		} else {
			n.MatchedNormalized++
		}
	}
	for _, u := range r.Unmatched {
		switch u.Reason {
		case ReasonUnknown:
			n.UnmatchedUnknown++
		case ReasonDuplicate:
			n.UnmatchedDuplicate++
		case ReasonAmbiguous:
			n.UnmatchedAmbiguous++
		}
	}
	return n
}

// NormalizePPPoE merapikan nama PPPoE sebelum dibandingkan: spasi di ujung dibuang
// lalu semua huruf menjadi kecil. Hasilnya sama dengan name.trim().toLowerCase()
// di JavaScript (normalizePppoe di billing.ts), bukan dengan strings.TrimSpace
// dan strings.ToLower, karena keduanya berbeda untuk beberapa karakter:
//
//   - trim JavaScript membuang U+FEFF (BOM) tetapi tidak U+0085; TrimSpace
//     sebaliknya.
//   - toLowerCase JavaScript memakai pemetaan penuh: "İ" (U+0130) menjadi "i"
//     ditambah titik gabung (dua rune), dan "Σ" di akhir kata menjadi "ς" bukan
//     "σ". strings.ToLower memetakan "İ" ke "i" saja dan selalu memberi "σ".
func NormalizePPPoE(name string) string {
	return jsToLower(strings.TrimFunc(name, isJSSpace))
}

// isJSSpace melaporkan apakah r dibuang oleh String.prototype.trim: WhiteSpace
// (TAB, VT, FF, SP, NBSP, ZWNBSP/BOM, dan seluruh kategori Zs) dan LineTerminator
// (LF, CR, LS, PS).
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', 0x2028, 0x2029, 0xFEFF:
		return true
	}
	return unicode.Is(unicode.Zs, r)
}

// jsToLower meniru String.prototype.toLowerCase: pemetaan huruf kecil sederhana
// per karakter, ditambah dua aturan pemetaan penuh yang tidak diatur lokal
// (SpecialCasing.txt): U+0130 dan sigma akhir kata.
func jsToLower(s string) string {
	ascii := true
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			ascii = false
			break
		}
	}
	if ascii {
		return strings.ToLower(s)
	}
	runes := []rune(s)
	var b strings.Builder
	b.Grow(len(s))
	for i, r := range runes {
		switch r {
		case 0x03A3: // Σ
			if isFinalSigma(runes, i) {
				b.WriteRune('ς')
			} else {
				b.WriteRune('σ')
			}
		case 0x0130: // İ
			b.WriteString("i\u0307")
		default:
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

// isFinalSigma menerapkan konteks Final_Sigma (Unicode, tabel 3-17): sigma di
// posisi i didahului huruf ber-kapital-kecil (cased) yang boleh diselingi
// karakter yang diabaikan konteks, dan tidak diikuti huruf semacam itu.
func isFinalSigma(runes []rune, i int) bool {
	before := false
	for j := i - 1; j >= 0; j-- {
		if isCased(runes[j]) {
			before = true
			break
		}
		if !isCaseIgnorable(runes[j]) {
			break
		}
	}
	if !before {
		return false
	}
	for j := i + 1; j < len(runes); j++ {
		if isCased(runes[j]) {
			return false
		}
		if !isCaseIgnorable(runes[j]) {
			break
		}
	}
	return true
}

// isCased adalah properti Unicode Cased: huruf besar, kecil, atau judul.
func isCased(r rune) bool {
	return unicode.IsUpper(r) || unicode.IsLower(r) || unicode.IsTitle(r) ||
		unicode.Is(unicode.Other_Uppercase, r) || unicode.Is(unicode.Other_Lowercase, r)
}

// isCaseIgnorable adalah properti Unicode Case_Ignorable: kategori Mn, Me, Cf, Lm,
// dan Sk, ditambah tanda baca yang berperan sebagai bagian kata (Word_Break
// MidLetter, MidNumLet, dan Single_Quote), yang go-unicode tidak sediakan.
func isCaseIgnorable(r rune) bool {
	switch r {
	case '\'', '.', ':', 0x00B7, 0x0387, 0x055F, 0x05F4, 0x2018, 0x2019, 0x2024,
		0x2027, 0xFE13, 0xFE52, 0xFE55, 0xFF07, 0xFF0E, 0xFF1A:
		return true
	}
	return unicode.In(r, unicode.Mn, unicode.Me, unicode.Cf, unicode.Lm, unicode.Sk)
}
