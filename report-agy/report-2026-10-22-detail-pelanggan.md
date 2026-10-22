# Detail pelanggan + trafik per pelanggan + nama di alert (2026-10-22)

## Permintaan
Klik nama pelanggan menampilkan detail lengkap: CPE, nama Wi-Fi, trafik 5 menit / 7 hari / bulanan, pemakaian, dll. Semua data pelanggan bernama (dari billing) dan tertaut, termasuk alert/deteksi anomali/dasbor.

## Temuan awal (DB live)
- `customers`: 70 baris, semuanya sudah bernama dari RunsNet (0 yang nama = username).
- `runsnet_customers`: 74; 4 tidak ada di `customers` (2 Terminate, 1 Isolir, 1 terputus) karena pelanggan diimpor dari router, bukan dari billing.
- `alerts`: tiap alert pelanggan punya `customer_id` dan `location_name` = nama pelanggan. Nama hilang di UI karena `buildLiveDirectory` jatuh ke UUID bila store dashboard belum memuat pelanggan itu.
- `olt_onus`: 23 belum tertaut. Penyebab: kode ONU kembar di OLT (1396, 1467, 1557 masing-masing 2 ONU), ONU tanpa nama (`ONU0x/yy`), kode saja tanpa nama (`1798` = SIMUN), atau pelanggan tidak ada di `customers`.
- Trafik per pelanggan TIDAK pernah disimpan: `traffic_samples` hanya per router.

## Perubahan
- DB: tabel `customer_traffic_samples` (migrasi `0032_customer_traffic.sql`), satu baris per pelanggan per 5 menit: rata-rata/maks Mbps, perkiraan byte.
- Go: `archive/customer.go` merangkum laju simple queue `<pppoe-USERNAME>` (poll 1 dtk) ke bucket 5 menit, tulis tiap 30 dtk (upsert menjumlahkan), retensi 400 hari. Kait `PollerOptions.OnQueues` di poller, disambung di `cmd/server/polling.go`.
- API `GET /api/customers/{id}/traffic?range=live|24h|7d|30d` (sesi): live = laju + byte sesi dari queue router; histori = seri (5 mnt/30 mnt/2 jam) + pemakaian hari ini (WIB)/7 hari/bulan ini.
- Halaman `/app/pelanggan/[id]`: layanan & lokasi, ONU & optik, modem (CPE) & Wi-Fi (GenieACS, SSID, perangkat terhubung, tombol kelola CPE), trafik & pemakaian, billing RunsNet (paket, status, tagihan, bayar terakhir), riwayat alert. Nama di tabel pelanggan jadi tautan.
- `TrafficChart`: prop `followLive` (false = jangan tempel trafik router) dan `label`.
- Nama di alert/anomali: `buildLiveDirectory(..., items)` memakai `location.name` baris alert sebelum jatuh ke UUID.
- Pencocokan ONU: nama ONU berupa kode saja (`1798`) kini dicocokkan seperti `1798-NAMA` (tetap ditolak bila kode kembar).
- Dialog CPE: teks rusak (mojibake) "Mengirim perintah…" dan pemisah "·" diperbaiki.

## Bukti uji
- `go vet` + `go test ./internal/archive ./internal/collector`: ok.
- SQL upsert Go diuji di PostgreSQL 17 asli dalam transaksi ROLLBACK: rata-rata berbobot 4 Mbps (6×2 + 2×2)/4, maks 9, byte dijumlah, username asing dilewati.
- SQL histori/pemakaian diuji di DB asli (ROLLBACK): batas hari WIB = 17:00 UTC benar.
- `node --test tests/alerts-live.test.mjs tests/onu-name.test.mjs tests/onu-matcher.test.mjs`: 19/19 lulus.
- `npm run typecheck`: 0 error. `npx eslint` berkas yang diubah: 0 error.

## Batasan
- Histori trafik mulai terisi sejak backend baru jalan; tidak ada data mundur.
- Grafik "5 menit" diisi dari laju router tiap 3 dtk sejak halaman dibuka.
- Byte = perkiraan dari laju rata-rata RouterOS, bukan counter tagihan.
- 4 pelanggan billing tanpa sesi PPPoE di router tidak dibuat otomatis (router dan format username tidak diketahui).
- ONU berkode kembar butuh keputusan petugas di panel pemetaan ONU; ONU `1798` tertaut setelah "Cocokkan otomatis" dijalankan di Kelola OLT.
