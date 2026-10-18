# Laporan Hasil Pengerjaan: Cegah Panel Menutupi Titik yang Dipilih

## 1. Ringkasan Eksekusi
- **Task ID**: `c1d3d68a-28d2-4138-9b0c-bfbb46f0ec0b`
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/penyempurnaan-tampilan-peta/cegah-panel-menutupi-titik-yang-dipilih`
- **Fase**: Fase 5 / Penyempurnaan Tampilan Peta
- **Status**: SELESAI (Completed)

---

## 2. Latar Belakang & Akar Masalah (Root Cause)
1. Ketika pengguna memilih sebuah marker pelanggan atau perangkat infrastruktur pada peta, perintah bawaan `map.flyTo([lat, lng])` memusatkan titik target persis di titik tengah geometri kanvas `(width/2, height/2)`.
2. Pada resolusi laptop standar (misal 1366x768), tablet, atau mobile, panel detail mengambang (`CustomerDetailPanel` / `DeviceDetailPanel`) yang terletak di pojok kanan bawah (`bottom-4 right-4`, lebar 352px) sering kali menutupi titik marker target atau lingkaran efek sorot (*halo ring*) di sekitarnya.
3. Hal ini mengakibatkan operator tidak dapat melihat posisi fisik titik maupun jalur kabel drop/feeder yang tersambung saat panel sedang terbuka.

---

## 3. Implementasi Teknis & Solusi Rekayasa
1. **Modul Offset Spasial Kamera (`src/lib/map-viewport-offset.ts`)**:
   - Menerapkan kalkulasi proyeksi matematis Leaflet (`map.project` dan `map.unproject`) secara deterministik dan aman SSR (*pure TypeScript* tanpa ketergantungan runtime window/Leaflet global).
   - Menghitung kompensasi piksel adaptif resolusi peramban via `getPanelClearanceOffset(viewportWidth)`:
     - **Desktop ($\ge 1024$ px)**: `offsetX = -150`, `offsetY = -50` (menggeser kamera sehingga titik berada di area tengah-kiri bebas rintangan).
     - **Tablet ($768$ - $1023$ px)**: `offsetX = -110`, `offsetY = -70`.
     - **Mobile ($< 768$ px)**: `offsetX = 0`, `offsetY = -130` (menggeser titik ke separuh atas layar karena panel detail menutupi area bawah penuh).
2. **Fungsi Navigasi Kamera Bebas Rintangan (`flyToWithoutOcclusion`)**:
   - Memproyeksikan `[lat, lng]` ke titik piksel layar, mengurangkan offset panel, lalu mengembalikan koordinat geografis LatLng baru untuk `map.flyTo`.
3. **Penyambungan Interaksi Titik**:
   - `handleSelectCustomer`: otomatis menggeser fokus kamera saat marker pelanggan diklik.
   - `handleSelectInfra`: otomatis menggeser fokus kamera saat marker perangkat diklik.
   - Tombol "Fokus" di dalam `MapDetailInspectorLayer` (`handleFocus`) menggunakan `flyToWithoutOcclusion`.
   - Navigasi `initialFocusId` dan `focusedNodeId` dari pohon hierarki jaringan.

---

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)
1. **Unit Testing (`tests/prevent-panel-occlusion.test.mjs`)**:
   - 5/5 test lulus 100%:
     - `getPanelClearanceOffset` menghitung offset piksel adaptif mobile, tablet, dan desktop.
     - `calculatePanelClearanceLatLng` & `flyToWithoutOcclusion` memproyeksikan koordinat bebas rintangan.
     - `network-map.tsx` menerapkan `flyToWithoutOcclusion` pada seleksi titik.
     - `map-detail-inspector-layer.tsx` menerapkan `flyToWithoutOcclusion` pada tombol fokus.
2. **Pengujian Regresi Seluruh Suite Peta**:
   - 52/52 unit tests lulus 100% (durasi: 221.4 ms).
3. **Pemeriksaan Linter & Tipe**:
   - `npx eslint`: 0 error, 0 warning.
   - `npm run typecheck`: 0 TypeScript error, Types generated successfully.
4. **Produksi Build Next.js**:
   - `npm run build`: Kompilasi sukses, 136/136 static & dynamic pages generated.
