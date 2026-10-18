# Laporan Teknis: Buat Seleksi Ubah dan Hapus Objek Anotasi (Fase 5 - Lapisan Gambar LeaferJS)

## Ringkasan Eksekutif
Fitur inspektur objek vektor dan alat modifikasi anotasi telah diimplementasikan secara komprehensif pada lapisan gambar peta (`/app/peta/gambar`). Komponen baru `SelectedShapeModifierPanel` menyediakan antarmuka pengguna untuk memanipulasi objek yang dipilih di kanvas anotasi:
1. **Pemilihan Warna Instan**: Teknisi dapat mengubah palet warna bentuk yang ada tanpa perlu menggambar ulang.
2. **Pengatur Ketebalan Garis (Stroke Width)**: Mendukung ketebalan 1px hingga 6px.
3. **Stepper Dimensi Interaktif & Sinkronisasi Geografis (GPS)**:
   - Persegi Area: Penyesuaian Lebar (L) dan Tinggi (T) dengan perhitungan ulang `geoCoordinates` berbasis proyeksi Leaflet Map (`containerPointToLatLng`).
   - Lingkaran ODP: Penyesuaian Radius dengan perhitungan ulang `geoRadius` geodesik (`centerLatLng.distanceTo(edgeLatLng)`).
4. **Duplikasi Bentuk Geometri (Move + Duplicate)**:
   - Fungsi `moveShapeByOffset` menggandakan objek dengan offset visual `+24px` dan menghitung ulang seluruh titik koordinat geografis.
   - Didukung tombol UI dan pintasan keyboard `Ctrl+D` / `Cmd+D`.
5. **Penghapusan Bentuk Terpilih**:
   - Tombol hapus merah (`delete-selected-shape-btn`) serta pintasan keyboard `Delete` dan `Backspace`.
   - Pembatalan seleksi via tombol Batal atau tombol keyboard `Escape`.
6. **Pengeditan Teks Label**:
   - Jika objek yang dipilih bertipe `text`, tombol "Edit Teks" (`edit-selected-text-btn`) membuka modal dialog `DrawingTextDialog` untuk mengubah teks, ukuran font, dan warna.

---

## Berkas yang Diubah dan Dibuat
1. **`src/components/map/selected-shape-modifier-panel.tsx`** *(Baru)*:
   - Komponen panel modifikasi objek terpilih dengan kontrol warna, stroke, dimensi, duplikasi, dan hapus.
   - Menghitung ulang proyeksi geodesik `geoCoordinates` dan `geoRadius` secara reaktif.
2. **`src/components/map/leafer-canvas-overlay.tsx`**:
   - Mengekspor fungsi `moveShapeByOffset(shape, dx, dy, leafletMap)` untuk translasi bentuk dan perhitungan koordinat GPS.
3. **`src/components/map/drawing-layer-map-board.tsx`**:
   - Mengintegrasikan `SelectedShapeModifierPanel` menggantikan inspektur lama.
   - Menghubungkan handler `handleUpdateShapeProperties`, `handleDuplicateShape`, `handleShapeDeleted`, dan pintasan keyboard `Ctrl+D` / `Delete` / `Escape`.
4. **`tests/drawing-shape-modifier.test.mjs`** *(Baru)*:
   - Unit test suite komprehensif untuk pengujian panel modifier, kalkulasi offset geometri, integrasi board, dan shortcut keyboard (6/6 pass).

---

## Gerbang Verifikasi Mandiri (Evidence Before Assertions)
1. **TypeScript Typecheck**:
   ```
   > npm run typecheck
   ✓ Types generated successfully
   Process exited with code 0.
   ```
2. **ESLint Verification**:
   ```
   > npx eslint src/components/map/selected-shape-modifier-panel.tsx src/components/map/drawing-layer-map-board.tsx
   0 errors, 0 warnings.
   ```
3. **Unit Test Suite**:
   ```
   > node --test tests/drawing*.test.mjs tests/leafer*.test.mjs
   ℹ tests 57
   ℹ suites 1
   ℹ pass 57
   ℹ fail 0
   ```
4. **Next.js Production Build**:
   ```
   > npm run build
   ✓ Generating static pages using 15 workers (136/136) in 667ms
   Exit code: 0
   ```
