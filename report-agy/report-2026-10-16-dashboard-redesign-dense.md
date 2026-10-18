# Laporan Implementasi: Redesain Dashboard NOC Sesuai Referensi & Telemetri Riil MikroTik / OLT

**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI & TERVERIFIKASI RUNTIME  
**Evidence Screenshot**: `screenshots/01-dashboard-redesign.png`

---

## 1. Analisis Akar Masalah & Keluhan Pengguna
1. **Double Data / Header Ganda**:
   - Komponen induk `src/app/(protected)/app/page.tsx` sudah merender judul halaman "Dashboard NOC", status mode database, badge anomali, status latency live, dan auto-refresh.
   - Komponen dalam `noc-dense-dashboard.tsx` sebelumnya merender `<header>` tambahan berisi `<h1>Dashboard NOC</h1>` dan badge tiruan yang sama persis sehingga terjadi duplikasi judul dan elemen pada peramban.
2. **Ketergantungan Data Template (Dummy)**:
   - Interface jaringan sebelumnya memiliki nama statis template (`vlan511`, `vlan900`, dsb.) bukan port fisik router `Core CIARA`.
   - Kurva 24 jam sebelumnya memakai koordinat SVG hardcoded (`d="M 0,102 L 0,82 C 40,84..."`), bukan deret data aktual dari tabel `traffic_samples`.
3. **Pelestarian Fitur Paten Eksisting**:
   - Peta Leaflet (`CustomerMap`) untuk sebaran pelanggan dan ODP di Bandung wajib tetap aktif dan terpasang dinamis tanpa mengganggu berkas sesi pengguna.
   - Tabel manajemen inventaris pelanggan PPPoE (`CustomerTable`) harus tetap utuh dan dapat dibuka secara accordion.

---

## 2. Rincian Perubahan Teknis (Surgical Scope)

### A. Ekstraksi Port Fisik Nyata dari MikroTik RouterOS v7
- **Berkas**: `src/services/router-resources.service.ts` & `src/lib/dashboard/routers.ts`
- **Tindakan**:
  - Menambahkan pembacaan `client.getInterfaces()` langsung pada saat pemanggilan `getRouterResourcesSummary()`.
  - Memfilter interface aktif non-dynamic (mengecualikan `<pppoe-...>`), lalu memetakan nama port fisik, tipe, status `running`, counter `rxByte` & `txByte`, serta `comment` dari router MikroTik `103.167.70.136`.
  - Data yang terbaca langsung dari router:
    - `ether1-sfp2` (SFP+ 10G) - UP
    - `ether2-lan0` (Comment: "UPLINK") - UP
    - `ether3-sfp1` (SFP+ 10G) - DOWN
    - `ether4-lan1` (Comment: "OLT") - UP
    - `WireGuardRemote` (Comment: "WireGuard Remote") - UP

### B. Eliminasi Header Ganda & Rekayasa Kurva Dinamis 24 Jam
- **Berkas**: `src/components/dashboard/noc-dense-dashboard.tsx`
- **Tindakan**:
  - Menghapus elemen `<header>` ganda di `noc-dense-dashboard.tsx` sehingga tampilan langsung mengalir dari header otentik `page.tsx` ke 6 kartu KPI telemetri hardware.
  - Membangun kalkulator kurva SVG `useMemo` dinamis yang memetakan **262 titik data riil** dari endpoint `/api/traffic?range=24h` (tabel PostgreSQL `traffic_samples`) menjadi:
    - Garis stroke poliline SVG (`linePath`)
    - Area gradien terisi SVG (`areaPath`)
    - Penanda puncak vertikal garis putus-putus dan titik lingkaran amber (`peakPoint`) yang menghitung waktu dan besaran Mbps tertinggi secara matematis.
  - Memetakan kartu interface ke `activePhysicalInterfaces` nyata dari Core CIARA dengan pembacaan throughput Mbps atau total volume byte (TB/GB/MB) tanpa data tiruan.
  - Menghubungkan perhitungan persentase beban utilisasi (Donut 3) langsung ke rasio `avgMbps` / `peakMbps` atau kapasitas uplink 1 Gbps.

### C. Integrasi Peta GIS & Tabel Pelanggan Eksisting
- **Peta GIS**: Mempertahankan komponen Leaflet interaktif `CustomerMap` (`customer-map.tsx`) via `next/dynamic` dengan ssr false dan styling boundary aman.
- **Tabel Pelanggan**: Menyediakan accordion kontrol yang membungkus `<CustomerTable />` di bagian bawah dasbor dengan indikator jumlah pelanggan terdaftar.

---

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

### 1. TypeScript Strict Typecheck
```powershell
npm run typecheck
```
*Hasil*:
```
Generating route types...
✓ Types generated successfully
Exit code: 0 (0 error)
```

### 2. ESLint Static Analysis
```powershell
npx eslint src/components/dashboard/noc-dense-dashboard.tsx "src/app/(protected)/app/page.tsx" src/services/router-resources.service.ts src/lib/dashboard/routers.ts
```
*Hasil*:
```
Exit code: 0 (0 error, 0 warning)
```

### 3. Suite Pengujian Otomatis
```powershell
node --test tests/dashboard-metric-board.test.mjs tests/device-status-endpoint.test.mjs tests/routers-resource-api.test.mjs
```
*Hasil*:
```
✔ generateMockDashboardMetrics: valid dan konsisten di banyak waktu
✔ computeMetricsFromStore: hitungan akurat
✔ computeMetricsFromStore: kosong -> tiruan; alert belum tiba -> 0
✔ DASHBOARD_METRICS_MOCK_ENTRY tercatat untuk pembersihan Fase 5
✔ SETUP_DATA_SOURCE_REGISTRY memuat dashboard-kpi-metrics
✔ isMetricBoardMockActive
✔ DashboardMetricBoard diekspor dan dipasang di dashboard
✔ GET /api/devices/status: 401 tanpa sesi
✔ GET /api/devices/status: 200 dengan routers, olts, summary
✔ GET /api/devices/status: summary konsisten
✔ GET /api/routers: 401 tanpa sesi
✔ GET /api/routers: 200 daftar router dengan status pemeriksaan
✔ computeReachability: batas 5 menit
✔ demo: envelope { summary, items } dengan invarian
✔ demo: bentuk summary cocok RouterResourceSummary
✔ demo: tidak ada kredensial pada item
✔ demo: mengembalikan salinan, bukan objek bersama
ℹ tests 17 | pass 17 | fail 0
```

### 4. Siklus Runtime Docker Container
```powershell
docker compose build app; docker compose up -d --no-deps app
```
*Hasil*:
```
✓ Compiled successfully in 12.7s
✓ Generating static pages using 15 workers (105/105) in 816ms
Container nocsystem-app-1 Recreated
Container nocsystem-app-1 Started
```

### 5. Verifikasi Visual Tangkapan Layar (Browser Verification)
```powershell
node scripts/capture-dashboard.mjs
```
*Hasil*:
- Berkas `screenshots/01-dashboard-redesign.png` berhasil dibuat (465.3 KB).
- Inspeksi visual:
  - Header tunggal bersih dan padat.
  - Kartu Core CIARA menampilkan CPU 2%, RAM 4%, Queues 69.
  - Kartu HSGQ OLT menampilkan 8 Port, Status AKTIF, ONT 70/78.
  - Status interface menampilkan port fisik asli: `ether1-sfp2`, `ether2-lan0` (UPLINK), `ether3-sfp1`, `ether4-lan1` (OLT), `WireGuardRemote`.
  - Grafik 24 jam menggambar kurva dinamis berfluktuasi dari 262 sampel PostgreSQL dengan puncak 205.6 Mbps dan rata-rata 93.7 Mbps.
  - Peta Leaflet GIS terpasang rapi dengan ubin peta dan legenda status optik.
