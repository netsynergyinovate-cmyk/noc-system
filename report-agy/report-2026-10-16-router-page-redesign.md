# Laporan Rekayasa: Redesign Halaman Kelola Router (Obsidian Telemetry NOC & Konfigurasi)

Tanggal: 16 Oktober 2026  
Status: Terverifikasi Penuh (Zero-Dummy & Real Telemetri MikroTik)  
Referensi Desain: `ref-folder/router-design/` (`screen.png`, `DESIGN.md`, `code.html`)  
Evidence Screenshot:
- `screenshots/router/01-router-dashboard-redesign.png` (Live Throughput Spline Monitor & Real Port Throughput)
- `screenshots/router/02-router-config-dialog.png` (Dialog Konfigurasi Router & Pre-flight Testing)
- `screenshots/router/03-router-detail-tabs.png` (Tab Hardware & Sistem, CPU 3%, RAM 4%, Uptime, Queues)
- `screenshots/router/04-router-traffic-live-tab.png` (Tab Trafik Live Telemetri MikroTik Riil)

---

## 1. Analisis & Sasaran Rekayasa

Berdasarkan referensi di `ref-folder/router-design` dan instruksi pengguna:
1. **Redesign Visual Halaman Kelola Router**:
   - Menghadirkan layout telemetri ultra-padat (*Obsidian Telemetry NOC*) dengan tema gelap (*dark mode*) yang konsisten dengan sistem dashboard NOC (`bg-zinc-950`, `bg-zinc-900`, `border-zinc-800`, `text-emerald-400`, `text-cyan-400`, typography monospace JetBrains Mono).
2. **Mempertahankan Seluruh Fitur Eksisting**:
   - Tautan navigasi: `Daftar Queue` (`/app/router/queues`), `Uji Koneksi` (`/app/router/test`), `Tambah Router` (`/app/router/new`).
   - Dialog Rincian Router dengan 5 tab lengkap: Hardware & Sistem, Trafik Live, Simple Queue, Sesi PPPoE, dan Tool Ping ICMP.
   - Tetap menggunakan komponen baku `RouterHardwareCards`, `RouterStatusBadge`, dan `RouterTrafficCard` untuk mempertahankan 100% kesesuaian unit test.
3. **Menambahkan Konfigurasi Router**:
   - Menyediakan `RouterConfigDialog` (`src/components/dashboard/router-config-dialog.tsx`) untuk mengedit nama router, host IP, username, password, peran, dan status operasional.
   - Tombol "Uji Sekarang" (pre-flight test) langsung dari dialog konfigurasi.
   - Menambahkan endpoint REST CRUD baru: `GET`, `PATCH`, `DELETE` di `src/app/api/routers/[id]/route.ts`.
4. **Prinsip Zero-Dummy & Real Data dari MikroTik**:
   - Data diambil langsung dari router fisik **Core CIARA** (`103.167.70.136`, MikroTik x86 Ciara Technologies) via REST API RouterOS v7:
     - CPU load riil: `3%`
     - RAM allocation riil: `4%`
     - Uptime riil: `8 jam 14 menit`
     - Throughput riil dari interface uplink `ether2-lan0`: Download `140.2 Mbps`, Upload `10.2 Mbps`, Peak `189.3 Mbps`
     - Active port interfaces riil: `ether2-lan0 (UPLINK 140.2M/10.2M)`, `ether4-lan1 (OLT 10.9M/113.9M)`, `vlan1101 (5M/51.4M)`, `vlan1105 (1.6M/27.5M)`, `vlan1102 (1M/19.7M)`, `vlan1104 (0.8M/9.5M)`.
     - PPPoE sessions riil: `69 sesi`.
     - Latensi API riil: `5.5 ms`.
     - Real Default Gateway: `103.167.70.0%ether2` (`0.0.0.0/0 STATIC`, Active Reachable).
5. **Streaming Real-Time & Live Flowing Spline Canvas**:
   - Mengatasi glitch `0 Mbps` dengan memindahkan `ifaceCache` ke module level dan melakukan delta priming pada pemanggilan pertama.
   - Mempercepat polling telemetri menjadi 2000 ms (`intervalMs = 2_000`, `SHARE_WINDOW_MS = 1_000`).
   - Menambahkan pulse ticker 1000 ms pada `RealtimeThroughputCanvas` sehingga kurva throughput bergerak mengalir halus seperti osiloskop telemetri real-time.

---

## 2. Struktur Modul & Perubahan Berkas

1. **Validator Zod (`src/validators/routers.ts`)**:
   - Menambahkan `updateRouterSchema` dan `UpdateRouterInput` untuk validasi ketat nama, host, port, username, password, dan status.
2. **Service Layer (`src/services/routers.service.ts`)**:
   - Mengimplementasikan `getRouterById(id)`, `updateRouter(id, input)`, dan `deleteRouter(id)` dengan sanitasi host dan enkripsi AES-256-GCM.
3. **API Route Handler (`src/app/api/routers/[id]/route.ts`)**:
   - Menerima `GET`, `PATCH`, `DELETE` dengan validasi sesi, otorisasi izin `router:manage`, dan pencatatan audit log.
4. **Telemetry Service (`src/services/router-resources.service.ts`)**:
   - Module-level `ifaceCache` untuk persistensi delta antarmuka antar pemanggilan HTTP.
   - Delta priming 400 ms pada pembacaan pertama untuk menjamin laju Mbps non-zero sejak render pertama.
   - Perhitungan laju data fisik uplink `ether2-lan0` langsung sebagai `currentDownloadMbps` dan `currentUploadMbps` router.
5. **Hook Telemetri (`src/lib/dashboard/use-router-resources.ts`)**:
   - Mendukung interval polling dinamis (default 2500 ms, 2000 ms pada tabel router).
   - Menurunkan `SHARE_WINDOW_MS` ke 1000 ms agar request polling cepat tidak terblokir cache.
6. **Redesign Dashboard Router (`src/components/dashboard/router-table.tsx`)**:
   - **Telemetry Status Strip**: Baris metrik cepat (Router online, OLT online, ONU terdaftar, PPPoE sesi, Aggregate throughput, status PostgreSQL, filter perangkat).
   - **Highlight Router Card (7 kolom)**: Live Throughput Monitor dengan grafik animated spline canvas, breakdown 6 port antarmuka aktif riil dengan indikator status fisik running/link up, tombol Rincian, Ping, dan Konfigurasi.
   - **KPI Telemetry Array (5 kolom, grid 2x3)**: Router Online, Total PPPoE, CPU Core, Alokasi RAM, Gateway Utama riil (`103.167.70.0%ether2`), Latensi API.
   - **Inventory Data Table**: Toolbar pencarian, filter peran, filter status, tabel router dengan kolom metrik lengkap, tombol aksi Rincian, Konfigurasi, dan Uji.
   - **System Status Footer Strip**: Informasi epoch telemetri dan status cluster nominal.
   - **Detail Modal Tabs**: Integrasi `RouterTrafficCard` dengan `initialStats` fisik dari pembacaan perangkat MikroTik riil (`REST Live Telemetri`).
7. **Komponen UI Dialog Konfigurasi (`src/components/dashboard/router-config-dialog.tsx`)**:
   - Dialog konfigurasi router lengkap dengan form editing dan tombol uji koneksi pre-flight.

---

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

1. **Pemeriksaan Tipe TypeScript**:
   ```bash
   npm run typecheck
   # Output: ✓ Types generated successfully, 0 errors
   ```
2. **Pemeriksaan Linter ESLint**:
   ```bash
   npx eslint src/services/router-resources.service.ts src/lib/dashboard/use-router-resources.ts src/components/dashboard/router-table.tsx src/components/dashboard/router-traffic-card.tsx
   # Output: 0 errors, 0 warnings
   ```
3. **Pengujian Unit Test (Node Test Runner)**:
   ```bash
   node --test tests/router*.test.mjs
   # Output: 84/84 tests passed (100% pass)
   ```
4. **Kompilasi & Runtime Kontainer Docker**:
   ```bash
   docker compose build app; docker compose up -d --no-deps app
   # Output: Successfully compiled in 14.9s (Turbopack), Container nocsystem-app-1 Up (healthy)
   ```
5. **Verifikasi Visual Peramban (Playwright)**:
   - Tangkapan layar `01-router-dashboard-redesign.png` membuktikan Live Throughput Spline berjalan aktif (**140.2 Mbps Download / 10.2 Mbps Upload / Peak 189.3 Mbps**).
   - 6 Port antarmuka menampilkan angka riil non-zero: `ether2-lan0 UPLINK` (↓ 140.2 Mbps / ↑ 10.2 Mbps), `ether4-lan1 OLT` (↓ 10.9 Mbps / ↑ 113.9 Mbps), serta VLAN pelanggan (`vlan1101`, `vlan1105`, `vlan1102`, `vlan1104`).
   - Kartu Gateway Utama menampilkan rute aktif riil: `103.167.70.0%ether2` (`0.0.0.0/0 STATIC`).
   - Dialog Rincian Router (`03-router-detail-tabs.png` & `04-router-traffic-live-tab.png`) menampilkan data operasional riil dengan label **REST Live Telemetri**.

