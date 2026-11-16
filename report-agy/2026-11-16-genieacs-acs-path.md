# 2026-11-16 — Runbook jalur ACS GenieACS (WireGuard ke port LAN MikroTik)

## Permintaan
GenieACS di server tersambung lewat WireGuard khusus, kelak pindah ke port LAN MikroTik
langsung ke server; pengguna mengusulkan toggle di halaman konfigurasi GenieACS dan
bertanya apakah WireGuard dipasang lewat Coolify.

## Keputusan
- Tanpa toggle di aplikasi: jalur = routing MikroTik + host server; aplikasi di container
  dan hanya-baca ke perangkat.
- ACS memakai satu IP layanan tetap `10.99.0.10` (`http://10.99.0.10:7547`), menempel di
  `wg-acs` (fase WireGuard) lalu di NIC LAN (fase LAN). Modem diubah ACS URL-nya sekali.
- WireGuard di host (`wg-quick@wg-acs`), bukan template Coolify `wg-easy`.
- Interface MikroTik baru `wg-acs` (13232/udp), WireGuard lama `10.167.80.1` tidak disentuh.

- Jalur lama (modem `http://172.16.0.1:7547`, dst-nat ke PC dev `10.20.30.3` via WireGuard
  `10.20.30.0/24`) dipertimbangkan; pengguna memilih tetap `10.99.0.10`. Rule dst-nat lama
  dipakai sementara (`to-addresses=10.99.0.10`) agar modem lama inform ke server lalu
  diganti URL-nya, kemudian dinonaktifkan.
- `ONT_POOLS` = `172.16.0.0/20`, `10.30.0.0/21` (dari dokumentasi; cocokkan di router).

## Berkas
- `docs/noc/genieacs-acs-path.md` — runbook: nilai, fase 1 WireGuard (server + RouterOS),
  fase 2 ganti ACS URL, fase 3 pindah LAN (netplan + route set), rollback, batas port
  7547 opsional (`DOCKER-USER`).

## Bukti uji
- `acsUrlProblem("http://10.99.0.10:7547")` = `null` (lolos validator TS; Go
  `ValidateACSURL` aturan sama).
- `compose.coolify.yaml:112` mem-publish `7547:7547` di semua alamat host.

## Dijalankan 2026-11-16
- MikroTik: `wg-acs` (13232, pubkey `+SLwmPT1...`), peer server, `10.98.0.1/30`, route
  `10.99.0.10/32`, input accept 13232, srcnat accept `out-interface=wg-acs`, `www` +
  `10.98.0.2/32`, dst-nat sementara `172.16.0.1:7547` & `10.167.80.2:7547` -> `10.99.0.10`.
- Server `jrx-dev`: `wg-quick@wg-acs` aktif.
- Bukti (NBI GenieACS server lewat tunnel): 13 device inform dalam 15 menit (FD511GW,
  ZL-2113X, HG8245H); ConnectionRequestURL = IP asli modem (`172.16.15.x`, `10.30.4.10`),
  jadi srcnat tidak menyamarkan modem. Polling router produksi lewat `103.167.70.136`
  (di luar tunnel).

- Konfigurasi repo GenieACS dipasang ke server lewat tunnel NBI
  (`GENIEACS_NBI_URL=http://localhost:7557 node scripts/genieacs-apply-config.mjs`):
  4 provision (termasuk baru `noc-acs-url`), 13 virtual parameter, 4 preset, semua OK.
  `ui.json` dijalankan pengguna di server: berkas dikirim gzip+base64 (tempel baris panjang
  terpotong ~4 KB di terminal); image Mongo lama tanpa `mongosh`. Percobaan pertama lewat
  stdin `mongo` gagal di tengah (baris `docs` > 4 KB) setelah `deleteMany` menghapus 94
  dokumen UI lama; percobaan kedua `docker cp` + `mongo genieacs /tmp/noc-ui.js` (mode
  berkas) = `COUNT:168`. Hasil akhir sama dengan desain skrip (kunci ui.index/filters/device
  diganti); cadangan 94 dokumen lama ada di baris `BACKUP:` `/tmp/noc-ui.out` di host.
  Pelajaran: jangan pipakan skrip mongo lewat stdin, pakai mode berkas atau `--eval`.
- Preset `noc-acs-url`: 27/27 device di GenieACS server ber-`ManagementServer.URL` =
  `http://10.99.0.10:7547` dalam ~5 menit (11:44–11:49 WIB).

## Belum diverifikasi
- Subnet `ONT_POOLS` nyata, WAN TR-069 terpisah atau tidak, nama NIC server, rule
  `chain=forward` MikroTik. Runbook belum dijalankan di server/router.
