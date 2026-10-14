# Checklist Deploy Server NOC ISP Berurutan (Zero-Downtime & Safe Release)

Ikuti fase 1 sampai 6 secara berurutan. Jangan lanjut ke fase berikutnya bila
satu butir fase sebelumnya gagal. Setiap butir ditandai `[ ]` lalu dicentang
setelah terbukti, bukan setelah diasumsikan.

Komponen yang dideploy: PostgreSQL (+ TimescaleDB), daemon Go (`backend/`,
port 8080, `GET /healthz`), web Next.js (port 3000, `GET /api/health`), dan
reverse proxy di depan keduanya (TLS, `/ws` diteruskan ke daemon Go).

Aturan umum:

- Jangan pernah menaruh rahasia di chat, log, atau repositori.
- Jangan jalankan perintah penghapusan volume atau reset database untuk
  "memperbaiki" masalah deploy.
- Catat tag image sebelumnya SEBELUM mengganti apa pun (dipakai di Fase 6).

---

## Fase 1: Verifikasi Pra-Deploy (Pre-flight Checks)

Dijalankan di mesin build/staging, belum menyentuh server produksi.

- [ ] Working tree bersih dan commit yang dideploy sudah ditandai (tag/SHA dicatat).
- [ ] Pengujian lokal lulus:
  ```bash
  npm run typecheck
  npm run check
  npm test
  npm run build
  npm run backend:check
  ```
- [ ] Audit env: bandingkan `.env.server` di server dengan `.env.server.example`.
  - [ ] Setiap kunci di `.env.server.example` ada di `.env.server` (tidak ada yang hilang).
  - [ ] Tidak ada nilai yang masih berbentuk placeholder `<...>`.
  - [ ] `BETTER_AUTH_SECRET` minimal 32 karakter; `REALTIME_TOKEN_SECRET` identik di sisi Next.js dan daemon Go.
  - [ ] `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` dan `ALLOWED_ORIGINS` memakai origin HTTPS produksi yang sama.
  - [ ] `DASHBOARD_DATA=live` hanya bila perangkat sudah bisa ditambah dan diuji.
  - [ ] `TRUSTED_PROXIES` berisi alamat reverse proxy sendiri, bukan rentang lebar yang tidak perlu.
  - [ ] `.env.server` tidak masuk git dan izin berkasnya dibatasi.
- [ ] Konektivitas perangkat dari server tujuan terbukti (bukan dari laptop):
  - [ ] MikroTik REST (`MIKROTIK_REST_HOST`, `MIKROTIK_REST_PORT`) dapat dijangkau.
  - [ ] OLT (`OLT_HSGQ_HOST`, `OLT_HSGQ_PORT`) dapat dijangkau.
  - [ ] GenieACS (`GENIEACS_NBI_URL`) dapat dijangkau.
  - [ ] Port UDP syslog (514) dan NetFlow (2055) terbuka di firewall bila fitur aktif.

---

## Fase 2: Persiapan Database Server

- [ ] Snapshot backup database SEBELUM migrasi, simpan di luar volume database:
  ```bash
  pg_dump --format=custom --file=noc-pre-deploy-$(date +%Y%m%d-%H%M).dump "$DATABASE_URL"
  ```
  - [ ] Berkas dump ada, ukurannya wajar, dan `pg_restore --list` dapat membacanya.
- [ ] Periksa migrasi yang belum diterapkan (hanya baca):
  ```bash
  npm run db:migrate:status
  ```
- [ ] Terapkan migrasi ke database server:
  ```bash
  npm run db:migrate:server
  ```
  - [ ] Jalankan `npm run db:migrate:status` lagi: tidak ada migrasi tertunda.
- [ ] Siapkan ekstensi/hypertable TimescaleDB (aman diulang):
  ```bash
  npm run db:timescale
  ```
- [ ] Siapkan akun awal (hanya deploy pertama, atau saat memang perlu akun baru):
  ```bash
  npm run seed:accounts
  ```
  - [ ] Kata sandi acak yang dicetak SEKALI disimpan ke pengelola kata sandi, lalu dihapus dari terminal.
  - [ ] Di produksi, email bawaan `@noc.local` ditolak; set `SEED_ADMIN_EMAIL` dan `SEED_VIEWER_EMAIL`.

---

## Fase 3: Build & Verifikasi Image Container

- [ ] Build image web dan backend dengan tag eksplisit (bukan `latest`):
  ```bash
  npm run image:build
  ```
- [ ] Verifikasi hasil build:
  ```bash
  npm run image:verify
  ```
  - [ ] Container berjalan sebagai user non-root (web: `nextjs`; backend: bukan root).
  - [ ] Port yang diekspos sesuai: web `3000/tcp`, backend `8080/tcp`.
  - [ ] Tidak ada berkas `.env*` ikut masuk ke dalam image.
- [ ] Tag image baru dan tag image sebelumnya dicatat berdampingan (untuk rollback).

---

## Fase 4: Orkestrasi & Startup Layanan

Urutan startup wajib: DB -> Go Daemon -> Next.js Web -> Reverse Proxy.
Tunggu layanan sehat sebelum menyalakan yang berikutnya.

- [ ] 1. Database: PostgreSQL sehat dan menerima koneksi (`pg_isready`).
- [ ] 2. Go Daemon: nyalakan, lalu tunggu `GET /healthz` berstatus 200:
  ```bash
  curl -fsS http://127.0.0.1:8080/healthz
  ```
- [ ] 3. Next.js Web: nyalakan, lalu tunggu `GET /api/health` berstatus 200:
  ```bash
  curl -fsS http://127.0.0.1:3000/api/health
  ```
  Respons yang benar: `{"status":"ok","timestamp":"..."}`.
- [ ] 4. Reverse Proxy: reload/nyalakan terakhir; konfigurasi valid sebelum reload.
  - [ ] HTTPS aktif, `/ws` diteruskan ke daemon Go dengan upgrade WebSocket.
  - [ ] Untuk zero-downtime: layanan lama tetap melayani sampai `/api/health` dan `/healthz` instance baru sehat, baru trafik dialihkan.
- [ ] Log kedua layanan 2 menit pertama: tidak ada error berulang, tidak ada rahasia tercetak.

---

## Fase 5: Verifikasi Pasca-Deploy (Smoke Tests)

- [ ] Login dashboard dengan akun admin lewat URL produksi; halaman `/app` terbuka.
- [ ] Login akun view-only: dapat melihat dashboard, tidak dapat mengelola router/alert (403 dari API).
- [ ] Koneksi realtime WebSocket (`wss://.../ws`) tersambung; indikator koneksi di dashboard hijau dan data bergerak tanpa reload.
- [ ] Uji koneksi perangkat di UI (Setup Perangkat atau Kelola Router): tombol uji untuk MikroTik/OLT berhasil dan `last_seen_at` terisi.
- [ ] Halaman Alert, Pelanggan, dan Billing terbuka tanpa error di konsol browser.
- [ ] Probe luar: `curl -fsS https://<domain>/api/health` berstatus 200 melalui reverse proxy.
- [ ] Hasil smoke test dicatat (waktu, SHA, nama petugas).

Bila satu butir gagal dan tidak bisa diperbaiki dalam hitungan menit, lanjut
ke Fase 6.

---

## Fase 6: Prosedur Rollback Terdefinisi

Rollback aplikasi dan rollback database adalah dua keputusan terpisah.

1. Hentikan rilis baru: arahkan reverse proxy kembali ke instance lama bila masih hidup.
2. Revert container tag ke tag sebelumnya yang dicatat di Fase 3, lalu nyalakan ulang dengan urutan Fase 4 (DB -> Go Daemon -> Next.js Web -> Reverse Proxy).
3. Verifikasi `/healthz` dan `/api/health` dari image lama sebelum membuka trafik.
4. Rollback database HANYA bila migrasi rilis baru merusak data atau skema tidak kompatibel dengan image lama. Migrasi yang hanya menambah kolom/tabel biasanya aman dibiarkan.
   - **Peringatan: restore menimpa data yang masuk sejak snapshot dibuat.** Konfirmasi dengan penanggung jawab sebelum menjalankan.
   - Hentikan Go Daemon dan Next.js Web agar tidak ada penulisan saat restore.
   - Restore dari snapshot Fase 2:
     ```bash
     pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" noc-pre-deploy-<stempel>.dump
     ```
   - Nyalakan kembali layanan sesuai urutan Fase 4.
5. Ulangi smoke test Fase 5 pada versi lama.
6. Catat penyebab kegagalan dan tag yang gagal; jangan deploy ulang tag yang sama tanpa perbaikan.
