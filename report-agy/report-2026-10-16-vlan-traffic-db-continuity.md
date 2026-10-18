# Laporan Rekayasa: Kontinuitas Database & Eliminasi Reset Refresh pada Grafik Trafik VLAN & Utama

Tanggal: 16 Oktober 2026  
Status: Terverifikasi Penuh (Zero-Dummy & Persistent)  
Evidence: `screenshots/vlan/01-initial-continuity.png`, `screenshots/vlan/02-after-refresh-continuity.png`

---

## 1. Ringkasan Masalah (Root-Cause Analysis)
Sebelum perbaikan:
1. **Reset Grafik VLAN Saat Refresh**:
   - Buffer data streaming live VLAN (`vlanHistoryBuffer`) hanya disimpan pada in-memory Node.js runtime.
   - Ketika pengguna menekan **F5 (Refresh)** atau peramban membuka ulang sesi, in-memory buffer kosong (`[]`).
   - Kode lama kemudian menghasilkan deret gelombang sintetis (`Math.sin(...)`) sebelum akumulasi live baru terkumpul, sehingga grafik terputus, melonjak, atau mereset dari nol.
2. **Koneksi Delta Cache Hilang**:
   - `vlanPrevCache` (penyimpan `rxByte`, `txByte`, `timestamp`) hilang dari memori saat refresh, menyebabkan perhitungan delta byte pada request pertama setelah refresh gagal menentukan baseline fisik counter interface MikroTik.
3. **Grafik Trafik Utama Kosong Saat Mount Awal**:
   - Store Zustand `traffic.times` di frontend mulai dari 0 titik, membutuhkan 5 menit agar garis grafik terisi penuh jika riwayat database tidak dimuat terlebih dahulu saat mount.
4. **Kekosongan Background Collector**:
   - Pengambilan telemetri VLAN hanya terpicu saat ada tab peramban aktif yang melakukan polling HTTP. Ketika tab ditutup, penyimpanan ke `vlan_traffic_samples` berhenti.

---

## 2. Solusi Rekayasa & Implementasi Kode

### A. Preloading Histori Database Riil (`src/services/vlan-traffic.service.ts`)
- Menambahkan fungsi `queryRecentLiveVlanSamples(vlanName, count)`:
  - Melakukan query langsung ke PostgreSQL:
    ```sql
    SELECT floor(extract(epoch FROM sampled_at))::bigint AS ts,
           download_mbps, upload_mbps, rx_bytes, tx_bytes
    FROM vlan_traffic_samples
    WHERE vlan_name = $vlanName AND download_mbps <= 600 AND upload_mbps <= 150
    ORDER BY sampled_at DESC
    LIMIT 60;
    ```
  - Memulihkan buffer `liveHistory` secara instan dengan 60 titik riil terakhir terurut kronologis (`.reverse()`).
  - Memulihkan `vlanPrevCache` dari rekaman sampel database terakhir (`rx_bytes`, `tx_bytes`, `timestampMs`) sehingga perhitungan delta laju data tidak mengalami lompatan palsu.

### B. Synchronous Database Persistence & Daemon 24/7
- Mengubah penyimpanan `persistLiveVlanSamples(samplesToPersist)` dari asynchronous lepas (`void ...`) menjadi `await ...` sebelum respons HTTP dikembalikan ke klien.
- Mengimplementasikan `startVlanBackgroundCollector()`:
  - Berjalan setiap 2 detik di background daemon Node.js menggunakan `.unref()` (agar tidak menahan proses testing).
  - Menyimpan metrik counter MikroTik langsung ke database PostgreSQL 24/7 tanpa ketergantungan tab peramban.
- Mendaftarkan collector pada startup aplikasi melalui `src/instrumentation.ts`.

### C. Preloading Trafik Jaringan Utama (`src/components/dashboard/traffic-panel.tsx`)
- Pada saat komponen `TrafficPanel` di-mount dengan kondisi live dan `trafficTimes.length === 0`, memanggil `loadLiveTrafficHistory("live")` (`/api/v1/traffic/history?range=5m`).
- Grafik utama langsung terisi 60 titik riil 5 menit terakhir dari tabel `traffic_samples` sejak detik pertama refresh.

---

## 3. Hasil Pengujian & Gerbang Verifikasi Mandiri

### 1. Uji Kontinuitas Playwright & Database (`scripts/verify-traffic-refresh-continuity.mjs`)
```
=== STEP 1: Memeriksa Jumlah Baris Database vlan_traffic_samples ===
Database count sebelum test: 17971, latest timestamp: Fri Oct 16 2026 16:56:25 GMT+0700

=== STEP 2: Meluncurkan Browser & Login ===

=== STEP 3: Memastikan /api/traffic/vlans Mengembalikan Histori Lengkap ===
VLAN items count: 6
VLAN 0 (vlan1101): series length = 60
Sampel seri terakhir sebelum refresh: [{"timestamp":1792144587,"timeLabel":"16.56.27","downloadMbps":16,"uploadMbps":3.6},...]

=== STEP 4: Melakukan REFRESH HALAMAN (F5 / page.reload()) ===
=== STEP 5: Verifikasi Data Kontinu Langsung Setelah Refresh ===
Setelah Refresh: VLAN 0 (vlan1101): series length = 60
Sampel awal setelah refresh: [{"timestamp":1792144481,"timeLabel":"16.54.41",...}]
Sampel akhir setelah refresh: [{"timestamp":1792144591,"timeLabel":"16.56.31","downloadMbps":46,"uploadMbps":7}]
✓ SUKSES: Series VLAN langsung terisi 60 titik dari database PostgreSQL tanpa reset ke 0!
Database count setelah refresh: 18085, latest timestamp: Fri Oct 16 2026 16:56:34 GMT+0700
Jumlah baris sampel baru yang berhasil di-commit: +114
=== SEMUA VERIFIKASI SELESAI DENGAN SUKSES ===
```

### 2. Standar Kualitas Kode (TypeScript & ESLint)
- `npm run typecheck`: **0 errors** (`✓ Types generated successfully`).
- `npx eslint`: **0 errors** pada seluruh berkas yang dimodifikasi.
- `node --test tests/vlan-traffic-service.test.mjs`: **3/3 passed** (902ms).
- `docker compose build app`: Kompilasi sukses dengan Turbopack.
- `docker compose up -d --no-deps app`: Kontainer `nocsystem-app-1` berjalan sehat (`healthy`).

