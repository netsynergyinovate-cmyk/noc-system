# Laporan Rekayasa: Sinkronisasi Trafik VLAN per PON Real-Time per Detik (1 DTK) & Riwayat Database

**Tanggal**: 16 Oktober 2026  
**Topik**: Update Per Detik MikroTik (1 DTK) & Multi-Rentang Riwayat Database untuk Trafik VLAN per PON OLT  
**Cabang**: `feat/satellite-map-and-odp-routing`  
**Kepatuhan Standar**: [GEMINI.md](file:///e:/NOC%20SYSTEM/GEMINI.md) & [.agents/skills/gemini-claude-code/SKILL.md](file:///e:/NOC%20SYSTEM/.agents/skills/gemini-claude-code/SKILL.md)

---

## 1. Analisis Akar Masalah & Permintaan Pengguna

Pengguna meminta:
> *"untuk updatenya juga sama dan ahrus sama dengan trafik di mikrtoik per detik"*

Sebelumnya:
- Board VLAN per PON OLT memperbarui data setiap 3,5 detik.
- Pengguna menuntut agar irama (*cadence*) pembaruan data VLAN per PON sama persis dengan grafik trafik utama jaringan, yaitu **berjalan per detik (1 DTK)** dengan resolusi telemetri tinggi langsung dari delta byte counter MikroTik Core CIARA (`vlan1101` s/d `vlan1106`).

---

## 2. Implementasi Teknis & Modifikasi Kode

### A. Cadence Update Per Detik pada UI (`vlan-pon-traffic-board.tsx`)
1. **Interval Polling 1 Detik**:
   - Untuk mode `live`, interval disetel ke `1000ms` (1 detik), sedangkan rentang arsip histori (`1h`, `6h`, `24h`, `7d`) disetel ke `15000ms`.
2. **Pencegahan Race Condition (`isFetchingRef`)**:
   - Menambahkan ref guard `isFetchingRef` agar request polling per detik tidak menumpuk saat latensi jaringan sesaat berfluktuasi.
3. **Badge Indikator Real-Time 1 DTK**:
   - Menyematkan badge hijau berdenyut `1 DTK` identik dengan header *Traffic Jaringan Real-Time*, menandai mode streaming aktif per detik.

### B. Resolusi Buffer Streaming 1 Detik (`vlan-traffic.service.ts`)
1. **Delta Bandwidth Presisi Tinggi**:
   - Menghitung $\Delta \text{Tx} \times 8 / \Delta t \rightarrow \text{Download Mbps}$ dan $\Delta \text{Rx} \times 8 / \Delta t \rightarrow \text{Upload Mbps}$ setiap detik secara presisi dari counter fisik MikroTik.
2. **Buffer Sliding Window 60 Titik**:
   - Memperluas `MAX_LIVE_POINTS` ke 60 titik dengan langkah `step = 1 detik`, sehingga kurva kanvas bergeser mulus detik demi detik.
3. **Persistensi Asinkron ke PostgreSQL (`vlan_traffic_samples`)**:
   - Setiap sampel telemetri live disimpan secara asinkron tanpa menahan respons HTTP klien menggunakan `onConflictDoNothing()`.
   - Data historis 24 jam terisi kontinyu (2.000+ baris tersimpan dan bertambah setiap polling).

---

## 3. Bukti Verifikasi Mandiri (Evidence Before Assertions)

### A. TypeScript Typecheck
```bash
npm run typecheck
```
**Hasil**: 0 error (`✓ Types generated successfully`).

### B. Linting (ESLint)
```bash
npx eslint src/services/vlan-traffic.service.ts src/components/dashboard/vlan-pon-traffic-board.tsx
```
**Hasil**: 0 warning, 0 error.

### C. Unit Test
```bash
node --test tests/vlan-traffic-service.test.mjs
```
**Hasil**:
```text
✔ getVlanPonTraffic (live): mengembalikan 6 PON VLAN dengan deret grafik lengkap (2.4437ms)
✔ getVlanPonTraffic (1h): mengembalikan deret histori 1 jam dengan timeLabel jam:menit (1.0959ms)
✔ getVlanPonTraffic (24h): mengembalikan deret histori 24 jam (0.8139ms)
ℹ tests 3, pass 3, fail 0
```

### D. Verifikasi Database PostgreSQL
```sql
SELECT count(*), min(sampled_at), max(sampled_at) FROM vlan_traffic_samples;
```
**Hasil**:
```text
 count |          min           |            max             
-------+------------------------+----------------------------
  2004 | 2026-10-15 06:35:12+00 | 2026-10-16 06:41:29.352+00
```
Tabel `vlan_traffic_samples` aktif merekam riwayat dari 24 jam lalu hingga detik ini secara kontinyu.

### E. Verifikasi Runtime Docker & Tangkapan Layar Playwright
- Kontainer `nocsystem-app-1` berhasil di-build ulang (`next build` sukses 106 halaman).
- Bukti visual:
  - `screenshots/08-vlan-pon-traffic-board.png`: Menampilkan badge `1 DTK`, label Sumbu Y & X per detik (`13.40.55`, `13.41.12`), unduh (biru langit), unggah (ungu), dan tombol multi-rentang (`5 menit`, `1 jam`, `6 jam`, `24 jam`, `7 hari`).
  - `screenshots/08-vlan-pon-hover-inspection.png`: Menampilkan crosshair hover inspeksi presisi waktu per detik.

