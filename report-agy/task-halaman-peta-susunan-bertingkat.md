# Laporan Pengerjaan Task: Bangun Halaman Peta Susunan Bertingkat dengan Data Nyata dari Backend

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/hubungan-induk-anak/bangun-halaman-peta-susunan-bertingkat-dengan-data`
- **Judul**: Bangun halaman peta susunan bertingkat dengan data nyata dari backend
- **Fitur**: Hubungan Induk–Anak
- **Fase**: 3, **Layer**: frontend
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Workspace ID**: `694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd`

---

## 2. Ringkasan Perubahan Teknis
Telah dirancang, dibangun, dan diuji modul halaman peta topologi bertingkat yang memvisualisasikan relasi hierarki struktural jaringan (`Server/Core -> ODC -> ODP -> Pelanggan`) dengan data nyata backend:

1. **Service Layer (`src/services/network-hierarchy.service.ts`)**:
   - Fungsi `getNetworkHierarchyData(options)`:
     - Mengkueri entitas fisik dari database PostgreSQL (`network_infrastructure` dan `customers`).
     - Menyusun pohon hierarki 4 tingkat:
       - **Tingkat 1 (Roots)**: Core Server Gateway BGP, MikroTik Core Router, dan OLT HSGQ.
       - **Tingkat 2 (ODCs)**: Optical Distribution Cabinets (Kabin distribusi serat optik).
       - **Tingkat 3 (ODPs)**: Optical Distribution Points (Kotak pembagi splitter lapangan).
       - **Tingkat 4 (Customers)**: Pelanggan akhir PPPoE aktif/isolir dengan status online, koordinat GPS, dan metrik daya optik (dBm).
     - Menghasilkan tautan relasi bertingkat (`HierarchyConnectionLink`) lengkap dengan koordinat asal-tujuan dan kode warna spesifik.
     - Menyediakan indikator sumber data (`PostgreSQL Live` vs `Data Mock Lokal`) secara transparan (*zero-dummy compliance*).

2. **HTTP API Route Handlers**:
   - `src/app/api/map/hierarchy/route.ts`: Endpoint `GET` terautentikasi `withApiSession` untuk pohon hierarki dan tautan koneksi.
   - `src/app/api/infrastructure/hierarchy/route.ts`: Endpoint `GET` REST alias untuk kebutuhan data hierarki infrastruktur.

3. **Antarmuka Pengguna Interaktif (`src/components/map/hierarchy-map-board.tsx`)**:
   - **Header & Ringkasan**: Judul halaman, badge data source nyata, dan pintasan navigasi operasional.
   - **Kartu Metrik KPI 4 Tingkat**: Menampilkan jumlah total perangkat per tingkat (Core/OLT, ODC, ODP, Pelanggan online/offline).
   - **Bar Saringan & Kontrol**: Saringan per tingkat hierarki (Semua, T1, T2, T3, T4), toggle garis relasi koneksi bertingkat, dan input pencarian simpul instan.
   - **Pohon Relasi Kolapsibel (Hierarchy Tree Explorer)**: Menampilkan pohon relasi interaktif dengan status koneksi, indikator optik, dan seleksi fokus titik.
   - **Kanvas Peta Leaflet & Panel Detail**: Menampilkan penanda berkode warna per tingkat, garis polilin bertingkat, dan kartu popup detail simpul saat penanda dipilih.

4. **Halaman Server & Rute**:
   - `src/app/(protected)/app/topologi/page.tsx`: Server Component dengan `requireSession()` dan `readFocusId`.
   - `src/app/(protected)/app/peta/topologi/page.tsx`: Rute alias sub-menu peta.
   - `src/app/(protected)/app/peta/page.tsx`: Menambahkan tombol pintasan navigasi langsung ke halaman susunan bertingkat (`shortcut-topology-link`).

---

## 3. Bukti Pengujian Mandiri (Evidence Before Assertions)
1. **TypeScript Typecheck**:
   - Perintah: `npm run typecheck`
   - Hasil: **Exit Code 0** (0 error, route types terkompilasi bersih).
2. **ESLint**:
   - Perintah: `npx eslint src/services/network-hierarchy.service.ts src/app/api/map/hierarchy/route.ts src/app/api/infrastructure/hierarchy/route.ts src/components/map/hierarchy-map-board.tsx src/app/(protected)/app/topologi/page.tsx src/app/(protected)/app/peta/topologi/page.tsx src/app/(protected)/app/peta/page.tsx`
   - Hasil: **Exit Code 0** (0 warning, 0 error).
3. **Unit & Integration Test**:
   - Perintah: `node --test tests/hierarchy-map-page.test.mjs`
   - Hasil: **5 pass, 0 fail**.
4. **Regresi Seluruh Pengujian Infrastruktur**:
   - Perintah: `node --test tests/hierarchy-map-page.test.mjs tests/infrastructure-*.test.mjs`
   - Hasil: **54 pass, 0 fail**.

---

## 4. Kepatuhan Zero-Dummy & Boundaries
- Membaca data nyata dari tabel PostgreSQL `network_infrastructure` dan `customers`.
- Berkas sesi pengguna aktif (`customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tidak dimodifikasi.
