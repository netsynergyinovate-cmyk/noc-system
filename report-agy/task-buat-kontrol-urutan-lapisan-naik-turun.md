# Laporan Pengerjaan Task: Buat Kontrol Urutan Lapisan Naik Turun

## 1. Ringkasan Eksekutif
- **Task ID**: `b691b174-3bdb-47f7-b329-0bdb8f9cbad8`
- **Task Ref**: `peta-pelanggan-amp-topologi-jaringan/lapisan-gambar-leaferjs/buat-kontrol-urutan-lapisan-naik-turun`
- **Fitur**: Lapisan Gambar LeaferJS (Fase 5/5)
- **Status**: Selesai (**100% Pass**)

---

## 2. Rincian Implementasi Teknis

### A. Komponen Antarmuka & Kontrol Reorder (`DrawingLayerManagerPanel`)
- File: `src/components/map/drawing-layer-manager-panel.tsx`
- Menambahkan prop `onReorderLayers?: (reorderedLayers: MapDrawingLayer[]) => void` pada `DrawingLayerManagerPanelProps`.
- Mengimplementasikan fungsi `handleReorderLayer(layerId: string, action: "up" | "down" | "top" | "bottom")`:
  - **Urutan Visual & Tumpukan Sinkron**: Mengurutkan array lapisan secara descending berdasarkan `zIndex` (`b.zIndex - a.zIndex`).
  - **Aksi Navigasi Lengkap**:
    - `top` (Bring to Front): Mengangkat lapisan langsung ke puncak tumpukan (posisi index 0).
    - `up`: Menukar posisi lapisan dengan elemen satu tingkat di atasnya.
    - `down`: Menukar posisi lapisan dengan elemen satu tingkat di bawahnya.
    - `bottom` (Send to Back): Menurunkan lapisan langsung ke dasar tumpukan.
  - **Normalisasi Deterministik**: Menghitung ulang `zIndex = total - index` sehingga tidak ada duplikasi nilai `zIndex` antar lapisan.
  - Memanggil `onReorderLayers(reorderedWithZ)` atau fallback ke `onUpdateLayer`.
- Kontrol UI pada setiap kartu lapisan:
  - Badge tingkat urutan tumpukan: `data-testid="layer-stack-level-${layer.id}"` (#1, #2, dst.)
  - Tombol Paling Atas (Bring to Front): `data-testid="move-layer-top-${layer.id}"` (Ikon `ChevronsUp`)
  - Tombol Naik Satu Tingkat: `data-testid="zindex-up-${layer.id}"` (Ikon `ChevronUp`)
  - Input Z-Index manual: `data-testid="zindex-input-${layer.id}"`
  - Tombol Turun Satu Tingkat: `data-testid="zindex-down-${layer.id}"` (Ikon `ChevronDown`)
  - Tombol Paling Bawah (Send to Back): `data-testid="move-layer-bottom-${layer.id}"` (Ikon `ChevronsDown`)
  - Tombol otomatis dinonaktifkan (`disabled`) saat lapisan sudah berada di puncak teratas atau dasar terbawah.

### B. Integrasi State Board (`DrawingLayerMapBoard`)
- File: `src/components/map/drawing-layer-map-board.tsx`
- Mendefinisikan callback `handleReorderLayers` dengan `useCallback`:
  ```tsx
  const handleReorderLayers = useCallback((reordered: MapDrawingLayer[]) => {
    setLayers(reordered);
    setHasUnsavedChanges(true);
  }, []);
  ```
- Meneruskan `onReorderLayers={handleReorderLayers}` ke `<DrawingLayerManagerPanel />`.
- Memastikan perubahan urutan tumpukan langsung menandai `hasUnsavedChanges = true` sehingga dapat disimpan secara atomik ke PostgreSQL via `PUT /api/map/drawing-layers`.

---

## 3. Hasil Gerbang Verifikasi Mandiri (Evidence Before Assertions)

1. **TypeScript Typecheck**:
   ```bash
   npm run typecheck
   # Output:
   # Generating route types...
   # ✓ Types generated successfully
   # Exit code: 0
   ```

2. **ESLint Static Analysis**:
   ```bash
   npx eslint src/components/map/drawing-layer-manager-panel.tsx src/components/map/drawing-layer-map-board.tsx
   # Output: 0 errors, 0 warnings
   # Exit code: 0
   ```

3. **Node.js Test Suite**:
   ```bash
   node --test tests/drawing*.test.mjs tests/leafer*.test.mjs
   # Output:
   # ℹ tests 72
   # ℹ suites 3
   # ℹ pass 72
   # ℹ fail 0
   # ℹ duration_ms 1747.0122
   # Exit code: 0
   ```
   - Berkas test baru `tests/drawing-layer-reorder.test.mjs` menguji integritas prop `onReorderLayers`, tombol navigasi DOM, logika swap & bring to top/bottom dengan normalisasi `zIndex`, serta integrasi board.

4. **Next.js Production Build**:
   ```bash
   npm run build
   # Output:
   # ✓ Compiled successfully in 4.0s
   # ✓ Generating static pages using 15 workers (136/136) in 638ms
   # Exit code: 0
   ```
