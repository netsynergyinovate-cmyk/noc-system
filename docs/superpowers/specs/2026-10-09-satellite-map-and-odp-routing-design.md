# Spesifikasi Desain: Upgrade Peta Satelit Profesional, GPS Teknisi, & Rute Kabel ODP Mengikuti Jalan

## 1. Ringkasan (Executive Summary)

Fitur ini meng-upgrade komponen peta sebaran NOC (`CustomerMap`) agar memiliki tampilan satelit profesional (Google Maps Satellite Hybrid tanpa memerlukan API key berbayar), dilengkapi fitur GPS Geolocation untuk teknisi di lapangan, visualisasi titik ODP (Optical Distribution Point), serta jalur kabel drop fiber optic dari ODP ke pelanggan PPPoE yang mengikuti kontur jaringan jalan (road-following routing via OSRM) secara otomatis dan berkinerja tinggi.

---

## 2. Latar Belakang & Masalah

* **Tampilan Peta Standar**: Peta sebelumnya hanya menampilkan OpenStreetMap standar (2D peta jalan) yang kurang detail untuk melihat atap rumah pelanggan dan kondisi lapangan teknisi.
* **Tidak Ada Visualisasi ODP & Jalur Kabel**: Pelanggan memiliki atribut `odpName`, tetapi kotak ODP tidak memiliki penanda visual di peta, dan jalur kabel belum divisualisasikan.
* **Kebutuhan Rute Mengikuti Jalan**: Jalur kabel drop optic dari tiang/kotak ODP ke rumah pelanggan di dunia nyata dipasang menyusuri tiang di sepanjang jalan/gang, bukan ditarik garis lurus menembus bangunan.
* **Kebutuhan GPS Lapangan**: Teknisi NOC yang berada di lapangan memerlukan tombol cepat untuk mengetahui posisinya saat ini relatif terhadap ODP dan pelanggan terdekat.

---

## 3. Arsitektur & Komponen

### 3.1. Tile Layer Satelit Google Hybrid & Layer Switcher
* **Tile URL**: `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}`
  * Tipe: Google Satellite Hybrid (citra satelit resolusi tinggi + overlay nama jalan, gang, dan batas wilayah).
  * 100% Gratis & tanpa API key / kuota berbayar.
  * Max Zoom: Level 20 untuk melihat detail tiang dan atap rumah.
* **Layer Switcher**:
  * Pengguna dapat mengganti tampilan antara **Satelit Google** dan **Peta Jalan Standar (OSM)** melalui tombol toggle di pojok kanan atas/bawah peta.

### 3.2. Fitur GPS Geolocation (Lokasi Teknisi)
* **Kontrol**: Tombol "Lokasi Saya" di pojok kontrol peta dengan ikon navigasi/GPS.
* **Mekanisme**:
  * Memanggil `navigator.geolocation.getCurrentPosition` atau `map.locate()`.
  * Saat posisi didapatkan, peta melakukan animasi `flyTo` ke lokasi teknisi dengan zoom detail (misal zoom 17).
  * Menampilkan titik biru berpendar (*pulsing blue dot*) dan lingkaran akurasi radius GPS.
  * Penanganan error: Jika izin GPS ditolak atau perangkat tidak mendukung, sistem menampilkan pesan toast/status singkat tanpa mengganggu fungsi peta.

### 3.3. Penempatan & Visualisasi ODP
* **Sumber Data**:
  * Menggunakan pemetaan ODP yang ada di sistem (di mock data: 12 ODP di sekeliling area pusat jaringan; di live data: koordinat ODP terkait).
* **Marker ODP**:
  * Marker berbentuk kotak distribusi / icon fiber optic dengan warna pembeda (cyan / biru toska).
  * Tooltip/Popup menampilkan nama ODP (contoh: `ODP-CHP-01`), koordinat, dan jumlah pelanggan yang terhubung.

### 3.4. Rute Kabel Drop Optik (Road-Following via OSRM)
* **Pemicu (On-Demand)**:
  * Rute digambar saat salah satu pelanggan disorot/dipilih (`focused customer`, baik melalui klik marker pelanggan di peta, daftar tabel, atau URL `?focus=...`).
* **Routing Engine (OSRM)**:
  * Menggunakan endpoint publik OSRM Foot/Pedestrian:
    `https://router.project-osrm.org/route/v1/foot/{odp_lng},{odp_lat};{cust_lng},{cust_lat}?overview=full&geometries=geojson`
  * Profil *foot* sangat tepat untuk kabel tiang/fiber drop karena dapat melewati gang-gang kecil pemukiman yang tidak bisa dilalui mobil.
* **Caching & Ketahanan Jaringan**:
  * Modul `src/lib/dashboard/routing.ts` menyimpan riwayat rute yang pernah di-fetch ke dalam cache memori browser (Map).
  * **Fallback**: Jika request OSRM gagal, timeout (>3 detik), atau offline, sistem otomatis beralih ke polyline garis lurus (straight line) sehingga peta tidak pernah rusak atau macet.
* **Styling Kabel & Informasi**:
  * Polyline kabel digambar dengan gaya drop cable fiber optic (garis cyan tebal bercahaya dengan border kontras).
  * Menampilkan informasi jarak kabel jalan (contoh: `Jarak kabel: 135 m ke ODP-CHP-01`) pada banner sorotan info pelanggan.

---

## 4. Struktur File & Modifikasi Kode

1. `src/lib/dashboard/odp.ts` (File baru):
   * Menyediakan fungsi komputasi koordinat ODP (`getOdpCoordinates`), daftar ODP aktif, dan pemetaan pelanggan ke ODP.
2. `src/lib/dashboard/routing.ts` (File baru):
   * Fungsi `fetchRoadRoute(fromLat, fromLng, toLat, toLng)` dengan OSRM API, caching in-memory, kalkulasi estimasi jarak jalan, dan fallback garis lurus.
3. `src/components/dashboard/customer-map.tsx` (Update):
   * Integrasi Google Hybrid tile layer + fallback OSM.
   * Kontrol tombol GPS & marker posisi teknisi.
   * Render marker ODP beserta tooltip nama & jumlah pelanggan.
   * Render polyline rute kabel jalan saat pelanggan disorot.
   * Banner sorotan yang diperkaya dengan informasi jarak kabel ke ODP.
   * Menjaga 100% selektor `data-testid="customer-map"`, `data-zoom`, `leaflet-tooltip-top`, `billing-badge`, dan `customer-odp` agar tidak merusak e2e tests.
4. `e2e/customer-map-upgrade.spec.ts` (File uji baru):
   * Pengujian Playwright untuk tile switcher, ODP markers, rute kabel jalan saat sorot, dan tombol GPS.

---

## 5. Rencana Penanganan Error & Batasan

* **OSRM Public API Rate Limit**: Caching in-memory mencegah pemanggilan berulang; fallback garis lurus memastikan pengguna tetap melihat jalur koneksi jika API publik lambat.
* **Performa Rendering**: Marker pelanggan tetap digambar di Canvas (`preferCanvas`), sedangkan polyline rute hanya dibuat 1 buah pada pelanggan yang sedang aktif/disorot (on-demand), menjaga framerate tetap 60 FPS bahkan dengan ratusan pelanggan.
* **Aksesibilitas & Tema**: Seluruh kontrol dan marker tetap memiliki kontras tinggi yang terbaca jelas baik pada tema terang maupun gelap.
