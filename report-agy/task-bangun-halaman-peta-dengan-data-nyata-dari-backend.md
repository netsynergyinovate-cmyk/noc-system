# Laporan Hasil Pengerjaan Task: Bangun Halaman Peta dengan Data Nyata dari Backend (Fase 4)

## 1. Identifikasi Task
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9` (Peta Pelanggan & Topologi Jaringan)
- **Feature**: `Data Nyata Peta` (Fase 4, Layer: `frontend`)
- **Task Ref**: `peta-pelanggan-amp-topologi-jaringan/data-nyata-peta/bangun-halaman-peta-dengan-data-nyata-dari-backend`
- **Tanggal/Waktu**: 2026-10-16T23:20:00+07:00

---

## 2. Analisis & Sasaran Rekayasa
Pada Fase 4 (Data Nyata Peta), pengguna membutuhkan:
1. **Peta Operasional Nyata**: Mengambil data pelanggan PPPoE, router MikroTik, OLT HSGQ, kotak ODP, dan jalur kabel dari endpoint nyata backend (`/api/map/network` dan PostgreSQL live).
2. **Zero-Dummy Compliance**: Tidak ada data tiruan/mock yang disembunyikan secara diam-diam. Jika data di database kosong atau belum terpetakan, sistem menampilkan banner informatif (*empty state*) tanpa menciptakan entitas fiktif.
3. **Penyegaran Data Mandiri & Otomatis**: Tombol "Segarkan Data" yang mengambil data telemetri terbaru dari backend tanpa perlu reload browser penuh, penanda waktu terakhir diperbarui (`last-sync-time`), dan opsi toggle auto-refresh berkala (setiap 30 detik).
4. **Penanganan Gagal Muat (Error State)**: Banner peringatan yang jelas dan tombol "Coba Lagi" ketika terjadi kendala jaringan atau server backend.

---

## 3. Implementasi Rekayasa Frontend & Integrasi Backend
1. **Komponen RealtimeNetworkMapBoard (`src/components/map/realtime-network-map-board.tsx`)**:
   - Menampung state `data: NetworkMapData`, `isRefreshing`, `autoRefresh`, `lastRefreshedAt`, dan `errorMessage`.
   - `handleRefresh()`: Fetch asinkron ke `/api/map/network` dengan header `Cache-Control: no-cache` dan transisi `useTransition`.
   - Efek interval `autoRefresh`: Polling otomatis setiap 30.000 ms (30 detik) jika pengguna mengaktifkannya.
   - Badge status data: `PostgreSQL Live` (hijau) atau `Data Mock Lokal` (kuning) secara jujur.
   - Penanda waktu sinkronisasi terakhir: format jam lokal `HH:mm:ss`.
   - Empty State Card: Tampilan panduan ramah pengguna saat data kosong (`data.customers.length === 0 && data.infrastructure.length === 0`).
   - Error Alert Banner: Menampilkan pesan kegagalan dan tombol retry.
   - Kanvas Peta: Merender `NetworkMapLeafletLoader` dengan data operasional riil.

2. **Halaman Server Component Peta (`src/app/(protected)/app/peta/page.tsx`)**:
   - Terproteksi sesi operasional via `requireSession()`.
   - Mengambil data awal riil dari backend melalui `getNetworkMapData()`.
   - Mendukung fokus lokasi perangkat URL via `readFocusId(searchParams.focus)`.
   - Menampilkan ringkasan metrik infrastruktur nyata: Total Perangkat, Core Router, OLT Fiber, Kotak ODP, dan Pelanggan Terpetakan.
   - Menyediakan pintasan navigasi operasional dua arah ke modul Router, OLT/Optik, Peta Pelanggan, Susunan Bertingkat, dan Jalur Kabel.
   - Meneruskan `initialData` dan `initialFocusId` ke `RealtimeNetworkMapBoard`.

3. **Verifikasi Endpoint Backend (`src/app/api/map/network/route.ts`)**:
   - Memastikan handler `GET` terproteksi `withApiSession(request, ...)`.
   - Mengembalikan data nyata dari `getNetworkMapData()`.

---

## 4. Bukti Verifikasi Mandiri (*Evidence Before Assertions*)
1. **Unit Testing (`node --test tests/real-map-page-and-backend-data.test.mjs`)**:
   - 7/7 test lulus 100% (durasi: 74ms).
2. **Regression Testing Peta & Topologi (14 Berkas Test)**:
   - 84/84 test unit lulus 100% (durasi: 316ms).
3. **Pemeriksaan Tipe TypeScript (`npm run typecheck`)**:
   - `Generating route types...`
   - `✓ Types generated successfully`
   - 0 error TypeScript.
4. **Pemeriksaan Linter (`npx eslint`)**:
   - `src/components/map/realtime-network-map-board.tsx` & `src/app/(protected)/app/peta/page.tsx`
   - 0 error, 0 warning.
