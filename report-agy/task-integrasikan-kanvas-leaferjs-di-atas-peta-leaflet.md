# Laporan Teknis: Integrasikan Kanvas LeaferJS di Atas Peta Leaflet

## 1. Ringkasan Tugas
- **Task ID**: `peta-pelanggan-amp-topologi-jaringan/lapisan-gambar-leaferjs/integrasikan-kanvas-leaferjs-di-atas-peta-leaflet`
- **Fitur**: Lapisan Gambar LeaferJS
- **Layer**: `frontend`
- **Status**: SELESAI

---

## 2. Analisis & Akar Masalah (Root Cause Analysis)
Integrasi kanvas gambar interaktif (seperti LeaferJS) di atas peta interaktif Leaflet memiliki tantangan teknis mendasar:
1. **Konflik Event Mouse/Pointer**: Saat pengguna menggambar bentuk geometri (kotak, lingkaran, panah, garis), Leaflet secara default menangkap event `mousedown` dan `mousemove` untuk dragging/panning peta.
2. **Ketergantungan Browser DOM**: LeaferJS mengakses objek browser seperti `CanvasRenderingContext2D`, `Path2D`, dan `window` pada tahap inisialisasi modul, sehingga wajib dimuat secara dinamis (*dynamic import*) hanya pada lingkungan klien untuk mencegah crash SSR pada Next.js atau runner Node.js.
3. **Sinkronisasi Koordinat**: Posisi dan ukuran kanvas overlay harus sinkron dengan dimensi viewport Leaflet saat event `resize`, `zoom`, dan `move` terjadi pada peta.

---

## 3. Implementasi Teknis

### A. Komponen `LeaferCanvasOverlay` (`src/components/map/leafer-canvas-overlay.tsx`)
- Menggunakan pointer events dinamis (`pointer-events-auto` saat mode gambar aktif, `pointer-events-none` saat mode select tanpa selection).
- Mengontrol dragging Leaflet:
  ```ts
  if (leafletMap && typeof leafletMap.dragging?.disable === "function") {
    if (tool !== "select") {
      leafletMap.dragging.disable();
    } else {
      leafletMap.dragging.enable();
    }
  }
  ```
- Mendengarkan event Leaflet `move`, `zoom`, `resize` untuk sinkronisasi posisi kanvas terhadap peta dunia.
- Inisialisasi kanvas Leafer secara kondisional saat `typeof window !== "undefined"` dan elemen kontainer siap.

### B. Integrasi pada `DrawingLayerMapBoard` (`src/components/map/drawing-layer-map-board.tsx`)
- Komponen `LeaferCanvasOverlay` disematkan langsung di dalam wrapper peta Leaflet (`DrawingLayerMapBoard`).
- Meneruskan instance `leafletMap`, status aktif `activeTool`, warna, ketebalan garis, serta callback `onShapesChange`.

---

## 4. Bukti Verifikasi Mandiri

### A. Unit Testing (`tests/leafer-canvas-overlay.test.mjs`)
- `tests/leafer-canvas-overlay.test.mjs`: **5/5 tests passing**.
- Pengujian mencakup struktur komponen, listener Leaflet, kontrol dragging Leaflet, dynamic load LeaferJS, dan integrasi di drawing-layer-map-board.

### B. Typecheck & Lint
- `npm run typecheck`: **0 errors**.
- `npx eslint src/components/map/leafer-canvas-overlay.tsx`: **0 errors**.

### C. Regresi Sistem Peta
- `node --test tests/*map*.test.mjs tests/drawing*.test.mjs tests/leafer*.test.mjs`: **205/205 tests passing**.
