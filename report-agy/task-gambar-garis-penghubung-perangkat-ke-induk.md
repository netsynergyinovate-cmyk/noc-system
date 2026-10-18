# Laporan Teknis: Gambar Garis Penghubung Perangkat ke Induk

**Ref Task**: `peta-pelanggan-amp-topologi-jaringan/hubungan-induk-anak/gambar-garis-penghubung-perangkat-ke-induk`  
**Fitur**: Hubungan Induk–Anak (Fase 3: Frontend Topologi Peta)  
**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI (DONE)

---

## 1. Analisis Kebutuhan & Desain Teknis (Design & Architecture)
Pada topologi jaringan fiber optic, setiap simpul infrastruktur (ODC, ODP, Tiang) dan pelanggan memiliki hubungan keterikatan bertingkat ke perangkat induknya (*upstream node*):
- **Core Server / Router &rarr; OLT / ODC**: Jalur Backbone (Ungu `#8b5cf6`, ketebalan 4.5px, pola garis `8, 6`, kapasitas 48 core).
- **ODC &rarr; ODP**: Jalur Feeder Distribusi (Cyan `#06b6d4`, ketebalan 3.5px, kapasitas 16 core).
- **ODP &rarr; Tiang (Pole)**: Jalur Distribusi Percabangan (Amber `#f59e0b`, ketebalan 2.5px, pola garis `6, 4`).
- **ODP &rarr; Pelanggan**: Kabel Drop Optik (Hijau `#10b981` jika online / Merah `#ef4444` jika offline, ketebalan 2px).

Sebelumnya, penarikan kabel pada peta masih menggunakan asumsi sederhana (semua ODP ditarik ke OLT tanpa memeriksa relasi `parentId` atau keberadaan kabin ODC perantara).

---

## 2. Perubahan Teknis yang Diimplementasikan

### 1. Ekstensi Tipe Data & Service: `src/services/network-map.service.ts`
- Menambahkan field opsional `parentId?: string | null` dan `parentName?: string | null` pada antarmuka `NetworkInfrastructurePoint`.
- Memperluas fungsi `getNetworkMapData` untuk secara otomatis membaca entri infrastruktur fisik dari tabel `network_infrastructure` dan menyertakan `parentId`.

### 2. Logika Relasi Kabel & Penarikan Garis: `src/components/map/network-map.tsx`
- **Pencarian Induk Eksplisit**: Memeriksa `infra.parentId`, `infra.details.parentId`, `infra.details.parentOdc`, atau `infra.details.parentRoot`. Jika perangkat induk ditemukan di daftar infrastruktur, garis relasi ditarik langsung dari titik koordinat induk ke perangkat tersebut (`parent-link-${parent.id}-${infra.id}`).
- **Smart Fallback Deterministik**: Untuk perangkat yang belum memiliki induk eksplisit:
  - Core Router &rarr; OLT dihubungkan dengan jalur Backbone.
  - ODC dihubungkan ke Core/OLT.
  - ODP dihubungkan ke ODC terdekat berdasarkan perhitungan jarak Euclidean minimum (atau OLT jika ODC belum ada).
- **Efek Visual Sorotan (Lineage Highlighting & Glow Halo)**:
  - Saat perangkat (`selectedInfra`) atau pelanggan (`selectedCustomer`) dipilih, seluruh garis relasi yang terhubung ke induk atau anak langsung mendapatkan status `isHighlighted = true`.
  - Garis yang disorot dirender dengan warna cyan aktif `#22d3ee`, ketebalan meningkat menjadi 5px, dan dilengkapi layer glow halo di bawahnya (`weight: 9`, `opacity: 0.6`).
- **Tooltip Relasi Kaya**: Menampilkan nama relasi induk-anak (`Induk ➔ Anak`), tipe kabel, kapasitas core, serta status operasional simpul.

### 3. Integrasi Papan Hierarki: `src/components/map/hierarchy-map-board.tsx`
- Menyematkan `parentId` dan `parentName` ke dalam setiap simpul `infraList` di `mapCompatibleData` sehingga seluruh susunan 4 tingkat (Core &rarr; ODC &rarr; ODP &rarr; Pelanggan) langsung terhubung secara visual di atas kanvas peta Leaflet.

---

## 3. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### A. Pengujian Unit & Integrasi
Perintah:
```bash
node --test tests/parent-device-link-rendering.test.mjs tests/hierarchy-tier-structure.test.mjs tests/hierarchy-map-page.test.mjs
```
Hasil:
```text
▶ Task: Bangun halaman peta susunan bertingkat dengan data nyata dari backend
  ✔ Service: getNetworkHierarchyData menyusun struktur bertingkat 4 tingkat lengkap (0.7226ms)
  ✔ Komponen HierarchyMapBoard: Menyediakan UI interaktif, KPI cards, dan filter tingkat (0.2183ms)
  ✔ Halaman Server: /app/topologi terproteksi sesi dan membaca data nyata backend (0.1348ms)
  ✔ API Endpoints: /api/map/hierarchy dan /api/infrastructure/hierarchy terautentikasi (0.1064ms)
✔ Task: Bangun halaman peta susunan bertingkat dengan data nyata dari backend (3.8232ms)
▶ Penyusunan Tingkatan Server -> ODC -> ODP -> Pelanggan
  ✔ Definisi Modul hierarchy-lineage.ts: Metadata & Pelacak Silsilah Tingkatan (0.7741ms)
  ✔ Logika resolveHierarchyLineage: Resolusi 4 Tingkat Vertikal Lengkap (1.9279ms)
  ✔ Komponen HierarchyMapBoard: Breadcrumb Interaktif & Rantai Induk-Anak (0.2114ms)
  ✔ Defensif Leaflet: customer-map.tsx Menyertakan subdomains untuk Mencegah Crash TileLayer (0.1173ms)
✔ Penyusunan Tingkatan Server -> ODC -> ODP -> Pelanggan (6.2285ms)
▶ Task: Gambar garis penghubung perangkat ke induk
  ✔ Service & Schema: NetworkInfrastructurePoint memiliki parentId dan parentName (0.7465ms)
  ✔ Komponen NetworkMap: Menghubungkan perangkat ke induk berdasarkan parentId (0.3173ms)
  ✔ Komponen NetworkMap: Efek visual sorotan garis (highlight) dan halo glow (0.1525ms)
  ✔ Komponen HierarchyMapBoard: Meneruskan parentId & parentName ke layer peta (0.1692ms)
  ✔ Algoritma Penarikan Garis: Evaluasi In-Memory Relasi Induk-Anak Lengkap (0.3013ms)
✔ Task: Gambar garis penghubung perangkat ke induk (4.6787ms)
ℹ tests 16
ℹ pass 16
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
npx eslint src/components/map/network-map.tsx src/components/map/hierarchy-map-board.tsx src/services/network-map.service.ts
```
Hasil:
```text
0 errors, 0 warnings
(Exit code: 0)
```

---

## 4. Kesimpulan
Task `gambar-garis-penghubung-perangkat-ke-induk` telah selesai 100% dan terverifikasi secara lengkap.
Garis penghubung perangkat ke induk kini terintegrasi secara dinamis mengikuti relasi `parentId`, menyajikan pembedaan visual antar tipe kabel (Backbone, Feeder, Distribusi, Drop), serta efek sorotan interaktif saat simpul dipilih.
