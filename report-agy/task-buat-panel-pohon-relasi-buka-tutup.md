# Laporan Rekayasa Teknis: Buat Panel Pohon Relasi Buka-Tutup

**ID Task**: `peta-pelanggan-amp-topologi-jaringan/hubungan-induk-anak/buat-panel-pohon-relasi-buka-tutup`  
**Fitur**: Hubungan Induk–Anak (Peta Pelanggan & Topologi Jaringan)  
**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI (VERIFIED)  

---

## 1. Analisis Kebutuhan & Akar Masalah
Operator jaringan memerlukan fleksibilitas saat menginspeksi struktur bertingkat (Server &rarr; ODC &rarr; ODP &rarr; Pelanggan):
1. **Pemanfaatan Layar Penuh (Maximized Canvas)**: Pada layar laptop standar atau tablet lapangan, panel explorer pohon di sisi kiri dapat mempersempit area peta Leaflet. Panel harus dapat ditutup dengan mulus agar kanvas peta melebar penuh (100% width).
2. **Navigasi Cepat (Quick Access Floating Button)**: Ketika panel pohon ditutup, operator harus dapat membukanya kembali seketika tanpa harus mencari toggle di bar atas, melalui tombol terapung (*floating button*) di sudut kiri atas kanvas peta.
3. **Kendali Ekspansi Cabang Massal (Bulk Branch Controls)**: Jaringan dengan ratusan ODC/ODP membutuhkan aksi satu klik untuk membuka seluruh cabang (*Expand All*) saat audit menyeluruh atau menutup seluruh cabang (*Collapse All*) untuk kembali ke tampilan ringkas.

---

## 2. Rincian Implementasi Teknis

### A. Komponen UI `src/components/map/hierarchy-map-board.tsx`
1. **State Buka-Tutup Panel & Tombol Tutup Header**:
   - Menambahkan tombol tutup panel pada header explorer pohon:
     ```tsx
     <button
       type="button"
       onClick={() => setIsTreeOpen(false)}
       className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
       data-testid="close-tree-panel-button"
       title="Tutup panel pohon relasi"
       aria-label="Tutup panel pohon relasi"
     >
       <X className="size-3.5" />
     </button>
     ```
2. **Aksi Ekspansi Massal (Expand All & Collapse All)**:
   - Menambahkan tombol kendali cabang pada header explorer:
     ```tsx
     <Button
       type="button"
       variant="outline"
       size="sm"
       className="h-6 px-2 text-[10px] gap-1 flex-1 font-medium bg-background/80"
       onClick={expandAllNodes}
       data-testid="expand-all-tree-button"
       title="Buka semua cabang simpul pohon"
     >
       <ChevronsUpDown className="size-3 text-primary" />
       <span>Buka Semua</span>
     </Button>
     <Button
       type="button"
       variant="outline"
       size="sm"
       className="h-6 px-2 text-[10px] gap-1 flex-1 font-medium bg-background/80"
       onClick={collapseAllNodes}
       data-testid="collapse-all-tree-button"
       title="Tutup semua cabang simpul pohon"
     >
       <ChevronsDownUp className="size-3 text-muted-foreground" />
       <span>Tutup Semua</span>
     </Button>
     ```
   - Implementasi `expandAllNodes` mengiterasi seluruh `roots`, `odcs`, `odps`, dan `directOdps` untuk memasukkan seluruh id simpul ke dalam `Set<string>`.
   - Implementasi `collapseAllNodes` mengosongkan `Set<string>`.

3. **Tombol Terapung Buka Pohon (`floating-open-tree-button`)**:
   - Di dalam kontainer kanvas peta, saat `!isTreeOpen`, tombol terapung diposisikan di sudut kiri atas (`absolute top-3 left-3 z-[1000]`):
     ```tsx
     {!isTreeOpen && (
       <Button
         type="button"
         variant="secondary"
         size="sm"
         onClick={() => setIsTreeOpen(true)}
         className="absolute top-3 left-3 z-[1000] shadow-md border border-border/80 bg-card/95 backdrop-blur-xs text-xs font-medium gap-1.5 h-8 px-2.5 hover:bg-muted"
         data-testid="floating-open-tree-button"
         title="Buka panel pohon relasi jaringan"
       >
         <Share2 className="size-3.5 text-primary rotate-90" />
         <span>Buka Pohon Relasi</span>
       </Button>
     )}
     ```

---

## 3. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### A. TypeScript Typecheck
```
$ npm run typecheck
> ngodingpakeai-starter@0.1.0 typecheck
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
```
*Hasil*: 0 Error.

### B. ESLint Static Analysis
```
$ npx eslint src/components/map/hierarchy-map-board.tsx
(Exit Code 0, clean)
```
*Hasil*: 0 Error, 0 Warning.

### C. Pengujian Unit Test (`node --test`)
```
$ node --test tests/collapsible-tree-panel.test.mjs
▶ Fitur Panel Pohon Relasi Buka-Tutup (Collapsible Tree Panel)
  ✔ 1. Keberadaan State dan Kontrol Buka-Tutup Panel (0.7141ms)
  ✔ 2. Tombol Tutup Panel di Header Pohon Relasi (0.1894ms)
  ✔ 3. Tombol Terapung Buka Pohon di Kanvas Peta saat Panel Tertutup (0.1949ms)
  ✔ 4. Aksi Ekspansi Massal: Buka Semua & Tutup Semua Cabang (0.1774ms)
  ✔ 5. Simulasi Logika Expand All & Collapse All pada Struktur Pohon (0.2496ms)
✔ Fitur Panel Pohon Relasi Buka-Tutup (Collapsible Tree Panel) (3.7121ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
```
*Hasil*: 100% lulus (6/6 subtests).

### D. Uji Regresi Menyeluruh (21 Subtests)
```
$ node --test tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs
ℹ tests 21
ℹ pass 21
ℹ fail 0
ℹ duration_ms 104.9044
```
*Hasil*: 100% lulus tanpa kegagalan.
