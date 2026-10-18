# Laporan Rekayasa: Petakan Kapasitas Serat ke Ketebalan dan Warna

## 1. Ringkasan Eksekusi
- **Task ID**: `peta-pelanggan-amp-topologi-jaringan/jalur-kabel-pelanggan/petakan-kapasitas-serat-ke-ketebalan-dan-warna`
- **Fitur / Modul**: `Jalur Kabel Pelanggan` (Cable Capacity Styling & Legend)
- **Status**: **DONE** (Lolos seluruh gerbang verifikasi mandiri)

## 2. Masalah yang Diselesaikan
Sebelumnya ketebalan dan warna bentangan kabel serat optik belum terpetakan secara terstruktur ke kapasitas inti serat (*fiber core capacity*). Di lapangan operasional FTTH, perbedaan kapasitas (seperti kabel backbone 48 core, feeder 24 core, feeder cabang 16 core, distribusi 8 core, dan drop wire 1-2 core) harus dapat dibedakan secara intuitif oleh operator NOC melalui perbedaan ketebalan garis vektor dan kode warna standar yang konsisten antara peta dan legenda.

## 3. Rincian Implementasi & Perubahan Teknis
1. **Modul Konfigurasi Kapasitas Kabel Terpusat (`src/config/cable-capacity.ts`)**:
   - `CABLE_CAPACITY_TIERS`: Standar 5 tingkatan kapasitas optik ISP:
     * **48+ Core (Backbone Utama)**: Warna Ungu (`#8b5cf6`), halo ungu muda (`#c084fc`), tebal dasar 5.0 px, pola garis `dashArray: "8, 6"`.
     * **24 Core (Feeder Utama Sentral-ODC)**: Warna Indigo (`#6366f1`), tebal dasar 4.0 px, pola garis `dashArray: "7, 5"`.
     * **16 Core (Feeder Distribusi ODC-ODP)**: Warna Cyan (`#06b6d4`), tebal dasar 3.2 px, garis solid.
     * **8 Core (Distribusi Cabang / Tiang)**: Warna Amber (`#f59e0b`), tebal dasar 2.5 px, pola garis `dashArray: "6, 4"`.
     * **1-2 Core (Drop Optik Pelanggan)**: Warna adaptif sesuai status operasional telemetri:
       - Normal/Online: Emerald (`#10b981`), tebal dasar 1.8 px.
       - Peringatan (Optical power <= -25 dBm): Amber (`#f59e0b`).
       - Putus/Offline/Isolir: Rose/Red (`#ef4444`).
   - `resolveCableCapacityStyle(options)`: Fungsi murni (*pure function*) yang mengkalkulasi warna, halo, ketebalan, dan efek sorotan neon (`#22d3ee`, +1.5px) secara deterministik.
2. **Integrasi Komponen Peta (`src/components/map/network-map.tsx`)**:
   - Polyline Leaflet kini mengambil konfigurasi style melalui `resolveCableCapacityStyle`, mempertahankan adaptasi zoom (`getZoomScaledLineWeight(baseWeight, currentZoom)`), sehingga seluruh kabel ter-render secara tegas dan proporsional.
3. **Integrasi Legenda Kapasitas Interaktif (`src/components/map/cable-map-board.tsx`)**:
   - Legenda kapasitas serat kini di-render secara dinamis dari `CABLE_CAPACITY_TIERS`, menjamin 100% konsistensi warna dan ketebalan label dengan elemen grafis di kanvas peta.
4. **Integrasi Service Backend Data Kabel (`src/services/cable-map.service.ts`)**:
   - Segmen kabel yang diekstrak menyertakan atribut `color` dan `baseWeight` terstandarisasi untuk konsumsi API dan visualisasi front-end.

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)
1. **Unit Test Spesifik**:
   - Command: `node --test tests/cable-capacity-mapping.test.mjs`
   - Hasil: 6/6 subtests PASS (0 failures).
2. **Uji Regresi Menyeluruh (11 Test Suites Topologi & Kabel)**:
   - Command: `node --test tests/cable-capacity-mapping.test.mjs tests/road-bended-polyline.test.mjs tests/cable-map-page-and-data.test.mjs tests/sync-tree-and-map-after-reassign.test.mjs tests/reassign-hierarchy-parent.test.mjs tests/toggle-panel-without-reload.test.mjs tests/highlight-map-node-from-tree.test.mjs tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs`
   - Hasil: 65/65 subtests PASS (0 failures, duration 245ms).
3. **TypeScript Typecheck**:
   - Command: `npm run typecheck`
   - Hasil: Exit code 0, Types generated successfully, 0 error.
4. **ESLint Static Analysis**:
   - Command: `npx eslint src/config/cable-capacity.ts src/components/map/network-map.tsx src/components/map/cable-map-board.tsx src/services/cable-map.service.ts`
   - Hasil: Exit code 0, 0 errors, 0 warnings.
