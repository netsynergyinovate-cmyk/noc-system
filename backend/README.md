# Backend NOC ISP (Go)

Layanan Go untuk dashboard NOC: mengumpulkan data dari router MikroTik dan OLT,
mendeteksi anomali, dan menyiarkan data ke dashboard lewat WebSocket. Frontend
Next.js ada di root repo; keduanya satu repo (monorepo).

Saat ini yang sudah ada: konfigurasi, server HTTP dengan `GET /healthz`, manager
state di memori, WebSocket hub (`/ws`), dan endpoint REST (`/api/v1/`). Paket lain
baru kerangka. Rule engine sudah ada dengan satu aturan (pelanggan offline lama). Collector MikroTik sudah ada tetapi belum disambungkan ke server
(belum ada sumber daftar router), dan belum ada koneksi ke OLT atau database.

## Menjalankan

Butuh Go 1.24 atau lebih baru. Dari root repo:

```bash
npm run backend:dev     # jalankan di http://127.0.0.1:8080 (membaca .env.local)
npm run backend:test    # semua test Go
npm run backend:check   # go vet + test
npm run backend:build   # hasil di backend/bin/
```

`backend:dev` memakai skrip `scripts/backend-dev.mjs`: ia membuat
`REALTIME_TOKEN_SECRET` di `.env.local` bila belum ada (nilai yang sudah ada tidak
disentuh) dan mengisi `ALLOWED_ORIGINS` dari `BETTER_AUTH_URL`, sehingga rahasia
dan origin di Next.js dan Go otomatis sama. Menjalankan `go run` langsung berarti
kamu mengisi environment sendiri.

Cek hidup:

```bash
curl http://127.0.0.1:8080/healthz
# {"status":"ok","version":"dev","uptimeSeconds":3}
```

## Pengaturan (environment variable)

| Variabel                | Default                 | Keterangan                                                                                                                                                                         |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKEND_ADDR`          | `127.0.0.1:8080`        | Alamat dengarkan. Isi `0.0.0.0:8080` hanya di Docker.                                                                                                                              |
| `LOG_LEVEL`             | `info`                  | `debug`, `info`, `warn`, atau `error`.                                                                                                                                             |
| `REALTIME_TOKEN_SECRET` | kosong                  | Rahasia bersama dengan Next.js untuk tiket login, minimal 32 karakter. **Kosong berarti `/ws` dan `/api/v1/` dimatikan.**                                                          |
| `ALLOWED_ORIGINS`       | `http://localhost:3000` | Origin browser yang boleh membuka WebSocket dan memanggil REST, dipisah koma. `*` ditolak.                                                                                         |
| `DATABASE_URL`          | kosong                  | Alamat PostgreSQL (`postgres://...`) untuk arsip traffic. **Kosong berarti `/api/v1/traffic/history` menjawab 503.** Pada `npm run backend:dev` nilainya dibaca dari `.env.local`. |

### Pengikatan profil TR-069 otomatis (zero-touch modem)

Polling OLT hanya membaca. Dua jalan TULIS ke OLT, keduanya lewat `BindOne`
(`internal/olt/autobind.go`, perintah OLT yang sama: `interface epon P` lalu
`onu-tr069 N profile-id ID`): otomatis untuk ONU baru (AutoBinder, jalan dari
polling), dan manual satu ONU lewat REST (tombol "Daftarkan ke GenieACS" di
aplikasi, `POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/tr069-bind`).

| Variabel                  | Default | Keterangan                                                                                                                   |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `TRAFFIC_SOURCE`          | `interface` | Sumber angka download/upload dashboard. `interface` (bawaan): selisih counter byte interface tiap detik, sama dengan Winbox dan tanpa jeda. `queue`: jumlah `rate` simple queue (cara lama: dihaluskan RouterOS dan tertinggal ±3 detik, hanya pelanggan ber-queue). |
| `TRAFFIC_INTERFACE`       | (kosong) | Nama interface router untuk trafik dashboard. Kosong = cari interface berkomentar `TRAFFIC_INTERFACE_COMMENT` (bawaan `UPLINK`); bila tidak ada atau ada dua, dipakai jumlah queue dan dicatat peringatan. Pada interface uplink Rx = download dan Tx = upload. |
| `TRAFFIC_INTERFACE_CUSTOMER_SIDE` | `false` | `true` bila interface itu menghadap pelanggan (mis. ke OLT): Tx = download, Rx = upload. |
| `OLT_TR069_AUTOBIND`      | `off`   | Default di BINER Go. `off` mati. `new`: hanya ONU yang pertama terlihat SESUDAH fitur dinyalakan untuk OLT itu. `all`: semua ONU online yang belum terikat (sekali jalan). **`compose.yaml` proyek ini mengganti defaultnya ke `new`** — isi `OLT_TR069_AUTOBIND=off` di `.env` untuk mematikannya. |
| `OLT_TR069_PROFILE_ID`    | `1`     | Id profil di OLT (1-32). Profil harus SUDAH dibuat operator; backend tidak membuatnya. Dipakai AutoBinder MAUPUN endpoint manual di bawah; satu nilai untuk keduanya. |
| `OLT_TR069_MAX_PER_ROUND` | `5`     | Batas ONU yang diikat AutoBinder per putaran polling (30 dtk) per OLT (1-20). Tidak membatasi endpoint manual (satu ONU per permintaan). |

Nilai tidak valid mematikan AutoBinder dan dicatat sebagai galat (endpoint manual
tetap jalan dengan `OLT_TR069_PROFILE_ID` bawaan). Aturan keselamatan:

- Profil dibuat operator sekali: `onu-tr069-profile add profile-id 1 profile-name NOC url http://IP-ACS:7547`.
  Bila profil belum ada, AutoBinder tidak mengirim apa pun dan hanya mencatat peringatan (maks. sekali per jam);
  endpoint manual menjawab `409 {"error":"profile_missing"}`.
- Perintah yang dikirim hanya `interface epon P` dan `onu-tr069 N profile-id ID` (lalu `end`, `configure`). Angka dicek rentangnya
  (PON 1-8, ONU 1-64, profil 1-32) sebelum masuk ke perintah. Penolakan OLT (`vty%`, `Error`) dibaca sebagai gagal.
- ONU yang ditolak dicoba lagi paling cepat 10 menit kemudian. ONU hanya dicatat terikat (`olt_onus.tr069_bound_at`) setelah OLT menerima.
- Slot yang dipakai ONU lain (nomor seri berubah) dihitung ONU baru: `first_seen_at` dan `tr069_bound_at` direset.
- Mode `new` memakai `olts.tr069_autobind_since` (diisi sekali saat pertama jalan): ONU lama tidak disentuh.
- Tidak ada sesi telnet tambahan bila tidak ada ONU yang perlu diikat. Kegagalan pengikatan tidak membuat polling dianggap gagal.

Sinkron billing (lihat "Sinkron billing (implementasi)" di bawah) memakai variabel
berikut. **Billing hanya hidup bila `BILLING_URL`, `BILLING_USERNAME`, dan
`BILLING_PASSWORD` terisi semuanya DAN `DATABASE_URL` ada**; ketiganya kosong
berarti sinkron dimatikan (satu baris log), sebagian terisi berarti backend menolak
start.

| Variabel                    | Default | Keterangan                                                                                                                           |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `BILLING_URL`               | kosong  | Alamat dasar sistem billing (`https://...`). TLS tidak pernah dimatikan; pengalihan ke host lain ditolak.                            |
| `BILLING_USERNAME`          | kosong  | Akun billing untuk membaca tagihan (cukup hak baca).                                                                                 |
| `BILLING_PASSWORD`          | kosong  | Kata sandinya. Tidak pernah masuk log, galat, atau pesan sinkron.                                                                    |
| `BILLING_SYNC_MINUTE`       | `5`     | Menit (0-59, UTC) tiap jam saat sinkron dimulai.                                                                                     |
| `BILLING_DROP_PERCENT`      | `50`    | Penjaga penyusutan: sinkron ditolak bila jumlah tagihan di bawah persentase ini dari sinkron sukses terakhir. `0` mematikan penjaga. |
| `BILLING_DROP_MIN_INVOICES` | `10`    | Penjaga hanya berlaku bila sinkron sukses terakhir punya setidaknya sekian tagihan.                                                  |

Nilai yang tidak valid membuat backend berhenti saat start dengan pesan yang
jelas, bukan berjalan dengan pengaturan yang salah.

## Struktur

```
backend/
  cmd/server/          titik masuk: baca config, buka port, berhenti dengan rapi
  internal/
    config/            pengaturan dari environment
    httpapi/           router HTTP, log permintaan, header keamanan
    auth/              tiket login singkat (HMAC) untuk WebSocket
    state/             kondisi jaringan di memori: Manager + ring buffer 300 titik
    hub/               WebSocket hub: snapshot, delta per detik, event
    wire/              bentuk JSON yang dikirim ke dashboard (dipakai hub dan REST)
    archive/           penulis arsip traffic ke PostgreSQL/TimescaleDB (asinkron, berbatch)
    collector/         polling queue tiap detik, webhook PPP, syslog, dan polling cadangan (ppp/active, resource, interface)
    engine/            rule engine: kondisi, durasi, dan event saat gangguan mulai/selesai
    olt/               (kerangka) antarmuka driver OLT per merek
```

Paket bertanda "kerangka" baru berisi `doc.go` yang menjelaskan perannya; isinya
dikerjakan pada task berikutnya.

## WebSocket (`/ws`)

Dashboard membuka `ws://<backend>/ws`. Endpoint ini **wajib login** dan tidak ada
sama sekali bila `REALTIME_TOKEN_SECRET` kosong.

**Login.** Backend Go tidak tahu sesi Better Auth. Next.js (yang memegang sesi)
menerbitkan _tiket_ singkat; backend hanya memeriksanya. Keduanya berbagi satu
rahasia, `REALTIME_TOKEN_SECRET` (dibuat otomatis oleh `npm run setup`).

Browser mendapat tiket dengan `POST /api/realtime/ticket` ke Next.js. Pemanggil
harus login, header `Origin` harus origin aplikasi, dan GET tidak tersedia karena
ini mengeluarkan kredensial:

```json
{
  "data": {
    "token": "...",
    "expiresAt": 1791360000,
    "wsUrl": "ws://localhost:8080/ws",
    "apiUrl": "http://localhost:8080"
  }
}
```

Tiket berlaku 60 detik, jadi ambil yang baru sebelum menyambung atau memanggil
REST lagi. Setelah logout, Next.js berhenti menerbitkan tiket (401). Format tiket:

```
base64url(payload) + "." + base64url(HMAC-SHA256(rahasia, payload))
payload = {"sub":"<id pengguna>","exp":<detik unix>,"perms":["alert:handle"]}   (base64url tanpa padding; "perms" hanya ada bila tidak kosong)
```

Backend menolak tiket yang berlaku lebih dari 5 menit. Di WebSocket, tiket dikirim
sebagai **pesan pertama**, bukan di URL, supaya tidak masuk log proxy.

`perms` adalah izin MENGUBAH data (bentuk `resource:aksi`) yang dimiliki pemegang
tiket. Next.js mengisinya dari peran ASLI akun saat tiket diterbitkan; karena ikut
ditandatangani, klien tidak bisa menambahkannya. Tiket tanpa `perms` (tiket lama,
atau akun hanya-lihat) sah untuk MEMBACA saja. Rute yang mengubah data harus
dipasang di balik `requirePerm(verifier, "alert:handle", ...)` (`httpapi/auth.go`):
tiket tidak sah dijawab 401 `{"error":"unauthorized"}`, tiket sah tanpa izin itu
dijawab 403 `{"error":"forbidden"}`. Karena izin dibaca saat tiket terbit dan tiket
berumur 60 detik, pencabutan peran baru berlaku di backend paling lama 60 detik
kemudian. Rute `POST /api/v1/alerts/{id}/handle` sendiri belum ada; saat dibuat,
tambahkan `POST` ke CORS (`cors.go` kini hanya mengizinkan `GET, HEAD, OPTIONS`).

**Alur pesan** (JSON teks; nama field mengikuti `src/lib/dashboard/types.ts`):

| Arah           | Pesan                           | Isi                                                                                                                                        |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| klien → server | `{"type":"auth","token":"..."}` | wajib dalam 5 detik; tidak ada pesan klien lain                                                                                            |
| server → klien | `snapshot`                      | `time`, `routers`, `customers`, `traffic` `{times, rx, tx}`                                                                                |
| server → klien | `status`                        | perubahan online/offline pelanggan, dikirim segera (~0,1 detik) tanpa menunggu detik berikutnya; isinya sama dengan `statusChanges`        |
| server → klien | `delta`                         | tiap detik: `time`, `traffic` (`null` bila tidak ada router melapor), `statusChanges`, dan `billingChanges` (opsional, lihat di bawah)     |
| server → klien | `events`                        | gangguan mulai atau selesai, **satu pesan berisi daftar** `events`: `id`, `kind`, `severity`, `active`, `time`, `startedAt`, `detail`, ... |
| server → klien | `incidents` (dirancang)         | daftar **lengkap** kartu insiden aktif: `time`, `cards` (bentuk `IncidentCard`); lihat di bawah                                            |
| server → klien | `alerts` (dirancang)            | `active` (daftar **lengkap** alert aktif) dan `ended` (yang selesai sejak pesan sebelumnya); lihat di bawah                                |

Snapshot berhenti di detik terakhir yang sudah disiarkan, jadi delta berikutnya
bersambung tanpa celah dan tanpa titik ganda. `statusChanges` berisi keadaan
terbaru pelanggan (menerapkannya dua kali tidak berbahaya); beberapa perubahan
pada pelanggan yang sama dalam satu detik digabung. Bila tick terlambat, hub
mengejar detik yang terlewat (maksimal 60) satu per satu.

`billingChanges` (opsional; dikirim hub Go setelah sinkron billing berhasil) memuat
`{ customerId, status }` untuk pelanggan yang status tagihannya (`lunas` atau
`isolir`) berubah karena sinkron billing yang **berhasil** baru selesai; hanya ada
pada detik itu. Seperti `statusChanges`, isinya keadaan terbaru, jadi diterapkan dua
kali tidak berbahaya, dan `snapshot` membawa status yang berlaku sekarang di tiap
pelanggan. Sinkron yang gagal tidak mengirim apa pun, dan pelanggan tanpa tagihan
cocok tidak pernah menerima status dari sinkron.

**Pesan `incidents` (dirancang frontend, belum dikirim hub Go).** Kartu insiden
terkelompok (satu kartu per kelompok alert yang diduga satu penyebab) tidak ditarik
berkala; hub mendorongnya lewat WebSocket yang sama:

```json
{
  "type": "incidents",
  "time": 1791400000,
  "cards": [{ "id": "grp-alert-2985662", "...": "..." }]
}
```

- `cards` adalah **daftar lengkap** kartu aktif, bukan selisih: menerapkannya dua
  kali tidak berbahaya, dan pesan yang terlewat tidak meninggalkan celah karena pesan
  berikutnya cukup sendirian. Daftar aktif kecil (puluhan), jadi mengirim seluruhnya
  murah. Daftar kosong adalah pesan yang sah (tidak ada insiden aktif).
- Dikirim **sekali tepat setelah `snapshot`** (saat tersambung dan setelah sinkron
  ulang), lalu **hanya saat isi daftar berubah**: alert baru, alert selesai, anggota
  kelompok bertambah, atau akar dan dampaknya berubah. Tidak dikirim tiap detik.
- Bentuk kartu mengikuti `IncidentCard` di `src/lib/dashboard/incident-cards.ts`
  (akar, jumlah terdampak, anggota alert, waktu anggota tertua, titik sorot).
  Pengelompokannya sekarang dikerjakan frontend (`correlation.ts`); bila dipindah ke
  hub Go, pesan ini tidak berubah.
- Pada fase frontend, yang berperan sebagai hub adalah `createMockIncidentHub`
  (`incident-sync.ts`) di dalam `DashboardFeed`, yang dipasang sekali di layout
  aplikasi sehingga satu "sambungan" dipakai semua halaman.

**Pesan `alerts` (dirancang frontend, belum dikirim hub Go).** Alert aktif dan
yang baru selesai juga tidak ditarik berkala oleh tiap halaman; hub mendorongnya
lewat WebSocket yang sama, dan semua halaman membaca satu store:

```json
{
  "type": "alerts",
  "time": 1791400000,
  "active": [{ "id": "alert-2985662", "...": "..." }],
  "ended": [{ "id": "alert-2985600", "endedAt": 1791399980, "...": "..." }]
}
```

- `active` adalah **daftar lengkap** alert yang masih aktif (bentuk `ActiveAlert`,
  lihat "Alert aktif"), bukan selisih: menerapkannya dua kali tidak berbahaya, dan
  pesan yang terlewat tidak meninggalkan celah.
- `ended` memuat alert yang **selesai sejak pesan sebelumnya**, dalam bentuk
  `ResolvedAlert` (lihat "Riwayat alert selesai"), untuk ditambahkan ke riwayat.
  Dikenali dari `id`, jadi alert yang sama dua kali tidak menggandakan baris. Alert
  yang ditutup petugas ikut di sini (`endTimeSource: "operator"`).
- Dikirim **hanya saat ada yang berubah**: alert baru, alert selesai, atau isi alert
  aktif berubah (mis. sumber akar dan dampaknya). Tidak tiap detik. Tepat setelah
  `snapshot` dikirim sekali dengan `ended` kosong.
- **Riwayat awal tidak ikut pesan ini** (bisa ratusan baris): frontend mengambilnya
  lewat REST (`GET /api/v1/alerts?status=resolved`) saat tersambung dan setelah
  sinkron ulang, bersama daftar aktif (`GET /api/v1/alerts?status=active`).
- Satu alert ada di tepat satu daftar: bila `id` yang sama ada di `active` dan di
  riwayat (mis. pesan tiba sebelum REST selesai), frontend menganggapnya selesai.
- Pada fase frontend, yang berperan sebagai hub adalah `createMockAlertHub`
  (`alert-sync.ts`) di dalam `DashboardFeed`; store `useAlertStore`
  (`alert-store.ts`) dibaca halaman Alert dan lencana di dasbor. Pengujiannya
  (`e2e/alert-sync.spec.ts`) memastikan keadaan yang dibangun dari snapshot dan pesan
  susulan selalu sama dengan keadaan sebenarnya, untuk selang waktu acak sekalipun.

**Perlindungan:** origin diperiksa; klien tanpa tiket sah ditutup dengan kode 1008
tanpa menerima data; maksimal 100 klien (kode 1013 bila penuh); klien yang antreannya
penuh diputus, bukan ditunggu; ping tiap 25 detik dan klien yang tidak membalas
dalam 60 detik dikeluarkan; klien tidak boleh mengirim data selain tiket.

**Umur koneksi dan login ulang.** Tiket hanya diperiksa saat koneksi dibuka, jadi
koneksi dibatasi **30 menit**. Lewat batas itu server menutupnya dengan kode
**4401** ("sesi perlu diperbarui"). Dashboard harus menanggapi 4401 dengan
meminta tiket baru lalu menyambung ulang; Next.js hanya memberi tiket kepada
pengguna yang masih login, jadi pengguna yang sudah logout atau dinonaktifkan
terputus paling lama 30 menit kemudian. Kode **1008** berarti tiket ditolak:
jangan mengulang dengan tiket yang sama.

**Batasan:** tiket bisa dipakai ulang sampai kedaluwarsanya (60 detik); mencuri
tiket butuh akses ke lalu lintas, jadi pakai HTTPS/WSS di luar jaringan lokal.
Satu rahasia dipakai bersama; mengganti rahasia memutus semua tiket yang beredar
(aman, hanya perlu menyambung ulang).

## REST (`/api/v1/`)

Data yang sama dengan yang ada di snapshot WebSocket, untuk dibaca sewaktu-waktu
(muat awal, halaman yang dipaginasi). Hanya membaca: GET dan HEAD. Seperti `/ws`,
endpoint ini tidak ada bila `REALTIME_TOKEN_SECRET` kosong.

**Login:** header `Authorization: Bearer <tiket>`; tiketnya sama dengan untuk
WebSocket (format di bagian atas). Tiket tidak sekali pakai, berlaku sampai
kedaluwarsa, jadi satu tiket bisa dipakai untuk beberapa permintaan. Tanpa tiket
yang sah, jawabannya selalu `401 {"error":"unauthorized"}` tanpa data.

**CORS:** hanya origin di `ALLOWED_ORIGINS`. Browser dari origin lain ditolak
(403), termasuk preflight-nya. Permintaan tanpa header `Origin` (curl, server ke
server) tetap butuh tiket.

| Endpoint                      | Parameter                                                                                                                                                                   | Isi `data`                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/v1/summary`         | -                                                                                                                                                                           | `counts` (online, offline, weakSignal, activeRouters, totalRouters) dan `generatedAt` |
| `GET /api/v1/routers`         | -                                                                                                                                                                           | daftar router                                                                         |
| `GET /api/v1/customers`       | `status` (`all`, `online`, `offline`, `weak`), `router` (id), `q` (nama, username PPPoE, atau alamat; maks 100 karakter), `limit` (1-200, default 50), `offset` (default 0) | daftar pelanggan urut nama, plus `meta` `{limit, offset, total, hasMore}`             |
| `GET /api/v1/traffic`         | `seconds` (1-300, default 300)                                                                                                                                              | `{times, rx, tx}` total semua router, dalam Mbps                                      |
| `GET /api/v1/traffic/history` | `range` (`1h`, `6h`, `24h`, `7d`, `30d`) atau `from` dan `to` (detik unix); `step` (detik, opsional); `router` (UUID, opsional)                                             | `{from, to, step, times, rx, tx}` dari arsip, lihat di bawah                          |

Saringan pelanggan berarti sama dengan tabel di dashboard. Parameter yang tidak
dikenal atau diulang dijawab `400 {"error":"invalid_request","message":"..."}`
(bukan diabaikan), supaya salah ketik tidak diam-diam menghasilkan data tanpa
saringan. Bentuk pelanggan, router, dan traffic sama dengan di WebSocket. Tiap pelanggan membawa `odpName`, nama ODP atau lokasi tempatnya tersambung (teks bebas menurut penamaan ISP; **string kosong**, bukan null, bila belum diketahui). Dashboard menampilkannya di tooltip titik peta. Nilainya disimpan di kolom `customers.odp_name` (1-100 karakter atau kosong); belum ada yang mengisinya otomatis, jadi sementara diisi lewat database atau impor.

### Mengikat TR-069 manual (`POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/tr069-bind`)

Satu-satunya cara lain (selain AutoBinder, lihat "Pengikatan profil TR-069
otomatis" di atas) backend menulis ke OLT: mengikat SATU ONU ke profil TR-069,
dipicu tombol "Daftarkan ke GenieACS" di halaman OLT & Optik / GenieACS aplikasi.
Butuh tiket dengan izin `cpe:manage` (bukan cukup tiket biasa; 403 tanpa izin,
diperiksa sebelum apa pun dijalankan — lihat `internal/httpapi/olt.go`).
`{oltId}` adalah UUID baris `olts`; `{pon}`/`{onu}` nomor bulat ≥1.

| Status | Arti                                                                            |
| ------ | -------------------------------------------------------------------------------- |
| 200    | `{"ok":true,"message":"ONU P/O diikat ke profil TR-069"}`                        |
| 400    | `oltId`/`pon`/`onu` tidak sah, atau driver OLT tidak terdaftar                    |
| 404    | OLT tidak ditemukan atau nonaktif                                                 |
| 409    | Profil `OLT_TR069_PROFILE_ID` belum dibuat di OLT (buat dulu lewat CLI)           |
| 502    | OLT menolak perintah atau sesi telnet gagal (jaringan, kredensial, dsb.)          |

Memakai kredensial OLT yang sama dengan polling (`olts.password_enc`, dibuka
dengan `DEVICE_SECRET`), sesi telnet terpisah dari polling (dibuat per permintaan,
ditutup sesudahnya), dibatasi 20 detik. Mengikat ulang ONU yang sudah terikat
aman (OLT menerima nilai yang sama); `olt_onus.tr069_bound_at` ditulis ulang.
Next.js meneruskannya lewat `src/app/api/olts/[id]/onus/[pon]/[onu]/tr069-bind/route.ts`
(tiket sekali pakai diterbitkan HANYA setelah sesi dan izin `cpe:manage` Better
Auth lolos, pola yang sama dengan sinkron billing manual).

### Pasang GenieACS lewat web ONT (`POST /api/v1/ont-web/tr069`)

Cara kedua mendaftarkan modem ke GenieACS, untuk modem yang belum pernah
menghubungi ACS: backend login ke halaman web admin modem (`http://IP:80`) dan
mengisi menu Settings > TR-069 seperti teknisi. Hanya **CDTC FD511GW** (web
"ONU Web Management System" 1.0.0.2); merek lain butuh klien sendiri di
`internal/ontweb`. Protokol (dibaca dari JS halaman modem): `POST /post.json`
`module=login` dengan `encryPassword = md5(kata sandi)` mengembalikan `token`
(header `Authorization`), `GET /get.json?module=tr069_config`, `POST /post.json`
`module=tr069_config` (hanya bagian yang berbeda), `module=logout`.

Body: `{"onuId":"<olt_onus.id>"}`. **IP modem dicari otomatis**: ONU -> pelanggan
(`olt_onus.customer_id`) -> nama PPPoE -> alamat sesi aktif di `/ppp/active` MikroTik.
Ini benar karena WAN FD511GW ber-PPPoE (koneksi "TR069_INTERNET"), sehingga alamat
sesi PPPoE adalah IP halaman web modem. ONU belum dipetakan -> 409 `onu_unmapped`;
pelanggan tidak sedang terhubung -> 409 `customer_offline`. Opsional `host` (IPv4)
menimpa pencarian, dan `username`/`password` menimpa admin web modem bawaan di
database (tidak disimpan, tidak dicatat). Alamat hasil pencarian tetap diperiksa
terhadap `ONT_WEB_ALLOWED_CIDRS`. Tiket `cpe:manage`.

Dua kebiasaan modem yang HARUS ditiru klien (dicek terhadap FD511GW asli; tanpa
keduanya modem menjawab kode 10104 untuk SEMUA permintaan, termasuk login):
header `Authorization` selalu ada (`null` sebelum login) dan header `Referer`
(`"Referer is null."`). Kredensial admin web modem sebenarnya bisa dibaca dari
data TR-069 modem yang sudah terdaftar (`InternetGatewayDevice.X_Authentication.WebAccount`);
begitulah nilai awal `ont_web_settings` diisi.

**Empat jenis modem, dikenali otomatis tanpa kredensial** (`ontweb.Detect`: `public_info` FD511GW, judul halaman
login ZIMLINK, judul halaman login GGCLink, lalu halaman login F609; selain itu `ont_wrong_device` dan kredensial tidak dikirim):

| Jenis | Dilaporkan OLT sebagai | Halaman web | Akun admin di `ont_web_settings` |
| ----- | ---------------------- | ----------- | -------------------------------- |
| C-Data FD511GW | `CDTC …` | SPA JSON (`/post.json`, token) | `web_username` / `web_password_enc` |
| ZIMLINK ZL-2113X | `HWTC H113` | server Boa, formulir HTML (`/cgi-bin/*.asp`, cookie) | `zimlink_username` / `zimlink_password_enc` |
| ZTE F609 (MediaTek) | `MTKc F609` | server Boa, `/cgi-bin/*.asp` sekeluarga ZIMLINK, login AJAX `check_auth.json` | `f609_username` / `f609_password_enc` (migrasi 0022) |
| GGCLink GM220-S XPON | `ZICG GM22` | firmware ZTE ("Mini web server"), halaman `*.gch`, tanpa cookie | `ggclink_username` / `ggclink_password_enc` (migrasi 0021) |

ZL-2113X (`internal/ontweb/zimlink*.go`): login = `POST /cgi-bin/index2.asp` + cookie `SESSIONID/UID/PSW`,
lalu WAJIB membuka `content.asp` (tanpa itu modem menjawab 401 untuk halaman lain). TR-069 =
formulir `net-tr069.asp` (16 field), status ACS dibaca dari `sta-acs.asp` ("Reported successfully" = kode 8),
WAN dari `get_node_foreach_info.json?param1=waninfo_wanif` dan disimpan lewat formulir `net-wanset.asp`
(±115 field). Karena satu salah isi bisa memutus PPPoE pelanggan, isi formulir WAN dan TR-069 DIBUKTIKAN
sama byte demi byte dengan yang dikirim halaman asli (diambil di peramban dengan permintaan dibatalkan sebelum
sampai ke modem; 12 modem nyata, 6 varian firmware, fixture tanpa data pelanggan di `testdata/zl2113x`).
`planZLWAN` menolak bentuk yang belum teramati (WAN lebih dari satu, bukan PPPoE/Route/IPv4, VLAN bertag,
kunci JSON tak dikenal, dst.) dengan catatan "ubah manual". Uji baca-saja terhadap modem asli (opt-in):
`ONT_LIVE_ZIMLINK_URL=http://IP ONT_LIVE_ZIMLINK_USER=… ONT_LIVE_ZIMLINK_PASS=… go test ./internal/ontweb -run TestLiveZimlinkReadOnly -v`.

GM220-S (`internal/ontweb/ggclink*.go`): login = `GET /` (token login ada di skripnya, `Frm_Logintoken`) lalu
`POST /` `frashnum=&action=login&Frm_Logintoken=N&username=U&Password=P` (berhasil = 302 ke `/start.ghtml`; gagal =
200 + halaman login dengan "User information is error"; terkunci 1 menit setelah 3 kali salah). Tidak ada cookie:
modem mengenali sesi dari alamat pengirim, dan tiap halaman membawa `session_token` yang harus ikut di POST
(`_SESSION_TOKEN`, paling akhir). TR-069 = menu Network > Remote Management > ITMS (`getpage.gch?pid=1002&nextpage=net_tr069_basic_t.gch`,
formulir `fSubmit`, `IF_ACTION=apply`). Sandi yang tidak diubah dikirim `NULL` dan nilai tersimpan modem berbentuk
base64 (itu sebabnya "sudah sama?" dibandingkan lewat base64). Status lapor dari `manager_act_inform_t.gch`
(`InfoStat`/`InfoDesc`; 3 = "Succeed to report"; "No Wan Connection for TR069" berarti butuh WAN layanan TR069).
**WAN pelanggan TIDAK pernah diubah**: halaman WAN modem ini mengunci "Service List" WAN PPPoE yang sudah ada.
Dengan `ensureWan`, aplikasi MENAMBAH WAN baru bertipe `TR069`, mode DHCP, tanpa VLAN (`ggclink_wan.go`;
POST `IF_ACTION=new`, 80 field, dibuktikan sama byte demi byte dengan peramban asli di dua modem). Hanya
modem dengan tepat satu WAN PPPoE `N_INTERNET_R_VID_` yang dikerjakan; bentuk lain ditolak dengan catatan
"tambahkan manual". Modem lalu meminta IP lewat DHCP di VLAN PON-nya, jadi router HARUS menjawab DHCP di sana
(lihat "Jaringan manajemen ONT" di bawah). Isi POST TR-069 dibuktikan sama byte demi byte
dengan tangkapan peramban asli (dua keadaan: semua kolom diketik, dan hanya URL+interval; fixture di
`testdata/gm22`); susunan formulir yang berbeda ditolak tanpa mengirim apa pun. Pencarian IP lewat MAC TIDAK
dipakai untuk ZICG (selisih MAC ONU dan caller-id PPPoE tidak konsisten); IP dicari lewat nama PPPoE pelanggan.
Uji baca-saja terhadap modem asli (opt-in):
`ONT_LIVE_GGCLINK_URL=http://IP ONT_LIVE_GGCLINK_USER=… ONT_LIVE_GGCLINK_PASS=… go test ./internal/ontweb -run TestLiveGGCLinkReadOnly -v`.

F609 (`internal/ontweb/f609.go`): halaman TR-069 sama dengan ZIMLINK (`ConfigForm`, `SaveFlag=1`, status ACS kode sama),
tetapi login berbeda: `GET /cgi-bin/index2.asp` memuat `var rand = "…"`; `POST /cgi-bin/check_auth.json` dengan
`Password = md5(sandi + rand)`, `Password1=`/`Password2=` kosong, dan WAJIB cookie `loginTimes=0; LoginFailTime=0` (dipasang
halaman sebelum mengirim; tanpanya modem menjawab Privilege 0 untuk sandi yang benar); jawaban JSON
`{Locked, Logged, Privilege, ecntToken}` (Privilege 1/2 = sukses; `ecntToken` menjadi cookie). Setiap POST formulir wajib
membawa cookie `EBOOVALUE = crc32(nama+nilai semua field, hex huruf kecil)` (`setEBooValueCookie` di util.js); keduanya
dibuktikan sama dengan tangkapan peramban asli. Susunan formulir TR-069 di luar yang terverifikasi ditolak. Input lama di
dalam komentar HTML (`PasswordAuthFlag`) tidak ikut terkirim, jadi parser membuang komentar. **WAN belum diubah otomatis**
XX
Uji baca-saja: `ONT_LIVE_F609_URL=http://IP ONT_LIVE_F609_USER=… ONT_LIVE_F609_PASS=… go test -count=1 ./internal/ontweb -run TestLiveF609ReadOnly -v`.

**Jaringan manajemen ONT (tanpa VLAN baru, OLT tidak diubah).** Port PON OLT memakai `port default-vlan 110n`,
jadi frame tanpa tag dari ONU masuk VLAN PON-nya dan sampai ke MikroTik di `vlan110n`. Di MikroTik (semua
objek berkomentar `NOC-MGMT`): DHCP server `noc-mgmt-pN` di tiap `vlan110n` (pool `10.30.N.10-250`, gateway
`10.30.N.1`), firewall yang mengunci `10.30.0.0/21` (modem hanya boleh ke `10.20.30.3:7547`; NOC lewat
WireGuard boleh ke modem; modem tidak boleh ke layanan router), dan ACS tetap `http://172.16.0.1:7547`
(dst-nat router ke NOC). Komputer NOC butuh `10.30.0.0/21` di AllowedIPs tunnel WireGuard supaya connection
request (`http://10.30.N.x:58000`) dan halaman web modem terjangkau. Dibuktikan di modem GM22 nyata:
lease DHCP, Inform di GenieACS, dan connection request 200.

**Pengaturan ada di database, bukan `.env`:** tabel `ont_web_settings` (satu baris,
`id='default'`, migrasi 0019): `acs_url` (alamat CWMP GenieACS yang dapat dijangkau
**modem**, mis. `http://172.16.0.1:7547`), `acs_username`/`acs_password_enc` (bawaan GenieACS: `admin`/`admin`),
`inform_interval` (30-86400, bawaan 300), `web_username`/`web_password_enc` (admin web
modem bawaan). Kata sandi terenkripsi AES-256-GCM dengan `DEVICE_SECRET` (format sama
dengan `olts.password_enc`). Backend membaca baris itu pada SETIAP permintaan, jadi
perubahan langsung berlaku tanpa restart. Diisi lewat dialog "Pasang via web ONT" di
aplikasi (`GET/PUT /api/ont-web/settings`, izin `cpe:manage`, kata sandi tidak pernah
dikembalikan; audit hanya mencatat metode dan target).

| Status | Arti                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| 200    | `{"ok":true,"changed":bool,"fields":[...],"informing":bool,"message":"..."}`; `changed:false` = modem sudah berisi pengaturan itu, tidak ada yang ditulis |
| 400    | Alamat bukan IPv4 / di luar `ONT_WEB_ALLOWED_CIDRS`, body tidak sah, atau tak ada kredensial |
| 422    | Nama pengguna/kata sandi modem salah (TIDAK diulang: modem mengunci setelah 3 salah) |
| 409/423| Sesi modem penuh / login terkunci                                                  |
| 502/504| Modem tidak terjangkau, tidak menjawab seperti FD511GW, atau tidak menyimpan       |
| 503    | `ont_web_settings` belum ada barisnya (`acs_not_configured`)                      |
| 409    | juga: ONU belum dipetakan / pelanggan tidak terhubung (lihat di atas)             |

Satu-satunya env: `ONT_WEB_ALLOWED_CIDRS` (bawaan RFC 1918 + `100.64.0.0/10`). Hanya
alamat di sini yang boleh dibuka (cegah SSRF); loopback, link-local dan publik selalu
ditolak. Sengaja env, bukan database: ini batas keamanan jaringan, bukan data operasional.

Keselamatan: port dikunci 80, redirect tidak diikuti, alamat harus IPv4 literal
(tanpa DNS), logout selalu dijalankan, bagian `cwmp` (kredensial connection
request) tidak disentuh. Idempoten: dijalankan dua kali tidak menulis ulang.
Next.js meneruskannya lewat `src/app/api/ont-web/tr069/route.ts`; UI-nya tombol
"Pasang via web ONT" di Inventaris ONU (`ont-web-dialog.tsx`).

### Histori traffic (`/api/v1/traffic/history`)

Traffic masa lalu dari tabel `traffic_samples` (lihat "Arsip traffic"), untuk
pemilih rentang waktu di dashboard dan untuk menelusuri traffic pada jam insiden.
Nilainya adalah **total semua router** (dijumlahkan per detik, baru dirata-rata
per bucket), atau satu router bila `router` diisi.

- **Jendela:** `range=1h|6h|24h|7d|30d` berakhir sekarang, atau `from` dan `to`
  (detik unix; `to` tidak ikut dan tidak boleh lebih dari semenit di masa depan).
  `range` tidak bisa dipakai bersama `from`/`to`. Paling panjang 31 hari.
- **Langkah:** `step` dalam detik (1-86400). Bila kosong, server memilih langkah
  bulat terkecil yang memberi paling banyak 400 titik: 1 jam per 10 detik, 6 jam
  per 1 menit, 24 jam per 5 menit, 7 hari per 30 menit, 30 hari per 2 jam. Satu
  jawaban paling banyak 2.500 titik; permintaan yang lebih besar ditolak (400).
- **Bucket** adalah kelipatan `step` sejak epoch, dan `from` pada jawaban sudah
  dibulatkan ke bawah ke kelipatan itu, jadi bucket pertama tidak setengah terisi
  (bucket terakhir bisa belum penuh bila `to` adalah sekarang).
- **Celah tidak diisi nol.** Bucket tanpa sampel tidak muncul; celah terlihat
  sebagai selisih waktu antartitik (bukan traffic 0 Mbps yang menyesatkan).
- **Bentuk jawaban** sama dengan `/api/v1/traffic` (kolom sejajar, siap untuk
  uPlot), ditambah `from`, `to`, `step`. Tanpa data, `times`/`rx`/`tx` berupa `[]`.
- **Perlindungan database:** paling banyak 4 query histori berjalan bersamaan
  (yang kelima dijawab `503 {"error":"busy"}` dengan `Retry-After: 1`), tiap query
  dibatasi 10 detik dan dibatalkan di database bila klien pergi. Kegagalan database
  dijawab `503 {"error":"history_unavailable"}` tanpa detail koneksi (detailnya
  hanya di log). Tanpa `DATABASE_URL`, jawabannya 503 yang sama dengan pesan yang
  menyebut `DATABASE_URL`.

```
GET /api/v1/traffic/history?range=24h
GET /api/v1/traffic/history?from=1791400000&to=1791403600&step=10&router=<uuid>
```

**Menelusuri traffic pada jam gangguan.** Event gangguan (WebSocket `events`)
membawa `startedAt` dan, saat selesai, `time` (detik unix) serta `routerId`. Untuk
melihat apa yang terjadi di sekitarnya, minta `from=<startedAt - 300>`,
`to=<time + 300>`, dan `router=<routerId>`; jendela 5 menit di memori sudah lama
lewat, tetapi arsip masih menyimpannya. Skenario ini diuji dari ujung ke ujung
(`history_incident_test.go`): satu jam jaringan disimulasikan lewat `Recorder`,
`Writer`, dan PostgreSQL sungguhan; gangguan "offline" datang dari rule engine; lalu
traffic pada jam gangguan dibaca lewat HTTP dengan tiket. Yang dibuktikan: nilai
sebelum, saat, dan sesudah gangguan benar per router; router yang tidak terpoll
meninggalkan celah (bukan nol); dan batas akhir jendela tidak ikut terbaca.

Catatan skala: query memindai baris `traffic_samples` pada jendelanya (satu baris
per router per detik), jadi 7 hari untuk banyak router bisa memakan beberapa detik
pada PostgreSQL biasa. Bila itu terasa, langkah berikutnya adalah continuous
aggregate TimescaleDB per menit; bentuk API tidak perlu berubah.

### Alert aktif (kontrak yang diasumsikan frontend, belum diimplementasi)

Frontend sudah dibangun terhadap `GET /api/v1/alerts?status=active` (lihat
`src/lib/dashboard/alerts.ts`, yang sementara memakai data tiruan). Bentuknya mengikuti
tabel `network_logs` dan event rule engine, dengan isian waktu dan lokasi yang wajib:

```json
{
  "data": [
    {
      "id": "…",
      "kind": "offline",
      "severity": "warning",
      "routerId": "…",
      "customerId": "…",
      "startedAt": 1791399052,
      "detectedAt": 1791399082,
      "timeSource": "event",
      "timeUncertaintySeconds": 0,
      "location": {
        "name": "ODP-CHP-04",
        "address": "Jl. Mawar No. 12, RT 03/RW 02",
        "odpName": "ODP-CHP-04",
        "latitude": -6.9175,
        "longitude": 107.6191
      },
      "rootSource": { "kind": "odp", "id": "ODP-CHP-04", "name": "ODP-CHP-04" },
      "affectedCustomers": 3,
      "servedCustomers": 8,
      "correlationId": "grp-alert-2985662"
    }
  ]
}
```

- `startedAt` dan `detectedAt` adalah **detik epoch bilangan bulat** (bukan milidetik,
  bukan teks), sama dengan `startedAt`/`time` pada event WebSocket. `detectedAt` =
  `startedAt` + lama yang disyaratkan aturan (30 detik untuk offline dan antrean, 3 menit
  untuk CPU, dst.); selama itu belum ada alert.
- `timeSource` memberi tahu dari mana `startedAt` berasal: `event` bila dicatat router
  sendiri (webhook PPP atau syslog), `poll` bila backend baru mengetahuinya lewat
  polling.
- `timeUncertaintySeconds` adalah paling jauh berapa detik kejadian sebenarnya lebih
  awal dari `startedAt`: 0 untuk `event`, selang polling untuk `poll` (antrean 1 dtk,
  CPU 5 dtk, interface 10 dtk, ppp-active 30 dtk, OLT 60 dtk).

- `location` menjawab "di mana", supaya petugas tidak perlu membuka tabel lain dan
  peta bisa menyorot titiknya. `name` selalu terisi: nama ODP pelanggan bila ada
  (`customers.odp_name`), kalau tidak alamatnya; untuk alert router (antrean, CPU,
  port) nama routernya. `address` dan `odpName` berisi teks dari tabel
  `customers` atau `null`. `latitude` dan `longitude` adalah koordinat
  pelanggan, dan **keduanya `null` bersamaan** bila tidak ada: alert router tidak
  punya koordinat karena tabel `routers` belum menyimpan titik, dan backend tidak
  boleh mengarang titik dari pelanggannya. Nilainya harus sama dengan yang tampil di
  peta (pelanggan yang sama, titik yang sama).

- `rootSource`, `affectedCustomers`, `servedCustomers`, dan `correlationId` memberi
  tahu apa yang harus diperbaiki dan seberapa besar dampaknya (aturan lengkapnya di
  `src/lib/dashboard/incident-root.ts`). `rootSource.kind` salah satu dari
  `customer`, `odp`, `router`, `uplink`; `id` dan `name` adalah id dan nama yang
  ditampilkan. `affectedCustomers` hanya pelanggan yang **terbukti** terdampak
  (punya alert sendiri; nol untuk CPU router tinggi tanpa pelanggan yang putus),
  `servedCustomers` seluruh pelanggan yang dilayani sumber akar itu (batas atas, tidak
  pernah lebih kecil dari yang pertama). `correlationId` sama untuk semua alert yang
  satu penyebab (sedikitnya dua), selain itu `null`. Pengelompokannya dikerjakan
  frontend (`correlation.ts`); bila dipindah ke rule engine Go, bentuk ini tidak
  berubah.

Yang belum ada di backend: endpoint itu sendiri, dan isian `timeSource`,
`timeUncertaintySeconds`, `location`, dan keempat isian dampak di atas pada `wire.Event` (sekarang hanya `time` dan
`startedAt`).

### Riwayat alert selesai (kontrak yang diasumsikan frontend, belum diimplementasi)

Halaman Alert menampilkan dua daftar: alert aktif dan riwayat gangguan yang sudah
selesai. Riwayat dibangun terhadap
`GET /api/v1/alerts?status=resolved&from=<detik>&to=<detik>` (lihat `ResolvedAlert` di
`src/lib/dashboard/alerts.ts`, yang sementara memakai data tiruan). Bentuknya
**sama dengan alert aktif**, hanya `endedAt` yang terisi, dan sumber akar serta
dampak belum ikut:

```json
{
  "data": [
    {
      "id": "…",
      "kind": "offline",
      "severity": "warning",
      "routerId": "…",
      "customerId": "…",
      "startedAt": 1791399052,
      "detectedAt": 1791399082,
      "endedAt": 1791400352,
      "timeSource": "event",
      "timeUncertaintySeconds": 0,
      "endTimeSource": "poll",
      "endTimeUncertaintySeconds": 30,
      "handledBy": null,
      "location": {
        "name": "ODP-CHP-04",
        "address": "Jl. Mawar No. 12, RT 03/RW 02",
        "odpName": "ODP-CHP-04",
        "latitude": -6.9175,
        "longitude": 107.6191
      }
    }
  ]
}
```

- `endedAt` adalah **detik epoch bilangan bulat**: kapan kondisinya berhenti
  (`network_logs.ended_at`). Hanya baris dengan `ended_at` terisi yang masuk
  riwayat. `from` dan `to` membatasi `endedAt` secara setengah terbuka
  (`from < endedAt <= to`); frontend meminta 7 hari terakhir.
- `endTimeSource` dan `endTimeUncertaintySeconds` adalah ketelitian `endedAt`,
  artinya sama dengan `timeSource` dan `timeUncertaintySeconds` untuk `startedAt` tetapi
  **terpisah**: alert bisa mulai dari polling (webhook on-down gagal) lalu selesai
  dari event on-up, seperti contoh di atas. `event` berarti router sendiri mencatat
  pulihnya, tepat sampai detik; `poll` berarti backend baru melihatnya saat
  polling, jadi pulihnya sebenarnya bisa sampai `endTimeUncertaintySeconds` detik
  lebih awal. Frontend menuliskannya di bawah waktu selesai, dengan kata "pulih".
  `operator` berarti petugas menutup alert itu lebih dulu dengan "Tandai ditangani":
  `endedAt` adalah saat petugas mengonfirmasi, `endTimeUncertaintySeconds` selalu 0,
  dan `handledBy` berisi namanya (selain itu `null`). Lihat "Menandai alert
  ditangani" di bawah.
- Isian waktu dan lokasi **tidak boleh berubah** ketika alert pindah dari daftar
  aktif ke riwayat: `startedAt`, `detectedAt`, `timeSource`,
  `timeUncertaintySeconds`, dan `location` harus persis sama. Petugas mencocokkan
  alert yang sama dengan keluhan pelanggan sebelum dan sesudah selesai.
- Urutan: yang paling akhir selesai di atas (`endedAt` menurun, lalu `id`).
  Riwayat bisa ratusan baris; frontend membaginya per halaman di sisi klien (15
  baris). Bila jumlahnya membesar, tambahkan `limit` dan kursor tanpa mengubah
  bentuk baris.
- **Satu alert ada di tepat satu daftar.** Aktif bila `endedAt` kosong, riwayat
  bila terisi. Frontend memuat keduanya dalam satu pembaruan (`loadAlertLists`), jadi
  alert yang baru selesai pindah dalam satu langkah. Bila backend melayaninya lewat
  dua permintaan, minta **aktif dulu, lalu riwayat**: alert yang selesai di antara
  keduanya muncul di dua daftar, dan `loadAlertLists` harus membuangnya dari daftar
  aktif (berdasarkan `id`). Urutan terbalik membuat alert hilang sesaat. Cara paling
  aman: satu permintaan yang mengembalikan keduanya dari satu snapshot.

Yang belum ada di backend: endpoint itu sendiri, dan isian `endTimeSource` serta
`endTimeUncertaintySeconds` pada event selesai di `wire.Event` (sekarang hanya
`time`).

### Menandai alert ditangani (kontrak yang diasumsikan frontend, belum diimplementasi)

Petugas menutup alert aktif lebih dulu dengan tombol "Tandai ditangani" di halaman
Alert (alur PRD: alert lalu pindah ke riwayat). Frontend dibangun terhadap satu
endpoint (lihat `alert-actions.ts` di `src/lib/dashboard/`, yang sementara memakai
server tiruan):

```
POST /api/v1/alerts/{id}/handle      (tanpa isi)

200 {"data": <ResolvedAlert>}        alert sudah ditandai
401                                  belum masuk
404                                  id tidak dikenal
409 {"error": "not_active"}          alert sudah tidak aktif
```

```json
{
  "data": {
    "id": "…",
    "kind": "offline",
    "severity": "warning",
    "startedAt": 1791399052,
    "detectedAt": 1791399082,
    "endedAt": 1791399712,
    "timeSource": "event",
    "timeUncertaintySeconds": 0,
    "endTimeSource": "operator",
    "endTimeUncertaintySeconds": 0,
    "handledBy": "Budi Santoso",
    "…": "…"
  }
}
```

- **Siapa dan kapan diambil server**, dari login dan jamnya sendiri; frontend tidak
  mengirim nama atau waktu. `endedAt` adalah detik epoch bulat saat server
  memproses, dan `handledBy` nama petugas.
- **Siapa yang melayani** diputuskan saat backend dibangun. Ini endpoint tulis
  pertama (REST Go sekarang hanya GET dan HEAD). Bila Go: tiket `Bearer` yang sama
  dengan REST lain (`sub` tiket adalah petugasnya, namanya dibaca dari tabel
  `user`), dan `POST` ikut aturan CORS dan `Origin`. Bila route Next.js: pola
  `withApiSession` dengan pemeriksaan `Origin`, query di `src/services/`, lalu
  memberi tahu hub Go supaya pesan di bawah terkirim.
- **Dinilai saat permintaan diproses**, bukan saat tombol ditekan: alert yang selesai
  sendiri di antaranya, atau yang sudah ditandai petugas lain, dijawab `409`, dan
  frontend menuliskan alasannya di dialog tanpa mengubah apa pun. Penandaan yang
  berhasil tidak bisa ditandai dua kali.
- **Penyimpanan:** dua kolom baru di `network_logs`, `handled_at` dan `handled_by`.
  `ended_at` **tidak** diisi oleh penandaan: yang menutup kondisi di jaringan tetap
  rule engine. Aktif bila `ended_at IS NULL AND handled_at IS NULL`; riwayat bila
  salah satunya terisi, dengan `endedAt = LEAST(ended_at, handled_at)` dan
  `endTimeSource = "operator"` bila `handled_at` yang lebih awal. Alert yang
  sudah ditandai tidak pernah kembali ke daftar aktif, juga bila gangguannya masih
  berlangsung; event selesai yang datang kemudian hanya mengisi `ended_at`.
- **Hub:** setelah penandaan, kirim pesan `alerts` biasa (alert hilang dari
  `active`, muncul di `ended` dengan bentuk di atas) dan pesan `incidents` bila
  kartunya berubah (anggota berkurang, akar dan dampak dihitung ulang). Jawaban
  `200` dan pesan hub memuat alert yang sama; frontend menerapkan keduanya tanpa
  efek ganda (`handledState` dan `mergeEnded` mengenali `id`). Ketiga daftar
  yang berbeda (aktif, riwayat, dan anomali) harus sepakat: alert yang sudah
  ditandai tidak dihitung aktif di mana pun.
- **Rule engine:** gangguan yang sudah ditandai tidak dibuka lagi sebagai alert baru
  selama kondisinya sama (id dan barisnya sama); hanya kondisi yang pulih lalu
  muncul lagi yang menjadi alert baru dengan `id` baru, dan itu berbunyi seperti
  alert baru lainnya.
- **Audit:** tiap penandaan ditulis ke `audit_log` (siapa, alert mana, kapan).

### Status billing (diimplementasi: `httpapi/billing.go`, `billing/reader.go`)

Kedua endpoint di bawah (`GET /api/v1/billing` dan `GET /api/v1/billing/sync`)
SUDAH ada. Hanya baca (metode lain 405 dengan `Allow`), di balik tiket (tiket
hanya-lihat boleh membaca), `Cache-Control: no-store`. Bila sinkron billing tidak
berjalan di proses itu (tidak dikonfigurasi, tanpa `DATABASE_URL`) jawabannya 503
`{"error":"billing_disabled"}`; galat database 500 `{"error":"internal"}` tanpa teks
galat. Bentuk jawabannya dikunci oleh berkas golden (`httpapi/testdata/`) dan
spesifikasi `e2e/billing-contract.spec.ts`. Di mana teks di bawah berbeda dengan
tipe TS di `src/lib/dashboard/billing.ts`, tipe TS yang berlaku; yang diketahui
berbeda: `invoiceRef` dan `billingName` boleh `null` pada baris `exact` atau
`normalized` (situs billing bisa tanpa kolom kode tagihan), dan
`BillingUnmatched.invoiceRef` ditulis `""` bila tidak ada. Baris dari sebelum
migrasi `0006` (tanpa `match_kind`) dibaca `none` dengan status dari
`billing_status`. Selama login ke billing ditolak berulang, `nextRunAt` tetap slot
nominal berikutnya walau penjadwal melewatinya.

Halaman Billing (`/app/billing`) menampilkan hasil sinkron billing: keadaan
sinkron per jam, status Lunas atau Isolir tiap pelanggan beserta cara tagihannya
dicocokkan, dan tagihan yang tidak bisa dipasangkan. Frontend dibangun terhadap
satu endpoint (lihat `BillingOverview` di `src/lib/dashboard/billing.ts`, yang
sementara memakai data tiruan lewat `loadBilling`):

```
GET /api/v1/billing

200 {"data": <BillingOverview>}
401                                  belum masuk
```

```json
{
  "data": {
    "sync": {
      "intervalSeconds": 3600,
      "running": null,
      "nextRunAt": 1791403500,
      "runs": [
        {
          "id": "…",
          "startedAt": 1791399900,
          "finishedAt": 1791399908,
          "status": "success",
          "result": {
            "invoices": 104,
            "matched": 94,
            "unmatched": 10,
            "withoutInvoice": 6
          },
          "error": null
        },
        {
          "id": "…",
          "startedAt": 1791396300,
          "finishedAt": 1791396313,
          "status": "failed",
          "result": null,
          "error": "Token CSRF tidak ditemukan di halaman login billing."
        }
      ]
    },
    "rows": [
      {
        "customerId": "…",
        "name": "Agus Firmansyah",
        "pppoeUsername": "agus.firmansyah014",
        "routerId": "…",
        "routerName": "RTR-Barat-02",
        "status": "lunas",
        "match": "exact",
        "invoiceRef": "INV-10014",
        "billingName": "agus.firmansyah014"
      }
    ],
    "unmatched": [
      {
        "invoiceRef": "INV-10034-B",
        "pppoeUsername": "budi.lestari034",
        "status": "lunas",
        "reason": "duplicate"
      }
    ]
  }
}
```

- **Waktu** adalah detik epoch bilangan bulat, seperti kontrak alert. `intervalSeconds`
  adalah jarak antar sinkron (3600 untuk "tiap jam"); frontend menuliskannya di
  kartu sinkron.
- **`sync.running`** berisi `{"startedAt": …}` selama sebuah sinkron berjalan, selain
  itu `null`. **`sync.nextRunAt`** selalu setelah saat jawaban dibuat: bila ada
  sinkron yang berjalan, ia adalah sinkron sesudahnya. Frontend bertanya lagi
  tepat pada `nextRunAt` (ditambah jeda satu detik) dan tiap 5 detik selama
  `running` terisi, selain penyegaran tiap 30 detik, jadi `running` harus sudah
  terisi sejak detik mulainya.
- **`sync.runs`** adalah 24 sinkron terakhir yang **sudah selesai**, terbaru di
  atas (`finishedAt` menurun); sinkron yang sedang berjalan belum masuk. Isi sebuah
  sinkron tidak boleh berubah setelah selesai. `status` `success` berarti `result`
  terisi dan `error` `null`; `failed` sebaliknya. `error` adalah kalimat untuk
  petugas tentang apa yang gagal (login ditolak, token CSRF tidak ditemukan,
  billing tidak menjawab, tabel tidak terbaca); jangan memuat kata sandi, cookie,
  token, atau alamat internal sistem billing. `result.invoices` selalu
  `matched + unmatched`, dan `result.withoutInvoice` adalah pelanggan yang tidak
  mendapat tagihan pada sinkron itu.
- **Sinkron yang gagal tidak mengubah data.** `rows` dan `unmatched` tetap hasil
  sinkron **berhasil** terakhir, dan `billing_status` serta
  `customers.billing_status` tidak disentuh. Frontend menghitung sendiri dari
  `runs` sudah berapa lama data itu dan berapa sinkron gagal berturut-turut,
  jadi tidak ada ambang "usang" di backend.
- **`rows`** memuat **satu baris untuk tiap pelanggan**, termasuk yang tidak punya
  tagihan, urut nama (`name`, lalu `pppoeUsername`). `status` adalah status dari
  tagihan yang cocok bila ada, kalau tidak `customers.billing_status` yang
  tersimpan; frontend tidak membedakan keduanya selain lewat `match`. `invoiceRef`
  dan `billingName` (nama PPPoE persis seperti tertulis di billing) berisi `null`
  tepat bila `match` adalah `none`.
- **`unmatched`** memuat tagihan hasil sinkron berhasil terakhir yang tidak
  dipasangkan dengan pelanggan, urut `invoiceRef`, dengan alasan `unknown`,
  `duplicate`, atau `ambiguous`.
- **`GET /api/v1/billing/sync`** mengembalikan hanya `{"data": <sync>}`, objek yang
  sama dengan `data.sync` di atas tanpa `rows` dan `unmatched`. Dipakai halaman
  yang cuma perlu tahu seberapa baru data tagihannya (ringkasan sinkron di halaman
  Pelanggan, `loadBillingSync`), supaya tidak menarik seluruh daftar pelanggan.
  Aturan penyegarannya sama: frontend bertanya tiap 30 detik, tepat pada
  `nextRunAt` (ditambah jeda satu detik), dan tiap 5 detik selama `running`
  terisi.
- **Daftar ketidakcocokan** di halaman Billing (tagihan tanpa pelanggan dan
  pelanggan tanpa tagihan, dengan saran bila nama PPPoE-nya hanya beda satu atau
  dua huruf) dihitung frontend dari `rows` (baris `match` `none`) dan `unmatched`
  (`buildMismatches`); backend tidak perlu endpoint tambahan.
- **Aturan pencocokan** (wajib sama dengan `matchBilling` di `billing.ts`, yang
  diuji terhadap pembanding lain di `e2e/billing.spec.ts`):
  1. Nama PPPoE di billing sama persis dengan `customers.pppoe_username`:
     `match` `exact`.
  2. Bila tidak ada yang persis, kedua sisi dirapikan (spasi di ujung dibuang,
     huruf kecil semua) lalu dibandingkan. Cocok dengan **tepat satu**
     pelanggan: `normalized`. Billing sering menulis huruf besar atau menyisakan
     spasi, jadi ini bukan kesalahan data pelanggan. Di Go pakai
     `strings.ToLower(strings.TrimSpace(nama))`; uji juga nama bukan ASCII,
     karena `ToLower` dan `toLowerCase` di JavaScript tidak selalu sama untuk
     semua huruf.
  3. Tagihan yang tidak bisa dipasangkan tidak dipaksakan: `unknown` (tidak ada
     pelanggan bernama itu), `duplicate` (pelanggannya sudah dipasangkan dengan
     tagihan lain; satu tagihan dipakai, yang lain dilaporkan), atau
     `ambiguous` (setelah dirapikan cocok dengan lebih dari satu pelanggan,
     misalnya `Budi01` dan `budi01`, karena nama PPPoE MikroTik membedakan huruf
     besar dan kecil).
  4. Tagihan yang persis menang atas yang dirapikan berapa pun urutannya. Bila
     dua tagihan sama-sama persis (atau sama-sama dirapikan) berebut satu
     pelanggan, yang pertama dalam urutan baca dari billing dipakai.
  5. Pelanggan tanpa tagihan (`none`) tidak diubah statusnya.

Yang belum ada di backend: kedua endpoint itu, klien billing (cookiejar, token
CSRF, goquery), penjadwal per jam, tabel `billing_sync_runs` (waktu mulai dan
selesai, hasil, dan pesan galat) dan tabel untuk tagihan yang belum cocok (tabel
`billing_status` mewajibkan `customer_id`, jadi tidak bisa memuatnya), serta dua
kolom di `billing_status` untuk `match` dan `billing_name`.

## Sinkron billing (implementasi)

Paket `internal/billing` menyinkronkan status Lunas atau Isolir tiap jam. Satu
sinkron (`Syncer.RunOnce`): `BeginRun` (satu baris `running`; indeks unik
parsial menolak sinkron kedua) → baca tagihan dari situs billing (`Scraper`:
cookiejar, token CSRF, goquery, berpaginasi) → `LoadCustomers` →
`MatchInvoices` → `ApplySuccess` (satu transaksi: upsert `billing_status`,
hapus baris pelanggan tanpa tagihan, ubah `customers.billing_status` hanya untuk
yang benar-benar berbeda, tulis `billing_mismatches`, tutup log `success`) →
`PruneRuns` → beri tahu pendengar (hub). Semua galat setelah `BeginRun` menutup
log `failed` lewat `FailRun` TANPA menyentuh status pelanggan: status lama tetap
berlaku.

- **Pencocokan** (`match.go`) memakai aturan yang sama persis dengan
  `matchBilling` di frontend (nama persis menang atas yang dirapikan, normalized
  hanya bila cocok tepat satu pelanggan, duplikat dan ambigu dilaporkan, pelanggan
  tanpa tagihan tidak diubah). Kesamaan dibuktikan oleh berkas contoh bersama
  `internal/billing/testdata/match_cases.json` (543 kasus dari `matchBilling` TS
  asli) yang dibaca tes Go dan `e2e/billing-conformance.spec.ts`. Perapian nama
  meniru JavaScript (`trim`/`toLowerCase`), bukan `strings.TrimSpace`/`ToLower`.
  Buat ulang berkasnya dengan `UPDATE_BILLING_FIXTURE=1 npm run test:e2e -- e2e/billing-conformance.spec.ts`.
- **Situs billing** dibaca lewat `Profile` (`profile.go`): halaman login, selektor
  token CSRF, nama field, selektor baris dan kolom, peta teks status ke
  `lunas|isolir`, dan paginasi. `DefaultProfile()` hanya tebakan generik (gaya
  Laravel); **profil harus dicocokkan dengan HTML situs billing yang sebenarnya**
  dan belum bisa diatur lewat env (butuh kode di `cmd/server/billing.go`).
  Teks status yang tidak dikenal menggagalkan sinkron, tidak ditebak.
- **Jadwal** (`schedule.go`, `scheduler.go`): tiap jam pada menit
  `BILLING_SYNC_MINUTE` (UTC); satu sinkron paling banyak per slot dan slot yang
  terlewat selama sinkron panjang dilewati, tidak dikejar. Saat backend mulai:
  baris `running` yang tertinggal ditandai `failed`, dan satu sinkron langsung
  jalan bila yang sukses terakhir lebih tua dari satu jam. Waktu dan pewaktu
  disuntikkan, jadi tes tidak tidur sungguhan.
- **Kegagalan** (`failure.go`, `dropguard.go`): galat dikelompokkan (`credentials`,
  `source_changed`, `unknown_status`, `network`, `timeout`, `server_error`,
  `empty_source`, `anomalous_drop`, `canceled`, `internal`) dengan pesan Indonesia
  tanpa alamat internal atau rahasia; yang disimpan di log sinkron adalah pesan itu.
  Hanya `network`, `timeout`, dan `server_error` diulang (3 percobaan, jeda 15 lalu
  45 detik, dalam satu baris log); login yang ditolak tidak pernah diulang. Tiga
  kegagalan `credentials` beruntun menurunkan percobaan menjadi sekali per 6 jam
  (dipulihkan dari log saat restart). Sumber yang mengembalikan nol tagihan ditolak
  (kalau tidak, semua baris `billing_status` terhapus), dan jumlah tagihan di
  bawah `BILLING_DROP_PERCENT` dari sinkron sukses terakhir juga ditolak.
- **Push ke dashboard**: sesudah `ApplySuccess` kembali, `Result.Changes` masuk
  `Manager.SetBillingStatuses`; `delta` berikutnya memuat `billingChanges` untuk
  semua klien tersambung (sekali; klien yang tersambung kemudian mendapat status
  lewat snapshot). Maksimum `Options.MaxBillingChanges` (2000) per delta; sisanya
  terkirim di detik berikutnya menurut urutan ID. Berkas golden
  `hub/testdata/*_billing.golden.json` dan `e2e/billing-ws-contract.spec.ts`
  menjaga bentuknya terhadap store frontend (`UPDATE_GOLDEN=1 npm test` untuk
  membuat ulang).
- **Keterbatasan yang diketahui**: `Manager` di `main.go` masih kosong sampai ada
  pemuat pelanggan dari database (task collector), jadi perubahan billing belum
  tampil di dashboard hidup sampai itu ada (jalur kirimnya sudah teruji);
  penjaga penyusutan perlu diatur lewat env bila tagihan memang mengecil; detektor
  `-race` belum dijalankan (cgo tidak ada di mesin pengembangan Windows);
  scraper belum diuji terhadap situs billing sungguhan.

## Rule engine (gangguan)

`engine.Engine` tidak mengirim event tiap detik selama pelanggan offline. Aturan
(`engine.Rule`) hanya menyatakan **kondisi yang sedang benar**; engine
membandingkannya dengan evaluasi sebelumnya dan hanya mengeluarkan event saat
sebuah gangguan **mulai** atau **selesai**. Event mulai dan selesai milik satu
gangguan memakai `id` yang sama.

- **Durasi (`Condition.For`).** Gangguan baru ada setelah kondisinya terus benar
  selama itu. Pelanggan yang putus 10 detik lalu tersambung lagi tidak pernah
  menjadi event, jadi koneksi yang berkedip tidak membunyikan alert.
- **Dihitung dari data, bukan dari engine.** `Condition.Since` memakai
  `Customer.StatusSince` (kapan pelanggan benar-benar putus). Setelah backend
  dinyalakan ulang, pelanggan yang sudah lama offline langsung dikenali, tidak
  menunggu 30 detik lagi.
- **Satu pesan per putaran.** Event dari satu evaluasi dikirim sebagai satu daftar
  (`Sink func([]Event)`). Bila satu router mati dan 500 pelanggan putus bersamaan,
  dashboard menerima satu pesan `events`, bukan 500 pesan yang meluapkan antrean
  dan memutus dashboard tepat saat ada gangguan besar.
- **Aturan rusak tidak mematikan yang lain.** Aturan yang panik dilewati dan
  dicatat di log.
- `Engine.Active()` mengembalikan gangguan yang sedang berlangsung (untuk daftar
  alert aktif nanti).

**Aturan yang ada:** `OfflineRule` (pelanggan offline lebih dari 30 detik, batas
diambil dari PRD, belum bisa diubah lewat pengaturan). Aturan traffic >95%, CPU,
sinyal optik, dan port error ditambahkan sebagai `Rule` baru tanpa mengubah
engine. **Belum ada:** riwayat gangguan di tabel `network_logs`, dan pengiriman
gangguan yang sedang aktif ke dashboard yang baru tersambung (dashboard baru
hanya menerima gangguan yang mulai atau selesai setelah ia tersambung; keadaan
online/offline tetap lengkap lewat snapshot).

## Jalur event: webhook PPP dan syslog

Dua jalur memberi tahu backend saat pelanggan tersambung atau terputus, tanpa
menunggu polling. Keduanya mengubah status lewat `state.Manager` dan hub langsung
menyiarkannya ke dashboard (pesan `status`). Jalur yang kedua menyusul jalur
pertama tidak mengubah apa pun, jadi memakai keduanya aman. Pada uji dengan
WebSocket sungguhan, dari webhook sampai ke klien sekitar 50 ms (target PRD:
kurang dari 1 detik).

**Webhook (jalur utama), `/hooks/ppp`, aktif bila `PPP_WEBHOOK_TOKEN` diisi.**
Pasang di PPP profile router (on-up dan on-down):

```
# on-up
/tool fetch url="http://<backend>:8080/hooks/ppp" http-method=post \n  http-header-field="X-Webhook-Token: <token>" \n  http-data="event=up&user=$user&router=<id router>" keep-result=no
# on-down: sama, dengan event=down
```

- Token hanya lewat header (`X-Webhook-Token` atau `Authorization: Bearer`), tidak
  lewat query, supaya tidak masuk log proxy.
- `event` (`up`/`down`) dan `user` (username PPPoE) wajib; `router` opsional. Boleh
  query (GET), form (POST, Content-Type apa pun), atau JSON. Parameter tak dikenal
  atau diulang ditolak (400).
- Jawaban: 200 `{"status":"ok","changed":true|false}`, 401 token salah, 404
  `unknown_customer`, 409 `router_mismatch` (pelanggan bukan milik `router`).
- **Satu token dipakai semua router**, jadi router yang bocor tokennya bisa
  memalsukan status pelanggan mana pun. Isian `router` bukan pengamanan karena
  diisi pengirim. Token per router membutuhkan penyimpanan di database (belum ada).

**Syslog UDP (cadangan), aktif bila `SYSLOG_ADDR` diisi.** Atur router mengirim log
topik `ppp,account` ke backend (`/system logging action` tipe `remote`, lalu
`/system logging add topics=ppp,account action=<aksi>`). Baris yang dikenali:
`<user> logged in, ...` dan `<user> logged out, ...` dengan topik `ppp`.

- Hanya paket dari **alamat IP router terdaftar** (`Host` router, berupa IP) yang
  diproses, dan router hanya bisa mengubah pelanggannya sendiri.
- **UDP tidak punya autentikasi** dan alamat sumber bisa dipalsukan. Aktifkan hanya
  di jaringan manajemen tepercaya, dan batasi port UDP-nya dengan firewall.
- Port 514 butuh hak khusus di Linux (mis. `CAP_NET_BIND_SERVICE` di Docker); di
  pengembangan pakai port tinggi seperti `:5514`.
- Baris login sistem (`user admin logged in ... via winbox`, topik `system`)
  sengaja diabaikan.

**Belum diuji terhadap router sungguhan.** Format baris syslog di atas (topik lalu
pesan) berdasarkan keluaran RouterOS yang umum, dan yang dikirim `/tool fetch`
diuji tanpa asumsi Content-Type. Coba pada satu router sebelum diandalkan.

## Trafik dashboard: counter interface, bukan rate queue

Diukur di router nyata (24 sampel per detik, jumlah `rate` queue terhadap laju counter interface OLT): `rate`
queue adalah rata-rata yang dihaluskan RouterOS, jadi tertinggal ±3 detik dan lebih datar daripada laju sebenarnya
(116–165 Mbps pada saat interface menunjukkan 92–204 Mbps); jumlahnya juga ±5% lebih rendah untuk download dan
±20% untuk upload (overhead PPPoE dan trafik tanpa queue). Winbox membaca counter byte interface, jadi dashboard
sekarang melakukan hal yang sama: tiap detik `GET /rest/interface?name=…` (`rx-byte`, `tx-byte`), laju = selisih
byte × 8 / selang waktu sebenarnya (titik tengah permintaan), `ifRate` menolak counter yang turun (router restart)
dan selang lebih dari 15 detik. Sampel pertama dan tiap kegagalan jatuh ke jumlah queue. Queue tetap dibaca
tiap detik untuk rule engine (rasio per pelanggan).

## Collector MikroTik (polling queue)

`collector.Poller` mengambil **satu permintaan massal per router tiap detik**:
`GET /rest/queue/simple?.proplist=name,rate,parent,disabled`, bukan satu per
pelanggan. Hasilnya dijumlahkan menjadi satu sampel traffic dan disimpan lewat
`state.Manager.RecordTraffic`.

```go
poller := collector.NewPoller(manager, collector.PollerOptions{Logger: logger})
poller.Start(ctx, collector.Target{
    RouterID: "r1", BaseURL: "https://10.0.0.1", Username: "api", Password: pw,
})
```

- **Yang dijumlahkan:** queue aktif tingkat atas saja (`parent=none`), supaya induk
  dan anaknya tidak terhitung dua kali. `rate` berformat `upload/download` dalam
  bit per detik; download (ke pelanggan) menjadi Rx, upload menjadi Tx.
- **Tidak menumpuk:** satu permintaan dibatasi 90% dari interval, dan tiap router
  dipoll berurutan, jadi router yang lambat tidak mendapat permintaan bersamaan.
- **Router mati:** setelah 3 kali gagal berturut-turut jaraknya dilebarkan
  (2x, 4x, ... maksimal 30 detik) dan kembali 1 detik begitu pulih. Tidak ada
  sampel palsu saat gagal. Log hanya mencatat kegagalan pertama dan tiap 60 kali
  sesudahnya, plus saat pulih.
- **Keamanan:** verifikasi TLS tidak pernah dimatikan; untuk sertifikat router
  sendiri berikan `HTTPClient` yang mempercayai CA-nya. `http://` hanya bila
  ditulis eksplisit (dan diberi peringatan di log). Kata sandi tidak muncul di
  pesan error atau log, dan isi jawaban error router tidak dibaca ke log.
- **Batas jawaban:** 16 MB.
- `Poller.Status(routerID)` memberi waktu sukses terakhir, jumlah gagal
  berturut-turut, dan pesan error terakhir untuk polling queue;
  `Poller.JobStatus(routerID, job)` untuk job lainnya.

### Polling cadangan

Diaktifkan dengan `PollerOptions.Backup` (kosong berarti hanya polling queue). Tiap
job punya interval, batas waktu, dan backoff sendiri, jadi satu job yang gagal
tidak mengganggu yang lain (traffic tetap masuk walau `/ppp/active` error).

| Job          | Endpoint                | Interval | Disimpan ke                                               |
| ------------ | ----------------------- | -------- | --------------------------------------------------------- |
| `queue`      | `/rest/queue/simple`    | 1 detik  | traffic (ring buffer)                                     |
| `ppp-active` | `/rest/ppp/active`      | 30 detik | status online/offline pelanggan                           |
| `resource`   | `/rest/system/resource` | 5 detik  | `Manager.RouterResource` (CPU, memori, uptime, versi)     |
| `interface`  | `/rest/interface`       | 10 detik | `Manager.RouterInterfaces` (error dan drop per interface) |

```go
collector.NewPoller(manager, collector.PollerOptions{
    Logger: logger,
    Backup: &collector.BackupOptions{Store: manager, Presence: manager, Notify: notify},
})
```

- **`/ppp/active` adalah jaring pengaman** bila webhook dan syslog terlewat: status
  pelanggan router itu disamakan dengan daftar sesi PPPoE yang aktif. Sesi VPN
  (L2TP, PPTP, ...) tidak dihitung, dan satu router hanya mengubah pelanggannya
  sendiri.
- **Tidak menimpa perubahan yang lebih baru.** Daftar sesi diambil pada saat
  tertentu; pelanggan yang statusnya berubah _sesudah_ permintaan dikirim (mis.
  webhook "up" tiba selagi daftar diambil) dilewati, karena daftar itu belum
  memuatnya dan menimpanya akan membalik status yang benar.
- **Gagal bukan berarti offline.** Bila `/ppp/active` error, status pelanggan
  tidak diubah; semua pelanggan menjadi offline hanya bila router sendiri
  menjawab daftar yang kosong. Bila banyak pelanggan berubah sekaligus (20 atau
  lebih dan lebih dari separuh), dicatat sebagai peringatan di log.
- Penghitung error interface hanya naik; deteksi "kerusakan port" kelak melihat
  kenaikan antara dua sampel.
- Nilai interval bisa diubah lewat `BackupOptions`; bagian yang dependensinya nil
  (Store atau Presence) dilewati.

**Belum diuji terhadap router sungguhan.** Test memakai server tiruan yang meniru
bentuk jawaban REST RouterOS v7 (array objek, semua nilai string, `.proplist`
dan urutan `upload/download` sesuai dokumentasi MikroTik). Coba pada satu router
sungguhan sebelum diandalkan; yang paling perlu dipastikan adalah format `rate`
dan nama queue PPPoE dinamis (`<pppoe-username>`) di versi RouterOS yang dipakai.

## Arsip traffic (`internal/archive`)

`archive.Writer` menyimpan sampel traffic per router per detik ke tabel
`traffic_samples`, di jalur yang terpisah dari pemantauan real-time:

```go
store := archive.NewPGStore(pool) // *pgxpool.Pool dari DATABASE_URL
writer := archive.NewWriter(store, archive.Options{Logger: logger})
go writer.Run(ctx)
// polling mengisi state dan arsip sekaligus:
collector.NewPoller(archive.Recorder{Next: manager, Writer: writer}, opts)
```

- **Tidak mengganggu polling.** `Enqueue` hanya memasukkan ke antrean dan tidak
  pernah menunggu database; antrean penuh membuang sampel baru (dihitung di
  `Stats().Dropped`), bukan menahan polling. Uji: 5.000 `Enqueue` saat database
  macet selesai dalam kurang dari 1 detik (batas yang dijaga test).
- **Berbatch.** Sampel disimpan tiap 5 detik atau tiap 2.000 sampel, satu perintah
  SQL per batch. Detik yang sama dari router yang sama ditulis sekali (yang
  terakhir menang), dan penulisan ulang menggantikan baris, bukan menggandakannya.
- **Database mati tidak menghilangkan data dengan segera.** Sampel ditahan dan
  dicoba lagi dengan jeda 1, 2, 4, ... maksimal 30 detik, urutan tetap terjaga.
  Penampung dibatasi 100.000 sampel (sekitar satu jam untuk 25 router); lewat itu
  yang **tertua** dibuang dan dicatat di `Stats` dan log. Saat berhenti, sisa
  sampel disimpan sekali lagi (paling lama 10 detik).
- **Router yang belum ada di tabel `routers`** dilewati per sampel (bukan
  menggagalkan seluruh batch); ID router yang bukan UUID, nilai negatif, NaN, dan
  tak hingga ditolak di `Enqueue`.
- **Retensi dan pembersihan otomatis.** Dicek saat mulai lalu tiap jam
  (`Options.PurgeEvery`). Cara kerjanya bergantung pada database:
  - **TimescaleDB:** tabel adalah hypertable dengan kebijakan retensi dari migrasi
    `0004` (30 hari), dan database sendiri yang menjatuhkan chunk lama. Bila
    `Options.Retention` diisi, kebijakan itu disamakan dengan nilai tersebut
    (diganti dalam satu transaksi, dan tidak diganti bila sudah sama). Bila
    **tidak** diisi, kebijakan yang sudah ada dibiarkan, jadi pengaturan DBA tidak
    ditimpa diam-diam.
  - **PostgreSQL biasa:** penulis yang menghapus sampel lebih tua dari masa simpan
    (default 30 hari), bertahap 50.000 baris per perintah dengan jeda 20 ms di
    antaranya, paling banyak 200 batch per putaran (sisanya dilanjutkan jam
    berikutnya), supaya tabel besar tidak terkunci atau membanjiri WAL.
  - Penghapusan lewat kunci utama, bukan `ctid`: pada hypertable `ctid` dari chunk
    yang berbeda bisa bertabrakan dan menghapus baris yang salah.
  - **Pengaman:** masa simpan di bawah 24 jam (`MinRetention`, mis. salah ketik 1
    detik) dinaikkan ke 24 jam dan dicatat di log, dan `Purge` menolak batas hapus
    yang lebih baru dari 24 jam walau dipanggil langsung. `Stats()` memuat
    `Purged` (baris yang dihapus penulis) dan `LastPurge`.
  - Hanya arsip traffic yang dibersihkan otomatis. Riwayat gangguan
    (`network_logs`) dan `audit_log` sengaja tidak dihapus.
- `Recorder` hanya mengarsipkan sampel yang diterima `state.Manager`, jadi
  sampel yang ditolak (terlalu tua, router tak dikenal) tidak masuk arsip.

### Uji beban dan retensi

`internal/archive/load_test.go` menjalankan beban sebesar 200 router (satu sampel
per router per detik) pada PostgreSQL sungguhan, bagian dari `npm test` (sekitar 15
detik). Batas di test sengaja longgar; angka di bawah adalah hasil ukur di mesin
pengembangan (PostgreSQL 17 di Docker), jadi gunakan sebagai gambaran, bukan janji.

| Skenario                                                                                | Yang dijaga                                                                         | Hasil ukur                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| 60 detik traffic 200 router (12.000 sampel) dimasukkan secepat mungkin                  | semua tersimpan, tidak ada yang dibuang; `Enqueue` tidak menunggu database          | Enqueue terlama < 1 ms; semua tersimpan ~0,5 dtk  |
| 200 router melapor tiap detik lewat `Recorder` -> `state.Manager` -> `Writer`, 4 detik  | satu putaran jauh di bawah 1 detik; antrean arsip tidak menumpuk antar detik        | putaran < 1 ms; antrean sebelum putaran berikut 0 |
| 20.000 baris berumur 3 hari dihapus bertahap (batch 500) sambil sampel baru terus masuk | data lama habis, data 23 jam lalu selamat, semua sampel baru tersimpan, tanpa gagal | selesai ~2 dtk, `Enqueue` tidak terganggu         |
| Baca 1 jam traffic 100 router (360.000 baris) sebagai 360 titik                         | histori cukup cepat untuk dipanggil tiap pengguna berpindah rentang                 | 35 ms semua router, 4 ms satu router              |

Dua hal ditemukan dan diperbaiki lewat uji ini. Pertama, menghentikan `Writer`
saat sebuah `Insert` sedang berjalan memutus `Insert` itu dengan `context canceled`
dan dihitung sebagai kegagalan database (juga dicatat sebagai peringatan), padahal
sampelnya tetap disimpan oleh penyimpanan akhir. Sekarang pembatalan karena berhenti
tidak dihitung dan tidak dicatat sebagai gagal; kegagalan database yang sungguhan
tetap dihitung, juga saat berhenti. Kedua, hal yang sama berlaku untuk pembersihan
yang terputus di tengah jalan oleh penghentian.

**Batas yang belum diuji:** beban 2.000+ pelanggan per router (bukan hanya 200
router), query 7 hari pada banyak router (puluhan juta baris pada PostgreSQL biasa),
dan TimescaleDB di bawah beban (hanya kebijakan retensinya yang diuji, di kontainer
sementara). Penulisan dan pembacaan juga belum diuji pada koneksi database yang
lambat atau putus-sambung.

**Sisi baca sudah tersambung, sisi tulis belum.** Bila `DATABASE_URL` diisi,
server membuka pool ke database (tanpa langsung terhubung, jadi database yang
belum menyala tidak menghalangi backend naik) dan melayani
`/api/v1/traffic/history` lewat `PGStore.History`. `Writer` dan poller belum
dijalankan oleh server, karena belum ada sumber daftar router yang menyalakan
polling; sampai itu ada, tabel hanya terisi oleh data yang dimasukkan lain. `npm test` menjalankan test backend, termasuk test
PostgreSQL sungguhan, pada database sekali pakai yang sama dengan test Node (bila
Go terpasang). Test khusus TimescaleDB (kebijakan retensi) dilewati di sana karena
image test adalah PostgreSQL biasa; keduanya sudah dijalankan terhadap kontainer
TimescaleDB sementara.

## Database

Satu database PostgreSQL dipakai bersama. **Skema dan migrasi dikelola Drizzle di
root repo** (`src/db/schema/`, `drizzle/`), bukan oleh backend Go. Backend hanya
membaca dan menulis lewat pgx pada task berikutnya. Ubah skema dengan
`npm run db:generate`, periksa SQL-nya, lalu `npm run db:migrate`.

Tabel inti NOC (migrasi `0003_noc_core`) dan arsip traffic (`0004_traffic_archive`):

| Tabel             | Isi                                                                            |
| ----------------- | ------------------------------------------------------------------------------ |
| `routers`         | Router MikroTik. Kata sandi disimpan terenkripsi (`password_enc`).             |
| `olts`            | OLT dengan `brand` dan `driver`. Kata sandi terenkripsi.                       |
| `olt_pon_ports`   | Kondisi optik terakhir per PON port. Satu baris per port.                      |
| `olt_onus`        | Kondisi optik terakhir per ONU. Satu baris per ONU, satu per pelanggan.        |
| `customers`       | Pelanggan PPPoE (`pppoe_username` unik), koordinat, nama ODP, status online.   |
| `billing_status`  | Hasil sinkron billing terbaru. Satu baris per pelanggan.                       |
| `network_logs`    | Anomali saja. `ended_at` kosong berarti masih aktif.                           |
| `cpe_tasks`       | Antrean ubah SSID/sandi WiFi lewat GenieACS.                                   |
| `audit_log`       | Siapa mengubah apa dan kapan.                                                  |
| `traffic_samples` | Arsip traffic: satu baris per router per detik (Mbps). Lihat catatan di bawah. |

Keputusan yang perlu diketahui:

- Tabel `users` di PRD adalah tabel `user` bawaan Better Auth (login dan peran
  sudah ada di sana), jadi tidak dibuat tabel kedua.
- `olt_pon_ports`, `olt_onus`, dan `billing_status` menyimpan keadaan terbaru
  (di-upsert), bukan riwayat.
- Router tidak bisa dihapus selama masih punya pelanggan atau catatan jaringan;
  nonaktifkan lewat `status`. Menghapus pelanggan ikut menghapus billing dan
  tugas CPE-nya, sedangkan ONU dan catatan jaringannya tetap dengan
  `customer_id` kosong. Menghapus akun tidak menghapus audit dan tugas CPE.
- Alamat dan koordinat pelanggan boleh kosong, karena pelanggan yang ditemukan
  dari data PPPoE belum tentu sudah dilengkapi. `billing_status` pelanggan
  bawaannya `lunas` sampai sinkron billing pertama.
- **Arsip traffic (`traffic_samples`).** Satu baris per router per detik, kunci utama
  `(router_id, sampled_at)`, jadi menulis ulang detik yang sama dengan
  `INSERT ... ON CONFLICT DO UPDATE` menggantikan barisnya. Total semua router pada
  satu detik adalah jumlah barisnya. Menghapus router ikut menghapus arsipnya.
  Perkiraan volume: 86.400 baris per router per hari (20 router sekitar 1,7 juta
  baris per hari).
- **TimescaleDB bersifat opsional.** Migrasi `0004` memeriksa apakah ekstensi
  tersedia; bila ya, tabel dijadikan hypertable (partisi harian) dengan retensi
  otomatis 30 hari. Bila tidak (image `postgres:17-alpine` bawaan dev dan test
  tidak memilikinya), tabel tetap berfungsi sebagai tabel biasa dan baris lama
  perlu dibersihkan oleh backend. Kegagalan mengaktifkan Timescale hanya menjadi
  peringatan agar migrasi tidak berhenti. Untuk memakainya, jalankan PostgreSQL
  dari image `timescale/timescaledb` (mis. di Docker Compose produksi) sebelum
  menjalankan migrasi. Kompresi dan agregasi turun resolusi belum diatur.
  Kedua cabang sudah diuji: tabel biasa lewat `npm test`, dan hypertable beserta
  kebijakan retensinya lewat kontainer TimescaleDB sementara.

## State di memori

`state.Manager` menyimpan router, pelanggan, dan traffic. Collector menulis, hub dan
rule engine membaca; semua akses aman dari banyak goroutine dan semua data yang
keluar adalah salinan.

- **Ring buffer 300 titik per router** (5 menit pada 1 sampel per detik). Saat
  penuh, titik tertua ditimpa, jadi memori tidak bertambah. Diuji: 2.000
  pelanggan dan 20 router yang melapor 24 jam penuh memakai sekitar 1,3 MB dan
  tidak naik setelah buffer penuh.
- **Perubahan status dilaporkan sekali.** `SetOnline` dan `SetOpticalPower`
  mengembalikan `Change`; kirim event hanya bila `Changed()` benar. Memutus
  pelanggan yang sudah offline bukan perubahan.
- **Aturan warna titik** sama dengan frontend: offline merah, online dengan Rx di
  bawah -25 dBm kuning, selain itu hijau.
- **Total traffic** dijumlah per detik dari semua router (`TotalAt`, `Snapshot`).
  Router yang belum melapor pada suatu detik tidak ikut dihitung pada detik itu.
- Sampel traffic dengan detik yang sama menggantikan sampel sebelumnya; sampel
  yang lebih tua dari yang terakhir diabaikan agar waktu selalu menaik.

## Catatan

- Server berhenti rapi saat menerima Ctrl+C atau SIGTERM: permintaan yang sedang
  berjalan diberi waktu 10 detik untuk selesai.
- Log permintaan tidak mencatat query string, karena bisa memuat token.
- Versi diisi saat build: `go build -ldflags "-X main.version=1.0.0"`.
- Race detector (`go test -race`) butuh cgo; di Windows tanpa compiler C jalankan
  tanpa `-race`.
