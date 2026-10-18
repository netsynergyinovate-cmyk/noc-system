# Laporan Pengerjaan Task: Bangun Endpoint Detail Pelanggan untuk Panel Peta

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/titik-pelanggan-di-peta/bangun-endpoint-detail-pelanggan-untuk-panel-peta`
- **Judul**: Bangun endpoint detail pelanggan untuk panel peta
- **Fitur**: Titik Pelanggan di Peta
- **Fase**: 2, **Layer**: backend
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Workspace ID**: `694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd`

---

## 2. Ringkasan Perubahan Teknis
Telah dibangun endpoint backend dan fungsi service untuk mengambil rincian mendalam pelanggan secara *on-demand* saat pin atau titik pelanggan diklik pada peta interaktif:

1. **Validator Query (`src/validators/customer-location.ts`)**:
   - `customerDetailQuerySchema`: Memvalidasi parameter query (mendukung `forceMock: boolean`).
   - `CustomerDetailQueryInput`: Tipe inferensi Zod yang ketat.

2. **Domain Service (`src/services/customer-location.service.ts`)**:
   - Fungsi `getCustomerMapDetail(customerId, options)`:
     - Mendukung lookup fleksibel baik via `customers.id` (UUID) maupun `customers.pppoeUsername`.
     - Melakukan query PostgreSQL relasional dengan join ke `routers` (nama router gateway), `oltOnus` (serial number ONT, PON index, ONU index, rxPower, txPower, redaman, model, status), dan `olts` (nama OLT pusat).
     - Menghasilkan struktur objek `CustomerMapDetail` yang siap dikonsumsi langsung oleh komponen `CustomerDetailPanel`.
     - Menyediakan transparansi telemetri `dataSource: { provider: "PostgreSQL Live", isRealData: true, lastSynchronizedAt }`.

3. **HTTP API Routes**:
   - `GET /api/customers/[id]/detail` (`src/app/api/customers/[id]/detail/route.ts`):
     - Rute endpoint utama berproteksi sesi pengguna (`withApiSession`). Mengembalikan 401 bagi akses anonim, 404 jika pelanggan tidak ditemukan, dan 200 dengan payload detail lengkap.
   - `GET /api/customers/[id]` (`src/app/api/customers/[id]/route.ts`):
     - Rute direct lookup by ID/username.
   - `GET /api/map/customers/[id]` (`src/app/api/map/customers/[id]/route.ts`):
     - Alias endpoint peta terdedikasi.

---

## 3. Bukti Pengujian Mandiri (Evidence Before Assertions)
1. **TypeScript Typecheck**:
   - Perintah: `npm run typecheck`
   - Hasil: **Exit Code 0** (0 error, rute Next.js terkompilasi bersih).
2. **ESLint**:
   - Perintah: `npx eslint src/app/api/customers/[id]/detail/route.ts src/app/api/customers/[id]/route.ts src/app/api/map/customers/[id]/route.ts src/services/customer-location.service.ts src/validators/customer-location.ts`
   - Hasil: **Exit Code 0** (0 error, 0 warning).
3. **Unit & Integration Test**:
   - Perintah: `node --test tests/customer-detail-endpoint.test.mjs`
   - Hasil: **7 pass, 0 fail** (Proteksi 401 untuk ketiga rute, return 404/null jika tidak ditemukan, verifikasi field koordinat, serial ONU, metrik optik, dan pencarian via PPPoE username).
4. **Pengujian Gabungan**:
   - Perintah: `node --test tests/geocoded-customers-endpoint.test.mjs tests/customer-detail-endpoint.test.mjs`
   - Hasil: **18 pass, 0 fail**.

---

## 4. Kepatuhan Zero-Dummy & Boundaries
- Seluruh rincian pelanggan dipetakan dari tabel PostgreSQL (`customers`, `routers`, `olt_onus`, `olts`).
- Berkas sesi pengguna aktif (`customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tetap terlindungi tanpa modifikasi.
