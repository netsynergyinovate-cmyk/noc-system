# Laporan Hasil Pengerjaan: Optimalkan Render Ribuan Jalur Kabel di Peta

## 1. Ringkasan Eksekusi
- **Task ID**: `1ea8e241-3130-4918-9254-d5f2f2cd4291`
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/penyempurnaan-tampilan-peta/optimalkan-render-ribuan-jalur-kabel-di-peta`
- **Fase**: Fase 5 / Penyempurnaan Tampilan Peta
- **Status**: SELESAI (Completed)

---

## 2. Latar Belakang & Akar Masalah (Root Cause)
Pada peta topologi jaringan skala riil ISP:
1. Jalur kabel optik mencakup koneksi backbone (Router ➔ OLT ➔ ODC), distribusi feeder (ODC ➔ ODP), dan ribuan kabel drop pelanggan (ODP ➔ Pelanggan).
2. Jika ribuan kabel optik dipaksa di-render sekaligus tanpa penyaringan spasial, DOM browser memuat puluhan ribu node SVG path dan Leaflet event listeners, mengakibatkan *stuttering* parah hingga *memory crash* pada peramban klien.
3. Pada level zoom jauh (skala kota/kecamatan), kabel drop tipis (2-core) saling menumpuk menjadi benang kusut yang tidak terbaca dan membebani rendering kurva algoritma Leaflet tanpa nilai informasi praktis.

---

## 3. Implementasi Teknis & Solusi Rekayasa
1. **Spatial Bounding Box Culling (`isCableInViewport`)**:
   - Menghitung koordinat batas (*bounding box*) dari setiap jalur kabel: `L.latLngBounds([minLat, minLng], [maxLat, maxLng])`.
   - Menerapkan buffer pandang 15% (`viewportBounds.pad(0.15)`) untuk mencegah jeda visual saat peta digeser.
   - Menggunakan evaluasi persilangan matematis Leaflet: `paddedBounds.intersects(cableBounds)`. Kabel yang berada di luar layar tidak diproses ke dalam DOM.
2. **Level-of-Detail (LOD) Adaptif Zoom**:
   - Pada zoom rendah (`currentZoom < 13`): kabel drop pelanggan disembunyikan secara cerdas, menyisakan jalur tulang punggung (backbone dan feeder) agar arsitektur jaringan makro tetap bersih dan terbaca.
   - Pada zoom tinggi (`currentZoom >= 13`): kabel drop pelanggan diaktifkan otomatis hanya untuk area yang sedang diamati.
3. **Pengecualian Proteksi Jalur Terpilih (`isHighlighted`)**:
   - Jika operator memilih pelanggan atau perangkat tertentu dari diagram hierarki atau pencarian, kabel yang menghubungkan titik tersebut **selalu dirender** tanpa terpengaruh batas layar maupun LOD.
4. **Dynamic Douglas-Peucker `smoothFactor`**:
   - `currentZoom >= 16`: `smoothFactor = 0.25` (ketajaman vektor kurva jalan maksimal).
   - `currentZoom >= 13`: `smoothFactor = 1.0` (keseimbangan kurva dan performa).
   - `currentZoom < 13`: `smoothFactor = 2.0` (penyederhanaan titik segmen polilin untuk frame-rate tinggi).
5. **Indikator Telemetri & Kontrol Interaktif**:
   - Indikator `data-testid="cable-render-indicator"` pada bar atas: menampilkan rasio kabel aktif (misal: *Kabel: 14/128 jalur*).
   - Saklar `data-testid="toggle-cable-optimization"` pada menu hamparan: memungkinkan operator menyalakan/mematikan optimasi sesuai kebutuhan.

---

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)
1. **Unit Testing (`tests/cable-render-optimization.test.mjs`)**:
   - 6/6 test lulus 100%:
     - `isCableInViewport` dengan buffer 15% & `intersects(cableBounds)`.
     - LOD penyederhanaan kabel drop pada `zoom < 13`.
     - Proteksi kabel terpilih `isHighlighted`.
     - Dynamic `smoothFactor` (0.25, 1.0, 2.0).
     - Memoization `visibleCableRoutes` dan rendering ke MapContainer.
     - Toggle switch & indikator telemetri UI.
2. **Pengujian Regresi Peta Lengkap**:
   - 36/36 unit tests map suite lulus 100% (durasi: 182.6 ms).
3. **Pemeriksaan Linter & Tipe**:
   - `npx eslint src/components/map/network-map.tsx`: 0 error, 0 warning.
   - `npm run typecheck`: 0 TypeScript error, Types generated successfully.
4. **Produksi Build Next.js**:
   - `npm run build`: Kompilasi sukses, 136/136 static & dynamic pages generated.
