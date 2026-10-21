# Dokumentasi Lengkap NOC SYSTEM (Bedah Aplikasi)

> Status per **22 Oktober 2026**, cabang `feat/satellite-map-and-odp-routing` (commit `2c370ba`).
> Dokumen ini membedah aplikasi sampai ke akar: arsitektur, jaringan fisik, integrasi perangkat,
> backend Go, server Next.js, database, setiap halaman, lalu daftar centang (checklist) fitur,
> temuan masalah, dan peta jalan pengembangan.
>
> Dokumen ini **tidak memuat satu pun nilai rahasia** (sandi, token, kunci). Lokasi rahasia hanya
> disebut berkasnya supaya bisa dibersihkan.

**Legenda status**

| Label | Arti |
|---|---|
| **NYATA** | Membaca/menulis database atau perangkat sungguhan |
| **SEBAGIAN** | Sebagian data nyata, sebagian tiruan atau aksi lokal |
| **MOCK** | Data tiruan / aksi pura-pura (`setTimeout`, `Math.random`, `localStorage`) |
| `[x]` | Sudah jalan dan terbukti di kode |
| `[ ]` | Belum ada / masih tiruan / perlu dikerjakan |

---

## Daftar isi

1. [Ringkasan eksekutif](#1-ringkasan-eksekutif)
2. [Arsitektur dan alur data](#2-arsitektur-dan-alur-data)
3. [Jaringan fisik yang dipantau](#3-jaringan-fisik-yang-dipantau)
4. [Integrasi perangkat (protokol dan batasan)](#4-integrasi-perangkat-protokol-dan-batasan)
5. [Backend Go](#5-backend-go)
6. [Server Next.js: auth, API, service](#6-server-nextjs-auth-api-service)
7. [Database](#7-database)
8. [Frontend: menu dan setiap halaman](#8-frontend-menu-dan-setiap-halaman)
9. [Checklist fitur per modul](#9-checklist-fitur-per-modul)
10. [Temuan masalah (berprioritas)](#10-temuan-masalah-berprioritas)
11. [Peta jalan pengembangan](#11-peta-jalan-pengembangan)
12. [Infrastruktur, tes, dan operasional](#12-infrastruktur-tes-dan-operasional)
13. [Lampiran](#13-lampiran)

---

## 1. Ringkasan eksekutif

**NOC SYSTEM** adalah dashboard *Network Operation Center* untuk ISP (RunsNet, Mukomuko). Fungsinya:
memantau router MikroTik (BRAS PPPoE), OLT EPON HSGQ beserta ONU pelanggan, modem (TR-069 / web
admin), trafik, gangguan (alert), billing pelanggan, dan peta jaringan fiber (ODC/ODP/kabel).

**Ukuran kode (terhitung 22-10-2026)**

| Bagian | Jumlah |
|---|---|
| Halaman (`page.tsx`) | 34 |
| Route API Next.js (`route.ts`) | 181 |
| Service server (`src/services`) | ±80 |
| Tabel Drizzle / migrasi SQL | 41 berkas schema / 32 migrasi (0000–0031) |
| Paket backend Go | 13 paket internal + 2 command |
| Tes unit Node (`tests/`) | 354 berkas (±2.029 kasus; ±52 gagal lama) |
| Tes E2E Playwright (`e2e/`) | 78 spec |
| Tes Go | 98 berkas `_test.go` (±882 fungsi tes) |

**Kondisi singkat**

- Inti pemantauan **sudah nyata**: polling MikroTik (REST), polling OLT (telnet), status online PPPoE,
  arsip trafik, rule engine 6 aturan aktif, WebSocket realtime, alert tersimpan di database,
  ambang batas di database, peta jaringan baru (`/app/peta`), billing RunsNet, GenieACS, API key.
- Sekitar **12 halaman masih MOCK** dan beberapa tombol **melaporkan sukses palsu**
  (restore backup, sinkronisasi, uji Telegram/WA, CRUD Simple Queue).
- Ada **celah keamanan kritis**: akun apa pun bisa menaikkan dirinya jadi admin, pendaftaran terbuka,
  dan ada kunci/kredensial produksi tertanam di berkas yang ter-commit (lihat [bagian 10](#10-temuan-masalah-berprioritas)).
- Banyak **duplikasi**: 3 implementasi peta, 2 jalur billing, 4 tempat uji koneksi router,
  dan ±20 route API tanpa pemakai.
- Dokumentasi lama (`README.md`, `docs/architecture.md`, sebagian `backend/README.md`) **basi**.

---

## 2. Arsitektur dan alur data

### 2.1 Komponen

```text
                         ┌─────────────────────────── Browser operator ───────────────────────────┐
                         │  Next.js UI (React 19, Zustand, Leaflet, Tailwind v4, shadcn/ui)       │
                         │   - fetch /api/*  (cookie sesi)        - WebSocket ws://backend/ws      │
                         └───────────────┬───────────────────────────────────────┬────────────────┘
                                         │ HTTP :3001                            │ tiket HMAC 60 dtk
                ┌────────────────────────▼──────────────────┐     ┌──────────────▼───────────────────┐
                │ Next.js 16 server (container "app")        │     │ Backend Go (container "backend") │
                │  /api/* route → service → Drizzle           │────▶│  :8080  /ws  /api/v1  /hooks/ppp │
                │  Better Auth (sesi, peran, API key)         │ REST│  collector · engine · hub        │
                │  instrumentation: migrasi + seed + VLAN     │     │  archive · billing · olt · ontweb│
                └───────────────┬─────────────────────────────┘     └──────┬───────────┬───────────────┘
                                │                                          │           │
                         ┌──────▼──────────────────────────────────────────▼──┐        │ REST/telnet/HTTP
                         │ PostgreSQL 17 (container "postgres")               │        │
                         │  auth · perangkat · pelanggan · trafik · alert     │        ▼
                         │  billing · peta · audit · api_keys                 │  MikroTik (REST v7)
                         └────────────────────────────────────────────────────┘  OLT HSGQ (telnet)
                                                                                 Modem (web admin)
        Layanan pendamping: GenieACS (TR-069, :7547 CWMP / :7557 NBI), OSRM (snap jalan), 9router
```

### 2.2 Teknologi

| Lapisan | Teknologi |
|---|---|
| Frontend | Next.js 16.3 App Router, React 19.2, Zustand, Leaflet, Tailwind v4, shadcn/ui, `motion/react` |
| Server web | Next.js route handler (runtime Node.js), Better Auth (+ plugin admin), Zod, Drizzle ORM, node-postgres |
| Backend realtime | Go (`noc-isp/backend`), pgx, WebSocket, slog |
| Database | PostgreSQL 17 (opsional TimescaleDB via `npm run db:timescale`) |
| Pendamping | GenieACS + MongoDB 6, OSRM (data OSM Sumatra, profil `foot`), 9router |
| Tes | `node --test`, Playwright, `go test` |

### 2.3 Pembagian tanggung jawab Next.js vs Go

| Urusan | Pemilik | Alasan |
|---|---|---|
| Login, sesi, peran, API key | Next.js | Better Auth |
| CRUD perangkat, pelanggan, peta, ambang, alert "ditangani" | Next.js | API route → service → Drizzle |
| Polling perangkat, status online, trafik realtime | Go | goroutine jangka panjang, latensi rendah |
| Rule engine (deteksi gangguan) → tabel `alerts` | Go | evaluasi tiap 1 detik |
| WebSocket ke browser | Go | hub dengan snapshot/delta |
| Sinkron billing generik (`billing_status`) | Go | scheduler per jam |
| Scraper billing RunsNet (`runsnet_*`) | Next.js | dibuat terpisah (duplikasi, lihat 10) |
| Bind TR-069 di OLT / modem | Go (dipanggil Next.js lewat tiket) | butuh sesi telnet/web panjang |

### 2.4 Alur data utama

1. **Trafik**: MikroTik `GET /rest/interface?name=<uplink>` (counter rx/tx) → `state.Manager.RecordTraffic`
   → `archive.Writer` (batch 5 dtk / 2.000 sampel) → tabel `traffic_samples` (retensi 30 hari) →
   hub WebSocket kirim `delta.traffic` tiap detik.
2. **Status online pelanggan**: MikroTik `/rest/ppp/active` (30 dtk) + webhook `/hooks/ppp` + syslog UDP →
   `Manager.SetOnline` → pesan WebSocket `status` (~100 ms) dan `OnlineWriter` → `customers.is_online`.
3. **Optik**: OLT telnet `show onu-info all` / `show optical-diag N` (30 dtk) → `olt_onus.optical_power` →
   `customers.optical_power` → watcher DB 15 dtk → `OpticalRule`.
4. **Gangguan**: rule engine (1 dtk) → event `events` di WebSocket + baris `alerts` (`detail.source='engine'`)
   → `LiveAlertSync` di browser (polling 10 dtk + reload saat event WS) → halaman Alert, Anomali, Dashboard.
5. **Billing**: Go scraper (per jam) → `billing_status` → `delta.billingChanges`; terpisah, Next.js scraper
   RunsNet → `runsnet_customers/invoices/payments`.
6. **Peta**: `/api/peta/*` membaca tabel pusat (routers, olts, customers, olt_onus, trafik) lalu menimpakan
   lapisan edit `map_devices`, `map_overrides`, `cable_routes`, `map_layers`.

### 2.5 Mode data: demo vs live

- `DASHBOARD_DATA=demo` (bawaan) → feed tiruan (`mock-feed.ts`), gerbang `/setup` dilewati, pratinjau peran aktif.
- `DASHBOARD_DATA=live` → WebSocket ke backend Go wajib, `/setup` memaksa minimal satu router/OLT terhubung.
- Mode bisa diganti saat jalan lewat `POST /api/settings/mode` (menulis `.env.local`) — **tanpa izin khusus** (masalah, lihat 10).

---

## 3. Jaringan fisik yang dipantau

Fakta lapangan yang sudah terbukti (dari catatan proyek):

```text
 Internet ── MikroTik (BRAS PPPoE, RouterOS v7, REST via www :80)
               │  ether4-lan1 ──▶ OLT HSGQ-XE08ID EPON (8 PON, ±78 ONU)
               │  vlan900-MGT   10.20.0.1/29  (OLT 10.20.0.2)
               │  vlan1101..1106  PPPoE per PON
               │      pool 172.16.0.2–172.16.15.254, local 172.16.0.1, profil BRAS-RUNSNET (only-one=yes)
               │  Jaringan manajemen ONT: DHCP noc-mgmt-p1..p6 di vlan1101..1106
               │      10.30.N.0/24 (gw 10.30.N.1), firewall mengunci 10.30.0.0/21
               │  dst-nat 172.16.0.1:7547 ──▶ 10.20.30.3:7547 (GenieACS via WireGuard 10.20.30.0/24)
               └─ RADIUS (``/ppp/secret`` kosong → pelanggan dibaca dari ``/ppp/active``)
```

| Perangkat | Akses aplikasi | Catatan |
|---|---|---|
| MikroTik | REST API, akun `Monitor` grup `noc-api` (read, write, test, api, rest-api), dibatasi IP | Tanpa sensor suhu; tidak ada perintah tulis dari aplikasi |
| OLT HSGQ XE08 | Telnet (driver `hsgq-telnet`), akun `NOCApp` | Nama ONU format `KODE-NAMA` (4 digit terakhir nomor PPPoE); profil TR-069 NOC id 1 |
| Modem pelanggan | Web admin (port 80) lewat jaringan manajemen 10.30.x | FD511GW, ZIMLINK ZL-2113X, GGCLink GM220-S, ZTE F609 |
| GenieACS | NBI `http://genieacs:7557` dari app; CWMP 7547 untuk modem | Modem uji (TERI RAYA, PON2 ONU2) sudah Inform OK |

**Peringatan keamanan jaringan (sudah disampaikan 14-10-2026):** telnet OLT pernah diteruskan dari IP
publik dan di-*brute-force*. Telnet mengirim sandi polos. Akses OLT harus lewat LAN/VPN WireGuard saja.

---

## 4. Integrasi perangkat (protokol dan batasan)

### 4.1 MikroTik (backend Go `internal/collector`)

Protokol: **REST API RouterOS v7**, Basic Auth, **semuanya GET**. Bukan Winbox; port API biner 8728/8729 ditolak.

| Endpoint | Interval | Dipakai untuk |
|---|---|---|
| `/rest/interface?name=X` | 10 dtk | Trafik utama (counter → rate) |
| `/rest/queue/simple` | 1 dtk | Trafik cadangan + rasio queue (QueueRule) |
| `/rest/system/resource` | 5 dtk | CPU/memori/uptime (CpuRule) |
| `/rest/ppp/active` | 30 dtk | Status online + IP modem |
| `/rest/ppp/secret` | importer 5 mnt | Impor pelanggan (kosong bila RADIUS) |
| `/rest/interface` (semua) | 10 dtk | Error/drop interface — **dikumpulkan tapi belum dievaluasi aturan apa pun** |

Keandalan: backoff ×2 (maks 30 dtk) setelah 3 gagal; router "tidak terjangkau" setelah 3 kegagalan.
Batasan: default `http://` → Basic Auth polos kecuali port 443/8443.

Jalur event tambahan:
- **Webhook `/hooks/ppp`** dari script on-up/on-down router — satu token bersama untuk semua router.
- **Syslog UDP** (regex `ppp` logged in/out), hanya dari IP router terdaftar; UDP bisa dipalsukan.
  Port UDP 514/2055 **tidak dipublikasikan** di `compose.yaml`, jadi saat ini tidak menerima apa pun dari luar container.

### 4.2 OLT (backend Go `internal/olt`)

| Driver | Status |
|---|---|
| `hsgq-telnet` | **Dipakai** (HSGQ XE08). Baca: `show onu-info all`, `show onu-version all`, `show pon-info`, `show optical-diag N`. Tulis: `interface epon P` → `onu-tr069 N profile-id ID` |
| `hsgq`, `hsgq-gpon`, `hsgq-epon` (HTTP JSON) | Endpoint **masih tebakan**, belum diuji |
| `mock` / `stub` | Data palsu, ikut terdaftar di build produksi |

OLT **tidak hanya dibaca**: AutoBinder (`OLT_TR069_AUTOBIND=new` di compose) dan endpoint
`POST /api/v1/olts/{id}/onus/{pon}/{onu}/tr069-bind` menulis profil TR-069. Rentang dicek (PON 1–8, ONU 1–64, profil 1–32).

**Jebakan CLI OLT:** `?` di akhir baris lengkap ikut *menjalankan* perintah. Pakai `?` hanya di baris belum lengkap.

### 4.3 Modem via web admin (backend Go `internal/ontweb`)

| Modem | TR-069 | WAN (`ensureWan`) | Risiko |
|---|---|---|---|
| FD511GW (C-Data) | `tr069_config` via JSON | **Mengubah WAN pelanggan** jadi `TR069_INTERNET` | PPPoE pelanggan tersambung ulang |
| ZIMLINK ZL-2113X | form `net-tr069.asp` | **POST ulang seluruh form WAN** (±115 field) | Salah satu field = pelanggan putus |
| GGCLink GM220-S | `getpage.gch` | Tidak bisa menambah WAN TR069 (Service List terkunci) | Butuh WAN TR069 dibuat via OLT / manual |
| ZTE F609 | `net-tr069.asp` | Menambah WAN baru | Sesi tunggal, kunci 1 menit bila gagal 3× |

Pengaman: hanya IPv4 di `ONT_WEB_ALLOWED_CIDRS`, port 80, redirect tidak diikuti, logout selalu, hasil dibaca ulang (`ErrNotApplied`).

### 4.4 GenieACS (TR-069)

- Next.js memanggil NBI (`src/lib/genieacs`) untuk daftar CPE, detail, ganti Wi-Fi, baca secret, antrean task.
- Backend Go **tidak** memanggil GenieACS; hanya menulis URL ACS ke OLT/modem.

### 4.5 NetFlow

- Kolektor Go **NetFlow v5** saja, UDP 2055. **Data belum disimpan** (sink hanya menghitung).
- Halaman `/app/netflow` masih MOCK walau `/api/netflow*` dan tabel `netflow_samples` sudah ada.

### 4.6 Billing

| Jalur | Lokasi | Tabel | Status |
|---|---|---|---|
| Go scraper generik | `backend/internal/billing` (`DefaultProfile()` gaya Laravel) | `billing_status`, `billing_sync_runs`, `billing_mismatches` | Belum diuji ke situs billing sungguhan; profil RunsNet belum ada di Go |
| Next.js scraper RunsNet | `src/services/runsnet-billing.service.ts` | `runsnet_customers`, `runsnet_invoices`, `runsnet_payments`, `runsnet_sync_logs` | Dipakai halaman `/app/billing` |

Aturan pencocokan PPPoE ada dua kali (TS `matchBilling`, Go `MatchInvoices`) dengan berkas uji bersama 543 kasus.

---

## 5. Backend Go

### 5.1 Urutan startup (`backend/cmd/server/main.go`)

1. Baca env (`config.Load`) + pengaturan billing (konfigurasi setengah isi = proses berhenti).
2. `state.NewManager()` (state di memori, ring buffer 300 titik per router).
3. Bila `REALTIME_TOKEN_SECRET` ada → hub WebSocket aktif (tanpa secret, `/ws` dan `/api/v1` tidak ada).
4. Bila `DATABASE_URL` ada → sinkron state dari DB + watcher 15 dtk + `OnlineWriter`.
5. Bila `DEVICE_SECRET` ada → arsip trafik, fleet router (4 job per router), importer, fleet OLT.
6. Scheduler billing, ambang dari `alert_thresholds` (**dibaca sekali saat start** → ubah ambang = restart backend).
7. Rule engine (1 dtk), webhook PPP, syslog UDP, NetFlow (opsional).
8. HTTP listen; berhenti dengan grace 10 dtk.

### 5.2 Paket

| Paket | Tugas | Tabel ditulis |
|---|---|---|
| `config` | Validasi env | – |
| `auth` | Verifikasi tiket HMAC-SHA256 (maks 5 mnt) | – |
| `state` | State di memori (router, pelanggan, trafik) | – |
| `collector` | MikroTik REST, fleet, importer, webhook, syslog, fleet OLT, OnlineWriter | `customers` |
| `olt` | Driver OLT, poller, AutoBinder TR-069 | `olt_pon_ports`, `olt_onus`, `olts`, `customers.optical_power` |
| `ontweb` | Klien web admin 4 jenis modem | – (baca `ont_web_settings`) |
| `archive` | Arsip trafik berbatch, retensi, history | `traffic_samples` |
| `engine` | Rule engine + penyimpan alert (+ WhatsApp notifier, **belum dipasang**) | `alerts` |
| `billing` | Scraper + scheduler per jam | `billing_*`, `customers.billing_status` |
| `hub` | WebSocket (maks 100 klien, umur koneksi 30 mnt) | – |
| `httpapi` | REST `/api/v1`, `/healthz`, `/hooks/ppp` | via paket lain |
| `netflow` | Kolektor NetFlow v5 | – (belum menyimpan) |
| `wire` | Bentuk JSON bersama | – |

### 5.3 Rule engine

| Aturan | Kondisi | Default | Severity | Disimpan |
|---|---|---|---|---|
| `OfflineRule` | Pelanggan offline | 30 dtk | warning | ya |
| `RouterUnreachableRule` | Router gagal 3× | +15 dtk | critical | ya |
| `QueueRule` | Rasio queue > 0,95 | 30 dtk | warning | ya |
| `CpuRule` | CPU > 85% | 3 mnt | warning | ya |
| `OpticalRule` | Rx < −25 dBm | 0 dtk | warning | ya |
| `BillingMismatchRule` | Isolir tapi masih online | – | warning | **tidak** (hanya WS) |
| `PortRule` | Error port | 20/mnt | – | **stub, tidak jalan** |

Siklus: mulai (setelah `For`) → `INSERT`/`touch` `alerts` → selesai → `resolve` (`end_time_source='poll'`).
Korelasi insiden (akar masalah, `correlationId`) **belum ada di Go**, dikerjakan di frontend.
Nilai ambang harus sama dengan `anomalyRules` di `src/lib/dashboard`.

### 5.4 Protokol WebSocket `/ws`

- Pesan pertama klien: `{"type":"auth","token":"<tiket>"}` dalam 5 dtk. Tiket dari `POST /api/realtime/ticket`.
- Server → klien: `snapshot` (routers, customers, traffic), `delta` (tiap dtk), `status` (~100 ms), `events`.
- Kode tutup: 1008 tiket ditolak, 1013 server penuh, 4401 umur habis (minta tiket baru), 1001 server berhenti.
- **Kekurangan:** snapshot tidak memuat alert aktif; pesan `alerts`/`incidents` masih rancangan.

### 5.5 REST `/api/v1` (Go)

| Method | Path | Auth |
|---|---|---|
| GET | `/healthz` | – |
| GET | `/api/v1/summary`, `/routers`, `/routers/health`, `/customers`, `/traffic`, `/traffic/history`, `/billing`, `/billing/sync`, `/billing/history`, `/billing/service-mismatches` | Bearer tiket |
| POST | `/api/v1/billing/sync` | tiket + `billing:manage` |
| POST | `/api/v1/olts/{oltId}/onus/{pon}/{onu}/tr069-bind` | tiket + `cpe:manage` |
| POST | `/api/v1/ont-web/tr069` | tiket + `cpe:manage` |
| GET/POST | `/hooks/ppp` | token webhook |

---

## 6. Server Next.js: auth, API, service

### 6.1 Model keamanan (desain)

- **Better Auth**: email+sandi, sesi 7 hari, cookie httpOnly SameSite=Lax, plugin admin (`defaultRole: user`).
- **Peran** (`src/lib/permissions.ts`): resource `notes`, `cpe`, `router`, `alert`, `threshold`, `audit`, `billing`, `apiKey`, `map`.
  `user` hanya `audit:read`; `admin` semuanya.
- **Guard API** (`src/lib/api.ts`): `withApiSession` (sesi atau API key `Bearer noc_…`, cek Origin untuk mutasi cookie),
  `withApiPermission` (izin per resource). Halaman: `requireSession` / `requirePermission` (`notFound()` bila ditolak).
- **UI** (`useCanDo`, `<Can>`, `roles.ts`) hanya mengatur tampilan, **bukan** pemeriksaan akses.
- **Tiket realtime** (`src/lib/realtime-ticket.ts`): HMAC-SHA256, 60 dtk, `perms` ikut ditandatangani.

**Kenyataan:** desain rapi, penerapan tidak konsisten. ±70% route mutasi hanya `withApiSession`,
ditambah endpoint naik-peran → RBAC praktis tidak berlaku. Rincian di [10.1](#101-p0--keamanan-kritis-kerjakan-segera).

### 6.2 Kelompok API (181 route)

| Domain | Guard ringkas | Catatan |
|---|---|---|
| `alerts` | GET sesi; handle = `alert:handle`; `notify`, `ticket` = sesi | ticket/notify ada tapi UI tidak memanggil |
| `anomalies` | sesi | UI tidak memakai |
| `api-keys` | `apiKey:manage` + audit | Baik |
| `audit` | GET sesi (seharusnya `audit:read`); export `audit:read` | |
| `benchmark/*` | **tanpa sesi** bila header `x-benchmark-key` cocok (ada kunci bawaan di kode) | Hapus/kunci |
| `billing` | sync Go = `billing:manage`; `runsnet/sync`, `mismatches/*` = sesi | Tidak konsisten |
| `cpe` | baca sesi; tulis `cpe:manage` | Baik |
| `customers` | sesi; `sync-billing-names` **GET mengubah data** | |
| `deploy/*` | `health`, `env-validation` **tanpa auth**; `backups`, `rollback-history` sesi | |
| `devices` | sesi; `test` = `router:manage` | |
| `infrastructure/*`, `map/*` (peta lama) | **semua sesi, termasuk mutasi** | Kandidat hapus |
| `peta/*` (peta baru) | baca sesi; tulis `map:manage` | Baik |
| `migrations` | run/verify/version = `router:manage` (izin salah) | UI tidak memakai |
| `netflow`, `export`, `reports`, `v1/export`, `alignment`, `transfer`, `seed` | sesi | `transfer/run` bisa menimpa DB target |
| `olts`, `routers` | baca sesi; tulis `router:manage`; `routers/[id]/ping` sesi | |
| `onboarding`, `tutorial` | sesi; mikrotik = `router:manage` | |
| `ont-web` | `cpe:manage` | |
| `realtime` | ticket sesi; `stream` (SSE) data mock, tidak dipakai | |
| `settings/mode`, `settings/role` | **sesi saja** | **Kritis** |
| `thresholds` | GET sesi; tulis `threshold:manage` | Baik |
| `traffic`, `network/latency`, `dashboard/metrics`, `setup/status`, `config/status` | sesi | |
| `v1/data` | sesi / API key | Ekspor tabel allowlist (termasuk nomor WA, audit) |
| `whatsapp` | `send` sesi; recipients/retry `threshold:manage` (izin salah) | UI tidak memakai |
| `health` | tanpa auth (liveness) | Aman |

### 6.3 Service penting

| Service | Tugas |
|---|---|
| `devices`, `routers`, `router-*` | Router/OLT/ONU, resource, PPPoE, queue, ping |
| `device-connection(-tester)` | Uji koneksi MikroTik/OLT/GenieACS/billing |
| `alerts`, `anomalies`, `thresholds` | Gangguan, anomali, ambang |
| `traffic`, `vlan-traffic`, `traffic-archive` | Trafik router & VLAN/PON (collector VLAN jalan di `instrumentation.ts`) |
| `cpe*`, `ont-web-settings` | GenieACS & kredensial web modem |
| `runsnet-billing`, `billing` | Billing |
| `map/*` (adapter, topology, loss-budget, undo, central-mapper) | Peta baru |
| `cable-map`, `map-infrastructure`, `network-hierarchy`, `route`, `map-*` | Peta lama |
| `audit`, `api-keys`, `external-data` | Jejak, API key, ekspor data |
| `runtime-mode`, `seed-data`, `startup-*`, `schema-migration-runner` | Operasional |

**Service yatim (tidak diimpor):** `backup-restore`, `billing-credentials` (hanya tes), `data-drift`, `db-config`,
`device-credentials`, `real-map-markers`, `traffic-archive-raw`.

**Service yang masih menyuntik mock:** `alerts` (`mockActiveAlerts`), `anomalies` (fallback), `backup-snapshots`
(`MOCK_BACKUP_SNAPSHOTS`), `customer-location`, `map-infrastructure`, `network-hierarchy` (`network-map-mock.ts`),
`router-queues` (demo).

---

## 7. Database

### 7.1 Tabel per kelompok

| Kelompok | Tabel |
|---|---|
| Auth | `user`, `session`, `account`, `verification` |
| Aplikasi | `notes` (sisa starter), `api_keys`, `audit_log` |
| Perangkat | `routers`, `olts`, `olt_pon_ports`, `olt_onus`, `device_test_results` |
| Pelanggan | `customers` |
| Monitoring | `traffic_samples`, `vlan_traffic_samples`, `netflow_samples`, `network_logs`, `alerts`, `alert_thresholds` |
| CPE | `cpe_tasks`, `ont_web_settings` |
| Billing | `billing_status`, `billing_sync_runs`, `billing_mismatches`, `billing_credentials`, `runsnet_customers`, `runsnet_invoices`, `runsnet_payments`, `runsnet_sync_logs` |
| WhatsApp | `whatsapp_recipients`, `whatsapp_logs` |
| Peta lama | `network_infrastructure`, `network_cables`, `network_device_relations`, `network_routes`, `map_drawing_layers` |
| Peta baru | `map_devices`, `map_customers`, `map_layers`, `map_overrides`, `map_undo_entries`, `cable_routes`, `cable_segments`, `cable_segment_samples` |
| Internal | `data_sync_runs`, `seed_tracking`, `onboarding_steps`, `onboarding_progress`, `drizzle.__drizzle_migrations` |
| Dibuat saat runtime (di luar Drizzle) | `tutorial_content`, `drizzle.migration_rollback_events`, `drizzle.migration_failures`, `drizzle.app_version_history` |

### 7.2 Riwayat migrasi

| # | Isi |
|---|---|
| 0000–0002 | Auth Better Auth, `notes`, kolom role/banned |
| 0003 | Inti NOC: routers, olts, pon, onus, customers, billing_status, cpe_tasks, network_logs, audit_log |
| 0004–0009 | traffic_samples, odp_name, sync billing, alert_thresholds, serial ONU, netflow_samples |
| 0010–0014 | WhatsApp, billing_credentials, alerts, device_test_results, CHECK cpe_tasks |
| 0015–0018 | tracking sync/seed/onboarding, constraint & model ONU, kolom TR-069 |
| 0019–0022 | ont_web_settings + kredensial ZIMLINK, GGCLink, F609 |
| 0023–0029 | vlan_traffic_samples, runsnet_*, network_infrastructure/cables/relations, map_drawing_layers, perbaikan IF NOT EXISTS, network_routes |
| 0030 | api_keys |
| 0031 | Peta baru (`map_*`, `cable_*`) |

### 7.3 Penyimpanan kredensial

| Kolom | Status |
|---|---|
| `routers.password_enc`, `olts.password_enc`, `ont_web_settings.*_password_enc`, `billing_credentials.password_enc/cookies_enc` | AES-256-GCM (`iv:tag:ct`), kunci `DEVICE_SECRET` |
| `billing_credentials.csrf_token` | **Polos** |
| `api_keys.key_hash` | SHA-256 |
| Telegram token / WA API key (Pengaturan) | **localStorage browser** — melanggar aturan proyek |

### 7.4 Tumpang tindih tabel (utang)

| Pasangan | Masalah |
|---|---|
| `network_infrastructure` vs `map_devices` | Dua model ODC/ODP |
| `customers` vs `map_customers` vs `runsnet_customers` | Tiga sumber data pelanggan |
| `network_cables`/`network_routes` vs `cable_routes`/`cable_segments` | Dua model jalur kabel |
| `map_drawing_layers` vs `map_layers` | Dua lapisan anotasi |
| `billing_status`/`billing_sync_runs` vs `runsnet_*` | Dua jalur billing |
| `drizzle.__drizzle_migrations` | Dibuat oleh Drizzle, oleh migrasi 0015, dan saat runtime |
| DDL ganda | `src/lib/dashboard/schema-migrations.ts` punya daftar `CREATE TABLE` sendiri |

---

## 8. Frontend: menu dan setiap halaman

### 8.1 Menu navigasi (`src/components/dashboard/app-nav.tsx`)

| Grup | Menu |
|---|---|
| Utama | Dashboard `/app` |
| Apps | Alert, Deteksi Anomali, NetFlow, Trafik |
| Infrastruktur | Router, OLT & Optik, Peta Jaringan, GenieACS (TR-069), Integrasi Perangkat |
| Pelanggan & Billing | Pelanggan, Billing |
| Sistem | Pusat Onboarding, Pengaturan, Migrasi Skema, Sinkronisasi Data, Pengaman Deploy, Jejak Aktivitas, Ekspor Data, API Key, Uji Stack |

Halaman yatim (tidak ada di menu): `/app/topologi`, `/app/pengaturan/migrasi`.
Lencana "Online" di sidebar **statis** (selalu hijau). Menu API Key tampil untuk semua peran (user biasa dapat 404).

### 8.2 Status setiap halaman

| URL | Fungsi | Status | Catatan utama |
|---|---|---|---|
| `/sign-in`, `/sign-up` | Masuk / daftar | NYATA | Pendaftaran terbuka, tanpa verifikasi email |
| `/setup` | Gerbang: minimal 1 router/OLT terhubung | NYATA | Hanya aktif di mode live |
| `/admin` | Daftar notes semua akun | NYATA | Sisa starter, teks Inggris, tidak relevan |
| `/app` | Dashboard: trafik, latensi, optik kritis, alert, peta, top consumer | NYATA (demo: sebagian) | 6 API dipolling berurutan tiap 5 dtk di atas WebSocket |
| `/app/alert` | Gangguan aktif & riwayat, tandai ditangani | NYATA | Tiket disimpan di localStorage padahal API ada |
| `/app/alert/whatsapp` | Riwayat notifikasi WA | MOCK | API `/api/whatsapp/logs` tidak dipakai |
| `/app/alert/whatsapp/penerima` | Kelola penerima WA | MOCK | API key gateway di localStorage; kirim uji palsu |
| `/app/anomali` | Anomali (link penuh, CPU, port, optik, offline) | NYATA (live) | `/api/anomalies*` tidak dipakai; status "ditinjau" lokal |
| `/app/netflow` | Analisis flow | MOCK | Backend belum menyimpan flow |
| `/app/traffic` | Tren bandwidth | NYATA | – |
| `/app/router` | MikroTik: resource, trafik, PPPoE, queue, ping | SEBAGIAN | Grafik diberi jitter acak; fallback angka palsu di live; klaim "Winbox" palsu |
| `/app/router/new` | Tambah router | NYATA | – |
| `/app/router/queues` | Simple Queue | MOCK | CRUD palsu; data nyata ada di `RouterQueueTable` |
| `/app/router/test` | Uji koneksi | SEBAGIAN | Mode "simulator" mengembalikan sukses palsu bila API 404/5xx |
| `/app/cpe` | OLT, ONT, redaman, CPE, pemetaan ONU, diagnostik | SEBAGIAN | Pemetaan ONU & diagnostik di localStorage; banner OLT dari mock |
| `/app/cpe/pon/[id]` | Detail port PON | SEBAGIAN | Karakter rusak `�` |
| `/app/peta` | Peta GIS: perangkat, kabel, anotasi, pelanggan | NYATA | Tombol edit tampil untuk peran read-only (server tetap menolak); belum ada e2e |
| `/app/topologi` | Topologi Core→ODC→ODP→Pelanggan | NYATA | **Duplikat peta, yatim**, stack `/api/map/*` lama |
| `/app/genieacs` | Inventori CPE TR-069, Wi-Fi, secret | NYATA | Tanpa judul & label |
| `/app/pengaturan/perangkat` | Integrasi MikroTik/OLT/GenieACS/Billing | MOCK | **Simpan = membuat router baru dengan sandi bawaan di kode** |
| `/app/pelanggan` | Daftar PPPoE, status, sinyal, tagihan | NYATA | `BillingSyncChip` diam-diam jatuh ke mock |
| `/app/billing` | Pelanggan, invoice, pembayaran RunsNet | NYATA | Sync hanya butuh sesi; tema terang rusak (warna hardcode) |
| `/app/onboarding` | Checklist go-live | SEBAGIAN | Centang langkah hanya state lokal |
| `/app/pengaturan` | Umum, notifikasi, ambang, jaringan, mode, peran | SEBAGIAN | Ambang NYATA; token Telegram di localStorage; diagnostik/uji palsu; **tombol promosi admin** |
| `/app/migrasi` | Riwayat migrasi | MOCK | `/api/migrations/*` tidak dipakai |
| `/app/pengaturan/migrasi` | Re-export `/app/migrasi` | MOCK | Duplikat yatim |
| `/app/sinkronisasi` | Sinkron, transfer, seed | MOCK | Semua tombol `setTimeout`; checksum `Math.random` |
| `/app/pengaman-deploy` | Health, backup, rollback | SEBAGIAN | **"Pulihkan" palsu** melapor berhasil |
| `/app/jejak-aktivitas` | Audit log | NYATA | Export tidak dipakai |
| `/app/ekspor` | Unduh CSV/JSON | MOCK | Dibuat dari mock di browser |
| `/app/api-key` | Buat/cabut API key | NYATA | – |
| `/app/uji-stack` | Benchmark Go vs Next.js | MOCK (statis) | Halaman dev di menu operator |

### 8.3 Realtime di browser

- `DashboardFeed` (dipasang sekali di layout): demo = `mock-feed.ts`; live = WebSocket + tiket, sambung ulang 3 dtk.
- `LiveAlertSync` (live): polling `/api/alerts` 10 dtk + reload saat event WS → `useAlertStore`.
- Store: `lib/dashboard/store.ts` (routers, customers, traffic, incidents) dan `alert-store.ts`.
- Kode tidak terpakai: `realtime-sse.ts` dan route `realtime/stream`.

---

## 9. Checklist fitur per modul

Centang `[x]` = sudah nyata di kode. `[ ]` = belum / masih tiruan. Gunakan bagian ini sebagai papan progres.

### 9.1 Autentikasi & akses
- [x] Login email + sandi (Better Auth), sesi 7 hari, rate-limit login
- [x] Peran `user` / `admin` + izin per resource (`permissions.ts`)
- [x] API key untuk aplikasi luar (`read` / `read-write`), hash SHA-256, audit
- [x] Tiket realtime HMAC ke backend Go
- [ ] Endpoint naik-peran dihapus (`/api/settings/role` POST)
- [ ] Pendaftaran ditutup / undangan admin saja
- [ ] Semua route mutasi memakai `withApiPermission` yang tepat
- [ ] Verifikasi email & lupa sandi (butuh penyedia email)
- [ ] Peran tambahan (mis. `teknisi`, `cs`, `viewer`) sesuai kebutuhan operasional

### 9.2 Dashboard & realtime
- [x] WebSocket snapshot/delta dari backend Go
- [x] Trafik uplink realtime + rentang waktu
- [x] Status online pelanggan realtime
- [x] Optik kritis, latensi, top consumer
- [ ] Snapshot WS memuat alert aktif (klien baru langsung lihat gangguan)
- [ ] Hapus polling 6 API tiap 5 dtk (cukup WebSocket)
- [ ] Lencana "Online" sidebar membaca status koneksi sebenarnya

### 9.3 Alert & anomali
- [x] Rule engine: offline, router tak terjangkau, queue penuh, CPU, optik lemah
- [x] Alert tersimpan di tabel `alerts`, tandai ditangani (`handled_by/at`)
- [x] Ambang di database (`alert_thresholds`), halaman Ambang Batas
- [x] Suara alert, lencana jumlah alert di menu
- [ ] Ambang berlaku tanpa restart backend (reload dinamis)
- [ ] `PortRule` (error/drop interface) benar-benar dievaluasi
- [ ] `BillingMismatchRule` disimpan ke `alerts`
- [ ] Korelasi insiden di backend (mis. OLT/PON down → kelompokkan ratusan offline jadi 1 insiden)
- [ ] Tiket gangguan ke database (bukan localStorage)
- [ ] ID event unik antar-restart
- [ ] Penyimpanan alert tahan gangguan massal (batch tidak terpotong 10 dtk)

### 9.4 Notifikasi
- [x] Tabel & API WhatsApp (recipients, logs, send, retry)
- [ ] Halaman WhatsApp memakai API nyata (sekarang MOCK)
- [ ] `WhatsappNotifier` Go dipasang di `main.go`
- [ ] Notifikasi Telegram dari server (token di env/DB terenkripsi, bukan localStorage)
- [ ] Aturan eskalasi (siapa dikirimi apa, jam kerja, ulang bila belum ditangani)

### 9.5 Router MikroTik
- [x] Tambah router, uji koneksi, simpan kredensial terenkripsi
- [x] Resource, PPPoE aktif, queue, ping
- [x] Webhook PPP + syslog
- [ ] Hapus jitter acak & angka fallback palsu di grafik router
- [ ] Simple Queue memakai data nyata (gabung dengan `RouterQueueTable`)
- [ ] Satu tempat uji koneksi (sekarang 4)
- [ ] HTTPS ke REST API router (sekarang Basic Auth polos via HTTP)
- [ ] Publikasikan port syslog/NetFlow UDP di compose bila dipakai
- [ ] Token webhook per router

### 9.6 OLT, ONU & optik
- [x] Polling OLT HSGQ via telnet (PON, ONU, optik)
- [x] Redaman ONU ke `customers.optical_power`
- [x] Bind profil TR-069 (otomatis + manual)
- [ ] Driver HTTP HSGQ diverifikasi atau dihapus
- [ ] Driver `mock`/`stub` tidak ikut build produksi
- [ ] Pemetaan ONU ↔ pelanggan disimpan di DB (sekarang localStorage)
- [ ] Riwayat diagnostik ONU di DB
- [ ] Grafik histori redaman per ONU (tren degradasi)
- [ ] Dukungan OLT GPON / merek lain (ZTE, Huawei, VSOL) bila jaringan bertambah
- [ ] Akses OLT hanya via LAN/VPN (bukan port publik)

### 9.7 CPE / TR-069 / web modem
- [x] GenieACS: daftar CPE, detail, ganti Wi-Fi, baca secret, antrean task
- [x] Driver web modem FD511GW, ZIMLINK, GGCLink, F609 (pasang TR-069)
- [x] Jaringan manajemen ONT 10.30.x terbukti
- [ ] Otomatisasi Create WAN DHCP TR069 di GM22
- [ ] Konfirmasi operator sebelum `ensureWan` mengubah WAN pelanggan (FD511GW/ZIMLINK)
- [ ] Reboot/factory reset/upgrade firmware CPE dari UI (via GenieACS task)

### 9.8 Pelanggan & billing
- [x] Daftar pelanggan PPPoE realtime
- [x] Scraper RunsNet (pelanggan, invoice, pembayaran) + halaman Billing
- [x] Aturan pencocokan PPPoE (TS + Go, 543 kasus uji)
- [ ] Satu jalur billing (pilih Go **atau** Next.js, hapus yang lain)
- [ ] `BillingSyncChip` tanpa fallback mock
- [ ] Sinkron RunsNet memerlukan `billing:manage`
- [ ] Kredensial RunsNet hanya dari env/DB terenkripsi (hapus fallback di kode)
- [ ] Profil pelanggan lengkap (paket, ONU, ODP, riwayat gangguan, riwayat bayar) dalam satu panel
- [ ] Aksi isolir/buka isolir terintegrasi (butuh keputusan bisnis & API billing)

### 9.9 Peta jaringan
- [x] `/app/peta`: perangkat, jalur kabel, segmen, anotasi, pelanggan, undo 24 jam
- [x] Snap ke jalan via OSRM
- [x] Loss budget optik (asumsi Tx OLT +5 dBm)
- [ ] Hapus `/app/topologi`, `components/map/*`, `/api/map/*`, `/api/infrastructure/*` dan tabel peta lama setelah migrasi data
- [ ] Unique index untuk port (cek bentrok port sekarang tidak atomik)
- [ ] Sembunyikan tombol edit untuk peran tanpa `map:manage`
- [ ] Tes E2E peta
- [ ] Kapasitas ONU per PON dan ambang Rx dari konfigurasi (sekarang konstanta)

### 9.10 Trafik & NetFlow
- [x] Arsip trafik router (`traffic_samples`, retensi 30 hari)
- [x] Trafik per VLAN/PON (`vlan_traffic_samples`)
- [ ] NetFlow disimpan ke `netflow_samples` dan agregasi top talker
- [ ] Halaman NetFlow memakai data nyata
- [ ] NetFlow v9 / IPFIX (MikroTik Traffic-Flow v9)
- [ ] Laporan bandwidth per pelanggan / per paket

### 9.11 Sistem & operasional
- [x] Jejak aktivitas (audit) nyata
- [x] API key, ekspor data `/api/v1/data` (allowlist)
- [x] Migrasi otomatis saat start, health check DB
- [ ] Halaman Migrasi, Sinkronisasi, Ekspor memakai API nyata atau dihapus
- [ ] Backup & restore nyata (sekarang restore palsu)
- [ ] Hapus `/admin` (notes starter) dan `/app/uji-stack` dari menu operator
- [ ] CI menjalankan `go vet` + `go test`
- [ ] Suite tes hijau (±52 gagal lama)

---

## 10. Temuan masalah (berprioritas)

### 10.1 P0 — Keamanan kritis (kerjakan segera)

| # | Masalah | Lokasi | Dampak |
|---|---|---|---|
| 1 | **Naik jadi admin oleh siapa pun.** POST tanpa body = jadi admin, hanya butuh sesi | `src/app/api/settings/role/route.ts:40-55`, tombol di `settings-board.tsx` | Ditambah sign-up terbuka (`src/lib/auth.ts`), orang asing bisa daftar lalu jadi admin |
| 2 | **Kunci `DEVICE_SECRET` + sandi router terenkripsi** tertulis bersama di skrip ter-commit | `scripts/inspect-mikrotik-vlans.mjs`, `scripts/probe-mikrotik-bgp.mjs`, `scripts/test-iface-rates.mjs` (kemungkinan juga `test-mikrotik-monitor.mjs`, `test-vlan-pon-mapping.mjs`) | Sandi router bisa didekripsi siapa pun yang membaca repo; repo sudah ada di GitHub |
| 3 | **Kredensial portal billing** tertulis di kode | `src/services/runsnet-billing.service.ts:13-14` (fallback), `scripts/probe-runsnet-login.mjs`, `scripts/test-runsnet-pages.mjs`, `scripts/test-runsnet-direct-fetch.mjs` | Akun billing bocor |
| 4 | **Sandi admin NOC dev** di skrip | `scripts/trigger-runsnet-sync.mjs` | |
| 5 | **Data pelanggan asli (PII)** ter-commit | `dt-response-*.json` (3), `runsnet-*.html` (9) | Nama, alamat, tagihan pelanggan ada di riwayat git |
| 6 | **Port DB terbuka ke semua interface** | `compose.yaml`: postgres `5432:5432` (kredensial bawaan), pgweb `8081:8081` **tanpa auth**, drizzle studio `4983:4983` | Siapa pun di LAN bisa baca/tulis seluruh DB |
| 7 | **Mode demo/live diubah akun biasa**, menulis `.env.local` | `src/app/api/settings/mode/route.ts`, `runtime-mode.service.ts` | Produksi bisa dipindah ke data tiruan |
| 8 | **Transfer DB hanya butuh login**, bisa `overwrite` termasuk `password_enc` | `src/app/api/transfer/run/route.ts` | Data bisa disalin/ditimpa |
| 9 | **Kunci benchmark bawaan** di kode; endpoint lolos tanpa sesi | `src/lib/benchmark/auth.ts` | |

**Tindakan P0 (harus manusia yang memutuskan rotasi):**
1. Hapus POST `/api/settings/role` + tombolnya; tutup sign-up (atau undangan admin).
2. **Rotasi** `DEVICE_SECRET` (enkripsi ulang `password_enc`), sandi akun router `Monitor`, sandi portal billing, sandi admin NOC.
3. Hapus skrip probe/eksperimen berisi rahasia dan berkas PII dari repo; pertimbangkan `git filter-repo` + force push (repo privat, tetap dianggap bocor).
4. Ikat port postgres/pgweb/studio ke `127.0.0.1` atau hapus `db-ui`/`studio` dari compose produksi.
5. `settings/mode`, `transfer`, `seed`, `deploy/*` → `withApiPermission` admin.
6. Tambah `repomix-output.xml` dan `.omc/` ke `.gitignore`.

### 10.2 P1 — Kejujuran data & aksi palsu (melanggar aturan Zero-Dummy)

| # | Masalah | Lokasi |
|---|---|---|
| 1 | Restore backup melapor "berhasil" padahal `setTimeout` | `backup-restore-panel.tsx:88-98` |
| 2 | Sinkronisasi/transfer/seed/alignment semuanya `setTimeout` | `data-sync-board.tsx`, `sync-history-panel.tsx`, `auto-alignment-status.tsx`, `local-to-server-transfer.tsx`, `seed-summary.tsx` |
| 3 | Uji Telegram/WA & diagnostik palsu ("4 Router … 12ms") | `settings-board.tsx:328-357` |
| 4 | Simpan integrasi perangkat membuat router baru dengan sandi bawaan | `device-config-board.tsx:128-140` |
| 5 | Grafik router diberi jitter acak; fallback 55/8.5 Mbps di live | `router-table.tsx:88-99, 315-316` |
| 6 | Uji perangkat mode "simulator" = sukses palsu bila API gagal | `device-config.ts:318-352` |
| 7 | `BillingSyncChip` jatuh ke mock saat API gagal | `lib/dashboard/billing.ts:744-767` |
| 8 | Banner OLT selalu dari `MOCK_DEVICE_CONFIGS` | `unreachable-device-banner.tsx:242` |
| 9 | CRUD Simple Queue hanya state lokal | `simple-queue-board.tsx:103-150` |
| 10 | Secret di localStorage (Telegram token, WA API key) + nilai default tertulis | `settings-board.tsx:88-91`, `whatsapp-registry.ts:41` |
| 11 | Komentar Go menyesatkan ("hanya show", "WAN tidak diubah") padahal menulis | `olt/telnet_session.go:16`, `olt/hsgq_telnet.go:14`, `ontweb/f609.go:305` |

### 10.3 P1 — Keandalan backend

| # | Masalah | Lokasi |
|---|---|---|
| 1 | Alert hilang saat gangguan massal (satu batas 10 dtk untuk seluruh batch) | `cmd/server/main.go:209`, `engine/persist.go:95` |
| 2 | ID event berulang setelah restart | `engine/engine.go:196-197` |
| 3 | `CpuRule` memakai data CPU terakhir walau router tak terjangkau; router nonaktif tetap di memori | `engine/rules.go:127-147`, `state/manager.go` |
| 4 | Shutdown tidak menunggu `archive.Writer` → sampel terakhir hilang | `main.go:124`, `polling.go:54` |
| 5 | Worker OLT/poller dihentikan tanpa ditunggu → sesi telnet tumpang tindih | `collector/olt_fleet.go:207-212`, `poller.go:237` |
| 6 | Sync billing manual melewati backoff login → akun billing bisa terkunci | `billing/scheduler.go:270-279` |
| 7 | Pencarian IP modem tanpa timeout | `httpapi/ontweb.go:125-152` |
| 8 | CORS hanya GET/HEAD/OPTIONS padahal ada 3 rute POST | `httpapi/cors.go:29` |
| 9 | Error ditelan (`SetQueues`, `show onu-version`, `optical-diag`, parse backup) | `poller.go:403`, `hsgq_telnet.go:176-203`, `backup.go:77,128` |
| 10 | Container backend jalan sebagai root; base image tidak di-pin | `backend/Dockerfile` |

### 10.4 P2 — Izin & validasi tidak konsisten

- Mutasi hanya `withApiSession`: `infrastructure/*`, `map/*`, `devices/relations/*`, `customers/[id]/location`,
  `billing/mismatches/*`, `billing/runsnet/sync`, `whatsapp/send`, `alerts/[id]/notify`, `routers/[id]/ping`,
  `alignment`, `onboarding/integrations`, `tutorial/content`, `deploy/backups`, `deploy/rollback-history`.
- Izin salah resource: migrasi pakai `router:manage`; WA pakai `threshold:manage`; `GET /api/audit` tanpa `audit:read`.
- GET yang mengubah data (lolos cek Origin): `GET /api/customers/sync-billing-names`, GET yang menjalankan DDL.
- Tanpa auth: `deploy/health`, `deploy/env-validation` (membocorkan info).
- Banyak mutasi tanpa Zod: `settings/*`, `seed`, `deploy/*`, `onboarding/integrations`, `tutorial`, `alignment`, `routers/[id]/ping`.
- State hanya di memori (hilang saat restart): resolusi selisih billing, override integrasi, daftar snapshot backup.

### 10.5 P2 — Duplikasi & kode mati

| Hal | Detail |
|---|---|
| 3 peta | `components/peta/*` (dipakai), `components/map/*` (`network-map.tsx` 4.183 baris, `/app/topologi`), `customer-map.tsx` (dashboard); `coverage-map.tsx` yatim |
| Uji koneksi router | `/setup`, `/app/router/new`, `/app/router/test`, `/app/pengaturan/perangkat` |
| Billing | Go `billing_*` vs Next.js `runsnet_*`; `billing-board.tsx` + subtree `billing-*` yatim |
| API tanpa pemakai | ±20 route `/api/map/*`, `/api/infrastructure*`, `/api/devices/{status,hierarchy/tree}`, `/api/dashboard/metrics`, `/api/config/status`, `/api/setup/status`, `/api/onboarding/{gate,tips,mikrotik/test}`, `/api/olts/test`, `/api/notes`, `/api/snap` |
| API ada, UI masih mock | `/api/netflow*`, `/api/migrations*`, `/api/export`, `/api/alignment*`, `/api/transfer*`, `/api/seed*`, `/api/whatsapp/*`, `/api/anomalies*`, `/api/alerts/[id]/{ticket,notify}` |
| Service yatim | lihat [6.3](#63-service-penting) |
| Dependensi tak dipakai | `leafer-ui` (tidak diimpor di `src/`) |
| Konfigurasi Go mati | `DASHBOARD_DATA`, `MIKROTIK_REST_*`, `OLT_HSGQ_*` diparse tapi tidak dipakai |
| Skrip eksperimen | ±45 dari 69 berkas `scripts/*.mjs` tidak dirujuk; target `localhost:3000` padahal app di 3001 |
| Berkas root | `prototype.html` (648 KB), `runsnet-*`, `dt-response-*`, `olt-tr069-bind-existing.txt`, `peta.md` (isinya PRD, bukan peta), `screenshots/` (58 MB) |

### 10.6 P3 — Dokumentasi basi

| Berkas | Masalah |
|---|---|
| `README.md` | Masih README starter, tidak menyebut NOC/backend Go |
| `docs/architecture.md` | "One app, one package" — bertentangan dengan backend Go |
| `docs/backend.md`, `deployment.md`, `local-development.md`, `prompts.md`, `ai-workflow.md`, `derivatives.md`, `variant.md` | Boilerplate starter |
| `backend/README.md` | "OLT kerangka", "collector belum disambung", "hanya OfflineRule", alert di `network_logs`, "REST hanya GET", placeholder "XX" — semua sudah tidak benar |
| `docs/noc/billing-page.md`, `docs/noc/audit-log.md` | Masih bilang "mock data" padahal sudah nyata |
| `report-agy/task-*.md` (82) | Arsip historis; ±1/3 menggambarkan kode yang sudah dihapus (peta lama, LeaferJS) |

---

## 11. Peta jalan pengembangan

Urutan disusun supaya **tidak merusak sesi PPPoE pelanggan** dan setiap fase bisa diuji sendiri.

### Fase 0 — Darurat keamanan (1–2 hari)
- [ ] Hapus POST `/api/settings/role` dan tombol promosi admin
- [ ] Tutup pendaftaran publik (`disableSignUp`) atau undangan admin
- [ ] Rotasi `DEVICE_SECRET`, sandi MikroTik `Monitor`, sandi billing, sandi admin NOC (oleh pemilik)
- [ ] Hapus skrip berisi rahasia & berkas PII; bersihkan riwayat git
- [ ] Ikat postgres/pgweb/studio ke `127.0.0.1`
- [ ] Kunci `settings/mode`, `transfer`, `seed`, `deploy/*`, `benchmark/*` dengan izin admin; hapus kunci benchmark bawaan
- [ ] Pindahkan token Telegram / WA ke env atau DB terenkripsi
- [ ] Tutup akses publik telnet OLT (WireGuard saja)

### Fase 1 — Kejujuran data (1 minggu)
- [ ] Hapus semua aksi `setTimeout` yang melapor sukses; ganti "Belum tersedia" atau sambungkan ke API yang sudah ada
- [ ] Hapus jitter/fallback palsu di grafik router dan `BillingSyncChip`
- [ ] Sambungkan halaman yang API-nya sudah ada: WhatsApp (logs, recipients, send), tiket alert, anomali, migrasi, ekspor, audit export
- [ ] Simple Queue → data nyata `/api/routers/:id/queues`
- [ ] Pemetaan ONU & diagnostik → tabel DB
- [ ] Jalankan `npm run deploy:verify:zero-dummy` sebagai gerbang

### Fase 2 — Konsolidasi & bersih-bersih (1–2 minggu)
- [ ] Satu peta: migrasi data `network_*` → `map_*`/`cable_*`, hapus `/app/topologi`, `components/map/*`, `/api/map/*`, `/api/infrastructure/*`
- [ ] Satu jalur billing (rekomendasi: pindahkan profil RunsNet ke Go supaya terjadwal & ikut rule engine, atau sebaliknya hapus scraper Go)
- [ ] Satu tempat uji koneksi perangkat
- [ ] Rapikan izin semua route mutasi (`withApiPermission`), tambah Zod di semua body
- [ ] Hapus service/komponen yatim, `leafer-ui`, `realtime-sse`, `/admin` notes, halaman `uji-stack` dari menu
- [ ] Rapikan root repo & `scripts/` eksperimen
- [ ] Tulis ulang `README.md`, `docs/architecture.md`, perbarui `backend/README.md`

### Fase 3 — Keandalan backend (1–2 minggu)
- [ ] Simpan alert per event dengan batas waktu sendiri / antrean, bukan satu batas 10 dtk
- [ ] ID event unik (UUID / sequence DB)
- [ ] Reload ambang tanpa restart (LISTEN/NOTIFY PostgreSQL atau polling `alert_thresholds`)
- [ ] Graceful shutdown menunggu writer & worker
- [ ] Hapus router nonaktif dari state; `CpuRule` abaikan data basi
- [ ] Backoff login billing berlaku juga untuk sync manual
- [ ] `PortRule` nyata dari counter error/drop interface
- [ ] Snapshot WebSocket memuat alert aktif
- [ ] CI: `go vet`, `go test`, uji `-race` di Linux; perbaiki ±52 tes merah
- [ ] Container Go non-root, image di-pin

### Fase 4 — Fitur NOC berikutnya (berdasarkan kebutuhan ISP)

**Deteksi & respons gangguan**
- [ ] Korelasi insiden di backend: OLT/PON/ODP mati → satu insiden induk dengan daftar pelanggan terdampak (pakai relasi peta ODC→ODP→pelanggan)
- [ ] Notifikasi WhatsApp/Telegram dari server dengan eskalasi & pengulangan
- [ ] Tiket gangguan: penugasan teknisi, status, SLA, riwayat per pelanggan
- [ ] Laporan MTTR / ketersediaan per router, PON, ODP

**Optik & akses**
- [ ] Histori redaman per ONU + prediksi degradasi (Rx turun bertahap)
- [ ] Deteksi ONU "dying gasp" / LOS dari OLT
- [ ] Driver OLT tambahan (GPON, ZTE/Huawei/VSOL) bila jaringan berkembang
- [ ] Provisioning ONU baru dari UI (daftar ONU belum terdaftar → ikat ke pelanggan → profil TR-069)

**CPE**
- [ ] Reboot, factory reset, upgrade firmware, ganti SSID/sandi massal via GenieACS
- [ ] Otomatisasi WAN TR069 DHCP untuk GM22 via OLT
- [ ] Konfirmasi dua langkah sebelum mengubah WAN pelanggan

**Trafik & kapasitas**
- [ ] NetFlow v9/IPFIX disimpan + top talker per pelanggan / aplikasi
- [ ] Laporan pemakaian bandwidth per pelanggan & per paket
- [ ] Peringatan kapasitas uplink & PON (tren 95th percentile)
- [ ] SNMP sebagai sumber cadangan (switch, radio, perangkat non-MikroTik)

**Billing & pelanggan**
- [ ] Panel pelanggan 360° (identitas, paket, ONU, ODP, status online, redaman, tagihan, riwayat gangguan)
- [ ] Integrasi isolir/buka isolir otomatis (butuh keputusan bisnis & API billing yang resmi)
- [ ] Portal/notifikasi pelanggan saat gangguan massal

**Operasional**
- [ ] Backup DB terjadwal + restore nyata yang teruji
- [ ] Observability: metrik Prometheus dari Go (antrean, latensi polling, gagal per perangkat)
- [ ] Mode multi-POP / multi-router penuh

---

## 12. Infrastruktur, tes, dan operasional

### 12.1 Container (`compose.yaml`)

| Layanan | Port host | Catatan |
|---|---|---|
| `postgres` 17-alpine | `5432` (**semua interface**) | Volume `postgres-data` |
| `migrator` | – | Jalan sekali sebelum app |
| `app` (Next.js) | `3001 → 3000` | Health `/icon.svg` |
| `backend` (Go) | `127.0.0.1:8080` | `OLT_TR069_AUTOBIND=new` |
| `db-ui` (pgweb) | `8081` (**tanpa auth**) | Hapus di produksi |
| `studio` (drizzle) | `4983` | Hapus di produksi |

Compose lain: `compose.dev.yaml` (postgres dev loopback), `compose.test.yaml` (postgres sekali pakai),
`compose.genieacs.yaml` (GenieACS + Mongo, CWMP 7547 publik), `compose.osrm.yaml` (OSRM loopback 5000),
`compose.9router.yaml`, `compose.lab.yaml` (simulator; **bentrok port** dengan stack utama).

**Siklus deploy lokal:** ubah kode → `docker compose build app && docker compose up -d --no-deps app`
(tambah `backend`/`migrator` bila ikut berubah). Jangan restart postgres/backend tanpa perlu (sesi pemantauan).

### 12.2 Perintah penting

| Tujuan | Perintah |
|---|---|
| Setup awal | `npm run setup` |
| Dev | `npm run dev` / `npm run dev:all` / `npm run backend:dev` |
| Cek kualitas | `npm run check` (lint + typecheck + test) |
| Build | `npm run build`, `npm run backend:build` |
| Tes | `npm test`, `npm run test:e2e` (setelah build), `npm run backend:check` |
| Migrasi | `npm run db:generate` → periksa SQL → `npm run db:migrate` |
| Peran | `npm run role:set -- <email> <role>` |
| Zero-dummy | `npm run deploy:verify:zero-dummy` |
| Pendamping | `npm run genieacs:up`, `npm run osrm:up`, `npm run 9router:up` |

### 12.3 Tes

| Suite | Isi | Kondisi |
|---|---|---|
| `tests/` (node --test) | 354 berkas; domain terbanyak: devices, map, router, whatsapp, billing, olt | ±52 gagal lama — bandingkan dengan baseline, bukan nol; `audit-service-integration` flaky |
| `e2e/` (Playwright) | 78 spec; alert, billing, auth/role, incident, thresholds | Belum ada spec `/app/peta`; 27 tes masih memanggil `/api/map/*` lama |
| Go | 98 berkas, 14 paket | Tidak ada di CI; `telnet_session`, NetFlow UDP server, `cmd/benchcompare` tanpa tes; `-race` belum pernah jalan |

---

## 13. Lampiran

### 13.1 Variabel lingkungan utama

| Variabel | Dipakai oleh | Fungsi |
|---|---|---|
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` | Next.js, Go | Koneksi PostgreSQL |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TRUSTED_PROXIES` | Next.js | Auth |
| `DASHBOARD_DATA` (`demo`/`live`) | Next.js | Mode data |
| `REALTIME_TOKEN_SECRET` | Next.js + Go | Tiket WebSocket (≥32 karakter, jangan `NEXT_PUBLIC_`) |
| `BACKEND_URL` / `BACKEND_INTERNAL_URL` | Next.js | `http://localhost:8080` (browser) / `http://backend:8080` (antar-container) |
| `DEVICE_SECRET` | Next.js + Go | Kunci AES kredensial perangkat |
| `ALLOWED_ORIGINS`, `BACKEND_ADDR`, `LOG_LEVEL` | Go | Server |
| `PPP_WEBHOOK_TOKEN`, `SYSLOG_ADDR`, `NETFLOW_*` | Go | Jalur event |
| `TRAFFIC_SOURCE`, `TRAFFIC_INTERFACE*` | Go | Sumber trafik dashboard |
| `OLT_TR069_AUTOBIND*` | Go | Bind TR-069 otomatis |
| `ONT_WEB_ALLOWED_CIDRS` | Go | Batas alamat web modem |
| `BILLING_*` | Go | Sync billing |
| `RUNSNET_*` | Next.js | Scraper RunsNet |
| `GENIEACS_NBI_URL`, `GENIEACS_JWT_SECRET` | Next.js, GenieACS | TR-069 |
| `OSRM_BASE_URL` | Next.js | Snap jalan |
| `BENCHMARK_SECRET` | Next.js | Wajib diisi bila benchmark dipertahankan |

### 13.2 Dokumen rinci per fitur (masih berlaku)

| Fitur | Dokumen |
|---|---|
| Halaman auth | `docs/noc/auth-pages.md` |
| Sesi & akses | `docs/noc/session-access.md` |
| Alert & dashboard | `docs/noc/dashboard-alerts.md` |
| Ambang batas | `docs/noc/thresholds.md` |
| Sinkron billing (Go) | `docs/noc/billing-sync-backend.md`, `backend/README.md` bagian "Sinkron billing" |
| API key | `docs/noc/api-key.md` |
| Snap jalan | `docs/noc/road-snap.md` |
| Keputusan hibrida Go + Next | `docs/backend-path-decision.md`, `docs/adr/0001-stack-decision.md` |
| Variabel perangkat | `docs/device-env-guide.md` |
| Checklist deploy | `docs/deploy-checklist.md` |
| Pindah peta ke NOC | `report-agy/report-2026-10-22-pindah-peta-ke-noc.md` |

### 13.3 Cara memperbarui dokumen ini

1. Setelah menyelesaikan satu item checklist, ubah `[ ]` jadi `[x]` dan cantumkan commit-nya.
2. Bila halaman berubah status (MOCK → NYATA), perbarui tabel [8.2](#82-status-setiap-halaman).
3. Item baru dari lapangan dimasukkan ke [bagian 11](#11-peta-jalan-pengembangan) pada fase yang sesuai.
