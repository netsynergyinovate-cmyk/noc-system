# Laporan Teknis: Susun Tingkatan Server ODC ODP Pelanggan

**Ref Task**: `peta-pelanggan-amp-topologi-jaringan/hubungan-induk-anak/susun-tingkatan-server-odc-odp-pelanggan`  
**Fitur**: Hubungan Induk–Anak (Fase 3: Frontend Topologi Peta)  
**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI (DONE)

---

## 1. Analisis Akar Masalah & Kebutuhan (Root Cause Analysis)

### A. Runtime Error Leaflet `_getSubdomain` (Temuan Pengguna)
- **Gejala**: Pengguna melaporkan pesan galat di konsol peramban:
  ```text
  TypeError: Cannot read properties of undefined (reading 'length')
      at i._getSubdomain (0tk3t-f1r97km.js:1:118221)
      at i.getTileUrl (0tk3t-f1r97km.js:1:117555)
  ```
- **Akar Masalah**: Pada `src/components/dashboard/customer-map.tsx`, layer jalan OSM (`<TileLayer key="streets" ...>`) tidak mendeklarasikan opsi `subdomains`. Leaflet secara internal selalu mengevaluasi `this.options.subdomains.length` saat menyusun URL template tile (bahkan ketika template URL tidak memiliki token `{s}`). Karena `subdomains` bernilai `undefined`, operasi `.length` memicu `TypeError`.
- **Perbaikan**: Menambahkan `subdomains={["a", "b", "c"]}` secara eksplisit pada komponen `TileLayer` mode streets di `customer-map.tsx`.

### B. Penyusunan 4 Tingkatan Hierarki Jaringan Riil
Struktur topologi fiber optic ISP harus tersusun secara deterministik dalam 4 tingkatan bertingkat:
1. **Tingkat 1 (Core / Root)**: Core Gateway BGP Server / Router MikroTik / Master OLT (Warna Ungu `#8b5cf6`).
2. **Tingkat 2 (ODC)**: Optical Distribution Cabinet / Kabin Hub (Warna Biru `#3b82f6`).
3. **Tingkat 3 (ODP)**: Optical Distribution Point / Kotak Distribusi Splitter (Warna Amber `#f59e0b`).
4. **Tingkat 4 (Pelanggan)**: Titik Drop Core Pelanggan PPPoE (Warna Hijau `#10b981` online / Merah `#ef4444` offline).

---

## 2. Perubahan Teknis yang Diimplementasikan

### 1. Modul Resolusi Silsilah Vertikal: `src/lib/hierarchy-lineage.ts`
- Menyediakan metadata tingkatan `HIERARCHY_TIER_META` (label, badgeClass, hexColor, description) untuk setiap tingkat 1–4.
- Fungsi deterministik `resolveHierarchyLineage(data, targetId)` yang menelusuri secara rekursif/iteratif silsilah vertikal simpul yang dipilih dari akar hingga daun:
  - Root: `[Root]` (1 langkah)
  - ODC: `[Root, ODC]` (2 langkah)
  - ODP: `[Root, ODC, ODP]` atau `[Root, Direct ODP]` (3 langkah)
  - Pelanggan: `[Root, ODC, ODP, Pelanggan]` (4 langkah)
- Fungsi `filterLineageLinks` untuk menyorot garis relasi khusus pada simpul yang aktif.

### 2. Komponen Papan Hierarki: `src/components/map/hierarchy-map-board.tsx`
- **Breadcrumb Silsilah Interaktif**: Komponen `data-testid="hierarchy-lineage-breadcrumb"` menampilkan alur lengkap `Core > ODC > ODP > Pelanggan`. Tiap langkah dapat diklik langsung untuk memindahkan sorotan simpul dan fokus peta.
- **Penanda Badge Tingkat di Tree Explorer**:
  - Simpul Core diberi badge `T1 • {type}`.
  - Simpul ODC diberi badge `T2`.
  - Simpul ODP diberi badge `T3` (dan `T3 (Direct)` untuk ODP langsung).
  - Simpul Pelanggan diberi badge `T4`.
- **Dukungan Direct ODPs**: Menampilkan ODP yang langsung terhubung ke root gateway tanpa melewati kabin ODC perantara.
- **Lineage Trail di Floating Detail Panel**: Menampilkan rantai relasi induk-anak lengkap di dalam `selected-hierarchy-node-panel` (`data-testid="selected-node-lineage-trail"`).

### 3. Perbaikan Defensif Leaflet: `src/components/dashboard/customer-map.tsx`
- Menambahkan `subdomains={["a", "b", "c"]}` pada `<TileLayer key="streets" ...>` sehingga Leaflet tidak lagi mengalami kegagalan akses properti `.length`.

---

## 3. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### A. Pengujian Unit & Integrasi
Perintah:
```bash
node --test tests/hierarchy-tier-structure.test.mjs tests/hierarchy-map-page.test.mjs
```
Hasil:
```text
▶ Task: Bangun halaman peta susunan bertingkat dengan data nyata dari backend
  ✔ Service: getNetworkHierarchyData menyusun struktur bertingkat 4 tingkat lengkap (0.7229ms)
  ✔ Komponen HierarchyMapBoard: Menyediakan UI interaktif, KPI cards, dan filter tingkat (0.224ms)
  ✔ Halaman Server: /app/topologi terproteksi sesi dan membaca data nyata backend (0.1357ms)
  ✔ API Endpoints: /api/map/hierarchy dan /api/infrastructure/hierarchy terautentikasi (0.1135ms)
✔ Task: Bangun halaman peta susunan bertingkat dengan data nyata dari backend (3.7909ms)
▶ Penyusunan Tingkatan Server -> ODC -> ODP -> Pelanggan
  ✔ Definisi Modul hierarchy-lineage.ts: Metadata & Pelacak Silsilah Tingkatan (0.965ms)
  ✔ Logika resolveHierarchyLineage: Resolusi 4 Tingkat Vertikal Lengkap (2.1327ms)
  ✔ Komponen HierarchyMapBoard: Breadcrumb Interaktif & Rantai Induk-Anak (0.2444ms)
  ✔ Defensif Leaflet: customer-map.tsx Menyertakan subdomains untuk Mencegah Crash TileLayer (0.1241ms)
✔ Penyusunan Tingkatan Server -> ODC -> ODP -> Pelanggan (6.9082ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

### B. Pemeriksaan Tipe TypeScript
Perintah:
```bash
npm run typecheck
```
Hasil:
```text
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
(Exit code: 0)
```

### C. Pemeriksaan Linter ESLint
Perintah:
```bash
npx eslint src/lib/hierarchy-lineage.ts src/components/map/hierarchy-map-board.tsx src/components/dashboard/customer-map.tsx
```
Hasil:
```text
0 errors, 0 warnings
(Exit code: 0)
```

---

## 4. Kesimpulan
Task `susun-tingkatan-server-odc-odp-pelanggan` telah selesai 100% dengan implementasi pelacakan alur vertikal, breadcrumb interaktif, penanda badge 4 tingkat (`T1`-`T4`), serta perbaikan komprehensif pada error runtime Leaflet.
