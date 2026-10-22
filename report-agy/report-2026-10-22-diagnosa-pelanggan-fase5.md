# Diagnosa Pelanggan Berlapis — Fase 5 (Jalur Hulu)

Tanggal: 2026-10-22. Acuan: `deteksi-anomali-pelanggan-PRD.md` Fase 5. Aturan pengikat: pengukuran hulu dari router, bukan dari peramban atau server aplikasi.

## Kondisi hulu router Core CIARA (GET + perintah ukur)

- Satu default route statis aktif lewat `ether2-lan0` (komentar `UPLINK`), link-ok 1 Gbps, 0 link-down.
- BGP: tidak ada connection maupun session.
- IPv6: hanya link-local; tanpa pool, DHCPv6, maupun default route `::/0`. IPv6 tidak dilayankan ke pelanggan.
- Ping dan `ethernet/monitor` tersedia lewat REST (POST, tidak mengubah konfigurasi).
- Riwayat uplink **sudah ada**: `traffic_samples` adalah arsip per detik dari backend Go untuk antarmuka berkomentar `UPLINK` (rx = unduh), sekitar 86 ribu baris per 24 jam. Karena itu tidak dibuat tabel `uplink_samples` baru.

## Yang dibangun (lapisan Hulu)

| Temuan | Sumber | Ambang |
| --- | --- | --- |
| Default route & link uplink | `/ip/route`, `/interface`, `ethernet/monitor` | route aktif, link-ok |
| Utilisasi uplink sekarang | 2 sampel counter, kapasitas dari `rate` monitor | < 80% (fail ≥ 95%) |
| Kualitas ke hop ISP | `/tool/ping` ke gateway, 10 paket | loss < 1%, rtt ≤ 20 ms, jitter ≤ 20 ms |
| Kualitas ke internet | `/tool/ping` 8.8.8.8, 10 paket | loss < 1%, rtt ≤ 80 ms, jitter ≤ 20 ms |
| Uplink di sekitar keluhan | `traffic_samples` ±15 menit, rata-rata 24 jam | puncak < 80% kapasitas |
| Beban berbagi | trafik pelanggan saat keluhan vs rata-ratanya sendiri, digabung dengan uplink jenuh | fail bila turun > 50% saat uplink jenuh |
| BGP | `/routing/bgp/{connection,session}` | semua peer established |
| IPv6 | `/ipv6/address`, `/ipv6/route ::/0`, binding DHCPv6-PD pelanggan | route aktif + prefix pelanggan |

Aturan pembacaan:
- Hop yang tidak membalas ICMP sama sekali ditandai "tidak dapat diperiksa", bukan gagal.
- Hulu dibaca juga saat pelanggan offline.
- Kesimpulan di lapisan Hulu menandai run `is_shared_fault` dan menampilkan "Gangguan bersama di sisi hulu: bukan masalah perangkat pelanggan".
- `MikrotikRestClient.measure` hanya mengizinkan `/tool/ping` dan `/interface/ethernet/monitor`.
- Waktu tiap bacaan dicatat (`gapOf`), sehingga laju dihitung dari selang nyata.

## Bukti uji

- Unit `tests/diagnostics-phase5.test.mjs` (baris ping asli router) + fase sebelumnya: 46/46. Integrasi: 7/7.
- Live TERI RAYA:
  - uplink link-ok 1 Gbps, utilisasi 14%;
  - hop ISP loss 0%, 2,4 ms, jitter 2,7 ms;
  - 8.8.8.8 loss 0%, 22,2 ms;
  - puncak uplink ±15 menit 33% (898 sampel);
  - beban berbagi normal;
  - BGP tidak dipakai, IPv6 tidak dilayankan.
  - Satu diagnosa ±5,8 detik.
- `npm run typecheck`, `npx eslint`, `npm run build`: bersih. Berkas diagnosa diformat prettier.

## Batasan

- Jalur BGP dan IPv6 hanya diuji dengan data buatan, karena router produksi tidak memakainya. Nama field mengikuti RouterOS 7 (`established`, `prefix-count`, `remote.address`).
- Tujuan ping internet tetap 8.8.8.8.
- Kalau antarmuka UPLINK tidak ditemukan backend, arsip trafik jatuh ke jumlah queue.
- Penahan gangguan massal pemicu otomatis belum memakai uplink/BGP (masih jumlah alert); dirapikan di Fase 8.
- Uji live menulis 1 baris riwayat "Verifikasi Fase 5 (Claude)".
