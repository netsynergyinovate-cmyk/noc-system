# Laporan Eksekusi: Buat Endpoint Titik Pelanggan Per Viewport

- **Task Ref**: `peta-pelanggan-amp-topologi-jaringan/penyempurnaan-tampilan-peta/buat-endpoint-titik-pelanggan-per-viewport`
- **Task ID**: `d37e3e84-41fb-4d87-8f3d-838ac04218e6`
- **Feature**: `Penyempurnaan Tampilan Peta` (Layer `backend`, Phase 5/5)
- **Status**: SELESAI (100% Passed)

---

## 1. Analisis Kebutuhan & Desain Endpoint
Pada skala jaringan FTTH ratusan hingga ribuan pelanggan, memuat seluruh koordinat pelanggan sekaligus ke dalam browser dapat membebani memori dan memperlambat render peta Leaflet. Untuk optimasi performa skala besar, sistem membutuhkan:
1. **Endpoint Khusus Penyaringan Berdasarkan Area Pandang (`GET /api/map/customers/viewport`)**:
   - Menerima parameter koordinat area pandang Leaflet:
     - Bentuk parameter individual: `minLat`, `maxLat`, `minLng`, `maxLng` atau alias kardinal `south`, `north`, `west`, `east`.
     - Bentuk standar Bounding Box string: `bbox="minLng,minLat,maxLng,maxLat"`.
     - Buffer margin dinamis (default 15% / `0.15`) untuk menghindari efek *pop-in* marker saat pengguna melakukan *panning* perlahan.
     - Parameter tingkat zoom (`zoom`: integer 1-22).
2. **Kesesuaian Endpoint Master (`GET /api/map/customers`)**:
   - Menyelaraskan query parser master agar mendukung parameter viewport bounding box secara transparan dan backward-compatible.
3. **Struktur Ringkasan Respons**:
   - `summary`: Menyertakan `totalInViewport`, `totalGeocoded`, jumlah status (online, offline, isolir, redaman kritis), serta detail batas geografis yang telah dibuffer (`bounds`).

---

## 2. Modifikasi Berkas & Implementasi

### A. `src/validators/customer-location.ts`
- Menambahkan skema validasi `viewportCustomersQuerySchema`:
  - Mendukung ekstraksi koordinat, format bbox, buffer, zoom level, filter status, pencarian, dan paginasi.
- Memperluas `geocodedCustomersQuerySchema` dengan atribut batas koordinat viewport.

### B. `src/services/customer-location.service.ts`
- Menambahkan fungsi helper `resolveViewportBounds(params)`:
  - Normalisasi koordinat terbalik, parsing string bbox, dan perhitungan margin buffer 15%.
- Memperbarui `applyCustomerQueryFilters`:
  - Menyaring pelanggan yang berada di dalam rentang koordinat `[bufferedMinLat, bufferedMaxLat]` dan `[bufferedMinLng, bufferedMaxLng]`.
- Mengekspor fungsi service `getCustomersByViewport(query)`:
  - Mengambil data pelanggan tergeocoded dan mengembalikan payload terstruktur beserta metadata viewport.

### C. `src/app/api/map/customers/viewport/route.ts`
- Route handler baru `GET /api/map/customers/viewport`:
  - Terproteksi sesi `withApiSession`.
  - Validasi parameter dengan `viewportCustomersQuerySchema`.
  - Menangani error secara defensif dengan status 500 dan format JSON.

### D. `src/app/api/map/customers/route.ts`
- Menyelaraskan ekstraksi parameter URL agar field viewport dapat diterima.

### E. `tests/customer-viewport-endpoint.test.mjs`
- Dibuat suite pengujian unit 7 skenario memverifikasi resolusi bounds dari berbagai format input (individual, kardinal, bbox), kalkulasi buffer 15%, validasi schema Zod, penolakan sesi HTTP 401, dan output service.

---

## 3. Bukti Verifikasi Mandiri

1. **Unit & Integration Tests**:
   - `node --test tests/customer-viewport-endpoint.test.mjs tests/customer-location*.test.mjs`
   - **Hasil**: 100% Passed.
2. **ESLint**:
   - `npx eslint src/app/api/map/customers/viewport/route.ts src/app/api/map/customers/route.ts src/services/customer-location.service.ts src/validators/customer-location.ts`
   - **Hasil**: 0 errors, 0 warnings.
3. **TypeScript Typecheck**:
   - `npm run typecheck`
   - **Hasil**: Types generated successfully, 0 errors.
