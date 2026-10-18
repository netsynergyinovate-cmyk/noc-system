# Laporan Rekayasa: Buat Legenda Kapasitas Serat yang Bisa Dibuka Tutup

## 1. Ringkasan Eksekusi
- **Task ID**: `peta-pelanggan-amp-topologi-jaringan/jalur-kabel-pelanggan/buat-legenda-kapasitas-serat-yang-bisa-dibuka-tutu`
- **Fitur / Modul**: `Jalur Kabel Pelanggan` (Collapsible Cable Capacity Legend)
- **Status**: **DONE** (Lolos seluruh gerbang verifikasi mandiri)

## 2. Masalah yang Diselesaikan
Sebelumnya pada halaman papan peta jalur kabel (`CableMapBoard`), legenda kapasitas serat optik ditampilkan secara permanen di bagian bawah panel samping sehingga membatasi ruang pandang daftar jalur kabel saat operator memeriksa puluhan rute bentangan di lapangan. Selain itu, saat panel daftar kabel disembunyikan/ditutup oleh operator untuk memperluas kanvas peta, tidak ada cara untuk melihat legenda kapasitas serat secara langsung di atas peta satelit.

## 3. Rincian Implementasi & Perubahan Teknis
1. **State Kontrol Buka-Tutup Ganda (`src/components/map/cable-map-board.tsx`)**:
   - `isLegendOpen`: Mengontrol keterbukaan legenda di panel samping (default: `true`).
   - `isFloatingLegendOpen`: Mengontrol keterbukaan widget popup legenda terapung yang menempel langsung di atas kanvas peta Leaflet (default: `false`).
2. **Tombol Toggle Legenda Sidebar Berstandar Aksesibilitas**:
   - Elemen tombol interaktif `data-testid="toggle-legend-button"` dengan atribut `aria-expanded={isLegendOpen}`.
   - Ikon chevron dinamis (`ChevronDown` saat terbuka, `ChevronUp` saat tertutup).
   - Panel detail kapasitas serat `data-testid="legend-content-panel"` hanya di-render saat `isLegendOpen` bernilai aktif.
3. **Widget Legenda Terapung di Atas Kanvas Peta Satelit**:
   - Kontainer mengambang `data-testid="floating-cable-legend"` di pojok kanan bawah peta satelit.
   - Tombol pemicu terapung `data-testid="toggle-floating-legend-button"`.
   - Konten popup mengambang `data-testid="floating-legend-content"` dengan tombol tutup mandiri `data-testid="close-floating-legend-button"`.
   - Tetap dapat diakses meskipun panel samping daftar kabel sedang diminimalkan.
4. **Interaktivitas Filter Cepat dari Legenda**:
   - Setiap baris tingkatan kapasitas serat optik di legenda (baik di sidebar maupun di widget terapung) dapat diklik secara interaktif (`onClick={() => setSelectedType(tier.category)}`), seketika menyaring daftar dan garis kabel pada peta ke kategori yang bersangkutan.

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)
1. **Unit Test Spesifik**:
   - Command: `node --test tests/collapsible-cable-legend.test.mjs`
   - Hasil: 6/6 subtests PASS (0 failures).
2. **Uji Regresi Menyeluruh (12 Test Suites Topologi & Kabel)**:
   - Command: `node --test tests/collapsible-cable-legend.test.mjs tests/cable-capacity-mapping.test.mjs tests/road-bended-polyline.test.mjs tests/cable-map-page-and-data.test.mjs tests/sync-tree-and-map-after-reassign.test.mjs tests/reassign-hierarchy-parent.test.mjs tests/toggle-panel-without-reload.test.mjs tests/highlight-map-node-from-tree.test.mjs tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs`
   - Hasil: 71/71 subtests PASS (0 failures, duration 266ms).
3. **TypeScript Typecheck**:
   - Command: `npm run typecheck`
   - Hasil: Exit code 0, Types generated successfully, 0 error.
4. **ESLint Static Analysis**:
   - Command: `npx eslint src/components/map/cable-map-board.tsx`
   - Hasil: Exit code 0, 0 errors, 0 warnings.
