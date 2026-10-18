# Laporan Teknis: Buat Panel Kelola Daftar Lapisan Gambar

## 1. Ringkasan Tugas
- **Task ID**: `peta-pelanggan-amp-topologi-jaringan/lapisan-gambar-leaferjs/buat-panel-kelola-daftar-lapisan-gambar`
- **Fitur**: Lapisan Gambar LeaferJS
- **Layer**: `frontend`
- **Plan**: Peta Pelanggan & Topologi Jaringan (`409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`)
- **Status**: SELESAI

---

## 2. Analisis & Akar Masalah (Root Cause Analysis)
Pada antarmuka peta anotasi lapangan, operator dan teknisi memerlukan kemampuan mengelola multi-lapisan gambar (seperti lapisan "Rencana Feeder", "Zonasi Insiden ODP", "Survei Tiang Drop") secara terstruktur:
1. **Pemisahan Kekhawatiran (Separation of Concerns)**: Kode panel manajemen lapisan sebelumnya menyatu di dalam komponen kanvas utama (`DrawingLayerMapBoard`), membebani state kanvas dan menyulitkan pengujian interaksi lapisan secara terisolasi.
2. **Kontrol Tumpukan (Z-Index Reordering)**: Peta memerlukan hierarki visual tumpukan yang fleksibel di mana teknisi dapat menaikkan (*bring forward*) atau menurunkan (*send backward*) urutan lapisan dengan tombol cepat atau input angka presisi.
3. **Manajemen Siklus Hidup Lapisan (CRUD & Duplikasi)**: Teknisi membutuhkan pembuatan lapisan baru dengan nama dan deskripsi, penggantian nama (*inline rename*), penyembunyian (*toggle visibility*), duplikasi lapisan beserta objek bentuknya, serta penghapusan lapisan ke backend PostgreSQL nyata.
4. **Zero-Dummy Compliance**: Panel tidak boleh menggunakan lapisan statis/hardcoded di memori lokal. Seluruh lapisan berasal dari skema PostgreSQL `map_drawing_layers` dan disinkronkan langsung via REST API (`/api/map/drawing-layers`).

---

## 3. Implementasi Teknis

### A. Komponen Modular `DrawingLayerManagerPanel` (`src/components/map/drawing-layer-manager-panel.tsx`)
Komponen baru yang menyediakan kontrol penuh atas lapisan gambar:
- **Header Panel**: Indikator jumlah lapisan terpasang (`Badge`), tombol toggle form `+ Tambah Lapisan`.
- **Form Pembuatan Lapisan**: Input nama lapisan (wajib) dan deskripsi/keterangan operasional (opsional).
- **Filter Pencarian Cepat**: Input pencarian `searchQuery` jika terdapat lebih dari 2 lapisan untuk mempermudah navigasi pada proyek jaringan besar.
- **Aksi Batch**: Tombol `Tampilkan Semua` dan `Sembunyikan Semua` untuk visibilitas massal.
- **Kartu Lapisan Interaktif (`layer-card-${id}`)**:
  - **Pemilihan Kanvas Aktif**: Klik nama lapisan untuk menjadikannya kanvas aktif menggambar dengan penanda visual tegas (`ring-1 ring-indigo-500/20` dan label `● Kanvas Aktif`).
  - **Inline Rename**: Tombol edit nama dengan input inline responsif yang dapat disimpan dengan tombol centang atau `Enter`, serta dibatalkan dengan `Escape`.
  - **Toggle Visibilitas**: Tombol `Eye` / `EyeOff` individual per lapisan.
  - **Duplikasi Lapisan**: Tombol `Copy` untuk menggandakan lapisan beserta seluruh array objek bentuknya ke server.
  - **Penghapusan Lapisan**: Tombol `Trash2` dengan dialog konfirmasi sebelum eksekusi API.
  - **Kontrol Transparansi**: Slider opasitas kontinu dari 10% hingga 100% dengan tampilan persentase numerik.
  - **Kontrol Urutan (Z-Index)**: Tombol panah atas (`ChevronUp` - Bring Forward), panah bawah (`ChevronDown` - Send Backward), dan input angka numerik presisi.
  - **Metrik Objek**: Menampilkan jumlah bentuk geometri (`shapesCount`) di dalam tiap lapisan.

### B. Integrasi pada `DrawingLayerMapBoard` (`src/components/map/drawing-layer-map-board.tsx`)
- Menggantikan sidebar inline sebelumnya dengan komponen modular `<DrawingLayerManagerPanel />`.
- Meneruskan state `layers`, `activeLayerId`, fungsi mutasi `handleUpdateLayer`, pembuatan `handleCreateLayer`, duplikasi `handleDuplicateLayer`, batch toggle `handleToggleAllVisibility`, dan penghapusan `handleDeleteLayer`.
- Membersihkan state lokal yang redundan (`newLayerName`, `showAddLayerModal`) dan import ikon yang tidak digunakan.

---

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### A. Unit Testing Komponen (`tests/drawing-layer-manager-panel.test.mjs`)
Dibuat pengujian unit komprehensif mencakup 6 suite spesifik:
1. Struktur dasar komponen & kontainer data-testid.
2. Form penambahan lapisan baru dengan validasi input.
3. Fitur interaktif per lapisan (select active, inline rename, visibility toggle, duplicate, delete).
4. Kontrol transparansi & urutan tumpukan z-index (slider, step button, input).
5. Fitur pencarian lapisan & aksi batch.
6. Integrasi bersih di dalam `DrawingLayerMapBoard`.

Hasil eksekusi:
```text
▶ Task: Buat panel kelola daftar lapisan gambar (Fase 5)
  ✔ 1. Struktur Dasar Komponen DrawingLayerManagerPanel (0.5315ms)
  ✔ 2. Form Tambah Lapisan Baru dengan Validasi Input (0.1629ms)
  ✔ 3. Fitur Interaktif Per Lapisan: Pilih Aktif, Rename, Visibilitas, Duplikasi & Hapus (0.1479ms)
  ✔ 4. Kontrol Transparansi (Opacity) & Pengaturan Urutan Tumpukan (Z-Index) (0.1127ms)
  ✔ 5. Fitur Pencarian Lapisan & Aksi Batch (0.0881ms)
  ✔ 6. Integrasi Bersih di DrawingLayerMapBoard (0.1782ms)
✔ Task: Buat panel kelola daftar lapisan gambar (Fase 5) (3.4005ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

### B. Uji Regresi Modul Peta & Gambar
Dijalankan terhadap seluruh suite pengujian peta dan drawing:
`node --test tests/*map*.test.mjs tests/drawing*.test.mjs tests/leafer*.test.mjs`
**Hasil: 212 dari 212 tests lulus 100% tanpa kegagalan.**

### C. TypeScript Typecheck
`npm run typecheck`
**Hasil: 0 error TypeScript.**

### D. ESLint
`npx eslint src/components/map/`
**Hasil: 0 error, 0 warning.**
