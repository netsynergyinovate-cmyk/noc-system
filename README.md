# NOC SYSTEM — Network Operations Center & ISP Automation Platform

[![Node.js](https://img.shields.io/badge/Node.js-22.12+-green.svg)](https://nodejs.org)
[![Go](https://img.shields.io/badge/Go-1.25+-blue.svg)](https://go.dev)
[![Next.js](https://img.shields.io/badge/Next.js-16%20Standalone-black.svg)](https://nextjs.org)
[![TimescaleDB](https://img.shields.io/badge/Database-TimescaleDB%20Postgres-blue.svg)](https://www.timescale.com)
[![Docker](https://img.shields.io/badge/Docker-24+-2496ED.svg)](https://www.docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**NOC SYSTEM** adalah platform Network Operations Center (NOC) all-in-one kelas operator ISP yang mengintegrasikan pemantauan infrastruktur jaringan MikroTik Core, OLT HSGQ (EPON/GPON), manajemen CPE TR-069 via GenieACS, pemetaan kabel optik ODP dengan road-snapping OSRM, telemetri NetFlow, sinkronisasi billing RunsNet, serta Mesin Diagnosa Otomatis 9 Lapisan (*9-Layer Diagnostic Engine*).

---

## Daftar Isi
- [Fitur Utama Platform](#fitur-utama-platform)
- [Arsitektur Sistem](#arsitektur-sistem)
- [Spesifikasi Server](#spesifikasi-server)
- [Instalasi di Server Produksi (Ubuntu Native)](#instalasi-di-server-produksi-ubuntu-native)
- [Instalasi Lingkungan Pengembangan Lokal](#instalasi-lingkungan-pengembangan-lokal)
- [Katalog & Panduan Fitur Ekosistem](#katalog--panduan-fitur-ekosistem)
- [Referensi Perintah CLI noc-system](#referensi-perintah-cli-noc-system)
- [Panduan Pemecahan Masalah & Diagnostik Anti-Freeze](#panduan-pemecahan-masalah--diagnostik-anti-freeze)
- [Lisensi](#lisensi)

---

## Fitur Utama Platform

1. **MikroTik Router Core Management**:
   - Polling koneksi PPPoE aktif, antrean (*simple queues*), dan penggunaan bandwidth real-time.
   - Manajemen status isolir pelanggan langsung dari router core via backend Go.
2. **OLT HSGQ Management (EPON / GPON)**:
   - Pemantauan redaman optik ONU Rx/Tx secara live via driver Telnet & HTTP.
   - Deteksi otomatis fluktuasi sinyal optik abnormal dengan ambang batas terkalibrasi (`<= -26 dBm` peringatan, `<= -30 dBm` kritis/loss).
3. **CPE TR-069 Automation (GenieACS Integration)**:
   - Provisioning otomatis modem ONT/CPE pelanggan melalui protokol CWMP standar TR-069.
   - Monitoring parameter Wi-Fi, reboot jarak jauh, dan inventori perangkat.
4. **Peta Infrastruktur Optik & OSRM Road Snap**:
   - Pemetaan interaktif kabel feeder, distribusi, OLT, ODC, dan ODP.
   - Snapping rute kabel optik mengikuti jalur jalan riil memanfaatkan engine OSRM lokal offline.
5. **NetFlow / IPFIX Traffic Telemetry**:
   - Penerima telemetri paket NetFlow v5/v9 dan IPFIX pada port UDP 2055 untuk analisis lalu lintas data.
6. **Billing RunsNet Integration**:
   - Sinkronisasi data tagihan, pembayaran, status isolir, dan terminasi pelanggan secara kontinu.
7. **9-Layer Root-Cause Diagnostic Engine**:
   - Menganalisis gangguan pelanggan secara menyeluruh melewati 9 lapisan: Physical/Optical, PON Port, PPPoE Session, IP Assignment, Traffic Flow, Bandwidth Queue, Billing Status, DNS Health, dan Router Core Reachability.

---

## Arsitektur Sistem

```
                    ┌───────────────────────────────────────────┐
                    │          Operator / Web Browser           │
                    └─────────────────────┬─────────────────────┘
                                          │ HTTP :3000
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SERVER NATIVE UBUNTU (/srv/noc)                                                 │
│                                                                                 │
│  ┌───────────────────────────────┐     RPC / HTTP     ┌──────────────────────┐  │
│  │   noc-web (Next.js 16)        ├───────────────────►│ noc-backend (Go)     │  │
│  │   • Standalone Turbopack      │                    │ • High Concurrency   │  │
│  │   • Port 3000 (systemd)       │◄───────────────────┤ • Port 8080 (systemd)│  │
│  └───────────────┬───────────────┘                    └───────────┬──────────┘  │
│                  │                                                │             │
│                  │ SQL Pool                                       │ SQL / UDP   │
│                  ▼                                                ▼             │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ DOCKER CONTAINER SERVICES                                                 │  │
│  │  • noc-postgres  : PostgreSQL 17 + TimescaleDB (:5432)                     │  │
│  │  • genieacs       : CWMP (:7547) & NBI UI (:9000)                         │  │
│  │  • osrm          : Road Routing Engine (:5000)                            │  │
│  │  • 9router       : MikroTik Lab Simulator (:8728, :161)                   │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ Telnet / API / SNMP / TR-069
                                         ▼
                 ┌──────────────────────────────────────────────┐
                 │          Perangkat Jaringan Riil             │
                 │  • MikroTik Core Router                      │
                 │  • OLT HSGQ (EPON/GPON)                      │
                 │  • ONT / CPE Pelanggan (TR-069)              │
                 └──────────────────────────────────────────────┘
```

---

## Spesifikasi Server

| Komponen | Spesifikasi Minimum (Lab / Uji) | Spesifikasi Rekomendasi (Produksi) |
|---|---|---|
| **Sistem Operasi** | Ubuntu 20.04 / 22.04 / 24.04 LTS (x86_64) | Ubuntu 22.04 / 24.04 LTS (x86_64) |
| **Processor (vCPU)** | 2 Cores | 4 Cores atau lebih |
| **RAM (Memory)** | 2 GB *(Wajib aktifkan Swap 2 GB)* | 8 GB RAM atau lebih |
| **Swap File** | 2048 MB (Anti-OOM Killer) | 4096 MB |
| **Penyimpanan (Disk)** | 15 GB SSD / NVMe | 50 GB NVMe SSD |
| **Jaringan & Port** | Akses internet ke GitHub & registry npm | Akses internet + IP Publik / VPN |

> **Catatan Stabilitas VPS**: Proses kompilasi Go dan bundler Next.js 16 Standalone (Turbopack) membutuhkan alokasi memori heap V8 hingga 2 GB. Pada VPS dengan RAM 2 GB, installer otomatis membuat swapfile 2 GB (`/swapfile`) untuk mencegah Linux OOM Killer.

---

## Instalasi di Server Produksi (Ubuntu Native)

### 1. Eksekusi Skrip Bootstrap 1-Baris
Buka terminal SSH server Ubuntu Anda sebagai pengguna `root` atau `sudo`:

#### Opsi A: Repositori Publik
```bash
curl -fsSL https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo bash
```

#### Opsi B: Repositori Privat (dengan GitHub Token)
```bash
export GITHUB_TOKEN="ghp_personal_access_token_anda"
export NOC_DEVICE_SECRET="kunci_rahasia_32_karakter_sama_lokal"
curl -fsSL -H "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo --preserve-env=GITHUB_TOKEN,NOC_DEVICE_SECRET bash
```

Skrip bootstrap akan otomatis:
- Memeriksa kelayakan CPU, RAM, Swap, Disk, dan port server.
- Mengaktifkan swapfile darurat 2GB jika RAM server < 2.5 GB.
- Memasang Docker Engine, Node.js 22 LTS, dan Go Compiler 1.25.
- Menyiapkan user sistem `noc`, hierarki `/srv/noc`, repositori, dan dependensi npm.
- Menginisialisasi kontainer Docker PostgreSQL (TimescaleDB) dan unit systemd.
- Memasang CLI global `/usr/local/bin/noc-system`.

---

### 2. Rilis Pertama (Deploy)
Setelah bootstrap selesai, jalankan deployment rilis pertama:
```bash
sudo noc-system deploy
```
Alur deploy akan:
1. Membuat backup database otomatis ke `/srv/noc/backups/`.
2. Mengompilasi backend Go ke `/srv/noc/releases/<versi>/backend/bin/noc-backend`.
3. Membangun bundle Next.js standalone via Turbopack.
4. Menjalankan migrasi skema database Drizzle.
5. Melakukan swap symlink atomik `/srv/noc/current` -> rilis baru.
6. Me-restart layanan systemd `noc-web` dan `noc-backend`.
7. Menjalankan health check otomatis (polling 45 detik) dengan verifikasi kode HTTP 200.

---

### 3. Akses Dashboard Web & Monitoring Server
Buka peramban web dan arahkan ke alamat IP server Anda:
```
http://<IP_SERVER_ANDA>:3000
```
- Masuk ke dashboard `/app/deploy` tab **CLI noc-system**.
- Masukkan **Alamat Server** (`http://<IP_SERVER>:3000`) dan **Token Monitor** (diambil dari output installer atau `noc-system status`).
- Panel akan menampilkan spesifikasi server real-time, live terminal stream 50 baris journalctl, status proses aktif, dan matriks fitur secara langsung.

---

## Instalasi Lingkungan Pengembangan Lokal

### Prasyarat
- **Node.js**: Versi `>= 22.12.0` (LTS direkomendasikan).
- **Docker Desktop**: Aktif dan berjalan.
- **Go Compiler**: Versi `>= 1.25` (opsional jika hanya menjalankan frontend web).

### Langkah Setup
1. Clone repositori:
   ```bash
   git clone https://github.com/netsynergyinovate-cmyk/noc-system.git
   cd noc-system
   ```
2. Jalankan konfigurasi otomatis:
   ```bash
   npm run setup
   ```
   *Perintah ini memasang dependensi npm, menyalakan kontainer Docker PostgreSQL development, membuat kredensial acak di `.env.local`, dan menerapkan migrasi database.*
3. Buat akun administrator utama:
   ```bash
   npm run seed:accounts
   ```
   *Akun Admin Utama resmi:* `admin-utama@noc.local` / `admin@noc.local`
4. Jalankan aplikasi development:
   ```bash
   npm run dev
   ```
   Buka [http://localhost:3000](http://localhost:3000) di peramban web.

---

## Katalog & Panduan Fitur Ekosistem

NOC SYSTEM dilengkapi dengan 7 komponen ekosistem yang dapat diaktifkan sesuai kebutuhan operasional:

| No | Komponen | Port Jaringan | Perintah Menyalakan (Up) | Perintah Log | Perintah Restart |
|---|---|---|---|---|---|
| **1** | **NOC Web Dashboard** | 3000 (TCP) | `sudo systemctl start noc-web` | `journalctl -u noc-web -n 50 -f` | `sudo systemctl restart noc-web` |
| **2** | **NOC Backend Engine** | 8080 (TCP) | `sudo systemctl start noc-backend` | `journalctl -u noc-backend -n 50 -f` | `sudo systemctl restart noc-backend` |
| **3** | **Database PostgreSQL & TimescaleDB** | 5432 (TCP) | `docker compose -f compose.postgres.yaml up -d` | `docker logs -f noc-postgres --tail 50` | `docker restart noc-postgres` |
| **4** | **GenieACS TR-069 CPE Provisioning** | 7547 (CWMP), 7557 (NBI), 7558 (UI) | `npm run genieacs:up` *(butuh network `nocsystem_default`)* | `npm run genieacs:logs` | `docker compose -f compose.genieacs.yaml restart` |
| **5** | **OSRM Road Snap & Fiber Routing** | 5000 (TCP) | `npm run osrm:download && npm run osrm:prepare && npm run osrm:up` | `npm run osrm:logs` | `docker compose -f compose.osrm.yaml restart osrm` |
| **6** | **9router Decolua AI Proxy & Lab** | 20128 (TCP - UI & /v1) | `npm run 9router:up` *(butuh network `nocsystem_default`)* | `npm run 9router:logs` | `docker compose -f compose.9router.yaml restart` |
| **7** | **NetFlow Traffic Collector** | 2055 (UDP) | *Aktif otomatis bersama noc-backend* | `journalctl -u noc-backend \| grep -i netflow` | `sudo systemctl restart noc-backend` |

---

## Referensi Perintah CLI noc-system

Engine CLI `noc-system` terpasang secara global di `/usr/local/bin/noc-system` di server produksi:

```bash
noc-system <perintah> [opsi]
```

### Daftar Subperintah
- `noc-system doctor` / `noc-system specs`:
  Memeriksa kelayakan spesifikasi perangkat keras server sebelum instalasi/deploy (CPU cores, RAM bebas, swap active, sisa disk, status Docker daemon, port 3000/8080/5432, dan koneksi internet).
- `noc-system features`:
  Menampilkan ringkasan status 7 komponen ekosistem aplikasi dan perintah kendali Docker Compose terkait.
- `noc-system deploy [versi]`:
  Mengeksekusi rilis produksi penuh: backup DB otomatis, kompilasi Go, build bundle Next.js standalone via Turbopack, migrasi skema database, swap atomik `/srv/noc/current`, dan health check 45 detik. Jika tanpa argumen versi, digit build otomatis dinaikkan (+1).
- `noc-system update [ref]`:
  Menyinkronkan kode terbaru dari git (`git fetch && git reset --hard origin/noc-system-main`), memasang dependensi (`npm ci`), lalu mengeksekusi rilis deploy otomatis.
- `noc-system status`:
  Menampilkan status versi aktif di `/srv/noc/current`, status unit systemd `noc-web` dan `noc-backend`, kesehatan kontainer Docker, alamat IP server, dan Token Monitor.
- `noc-system rollback`:
  Memutar balik symlink `/srv/noc/current` ke direktori rilis sebelumnya secara instan dan me-restart layanan systemd.
- `noc-system logs [-n baris] [--web|--backend]`:
  Menampilkan live stream log journalctl dari kedua layanan server native untuk pelacakan galat dan aktivitas sistem.
- `noc-system upgrade`:
  Menaikkan versi minor aplikasi (misal `1.0.x.y` menjadi `1.1.0.0`) pada `package.json`.
- `noc-system version`:
  Menampilkan versi lokal repositori dan versi rilis aktif di server.
- `noc-system verify`:
  Menjalankan skrip verifikasi integritas lingkungan dan rilis (`scripts/verify-deploy.mjs`).

---

## Panduan Pemecahan Masalah & Diagnostik Anti-Freeze

### 1. Mengapa Layar Terminal Tampak Diam / Membeku Saat Deploy?
Saat menjalankan `install.sh` atau `noc-system deploy`, terdapat tahapan yang membundel kode dalam jumlah besar secara non-interaktif:
- **npm ci (~500 MB)**: Mengunduh dan mengekstrak ratusan paket npm native Linux. Membutuhkan waktu 1–3 menit di VPS.
- **go build**: Mengunduh modul dependensi Go dan mengompilasi biner server. Membutuhkan waktu 30–90 detik.
- **npm run build (Next.js Standalone)**: Turbopack mengompilasi puluhan rute TypeScript dan menghasilkan output standalone. Terminal akan diam tanpa teks selama 1–3 menit.
- **Heartbeat Otomatis**: CLI `noc-system` kini dilengkapi heartbeat timer yang mencetak status setiap 15 detik untuk memberi tahu operator bahwa proses masih berjalan aktif di latar belakang.
- **Solusi**: **DILARANG menekan Ctrl+C saat terminal diam.** Tunggu hingga tahapan selesai dan tanda sukses tercetak.

---

### 2. Linux OOM Killer (Out of Memory)
- **Gejala**: Proses `npm ci`, `go build`, atau `next build` tiba-tiba berhenti dengan pesan `Killed` atau exit code `137`.
- **Penyebab**: Server VPS kehabisan memori RAM fisik dan tidak memiliki swapfile yang cukup.
- **Solusi**: Aktifkan swapfile darurat minimal 2 GB:
  ```bash
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
  ```
  Verifikasi dengan perintah: `free -m` atau `noc-system doctor`.

---

### 3. Port Bentrok (Port Already in Use)
- **Gejala**: Layanan `noc-web` gagal start pada port 3000 atau `noc-backend` gagal pada port 8080.
- **Solusi**: Periksa proses yang menduduki port:
  ```bash
  sudo ss -tulpn | grep -E ':3000|:8080|:5432'
  ```
  Hentikan proses yang bentrok atau ubah port pada file konfigurasi `/srv/noc/shared/.env`.

---

### 4. Izin Akses Docker Socket Ditolak (Permission Denied)
- **Gejala**: `Got permission denied while trying to connect to the Docker daemon socket`.
- **Solusi**: Pastikan user yang menjalankan deploy terdaftar dalam grup `docker`:
  ```bash
  sudo usermod -aG docker $USER
  newgrp docker
  ```
  Atau jalankan perintah deployment dengan hak akses root: `sudo noc-system deploy`.

---

### 5. Gagal Menghubungi Server dari Dashboard Web (/app/deploy)
- **Gejala**: Pesan galat `Gagal menghubungi server: fetch failed` pada tab CLI noc-system.
- **Pemeriksaan**:
  1. Pastikan Anda sudah menjalankan `sudo noc-system deploy` di terminal SSH server (port 3000 baru aktif setelah deploy pertama).
  2. Pastikan firewall server (UFW) atau security group VPS membuka port 3000 TCP:
     ```bash
     sudo ufw allow 3000/tcp
     ```
  3. Pastikan **Token Monitor** yang Anda masukkan di web dashboard persis sama dengan nilai `MONITOR_TOKEN` di `/srv/noc/shared/.env`. Anda dapat melihat token kapan saja dengan perintah `noc-system status`.

---

## Verifikasi & Pengujian Otomatis

Proyek ini dilengkapi dengan rangkaian pengujian ketat untuk menjamin keandalan produksi:

```bash
# Validasi sintaks TypeScript
npm run typecheck

# Validasi standar kode ESLint
npm run lint

# Uji verifikasi deployment & rilis native
node tests/verify-deploy.test.mjs

# Uji kesehatan API deployment
node tests/deploy-health-api.test.mjs

# Uji sistem penomoran versi 4-digit
node tests/app-version.test.mjs

# Pemeriksaan kesehatan pre-flight
node bin/noc-system.mjs doctor
```

---

## Lisensi

Dilisensikan di bawah [MIT License](LICENSE). Hak Cipta (c) 2026 NOC SYSTEM contributors & ngodingpakeai contributors. Lihat juga [Pemberitahuan Pihak Ketiga](THIRD_PARTY_NOTICES.md).
