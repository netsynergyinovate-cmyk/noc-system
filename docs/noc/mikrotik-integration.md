# Integrasi MikroTik (PRD-NOC-MIKROTIK-001)

Dokumen ini menjelaskan implementasi integrasi RouterOS v7 setelah perombakan
"Zero-Delay Pipeline": protokol per router, jalur panas/dingin, webhook PPP,
syslog, dan batas-batasnya.

## 1. Protokol per router

Kolom `routers.protocol` (`rest` | `api`, bawaan `rest`, migrasi
`drizzle/0047_*.sql`) menentukan transport yang dipakai backend Go.

| Protokol | Port | Transport | Kapan dipakai |
| --- | --- | --- | --- |
| `api` | 8728 / 8729 TLS | API biner, satu soket TCP dipertahankan | Disarankan. Trafik interface mengalir lewat `/interface/monitor-traffic`. |
| `rest` | 80 / 443 (atau kustom) | REST `/rest/...` | Router lama, atau bila layanan API biner dimatikan. |

Form `/app/router/new` memilih protokol dan menyesuaikan port otomatis
(8728/8729 untuk API, 80/443 untuk REST). Port tersimpan di `routers.host`
(`host:8728`, `https://host:8729`, atau `host` untuk REST port 80). Pemilihan
"API" tetapi port 80/443 otomatis dipindahkan ke padanan API-nya, dan sebaliknya.

## 2. Jalur panas vs dingin

- **Hot path (RAM + WebSocket).** Untuk protokol `api`, poller membuka aliran
  `/interface/monitor-traffic` pada soket khusus. Laju `rx-bps`/`tx-bps`
  disimpan di memori worker dan dipakai oleh sampel trafik tiap detik; tidak ada
  pembacaan counter dua kali dan tidak ada query database per detik.
  Aliran yang putus dibuka ulang dengan jeda 2 detik; sampel yang lebih tua dari
  2 detik tidak dipakai (fallback ke counter interface).
- **Cold path (PostgreSQL).** `archive.Writer` menyimpan agregat trafik dan
  `customer_traffic_samples` menyimpan trafik per pelanggan. Semua penulisan
  database terjadi di luar jalur streaming.

Seluruh perintah baca lain (`queue/simple`, `ppp/active`, `system/resource`,
`interface`, `ip/firewall/...`, `log`) memakai soket API yang sama, sehingga
tidak ada handshake TCP + login baru tiap detik.

## 3. Satu gateway untuk pembacaan router

Next.js tidak lagi membuka koneksi monitoring ke router. `MikrotikRestClient`
dengan `routerId` meneruskan permintaan ke backend Go:

- `GET /api/v1/routers/{id}/read?path=/rest/...` — baca-saja.
- `POST /api/v1/routers/{id}/measure` — hanya `tool/ping`,
  `tool/traceroute`, dan `interface/ethernet/monitor`.

Keduanya memerlukan tiket internal bertanda tangan
(`REALTIME_TOKEN_SECRET`). Backend membuka kata sandi AES-256-GCM dengan
`DEVICE_SECRET` (format sama dengan Next.js), memilih REST/API biner, dan
mengembalikan JSON dengan bentuk yang sama seperti REST.

Uji koneksi pada form (`/api/routers/test`) juga diteruskan ke
`POST /api/v1/routers/preflight` (izin `router:manage`) dengan batas 5 detik,
termasuk untuk REST. Next.js hanya memilih mode simulator di lingkungan demo;
pre-flight produksi selalu berupa koneksi fisik dari backend Go.

Halaman `/app/router/test` hanya menguji perangkat nyata. Tidak ada pilihan
mode simulator atau "paksa simulasi lokal"; CPU, RAM, uptime, board, dan versi
RouterOS diambil dari jawaban `/rest/system/resource` (atau `/system/resource`
lewat API biner). Field yang tidak dikirim router ditampilkan "—", bukan angka
contoh.

### Perintah allow-list siap tempel

Banner "Router menutup koneksi" menyusun perintah yang MENGGANTI daftar
`address=` layanan dengan IP server backend (akses Winbox/SSH tidak
terpengaruh):

```routeros
/ip service set www address=203.0.113.5/32
```

IP diisi dari `sourceIp` yang dihitung backend Go
(`wire.RouterHealth.sourceIp`); layanan `www`/`api` mengikuti protokol router.
Menggabungkan daftar lama lewat `:local c [/ip service get ...]` tidak dipakai
karena RouterOS mengembalikan properti `address` sebagai daftar, bukan satu
string; penggabungannya gagal dengan "value of address must have number address
after '/'". Bila entri lama perlu dipertahankan, jalankan
`/ip service print detail where name~"www"` lalu tambahkan entri tersebut
setelah koma secara manual.

Bila host router berupa nama domain (bukan IP literal), perintah yang tampil
adalah `/ip service print` karena IP sumber tidak dihitung tiap tick.

IP (`203.0.113.5`) diisi dari `sourceIp` yang dihitung backend Go
(`wire.RouterHealth.sourceIp`); layanan `www`/`api` mengikuti protokol router.
Bila host router berupa nama domain (bukan IP literal), perintah yang tampil
adalah `/ip service print` karena IP sumber tidak dihitung tiap tick.

## 4. Event-driven PPPoE (0 detik)

`POST /hooks/ppp` menerima JSON dari script PPP profile:

```routeros
/tool fetch http-method=post http-header-field="Content-Type: application/json,X-Webhook-Token: <PPP_WEBHOOK_TOKEN>" \
  url="http://10.20.0.1:8080/hooks/ppp" \
  http-data="{\"event\":\"up\",\"user\":\"$user\",\"interface\":\"$interface\",\"address\":\"$remote-address\"}" \
  keep-result=no
```

`/tool fetch` hanya mendukung satu `http-header-field` berisi beberapa header
dipisah koma (versi RouterOS tertentu membutuhkan dua baris
`http-header-field` terpisah). Tanpa token, endpoint menjawab 401.

Field `event`, `user`, `router`, `interface`, `address`, `service`,
`caller-id`, dan `uptime` diterima; field lain ditolak. Token wajib dikirim di
header `X-Webhook-Token` (atau `Authorization: Bearer`) dan diisi lewat
`PPP_WEBHOOK_TOKEN` (minimal 16 karakter). Status berubah di `state.Manager`,
disiarkan hub dalam milidetik, lalu ditulis ke `customers.is_online` oleh
`OnlineWriter`. `interface`/`address` hanya konteks, bukan dasar keputusan.

## 5. Syslog (link flapping)

`SYSLOG_ADDR` (mis. `:5514`) menyalakan listener UDP. Konfigurasi router:

```routeros
/system logging action add name=noc-syslog target=remote remote=10.20.0.1 remote-port=5514
/system logging add topics=interface,warning action=noc-syslog
/system logging add topics=pppoe,info action=noc-syslog
```

## 6. Anti-rollover

`collector.CalculateRateSafe(current, previous, intervalSec)` mengembalikan 0
bila counter turun atau selang tidak valid. `ifRate` memakai aturan yang sama
dan menolak sampel (bukan menampilkan 0 palsu) agar grafik tidak melonjak
ratusan Gbps setelah reboot.

## 7. Torch

`Client.Torch` membungkus permintaan dengan konteks berbatas (durasi capture +
5 detik) dan memakai konteks permintaan HTTP. Menutup tab / membatalkan capture
membatalkan konteks, memutus TCP, dan menghentikan torch di RouterOS. Untuk
protokol `api`, torch memakai aliran `/tool/torch` pada soket khusus dan
menutupnya saat durasi habis.

## 8. Konfigurasi

Backend Go:

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | ya (live) | Router, pelanggan, arsip, dan gerbang baca. |
| `DEVICE_SECRET` | ya | Kunci AES-256-GCM yang sama dengan Next.js. |
| `PPP_WEBHOOK_TOKEN` | untuk webhook | Rahasia header script PPP. |
| `SYSLOG_ADDR` | opsional | Alamat UDP listener, mis. `:5514`. |
| `REALTIME_TOKEN_SECRET` | untuk `/ws` dan tiket | Sama dengan Next.js. |

Next.js: `BACKEND_INTERNAL_URL` (atau `BACKEND_URL`) dan
`REALTIME_TOKEN_SECRET` wajib agar pembacaan router lewat backend Go berjalan.

## 9. Batasan yang diketahui

- Uji koneksi form memakai backend Go; bila backend mati, form melaporkan
  backend tidak terjangkau (bukan sukses palsu).
- TLS API (`8729`) memakai sertifikat self-signed RouterOS; verifikasi
  sertifikat tidak dipakai untuk port ini, sama seperti klien bootstrap.
- `monitor-traffic` hanya tersedia untuk protokol `api`; `rest` tetap memakai
  counter interface.
- Satu instance backend: antrean diagnosa otomatis dan aliran monitor tidak
  dibagi antar instance.
