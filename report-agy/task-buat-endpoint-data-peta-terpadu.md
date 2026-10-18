# Laporan Teknis Task: Buat Endpoint Data Peta Terpadu (Backend)

## 1. Ringkasan Eksekusi
- **Task**: `peta-pelanggan-amp-topologi-jaringan/data-nyata-peta/buat-endpoint-data-peta-terpadu`
- **Fitur**: Data Nyata Peta
- **Plan**: Peta Pelanggan & Topologi Jaringan
- **Layer**: `backend` (Phase 4/5)
- **Status**: Selesai (**DONE**)

---

## 2. Detail Implementasi Rekayasa

### A. Endpoint API Terpadu (`src/app/api/map/network/route.ts` & `src/app/api/map/unified/route.ts`)
- **Proteksi Autentikasi Sesi**: Seluruh handler `GET` dibungkus dengan `withApiSession(request, ...)` memastikan hanya operator terotentikasi yang dapat mengakses telemetri fisik jaringan.
- **Dukungan Parameter Kueri**:
  - `cables`: Boolean (`true`/`false`), secara default `true` untuk memuat jalur bentangan kabel serat optik dan waypoints.
  - `hierarchy`: Boolean (`true`/`false`), memuat relasi pohon hierarki induk-anak perangkat (`Core ➔ ODC ➔ ODP`).
  - `search`: Filter teks untuk nama pelanggan, username PPPoE, nama ODP, dan host/nama router.
  - `status`: Filter status perangkat (`active`, `inactive`) atau pelanggan (`online`, `offline`).
  - `mode`: `mock` jika dipaksa simulasi atau saat `DASHBOARD_DATA=demo`.
- **Standar Respon JSON**: Mengembalikan `{ success: true, data: { ... } }` dengan status HTTP 200.

### B. Service Agregasi Multi-Tabel PostgreSQL (`src/services/real-map-data.service.ts`)
- Fungsi `getCompleteRealMapData` mengagregasikan 4 entitas spasial utama:
  1. **Pelanggan (`customers`)**: Data geocoded dengan latitude/longitude, username PPPoE, routerId/routerName, optical power Rx ONU, dan status billing.
  2. **Infrastruktur (`network_infrastructure`)**: Titik fisik Core Router BGP, OLT HSGQ, ODC, ODP, dan Pole.
  3. **Bentangan Kabel (`network_cables`)**: Koordinat rute polyline, panjang meter kalkulasi Haversine, tipe kabel (backbone, feeder, distribution, drop), dan kapasitas core.
  4. **Pohon Hierarki Relasi (`network_device_relations`)**: Terintegrasi via `getDeviceHierarchyTree()` dari `src/services/device-relations.service.ts`.
- **Kepatuhan Zero-Dummy**: Jika database operasional belum terisi, sistem mengembalikan array kosong dengan metadata `isRealData: true`, menolak data palsu tiruan.

---

## 3. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### A. Unit Tests Khusus (`tests/unified-map-endpoint.test.mjs`)
```
▶ Task: Buat Endpoint Data Peta Terpadu (Backend)
  ✔ 1. Endpoint API Data Peta Terpadu (/api/map/network) (0.9797ms)
  ✔ 2. Endpoint API Alias Terpadu (/api/map/unified) (0.2142ms)
  ✔ 3. Service getCompleteRealMapData: Agregasi Multi-Tabel PostgreSQL (0.307ms)
✔ Task: Buat Endpoint Data Peta Terpadu (Backend) (4.2943ms)
ℹ tests 4 | pass 4 | fail 0
```

### B. Regresi Pengujian Keseluruhan (56/56 Pass)
```
▶ Fitur Jalur Kabel Pelanggan: Bangun Halaman Peta Jalur Kabel dengan Data Nyata (6 tests pass)
▶ Task: Buat Skema Relasi Induk Anak Perangkat (Backend) (6 tests pass)
▶ Halaman Peta Infrastruktur dengan Data Nyata dari Backend (5 tests pass)
▶ Task: Tambahkan Penanda Sumber Data Aktif Peta (5 tests pass)
▶ Task: Terapkan Penyegaran Berkala dan Penanda Waktu Peta (6 tests pass)
▶ Task: Tampilkan Status Kosong dan Galat Muat Peta (5 tests pass)
▶ Tambah empty state dan error state peta (3 tests pass)
▶ Task: Siapkan Skema Database dan Endpoint Data Peta Nyata (4 tests pass)
▶ Task: Bangun Halaman Peta dengan Data Nyata dari Backend (Fase 4) (6 tests pass)
▶ Task: Buat Endpoint Data Peta Terpadu (Backend) (4 tests pass)
ℹ tests 56 | pass 56 | fail 0
```

### C. TypeScript Typecheck
```
$ npm run typecheck
> ngodingpakeai-starter@0.1.0 typecheck
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
(0 errors)
```

### D. ESLint Linter
```
$ npx eslint src/app/api/map/network/route.ts src/app/api/map/unified/route.ts src/services/real-map-data.service.ts
(0 errors, 0 warnings)
```
