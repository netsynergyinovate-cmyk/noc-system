# Laporan Teknis Task: Hapus Fallback Data Contoh di Endpoint Peta

**Task ID**: `peta-pelanggan-amp-topologi-jaringan/data-nyata-peta/hapus-fallback-data-contoh-di-endpoint-peta`  
**Fitur**: Data Nyata Peta (Fase 4 - Backend)  
**Tanggal**: 17 Oktober 2026  
**Status**: Selesai (100% Lulus Pengujian)

---

## 1. Analisis & Akar Masalah (Root-Cause Analysis)
Sebelum penyelesaian task ini, sejumlah rute endpoint API peta (`/api/map/network`, `/api/map/unified`, `/api/map/infrastructure`, `/api/map/layers`, `/api/map/markers`, `/api/map/hierarchy`, `/api/map/customers`) serta service backend terkait masih memiliki:
1. Cabang pemeriksaan query parameter `mode=mock` atau `forceMock` yang menyebabkan endpoint secara eksplisit menyajikan mock data lokal.
2. Fallback otomatis saat `process.env.DASHBOARD_DATA === "demo"`, yang mengabaikan kueri PostgreSQL dan langsung menyajikan data tiruan lokal.
3. Silent fallback di blok `catch`: ketika terjadi kegagalan koneksi atau error kueri PostgreSQL, service menangkap error dan mengembalikan data dummy lokal alih-alih melempar error nyata (melanggar prinsip *Zero-Dummy & Kejujuran Telemetri* serta PRD Fase 4).
4. Fallback saat database kosong: jika tabel `network_infrastructure` atau `network_hierarchy` kosong, service secara otomatis menyuntikkan data contoh lokal (`mock.infrastructure` / `mock.customers`) alih-alih mengembalikan status kosong (*empty state*) yang transparan.

---

## 2. Rincian Perubahan Teknis (Surgical Scope)

### A. Endpoint API HTTP
1. **`src/app/api/map/network/route.ts`**:
   - Menghapus percabangan `if (forceMock || process.env.DASHBOARD_DATA === "demo")`.
   - Menghapus parameter `mode=mock`.
   - Endpoint selalu memanggil `getCompleteRealMapData` secara langsung untuk menyajikan data nyata dari database PostgreSQL operasional.
2. **`src/app/api/map/unified/route.ts`**:
   - Menghapus percabangan `if (forceMock || process.env.DASHBOARD_DATA === "demo")`.
   - Endpoint selalu memanggil `getCompleteRealMapData` secara konsisten.
3. **`src/app/api/map/infrastructure/route.ts`**:
   - Menghapus query parameter `forceMock` dari `rawParams`.
   - Kueri `getInfrastructureList(parsed.data)` selalu membaca tabel fisik database.
4. **`src/app/api/map/layers/route.ts`**:
   - Menghapus `forceMock`. Panggilan service disederhanakan menjadi `getMapLayersData({ layer })`.
5. **`src/app/api/map/markers/route.ts`**:
   - Menghapus `forceMock` dari `filterOptions`.
6. **`src/app/api/map/hierarchy/route.ts`**:
   - Menghapus `forceMock` dari `searchParams`. Panggilan service menjadi `getNetworkHierarchyData()`.
7. **`src/app/api/map/customers/route.ts`**:
   - Menghapus `forceMock` dari `rawParams`.

### B. Service Backend & Penanganan Error
1. **`src/services/network-map.service.ts`**:
   - Menghapus pengecekan `process.env.DASHBOARD_DATA === "demo"` pada fungsi `getNetworkMapData`.
   - Menghapus silent fallback ke mock data di blok `catch`. Error dilempar kembali (`throw err`) agar status HTTP 500 diteruskan ke klien dan memicu tampilan *MapErrorState* resmi dengan tombol *Coba Lagi*.
2. **`src/services/map-infrastructure.service.ts`**:
   - Pada `getInfrastructureList`: jika database kosong, `allItems = []` (tidak lagi menyuntikkan data mock). `dataSource.provider` diset ke `"PostgreSQL Live"` dan `isRealData: true`.
   - Pada `getInfrastructureDetail` & `getConnectedCustomersForDevice`: pencarian fallback mock hanya dieksekusi jika `options?.forceMock` aktif secara eksplisit (untuk isolasi unit test), bukan otomatis saat data database kosong.
3. **`src/services/customer-location.service.ts`**:
   - Menghapus demo fallback dan silent mock fallback pada blok `catch` di `getGeocodedCustomers` dan `getCustomerMapDetail`.
4. **`src/services/network-hierarchy.service.ts`**:
   - Menghapus otomatisasi mock saat `rawInfra.length === 0`. Jika database kosong, kembalikan struktur pohon kosong (`roots: []`) dengan penanda `isRealData: true`.
5. **`src/services/map-layers.service.ts`**:
   - Membatasi pembangkitan jalur kabel sintetis hanya bila `options?.forceMock` aktif secara eksplisit. Jika tabel database kosong, `cables` dikembalikan sebagai array kosong `[]`.

---

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

### A. Pengujian Unit Test Otomatis
- **Berkas Pengujian Baru**: `tests/map-remove-mock-fallback.test.mjs` (5 pengujian spesifik):
  1. Verifikasi seluruh 7 endpoint peta tidak memiliki cabang fallback `mode=mock`, `forceMock`, atau `DASHBOARD_DATA === demo`.
  2. Verifikasi `/api/map/network` dan `/api/map/unified` memanggil `getCompleteRealMapData` nyata tanpa fallback ke mock.
  3. Verifikasi service peta melempar error nyata saat query database gagal (kejujuran telemetri).
  4. Verifikasi service infrastruktur & hierarki tidak menyuntikkan mock data saat database kosong.
- **Hasil Pengujian Peta Lengkap**:
  ```bash
  node --test tests/*map*.test.mjs
  # Output: 189 passing (0 failed, 100% lulus)
  ```

### B. Pemeriksaan Tipe & Linting
- **TypeScript**:
  ```bash
  npm run typecheck
  # Output: Types generated successfully. 0 errors.
  ```
- **ESLint**:
  ```bash
  npx eslint src/app/api/map/network/route.ts src/app/api/map/unified/route.ts ...
  # Output: 0 errors, 0 warnings.
  ```

---

## 4. Kesimpulan
Seluruh endpoint peta kini sepenuhnya bebas dari fallback data contoh/dummy. Seluruh data spasial (titik pelanggan, penanda infrastruktur, bentangan kabel optik, dan hierarki relasi) bersumber murni dari PostgreSQL operasional NOC, memenuhi kaidah Zero-Dummy dan PRD Fase 4.
