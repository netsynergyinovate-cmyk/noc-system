# Laporan Eksekusi: Buat Endpoint Jalur Kabel Per Zoom

- **Task Ref**: `peta-pelanggan-amp-topologi-jaringan/penyempurnaan-tampilan-peta/buat-endpoint-jalur-kabel-per-zoom`
- **Task ID**: `add6eaa4-da5b-42ee-b91f-01a42f5e000c`
- **Feature**: `Penyempurnaan Tampilan Peta` (Layer `backend`, Phase 5/5)
- **Status**: SELESAI (100% Passed)

---

## 1. Analisis Kebutuhan & Desain Level-of-Detail (LOD)
Jalur kabel serat optik FTTH membentang ribuan meter melintasi jalan raya dan lorong perumahan, mulai dari kabel backbone 48-96 core, feeder utama 24 core, feeder distribusi 16-24 core, percabangan 4-8 core, hingga kabel drop tipis 1-2 core menuju rumah pelanggan. Jika semua segmen kabel dikirimkan saat peta berada di level zoom jauh (overview kota/wilayah), browser akan mengalami latensi render kanvas yang parah.

Untuk memecahkan masalah ini, backend mengimplementasikan arsitektur Level-of-Detail (LOD) berbasis zoom:
1. **Overview LOD (Zoom $\le 11$)**:
   - Hanya mengirimkan jalur kabel berkapasitas tinggi: Backbone Optik (48-96 Core) dan Feeder Utama (kapasitas $\ge 24$ Core).
   - Segmen drop dan cabang disembunyikan untuk menghemat bandwidth payload. Kabel bermasalah (status `offline`/`warning`) atau yang sedang disorot (`isHighlighted`) tetap dipertahankan.
2. **Regional LOD (Zoom $12 - 14$)**:
   - Mengirimkan Backbone, Feeder, dan Jalur Distribusi Antar-Tiang.
   - Kabel drop disembunyikan kecuali memiliki status `offline`, `warning`, atau di-override dengan `includeDrop=true`.
3. **Detail LOD (Zoom $\ge 15$)**:
   - Seluruh hierarki kabel optik termasuk seluruh kabel drop ke roset pelanggan dikirimkan secara mendalam.
4. **Spatial Bounding Box Culling Terpadu**:
   - Mendukung parameter area pandang (`minLat`, `maxLat`, `minLng`, `maxLng`, `bbox`) untuk memfilter hanya segmen kabel yang melintasi area pandang yang sedang diperiksa.

---

## 2. Modifikasi Berkas & Implementasi

### A. `src/validators/cable-query.ts`
- Membuat skema validasi `cableZoomQuerySchema`:
  - `zoom`: integer 1-22 (default 15).
  - Koordinat bounding box (`minLat, maxLat, minLng, maxLng, south, north, west, east, bbox, buffer`).
  - Filter `type` ("all" | "backbone" | "feeder" | "distribution" | "drop").
  - Filter `status` ("all" | "active" | "warning" | "offline").
  - Opsi `includeDrop` dan `forceMock`.

### B. `src/services/cable-map.service.ts`
- Menambahkan tipe `CableLodLevel` ("overview" | "regional" | "detail") dan helper `getLodLevelByZoom(zoom)`.
- Mengimplementasikan fungsi `filterCablesByZoomAndLod`:
  - Menyaring segmen kabel sesuai tingkatan zoom LOD, penyorotan aktif, status gangguan, dan irisan bounding box spasial.
  - Menghitung ringkasan statistik jalur (`totalCables`, `renderedCables`, `filteredByZoom`, `backboneCount`, `feederCount`, `distributionCount`, `dropCount`).
- Mengekspor fungsi service `getCablesByZoom(query)`.

### C. `src/app/api/map/cables/zoom/route.ts`
- Route handler baru `GET /api/map/cables/zoom` terproteksi sesi (`withApiSession`).
- Menerima query parameter, memvalidasi dengan Zod, dan mengembalikan data kabel teroptimasi LOD.

### D. `src/app/api/map/cables/route.ts`
- Menyelaraskan route master `GET /api/map/cables` agar secara otomatis memanggil `getCablesByZoom` jika parameter `zoom` terdeteksi di URL.

### E. `tests/cable-zoom-endpoint.test.mjs`
- Dibuat suite pengujian unit 6 skenario untuk memverifikasi akurasi pengelompokan LOD per level zoom, penyaringan drop kabel di zoom regional/overview, validasi Zod, penolakan sesi HTTP 401, dan output service.

---

## 3. Bukti Verifikasi Mandiri

1. **Unit & Integration Tests**:
   - `node --test tests/cable*.test.mjs`
   - **Hasil**: 100% Passed.
2. **ESLint**:
   - `npx eslint src/app/api/map/cables/zoom/route.ts src/app/api/map/cables/route.ts src/services/cable-map.service.ts src/validators/cable-query.ts`
   - **Hasil**: 0 errors, 0 warnings.
3. **TypeScript Typecheck**:
   - `npm run typecheck`
   - **Hasil**: Types generated successfully, 0 errors.
