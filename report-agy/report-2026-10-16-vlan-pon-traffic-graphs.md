# Laporan Rekayasa: Penggantian Kartu Interface dengan Grafik Trafik VLAN per PON OLT Riil (MikroTik Core CIARA)

**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI & TERVERIFIKASI  
**Metodologi**: Gemini & Claude Code Cadence (`GEMINI.md`)  
**Lingkungan**: MikroTik RouterOS v7 (`Core CIARA` 103.167.70.136), HSGQ OLT 8 PON (`HSGQ CORE 8 PON` 103.167.70.136:2323), PostgreSQL (`olt_pon_ports`), Next.js 16.3.4 (Standalone Container).

---

## 1. Analisis Kebutuhan & Akar Masalah Lapangan

### Permintaan Pengguna:
> *"Ganti grafik trafik ini dengan vlan di trafik dengan grafik juga sema dengan hal nya grafik trafik yang utama VLAN per PON di OLT dan harus rel sesui di mikrotik. Plajari bagaiaman cara claude code bekerja"*

### Investigasi Perangkat Fisik & Protokol Jaringan:
1. **Pemeriksaan `/rest/interface` & `/rest/interface/vlan` pada MikroTik Core CIARA**:
   - Ditemukan antarmuka VLAN per port PON pada port fisik `ether4-lan1` (dengan komentar `OLT`):
     - `vlan1101` (VLAN ID 1101) $\rightarrow$ Menghubungkan ke **PON 1** OLT HSGQ. Counter: Tx 52.3 GB (Download Pelanggan), Rx 8.3 GB (Upload Pelanggan).
     - `vlan1102` (VLAN ID 1102) $\rightarrow$ Menghubungkan ke **PON 2** OLT HSGQ. Counter: Tx 35.0 GB, Rx 3.1 GB.
     - `vlan1103` (VLAN ID 1103) $\rightarrow$ Menghubungkan ke **PON 3** OLT HSGQ. Counter: Tx 12.7 GB, Rx 1.4 GB.
     - `vlan1104` (VLAN ID 1104) $\rightarrow$ Menghubungkan ke **PON 4** OLT HSGQ. Counter: Tx 31.0 GB, Rx 2.5 GB.
     - `vlan1105` (VLAN ID 1105) $\rightarrow$ Menghubungkan ke **PON 5** OLT HSGQ. Counter: Tx 32.9 GB, Rx 2.8 GB.
     - `vlan1106` (VLAN ID 1106) $\rightarrow$ Menghubungkan ke **PON 6** OLT HSGQ. Standby (0 ONU).
2. **Korelasi Data OLT (`olt_pon_ports` di PostgreSQL)**:
   - PON 1: 20 ONU online, Rx optik: -20.37 dBm.
   - PON 2: 15 ONU online, Rx optik: -18.73 dBm.
   - PON 3: 5 ONU online, Rx optik: -16.25 dBm.
   - PON 4: 13 ONU online, Rx optik: -21.10 dBm.
   - PON 5: 16 ONU online, Rx optik: -20.54 dBm.
   - PON 6: 0 ONU online.
   - Total ONU online = 69 ONU aktif.
3. **Kekurangan Implementasi Sebelumnya**:
   - Bagian "Status Interface & Port MikroTik" sebelumnya hanya menampilkan 5 port fisik acak (`ether1`, `ether2`, `ether3`, `ether4`, `WireGuardRemote`) dengan bar persentase statis, bukan grafik gelombang kontinu dan bukan per-VLAN PON pelanggan.

---

## 2. Tindakan Rekayasa & Solusi Arsitektural

### A. Layanan Telemetri VLAN (`src/services/vlan-traffic.service.ts`)
- Membaca counter byte `/rest/interface` untuk `vlan1101`..`vlan1106` secara periodik dari MikroTik Core CIARA.
- Menghitung bandwidth delta per detik secara defensif:
  - $\Delta \text{Tx} \times 8 / \Delta t \rightarrow \text{Download Pelanggan (Mbps)}$.
  - $\Delta \text{Rx} \times 8 / \Delta t \rightarrow \text{Upload Pelanggan (Mbps)}$.
- Menggabungkan data fisik port PON dari tabel `olt_pon_ports` (jumlah ONU dan redaman optik).
- Mengelola sliding window buffer 30 titik histori per VLAN untuk merender area gelombang trafik kontinu secara instan tanpa menunggu akumulasi data peramban.

### B. Endpoint API Baru (`src/app/api/traffic/vlans/route.ts`)
- Endpoint terotentikasi sesi `GET /api/traffic/vlans` yang mengembalikan ringkasan telemetri 6 port PON beserta deret waktu (*time series*).

### C. Komponen Papan Grafik VLAN per PON (`src/components/dashboard/vlan-pon-traffic-board.tsx`)
- Menggantikan bar statis 5 port fisik lama dengan 6 kartu PON interaktif dalam grid responsif (`xl:grid-cols-3 md:grid-cols-2 grid-cols-1`).
- Setiap kartu memiliki:
  1. **Header Port & Redaman**: Badge `PON X • vlan110X (110X)`, status aktif `UP`, jumlah `X ONU`, dan redaman optik `Rx -XX.X dBm`.
  2. **Statistik Kecepatan Ganda (Sama Persis dengan Panel Utama)**:
     - Unduh (Cyan `#38bdf8`): Kecepatan titik/sekarang, Puncak, dan Rata-rata.
     - Unggah (Purple `#c084fc`): Kecepatan titik/sekarang, Puncak, dan Rata-rata.
  3. **Kanvas Grafik Area Real-Time**:
     - Dual-line area chart: garis biru langit dengan gradien translucent untuk unduh, garis ungu dengan gradien translucent untuk unggah.
     - Dynamic auto-scaling Y axis berdasarkan beban puncak.
     - Inspeksi hover interaktif: menggeser mouse pada kanvas memunculkan timestamp presisi `HH.mm.ss WIB` dan mengunci angka kecepatan titik terpilih.
  4. **Footer Telemetri**: Akumulasi total data byte (misal: `Total: DL 54.4 GB • UL 8.9 GB`).

---

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

### A. Pengujian TypeScript & ESLint
```powershell
npm run typecheck
# Hasil: 0 errors (next typegen && tsc --noEmit sukses)

npx eslint src/services/vlan-traffic.service.ts src/app/api/traffic/vlans/route.ts src/components/dashboard/vlan-pon-traffic-board.tsx src/components/dashboard/noc-dense-dashboard.tsx
# Hasil: 0 errors, 0 warnings
```

### B. Pengujian Unit & Integrasi
```powershell
node --test tests/traffic*.test.mjs tests/vlan-traffic-service.test.mjs tests/use-realtime-feed.test.mjs
# Hasil: 27 passed, 0 failed
```

### C. Kompilasi & Runtime Kontainer Docker
```powershell
docker compose build app; docker compose up -d --no-deps app
docker compose ps app
# Hasil: nocsystem-app-1 Up (healthy), port 3000 aktif
```

### D. Bukti Tangkapan Layar Peramban Lapangan:
1. `screenshots/08-vlan-pon-traffic-board.png`:
   - Bagian kartu antarmuka fisik lama berhasil digantikan penuh oleh `Trafik VLAN per PON OLT (MikroTik Core CIARA)`.
   - Menampilkan 6 kartu PON dengan grafik unduh (cyan) dan unggah (ungu) real-time dari MikroTik.
   - PON 1: `35.4 Mbps DL / 4.8 Mbps UL (20 ONU, -20.4 dBm)`.
   - PON 2: `27.4 Mbps DL / 2.2 Mbps UL (15 ONU, -18.8 dBm)`.
   - PON 3: `7.3 Mbps DL / 0.8 Mbps UL (5 ONU, -16.2 dBm)`.
   - PON 4: `20.7 Mbps DL / 1.5 Mbps UL (13 ONU, -21.1 dBm)`.
   - PON 5: `47.8 Mbps DL / 3.3 Mbps UL (16 ONU, -20.5 dBm)`.
   - PON 6: `0.0 Mbps DL / 0.0 Mbps UL (0 ONU, Standby)`.
2. `screenshots/08-vlan-pon-hover-inspection.png`:
   - Verifikasi inspeksi kursor pada kanvas grafik.
