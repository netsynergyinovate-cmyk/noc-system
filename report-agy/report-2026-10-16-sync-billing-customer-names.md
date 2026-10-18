# Laporan Rekayasa: Filter Bulan Ini Langsung & Penarikan Nama Pelanggan Riil dari Billing

**Tanggal**: 16 Oktober 2026  
**Status**: Selesai & Terverifikasi Mandiri (Zero Dummy, 100% Data Riil Operasional)  
**Tautan Halaman**: `/app/billing` dan `/app/pelanggan`  
**Branch**: `feat/satellite-map-and-odp-routing`

---

## 1. Ringkasan Eksekutif

Dua kebutuhan penting operasional telah diimplementasikan dan diverifikasi secara end-to-end:
1. **Filter "Bulan Ini" Langsung di Halaman Billing (`/app/billing`)**:
   - Menambahkan preset button instan `⚡ Bulan Ini (Oktober 2026)` dan `Semua Periode` pada toolbar filter.
   - Pilihan langsung aktif & instan memfilter seluruh ringkasan metrik, invoice belum bayar, penerimaan, dan status tunggakan bulan berjalan.
2. **Sinkronisasi & Penarikan Nama Pelanggan dari Billing ke Halaman Pelanggan (`/app/pelanggan`)**:
   - **Pencocokan ID PPPoE**: Mengekstraksi ID pelanggan riil dari username PPPoE (`split_part(pppoe_username, '@', 1)` atau `pppoe_username.split('@')[0]`), mencocokkannya secara presisi dengan `cust_id` pada data RunsNet Billing (`runsnet_customers`).
   - **Backend API & Service**: Endpoint `POST /api/customers/sync-billing-names` dan fungsi `syncCustomerNamesFromBilling()` yang memperbarui tabel `customers` di PostgreSQL secara atomik, serta endpoint `GET /api/customers` untuk menyajikan seluruh data pelanggan aktif ke UI.
   - **Tombol UI Interaktif**: Mengganti tombol mockup pada `customer-table.tsx` menjadi tombol operasional riil: **"Tarik Nama dari Billing"** dengan indikator spinner loading dan banner umpan balik status.

---

## 2. Detail Perubahan Teknis

### A. Komponen Billing Board ([`src/components/dashboard/runsnet-billing-board.tsx`](file:///e:/NOC%20SYSTEM/src/components/dashboard/runsnet-billing-board.tsx))
- Menambahkan memoization `currentMonthPeriod` mendeteksi format `YYYY-MM` bulan berjalan secara dinamis.
- Menambahkan tombol cepat `⚡ Bulan Ini` (dengan pulsating badge penanda aktif) dan `Semua Periode`.
- Menandai opsi bulan berjalan di dalam dropdown `<select>` dengan label `— Bulan Ini`.

### B. Layanan Backend ([`src/services/runsnet-billing.service.ts`](file:///e:/NOC%20SYSTEM/src/services/runsnet-billing.service.ts))
- Menambahkan fungsi `syncCustomerNamesFromBilling(options?: { pullFresh?: boolean })`.
- Melakukan pencocokan ID:
  ```ts
  const extractedId = c.pppoeUsername.includes("@")
    ? c.pppoeUsername.split("@")[0].trim()
    : c.pppoeUsername.trim();
  ```
- Memperbarui kolom `name`, `billing_status` (`lunas` vs `isolir`), dan `last_updated_at` di PostgreSQL `customers`.
- Menghasilkan rincian statistik: `matchedCount: 70`, `updatedCount: 70`, `unmatchedCount: 0`.

### C. Endpoint API Baru
1. [`src/app/api/customers/sync-billing-names/route.ts`](file:///e:/NOC%20SYSTEM/src/app/api/customers/sync-billing-names/route.ts):
   - `POST`: Menjalankan sinkronisasi dan pencocokan nama pelanggan berdasarkan ID PPPoE.
   - `GET`: Mengambil ringkasan status pencocokan tanpa mutasi.
2. [`src/app/api/customers/route.ts`](file:///e:/NOC%20SYSTEM/src/app/api/customers/route.ts):
   - `GET`: Menyajikan daftar 70 pelanggan core dari PostgreSQL ke antarmuka Next.js App Router.

### D. Komponen Tabel Pelanggan ([`src/components/dashboard/customer-table.tsx`](file:///e:/NOC%20SYSTEM/src/components/dashboard/customer-table.tsx))
- Menambahkan auto-load data pelanggan dari `/api/customers` saat store kosong di mode operasional.
- Mengganti `onClick={() => alert(...)}` dengan `handleSyncBillingNames()`.
- Tombol **"Tarik Nama dari Billing"** berpenampilan border emerald transparan dengan animasi putar `animate-spin` saat proses berjalan.
- Banner notifikasi otomatis menampilkan status hasil penarikan dan langsung meng-update state tabel tanpa reload halaman.

---

## 3. Gerbang Verifikasi Mandiri

### 1. TypeScript Check
```bash
npm run typecheck
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully (0 errors)
```

### 2. ESLint Check
```bash
npx eslint src/components/dashboard/runsnet-billing-board.tsx src/components/dashboard/customer-table.tsx src/services/runsnet-billing.service.ts src/app/api/customers/sync-billing-names/route.ts src/app/api/customers/route.ts
# Result: 0 error, 0 warning
```

### 3. Unit Test Suite ([`tests/runsnet-billing.test.mjs`](file:///e:/NOC%20SYSTEM/tests/runsnet-billing.test.mjs))
```bash
node --test tests/runsnet-billing.test.mjs
✔ getRunsnetOverview: mengembalikan ringkasan pelanggan, invoice, payment, dan daftar periode (47.9ms)
✔ getRunsnetOverview (periode spesifik): mengembalikan data filter bulan tertentu (15.1ms)
✔ getDelinquentCustomers: mengembalikan daftar pelanggan menunggak dengan total hutang dan rincian (5.7ms)
✔ getRunsnetCustomerDetail: profil, riwayat invoice, dan riwayat payment per pelanggan (9.5ms)
✔ getRunsnetInvoices: mendukung filter unpaid dan paid (4.5ms)
✔ getRunsnetPayments: mengembalikan daftar payment dengan data valid (2.8ms)
✔ syncCustomerNamesFromBilling: mencocokkan ID PPPoE dengan cust_id billing dan memperbarui data (9.2ms)
ℹ tests 7, pass 7, fail 0
```

### 4. Docker Runtime Build & Container Status
```bash
docker compose build app
# Compiled successfully in 13.1s (Turbopack)
# Image nocsystem-app:latest Built
docker compose up -d --no-deps app
# nocsystem-app-1 Up (healthy)
```

### 5. Verifikasi Interaksi Peramban (Playwright)
```bash
node scripts/verify-billing-and-customer-sync.mjs
[1] Autentikasi via /sign-up... Berhasil!
[2] Membuka halaman /app/billing... Tombol Bulan Ini ditemukan. Mengklik tombol... OK
[2] Screenshot: screenshots/billing/10-bulan-ini-instant-filter.png
[3] Membuka halaman /app/pelanggan...
[3] Tombol Tarik Nama dari Billing aktif. Menjalankan penarikan...
[3] Total baris pelanggan di tabel: 70
    Pelanggan [1]: JENDRIKO SIMARMATA | 17060001101@runsnet.id | Core CIARA | Online | -21,7 dBm | Normal | Lunas
    Pelanggan [2]: MOHAMMAD TOHID | 17060001396@runsnet.id | Core CIARA | Online | — | LOS | Lunas
    Pelanggan [3]: SDN 03 TERAS TERUNJAM | 17060001430@runsnet.id | Core CIARA | Online | — | LOS | Lunas
    Pelanggan [4]: TARIYO (RIYAN) | 17060001467@runsnet.id | Core CIARA | Online | — | LOS | Lunas
    Pelanggan [5]: SMP 08 MUKOMUKO | 17060001497@runsnet.id | Core CIARA | Online | — | LOS | Lunas
[3] Screenshot: screenshots/pelanggan/01-tarik-nama-billing-success.png
Verifikasi Playwright tuntas 100%!
```

