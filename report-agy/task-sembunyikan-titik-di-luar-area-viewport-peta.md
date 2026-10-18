# Laporan Hasil Pengerjaan: Sembunyikan Titik di Luar Area Viewport Peta

## 1. Ringkasan Eksekusi
- **Task ID**: `2ba50faa-d091-4cef-b9e1-d306569229e6`
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/penyempurnaan-tampilan-peta/sembunyikan-titik-di-luar-area-viewport-peta`
- **Fase**: Fase 5 / Penyempurnaan Tampilan Peta
- **Status**: SELESAI (Completed)

---

## 2. Latar Belakang & Akar Masalah (Root Cause)
Peta operasional NOC memuat ratusan hingga ribuan titik (Core Router, OLT, ODC, ODP, tiang fiber, dan titik instalasi pelanggan FTTH).
Ketika seluruh penanda (marker) dirender bersamaan pada kanvas Leaflet DOM:
1. Beban rendering SVG / HTML DOM melonjak drastis, menyebabkan *jank* (penurunan frame rate) saat melakukan geser (pan) atau pembesaran (zoom).
2. Titik-titik yang berada jauh di luar koordinat pandang layar pengguna tetap dihitung dan disuntikkan ke dalam pohon DOM.
3. Solusi spatial culling murni tanpa buffer margin menyebabkan titik di tepian layar berkedip (*pop-in/pop-out*) yang mengganggu operator lapangan.

---

## 3. Implementasi Teknis & Solusi Rekayasa
1. **Pelacak Viewport (`MapViewportTracker`)**:
   - Ditempatkan di dalam `<MapContainer>`.
   - Menggunakan hook `useMapEvents` dari `react-leaflet` untuk menangkap event `moveend` dan `zoomend`.
   - Memperbarui state batas koordinat `viewportBounds: L.LatLngBounds | null` dan `currentZoom: number` secara reaktif dan hemat render.
2. **Algoritma Spatial Culling Defensif (`isPointInViewport`)**:
   - Menerapkan margin buffer 15% melalui `viewportBounds.pad(0.15)`. Hal ini menjamin penanda di batas layar telah dimuat sebelum pengguna menggeser peta ke arah tersebut.
   - **Pengecualian Proteksi Titik Terpilih (`isHighlighted`)**: Titik infrastruktur atau pelanggan yang sedang dipilih oleh operator dari panel hierarki pohon atau hasil pencarian **wajib selalu dirender**, meskipun berada di luar batas layar agar jalur relasi/kabel tidak terputus secara visual.
3. **Penyaringan Reaktif (`useMemo`)**:
   - `visibleInfrastructure`: Menyaring daftar perangkat fisik menggunakan `isPointInViewport`.
   - `visibleCustomers`: Menyaring daftar pelanggan berkoordinat GPS menggunakan `isPointInViewport`.
   - Kompatibel dengan aturan React Compiler (`react-hooks/preserve-manual-memoization`).
4. **Loop Rendering Marker Terkoreksi**:
   - Menggantikan `data?.infrastructure.map(...)` dengan `visibleInfrastructure.map(...)`.
   - Menggantikan `geocodedList.map(...)` dengan `visibleCustomers.map(...)`.
5. **Indikator Telemetri & Kontrol Interaktif**:
   - Indikator `data-testid="viewport-culling-indicator"` pada bar kontrol mengambang: menampilkan rasio titik yang sedang aktif dirender terhadap total titik jaringan (misal: *Viewport: 42/128 titik*).
   - Saklar kontrol `data-testid="toggle-viewport-culling"` pada dropdown menu Lapis Hamparan (Overlays Card): memungkinkan operator menonaktifkan culling jika ingin melihat sebaran penuh.

---

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)
1. **Unit Testing (`tests/viewport-culling-map.test.mjs`)**:
   - 6/6 test lulus 100%:
     - `MapViewportTracker` melacak `moveend` dan `zoomend`.
     - `isPointInViewport` menerapkan buffer 15% (`pad(0.15)`).
     - Proteksi `isHighlighted` mempertahankan titik terpilih.
     - Array `visibleInfrastructure` dan `visibleCustomers` menyaring titik secara presisi.
     - Loop marker MapContainer menggunakan array tersaring.
     - Indikator dan switch toggle hadir dengan atribut `data-testid`.
2. **Pengujian Regresi Peta Lengkap**:
   - 30/30 unit tests map suite lulus 100% (durasi: 186.5 ms).
3. **Pemeriksaan Linter & Tipe**:
   - `npx eslint src/components/map/network-map.tsx`: 0 error, 0 warning.
   - `npm run typecheck`: 0 TypeScript error, Types generated successfully.
4. **Produksi Build Next.js**:
   - `npm run build`: Kompilasi sukses, 136/136 static & dynamic pages generated.
