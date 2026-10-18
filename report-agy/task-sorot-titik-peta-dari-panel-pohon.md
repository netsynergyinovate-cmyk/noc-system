# Laporan Rekayasa Teknis: Sorot Titik Peta dari Panel Pohon

**ID Task**: `peta-pelanggan-amp-topologi-jaringan/hubungan-induk-anak/sorot-titik-peta-dari-panel-pohon`  
**Fitur**: Hubungan Induk–Anak (Peta Pelanggan & Topologi Jaringan)  
**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI (VERIFIED)  

---

## 1. Analisis Kebutuhan & Akar Masalah
Saat operator berinteraksi dengan pohon relasi (Hierarchy Tree Explorer):
1. **Navigasi Spasial Langsung (Camera FlyTo)**: Mengklik simpul pada pohon (baik Tingkat 1 Server/Core, Tingkat 2 ODC, Tingkat 3 ODP, maupun Tingkat 4 Pelanggan) harus segera memusatkan kamera peta Leaflet (`map.flyTo`) ke koordinat GPS simpul tersebut pada level zoom operasional (`zoom >= 17`).
2. **Efek Penyorotan Visual Terbaca Jelas (Visual Highlight Rings)**: Titik perangkat atau pelanggan di atas peta satelit sering kali sulit ditemukan tanpa tanda sorotan. Titik yang dipilih wajib menampilkan cincin halo neon berdenyut (*pulsing halo ring* `#22d3ee` + cincin aksen radar `#06b6d4`) dengan penanda `data-highlighted="true"`.
3. **Kepatuhan React Lifecycle & Defensive Coding**: Pembaruan state seleksi yang dipicu oleh perubahan prop `focusedNodeId` harus dibungkus dalam non-blocking task timer guna mematuhi aturan `react-hooks/set-state-in-effect` dan mencegah *cascading re-renders*.

---

## 2. Rincian Implementasi Teknis

### A. Komponen Peta Leaflet `src/components/map/network-map.tsx`
1. **Interface & Destructuring `focusedNodeId`**:
   - Menambahkan `focusedNodeId?: string | null` pada `NetworkMapProps`.
2. **Sinkronisasi Kamera & Seleksi Dinamis**:
   - Mendengarkan perubahan `focusedNodeId` dan mencari target di `data.infrastructure` maupun `data.customers`:
     ```tsx
     useEffect(() => {
       if (!focusedNodeId || !data) return;

       // 1. Cek pada simpul infrastruktur (Server, ODC, ODP)
       const targetInfra = data.infrastructure?.find((inf) => inf.id === focusedNodeId);
       if (targetInfra) {
         const timer = setTimeout(() => {
           setSelectedInfra(targetInfra);
           setSelectedCustomer(null);
           if (map && Number.isFinite(targetInfra.latitude) && Number.isFinite(targetInfra.longitude)) {
             map.flyTo([targetInfra.latitude, targetInfra.longitude], Math.max(map.getZoom(), 17), {
               duration: 0.8,
             });
           }
         }, 0);
         return () => clearTimeout(timer);
       }

       // 2. Cek pada simpul pelanggan akhir
       const targetCust = data.customers?.find(
         (c) => c.id === focusedNodeId || c.pppoeUsername === focusedNodeId,
       );
       if (targetCust) {
         const timer = setTimeout(() => {
           setSelectedCustomer(targetCust);
           setSelectedInfra(null);
           if (map && targetCust.latitude !== null && targetCust.longitude !== null) {
             map.flyTo([targetCust.latitude, targetCust.longitude], Math.max(map.getZoom(), 17), {
               duration: 0.8,
             });
           }
         }, 0);
         return () => clearTimeout(timer);
       }
     }, [data, focusedNodeId, map]);
     ```
3. **Penyematan Efek Visual Sorotan Neon (Highlight Halo & Radar Ring)**:
   - Pada marker infrastruktur:
     ```tsx
     const isHighlighted = selectedInfra?.id === infra.id || focusedNodeId === infra.id;
     // Di-render dengan data-highlighted="true", CircleMarker neon pulsasi radius +12px & +6px
     ```
   - Pada marker pelanggan:
     ```tsx
     const isCustHighlighted = selectedCustomer?.id === cust.id || focusedNodeId === cust.id;
     // Di-render dengan data-highlighted="true", CircleMarker neon pulsasi radius 16px & 10px
     ```

### B. Komponen Papan Hierarki `src/components/map/hierarchy-map-board.tsx`
1. **Propagasi Prop ke Leaflet Loader**:
   - Meneruskan `focusedNodeId={selectedNode?.id}` ke `<NetworkMapLeafletLoader />`.
2. **Event Klik Simpul Pohon di Seluruh 4 Tingkatan**:
   - **Tingkat 1 (Core Server/OLT)**: Memanggil `handleSelectInfra` dengan detail data root, membuka cabang jika belum terbuka.
   - **Tingkat 2 (ODC)**: Memanggil `handleSelectInfra` dengan relasi `parentId` ke root server.
   - **Tingkat 3 (ODP & Direct ODP)**: Memanggil `handleSelectInfra` dengan relasi `parentId` ke ODC atau Core server.
   - **Tingkat 4 (Pelanggan)**: Memanggil `handleSelectCustomer` dengan username PPPoE dan data optik dBm.
   - Memisahkan klik toggle chevron dari klik baris simpul (`e.stopPropagation()`).

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

### C. Pengujian Unit Test (`node --test tests/highlight-map-node-from-tree.test.mjs`)
```
▶ Fitur Penyorotan Titik Peta dari Panel Pohon Relasi
  ✔ 1. Deklarasi Interface NetworkMapProps: focusedNodeId (0.7595ms)
  ✔ 2. Navigasi Kamera Peta (flyTo) Otomatis Berdasarkan focusedNodeId (0.4347ms)
  ✔ 3. Efek Visual Penyorotan Simpul Infrastruktur (Highlight Halo Rings) (0.4265ms)
  ✔ 4. Efek Visual Penyorotan Simpul Pelanggan (Highlight Halo Rings) (0.3088ms)
  ✔ 5. Integrasi HierarchyMapBoard: Meneruskan focusedNodeId ke NetworkMapLeafletLoader (0.1359ms)
  ✔ 6. Integrasi Panel Pohon Relasi: Seluruh Tingkatan Memilih & Menyorot Simpul (0.2809ms)
✔ Fitur Penyorotan Titik Peta dari Panel Pohon Relasi (5.2177ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```
*Hasil*: 100% lulus (7/7 subtests).

### D. Uji Regresi Topologi Menyeluruh (28 Subtests)
```
$ node --test tests/highlight-map-node-from-tree.test.mjs tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs
ℹ tests 28
ℹ pass 28
ℹ fail 0
ℹ duration_ms 120.7575
```
*Hasil*: 100% lulus tanpa kegagalan.
