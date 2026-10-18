# Laporan Rekayasa: Perbaikan Rincian Router MikroTik (Modal 5 Tab & Zero-Dummy)

**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI (100% Terverifikasi Mandiri)  
**Tujuan**: Menghilangkan seluruh data dummy, memperbaiki bug state statis/beku pada modal rincian router di `/app/router`, serta menyambungkan seluruh tab langsung ke RouterOS v7 fisik (Core CIARA).

---

## 1. Analisis Akar Masalah (Root-Cause Analysis)

Sebelum perbaikan, ditemukan beberapa kelemahan arsitektural pada komponen dialog rincian router:
1. **Frozen/Stale State Bug**: `selectedRouter` disimpan sebagai state lokal `useState(router)` saat tombol "Rincian Router" diklik. Polling telemetri per 2 detik tidak memperbarui data di dalam modal sehingga angka CPU/RAM dan status antarmuka membeku.
2. **Tab 4 (Sesi PPPoE) Mock Bug**: Sebelumnya menampilkan daftar statis 10 pelanggan tiruan (`customers.filter(...).slice(0, 10)`), tanpa IP address riil, tanpa MAC address pemanggil (*caller-id*), dan tanpa uptime sesi fisik. Padahal di router fisik Core CIARA terdapat 67 sesi PPPoE aktif pada path `/rest/ppp/active`.
3. **Tab 5 (Tool Ping ICMP) Bug**: Hanya berupa tombol tes REST API (`/api/routers/[id]/test`), tidak memiliki kapabilitas mengeksekusi ICMP ping interaktif dari MikroTik ke target luar (seperti `8.8.8.8`, `1.1.1.1`, gateway ISP, maupun IP pelanggan).
4. **Tab 1 (Hardware & Sistem) Kurang Komprehensif**: Hanya memuat kartu CPU/RAM dan satu kartu Simple Queue tanpa rincian status port fisik dan tautan interface.

---

## 2. Perubahan Teknis & Implementasi

### A. Klien RouterOS MikroTik (`src/lib/mikrotik/client.ts`)
- Menambahkan interface `MikrotikPppActive` dan `MikrotikPingPacket`.
- Mengimplementasikan `getPppActive()` untuk mengambil semua sesi PPPoE aktif melalui endpoint `/rest/ppp/active`.
- Mengimplementasikan `ping(target, count)` untuk menjalankan ping ICMP langsung dari RouterOS via `/rest/tool/ping` dengan payload JSON `{ address: target, count }`.

### B. Layanan Backend & API Endpoints
1. **Layanan & Route Sesi PPPoE**:
   - Berkas: `src/services/router-pppoe.service.ts` & `src/app/api/routers/[id]/pppoe/route.ts`.
   - Mengambil 67 sesi aktif dari RouterOS, menggabungkan (*join in-memory*) dengan tabel PostgreSQL `customers` berdasarkan kolom `pppoe_username` untuk menampilkan nama pelanggan riil (e.g. TERI RAYA, MAS PENDI, DEWI KURNIA RAHAYU).
   - Menghitung durasi uptime dalam bahasa Indonesia (`8 jam 39 menit`).
2. **Layanan & Route Ping ICMP**:
   - Berkas: `src/services/router-ping.service.ts` & `src/app/api/routers/[id]/ping/route.ts`.
   - Validasi ketat target host/IP dengan regex untuk mencegah *command injection* atau SSRF.
   - Mengonversi paket ICMP menjadi keluaran baris terminal standar ping (RTT min/avg/max, packet loss).

### C. Komponen UI Modal Interaktif
1. **`src/components/dashboard/router-pppoe-table.tsx`**:
   - Menampilkan tabel sesi PPPoE dengan pencarian instan (nama pelanggan, username, IP, MAC caller ID).
   - Tombol *copy-to-clipboard* satu klik pada IP address klien.
   - Badge status online/aktif berbasis indikator visual hijau.
2. **`src/components/dashboard/router-ping-tool.tsx`**:
   - Input target host/IP dengan pilihan paket (3, 4, 5, 10 pkt).
   - Target cepat satu klik: Google DNS (`8.8.8.8`), Cloudflare (`1.1.1.1`), Gateway ISP (`103.167.70.0`).
   - Tombol "Kirim Ping (ICMP)" dan "Uji REST API".
   - Jendela konsol terminal gelap dengan sintaks berwarna dan tombol bersihkan log.
3. **`src/components/dashboard/router-table.tsx`**:
   - Memperbaiki `selectedRouterId` dengan `useMemo` reaktif dari `details` yang diperbarui secara langsung oleh hook `useRouterResources`.
   - Menghubungkan seluruh 5 tab:
     - **Tab 1 (Hardware & Sistem)**: Memuat `RouterHardwareCards` + strip KPI (Queue, PPPoE aktif, latensi REST) + tabel 14 port antarmuka RouterOS (status Link Up/Down, laju RX/TX Mbps, tipe port, komentar).
     - **Tab 2 (Trafik Live)**: Memuat grafik dan metrik `RouterTrafficCard` (RX 490 Mbps, TX 196 Mbps).
     - **Tab 3 (Simple Queue)**: Memuat 68 antrian bandwidth aktif (`RouterQueueTable`).
     - **Tab 4 (Sesi PPPoE)**: Memuat `RouterPppoeTable` (67 sesi aktif riil).
     - **Tab 5 (Tool Ping ICMP)**: Memuat `RouterPingTool`.
   - Modal terpisah "Ping & Trace" juga diperbarui menggunakan `RouterPingTool`.

---

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

### A. TypeScript Typecheck
```
$ npm run typecheck
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
(Exit code: 0 - 0 errors)
```

### B. ESLint
```
$ npx eslint src/components/dashboard/router-table.tsx src/components/dashboard/router-pppoe-table.tsx src/components/dashboard/router-ping-tool.tsx src/services/router-pppoe.service.ts src/services/router-ping.service.ts src/app/api/routers/[id]/pppoe/route.ts src/app/api/routers/[id]/ping/route.ts src/lib/mikrotik/client.ts
(Exit code: 0 - 0 errors, 0 warnings)
```

### C. Pengujian Unit & Integrasi
```
$ node --test tests/router*.test.mjs
ℹ tests 88
ℹ suites 0
ℹ pass 88
ℹ fail 0
ℹ duration_ms 3138.3996
```

### D. Build & Runtime Docker
```
#18 naming to docker.io/library/nocsystem-app:latest done
Container nocsystem-app-1 Recreated
Container nocsystem-app-1 Started
$ docker compose ps
nocsystem-app-1   nocsystem-app   Up (healthy)   0.0.0.0:3000->3000/tcp
```

### E. Bukti Screenshot Pengujian Visual Playwright
1. **Tab 1 - Hardware & Sistem (`screenshots/router/modal-tab-1-hardware.png`)**: Menampilkan CPU 3%, RAM 4%, Uptime 8 jam 39 menit, 68 Queue, 70 PPPoE, Latensi REST 6.9 ms, serta 14 port antarmuka riil (ether2-lan0 UPLINK 97.4 Mbps, ether4-lan1 OLT 85.3 Mbps).
2. **Tab 2 - Trafik Live (`screenshots/router/modal-tab-2-traffic.png`)**: Menampilkan telemetri REST live bandwidth RX 490 Mbps / TX 196 Mbps.
3. **Tab 3 - Simple Queue (`screenshots/router/modal-tab-3-queues.png`)**: Menampilkan 68 antrian bandwidth aktif dengan batas limit 10/15/20 Mbps dan total transfer data.
4. **Tab 4 - Sesi PPPoE (`screenshots/router/modal-tab-4-pppoe.png`)**: Menampilkan 67 sesi PPPoE aktif riil dengan nama pelanggan database, IP `172.16.15.x`, MAC address, dan status online.
5. **Tab 5 - Tool Ping ICMP (`screenshots/router/modal-tab-5-ping-executed.png`)**: Menampilkan eksekusi live ICMP ping ke `8.8.8.8` langsung dari RouterOS (4 packets transmitted, 4 received, 0% packet loss, RTT ~21.7 ms).
6. **Modal Standalone Ping & Trace (`screenshots/router/modal-ping-trace-standalone.png`)**: Menampilkan dialog interaktif ping yang siap digunakan dari tabel inventory router.

