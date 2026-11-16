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

## Belum diverifikasi
- Subnet `ONT_POOLS` nyata, WAN TR-069 terpisah atau tidak, nama NIC server, rule
  `chain=forward` MikroTik. Runbook belum dijalankan di server/router.
