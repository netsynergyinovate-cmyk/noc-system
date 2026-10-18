# Laporan Teknis Task: Buat Geser dan Simpan Posisi Titik Pelanggan

**Tanggal**: 2026-10-16  
**Fase**: Fase 2 - Titik Pelanggan di Peta  
**Layer**: `frontend`  
**Ref Task**: `peta-pelanggan-amp-topologi-jaringan/titik-pelanggan-di-peta/buat-geser-dan-simpan-posisi-titik-pelanggan`  
**Status**: Selesai & Terverifikasi (100% Tests Pass)

---

## 1. Ringkasan Perubahan & Akar Masalah (Root Cause Analysis)

### A. Fitur Geser dan Simpan Posisi Titik Pelanggan (Interactive Pin Drag & Persist)
Operator lapangan dan tim NOC memerlukan kemampuan untuk mengoreksi posisi penanda titik pelanggan secara visual di peta dan menyimpannya secara permanen ke database PostgreSQL.

1. **Validator Zod (`src/validators/customer-location.ts`)**:
   - `updateCustomerLocationSchema`: Validasi ketat koordinat latitude (rentang -90 s.d. 90) dan longitude (rentang -180 s.d. 180).
2. **Service Server-Only (`src/services/customer-location.service.ts`)**:
   - `updateCustomerLocation(customerId, input, actorUserId)`: Memperbarui kolom `latitude`, `longitude`, dan `lastUpdatedAt` di tabel PostgreSQL `customers` via Drizzle ORM.
   - Menyimpan riwayat audit ke tabel `auditLog` dengan aksi `update_customer_location` dan rincian perubahan koordinat lama vs baru.
   - `getCustomerCoordinates(customerId)`: Mengambil titik koordinat pelanggan saat ini.
3. **Route API (`src/app/api/customers/[id]/location/route.ts`)**:
   - Menangani `GET` dan `PATCH` / `PUT` yang diamankan menggunakan `withApiSession(request)`.
   - Mengembalikan respons JSON standar `{ ok: true, data: ..., message: ... }`.
4. **Panel Detail Pelanggan (`src/components/map/customer-detail-panel.tsx`)**:
   - Menambahkan tombol aktivasi mode geser: `data-testid="edit-location-button"` ("Geser / Ubah Posisi Titik" atau "Tetapkan Titik di Peta").
   - Menambahkan kontainer mode geser: `data-testid="edit-location-mode-container"`.
   - Menampilkan draft koordinat realtime: `data-testid="draft-coordinates-display"`.
   - Tombol simpan: `data-testid="save-location-button"` dengan state loading spinner.
   - Tombol batal: `data-testid="cancel-location-button"`.
   - Notifikasi sukses: `data-testid="location-save-success"`.
   - Alert galat: `data-testid="location-save-error"`.
5. **Kanvas Peta (`src/components/map/network-map.tsx`)**:
   - Menambahkan komponen `MapLocationPicker` menggunakan hook `useMapEvents` untuk menangkap klik area target di peta.
   - Menampilkan marker pin penanda `data-testid="draggable-customer-marker"` dengan atribut `draggable={true}` dan penanganan event `dragend` untuk memperbarui draft koordinat.
   - Menambahkan floating guide banner di atas kanvas: `data-testid="edit-location-guide-banner"` dan tombol simpan cepat `data-testid="banner-save-location-button"`.
   - Pembaruan optimistik lokal pada state data peta saat koordinat berhasil disimpan.

### B. Perbaikan Bug Tile Layer Subdomains
- **Akar Masalah**: Error browser `TypeError: Cannot read properties of undefined (reading 'length') at i._getSubdomain` terjadi karena penyedia tile `satellite` dan `streets` tidak mendefinisikan array `subdomains`, sehingga React-Leaflet meneruskan `subdomains: undefined` ke konstruktor Leaflet yang memicu exception saat membaca properti `.length`.
- **Solusi**: 
  - Pada `src/config/map.ts`, seluruh provider diinisialisasi dengan `subdomains: ["a", "b", "c"]`.
  - Pada `src/components/map/network-map.tsx`, `<TileLayer subdomains={TILE_PROVIDERS[layerMode].subdomains ?? ["a", "b", "c"]} />` diberi fallback array string yang aman.

---

## 2. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### A. TypeScript Typecheck
```bash
> npm run typecheck
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
(Exit code: 0)
```

### B. ESLint
```bash
> npx eslint "src/validators/customer-location.ts" "src/services/customer-location.service.ts" "src/app/api/customers/[id]/location/route.ts" "src/components/map/customer-detail-panel.tsx" "src/components/map/network-map.tsx" "src/config/map.ts"
(Exit code: 0, 0 error, 0 warning)
```

### C. Unit & Integration Test Suite
```bash
> node --test tests/customer-drag-and-save-location.test.mjs tests/customer-detail-panel.test.mjs tests/customer-shortcuts.test.mjs tests/empty-points-explanation.test.mjs tests/region-and-point-status-filter.test.mjs tests/map-detail-panel-persistence.test.mjs tests/pelanggan-peta-page.test.mjs tests/real-map-markers-service.test.mjs

ℹ tests 51
ℹ suites 0
ℹ pass 51
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 190.2957
(Exit code: 0)
```

---

## 3. Kesimpulan
Fitur geser dan simpan posisi titik pelanggan berhasil diimplementasikan secara end-to-end (UI Leaflet draggable marker, picker klik kanvas, Zod validator, PostgreSQL Drizzle persistence, audit log, dan perbaikan tile layer subdomains).
Semua gerbang pengujian mandiri lulus 100%. Siap ditandai selesai pada antrean task CLI.
