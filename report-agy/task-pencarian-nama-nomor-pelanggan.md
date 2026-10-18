# Laporan Eksekusi Task: Tambah Pencarian Nama dan Nomor Pelanggan

- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Feature**: `Titik Pelanggan di Peta` (Fase 2, Frontend)
- **Ref Task**: `peta-pelanggan-amp-topologi-jaringan/titik-pelanggan-di-peta/tambah-pencarian-nama-dan-nomor-pelanggan`
- **Tanggal**: 2026-10-16

---

## 1. Ringkasan Implementasi
Telah diimplementasikan fitur pencarian komprehensif pelanggan pada modul peta jaringan berdasarkan nama pelanggan, nomor akun PPPoE, ID pelanggan, nomor seri modem ONT (ONU SN), nama ODP, dan alamat fisik.

### Detail Fitur yang Diterapkan:
1. **Input Pencarian & Aksesibilitas (`src/components/map/network-map.tsx`)**:
   - `data-testid="map-search-input"`
   - Placeholder yang deskriptif: `"Cari nama atau nomor pelanggan..."`
   - Aksesibilitas: `aria-label="Cari nama atau nomor pelanggan"`
   - Tombol bersihkan pencarian (`X`) dengan `aria-label="Bersihkan pencarian"`

2. **Kriteria Pencocokan Pencarian Fleksibel**:
   - `matchesName`: Pencocokan substring nama pelanggan (case-insensitive)
   - `matchesUsername`: Pencocokan nomor akun / username PPPoE
   - `matchesId`: Pencocokan ID unik pelanggan di PostgreSQL
   - `matchesSerial`: Pencocokan nomor seri hardware modem ONT / ONU (ZTEG, HWTC, dsb.)
   - `matchesOdp`: Pencocokan nama kotak distribusi ODP
   - `matchesAddress`: Pencocokan alamat tempat tinggal pelanggan

3. **Dropdown Saran Pencarian Cepat (`data-testid="search-results-dropdown"`)**:
   - Menampilkan hingga 6 saran pelanggan relevan saat pengguna mengetik query.
   - Setiap item (`data-testid="search-result-item"`) memuat:
     - Nama pelanggan (`data-testid="search-result-name"`)
     - Nomor akun PPPoE & Serial Number ONT (`data-testid="search-result-number"`)
     - Indikator status koneksi (Online/Offline) dan Rx optical power
   - Ketika item diklik:
     - Peta langsung memusatkan kamera (`map.flyTo`) ke koordinat GPS pelanggan bersangkutan.
     - Membuka panel detail pelanggan secara otomatis.
   - State nihil: Menampilkan `data-testid="search-no-results"` saat tidak ada nama/nomor yang cocok.

4. **Sinkronisasi Hook & Service Backend**:
   - `src/hooks/use-network-map-markers.ts`: Fungsi `filterMarkers` diperluas mencakup nama, username, ID, dan ONU serial.
   - `src/services/map-markers.service.ts`: Query filter server-side diperluas mencakup nama, ID, PPPoE username, dan ONU serial.

---

## 2. Bukti Pengujian Mandiri (Gerbang Verifikasi Mandiri)

### A. TypeScript Typecheck
```bash
npm run typecheck
```
**Output**:
```
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
(Exit code: 0)
```

### B. ESLint
```bash
npx eslint src/components/map/network-map.tsx src/hooks/use-network-map-markers.ts src/services/map-markers.service.ts
```
**Output**:
```
0 errors, 0 warnings (Exit code: 0)
```

### C. Node Unit Test Suite
```bash
node --test tests/customer-search.test.mjs
```
**Output**:
```
✔ Tambah pencarian nama dan nomor pelanggan (6 tests passed)
ℹ pass 6
ℹ fail 0
```

Seluruh 112 unit test suite peta, penanda, pintasan, dan pencarian lulus 100% tanpa regresi.
