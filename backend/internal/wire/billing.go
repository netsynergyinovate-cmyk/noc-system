package wire

// Bentuk JSON status billing: GET /api/v1/billing dan GET /api/v1/billing/sync.
// Nama bidang, tipe, dan nullable-nya mengikuti BillingOverview, BillingRow,
// BillingUnmatched, BillingSyncState, BillingSyncRun, dan BillingSyncResult di
// src/lib/dashboard/billing.ts; e2e/billing-contract.spec.ts memeriksa jawaban
// sungguhan terhadap tipe itu.
//
// Aturan umum:
//
//   - Semua waktu adalah detik epoch BULAT (int64), bukan milidetik dan bukan teks.
//   - Bidang yang di TypeScript bertipe `X | null` ditulis null (bukan dihilangkan)
//     bila kosong; karena itu berupa pointer tanpa omitempty. Daftar tidak pernah
//     null: kosong ditulis [].
//   - Status dan alasan berupa teks bebas di sini, tetapi nilainya hanya yang sah
//     di TypeScript ("lunas" | "isolir", "exact" | "normalized" | "none",
//     "unknown" | "duplicate" | "ambiguous", "success" | "failed"); pembacanya
//     (billing.Reader) menolak nilai lain, bukan meneruskannya.

// BillingOverview adalah isi "data" untuk GET /api/v1/billing.
type BillingOverview struct {
	Sync BillingSyncState `json:"sync"`
	// Rows memuat satu baris untuk TIAP pelanggan, urut nama lalu username PPPoE.
	Rows []BillingRow `json:"rows"`
	// Unmatched adalah tagihan yang tak bertuan pada sinkron berhasil terakhir,
	// urut kode tagihan.
	Unmatched []BillingUnmatched `json:"unmatched"`
}

// BillingRow adalah status tagihan satu pelanggan dan cara ia didapat.
type BillingRow struct {
	CustomerID    string `json:"customerId"`
	Name          string `json:"name"`
	PPPoEUsername string `json:"pppoeUsername"`
	RouterID      string `json:"routerId"`
	RouterName    string `json:"routerName"`
	// Status dari tagihan yang cocok bila ada, kalau tidak yang tersimpan di
	// customers.billing_status.
	Status string `json:"status"`
	// Match adalah "exact", "normalized", atau "none" (tanpa tagihan).
	Match string `json:"match"`
	// InvoiceRef dan BillingName null untuk Match "none". InvoiceRef juga null bila
	// tagihan yang cocok memang tidak punya kode (situs billing tanpa kolom itu).
	InvoiceRef *string `json:"invoiceRef"`
	// BillingName adalah nama PPPoE persis seperti tertulis di billing.
	BillingName *string `json:"billingName"`
}

// BillingUnmatched adalah satu tagihan yang tidak bisa dipasangkan dengan pelanggan.
type BillingUnmatched struct {
	// InvoiceRef kosong ("") bila tagihannya tidak punya kode; tipenya di
	// TypeScript string, bukan string | null.
	InvoiceRef    string `json:"invoiceRef"`
	PPPoEUsername string `json:"pppoeUsername"`
	Status        string `json:"status"`
	// Reason adalah "unknown", "duplicate", atau "ambiguous".
	Reason string `json:"reason"`
}

// BillingSyncResult adalah hitungan satu sinkron yang berhasil. Invoices selalu
// Matched + Unmatched (dijaga check database).
type BillingSyncResult struct {
	Invoices       int `json:"invoices"`
	Matched        int `json:"matched"`
	Unmatched      int `json:"unmatched"`
	WithoutInvoice int `json:"withoutInvoice"`
}

// BillingSyncRun adalah satu sinkron yang sudah selesai.
type BillingSyncRun struct {
	ID         string `json:"id"`
	StartedAt  int64  `json:"startedAt"`
	FinishedAt int64  `json:"finishedAt"`
	// Status adalah "success" atau "failed". Result terisi tepat bila success,
	// Error tepat bila failed.
	Status string             `json:"status"`
	Result *BillingSyncResult `json:"result"`
	Error  *string            `json:"error"`
}

// BillingRunning menandai sinkron yang sedang berjalan.
type BillingRunning struct {
	StartedAt int64 `json:"startedAt"`
}

// BillingSyncState adalah keadaan sinkron: isi "data" untuk GET /api/v1/billing/sync
// dan bidang "sync" pada BillingOverview.
type BillingSyncState struct {
	IntervalSeconds int64 `json:"intervalSeconds"`
	// Running null bila tidak ada sinkron yang berjalan.
	Running *BillingRunning `json:"running"`
	// NextRunAt selalu setelah saat jawaban dibuat.
	NextRunAt int64 `json:"nextRunAt"`
	// Runs adalah paling banyak 24 sinkron yang sudah selesai, terbaru di atas.
	Runs []BillingSyncRun `json:"runs"`
}
