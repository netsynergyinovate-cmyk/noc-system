# Panduan Konfigurasi Variabel Environment per Perangkat & Layanan Produksi

Panduan ini menjelaskan setiap variabel di `.env.server.example` untuk server produksi: apa gunanya, siapa yang membacanya, dan prasyarat di sisi perangkat. Semua nilai di bawah adalah contoh/placeholder, bukan kredensial asli.

## 1. Prinsip Keamanan & Zero Secret Leak

| Berkas | Dilacak Git | Isi |
| --- | --- | --- |
| `.env.server.example` | Ya | Template saja. Hanya placeholder `<...>` dan nilai non-rahasia (port, flag). |
| `.env.server` | Tidak (diabaikan git) | Salinan privat di server produksi berisi nilai asli. |

Aturan:

1. Salin template: `cp .env.server.example .env.server`, lalu ganti SEMUA placeholder `<...>`.
2. Jangan pernah menaruh nilai asli di `.env.server.example`, dokumentasi, issue, log, atau riwayat chat.
3. Rahasia acak dibuat di server (`openssl rand -hex 32`), bukan ditulis tangan. `BETTER_AUTH_SECRET`, `REALTIME_TOKEN_SECRET`, `PPP_WEBHOOK_TOKEN` minimal 32 karakter; `DEVICE_SECRET` dan `ROUTER_SECRET_KEY` 32 byte hex (AES-GCM).
4. Variabel berawalan `NEXT_PUBLIC_` terkirim ke browser. Jangan isi rahasia di sana.
5. Setiap perangkat memakai akun khusus dengan hak minimum (least privilege), bukan akun admin.
6. Berkas `.env.server` hanya dapat dibaca pemilik proses (`chmod 600`).
7. Banyak variabel punya dua nama (alias, mis. `MIKROTIK_HOST` dan `MIKROTIK_REST_HOST`). Isi keduanya dengan nilai sama agar Next.js dan daemon Go konsisten.

## 2. Panduan Konfigurasi per Komponen

### 2.1 MikroTik RouterOS v7 (REST API)

Variabel: `MIKROTIK_HOST`, `MIKROTIK_REST_HOST`, `MIKROTIK_REST_PORT`, `MIKROTIK_USER`, `MIKROTIK_REST_USER`, `MIKROTIK_PASS`, `MIKROTIK_REST_PASSWORD`, `MIKROTIK_REST_USE_TLS`.

- Host: IP/hostname yang dapat dijangkau dari server NOC (mis. `192.168.88.1`).
- Prasyarat RouterOS: versi 7.1 atau lebih baru (REST API ada di v7). Aktifkan `/ip service` `www-ssl` (port 443, dengan sertifikat) atau `www` (port 80). Batasi `address=` hanya ke IP server NOC.
- Port: `MIKROTIK_REST_PORT=443` untuk TLS, `80` untuk HTTP biasa.
- TLS: `MIKROTIK_REST_USE_TLS=true` wajib di produksi. Verifikasi sertifikat tidak boleh dimatikan; pasang sertifikat tepercaya di router.
- Policy user: buat group khusus, misalnya `noc-api`, dengan policy minimum `read`, `api`, `rest-api` (tambahkan `write` hanya bila fitur isolir/pemutusan sesi PPP dipakai). Jangan memakai group `full`. Buat user terpisah di group tersebut.
- Kredensial dienkripsi saat disimpan di database memakai `ROUTER_SECRET_KEY`.

### 2.2 OLT HSGQ (EPON / GPON)

Variabel: `OLT_HOST`, `OLT_HSGQ_HOST`, `OLT_HSGQ_PORT`, `OLT_USERNAME`, `OLT_HSGQ_USER`, `OLT_PASSWORD`, `OLT_HSGQ_PASSWORD`, `OLT_HSGQ_USE_TLS`.

- Protokol: Web API HTTP bawaan OLT HSGQ (port bawaan `80`, `OLT_HSGQ_PORT`). Bila web UI OLT dipasang di balik TLS, set `OLT_HSGQ_USE_TLS=true`; bawaan template `false` karena banyak OLT hanya melayani HTTP di jaringan manajemen tertutup.
- CLI (Telnet/SSH) bukan jalur utama; hanya dipakai sebagai cadangan operasional manual. Kredensial CLI dan Web bisa berbeda; variabel di sini untuk Web API.
- Data yang diambil: status ONU, daya redaman optik (RX/TX power dalam dBm), dan status port PON. Ambang redaman diatur di halaman Pengaturan (Ambang Batas), bukan di env.
- Polling interval: dikendalikan collector Go (bukan variabel env di berkas ini). Jaga agar tidak terlalu rapat supaya CPU OLT tidak terbebani.
- Pakai akun read-only bila OLT mendukung. Letakkan OLT di VLAN manajemen yang hanya bisa diakses server NOC.

### 2.3 GenieACS NBI (TR-069)

Variabel: `GENIEACS_URL`, `GENIEACS_NBI_URL`, `GENIEACS_USERNAME`, `GENIEACS_NBI_USER`, `GENIEACS_PASSWORD`, `GENIEACS_NBI_PASSWORD`, `GENIEACS_TIMEOUT_MS`.

- Port: NBI GenieACS berjalan di `7557` (CWMP untuk CPE di `7547`, UI di `3000`). `GENIEACS_URL` dan `GENIEACS_NBI_URL` menunjuk ke NBI (contoh `http://genieacs:7557`), bukan ke port CWMP.
- Jangan membuka port NBI ke internet. Batasi ke jaringan internal/Docker atau reverse proxy dengan autentikasi.
- Autentikasi: aktifkan basic auth di GenieACS bila tersedia, lalu isi user/password.
- `GENIEACS_TIMEOUT_MS=5000`: batas waktu per permintaan NBI (milidetik). Naikkan hanya bila CPE lambat merespons.
- Parameter: NBI dibaca lewat data model TR-098 (`InternetGatewayDevice.*`) atau TR-181 (`Device.*`) tergantung firmware CPE; pemetaan SSID, kata sandi Wi-Fi, redaman optik ONT, dan jumlah klien dilakukan di layanan sisi server. Kata sandi Wi-Fi tidak boleh ditulis ke log.

### 2.4 Portal Billing ISP (Scraper & Sync)

Variabel: `BILLING_URL`, `BILLING_USERNAME`, `BILLING_PASSWORD`, `BILLING_SYNC_MINUTE`, `BILLING_DROP_PERCENT`, `BILLING_DROP_MIN_INVOICES`.

- Sinkron berjalan hanya bila `BILLING_URL`, `BILLING_USERNAME`, `BILLING_PASSWORD`, dan `DATABASE_URL` semuanya terisi. Terisi sebagian: backend menolak start.
- Proteksi CSRF: scraper memuat halaman login, membaca token CSRF, lalu mengirimnya bersama kredensial.
- Cookie session: disimpan hanya di memori proses selama satu putaran sinkron; tidak ditulis ke disk atau log.
- Jadwal: `BILLING_SYNC_MINUTE=5` berarti sinkron berjalan pada menit ke-5 setiap jam.
- Guard anomali drop: bila jumlah invoice turun lebih dari `BILLING_DROP_PERCENT` (bawaan 50%) dibanding sinkron sukses sebelumnya, hasil ditolak dan status billing tidak berubah. Guard hanya aktif bila invoice sebelumnya minimal `BILLING_DROP_MIN_INVOICES` (bawaan 10), agar basis kecil tidak memicu penolakan palsu. Sumber dengan nol invoice juga ditolak.
- Login yang ditolak tidak diulang otomatis. Pakai akun portal khusus read-only.

### 2.5 Realtime Engine (Go Daemon) & Web

Web (Next.js):

- `DATABASE_URL`: koneksi PostgreSQL; pakai user DB khusus aplikasi, bukan superuser.
- `BETTER_AUTH_SECRET`: kunci sesi, minimal 32 karakter acak.
- `BETTER_AUTH_URL`: origin publik aplikasi (skema + host + port) yang sama persis dengan yang dipakai browser.
- `NEXT_PUBLIC_APP_URL`: origin publik untuk sisi klien.
- `NEXT_PUBLIC_REALTIME_WS_URL`: alamat WebSocket publik (`wss://.../ws`).
- `BACKEND_URL`: alamat daemon Go dari sisi server Next.js (jaringan internal).
- `DASHBOARD_DATA`: `live` memakai data nyata dan mengaktifkan gerbang Setup Perangkat; `demo` memakai data tiruan.
- `DEVICE_SECRET`, `ROUTER_SECRET_KEY`: kunci AES-GCM 32 byte hex untuk mengenkripsi kredensial perangkat di database. Mengganti kunci membuat kredensial lama tidak terbaca.
- `TRUSTED_PROXIES`: daftar IP/CIDR reverse proxy tepercaya. Kosong berarti semua header forwarded diabaikan.

Daemon Go:

- `PORT`, `BACKEND_ADDR`: alamat dengar HTTP/WebSocket (bawaan `8080`). Letakkan di balik reverse proxy.
- `REALTIME_TOKEN_SECRET`: harus identik dengan nilai di sisi Next.js, karena dipakai memverifikasi tiket WebSocket.
- `ALLOWED_ORIGINS`: origin yang boleh membuka WebSocket (isi origin publik; jangan `*`).
- `PPP_WEBHOOK_TOKEN`: token yang dikirim script RouterOS pada webhook PPP up/down.
- `SYS_SYSLOG_ADDR`, `SYSLOG_ADDR`: alamat dengar syslog (UDP 514). Port di bawah 1024 butuh hak khusus; batasi dengan firewall hanya dari IP router.
- `NETFLOW_ENABLED`, `NETFLOW_LISTEN_ADDR`, `NETFLOW_ADDR`: aktif/tidaknya kolektor NetFlow dan alamat dengar UDP (bawaan 2055). Arahkan `/ip traffic-flow` router ke alamat ini.
- `TIMESCALE_ENABLED`: `true` hanya bila ekstensi TimescaleDB terpasang.
- `TRAFFIC_RETENTION_DAYS`: lama simpan riwayat trafik (hari).
- `LOG_LEVEL`: `debug`, `info`, `warn`, atau `error`. Gunakan `info` di produksi.

## 3. Checklist Verifikasi Pra-Deploy (Zero Secret Leak)

- [ ] `.env.server` ada di server, izin `600`, dan tidak masuk Git (`git check-ignore .env.server`).
- [ ] Tidak ada placeholder `<...>` tersisa di `.env.server`.
- [ ] `.env.server.example` hanya berisi placeholder (`git diff` bersih dari nilai asli).
- [ ] `BETTER_AUTH_SECRET`, `REALTIME_TOKEN_SECRET`, `PPP_WEBHOOK_TOKEN` minimal 32 karakter acak; `REALTIME_TOKEN_SECRET` sama di Next.js dan Go.
- [ ] `DEVICE_SECRET` dan `ROUTER_SECRET_KEY` 32 byte hex dan dicadangkan terpisah.
- [ ] Tidak ada rahasia di variabel `NEXT_PUBLIC_*`.
- [ ] MikroTik: `MIKROTIK_REST_USE_TLS=true`, user di group dengan policy minimum.
- [ ] OLT dan GenieACS hanya terjangkau dari jaringan manajemen; port 7557 tidak terbuka ke internet.
- [ ] Billing: akun portal khusus, `BILLING_DROP_PERCENT` dan `BILLING_DROP_MIN_INVOICES` ditinjau.
- [ ] `ALLOWED_ORIGINS` berisi origin publik yang tepat, bukan `*`.
- [ ] `TRUSTED_PROXIES` berisi hanya proxy milik sendiri.
- [ ] `DASHBOARD_DATA=live` hanya setelah minimal satu router/OLT berhasil diuji di Setup Perangkat.
- [ ] `npm test` lulus (termasuk `tests/device-env-guide.test.mjs`).
