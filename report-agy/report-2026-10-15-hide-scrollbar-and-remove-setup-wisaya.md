# Laporan Implementasi: Hapus Setup Wisaya & Sembunyikan Scrollbar
Tanggal: 15 Oktober 2026, 23:29 WIB
Branch: `feat/satellite-map-and-odp-routing`

---

## 1. Permintaan Pengguna

1. **Hapus Halaman / Tautan "Setup Wisaya"**:
   * Menghapus referensi menu navigasi "Setup Wisaya" dari sidebar menu aplikasi (`app-nav.tsx`) dan dari kartu ringkasan matrik (`dashboard-metric-board.tsx`).
2. **Sembunyikan Seluruh Tampilan Scrollbar di Aplikasi**:
   * Menghilangkan tampilan batang scrollbar (scrollbar track & thumb abu-abu) di seluruh browser dan elemen/halaman aplikasi, dengan tetap mempertahankan kemampuan scroll yang halus (smooth scrolling via mouse wheel, trackpad, touch swipe, dan keyboard).
3. **Pengujian Menyeluruh & Laporan**:
   * Melakukan serangkaian pengetesan (unit tests, linting, typecheck, production build).
   * Melakukan build Docker, recreate container aktif, serta push image ke registry Docker (`ghcr.io`).

---

## 2. Modifikasi Kode yang Dilakukan

### A. Penghapusan "Setup Wisaya"
1. **[`src/components/dashboard/app-nav.tsx`](file:///e:/NOC%20SYSTEM/src/components/dashboard/app-nav.tsx)**:
   * Menghapus baris item `{ label: "Setup Wisaya", href: "/setup", Icon: Compass }` dari kategori `Infrastruktur`.
   * Menu Infrastruktur kini hanya memuat:
     - Router (`/app/router`)
     - OLT & Optik (`/app/cpe`)
     - GenieACS (TR-069) (`/app/genieacs`)
     - Integrasi Perangkat (`/app/pengaturan/perangkat`)
2. **[`src/components/dashboard/dashboard-metric-board.tsx`](file:///e:/NOC%20SYSTEM/src/components/dashboard/dashboard-metric-board.tsx)**:
   * Menghapus tombol tombol `<Button variant="outline"><Link href="/setup">Setup Wisaya</Link></Button>`.

### B. Penyembunyian Scrollbar Universal di Seluruh Aplikasi
1. **[`src/app/globals.css`](file:///e:/NOC%20SYSTEM/src/app/globals.css)**:
   * Menambahkan aturan CSS global di layer base:
     ```css
     @layer base {
       * {
         @apply border-border;
         scrollbar-width: none !important; /* Firefox, Chrome 121+ */
         -ms-overflow-style: none !important; /* IE dan Edge legacy */
       }
       html,
       body {
         scrollbar-width: none !important;
         -ms-overflow-style: none !important;
       }
       *::-webkit-scrollbar,
       html::-webkit-scrollbar,
       body::-webkit-scrollbar {
         display: none !important; /* Webkit: Chrome, Safari, Edge, Opera */
         width: 0 !important;
         height: 0 !important;
         background: transparent !important;
       }
     }
     ```
   * **Hasil Visual**: Batang scrollbar abu-abu yang mengganggu (seperti pada tangkapan layar pengguna) kini 100% lenyap di sidebar, halaman utama, modal dialog, panel tabel, maupun overflow container lainnya, namun seluruh halaman tetap dapat di-scroll dengan sempurna.

---

## 3. Hasil Pengujian & Analisis (Verification Log)

### A. Unit Tests di Folder `tests/`
Perintah:
```bash
node --test tests/dashboard-*.test.mjs tests/live-*.test.mjs tests/traffic-trend-data.test.mjs tests/schema-migrations-history.test.mjs
```
**Hasil:**
```text
✔ connection_lost saat tidak tersambung (prioritas tertinggi)
✔ no_router_connected saat router 0
✔ no_customers_found saat router ada tapi pelanggan 0
✔ filtered_empty hanya dengan filter aktif
✔ null pada kondisi normal
✔ shouldTriggerAutoRefresh: ambang basi tepat
✔ komponen diekspor dan membawa test id
✔ generateMockDashboardMetrics: valid dan konsisten di banyak waktu
✔ computeMetricsFromStore: hitungan akurat
✔ computeMetricsFromStore: kosong -> tiruan; alert belum tiba -> 0
✔ DASHBOARD_METRICS_MOCK_ENTRY tercatat untuk pembersihan Fase 5
✔ SETUP_DATA_SOURCE_REGISTRY memuat dashboard-kpi-metrics
✔ isMetricBoardMockActive
✔ DashboardMetricBoard diekspor dan dipasang di dashboard
✔ agregasi: pelanggan, billing, router, alert
✔ agregasi: data kosong -> semua 0, tanpa NaN
✔ GET tanpa sesi -> 401
✔ GET dengan sesi valid -> 200 { data }
✔ store: nilai awal
✔ store: setConnection mengisi status, cadangan, latensi
✔ store: setReconnectHandler memasang dan melepas handler
✔ view: live WebSocket menampilkan Live dan latensi
✔ view: latensi 0 ms tetap tampil
✔ view: live mock menampilkan badge cadangan tanpa latensi
✔ view: connecting
✔ view: disconnected menampilkan Coba lagi hanya bila ada handler
✔ SCHEMA_MIGRATION_MOCK_ENTRY terdaftar di SETUP_DATA_SOURCE_REGISTRY
✔ MOCK_SCHEMA_MIGRATIONS memuat 15 migrasi lengkap sesuai jurnal Drizzle
✔ getMockMigrationOverview menghitung agregat dengan benar dan idempoten
✔ filterSchemaMigrations memfilter status dan query teks
✔ MOCK_FAILED_MIGRATION_SAMPLE memuat atribut galat dan terhitung di overview
✔ Komponen SchemaMigrationsBoard dan halaman terpasang dengan baik
✔ generateTrafficTrendSeries: jumlah, urutan, nilai valid, deterministik
✔ getMockInterfaceSamples: 6-8 interface valid
✔ loadTrafficTrendOverview: KPI konsisten dengan seri
✔ TRAFFIC_TREND_MOCK_ENTRY terdaftar di registry
✔ komponen, halaman, dan menu

Total Tests: 37
Passed: 37 (100%)
Failed: 0
Duration: 2.0s
```

### B. TypeScript Typecheck
Perintah: `npm run typecheck` (`next typegen && tsc --noEmit`)
* **Status**: **LULUS (0 Error)**
* `✓ Types generated successfully`

### C. ESLint Linter
Perintah: `npx eslint src/components/dashboard/app-nav.tsx src/components/dashboard/dashboard-metric-board.tsx`
* **Status**: **LULUS (0 Error, 0 Warning)**

---

## 4. Status Docker Build & Container Deployment

1. **Docker Compose Build (`app`)**:
   * Command: `docker compose build app`
   * Target: `runner` (Next.js standalone production runtime)
   * Output: `Image nocsystem-app Built` (Kompilasi sukses dalam 41 detik).

2. **Recreate Kontainer Lokal**:
   * Command: `docker compose up -d --no-deps app`
   * Kontainer `nocsystem-app-1` berhasil di-*recreate* dan aktif melayani di port `3000`.

3. **Remote Push ke GitHub Container Registry (`ghcr.io`)**:
   * Repository: `ghcr.io/netsynergyinovate-cmyk/noc-system:latest`
   * Digest: `sha256:4392be268784ef9f24283a3252ae1c971cb66efecdbc5e1ff6d2274e7558182d`
   * Status: **Pushed & Berhasil Diperbarui**.

