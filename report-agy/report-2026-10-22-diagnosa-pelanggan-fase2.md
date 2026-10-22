# Diagnosa Pelanggan Berlapis — Fase 2

Tanggal: 2026-10-22. Acuan: `deteksi-anomali-pelanggan-PRD.md` Fase 2. Lanjutan Fase 1 (`1dc144f`).

## Cara baca router

Satu snapshot router per diagnosa (`readRouter`), dipakai lapisan MikroTik, Firewall, dan Billing. Semua permintaan GET lewat `MikrotikRestClient.read` (path wajib `/rest/...`, filter `field=nilai` supaya router tidak mengirim seluruh tabel). Dibaca berurutan, tidak paralel, agar layanan www router produksi tidak dibanjiri. Penghitung dibaca dua kali dengan jarak 2 detik untuk menghitung laju dan delta.

Nama field diverifikasi dulu dengan probe GET ke router live Core CIARA (RouterOS 7), bukan ditebak:

| Data | Path | Field dipakai |
| --- | --- | --- |
| Sesi | `/ppp/active` | name, address, uptime, caller-id |
| Queue | `/queue/simple?name=<pppoe-USER>` | max-limit, rate, dropped, packets, disabled, dynamic, queue (format "unggah/unduh") |
| Antarmuka sesi | `/interface?name=<pppoe-USER>` | rx/tx-error, rx/tx-drop, last-link-up-time |
| VLAN PON | `/interface/pppoe-server?name=…` → `interface`; `/interface?name=vlan11xx` | rx/tx-byte |
| Bentrok IP | `/ip/arp?address=IP`, `/ip/dhcp-server/lease?address=IP` | interface, mac-address, server |
| Address-list | `/ip/firewall/address-list` | list, address (pool CIDR/rentang), disabled |
| Conntrack | `/ip/firewall/connection/tracking` | total-entries, max-entries |

## Temuan per lapisan

| Lapisan | Temuan | Ambang |
| --- | --- | --- |
| MikroTik | Batas kecepatan queue (ada, aktif, dinamis/statis) | queue ada dan aktif |
| MikroTik | Pemakaian terhadap batas (unduh/unggah) | < 95% (sama dengan aturan anomali queue) |
| MikroTik | Paket dibuang antrean, % dari paket | < 1% |
| MikroTik | Error & drop antarmuka PPPoE (delta 2 dtk) | 0 |
| MikroTik | Laju jalur PON VLAN | < 80% dari 1000 Mbps (EPON 1G, shortcut) |
| MikroTik | Bentrok IP ARP/DHCP | 0 entri lain |
| Firewall | Address-list yang memuat IP (cek CIDR/rentang) | bukan daftar isolir/blokir |
| Firewall | Tabel connection tracking | < 75% |
| ONT | Laporan terakhir ke ACS | ≤ 15 menit, lebih lama = basi, isi lain tidak dinilai |
| ONT | WAN PPPoE di modem | Connected |
| ONT | Uptime modem | ≥ 10 menit |
| ONT | Perangkat terhubung | konteks |
| ONT | Rx optik sisi modem vs OLT | -24..-8 dBm, selisih ≤ 3 dB |
| Billing | Status RunsNet (fallback `billing_status`) | Active |
| Billing | Tagihan lewat jatuh tempo | 0 |
| Billing | Kecocokan billing dengan router (isolir di address-list) | selaras |
| Billing | `billing_mismatches` sinkron Go terakhir | 0 |

Fakta lingkungan: `billing_status` dan `billing_sync_runs` kosong di produksi; billing nyata ada di RunsNet. Karena itu temuan `billing_mismatches` selalu "tidak dapat diperiksa" sampai sinkron Go berjalan, dan kecocokan dicek lewat RunsNet ↔ router.

Kesimpulan: untuk tingkat "bermasalah", billing tetap paling depan (isolir/putus pasti menjelaskan). Untuk "peringatan", billing paling belakang, supaya tunggakan tidak menutupi queue penuh.

## Bukti uji

- Unit `tests/diagnostics.test.mjs` + `tests/diagnostics-phase2.test.mjs`: 24/24 lulus (payload uji = bentuk asli dari router).
- Integrasi `tests/diagnostics-service.test.mjs` di PostgreSQL 17 sekali pakai: 6/6 lulus (RunsNet aktif + tunggakan, router tak terbaca, GenieACS simulator).
- Diagnosa live TERI RAYA (Core CIARA, OLT HSGQ PON 2/ONU 2, GenieACS GM220-S, RunsNet 17060001120), selesai 2,3 detik: sesi aktif, queue 10/10 Mbps dinamis, VLAN1102 2%, tanpa bentrok IP, address-list POOL-BRAS-RUNSNET (bukan isolir), conntrack 1%, Rx OLT = Rx ONT -16.58 dBm, WAN Connected, 5 perangkat, billing Active tanpa tunggakan. Run kedua menangkap pemakaian 96% + drop 5% → kesimpulan "kecepatan paket habis, bukan gangguan jaringan".
- Perbaikan dari uji live: drop semula dinilai dengan jumlah mentah (192 paket = peringatan saat pemakaian 38%); sekarang dinilai sebagai persen dari paket.
- `npm run typecheck`, `npx eslint` berkas terkait, `npm run build`: bersih.

## Batasan

- Kapasitas PON dianggap 1000 Mbps (EPON 1G) untuk semua VLAN PON.
- Penghubung ke modem: query `WANPPPConnection.1` dulu, lalu cadangan memindai semua perangkat GenieACS (berat bila armada besar).
- Address-list di atas 20.000 entri tidak dibaca utuh (ditandai tidak terperiksa).
- Diagnosa live verifikasi menulis 2 baris riwayat bertanda "Verifikasi Fase 2 (Claude)".
