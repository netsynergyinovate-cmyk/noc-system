# Laporan Teknis Task: Buat Halaman Lapisan Gambar Peta dengan Data Nyata dari Backend

**Task ID**: `peta-pelanggan-amp-topologi-jaringan/lapisan-gambar-leaferjs/buat-halaman-lapisan-gambar-peta-dengan-data-nyata`  
**Fitur**: Lapisan Gambar LeaferJS (Fase 5 - Frontend)  
**Tanggal**: 17 Oktober 2026  
**Status**: Selesai (100% Lulus Pengujian)

---

## 1. Analisis & Kebutuhan Fitur
Sesuai PRD `peta.md` Fase 5, operator dan teknisi lapangan membutuhkan lapisan anotasi gambar 2D di atas peta jaringan geografis nyata untuk mencatat rencana penarikan kabel feeder, perencanaan kotak distribusi ODP, penandaan area gangguan optik, serta catatan teknis lapangan tanpa mengubah layer peta dasar.
- Anotasi harus dapat digambar dalam bentuk vektor: Persegi (kotak area), Lingkaran (cakupan), Garis, Panah petunjuk arah, dan Label teks.
- Lapisan dapat diatur transparansinya (*opacity*), urutan tumpukannya (*z-index*), dan dapat disembunyikan/ditampilkan secara selektif.
- Seluruh bentuk dan lapisan wajib disimpan ke backend nyata (PostgreSQL via Drizzle), bukan disimpan di `localStorage` peramban (aturan Zero-Dummy).
- Peta dasar di bawah kanvas gambar menampilkan data operasional riil dari PostgreSQL (Core Router, OLT, ODP, kabel, pelanggan aktif).

---

## 2. Rincian Implementasi Teknis (Surgical Scope)

### A. Skema Database & Migrasi SQL
1. **`src/db/schema/map-drawing-layers.ts`**:
   - Mendefinisikan tabel master `map_drawing_layers`:
     - `id`: `text PRIMARY KEY` (UUID).
     - `name`: `text NOT NULL` (nama lapisan, misal "Sektor 1 - Rencana Feeder").
     - `description`: `text` (deskripsi opsional).
     - `opacity`: `numeric(3, 2)` (transparansi 0.0 - 1.0, default 1.0).
     - `z_index`: `integer` (urutan tumpukan lapisan, default 1).
     - `is_visible`: `boolean` (status visibilitas, default true).
     - `shapes`: `jsonb NOT NULL` (array objek bentuk 2D dengan koordinat dan properti garis/warna/teks).
     - `created_by`: `text` (ID user pembuat).
     - `created_at` & `updated_at`: `timestamp with time zone`.
   - Indeks pada kolom `is_visible` dan `z_index`.
   - Diekspor ke `src/db/schema/index.ts`.
2. **`drizzle/0027_map_drawing_layers.sql`**:
   - Migrasi DDL `CREATE TABLE IF NOT EXISTS "map_drawing_layers"` dan indeks.
   - Telah diaplikasikan ke database PostgreSQL lokal melalui `npm run db:migrate`.

### B. Validator & Service Backend
1. **`src/validators/map-drawing-layers.ts`**:
   - Validator Zod `drawingShapeSchema`, `createDrawingLayerSchema`, dan `updateDrawingLayerSchema`.
2. **`src/services/map-drawing-layers.service.ts`**:
   - `getMapDrawingLayers()`: Mengambil daftar seluruh lapisan tersimpan dari PostgreSQL diurutkan berdasarkan `z_index` dan `created_at`, dengan ringkasan `totalLayers`, `visibleLayers`, `totalShapes`, serta metadata `isRealData: true`.
   - `getMapDrawingLayerById(id)`: Mengambil satu detail lapisan.
   - `createMapDrawingLayer(input)`: Menyimpan lapisan baru ke PostgreSQL.
   - `updateMapDrawingLayer(id, input)`: Memperbarui nama, transparansi, urutan, atau bentuk gambar.
   - `deleteMapDrawingLayer(id)`: Menghapus lapisan dari database.

### C. Endpoint API HTTP Terproteksi
1. **`src/app/api/map/drawing-layers/route.ts`**:
   - `GET`: Mengembalikan daftar lapisan gambar riil dari PostgreSQL.
   - `POST`: Menyimpan lapisan gambar baru.
   - Diproteksi sesi `withApiSession`, runtime `nodejs`.
2. **`src/app/api/map/drawing-layers/[id]/route.ts`**:
   - `PATCH`: Memperbarui properti lapisan / bentuk gambar.
   - `DELETE`: Menghapus lapisan gambar dari database.
   - Diproteksi sesi `withApiSession`, runtime `nodejs`.

### D. Komponen Antarmuka & Halaman
1. **`src/components/map/drawing-layer-map-board.tsx`**:
   - Komponen interaktif (`data-testid="drawing-layer-map-board"`).
   - Menyatukan kanvas Leaflet peta dasar data riil (`NetworkMapLeafletLoader`) dengan kanvas anotasi 2D interaktif (`data-testid="leafer-drawing-canvas"`).
   - Toolbar alat gambar:
     - `data-testid="tool-select"`: Kursor / Pointer
     - `data-testid="tool-rectangle"`: Kotak / Persegi Area
     - `data-testid="tool-circle"`: Lingkaran Cakupan
     - `data-testid="tool-arrow"`: Panah Petunjuk Arah
     - `data-testid="tool-line"`: Garis Penghubung
     - `data-testid="tool-text"`: Label Catatan Teks Lapangan
   - Palet pemilih warna (7 warna) dan pemilih ketebalan garis (2px, 4px, 6px).
   - Panel kelola lapisan (`data-testid="layer-management-panel"`):
     - Daftar lapisan gambar dengan toggle visibilitas, slider transparansi (opacity 0-100%), dan pengatur z-index.
     - Tombol tambah lapisan (`data-testid="add-layer-button"`).
     - Tombol simpan seluruh lapisan ke server PostgreSQL (`data-testid="save-layers-button"`).
   - Badge sumber data nyata `data-testid="data-source-badge"` (`PostgreSQL Live`).
   - Kartu metrik ringkasan data nyata (total lapisan, objek bentuk, perangkat dasar, pelanggan aktif).
2. **`src/app/(protected)/app/peta/gambar/page.tsx`**:
   - Server Component terproteksi `await requireSession()`.
   - Mengambil data nyata terpadu via `getCompleteRealMapData()` dan lapisan gambar tersimpan via `getMapDrawingLayers()`.
   - Merender `<DrawingLayerMapBoard>`.
3. **Navigasi Terpadu**:
   - Menambahkan menu `"Lapisan Gambar"` (`/app/peta/gambar`) di `src/components/dashboard/app-nav.tsx`.
   - Menambahkan shortcut `"Lapisan Gambar"` di `src/app/(protected)/app/peta/page.tsx`.

---

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

### A. Pengujian Unit Test Otomatis
- **`tests/drawing-layer-map-page.test.mjs`** (6 pengujian spesifik):
  1. Halaman memproteksi autentikasi dan memuat data riil backend.
  2. Komponen board menyediakan kanvas gambar 2D dan toolbar alat lengkap.
  3. Panel kelola lapisan menyediakan kontrol opacity, z-index, visibility, dan simpan.
  4. Endpoint API HTTP terproteksi dengan `withApiSession` dan runtime `nodejs`.
  5. Service backend dan skema PostgreSQL operasional riil.
- **`tests/drawing-layers-api.test.mjs`** (5 pengujian integrasi):
  - Memverifikasi penolakan akses anonim (HTTP 401) pada GET, POST, PATCH, dan DELETE.
- **Suite Keseluruhan**:
  ```bash
  node --test tests/*map*.test.mjs tests/drawing*.test.mjs
  # Output: 200 passing (0 failed, 100% lulus)
  ```

### B. Pemeriksaan Tipe & Linting
- **TypeScript**:
  ```bash
  npm run typecheck
  # Output: Types generated successfully. 0 errors.
  ```
- **ESLint**:
  ```bash
  npx eslint src/db/schema/map-drawing-layers.ts src/validators/map-drawing-layers.ts ...
  # Output: 0 errors, 0 warnings.
  ```

---

## 4. Kesimpulan
Halaman lapisan gambar peta dengan data nyata backend (`/app/peta/gambar`) telah berhasil dibangun, terhubung secara persisten ke database PostgreSQL, dan siap digunakan oleh teknisi NOC untuk membuat anotasi lapangan tanpa data tiruan.
