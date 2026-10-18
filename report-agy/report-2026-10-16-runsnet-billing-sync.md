# Laporan Rekayasa: Integrasi & Sinkronisasi Realtime Billing RunsNet

**Tanggal**: 16 Oktober 2026  
**Status**: Selesai & Terverifikasi Mandiri (Zero Dummy, 100% Data Riil Operasional)  
**Tautan Halaman**: `/app/billing`  
**Branch**: `feat/satellite-map-and-odp-routing`

---

## 1. Ringkasan Eksekutif

Sesuai instruksi dan standar rekayasa terkunci (`GEMINI.md`), halaman **Billing** (`/app/billing`) telah diintegrasikan secara penuh dengan sistem billing eksternal ISP di `https://app.runsnet.id` (*Mitra Net Synergy Inovate*, Target: `ID00000000024`). Seluruh data ditarik secara langsung, diparsing dari respons DataTables server-side, dan disimpan ke tabel persisten PostgreSQL lokal. Tidak ada data dummy atau mock.

### Metrik Hasil Sinkronisasi Lapangan
| Entitas | Jumlah Record | Nilai Finansial Riil | Keterangan |
| :--- | :--- | :--- | :--- |
| **Pelanggan** (`runsnet_customers`) | **74** Pelanggan | - | Status: 69 Active, 5 Isolir |
| **Invoice / Tagihan** (`runsnet_invoices`) | **1.043** Tagihan | **Rp 224.119.506** | Periode Agustus 2025 s.d. Oktober 2026 |
| **Riwayat Pembayaran** (`runsnet_payments`) | **870** Transaksi | **Rp 197.905.440** | Metode: Transfer & Tunai |
| **Pelanggan Menunggak** | **45** Pelanggan | **Rp 11.011.000** | Tagihan `remaining_amount > 0` |

---

## 2. Analisis Protokol & Reverse-Engineering RunsNet

Melalui inspeksi mendalam (*deep root-cause analysis*) pada arsitektur PHP/DataTables web RunsNet:
1. **Autentikasi Session**:
   - `GET /login.php` untuk inisialisasi cookie `PHPSESSID`.
   - `POST /view/control/bagan_login.php` dengan payload `username`, `password`, dan `simpan=""`.
2. **Karakteristik DataTables Server-Side**:
   - Skrip backend PHP (`pelanggan.php`, `invoice.php`, `payment.php`) menolak pemanggilan GET biasa atau POST tanpa format DataTables yang lengkap (menghasilkan error `"data_server.php: get dataku"`).
   - Solusi: Membentuk URLSearchParams lengkap dengan 12 array kolom (`columns[i][data]`, `searchable`, `orderable`, dll.) serta batch `length=100` untuk pagination efisien.
3. **Filter Query Payment**:
   - Endpoint `payment.php` secara default mengembalikan array kosong jika parameter rentang tanggal (`data1` dan `data2`) tidak diisi.
   - Solusi: Parameter diset eksplisit `data1=01/01/2025&data2=12/31/2026` untuk menarik seluruh 870 transaksi pembayaran historis.

---

## 3. Perubahan Skema Database PostgreSQL

File migrasi Drizzle: [`drizzle/0024_runsnet_billing.sql`](file:///e:/NOC%20SYSTEM/drizzle/0024_runsnet_billing.sql) dan definisi skema di [`src/db/schema/runsnet-billing.ts`](file:///e:/NOC%20SYSTEM/src/db/schema/runsnet-billing.ts):
- `runsnet_customers`: Menyimpan `cust_id` (PK), `name`, `service_profile`, `type`, `spk_date`, `active_date`, `expired_date`, `connectivity`, `status`, `raw_json`, `synced_at`.
- `runsnet_invoices`: Menyimpan `invoice_code` (PK), `cust_id`, `cust_name`, `periode`, `due_date`, `amount`, `remaining_amount`, `agent`, `status`, `file_url`, `synced_at`.
- `runsnet_payments`: Menyimpan `payment_code` (PK), `invoice_code`, `cust_id`, `cust_name`, `periode`, `pay_date`, `amount`, `method`, `agent`, `operator`, `synced_at`.
- `runsnet_sync_logs`: Catatan riwayat audit sinkronisasi, durasi eksekusi, dan jumlah record tersimpan.

---

## 4. Arsitektur Komponen & Fitur Baru

### A. Backend Services ([`src/services/runsnet-billing.service.ts`](file:///e:/NOC%20SYSTEM/src/services/runsnet-billing.service.ts))
1. `loginRunsnet()`: Mengelola otentikasi dan lifecycle session cookie `PHPSESSID`.
2. `scrapeRunsnetCustomers()`, `scrapeRunsnetInvoices()`, `scrapeRunsnetPayments()`: Pagination loop otomatis hingga seluruh data tuntas ditarik.
3. `runRunsnetSync()`: Sinkronisasi idempotent ke tabel `runsnet_*` sekaligus meng-update nama pelanggan riil dan status billing (`lunas` vs `isolir`) pada tabel utama `customers`.
4. `getRunsnetOverview(periode)`: Agregasi metrik dinamis berdasarkan filter bulan (Agustus 2025 – Oktober 2026).
5. `getDelinquentCustomers(periode)`: Agregasi SQL cerdas untuk mendeteksi pelanggan menunggak, akumulasi nominal hutang, serta daftar detail invoice tertunggak.
6. `getRunsnetCustomerDetail(custId)`: Ledger lengkap riwayat pelanggan (profil, semua invoice, dan riwayat pembayaran).

### B. Endpoint API
- `POST /api/billing/runsnet/sync`: Trigger sinkronisasi data langsung ke RunsNet.
- `GET /api/billing/runsnet`: Endpoint data terpadu mendukung parameter:
  - `tab=overview` (ringkasan & daftar bulan)
  - `tab=delinquent` (daftar penunggak)
  - `tab=customers` (daftar seluruh pelanggan)
  - `tab=invoices` (`status=unpaid` / `status=paid` & filter bulan)
  - `tab=payments` (riwayat transaksi & filter bulan)
  - `tab=customer-detail&custId=<id>` (buku besar rincian pelanggan)

### C. Antarmuka UI ([`src/components/dashboard/runsnet-billing-board.tsx`](file:///e:/NOC%20SYSTEM/src/components/dashboard/runsnet-billing-board.tsx))
- **Header Status Koneksi**: Menampilkan status aktif runsnet.id, mitra terdaftar, waktu sinkronisasi terakhir, dan tombol sinkronisasi instan.
- **Filter Periode Per-Bulan**: Dropdown dinamis dari seluruh periode tagihan yang tersedia.
- **Kartu Metrik KPI**:
  1. *Pelanggan Menunggak* (Aksen rose dengan badge peringatan operasional).
  2. *Total Pelanggan Terdaftar* (Rincian status Active vs Isolir).
  3. *Total Tagihan Periode* (Nominal tertagih dan jumlah invoice).
  4. *Total Penerimaan* (Nominal kas masuk).
- **Tab Navigasi Terstruktur**:
  1. **Pelanggan Menunggak**: Tabel khusus menyorot jumlah bulan menunggak, total hutang, tanggal jatuh tempo tertua, dan tombol aksi lihat rincian.
  2. **Semua Pelanggan**: Daftar 74 pelanggan resmi dengan paket layanan dan status.
  3. **Invoice Tagihan**: Daftar tagihan dengan sub-filter status (*Semua*, *Belum Bayar*, *Lunas*).
  4. **Riwayat Payment**: Transaksi kas masuk dengan metode bayar, agen, dan operator pencatat.
- **Modal Buku Besar Rincian Pelanggan**:
  - Profil pelanggan, paket kecepatan, tanggal aktif/kedaluwarsa.
  - Tabulasi riwayat seluruh invoice beserta status lunas/tunggakan.
  - Tabulasi riwayat transaksi pembayaran lengkap.

---

## 5. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

### 1. TypeScript Check
```bash
npm run typecheck
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully (0 errors)
```

### 2. ESLint
```bash
npx eslint src/components/dashboard/runsnet-billing-board.tsx src/services/runsnet-billing.service.ts src/app/api/billing/runsnet/route.ts src/app/api/billing/runsnet/sync/route.ts
# Result: 0 error, 0 warning
```

### 3. Unit Test Suite ([`tests/runsnet-billing.test.mjs`](file:///e:/NOC%20SYSTEM/tests/runsnet-billing.test.mjs))
```bash
node --test tests/runsnet-billing.test.mjs
✔ getRunsnetOverview: mengembalikan ringkasan pelanggan, invoice, payment, dan daftar periode (52.2461ms)
✔ getRunsnetOverview (periode spesifik): mengembalikan data filter bulan tertentu (18.0665ms)
✔ getDelinquentCustomers: mengembalikan daftar pelanggan menunggak dengan total hutang dan rincian (5.0576ms)
✔ getRunsnetCustomerDetail: mengembalikan profil, riwayat invoice, dan riwayat payment per pelanggan (10.8976ms)
✔ getRunsnetInvoices: mendukung filter unpaid dan paid (4.7215ms)
✔ getRunsnetPayments: mengembalikan daftar payment dengan data valid (2.371ms)
ℹ tests 6, pass 6, fail 0
```

### 4. Docker Runtime Build & Container Status
```bash
docker compose build app
docker compose up -d --no-deps app
docker ps --filter "name=nocsystem"
# nocsystem-app-1 Up 3 minutes (healthy)
# nocsystem-postgres-1 Up 6 hours (healthy)
```

### 5. Tangkapan Layar Bukti Pengujian Browser
- Pelanggan Menunggak: `screenshots/billing/05-delinquent-customers.png`
- Modal Rincian Pelanggan: `screenshots/billing/06-customer-detail-modal.png`
- Filter Periode Oktober 2026: `screenshots/billing/07-filter-month-october.png`
- Filter Invoice Belum Bayar: `screenshots/billing/08-unpaid-invoices.png`
- Tab Riwayat Pembayaran: `screenshots/billing/09-payments-history.png`

