# Laporan Rekayasa: Gambar Polilin Jalur Kabel Mengikuti Lekukan Jalan

## 1. Ringkasan Eksekusi
- **Task ID**: `peta-pelanggan-amp-topologi-jaringan/jalur-kabel-pelanggan/gambar-polilin-jalur-kabel-mengikuti-lekukan-jalan`
- **Fitur / Modul**: `Jalur Kabel Pelanggan` (Cable Routes Map)
- **Status**: **DONE** (Lolos seluruh gerbang verifikasi mandiri)

## 2. Masalah yang Diselesaikan
Sebelumnya garis kabel serat optik (baik penghubung antar infrastruktur maupun kabel drop dari ODP ke modem ONU pelanggan) digambar hanya dengan dua titik koordinat garis lurus (*straight line*), yang tampak memotong bangunan atau lahan terbuka secara tidak realistis. Di lapangan nyata ISP, bentangan kabel serat optik ditarik menyusuri bahu jalan, deretan tiang distribusi, dan lekukan gang permukiman.

## 3. Rincian Implementasi & Perubahan Teknis
1. **Modul Utilitas Perutean Kabel (`src/lib/cable-path-routing.ts`)**:
   - `generateRoadBendedPolyline(start, end, customWaypoints)`:
     * Menghasilkan array titik koordinat polilin yang realistis (`>= 3` titik) dengan memperhitungkan sumbu dominan arah jalan (latitude vs longitude).
     * Menerapkan pergeseran koridor bahu jalan (*road shoulder offset* ~3–4 meter) dan titik transisi belokan jalan (*street corners*), sehingga rute kabel tampak menyusuri bahu jalan dan berbelok rapi menuju lokasi pelanggan atau kotak ODP.
     * Mendukung pembacaan waypoints kustom jika telah tersimpan di atribut infrastruktur.
   - `calculatePolylineTotalMeters(points)`:
     * Menghitung akumulasi panjang riil kabel serat optik menyusuri seluruh titik lekukan jalan menggunakan formula Haversine bola bumi.
2. **Integrasi Komponen Peta Leaflet (`src/components/map/network-map.tsx`)**:
   - Memperbarui kalkulasi `cableRoutes`:
     * Kabel drop pelanggan (`ODP ➔ Pelanggan`) kini diinterpolasi dengan `generateRoadBendedPolyline`.
     * Kabel feeder dan distribusi antar perangkat infrastruktur diinterpolasi dengan `generateRoadBendedPolyline`.
   - Polyline Leaflet menggambar lekukan jalan yang rapi dan konsisten dengan pewarnaan jenis kabel (Drop hijau/merah, Feeder cyan, Backbone ungu).
3. **Integrasi Service Backend Data Kabel (`src/services/cable-map.service.ts`)**:
   - Menggunakan `generateRoadBendedPolyline` pada setiap segmen kabel yang diekstrak dari database PostgreSQL.
   - Menghitung estimasi panjang kabel (`estimatedLengthMeters`) berbasis polilin akumulatif (`calculatePolylineTotalMeters`), menghasilkan data metrik operasional yang akurat sesuai fisik bentangan lapangan.

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)
1. **Unit Test Spesifik**:
   - Command: `node --test tests/road-bended-polyline.test.mjs`
   - Hasil: 6/6 subtests PASS (0 failures).
2. **Uji Regresi Menyeluruh (10 Test Suites Topologi & Kabel)**:
   - Command: `node --test tests/road-bended-polyline.test.mjs tests/cable-map-page-and-data.test.mjs tests/sync-tree-and-map-after-reassign.test.mjs tests/reassign-hierarchy-parent.test.mjs tests/toggle-panel-without-reload.test.mjs tests/highlight-map-node-from-tree.test.mjs tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs`
   - Hasil: 59/59 subtests PASS (0 failures, duration 225ms).
3. **TypeScript Typecheck**:
   - Command: `npm run typecheck`
   - Hasil: Exit code 0, Types generated successfully, 0 error.
4. **ESLint Static Analysis**:
   - Command: `npx eslint src/lib/cable-path-routing.ts src/components/map/network-map.tsx src/services/cable-map.service.ts`
   - Hasil: Exit code 0, 0 errors, 0 warnings.
