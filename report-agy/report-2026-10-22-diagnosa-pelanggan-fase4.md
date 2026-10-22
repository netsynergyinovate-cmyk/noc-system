# Diagnosa Pelanggan Berlapis — Fase 4 (Audit Firewall & NAT)

Tanggal: 2026-10-22. Acuan: `deteksi-anomali-pelanggan-PRD.md` Fase 4 dan aturan arsitektur "fasttrack diperiksa sebelum queue".

## Konfigurasi router asli (GET baca-saja, Core CIARA)

- filter 19 rule, raw 0, nat 11, mangle 0. Tidak ada rule fasttrack (statis maupun dinamis). Queue pelanggan tanpa `packet-marks`.
- `/ip/firewall/connection?src-address=IP` menyaring per IP dengan akurat; `.proplist=fasttrack,connection-mark,protocol` memangkas respons 24 KB jadi 2 KB.
- Temuan konfigurasi (dilaporkan, tidak diubah):
  - filter #1/#2 `RUNSNETISOLIR` nonaktif;
  - NAT redirect #2 memakai address-list `RUNSNETISOLIR` yang tidak ada;
  - NAT redirect #4 pool isolir memakai protokol **udp** ke port 80/443 (halaman web = tcp);
  - masquerade #3 (`src POOL-BRAS-RUNSNET` → `dst POOL-BRAS-RUNSNET-ISOLIR`) tidak pernah kena.

## Cara audit

`ruleScope` menilai tiap rule terhadap pelanggan dari dua arah:
- **khusus**: menyebut IP, address-list, atau antarmuka pelanggan, atau port forward `to-addresses` ke IP pelanggan;
- **umum**: berlaku untuk semua;
- **mungkin**: bersyarat interface-list, mark, MAC, atau layer7 yang tidak bisa dinilai dari luar.

Aturan tambahan:
- Chain `input`, `srcnat`, dan `dstnat` dinilai dengan pelanggan sebagai pengirim saja; `output` sebagai tujuan.
- Rule yang lawannya hanya jaringan privat (modem manajemen, OLT, VPN) tidak dihitung umum.
- Rule umum hanya dicantumkan bila aksinya menentukan nasib trafik (drop, NAT, fasttrack, mark, dan sejenisnya).

## Temuan (lapisan Firewall)

| Temuan | Status buruk bila |
| --- | --- |
| Fasttrack (rule + koneksi `fasttrack=true`) | ada; temuan queue di lapisan MikroTik ikut diturunkan menjadi peringatan "TIDAK dieksekusi" |
| Rule filter yang memblokir | drop/reject khusus yang hit > 0 (fail); siaga dengan hit 0 (warn); juga dicatat drop yang tertutup accept di atasnya |
| Raw drop/notrack | raw drop khusus yang kena |
| NAT keluar | IP privat tanpa masquerade/src-nat; rule pertama yang cocok ditampilkan |
| Port forward & redirect | port forward ke pelanggan yang ditutupi rule lain (sama protokol & port) |
| Mangle & mark | queue memakai packet-mark yang tidak dipasang mangle |
| Koneksi pelanggan | ≥ 3.000, atau connection tracking mati |
| Rule khusus yang tidak pernah kena | informasi (`is_stale`) |

Potret disimpan di `firewall_snapshots` (fasttrack, jumlah koneksi, conntrack total/max, raw drop, address-list) dan `firewall_rule_hits` (tabel, chain, posisi, aksi, cakupan, syarat, hit, `is_stale`). UI menampilkannya sebagai tabel rule di lapisan Firewall.

## Bukti uji

- Unit `tests/diagnostics-phase4.test.mjs` (rule asli router, IP publik disamarkan) + fase sebelumnya: 38/38.
- Integrasi PostgreSQL sekali pakai (migrasi sampai 0035): 7/7.
- Live TERI RAYA: 0 dari 146 koneksi di-fasttrack; tidak ada blokir khusus (2 kebijakan umum: drop SMTP, hit 61); NAT keluar lewat masquerade; mangle tidak dibutuhkan; 1 rule khusus tidak pernah kena; 11 rule tersimpan.
- Live PPUI 05 MUKOMUKO: RunsNet **Isolir**, tetapi di router IP-nya di pool normal, tidak ada rule pembatas, dan 167 koneksi berjalan. Kecocokan billing-router: "isolir belum diterapkan".
- `npm run typecheck`, `npx eslint`, `npm run build`: bersih.

## Batasan

- Syarat port/protokol tidak dicocokkan ke koneksi nyata; "umum" berarti berlaku bila syarat portnya terpenuhi.
- Interface-list dan mark dinilai "mungkin", tidak ditebak.
- Uji live menulis 2 baris riwayat "Verifikasi Fase 4 (Claude)".
