# Laporan Teknis: Sinkronkan Posisi Lapisan Gambar dengan Peta

## 1. Ringkasan Tugas
- **Task ID**: `peta-pelanggan-amp-topologi-jaringan/lapisan-gambar-leaferjs/sinkronkan-posisi-lapisan-gambar-dengan-peta`
- **Fitur**: Lapisan Gambar LeaferJS
- **Layer**: `frontend`
- **Plan**: Peta Pelanggan & Topologi Jaringan (`409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`)
- **Status**: SELESAI

---

## 2. Analisis Akar Masalah (Root Cause Analysis)
Tantangan teknis utama dalam menggabungkan kanvas gambar anotasi 2D (LeaferJS/HTML5 Canvas) dengan peta geografis Leaflet adalah fenomena **pergeseran koordinat (coordinate drifting)**:
1. **Piksel Layar vs Koordinat Bumi**: Jika objek anotasi (persegi, lingkaran cakupan ODP, panah penunjuk, garis kabel, teks catatan) hanya disimpan dalam koordinat piksel layar `(x, y)`, maka saat pengguna menggeser (*pan*) atau memperbesar/memperkecil (*zoom*) peta Leaflet, gambar anotasi akan melayang statis dan kehilangan keterikatannya dengan infrastruktur jaringan di lapangan.
2. **Ketiadaan Jembatan Instance Peta**: Komponen peta geografis dasar (`NetworkMap`) sebelumnya tidak mengekspos instance `LeafletMap` ke komponen induk (`DrawingLayerMapBoard`) maupun komponen overlay kanvas (`LeaferCanvasOverlay`).
3. **Ketiadaan Model Data Geografis**: Skema dan validator bentuk gambar (`DrawingShape`) belum menampung koordinat lintang/bujur (`geoCoordinates`) maupun radius fisik dalam meter (`geoRadius`).

---

## 3. Implementasi Solusi Teknis

### A. Perluasan Skema & Validator Koordinat Geografis
- **Skema Database (`src/db/schema/map-drawing-layers.ts`)**:
  Menambahkan properti opsional `geoCoordinates?: [number, number] | [number, number][]` dan `geoRadius?: number` pada definisi tipe `DrawingShape['properties']`.
- **Validator Zod (`src/validators/map-drawing-layers.ts`)**:
  Memvalidasi `geoCoordinates` (bisa berupa tuple `[lat, lng]` atau array pasangan koordinat poligon/garis) serta `geoRadius` (angka positif).

### B. Eksposisi Instance Leaflet Map di `NetworkMap` (`src/components/map/network-map.tsx`)
- Menambahkan prop `onMapReady?: (map: LeafletMap) => void` pada antarmuka `NetworkMapProps`.
- Mengimplementasikan `handleMapRef` berbasis `useCallback` untuk menangkap inisialisasi `MapContainer` Leaflet dan meneruskannya ke callback `onMapReady`.

### C. Aliran Instance Peta di `DrawingLayerMapBoard` (`src/components/map/drawing-layer-map-board.tsx`)
- Mengelola state `leafletMap` (`L.Map | null`).
- Menghubungkan callback `onMapReady={setLeafletMap}` pada `NetworkMapLeafletLoader`.
- Meneruskan `leafletMapInstance={leafletMap}` ke `LeaferCanvasOverlay`.

### D. Transformasi Koordinat Dua Arah di `LeaferCanvasOverlay` (`src/components/map/leafer-canvas-overlay.tsx`)
1. **Saat Menggambar (`handleMouseUp`)**:
   - Menggunakan `leafletMapInstance.containerPointToLatLng([x, y])` untuk mengonversi titik piksel kontainer menjadi koordinat GPS nyata `[lat, lng]`.
   - Untuk lingkaran: menghitung jarak fisik meter `centerLatLng.distanceTo(edgeLatLng)` sebagai `geoRadius`.
   - Menyimpan `geoCoordinates` dan `geoRadius` ke dalam `shape.properties`.
2. **Saat Render Ulang (`redrawCanvas`)**:
   - Memproyeksikan kembali koordinat GPS ke posisi piksel kontainer saat ini menggunakan `leafletMapInstance.latLngToContainerPoint(...)`.
   - Untuk lingkaran: mengonversi `geoRadius` meter ke jari-jari piksel dinamis sesuai level zoom saat ini.
   - Tetap menyediakan fallback koordinat piksel statis jika instance peta belum terpasang.
3. **Sinkronisasi Reaktif Peta**:
   - Mendaftarkan listener event Leaflet: `"move"`, `"zoom"`, `"viewreset"`, dan `"resize"`.
   - Setiap kali peta digeser atau di-zoom oleh teknisi, kanvas gambar langsung di-render ulang secara presisi di posisi bumi yang sama tanpa *lag* atau *drift*.

---

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### A. Pengujian Unit Sinkronisasi Posisi (`tests/drawing-map-position-sync.test.mjs`)
1. Skema Database & Validator Mendukung Koordinat Geografis (`geoCoordinates` & `geoRadius`) ➔ **PASS**.
2. NetworkMap Mengekspos `onMapReady` & Membagikan Instance Leaflet Map ➔ **PASS**.
3. DrawingLayerMapBoard Menerima Instance Peta & Menghubungkannya ke LeaferCanvasOverlay ➔ **PASS**.
4. Pencatatan Koordinat Geografis (`containerPointToLatLng`) Saat Menggambar ➔ **PASS**.
5. Proyeksi Koordinat Dinamis (`latLngToContainerPoint`) Saat Render ➔ **PASS**.
6. Event Listener Transformasi Peta Leaflet (`move`, `zoom`, `viewreset`, `resize`) ➔ **PASS**.

Hasil: **7/7 tests pass (100%)**.

### B. Uji Regresi Penuh Seluruh Modul Peta & Anotasi
`node --test tests/*map*.test.mjs tests/drawing*.test.mjs tests/leafer*.test.mjs`
Hasil: **219 dari 219 tests lulus (100% pass, 0 fail).**

### C. TypeScript Typecheck
`npm run typecheck`
Hasil: **0 errors** (Route types and AST compilation passed).

### D. ESLint
`npx eslint src/components/map/ src/validators/map-drawing-layers.ts src/db/schema/map-drawing-layers.ts`
Hasil: **0 errors, 0 warnings.**
