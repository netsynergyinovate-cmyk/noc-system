# Laporan Pengerjaan Task: Perbesar Tombol dan Teks untuk Layar Kecil

**Task ID**: `c9626165-744b-42c4-8688-c969787886af`  
**Fitur**: Penyempurnaan Tampilan Peta (`peta-pelanggan-amp-topologi-jaringan/penyempurnaan-tampilan-peta`)  
**Plan**: Peta Pelanggan & Topologi Jaringan (`409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`)  
**Status**: SELESAI (100% Lulus Pengujian, Typecheck, Lint, dan Next.js Build)

---

## 1. Analisis Masalah & Desain Solusi
Pada penggunaan lapangan oleh teknisi jaringan ISP yang menggunakan smartphone atau perangkat layar sentuh kecil ($< 768\text{px}$):
1. **Target Sentuh Tombol Kontrol (Touch Target Ergonomics WCAG Minimum Size)**:
   - Tombol-tombol kontrol Leaflet bawaan (`.leaflet-bar a`) secara default hanya berukuran $30\text{px} \times 30\text{px}$, terlalu kecil untuk jari teknisi di luar ruangan.
   - Solusi: Menambahkan media query di `src/app/globals.css` pada `@media (max-width: 767px)` yang memperbesar tombol kontrol zoom Leaflet menjadi $36\text{px} - 38\text{px}$ dengan font size $18\text{px} - 20\text{px}$.
2. **Bilah Kontrol Atas Peta (`network-map.tsx`)**:
   - Input pencarian (`map-search-input`) diperbesar dari `h-8` menjadi `h-9 sm:h-8` dengan padding teks yang lega.
   - Saringan wilayah (`map-region-filter`) dan status (`map-status-filter`) diperbesar menjadi `h-9 sm:h-8` dengan padding `px-2.5 sm:px-2.5`.
   - Tombol-tombol aksi utama (Refresh, Lapis Peta, Fit Bounds, GPS Teknisi, Panduan Simbol, Tambah Titik) diperbesar menjadi `h-9 sm:h-8` dengan ikon adaptif `size-4 sm:size-3.5`.
3. **Panel Inspeksi Detail Pelanggan & Perangkat (`CustomerDetailPanel` & `DeviceDetailPanel`)**:
   - Status badges: Teks diperjelas dari `text-[10px]` menjadi `text-[11px] sm:text-[10px]` dengan tinggi `h-5.5 sm:h-5` dan `font-semibold`.
   - Tombol tutup panel (`close-customer-panel`, `close-infra-panel`): Target sentuh ditingkatkan menjadi `size-8 sm:size-7 flex items-center justify-center p-2 sm:p-1.5`.
   - Tombol aksi: Simpan/Batal lokasi, Rute Navigasi Google Maps, Salin GPS, Pindah Titik, dan Hapus Titik diperbesar dari `h-7.5` menjadi `h-9 sm:h-8`.
   - Tombol pintasan operasional terpadu (Pelanggan, CPE/ONT, Billing, Router MikroTik, OLT) disetel ke `h-9 sm:h-8 px-2.5 text-xs sm:text-[11px]`.
4. **Dok Legenda Peta (`NetworkMapLegend`)**:
   - Tombol lipat/buka (`toggle-legend-collapse`) diperbesar dari `size-6` menjadi `size-7 sm:size-6` dengan ikon `size-4 sm:size-3.5`.
   - Tombol tab filter kategori legenda ("Penanda & Titik", "Kapasitas Kabel", "Visibilitas Lapisan") disetel dengan target sentuh `min-h-[32px] sm:min-h-[28px]` dan teks `text-xs sm:text-[11px] font-semibold`.

---

## 2. Rincian Modifikasi Berkas
1. `src/app/globals.css`:
   - Penambahan aturan media query `@media (max-width: 767px)` untuk `.leaflet-bar a` (36px, font-size 18px) dan `.leaflet-touch .leaflet-bar a` (38px, font-size 20px).
2. `src/components/map/network-map.tsx`:
   - Search input, select filter wilayah & status, tombol refresh, layer switcher, fit bounds, locate me, dan placement button diubah ke `h-9 sm:h-8`.
3. `src/components/map/map-symbols-guide-dialog.tsx`:
   - Trigger dialog diubah ke `h-9 sm:h-8` dengan icon `size-4 sm:size-3.5`.
4. `src/components/map/customer-detail-panel.tsx`:
   - Badges disetel ke `text-[11px] sm:text-[10px] h-5.5 sm:h-5`.
   - Tombol tutup diperbesar ke `size-8 sm:size-7`.
   - Tombol simpan/batal koordinat, Google Maps, Salin GPS, dan pintasan operasional diubah ke `h-9 sm:h-8`.
5. `src/components/map/device-detail-panel.tsx`:
   - Badges disetel ke `text-[11px] sm:text-[10px] h-5.5 sm:h-5`.
   - Tombol tutup diperbesar ke `size-8 sm:size-7`.
   - Tombol pindah lokasi, batal, simpan, Google Maps, Salin GPS, konfirmasi hapus, dan pintasan operasional diubah ke `h-9 sm:h-8`.
6. `src/components/map/network-map-legend.tsx`:
   - Tombol toggle collapse diubah ke `size-7 sm:size-6`.
   - Tab kategori legenda disetel ke `min-h-[32px] sm:min-h-[28px] text-xs sm:text-[11px]`.
7. `tests/small-screen-touch-typography.test.mjs`:
   - Unit test suite mencakup 6 pengujian otomatis untuk verifikasi CSS Leaflet, input/tombol di peta, dialog panduan, panel pelanggan, panel perangkat, dan dok legenda (6/6 pass).

---

## 3. Bukti Verifikasi Pengujian

### A. Unit Tests (`node --test tests/small-screen-touch-typography.test.mjs`)
```
▶ Small Screen Touch Target & Typography Optimization
  ✔ should define accessible Leaflet touch target CSS for mobile screens in globals.css (0.7661ms)
  ✔ should have enhanced button and input heights in network-map.tsx (0.5149ms)
  ✔ should have enlarged touch trigger in map-symbols-guide-dialog.tsx (0.2537ms)
  ✔ should have enhanced typography and touch targets in customer-detail-panel.tsx (0.238ms)
  ✔ should have enhanced typography and touch targets in device-detail-panel.tsx (0.2213ms)
  ✔ should have enhanced tab buttons and collapse toggle in network-map-legend.tsx (0.1961ms)
✔ Small Screen Touch Target & Typography Optimization (3.4399ms)
ℹ tests 6 | suites 1 | pass 6 | fail 0
```

### B. Full Map Test Suite (47 Tests)
```
ℹ tests 47 | suites 2 | pass 47 | fail 0
ℹ duration_ms 173.2849
```

### C. ESLint Linter
```bash
npx eslint "src/components/map/network-map.tsx" "src/components/map/map-symbols-guide-dialog.tsx" "src/components/map/customer-detail-panel.tsx" "src/components/map/device-detail-panel.tsx" "src/components/map/network-map-legend.tsx"
# Result: 0 error, 0 warning (Exit Code: 0)
```

### D. TypeScript Typecheck
```bash
npm run typecheck
# Result: 0 error, Types generated successfully (Exit Code: 0)
```

### E. Next.js Production Build
```bash
npm run build
# Result: Compiled successfully in 3.2s, 136/136 static and dynamic routes generated (Exit Code: 0)
```
