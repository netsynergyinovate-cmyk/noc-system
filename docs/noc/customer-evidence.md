# Bukti keluhan pelanggan (1 hari – 3 bulan)

Tujuan: pelanggan bilang "ngelag sudah 3 hari" → operator punya bukti kapan koneksinya down/up dan bagaimana trafiknya di jam sibuk. Rentang: 1 hari (`24h`), 3 hari (`3d`), 7 hari (`7d`), 1 bulan (`30d`), 3 bulan (`90d`). Semua hari/jam dihitung WIB.

## Data yang disimpan

| Data | Tabel | Penulis | Retensi |
| --- | --- | --- | --- |
| Trafik per pelanggan, bucket 5 menit | `customer_traffic_samples` | Go `archive/customer.go` | 400 hari |
| Naik/turun koneksi per pelanggan | `customer_connection_events` (migrasi 0038) | Go `collector/online_writer.go` | 400 hari |
| Alert (offline, optik, dst.) | `alerts` | Go rule engine | tidak dihapus |

Syslog (14 hari) dan NetFlow (7 hari) TIDAK ikut dijadikan bukti 3 bulan; masa simpannya diatur `SYSLOG_RETENTION_DAYS` / `NETFLOW_RETENTION_DAYS` bila ingin lebih panjang (ukuran tabel naik besar).

## Batas bukti (jujur)

- `customer_connection_events` hanya menulis saat jenisnya berbeda dari kejadian terakhir pelanggan itu. Backend Go yang mati tidak melihat perpindahan, jadi log bisa berlubang.
- Migrasi 0038 mengisi riwayat awal dari alert `offline` (`source='alert'`): down = `started_at`, up = `ended_at`. Waktunya mengikuti deteksi alert, bukan saat sesi putus; UI memberi lencana "dari alert".
- Trafik baru ada sejak backend mulai mengarsip; `coverage.notes` menyebut tanggal mulai data dan kapan bukti terpotong. Bucket kosong = pelanggan tidak punya queue aktif (offline) atau backend mati.
- Analisis jam sibuk tidak membandingkan dengan paket (batas paket hanya terbaca langsung dari router); ia membandingkan pelanggan dengan dirinya sendiri di luar jam sibuk.

## Jam sibuk (WIB)

Satu-satunya definisi: `peakWindows` di `src/lib/customer-evidence-types.ts`. Bawaan: Siang 11:00–12:30, Pulang sekolah 12:30–15:30, Sore pulang kerja 15:30–17:30, Menjelang magrib – malam 17:30–23:00; sisanya "Di luar jam sibuk".

## Kode

- `src/lib/customer-evidence.ts`: logika murni `buildCustomerEvidence` (gangguan dipecah per batas jendela/hari WIB, rata-rata berbobot jumlah sampel, p95, temuan deterministik tanpa persentase keyakinan).
- `src/services/customer-evidence.service.ts`: query; `GET /api/customers/{id}/evidence?range=24h|3d|7d|30d|90d` → `{ data: CustomerEvidence }`.
- `GET /api/customers/{id}/traffic?range=live|24h|3d|7d|30d|90d`: grafik trafik; 3d per 15 menit, 90d per 6 jam.
- UI: `customer-evidence-panel.tsx` (anchor `#bukti` di `/app/pelanggan/{id}`, tombol "Bukti 3 hari" di panel diagnosa `/app/anomali`), ringkasan salin via `src/lib/customer-evidence-text.ts`.
- Tes: `tests/customer-evidence.test.mjs`, `tests/customer-evidence-text.test.mjs`; Go `online_writer*_test.go`.

## Gangguan nyata (angka yang dihitung)

Kejadian putus mentah dari `customer_connection_events` berisik (satu pelanggan bisa punya ratusan "putus" dari mesin alert yang naik-turun). Angka "jumlah gangguan" TIDAK dihitung dari situ, melainkan dari insiden. Aturan satu-satunya ada di komentar `src/lib/customer-evidence-types.ts` dan dijalankan `src/lib/customer-incidents.ts` (fungsi murni yang SAMA dipakai daftar per pelanggan dan rincian pelanggan, jadi angkanya tidak bisa berbeda):

1. Putus yang jaraknya ≤ 15 menit digabung jadi satu insiden.
2. Insiden dihitung bila total down ≥ 5 menit atau ≥ 3 putus mentah; sisanya "kedipan" (dicatat, tidak dihitung).
3. Verifikasi dengan trafik pelanggan: queue dinamis hanya ada saat sesi PPPoE hidup. Bucket 5 menit yang tumpang tindih dengan detik down tidak boleh punya sampel lebih dari (300 − detik down di bucket) + 60. Bila putusnya berasal dari alert (akhir alert = deteksi poll, bisa telat dari sambung ulang sebenarnya), toleransinya 180. Terlampaui = **tidak terbukti** (trafik tetap mengalir). **Terbukti** juga butuh sampel trafik tepat sebelum mulai dan sesudah akhir (≤ 10 menit); tanpa itu = **belum terverifikasi**.
4. Yang masih berjalan atau berakhir < 10 menit lalu belum final dan belum dihitung.
5. Cakupan **massal**: ≥ 3 pelanggan lain di router yang sama down bersamaan dan ≥ 20% pelanggan router itu; selain itu "sendiri".

Angka stabil antar rentang: pengelompokan selalu dilakukan atas 400 hari riwayat (`INCIDENT_LOOKBACK_SECONDS`), baru dipilih menurut rentang berdasarkan waktu mulai insiden. Jadi `real(1 hari) ≤ real(3 hari) ≤ … ≤ real(3 bulan)` dan satu insiden punya id dan status yang sama di semua rentang. Konsekuensi: badai putus-nyambung yang dimulai sebelum data trafik ada (sebelum 22 Okt di produksi) menjadi satu insiden "belum terverifikasi", bukan puluhan gangguan.

- Daftar per pelanggan: `GET /api/anomalies/customer-incidents?range=` → `/app/anomali` (`customer-incident-list.tsx`, testid `customer-incident-list`).
- Rincian: `incidents` di `GET /api/customers/{id}/evidence`; grafik trafik per gangguan dari `GET /api/customers/{id}/incident-series?from=&to=` (`incident-detail-chart.tsx`).
- Tes: `tests/customer-incidents.test.mjs`.
