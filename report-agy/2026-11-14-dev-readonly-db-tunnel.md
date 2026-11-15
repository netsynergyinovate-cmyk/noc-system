# DB server hanya-baca untuk developer lewat SSH tunnel (2026-11-14)

## Keputusan pengguna
Opsi 1: Docker lokal hanya menjalankan tunnel; data server dibaca dengan akun hanya-baca. Aplikasi lokal tetap memakai DB lokal, karena app yang tersambung ke DB server ikut menulis ke produksi (migrasi, seed, deploy_runs, pekerja latar, sesi login).

## Perubahan
- `compose.coolify.yaml`: postgres `ports: "127.0.0.1:15432:5432"` (hanya loopback server).
- `compose.genieacs-tunnel.yaml`: forward tambahan `-L 0.0.0.0:15432:127.0.0.1:15432`, port lokal `127.0.0.1:15432`.
- `scripts/dev-readonly-role.sql`: role `noc_dev_ro` (LOGIN tanpa password di berkas, `default_transaction_read_only=on`, SELECT semua tabel public + default privileges), REVOKE pada `session`, `account`, `verification`, `api_keys`, `billing_credentials`, `ssh_credentials`.

## Uji
- SQL dijalankan di postgres lokal: semua perintah sukses; `select from routers` OK; `session` "permission denied"; DELETE "cannot execute DELETE in a read-only transaction".
- `docker compose -f compose.coolify.yaml config`: valid, port 15432 terbit.
- Tunnel jalan ulang: NBI 7557 tetap HTTP 200; 15432 belum menjawab (menunggu langkah server).

## Langkah server (dikerjakan pengguna)
1. Push dan redeploy Coolify.
2. Jalankan SQL di psql container postgres, lalu `\password noc_dev_ro`.
3. Tambah `permitopen="127.0.0.1:15432"` pada entri kunci tunnel di `~/.ssh/authorized_keys` server.

## Lanjutan: `npm run all` + container noc-tunnel-server
- `npm run all` gagal "Missing script: all"; yang ada `dev:all`/`app`. Ditambah alias `"all": "node scripts/run-all.mjs"`.
- `scripts/run-all.mjs`: menghentikan container Docker app/backend yang masih jalan (port 3001/8080, polling ganda), lalu menyalakan tunnel bila `GENIEACS_TUNNEL_TARGET` diisi.
- Bug: `COMPOSE_PROJECT_NAME=nocsystem` di .env.local menimpa `name:` berkas tunnel, sehingga terbentuk container tunnel kedua yang bentrok di port 7557. Perbaikan: `-p noc-tunnel-server`.
- Atas permintaan pengguna: `compose.genieacs-tunnel.yaml` diganti nama menjadi `compose.tunnel-server.yaml`, project/container/image `noc-tunnel-server`. Container tunnel lama (`noc-genieacs-tunnel-genieacs-tunnel-1`, `nocsystem-genieacs-tunnel-1`) dan image `nocsystem-genieacs-tunnel` dihapus. Postgres lokal tidak disentuh.
- Uji: `npm run all` di tab terminal: "[run-all] Tunnel ke ... aktif", web 200 (:3001), backend 200 (:8080), NBI 200 (:7557), hanya satu container tunnel.

## Lanjutan: aplikasi lokal membaca DB server (`npm run all:server`)
Keputusan pengguna: app lokal membaca DB server, TIDAK menulis; tulis harus gagal.

### Temuan
- Login = JWT dari backend Go (`/api/v1/auth/login`); hanya MEMBACA `user` LEFT JOIN `account` (hash bcrypt). Tidak ada tulis sesi. Jadi role tetap 100% hanya-baca; `account` diberi SELECT per kolom (id, account_id, provider_id, user_id, password), token OAuth tetap tertutup.
- Backend Go tidak punya saklar collector; dengan role hanya-baca setiap tulis gagal (`SQLSTATE 25006`) dan backend tetap hidup. Polling OLT ikut gagal karena menyimpan PON port.
- `prepare.mjs` selalu `db:migrate` ke DATABASE_URL: di mode server dilewati (`NOC_READONLY_DB=1`).

### Perubahan
- `package.json`: `all:server` = `node scripts/run-all.mjs --server`.
- `scripts/run-all.mjs --server`: baca `.env.server-db.local` (DATABASE_URL, DEVICE_SECRET wajib; tidak di-commit), set `NOC_READONLY_DB=1` + `SKIP_STARTUP_MIGRATION=true`, tunnel wajib; Docker juga dicek bila tunnel dipakai.
- `scripts/prepare.mjs`: lewati db:up/db:migrate saat `NOC_READONLY_DB=1`.
- `src/instrumentation.ts`: saat `NOC_READONLY_DB=1` lewati migrasi, seed, versi build, VLAN collector, ONU auto-match.
- `scripts/dev-readonly-role.sql`: GRANT kolom `account` untuk login.

### Uji (Postgres lokal sebagai tiruan server, role noc_dev_ro dengan SQL baru)
- `npm run all:server`: "Mode DB server (hanya-baca)", "DB server hanya-baca: migrasi, seed, dan pekerja latar dilewati."; GET /app 200, /api/alerts 200.
- Backend: INSERT/UPDATE/DELETE semua ditolak "read-only transaction", proses tetap jalan.
- Login akun uji lewat role hanya-baca: 200, token terbit. `select access_token from account` sebagai role: permission denied.
- typecheck 0 error; eslint instrumentation 0; startup-validator 14/14; env-example-reference 7/7.
- Akun uji, role uji, env uji dibersihkan; templat .env.server-db.local dikembalikan.

### Alur fitur baru dengan tabel baru
DB server hanya-baca, jadi tabel baru dibuat dan diisi di mode lokal (`npm run all` + `npm run db:generate`), lalu push + redeploy (migrator membuat tabel di server). Setelah itu `npm run all:server` bisa membacanya (ALTER DEFAULT PRIVILEGES).
