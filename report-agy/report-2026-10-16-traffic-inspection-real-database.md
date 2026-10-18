# Laporan Rekayasa: Detail Jam & Mbps Real-Time per Detik & Tersimpan Database (5 Menit, 1 Jam, 6 Jam, 24 Jam, 7 Hari)

**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI & TERVERIFIKASI  
**Metodologi**: Gemini & Claude Code Cadence (`GEMINI.md`)  
**Lingkungan**: MikroTik RouterOS v7 (`Core CIARA`), HSGQ OLT (`HSGQ CORE 8 PON`), PostgreSQL TimescaleDB (`traffic_samples`), Go WebSocket Daemon & REST API, Next.js 16.3.4 (Standalone Container).

---

## 1. Ringkasan Kebutuhan & Akar Masalah

Pengguna menginstruksikan:
> *"Untuk trafik 5 menit, 1 jam dan lainnya itu harus real tersimpan dan kalao jalannya perdetik ada detail jam dan mbpsnya di tarfiknya dalam bar berarti bisa untuk 5 menit dan 1 jam dan seterusnya"*

### Analisis Akar Masalah:
1. **Penyimpanan Database**:
   - Seluruh sampel trafik per detik dari MikroTik `Core CIARA` disimpan secara kontinu ke tabel PostgreSQL `traffic_samples` (>146.000 baris aktif).
   - Backend Go sebelumnya hanya mengekspos range: `1h`, `6h`, `24h`, `7d`, `30d`. Belum mendukung `5m` pada REST API histori (`/api/v1/traffic/history?range=5m`), sehingga rentang 5 menit murni bergantung pada in-memory WebSocket ring buffer.
2. **Detail Jam & Mbps di Bar**:
   - Angka kartu ringkasan sebelumnya hanya menampilkan status statis `(sekarang)` atau `(terakhir)`. Tidak ada timestamp jam:menit:detik (`HH:mm:ss WIB`) yang sinkron dengan titik sampel.
   - Saat kursor operator melakukan hover/inspeksi di kanvas grafik trafik (uPlot), kartu kecepatan di atasnya tidak bereaksi memperbarui angka Mbps dan jam titik yang sedang ditunjuk.

---

## 2. Tindakan Rekayasa & Solusi Arsitektural

### A. Dukungan Histori 5 Menit Berbasis Database di Backend Go
- Memperluas `historyRanges` di `backend/internal/httpapi/history.go`:
  ```go
  var historyRanges = map[string]time.Duration{
      "5m":  5 * time.Minute,
      "1h":  time.Hour,
      "6h":  6 * time.Hour,
      "24h": 24 * time.Hour,
      "7d":  7 * 24 * time.Hour,
      "30d": 30 * 24 * time.Hour,
  }
  ```
- Algoritma `historyStep` secara otomatis memilih `step = 1 detik` untuk span 300 detik (300 titik data riil dengan resolusi 1 detik).
- Menambahkan kasus uji unit di `backend/internal/httpapi/history_test.go`:
  `{"5m", 5 * time.Minute, 1, 300, 300}`.
- Memperbarui `loadLiveTrafficHistory` di `src/lib/dashboard/history-live.ts` agar mendukung pemanggilan `rangeId = "live"` yang otomatis memetakan ke query `5m` dari backend Go / database.

### B. Inspeksi Interaktif & Telemetri Jam/Detik Riil di Bar
1. **Komponen Grafik uPlot (`src/components/dashboard/traffic-chart.tsx`)**:
   - Menambahkan kontrak antarmuka `InspectedTrafficPoint`:
     ```ts
     export interface InspectedTrafficPoint {
       time: number;
       rx: number;
       tx: number;
     }
     ```
   - Menambahkan hook callback `onInspect?: (point: InspectedTrafficPoint | null) => void` pada `tooltipPlugin` dan kontainer `TrafficChart`.
   - Tooltip kursor menampilkan waktu berpresisi detik (`HH.mm.ss WIB` atau `DD MMM, HH.mm WIB`), laju unduh, dan unggah dalam Mbps.
2. **Komponen Bar Statistik (`src/components/dashboard/traffic-panel.tsx`)**:
   - `SeriesStat` dan `StatsGrid` kini menerima `inspectedPoint` dan `labelSuffix`.
   - Menampilkan label dinamis dengan mempertahankan token eksak untuk kompatibilitas pengujian:
     - Mode Live: `sekarang (HH:mm:ss WIB)`
     - Mode Histori: `terakhir (HH:mm:ss WIB)`
     - Mode Inspeksi: `titik (HH:mm:ss WIB)` disertai highlight border hijau emerald dan angka Mbps titik terpilih.
3. **Penyatuan Dashboard (`src/components/dashboard/noc-dense-dashboard.tsx`)**:
   - Header bar trafik dilengkapi status bar inspeksi terdedikasi:
     `[Titik: 12.29.30 WIB • Unduh 129,8 Mbps • Unggah 9,3 Mbps]`
   - Badge `1 DTK` dengan pulsing dot menandakan streaming real-time per detik aktif.
   - Preload otomatis 5 menit riil dari PostgreSQL saat halaman pertama kali dibuka, menjamin grafik langsung terisi penuh 300 detik tanpa menunggu websocket buffering.

---

## 3. Bukti Verifikasi & Pengujian Mandiri

### A. Pengujian Backend Go
```powershell
npm run backend:check
# Hasil: PASS (go vet ./... && go test ./... - 100% lolos)
```

### B. Pengujian Statis TypeScript & ESLint
```powershell
npm run typecheck
# Hasil: 0 errors (next typegen && tsc --noEmit sukses)

npx eslint src/components/dashboard/traffic-chart.tsx src/components/dashboard/traffic-panel.tsx src/components/dashboard/noc-dense-dashboard.tsx src/lib/dashboard/history-live.ts
# Hasil: 0 errors, 0 warnings
```

### C. Pengujian Unit Test
```powershell
node --test tests/traffic*.test.mjs tests/use-realtime-feed.test.mjs
# Hasil: 26 passed, 0 failed
```

### D. Rekonstruksi & Runtime Kontainer Docker
```powershell
docker compose build backend; docker compose up -d --no-deps backend
docker compose build app; docker compose up -d --no-deps app
docker compose ps app
# Hasil: nocsystem-app-1 Up (healthy), port 3000 aktif
```

### E. Bukti Visual Tangkapan Layar (Browser Real-Time):
1. **5 Menit (Live 1 Detik)**: `screenshots/03-traffic-5m-inspection.png`
   - Kursor menunjuk detik `12.29.30 WIB`.
   - Bar header menampilkan: `Titik: 12.29.30 WIB • Unduh 129,8 Mbps • Unggah 9,3 Mbps`.
   - Kartu kecepatan menampilkan: `Unduh titik (12.29.30 WIB): 129,8 Mbps`, `Unggah titik (12.29.30 WIB): 9,3 Mbps`.
2. **1 Jam (Histori 10 Detik)**: `screenshots/04-traffic-1h-inspection.png`
   - Kursor menunjuk titik `12.06.40 WIB`.
   - Bar header & kartu kecepatan menampilkan: `Unduh 105,0 Mbps • Unggah 13,3 Mbps`.
3. **24 Jam (Histori 5 Menit)**: `screenshots/05-traffic-24h-inspection.png`
   - Kursor menunjuk titik `00.30.00 WIB`.
   - Bar header & kartu kecepatan menampilkan: `Unduh 43,5 Mbps • Unggah 3,9 Mbps`.
4. **7 Hari (Histori 30 Menit)**: `screenshots/06-traffic-7d-inspection.png`
   - Kursor menunjuk titik `15 Okt, 03.00 WIB`.
   - Bar header & kartu kecepatan menampilkan: `Unduh 11,2 Mbps • Unggah 4,0 Mbps`.
5. **Verifikasi 1 Jam Bergerak Kontinu (Auto-Refresh & Rolling Engine)**:
   - `screenshots/07-traffic-1h-t0.png`: Kecepatan unduh t0 = 132,1 Mbps.
   - `screenshots/07-traffic-1h-running.png`: Kecepatan unduh t+6s = 132,0 Mbps (menandakan histori 1 jam bergulir dan ter-refresh otomatis mengikuti sampel real-time database).
   - `screenshots/07-traffic-1h-inspected.png`: Inspeksi titik `12.28.00 WIB` menghasilkan laju unduh 92,1 Mbps dan unggah 7,5 Mbps secara presisi di bar header dan kartu indikator.


