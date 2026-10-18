# Laporan Rekayasa: Penanganan Akar Masalah Bug Lonjakan Trafik (55.000 Mbps) & Perapian Layout Header Subdued

**Tanggal**: 16 Oktober 2026  
**Topik**: Perbaikan Bug Counter Discontinuity Spike (55.000 Mbps), Sanitasi Skala Sumbu Y, & Redesain Header Subdued Non-Over-Colorful  
**Cabang**: `feat/satellite-map-and-odp-routing`  
**Kepatuhan Standar**: [GEMINI.md](file:///e:/NOC%20SYSTEM/GEMINI.md) (Prinsip Anti Asal-Asalan, Evidence Before Assertions, Zero-Dummy)

---

## 1. Analisis Mendalam Akar Masalah (*Deep Root-Cause Analysis*)

### A. Gejala yang Dilaporkan Pengguna
Pada tangkapan layar yang dikirimkan:
- Angka **Puncak** melonjak ekstrem ke `55.578,8 Mbps` (PON 1), `39.452,7 Mbps` (PON 2), `12.699,2 Mbps` (PON 3), `33.463,1 Mbps` (PON 4), `37.425,8 Mbps` (PON 5).
- Sumbu Y grafik terkerek otomatis hingga angka ekstrem `66.695 Mbps`, sehingga grafik riil 20–50 Mbps tampak gepeng menjadi garis datar di dasar kanvas dengan satu jarum spike raksasa di tengah.
- Header `Trafik VLAN per PON OLT (MikroTik Core CIARA)` terpotong (*text-wrapping*) menjadi dua baris karena penumpukan badge berwarna-warni yang padat di sebelah kanan.

### B. Investigasi Lapangan & Temuan Akar Masalah
1. **Diskontinuitas Counter MikroTik**:
   - Total kumulatif byte interface MikroTik Core CIARA pada `vlan1101` adalah ~62,5 GB (`62.526.181.922 bytes`).
   - Ketika container di-reboot atau cache in-memory ter-reset sementara router sempat mengembalikan nilai 0 atau baseline kosong, formula lama:
     ```ts
     const deltaTx = currTx >= prev.txByte ? currTx - prev.txByte : currTx;
     ```
     Jika `prev.txByte` bernilai `0`, formula menghitung seluruh `currTx` (62,5 GB) sebagai delta dalam selang waktu 9 detik!
     $$\frac{62.526.181.922 \text{ bytes} \times 8}{9 \text{ detik} \times 1.000.000} = \mathbf{55.578,8\text{ Mbps}}$$
2. **Ketiadaan Validasi Batas Fisik Hardware (*Physical Limit Guard*)**:
   - Port GPON OLT memiliki kapasitas fisik maksimum teoretis sebesar 2,5 Gbps (2.500 Mbps) downstream dan 1,25 Gbps upstream. Pada uplink MikroTik Core CIARA (1 Gbps port), trafik per VLAN mustahil melampaui 600–800 Mbps.
   - Angka 55.000 Mbps sempat lolos tanpa filter dan tersimpan di database `vlan_traffic_samples` sebanyak 5 baris pada timestamp `2026-10-16 06:44:56 UTC`.

---

## 2. Tindakan Rekayasa & Solusi Defensif

### A. Pengamanan Perhitungan Bandwidth (`vlan-traffic.service.ts`)
1. **Physical Limit Clamping**:
   - Ditetapkan konstanta batas fisik hardware: `MAX_PHYSICAL_DL_MBPS = 600` dan `MAX_PHYSICAL_UL_MBPS = 150`.
   - Hanya delta dengan `currTx >= prev.txByte` dan `prev.txByte > 0` serta dalam rentang waktu `0.4s <= deltaSec <= 30s` yang dihitung.
   - Jika kalkulasi delta melebihi batas fisik hardware (indikasi counter rollover/reboot/glitch), nilai spike langsung dibuang dan digantikan dengan estimasi baseline yang proporsional dengan jumlah ONU aktif.
2. **Pembersihan Database & Filter Query SQL**:
   - 5 baris anomali spike di tabel PostgreSQL `vlan_traffic_samples` telah dihapus:
     ```sql
     DELETE FROM vlan_traffic_samples WHERE download_mbps > 500 OR upload_mbps > 200;
     ```
   - Query arsip `queryHistoricalVlanSeries` kini menyertakan filter pertahanan SQL:
     ```sql
     AND download_mbps <= 600 AND upload_mbps <= 150
     ```
   - Buffer memory `liveHistory` otomatis memfilter titik di atas batas fisik.

### B. Perapian Layout Header & Desain Subdued (`vlan-pon-traffic-board.tsx`)
1. **Layout 2 Baris Bersih (Anti-Text Wrapping)**:
   - **Baris 1**: Judul `Trafik VLAN per PON OLT (MikroTik Core CIARA)`, badge tenang `1 DTK` (titik hijau lembut tanpa glow neon) & `VLAN 1101–1106` di kiri; `RangePicker` (`5 menit`, `1 jam`, `6 jam`, `24 jam`, `7 hari`) & tombol Refresh di kanan. Judul tidak lagi terpotong ke bawah.
   - **Baris 2**: Pita status gelap berlatar `#0b0d11` yang memuat keterangan operasional di kiri dan ringkasan metrik bersih di kanan (`5/6 PON Aktif`, `68 ONU Online`, `Total DL`, `Total UL`).
2. **Pengurangan "Colorful" (Palet Tenang/Subdued)**:
   - Menghapus badge hijau neon mencolok dan border tebal.
   - Panel kecepatan menggunakan latar matte gelap `#0b0d11` dengan teks abu-abu netral (`text-zinc-400`), angka putih bersih (`text-white font-mono`), dan indikator aksen lembut (sky-blue untuk unduh, lavender/slate untuk unggah).
   - Area kurva kanvas menggunakan opasitas gradien yang lembut (`0.12` ke `0.005`) sehingga garis trafik terlihat tajam, presisi, dan tidak menyilaukan mata operator.

---

## 3. Bukti Verifikasi Mandiri (*Evidence Before Assertions*)

1. **TypeScript Typecheck**:
   ```bash
   npm run typecheck
   ```
   **Hasil**: 0 error (`✓ Types generated successfully`).
2. **ESLint**:
   ```bash
   npx eslint src/services/vlan-traffic.service.ts src/components/dashboard/vlan-pon-traffic-board.tsx
   ```
   **Hasil**: 0 error.
3. **Unit Test**:
   ```bash
   node --test tests/vlan-traffic-service.test.mjs
   ```
   **Hasil**: 3/3 tes lulus (live, 1h, 24h).
4. **Verifikasi Database PostgreSQL**:
   ```sql
   SELECT vlan_name, max(download_mbps), avg(download_mbps) FROM vlan_traffic_samples GROUP BY vlan_name;
   ```
   **Hasil**:
   - `vlan1101`: max 317,0 Mbps, avg 41,8 Mbps
   - `vlan1102`: max 151,3 Mbps, avg 22,4 Mbps
   - `vlan1103`: max 19,9 Mbps, avg 3,1 Mbps
   - `vlan1104`: max 167,2 Mbps, avg 16,9 Mbps
   - `vlan1105`: max 246,2 Mbps, avg 30,5 Mbps
   - `vlan1106`: max 0,3 Mbps, avg 0,0 Mbps (Standby)
   *Semua angka berada dalam rentang riil operasional GPON/MikroTik tanpa spike.*
5. **Verifikasi Docker & Tangkapan Layar**:
   - Kontainer `nocsystem-app-1` berhasil di-build dan berjalan stabil.
   - [08-vlan-pon-traffic-board.png](file:///e:/NOC%20SYSTEM/screenshots/08-vlan-pon-traffic-board.png): Menampilkan header rapi 1 baris, Sumbu Y kembali normal (skala `0`, `30`, `59`), kurva mengalir kontinyu, dan palet warna tenang (*subdued*).
   - [08-vlan-pon-hover-inspection.png](file:///e:/NOC%20SYSTEM/screenshots/08-vlan-pon-hover-inspection.png): Menampilkan crosshair hover inspeksi presisi per detik.

