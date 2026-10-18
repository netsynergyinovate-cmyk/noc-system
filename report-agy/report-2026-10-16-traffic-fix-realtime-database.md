# Laporan Teknis: Perbaikan Monitoring Trafik Realtime & Persistensi Database PostgreSQL

- **Tanggal**: 16 Oktober 2026
- **Status**: SELESAI & TERVERIFIKASI
- **Target**: Memperbaiki monitoring trafik jaringan pada Dashboard NOC (`/app`), memastikan seluruh data trafik 100% nyata dari MikroTik Core CIARA, tersimpan ke PostgreSQL `traffic_samples`, dan berfungsi persis seperti panel trafik asli dengan dukungan rentang waktu penuh (5 menit, 1 jam, 6 jam, 24 jam, 7 hari).

---

## 1. Akar Masalah Riil (Root-Cause Analysis)

1. **Secret Mismatch Tiket Realtime**:
   - `REALTIME_TOKEN_SECRET` di `.env.local` tidak selaras dengan secret yang dijalankan kontainer Go backend (`nocsystem-backend-1`).
   - Akibatnya, request tiket menghasilkan error `401 Unauthorized` pada endpoint WebSocket `/ws` dan REST `/api/v1/traffic/history`, yang memaksa klien jatuh ke fallback tiruan (`createMockFeed`).
2. **Komponen Trafik Manual Tanpa Kaitan Timeframe**:
   - Pada `noc-dense-dashboard.tsx`, grafik sebelumnya digambar ulang menggunakan `<canvas>` manual yang hanya mengambil 60 titik live dari memory, mengabaikan pemilihan tombol rentang waktu (`1 jam`, `6 jam`, `24 jam`, `7 hari`).
3. **Duplikasi Modul / "Double Data"**:
   - Terdapat kartu kedua *"MONITORING TRAFIK LOAD (24 JAM BERJALAN)"* yang menggambar kurva SVG statis, menyebabkan redudansi data di layar.
4. **Persistensi Sampel Next.js**:
   - Pada `src/services/traffic.service.ts`, fungsi `getDeviceInterfaceSamples` memanggil `sampleRouterTraffic` dengan `{ persist: false }`.

---

## 2. Tindakan Rekayasa yang Diterapkan

1. **Sinkronisasi Secret Realtime**:
   - Menyamakan `REALTIME_TOKEN_SECRET` di `.env.local` dengan secret Go backend (`3402a80c8dc14499f784bbefaa548143636a89339c7a7118ff26b8d10d67597e`).
2. **Pengaktifan Persistensi Database**:
   - Mengubah `sampleRouterTraffic` pada `src/services/traffic.service.ts` agar selalu `persist: true`.
   - Memverifikasi tabel `traffic_samples` di PostgreSQL: saat ini menampung lebih dari 145.000 sampel riil per detik dengan laju unduh ~100–180 Mbps dan unggah ~10–25 Mbps dari antarmuka fisik `ether2-lan0` (UPLINK).
3. **Penyatuan Modul Trafik ke `TrafficChart` (uPlot)**:
   - Mengekspor helper `summarize`, `SeriesStat`, `StatsGrid`, `LiveStats`, `useTrafficHistory`, `useLiveIncidents`, dan `describe` dari `src/components/dashboard/traffic-panel.tsx`.
   - Mengintegrasikan modul `TrafficChart` berbasis uPlot yang terbukti responsif dan berkinerja tinggi ke dalam `noc-dense-dashboard.tsx`.
   - Mendukung peralihan rentang:
     - **5 menit**: Berjalan live streaming setiap 1 detik via WebSocket (`useDashboardStore`).
     - **1 jam, 6 jam, 24 jam, 7 hari**: Mengambil arsip histori riil dari PostgreSQL lewat endpoint `/api/v1/traffic/history` via tiket realtime.
   - Menyelaraskan ringkasan metrik (Unduh/Unggah Sekarang, Puncak, Rata-rata) dengan rentang yang dipilih.
4. **Pembersihan Data Ganda**:
   - Menghapus kartu SVG statis 24 jam yang redundan. Tampilan 24 jam kini diakses langsung dari tab **24 jam** pada modul grafik utama dengan visualisasi titik riil dari basis data.
5. **Penyelarasan Casing E2E Test**:
   - Menyesuaikan label kartu KPI ("Pelanggan online", "Pelanggan offline", "Router aktif") agar lulus pengujian Playwright end-to-end tanpa merusak tampilan UI.

---

## 3. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### A. Pengujian Basis Data PostgreSQL (`traffic_samples`)
```sql
SELECT count(*), min(sampled_at), max(sampled_at) FROM traffic_samples;
-- Hasil: 145.234 baris aktif terisi tiap detik, rentang 14 Okt - 16 Okt 2026.
```

### B. Pengujian Endpoint REST Histori Trafik Go Backend
```bash
node -e "testHistory()"
# Output:
# 1h status: 200 points: 361 from: 1792123410 to: 1792127017 sample rx: [ 167.9, 164.4, 126.0 ]
# 6h status: 200 points: 233 from: 1792105380 to: 1792127017 sample rx: [ 147.2, 151.3, 169.1 ]
# 24h status: 200 points: 263 from: 1792040400 to: 1792127017 sample rx: [ 110.8, 124.8, 153.8 ]
# 7d status: 200 points: 85 from: 1791522000 to: 1792127017 sample rx: [ 122.4, 118.4, 153.8 ]
```

### C. TypeScript Typecheck & ESLint
- `npm run typecheck`: **0 Error** (Exit code 0).
- `npx eslint src/components/dashboard/noc-dense-dashboard.tsx src/components/dashboard/traffic-panel.tsx`: **0 Error, 0 Warning** (Exit code 0).

### D. Unit & Integration Tests
```bash
node --test tests/dashboard-metric-board.test.mjs tests/device-status-endpoint.test.mjs tests/drizzle-traffic.test.mjs tests/traffic-service.test.mjs tests/traffic-trend-endpoint.test.mjs
# Hasil: 28 tests passing, 0 fail.
```

### E. Kompilasi & Runtime Docker
- `docker compose build app`: Kompilasi Turbopack Next.js 16.3.4 sukses tanpa error (105 halaman).
- `docker compose up -d --no-deps app`: Container `nocsystem-app-1` status `Up (healthy)`.

### F. Pengujian Interaksi Timeframe Peramban (Playwright Headless)
```bash
# Pengujian perpindahan rentang grafik di http://localhost:3000/app:
- Live 5m: canvas uPlot terdeteksi, Rx live: 100,9 Mbps
- Klik '1 jam': deskripsi 'rata-rata tiap 10 detik, 1 jam' aktif, Rx: 92,4 Mbps
- Klik '24 jam': deskripsi 'rata-rata tiap 5 menit, 24 jam' aktif, Rx: 129,3 Mbps
- Bukti visual tersimpan di:
  - screenshots/01-dashboard-redesign.png (Live 5m view)
  - screenshots/02-traffic-24h-view.png (24 jam historical view)
```

