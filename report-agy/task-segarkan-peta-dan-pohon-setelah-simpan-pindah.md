# Laporan Rekayasa: Segarkan Peta dan Pohon Setelah Simpan Pindah

## 1. Ringkasan Eksekusi
- **Task ID**: `peta-pelanggan-amp-topologi-jaringan/hubungan-induk-anak/segarkan-peta-dan-pohon-setelah-simpan-pindah`
- **Fitur / Modul**: `Hubungan Induk–Anak` (Topology Map & Hierarchy Tree)
- **Status**: **DONE** (Lolos seluruh gerbang verifikasi mandiri)

## 2. Masalah yang Diselesaikan
Sebelumnya saat dilakukan pemindahan simpul induk (reassign parent) melalui kontrol dialog, perubahan data di database memerlukan muat ulang halaman secara manual agar cabang pohon relasi dan jalur garis kabel pada kanvas Leaflet berpindah ke induk yang baru. Pengguna memerlukan penyegaran langsung (optimistic update in-memory) yang mulus, cabang induk baru otomatis terbuka (auto-expanded), kabel topologi langsung terhubung ke simpul induk baru, dan data backend tersinkronisasi tanpa me-reload browser.

## 3. Rincian Implementasi & Perubahan Teknis
1. **Optimistic Hierarchy Mutation (In-Memory Tree)**:
   - File: `src/components/map/hierarchy-map-board.tsx`
   - Logika mutasi mencakup 3 skenario hierarki:
     - **Pelanggan (Tier 4 -> ODP)**: Melepaskan pelanggan dari ODP lama dan memasukkannya ke dalam daftar pelanggan ODP target (`newParent.customers`), serta memperbarui `customer.odpName`.
     - **ODP (Tier 3 -> ODC/Core Direct)**: Memindahkan simpul ODP dari cabang lama dan mendaftarkannya ke array `children` ODC target atau langsung di bawah Root Router/Server, memperbarui `parentName` dan silsilah lineage.
     - **ODC (Tier 2 -> Core Server/OLT)**: Memindahkan ODC antar Core Server/OLT dengan pembaruan `parentName` instan.
2. **Auto-Expand New Parent Branch**:
   - Cabang simpul induk baru (`selectedOption.id`) langsung dimasukkan ke dalam Set `expandedNodes` (`setExpandedNodes(prev => new Set([...prev, selectedOption.id]))`) sehingga simpul anak yang baru dipindahkan langsung tampak di pohon relasi.
3. **Re-calculation of Cable Routes (Leaflet Topology)**:
   - State `mapCompatibleData` yang diperbarui secara reaktif mengevaluasi kembali `cableRoutes` pada layer `NetworkMap`, seketika mengalihkan garis kabel polyline ke koordinat GPS induk baru tanpa kedip.
4. **Trigger Penyegaran Asinkron Backend**:
   - Fungsi `refreshData()` dipanggil di background untuk memastikan state lokal identik 100% dengan snapshot database PostgreSQL.
5. **Indikator Status Sinkronisasi UI**:
   - Elemen `data-testid="reassign-sync-indicator"` memberikan umpan balik visual bahwa pohon dan peta berhasil disinkronkan.

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)
1. **Unit Test Spesifik**:
   - Command: `node --test tests/sync-tree-and-map-after-reassign.test.mjs`
   - Hasil: 6/6 subtests PASS (0 failures).
2. **Uji Regresi Menyeluruh (8 Test Suites Topologi)**:
   - Command: `node --test tests/sync-tree-and-map-after-reassign.test.mjs tests/reassign-hierarchy-parent.test.mjs tests/toggle-panel-without-reload.test.mjs tests/highlight-map-node-from-tree.test.mjs tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs`
   - Hasil: 46/46 subtests PASS (0 failures, duration 210ms).
3. **TypeScript Typecheck**:
   - Command: `npm run typecheck`
   - Hasil: Exit code 0, Types generated successfully, 0 error.
4. **ESLint Static Analysis**:
   - Command: `npx eslint src/components/map/hierarchy-map-board.tsx src/services/network-hierarchy.service.ts src/validators/hierarchy-reassign.ts src/app/api/map/hierarchy/reassign/route.ts`
   - Hasil: Exit code 0, 0 errors, 0 warnings.
