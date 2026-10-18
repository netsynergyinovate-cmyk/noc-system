# Laporan Rekayasa Teknis: Buat Kontrol Pindah Anak ke Induk Lain

**ID Task**: `peta-pelanggan-amp-topologi-jaringan/hubungan-induk-anak/buat-kontrol-pindah-anak-ke-induk-lain`  
**Fitur**: Hubungan Induk–Anak (Peta Pelanggan & Topologi Jaringan)  
**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI (VERIFIED)  

---

## 1. Analisis Kebutuhan & Akar Masalah
Dalam operasional jaringan fiber optik lapangan (FTTH):
1. **Reorganisasi Splice & Drop Cable**: Pelanggan (Tingkat 4) sering kali perlu dialihkan dari satu ODP ke ODP lain karena kapasitas port splitter penuh atau jalur kabel drop dialihkan ke tiang terdekat.
2. **Re-routing Feeder & Distribusi**: Kotak ODP (Tingkat 3) dapat dipindahkan induknya ke ODC (Tingkat 2) lain, atau dialihkan menjadi Direct ODP ke Core Router. Begitu pula ODC (Tingkat 2) dapat dipindahkan ke Core Router / OLT lain.
3. **Integritas Database & Defensive Validation**: Pemindahan relasi harus divalidasi ketat menggunakan Zod (`nodeId`, `nodeType`, `tier` 2–4, `newParentId`, `newParentName`) dan dieksekusi secara atomik ke database PostgreSQL nyata (`odpName` pada tabel `customers`, atau `parentId` pada tabel `network_infrastructure`) dengan umpan balik visual instan di antarmuka peta tanpa muat ulang halaman.

---

## 2. Rincian Implementasi Teknis

### A. Skema Validasi Zod `src/validators/hierarchy-reassign.ts`
- Menyediakan `reassignHierarchyParentSchema` yang memvalidasi integritas data pemindahan simpul anak ke induk baru:
  ```ts
  export const reassignHierarchyParentSchema = z.object({
    nodeId: z.string().trim().min(1, "ID simpul anak tidak boleh kosong."),
    nodeType: z.enum(["customer", "odp", "odc"]),
    tier: z.coerce.number().int().min(2).max(4),
    newParentId: z.string().trim().min(1, "ID induk baru wajib diisi."),
    newParentName: z.string().trim().min(1, "Nama induk baru wajib diisi."),
  });
  ```

### B. Service Backend `src/services/network-hierarchy.service.ts`
- Fungsi `reassignHierarchyParent` mengeksekusi mutasi relasi ke database PostgreSQL:
  ```ts
  if (input.tier === 4 || input.nodeType === "customer") {
    await db
      .update(customers)
      .set({ odpName: input.newParentName, lastUpdatedAt: new Date() })
      .where(eq(customers.id, input.nodeId));
  } else {
    await db
      .update(networkInfrastructure)
      .set({ parentId: input.newParentId, updatedAt: new Date() })
      .where(eq(networkInfrastructure.id, input.nodeId));
  }
  ```

### C. Endpoint API `src/app/api/map/hierarchy/reassign/route.ts`
- Menyediakan handler HTTP `POST` terautentikasi (`withApiSession`) yang memvalidasi request body dengan Zod dan memanggil `reassignHierarchyParent`.

### D. Kontrol UI Interaktif `src/components/map/hierarchy-map-board.tsx`
1. **Tombol "Pindah Induk" pada Floating Detail Panel**:
   - Ditampilkan di samping nama induk saat ini untuk simpul dengan `selectedNode.tier >= 2`:
     ```tsx
     <Button
       type="button"
       variant="outline"
       size="sm"
       className="h-5 px-1.5 text-[9px] gap-1 font-semibold shrink-0 border-primary/40 text-primary hover:bg-primary/10"
       onClick={() => setIsReassignOpen(true)}
       data-testid="reassign-parent-button"
     >
       <ArrowRightLeft className="size-2.5" />
       <span>Pindah Induk</span>
     </Button>
     ```
2. **Dialog Pemilihan Induk Baru (`reassign-parent-dialog`)**:
   - Menghasilkan daftar opsi induk yang valid secara hierarkis:
     - Pelanggan (T4) &rarr; Daftar ODP (T3).
     - ODP (T3) &rarr; Daftar ODC (T2) atau Core Root (T1).
     - ODC (T2) &rarr; Daftar Core Server / Router / OLT (T1).
   - Dilengkapi `<select data-testid="new-parent-select">`, tombol simpan `confirm-reassign-button`, dan tombol batal `cancel-reassign-button`.
3. **Pembaruan Optimistik & Visual Tanpa Muat Ulang**:
   - Setelah konfirmasi berhasil, state `data` dan `selectedNode.parentName` langsung diperbarui secara optimistik di memori. Silsilah silsilah (*lineage trail*) dan garis kabel topologi di peta Leaflet seketika ditarik ulang ke koordinat induk baru.

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
$ npx eslint src/validators/hierarchy-reassign.ts src/services/network-hierarchy.service.ts src/app/api/map/hierarchy/reassign/route.ts src/components/map/hierarchy-map-board.tsx
(Exit Code 0, clean)
```
*Hasil*: 0 Error, 0 Warning.

### C. Pengujian Unit Test (`node --test tests/reassign-hierarchy-parent.test.mjs`)
```
▶ Task: Buat Kontrol Pindah Anak ke Induk Lain (Reassign Parent Hierarchy)
  ✔ 1. Skema Validasi Zod reassignHierarchyParentSchema (91.3774ms)
  ✔ 2. Service reassignHierarchyParent: Update Database PostgreSQL (0.3045ms)
  ✔ 3. Endpoint API POST /api/map/hierarchy/reassign (0.1305ms)
  ✔ 4. Kontrol UI Tombol 'Pindah Induk' di Detail Simpul (0.1718ms)
  ✔ 5. Kontrol UI Dialog Interaktif & Seleksi Induk Baru (0.1572ms)
✔ Task: Buat Kontrol Pindah Anak ke Induk Lain (Reassign Parent Hierarchy) (93.8372ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
```
*Hasil*: 100% lulus (6/6 subtests).

### D. Uji Regresi Menyeluruh (40 Subtests)
```
$ node --test tests/reassign-hierarchy-parent.test.mjs tests/toggle-panel-without-reload.test.mjs tests/highlight-map-node-from-tree.test.mjs tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs
ℹ tests 40
ℹ pass 40
ℹ fail 0
ℹ duration_ms 208.458
```
*Hasil*: 100% lulus tanpa kegagalan.
