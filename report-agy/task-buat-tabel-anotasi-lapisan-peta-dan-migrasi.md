# Laporan Eksekusi: Buat Tabel Anotasi Lapisan Peta dan Migrasi

- **Task Ref**: `peta-pelanggan-amp-topologi-jaringan/lapisan-gambar-leaferjs/buat-tabel-anotasi-lapisan-peta-dan-migrasi`
- **Task ID**: `948e0254-e8e9-4355-ace4-986171e952bf`
- **Feature**: `Lapisan Gambar LeaferJS` (Layer `backend`, Phase 5/5)
- **Status**: SELESAI (100% Passed)

---

## 1. Analisis Kebutuhan & Desain Skema
Fitur Lapisan Gambar LeaferJS membutuhkan penyimpanan persisten untuk anotasi visual lapangan di atas peta topologi FTTH (misal: area rencana penarikan kabel, penandaan segmen putus, jalur pipa gorong-gorong, atau catatan tiang tumpu). Persistensi ini memerlukan:
1. **Tabel Skema PostgreSQL (`map_drawing_layers`)**:
   - `id`: UUID (Primary Key).
   - `name`: Nama lapisan (misal: "Rencana Drop Core RW 05", "Inspeksi Tiang Kritis").
   - `description`: Catatan operasional opsional.
   - `opacity`: Tingkat transparansi kanvas `numeric(3, 2)` (0.00 hingga 1.00, default `1.00`).
   - `zIndex`: Urutan kedalaman tumpukan lapisan visual `integer` (default `1`).
   - `isVisible`: Toggle visibilitas lapisan `boolean` (default `true`).
   - `shapes`: Array elemen geometris berformat `jsonb` (menyimpan koordinat kanvas piksel serta `geoCoordinates` dan `geoRadius` untuk sinkronisasi proyeksi Leaflet/GPS).
   - `createdBy`: Relasi ke user pembuat anotasi.
   - `createdAt` & `updatedAt`: Timestamp dengan zona waktu.
2. **Indeks Performa Database**:
   - `map_drawing_layers_visible_idx` pada kolom `is_visible` untuk query cepat filter lapisan aktif.
   - `map_drawing_layers_z_index_idx` pada kolom `z_index` untuk pengurutan rendering tumpukan kanvas.
3. **Penyelarasan Drizzle Migrator**:
   - Menambahkan entri migrasi `0026_device_relations` dan `0027_map_drawing_layers` ke `drizzle/meta/_journal.json`.
   - Menjalankan migrasi secara nyata ke PostgreSQL lokal menggunakan `npm run db:migrate:server`.

---

## 2. Modifikasi Berkas & Implementasi

### A. `src/db/schema/map-drawing-layers.ts`
- Memastikan tipe `DrawingShape`, `DrawingShapeType`, serta tabel `mapDrawingLayers` terdefinisi dengan indeks dan defaults yang aman.

### B. `drizzle/meta/_journal.json`
- Menambahkan entri migrasi `0026_device_relations` (idx: 26) dan `0027_map_drawing_layers` (idx: 27) agar dikenali oleh modul migrator runner Next.js & Node.js.

### C. Eksekusi Migrasi Database Riil
- `npm run db:migrate:server` berhasil mengeksekusi DDL ke PostgreSQL:
  ```
  [START] migrasi server
  [START] 0026_device_relations
  [SUKSES] 0026_device_relations
  [START] 0027_map_drawing_layers
  [SUKSES] 0027_map_drawing_layers
  ```
- Verifikasi status migrasi: 28/28 migrasi diterapkan.

### D. `tests/map-drawing-layers-schema-migration.test.mjs`
- Dibuat suite pengujian unit 7 skenario untuk memvalidasi kolom Drizzle, tipe geometris/GPS, indeks performa, ekspor schema index, DDL SQL, dan entri journal Drizzle.

---

## 3. Bukti Verifikasi Mandiri

1. **Unit & Integration Tests**:
   - `node --test tests/drawing*.test.mjs tests/map-drawing-layers-schema-migration.test.mjs`
   - **Hasil**: 81 passed, 0 failed.
2. **ESLint**:
   - `npx eslint src/db/schema/map-drawing-layers.ts src/db/schema/index.ts`
   - **Hasil**: 0 errors, 0 warnings.
3. **TypeScript Typecheck**:
   - `npm run typecheck`
   - **Hasil**: Types generated successfully, 0 errors.
4. **Database Migration Execution**:
   - `npm run db:migrate:server` ➔ Sukses menerapkan migrasi tabel `map_drawing_layers`.
