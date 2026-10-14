package billing

// Status adalah status tagihan seperti yang dipakai seluruh aplikasi
// (BillingStatus di src/lib/dashboard/types.ts).
type Status string

const (
	// StatusLunas berarti tagihan sudah dibayar.
	StatusLunas Status = "lunas"
	// StatusIsolir berarti pelanggan menunggak atau sedang diisolir.
	StatusIsolir Status = "isolir"
)

// Valid melaporkan apakah s salah satu status yang dikenal aplikasi.
func (s Status) Valid() bool {
	return s == StatusLunas || s == StatusIsolir
}

// Invoice adalah satu baris tabel tagihan.
type Invoice struct {
	// Name adalah nama koneksi PPPoE PERSIS seperti tertulis di billing. Satu-satunya
	// perapian: spasi, tab, dan baris baru di ujung teks sel dibuang, karena itu
	// hanya sisa indentasi HTML yang tidak terlihat di browser. Huruf besar-kecil,
	// spasi di dalam, dan spasi tak-putus (&nbsp;) dibiarkan. Merapikan lebih jauh
	// (huruf kecil, dsb.) adalah tugas pencocokan, yang membedakan cocok "exact"
	// dari "normalized" (lihat matchBilling); kalau dirapikan di sini, perbedaan
	// itu hilang dan tidak bisa dipulihkan.
	Name string
	// Ref adalah nomor atau rujukan tagihan; kosong bila situs tidak punya
	// kolomnya. Dirapikan seperti Name.
	Ref string
	// Status sudah dipetakan lewat Profile.StatusMap.
	Status Status
}

// Stats meringkas satu pemanggilan Invoices. Berguna untuk log dan untuk
// memeriksa bahwa hasilnya masuk akal (mis. tidak ada pengurangan drastis).
type Stats struct {
	// Pages adalah jumlah halaman tagihan yang diminta dan terbaca, termasuk
	// halaman penutup yang kosong pada mode bernomor.
	Pages int
	// Rows adalah jumlah baris data yang diperiksa: baris yang cocok dengan
	// RowSelector dan punya sel td. Baris judul (hanya th) tidak dihitung.
	Rows int
	// Skipped adalah baris data yang dilewati karena tidak punya nama.
	// Tagihan yang dikembalikan = Rows - Skipped.
	Skipped int
	// Relogins adalah berapa kali sesi yang berakhir memaksa login ulang (0 atau 1).
	Relogins int
}
