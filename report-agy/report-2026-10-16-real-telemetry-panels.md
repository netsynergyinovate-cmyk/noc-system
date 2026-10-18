# Laporan Teknis: Verifikasi Data Riil Telemetri NOC (Zero Dummy & Zero Fake Math)

**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI & TERVERIFIKASI  
**Pelaksana**: Gemini & Claude Code Engineering Protocol  

---

## 1. Ringkasan Eksekutif & Permintaan Pengguna
Pengguna meminta kepastian bahwa 3 panel telemetri di kolom kanan dashboard NOC menampilkan data operasional nyata (100% real data), tanpa manipulasi math/dummy tiruan, sesuai standar rekayasa perangkat lunak ketat:
1. **LATENSI GATEWAY & PERANGKAT** (Core CIARA, HSGQ OLT, Cloudflare DNS, Google DNS).
2. **REDAMAN OPTIK KRITIS (RX < -24.5 DBM RIIL)** (Data fisik ONT dari OLT HSGQ & database).
3. **DAFTAR ANOMALI & ALARM AKTIF** (Data insiden jaringan real-time dari PostgreSQL).

---

## 2. Investigasi Akar Masalah & Temuan Telemetri
1. **Latensi Gateway & Perangkat**:
   - *Sebelum*: Menggunakan rumus simulasi artifisial `Math.min(latencyMs, 4)`, nilai statis `8.6 ms` (Cloudflare) dan `14.1 ms` (Google DNS), serta menampilkan deviasi jam WebSocket (`clockSkew`) berlabel "Ping: 1685 ms".
   - *Solusi Riil*: Dibuat service backend [`src/services/network-latency.service.ts`](file:///e:/NOC%20SYSTEM/src/services/network-latency.service.ts) dan endpoint `GET /api/network/latency` yang mengukur waktu round-trip TCP fisik (`net.Socket`) ke 4 host nyata:
     - Core CIARA: `103.167.70.136:80` (~8.4 ms)
     - HSGQ OLT: `103.167.70.136:2323` (~7.9 ms)
     - DNS Cloudflare: `1.1.1.1:53` (~29.5 ms)
     - Google DNS: `8.8.8.8:53` (~42.1 ms)
     - Cache 3 detik di memori server untuk efisiensi soket.

2. **Redaman Optik Kritis**:
   - *Sebelum*: Port PON di-hardcode ke `"PON 1/1/1"` dan ODP ke `"Jaringan Distribusi"`.
   - *Solusi Riil*: Dibuat service [`src/services/critical-optics.service.ts`](file:///e:/NOC%20SYSTEM/src/services/critical-optics.service.ts) dan endpoint `GET /api/olts/critical-optics` yang meng-query tabel relasional PostgreSQL `olt_onus` (hasil polling OLT HSGQ) yang di-join dengan tabel `customers`.
   - Menghasilkan identifikasi fisik presisi:
     - `ONT C4:CD:50:0E:9A:66` • `PON 1 • ONU 19` (`-28.9 dBm`) [Critical]
     - `17060001866@runsnet.id` • `PON 4 • ONU 8` (`-27.0 dBm`) [High Atten]
     - `17060001716@runsnet.id` • `PON 2 • ONU 16` (`-26.0 dBm`) [High Atten]
     - `ONT C4:CD:50:7C:FD:84` • `PON 2 • ONU 17` (`-25.5 dBm`) [Degrading]

3. **Daftar Anomali & Alarm Aktif**:
   - *Sebelum*: Mengandalkan state in-memory WebSocket tanpa sinkronisasi langsung ke database. Format timestamp detik Unix tidak dinormalisasi.
   - *Solusi Riil*: Terintegrasi langsung dengan `GET /api/alerts?status=active&limit=4`, menormalisasi timestamp detik Unix (`detectedAt * 1000`) ke format lokal WIB (`Asia/Jakarta`) dan mengekstrak nama lokasi/ODP/pelanggan nyata dari record PostgreSQL:
     - `Sinyal optik lemah` — `17060001720@runsnet.id` (14.36.07 WIB)
     - `Pelanggan offline` — `MAS HASAN` (13.49.53 WIB)
     - `Pelanggan offline` — `ALDI FAREZI` (12.43.23 WIB)
     - `Pelanggan offline` — `17060001609@runsnet.id` (12.35.23 WIB)

---

## 3. Bukti Pengujian Mandiri (Gerbang Verifikasi Ketat)
1. **Unit Test**:
   ```bash
   node --test tests/network-latency-service.test.mjs
   ```
   *Hasil*: 2/2 tests PASS (102 ms).
2. **ESLint**:
   ```bash
   npx eslint src/components/dashboard/noc-dense-dashboard.tsx src/services/network-latency.service.ts src/services/critical-optics.service.ts
   ```
   *Hasil*: 0 error, 0 warning (aturan `react-hooks/purity` terpenuhi).
3. **TypeScript**:
   ```bash
   npm run typecheck
   ```
   *Hasil*: 0 error.
4. **Docker Container Build**:
   ```bash
   docker compose build app && docker compose up -d --no-deps app
   ```
   *Hasil*: Next.js 16 Turbopack build sukses (39.8s), kontainer `nocsystem-app-1` berjalan sehat.
5. **Verifikasi Visual Browser (Playwright)**:
   - File tangkapan layar: `screenshots/09-real-telemetry-panels.png`
   - Membuktikan ketiga panel terisi penuh dengan data riil, label presisi, dan tampilan yang sinkron dengan palet warna dashboard.

