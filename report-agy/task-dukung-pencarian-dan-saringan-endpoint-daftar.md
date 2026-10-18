# Laporan Pengerjaan Task: Dukung Pencarian dan Saringan di Endpoint Daftar

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/titik-pelanggan-di-peta/dukung-pencarian-dan-saringan-di-endpoint-daftar`
- **Judul**: Dukung pencarian dan saringan di endpoint daftar
- **Fitur**: Titik Pelanggan di Peta
- **Fase**: 2, **Layer**: backend
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Workspace ID**: `694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd`

---

## 2. Ringkasan Perubahan Teknis
Telah ditambahkan dukungan komprehensif pencarian (*search*) dan multi-dimensi penyaringan (*filtering*) pada seluruh endpoint daftar pelanggan berkoordinat:

1. **Peningkatan Skema Validasi (`src/validators/customer-location.ts`)**:
   - `geocodedCustomersQuerySchema` kini mencakup:
     - `status`: `"all" | "online" | "offline" | "weak" | "isolir" | "geocoded" | "warning" | "normal"`.
     - `search` dan `q` (alias): Pencarian teks bebas pada `name`, `pppoeUsername`, dan `address`.
     - `odp` dan `region` (alias): Filter berdasarkan nama ODP atau kluster wilayah distribusi.
     - `billingStatus`: `"all" | "lunas" | "isolir"`.
     - `opticalStatus`: `"all" | "normal" | "warning" | "critical"`.
     - `routerId`: Filter berdasarkan router gateway.
     - `limit` (max 1000) & `offset` untuk paginasi.

2. **Mesin Penyaringan Terpadu (`src/services/customer-location.service.ts`)**:
   - Fungsi pembantu `applyCustomerQueryFilters(items, query)`:
     - Menghitung metrik dasar agregat (`totalGeocoded`, `onlineCount`, `offlineCount`, `weakOpticalCount`, `isolirCount`) dari dataset sebelum pemotongan filter.
     - Menerapkan saringan status fisik, status tagihan (*billing*), level redaman optik (kritis $\le -24.5$, waspada $-24.5 < \text{Rx} \le -23.0$, normal $> -23.0$), ODP, dan kata kunci pencarian.
     - Menghasilkan atribut `summary.filteredCount`, `summary.limit`, dan `summary.offset`.
   - Mengintegrasikan logika ini secara seragam pada mode live PostgreSQL, mode demo, serta mode fallback dev offline.

3. **Konsumsi Rute HTTP API**:
   - Diperbarui pada `src/app/api/customers/geocoded/route.ts`, `src/app/api/map/customers/route.ts`, dan cabang `geocoded=true` di `src/app/api/customers/route.ts`.

---

## 3. Bukti Pengujian Mandiri (Evidence Before Assertions)
1. **TypeScript Typecheck**:
   - Perintah: `npm run typecheck`
   - Hasil: **Exit Code 0** (0 error).
2. **ESLint**:
   - Perintah: `npx eslint "src/validators/customer-location.ts" "src/services/customer-location.service.ts" "src/app/api/customers/geocoded/route.ts" "src/app/api/map/customers/route.ts" "src/app/api/customers/route.ts"`
   - Hasil: **Exit Code 0** (0 error, 0 warning).
3. **Unit & Integration Test**:
   - Perintah: `node --test tests/customer-search-filter-endpoint.test.mjs`
   - Hasil: **8 pass, 0 fail**.
4. **Regresi Peta Lengkap**:
   - Perintah: `node --test tests/customer-search-filter-endpoint.test.mjs tests/geocoded-customers-endpoint.test.mjs tests/customer-detail-endpoint.test.mjs tests/map-markers-route.test.mjs tests/infrastructure-move-and-delete.test.mjs`
   - Hasil: **41 pass, 0 fail**.

---

## 4. Kepatuhan Zero-Dummy & Boundaries
- Filter membaca atribut riil dari PostgreSQL: `customers.name`, `customers.pppoeUsername`, `customers.address`, `customers.odpName`, `customers.billingStatus`, `customers.opticalPower`, `customers.isOnline`.
- Berkas sesi pengguna aktif (`customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tidak dimodifikasi.
