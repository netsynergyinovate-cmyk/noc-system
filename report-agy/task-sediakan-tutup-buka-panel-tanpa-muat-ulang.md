# Laporan Rekayasa Teknis: Sediakan Tutup Buka Panel Tanpa Muat Ulang

**ID Task**: `peta-pelanggan-amp-topologi-jaringan/hubungan-induk-anak/sediakan-tutup-buka-panel-tanpa-muat-ulang`  
**Fitur**: Hubungan Induk–Anak (Peta Pelanggan & Topologi Jaringan)  
**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI (VERIFIED)  

---

## 1. Analisis Kebutuhan & Akar Masalah
Pada aplikasi peta berbasis Leaflet, perubahan tata letak antarmuka pengguna (seperti menutup atau membuka panel pohon di sisi kiri) dapat menimbulkan masalah kinerja dan visual:
1. **Unmount/Remount Flicker**: Jika kontainer peta Leaflet diletakkan di dalam cabang kondisional yang di-remount, seluruh DOM Leaflet hancur dan diinisialisasi ulang dari nol. Hal ini menyebabkan layar berkedip putih, koneksi tile terputus, dan koordinat tengah/zoom kembali ke posisi default.
2. **Sindrom Ubin Abu-Abu (Grey Tiles Artifact)**: Leaflet menghitung ukuran kanvas berdasarkan dimensi piksel kontainer saat pertama kali dirender. Ketika panel ditutup dan kanvas peta melebar dari 65% ke 100%, area yang baru terbuka akan menjadi ubin abu-abu kosong jika Leaflet tidak memicu `map.invalidateSize()`.
3. **Persistensi State Tanpa Muat Ulang**: Tindakan buka/tutup panel pohon maupun panel detail simpul harus murni mengubah state React lokal tanpa memicu request HTTP ulang (`fetch`), tanpa me-reload halaman, dan tanpa merusak posisi kamera peta saat ini.

---

## 2. Rincian Implementasi Teknis

### A. Persistensi Struktur DOM `src/components/map/hierarchy-map-board.tsx`
- Komponen `<NetworkMapLeafletLoader />` diletakkan di dalam kontainer `<div className="flex-1 relative w-full h-full ...">` yang **tidak pernah di-unmount** saat `isTreeOpen` bernilai `true` atau `false`:
  ```tsx
  <div className="relative flex flex-col md:flex-row w-full gap-3 h-[calc(100vh-210px)] min-h-[580px]">
    {/* Panel Kiri: Hanya dirender saat isTreeOpen = true */}
    {isTreeOpen && (
      <Card className="w-full md:w-84 lg:w-96 shrink-0 ..." data-testid="hierarchy-tree-panel">
        ...
      </Card>
    )}

    {/* Panel Kanan: Selalu persisten di DOM */}
    <div className="flex-1 relative w-full h-full rounded-xl overflow-hidden border shadow-sm">
      <NetworkMapLeafletLoader
        data={mapCompatibleData}
        initialFocusId={initialFocusId ?? undefined}
        focusedNodeId={selectedNode?.id}
        onSelectCustomer={handleSelectCustomer}
        onSelectInfrastructure={handleSelectInfra}
        className="h-full w-full"
      />
    </div>
  </div>
  ```

### B. Adaptasi Geometri Kanvas Real-Time `src/components/map/network-map.tsx`
1. **Pemasangan `mapContainerRef` pada Kontainer Leaflet**:
   - Kontainer Leaflet dipantau secara presisi menggunakan `ResizeObserver`:
     ```tsx
     <div className="w-full h-full relative" ref={mapContainerRef}>
       <MapContainer ... ref={setMap}>
     ```
2. **Pemanggilan Otomatis `map.invalidateSize({ pan: false })`**:
   - Saat panel pohon dibuka atau ditutup, `ResizeObserver` mendeteksi perubahan lebar kanvas secara instan dan memanggil `invalidateSize({ pan: false })`, menjaga tile tetap penuh tanpa flicker dan tanpa menggeser pusat pandang peta.
3. **Penutupan Panel Detail Simpul**:
   - Tombol penutup pada `selected-hierarchy-node-panel` menyetel `setSelectedNode(null)` secara lokal tanpa mengganggu layer peta maupun memicu re-render eksternal.

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
$ npx eslint src/components/map/network-map.tsx src/components/map/hierarchy-map-board.tsx
(Exit Code 0, clean)
```
*Hasil*: 0 Error, 0 Warning.

### C. Pengujian Unit Test (`node --test tests/toggle-panel-without-reload.test.mjs`)
```
▶ Task: Sediakan Tutup Buka Panel Tanpa Muat Ulang (No Remount / No Reload)
  ✔ 1. Persistensi Elemen Peta di DOM: Kanvas Peta Tidak Pernah Ter-unmount (0.5731ms)
  ✔ 2. Buka-Tutup Panel Hanya Mengubah State Lokal (Tanpa Trigger Fetch atau Reload) (0.1673ms)
  ✔ 3. Adaptasi Ukuran Kanvas Leaflet Real-time (ResizeObserver & InvalidateSize) (0.1783ms)
  ✔ 4. Penutupan Panel Detail Simpul Tanpa Mereset Peta (0.1222ms)
  ✔ 5. Geometri Peta Terjaga saat Item Detail Dibuka/Ditutup (0.1182ms)
✔ Task: Sediakan Tutup Buka Panel Tanpa Muat Ulang (No Remount / No Reload) (3.2809ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
```
*Hasil*: 100% lulus (6/6 subtests).

### D. Uji Regresi Topologi Menyeluruh (34 Subtests)
```
$ node --test tests/toggle-panel-without-reload.test.mjs tests/highlight-map-node-from-tree.test.mjs tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs
ℹ tests 34
ℹ pass 34
ℹ fail 0
ℹ duration_ms 127.6179
```
*Hasil*: 100% lulus tanpa kegagalan.
