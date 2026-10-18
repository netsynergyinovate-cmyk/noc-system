# Laporan Eksekusi: Buat API Perbarui Urutan dan Transparansi Lapisan

- **Task Ref**: `peta-pelanggan-amp-topologi-jaringan/lapisan-gambar-leaferjs/buat-api-perbarui-urutan-dan-transparansi-lapisan`
- **Task ID**: `2343c2e8-448e-4c6f-9009-6995ee9e12c8`
- **Feature**: `Lapisan Gambar LeaferJS` (Layer `backend`, Phase 5/5)
- **Status**: SELESAI (100% Passed)

---

## 1. Analisis Kebutuhan & Rekayasa API
Pada visualisasi peta jaringan FTTH dengan lapisan gambar anotasi (LeaferJS), operator lapangan membutuhkan kemampuan untuk:
1. **Mengatur Urutan Tumpukan Lapisan (Z-Index Reordering)**:
   - Misalnya: membawa lapisan jalur kabel backbone ke urutan paling atas atau memindahkan sketsa perencanaan ke belakang agar tidak menutupi ODP atau pelanggan penting.
   - Operasi ini membutuhkan endpoint khusus batch reorder yang memperbarui kolom `z_index` dan `updated_at` secara atomik di database PostgreSQL.
2. **Mengatur Tingkat Transparansi Lapisan (Opacity Control)**:
   - Nilai transparansi (rentang 0.00 hingga 1.00) memungkinkan operator melihat peta satelit dan jalan di bawah anotasi poligon/area cakupan.
   - Membutuhkan validasi ketat (0.0 $\le$ opacity $\le$ 1.0) dan endpoint cepat untuk pembaruan instan saat slider digeser.

---

## 2. Modifikasi Berkas & Implementasi

### A. `src/validators/map-drawing-layers.ts`
- Menambahkan skema `reorderDrawingLayersSchema`:
  - Array minimal 1 elemen dengan objek `{ id: string, zIndex: number (integer) }`.
- Menambahkan skema `updateLayerOpacitySchema`:
  - Nilai desimal float dengan validasi `min(0)` dan `max(1.0)`.

### B. `src/services/map-drawing-layers.service.ts`
- Mengekspor fungsi `reorderMapDrawingLayers(layers: Array<{ id: string; zIndex: number }>)`:
  - Memperbarui kolom `z_index` dan timestamp `updated_at` pada PostgreSQL.
- Mengekspor fungsi `updateMapDrawingLayerOpacity(id: string, opacity: number)`:
  - Melakukan sanitasi `Math.min(Math.max(opacity, 0), 1)` dan memperbarui kolom `opacity` di database.

### C. `src/app/api/map/drawing-layers/reorder/route.ts`
- Endpoint khusus `POST` & `PATCH` `/api/map/drawing-layers/reorder` terproteksi sesi (`withApiSession`).
- Menerima payload batch urutan lapisan dan mengembalikan data lapisan terupdate.

### D. `src/app/api/map/drawing-layers/[id]/opacity/route.ts`
- Endpoint khusus `PATCH` `/api/map/drawing-layers/[id]/opacity` terproteksi sesi.
- Mengubah transparansi satu lapisan dengan respon cepat.

### E. `tests/drawing-layers-order-opacity-api.test.mjs`
- Dibuat suite pengujian unit 6 skenario untuk memvalidasi skema Zod reorder/opacity, proteksi sesi HTTP 401 pada endpoint reorder & opacity, serta verifikasi ekspor service.

---

## 3. Bukti Verifikasi Mandiri

1. **Unit & Integration Tests**:
   - `node --test tests/drawing-layers-order-opacity-api.test.mjs tests/drawing-layer-reorder.test.mjs tests/drawing-layer-opacity.test.mjs`
   - **Hasil**: 15 passed, 0 failed.
2. **ESLint**:
   - `npx eslint src/app/api/map/drawing-layers/reorder/route.ts "src/app/api/map/drawing-layers/[id]/opacity/route.ts" src/validators/map-drawing-layers.ts src/services/map-drawing-layers.service.ts`
   - **Hasil**: 0 errors, 0 warnings.
3. **TypeScript Typecheck**:
   - `npm run typecheck`
   - **Hasil**: Types generated successfully, 0 errors.
