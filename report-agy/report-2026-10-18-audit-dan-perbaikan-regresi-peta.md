# Laporan Rekayasa: Audit & Resolusi Tuntas Seluruh Regresi Modul Peta

**Tanggal:** 18 Oktober 2026  
**Status:** Sukses Tuntas (100% Passed)  
**Lingkungan:** Next.js App Router (Node.js runtime), PostgreSQL, Leaflet, Docker Container  

---

## 1. Analisis Akar Masalah (Root-Cause Analysis)
Sebelumnya terjadi kegagalan pada 8 test suite peta akibat modifikasi terburu-buru (*hasty redesign*) pada sesi sebelumnya tanpa menjalankan gerbang verifikasi holistik:

1. **Penghapusan Kontrak Komponen di `src/app/(protected)/app/peta/page.tsx`**:
   - Penghapusan badge sumber data (`data-source-badge`), grid metrik (`infra-metrics-grid`), dan bilah pintasan modul (`peta-module-shortcuts` dengan tautan router, OLT, pelanggan, dan kabel).
   - Akibat: Menggagalkan `infrastructure-map-page.test.mjs`, `cable-map-page-and-data.test.mjs`, `map-active-data-source-indicator.test.mjs`, dan `map-mock-data.test.mjs`.

2. **Perombakan Drastis `src/components/map/network-map-legend.tsx`**:
   - Komponen legenda sebelumnya dipangkas menjadi pill horizontal statis sederhana, membuang fitur dok posisi tetap berlipat (*collapsible*), 3 tab navigasi (`symbols`, `cables`, `layers`), 6 tingkatan ketebalan kabel optik, serta simbol penanda perangkat.
   - Akibat: Menggagalkan `cable-legend-refinement.test.mjs`, `fixed-map-legend.test.mjs`, `infrastructure-device-markers.test.mjs`, dan `marker-distinction.test.mjs`.

3. **Inkonsistensi Fallback Tile Satelit di `src/config/map.ts`**:
   - Fallback satelit diubah ke URL Google Maps tidak resmi, melanggar kontrak penyedia tile gratis aman (*Esri World Imagery*).
   - Akibat: Menggagalkan `map-env-config.test.mjs`.

4. **Bug Tata Letak Flex & Pencegatan Pointer-Events (CSS Stacking)**:
   - Wrapper kontainer peta di `page.tsx` kehilangan kelas `flex flex-col`, menyebabkan kontainer kanvas Leaflet mengempis ke tinggi 0px (`height: 0`).
   - Overlay banner `unmapped-customers-empty-state` menggunakan `z-[1020]` menutupi bilah kontrol atas `map-top-control-bar` (`z-[1000]`), mencegat seluruh klik tombol pada pengujian Playwright end-to-end.

---

## 2. Tindakan Rekayasa & Solusi Teknis

### A. Restorasi HUD Fullscreen Zero-Scroll di `src/app/(protected)/app/peta/page.tsx`
- Mengembalikan Header HUD terkompresi dengan badge sumber data PostgreSQL Live / Mock, grid metrik responsif (`md:grid-cols-3 lg:grid-cols-5`), dan pintasan navigasi operasional dua arah.
- Menambahkan kelas `flex flex-col` pada wrapper agar kanvas Leaflet mengisi 100% sisa tinggi viewport tanpa memicu scrollbar vertikal peramban (`docScrollHeight === innerHeight`).

### B. Restorasi Dok Legenda Lengkap di `src/components/map/network-map-legend.tsx`
- Membangun ulang dok posisi tetap (`data-testid="fixed-map-legend"`) dengan tombol lipat/buka (`toggle-legend-collapse`), state `isExpanded`, dan ukuran responsif tablet (`md:w-84`).
- Menyediakan 3 tab navigasi: Penanda & Titik (`legend-tab-symbols`), Kapasitas Kabel 6 Tier (`legend-tab-cables`), dan Visibilitas Lapisan (`legend-tab-layers`).
- Menetapkan target sentuh standar layar sentuh (`size-7 sm:size-6` dan `min-h-[32px] sm:min-h-[28px]`).

### C. Harmonisasi Fallback Tile di `src/config/map.ts`
- Mengembalikan fallback bawaan satelit ke Esri World Imagery (`server.arcgisonline.com`) dengan tetap mendukung penimpaan dinamis via `NEXT_PUBLIC_MAP_SATELLITE_URL`.

### D. Eliminasi Hambatan Pointer-Events di `src/components/map/network-map.tsx`
- Menaikkan z-index `map-top-control-bar` ke `z-[1030]` di atas seluruh overlay status.
- Menurunkan z-index `unmapped-customers-empty-state` dan `map-empty-state` ke `z-[990]` (di atas kanvas Leaflet namun di bawah bilah tombol aktif) sehingga tombol "Input GPS" dan alat penempatan titik tidak pernah terhalang.

---

## 3. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### 1. Uji Menyeluruh Seluruh 79 Test Suite Peta
```text
Testing 79 files...
...............................................................................
Done! Failed count: 0 (100% Pass)
```

### 2. TypeScript Typecheck
```text
$ npm run typecheck
Generating route types...
✓ Types generated successfully
(Exit code: 0 - 0 Errors)
```

### 3. ESLint Kepatuhan Kode
```text
$ npx eslint "src/app/(protected)/app/peta/page.tsx" "src/components/map/network-map-legend.tsx" "src/config/map.ts"
(Exit code: 0 - 0 Errors, 0 Warnings)
```

### 4. Sinkronisasi Siklus Runtime Docker
```text
$ docker compose build app; docker compose up -d --no-deps app
Image nocsystem-app Built
Container nocsystem-app-1 Started (healthy)
```

### 5. Verifikasi End-to-End Playwright (Chrome Headless)
```text
$ node scripts/verify-fullscreen-map-and-coordinates.mjs
=== STEP 3: Memeriksa Zero-Scroll (Tanpa Scrollbar Halaman) ===
Hasil Pengukuran Viewport & Scroll: {
  windowInnerHeight: 900,
  docScrollHeight: 900,
  docClientHeight: 900,
  bodyScrollHeight: 900,
  scrollY: 0,
  hasVerticalScrollbar: false
}
✓ TERBUKTI: Zero vertical scrolling tercapai sempurna (scrollHeight === innerHeight).

=== STEP 4: Memeriksa Ketersediaan Elemen & Pintasan Modul ===
Pintasan Modul Tampak: true
Grid Metrik Infrastruktur Tampak: true
Penanda Realtime Sync Tampak: true

=== STEP 5: Menguji Fitur Input Titik Koordinat GPS Manual ===
✓ Tombol 'Input GPS' diklik.
✓ Modal input koordinat manual terbuka.
✓ Tombol 'Terapkan Titik' diklik dengan koordinat -2.578600, 101.218500.
✓ Screenshot bukti tersimpan di E:\NOC SYSTEM\screenshots\verified-fullscreen-map-no-scroll.png
Kartu Titik Inspeksi Terpilih di Peta Tampak: true
=== SELURUH VERIFIKASI PLAYWRIGHT SELESAI 100% SUKSES ===
```
