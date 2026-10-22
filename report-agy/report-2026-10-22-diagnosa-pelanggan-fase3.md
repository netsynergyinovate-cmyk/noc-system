# Diagnosa Pelanggan Berlapis — Fase 3 (Log MikroTik & Korelasi Waktu)

Tanggal: 2026-10-22. Acuan: `deteksi-anomali-pelanggan-PRD.md` Fase 3.

## Fakta lapangan (GET baca-saja ke router Core CIARA)

- Router **tidak mengirim log ke mana pun**: action `remote` ada (0.0.0.0:514) tetapi tidak dipakai aturan logging mana pun.
- Buffer memori `/log` = 1000 baris, dan hanya mencakup **±13 menit** karena log PPPoE sangat ramai.
- Listener syslog backend Go **mati** di produksi (`SYSLOG_ADDR` kosong) dan sebelumnya hanya memakai baris PPP untuk status online, tanpa menyimpan.
- Router terdaftar dengan IP publik `103.167.70.136`, sedangkan log akan datang lewat WireGuard dari `10.20.30.1` (PC NOC `10.20.30.3`). Pencocokan sumber lama akan menolaknya.
- Jam router `Asia/Jakarta` (+07:00).
- Bentuk pesan asli (disamarkan) menjadi dasar pola: `USER logged in, IP from MAC`, `USER logged out, <dtk> … from MAC`, `<pppoe-USER>: could not determine remote address, using 0.0.0.0`, `<pppoe-USER> detect UNKNOWN`, `user Monitor logged in via api`, dan lain-lain.

## Yang dibangun

**Backend Go**
- `syslog_store.go`: setiap baris dari router dikenal disimpan ke `syslog_events` (antrean 10.000, batch per detik, insert `unnest`, retensi `SYSLOG_RETENTION_DAYS` bawaan 14 hari). Parser menerima PRI, header BSD atau RFC 5424, dan topik (boleh diakhiri `:`).
- `SYSLOG_SOURCE_MAP=ip=<uuid router>`: alamat pengirim tambahan per router. Alamat tak dikenal dicatat di log backend (paling sering sekali per 10 menit) supaya bisa dipetakan.
- `compose.yaml`: listener `0.0.0.0:5514`, `5514/udp` diterbitkan.

**Diagnosa (lapisan Log)**
- Sumber: `syslog_events` bila ada baris dalam 15 menit terakhir; bila tidak ada, buffer memori router `/log`, dengan cakupannya dinyatakan. Cakupan kurang dari 1 jam sebelum keluhan = "tidak dapat diperiksa".
- Baris pelanggan dicocokkan lewat username, MAC caller-id, IP sesi (persis), dan `link down/up` VLAN PON serta induknya (`/interface/vlan`).
- Temuan: sesi putus (≥3 = bermasalah), sesi tanpa alamat IP, login ditolak, link jalur turun, bentrok alamat, log firewall, dan jumlah baris rutin yang disaring beserta rinciannya.
- Derau disaring saat dibaca (`classifyLogLine`), bukan saat disimpan, supaya aturannya bisa ditinjau tanpa kehilangan data. Ini menggantikan kolom `is_noise` di PRD.

**Korelasi waktu**
- `diagnostic_runs.complaint_at`. Diagnosa manual bisa mengisi "Waktu keluhan (opsional)", maksimal 7 hari ke belakang. Pemicu alert memakai waktu mulai alert; tiket dan billing memakai saat dipicu.
- `diagnostic_runs.timeline` (jsonb) berisi kejadian log (60 terdekat dengan keluhan) dan alert pelanggan. Tampilan menunjukkan "X mnt sebelum/sesudah" dengan penanda "▶ Keluhan" di posisinya.

## Bukti uji

- Unit TS (3 berkas): 30/30. Fase 3 memakai pesan asli router.
- Integrasi PostgreSQL sekali pakai: 7/7, termasuk "syslog tersimpan dipakai, 4× putus = fail, 2 sebelum dan 2 sesudah keluhan, pelanggan lain tidak ikut".
- Go: `go test ./...` lulus, termasuk `TestSyslogWriterPostgres` (SQL `unnest` + retensi pada PostgreSQL nyata), listener UDP dengan peta sumber, dan konfigurasi.
- Live ALDI FAREZI (17060001103), sumber buffer router:
  - **52× putus dalam 13 menit**, sesi terpendek 4 dtk, `could not determine remote address` 52×;
  - billing RunsNet **Terminate**, 2 tagihan Rp 500.000;
  - kesimpulan: billing (layanan diputus), dan lapisan log menjelaskan gejala flapping-nya;
  - cakupan log ditandai tidak lengkap (20.03–20.16);
  - 287 baris rutin disaring; garis waktu 63 kejadian.
- `npm run typecheck`, `npx eslint`, `npm run build`: bersih.

## Aktivasi syslog (perlu tindakan operator)

1. `.env`: `SYSLOG_SOURCE_MAP=10.20.30.1=78e7f2cf-f489-416d-b46a-059709b7365b`, lalu `docker compose up -d --no-deps backend`.
2. Windows Firewall: izinkan UDP 5514 masuk dari 10.20.30.1 (antarmuka WireGuard `noc-acs`).
3. Router (ditulis sendiri oleh operator):
   ```
   /system logging action set [find name=remote] remote=10.20.30.3 remote-port=5514
   /system logging add topics=info action=remote
   /system logging add topics=error action=remote
   ```
4. Cek: `docker compose logs backend | grep syslog`. Bila muncul "alamat … dibuang", petakan alamat itu di `SYSLOG_SOURCE_MAP`.

## Batasan

- Antrean penyimpan penuh (lonjakan log) = baris dibuang dan dicatat.
- Paling banyak 5.000 baris relevan per diagnosa.
- Penahanan dan peringatan berbasis jumlah, belum berbasis baseline (Fase 7).
- Uji live menulis 1 baris riwayat "Verifikasi Fase 3 (Claude)".
