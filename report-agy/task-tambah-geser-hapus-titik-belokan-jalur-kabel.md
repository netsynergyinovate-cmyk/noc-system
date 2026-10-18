# Laporan Rekayasa: Tambah, Geser, Hapus Titik Belokan Jalur Kabel

## 1. Ringkasan Eksekusi
- **Task ID**: `peta-pelanggan-amp-topologi-jaringan/jalur-kabel-pelanggan/tambah-geser-hapus-titik-belokan-jalur-kabel`
- **Fitur / Modul**: `Jalur Kabel Pelanggan` (Cable Waypoints Editor)
- **Status**: **DONE** (Lolos seluruh gerbang verifikasi mandiri)

## 2. Masalah yang Diselesaikan
Meskipun sistem telah menyediakan algoritma interpolasi lekukan jalan otomatis, teknisi dan operator ISP di lapangan sering kali menghadapi kondisi fisik khusus (misalnya kabel harus berbelok di tiang tertentu, menghindari pohon besar, atau melintasi gang sempit tertentu yang belum terpetakan di citra satelit/OSM). Oleh karena itu, operator memerlukan antarmuka penyunting jalur kabel (*interactive cable waypoints editor*) untuk menambah titik belokan perantara, menggeser koordinat titik belokan, menghapus titik belokan yang tidak diperlukan, dan menyimpan konfigurasi titik belokan secara permanen ke database PostgreSQL.

## 3. Rincian Implementasi & Perubahan Teknis
1. **Skema Validasi Zod (`src/validators/cable-waypoints.ts`)**:
   - `waypointCoordinateSchema`: Memvalidasi pasangan koordinat `[latitude, longitude]` dengan rentang lat [-90, 90] dan lng [-180, 180].
   - `saveCableWaypointsSchema`: Memvalidasi payload penyimpanan waypoints: `cableId`, `sourceId`, `targetId`, dan array `waypoints`.
2. **Endpoint API Terautentikasi (`src/app/api/map/cables/waypoints/route.ts`)**:
   - Handler `POST /api/map/cables/waypoints` dilindungi `withApiSession`.
   - Memvalidasi request payload menggunakan Zod `safeParse` dan memanggil service layer `saveCableWaypoints`.
3. **Penyimpanan Permanen Database PostgreSQL (`src/services/cable-map.service.ts`)**:
   - Fungsi `saveCableWaypoints(input)`:
     * Menyimpan titik belokan ke kolom `details.cableWaypoints` pada record perangkat target di tabel `network_infrastructure`.
     * Mengkalkulasi ulang total panjang rute polilin (`calculatePolylineTotalMeters(waypoints)`).
     * Mengembalikan status sukses beserta data waypoints yang tersimpan.
   - Saat pemuatan peta (`getCableMapData`), atribut `cableWaypoints` dibaca dari database dan langsung dipatuhi oleh `generateRoadBendedPolyline` sebagai titik kustom (`customWaypoints`).
4. **Antarmuka Pengguna Editor Titik Belokan (`src/components/map/cable-map-board.tsx`)**:
   - Tombol pemicu mode edit: `data-testid="edit-cable-waypoints-button"`.
   - Indikator visual mode edit aktif: `data-testid="cable-edit-mode-badge"`.
   - **Tambah Titik Belokan** (`data-testid="add-waypoint-button"`): Menginterpolasi titik tengah baru di antara titik koordinat terdekat secara mulus.
   - **Geser Titik Belokan** (`data-testid="input-lat-waypoint-${idx}"` & `data-testid="input-lng-waypoint-${idx}"`): Menyediakan input numerik desimal presisi untuk menggeser latitude/longitude titik belokan.
   - **Hapus Titik Belokan** (`data-testid="remove-waypoint-button-${idx}"`): Menghapus titik belokan perantara terpilih sambil mempertahankan titik ujung awal dan akhir.
   - **Simpan & Batal** (`data-testid="save-waypoints-button"` & `data-testid="cancel-edit-waypoints-button"`): Mengirim data ke API backend, memperbarui rute secara optimistik di memori, dan menampilkan umpan balik sukses `data-testid="waypoint-save-success-badge"`.

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)
1. **Unit Test Spesifik**:
   - Command: `node --test tests/cable-waypoints-editor.test.mjs`
   - Hasil: 6/6 subtests PASS (0 failures).
2. **Uji Regresi Menyeluruh (13 Test Suites Topologi & Kabel)**:
   - Command: `node --test tests/cable-waypoints-editor.test.mjs tests/collapsible-cable-legend.test.mjs tests/cable-capacity-mapping.test.mjs tests/road-bended-polyline.test.mjs tests/cable-map-page-and-data.test.mjs tests/sync-tree-and-map-after-reassign.test.mjs tests/reassign-hierarchy-parent.test.mjs tests/toggle-panel-without-reload.test.mjs tests/highlight-map-node-from-tree.test.mjs tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs`
   - Hasil: 77/77 subtests PASS (0 failures, duration 280ms).
3. **TypeScript Typecheck**:
   - Command: `npm run typecheck`
   - Hasil: Exit code 0, Types generated successfully, 0 error.
4. **ESLint Static Analysis**:
   - Command: `npx eslint src/validators/cable-waypoints.ts src/app/api/map/cables/waypoints/route.ts src/services/cable-map.service.ts src/components/map/cable-map-board.tsx`
   - Hasil: Exit code 0, 0 errors, 0 warnings.
