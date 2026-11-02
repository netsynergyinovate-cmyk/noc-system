<div align="center">

# 🛰️ NOC SYSTEM

### Network Operations Center & ISP Automation Platform

MikroTik · OLT HSGQ · GenieACS TR-069 · OSRM · NetFlow · Billing RunsNet · Diagnosa 9 Lapisan

[![Node.js](https://img.shields.io/badge/Node.js-22.12+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Instal Cepat](#-instal-cepat) · [Fitur](#-fitur-utama) · [Arsitektur](#-arsitektur) · [CLI](#-referensi-cli-noc-system) · [Troubleshooting](#-pemecahan-masalah--anti-freeze) · [Lisensi](#-lisensi)

<img src="screenshots/20-pengaman-deploy.png" alt="Pengaman Deploy NOC SYSTEM" width="860">

</div>

---

**NOC SYSTEM** adalah platform NOC all-in-one untuk operator ISP: memantau MikroTik Core, OLT HSGQ (EPON/GPON), mengelola CPE TR-069 lewat GenieACS, memetakan kabel optik dengan road-snapping OSRM, menerima telemetri NetFlow, menyinkronkan billing RunsNet, dan menjalankan mesin diagnosa otomatis 9 lapisan.

## ⚡ Instal Cepat

Di server **Ubuntu 20.04 / 22.04 / 24.04** (akses `sudo`):

```bash
curl -fsSL https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo bash
sudo noc-system deploy              # rilis pertama
sudo noc-system features up all     # Logto, GenieACS, OSRM, 9router
```

Dashboard: `http://<IP_SERVER>:3000`. Panduan lengkap: [Instalasi Produksi](#instalasi-di-server-produksi-ubuntu-native).

> **Status pengujian:** `install.sh` dan `noc-system features up` baru diuji di Windows/Git Bash dan belum dijalankan end-to-end di Ubuntu bersih. Coba di satu VPS kosong sebelum dipakai di produksi atau klien.

| Tahap | Perintah | Hasil |
|---|---|---|
| 1. Bootstrap | `install.sh` | Docker, Node 22, Go 1.25, user `noc`, CLI `noc-system` |
| 2. Rilis | `noc-system deploy` | Build, migrasi DB, systemd `noc-web` + `noc-backend` |
| 3. Add-on | `noc-system features up <id\|all>` | Logto, GenieACS, OSRM, 9router + tautan akses |
| 4. Cek | `noc-system doctor` / `features` | Status dan spesifikasi server |

## ✨ Fitur Utama

| | Modul | Kemampuan |
|---|---|---|
| 🌐 | **MikroTik Core** | Polling PPPoE aktif, simple queue, bandwidth real-time, kontrol isolir pelanggan |
| 📡 | **OLT HSGQ (EPON/GPON)** | Redaman optik ONU Rx/Tx live via Telnet & HTTP; peringatan `<= -26 dBm`, kritis `<= -30 dBm` |
| 📶 | **CPE TR-069 (GenieACS)** | Provisioning ONT/CPE via CWMP, monitoring Wi-Fi, reboot jarak jauh, inventori |
| 🗺️ | **Peta Optik + OSRM** | Peta feeder/distribusi/OLT/ODC/ODP, kabel mengikuti jalan nyata (OSRM offline) |
| 📊 | **NetFlow / IPFIX** | Telemetri NetFlow v5 pada UDP 2055 untuk analisis lalu lintas per pelanggan |
| 💳 | **Billing RunsNet** | Sinkronisasi tagihan, pembayaran, isolir, dan terminasi |
| 🔐 | **Login SSO (Logto)** | Masuk dengan GitHub/Google selain email + password |
| 🩺 | **Diagnosa 9 Lapisan** | Optik, port PON, sesi PPPoE, IP, traffic flow, queue, billing, DNS, reachability router |

<details>
<summary><b>📸 Tangkapan layar</b></summary>

| | | |
|---|---|---|
| ![Pelanggan](screenshots/06-daftar-pelanggan.png) | ![NetFlow](screenshots/15-analisis-netflow.png) | ![Onboarding](screenshots/21-pusat-onboarding.png) |

</details>

## 🏗️ Arsitektur

```mermaid
flowchart TB
    Op["👤 Operator / Browser"] -->|HTTP :3000| Web

    subgraph Server["Server Native Ubuntu (/srv/noc)"]
        Web["noc-web<br/>Next.js 16 · systemd :3000"]
        Be["noc-backend<br/>Go · systemd :8080 · NetFlow UDP :2055"]
        subgraph Docker["Layanan Docker (network nocsystem_default)"]
            Pg[("PostgreSQL 17<br/>:5432")]
            Genie["GenieACS<br/>CWMP :7547 · NBI :7557 · UI :7558"]
            Osrm["OSRM<br/>:5000"]
            Nine["9router (AI proxy)<br/>:20128"]
            Logto["Logto SSO<br/>OIDC :3301 · Admin :3002 (loopback)"]
        end
        Web <-->|REST / WebSocket| Be
        Web --> Pg
        Be --> Pg
        Web -.-> Osrm
        Web -.-> Logto
    end

    Be -->|REST www / www-ssl| Mt["MikroTik Core"]
    Be -->|Telnet / HTTP| Olt["OLT HSGQ"]
    Genie -->|TR-069| Cpe["ONT / CPE pelanggan"]
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
- Menginisialisasi kontainer Docker PostgreSQL 17 dan unit systemd.
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

### 3. Instal di Server Klien
Instalasi yang sama dipakai untuk server klien. Tiap klien mendapat `DEVICE_SECRET`, `BETTER_AUTH_SECRET`, dan password DB acak sendiri:
```bash
export NOC_PUBLIC_URL="https://noc.klien.com"
curl -fsSL https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo --preserve-env=NOC_PUBLIC_URL bash
sudo noc-system deploy
sudo NOC_OSRM_REGION=java noc-system features up all   # wilayah sesuai lokasi klien
```
- Logto, router, dan OLT klien dikonfigurasi sendiri; jangan memakai client ID/secret Logto milik penyedia.
- Polling MikroTik butuh port REST router (`www` atau `www-ssl`) yang bisa dijangkau dari server klien.
- Jika server sudah berisi database lama dengan kredensial router terenkripsi, jalankan installer dengan `NOC_DEVICE_SECRET=<nilai-lama>`.

---

### 4. Akses Dashboard Web & Monitoring Server
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
   Buka [http://localhost:3001](http://localhost:3001) di peramban web.

---

## Katalog & Panduan Fitur Ekosistem

NOC SYSTEM punya 8 komponen. Add-on Docker dipasang per fitur dengan `sudo noc-system features up <id>`; CLI memeriksa status kontainer dan mencetak tautan akses.

| No | Komponen | Port | Pasang / Nyalakan | Log |
|---|---|---|---|---|
| **1** | **NOC Web Dashboard** | 3000 | `sudo systemctl start noc-web` | `journalctl -u noc-web -n 50 -f` |
| **2** | **NOC Backend Engine** | 8080 | `sudo systemctl start noc-backend` | `journalctl -u noc-backend -n 50 -f` |
| **3** | **PostgreSQL 17** | 5432 | `docker compose -f compose.postgres.yaml up -d` | `docker logs -f noc-postgres --tail 50` |
| **4** | **GenieACS TR-069** | 7547 (CWMP), 7557 (NBI), 7558 (UI) | `sudo noc-system features up genieacs` | `npm run genieacs:logs` |
| **5** | **OSRM Road Snap** | 5000 | `sudo NOC_OSRM_REGION=java noc-system features up osrm` | `npm run osrm:logs` |
| **6** | **9router AI Proxy** | 20128 (UI & /v1) | `sudo noc-system features up 9router` | `npm run 9router:logs` |
| **7** | **Logto SSO** | 3301 (OIDC), 3002 (Admin) — hanya loopback | `sudo noc-system features up logto` | `npm run logto:logs` |
| **8** | **NetFlow Collector** | 2055 (UDP) | Aktif otomatis bersama `noc-backend` | `journalctl -u noc-backend \| grep -i netflow` |

**OSRM:** wilayah dipilih lewat `NOC_OSRM_REGION` (`sumatra` bawaan, `java`, `kalimantan`, `sulawesi`, `maluku`, `nusa-tenggara`, `papua`). Unduh dan olah data hanya sekali per wilayah; wilayah besar butuh RAM jauh lebih banyak saat `osrm-extract`.

**Logto di server:** Admin Console hanya di loopback, akses lewat `ssh -L 3002:127.0.0.1:3002 user@server`. Setelah `features up logto`, ikuti langkah yang dicetak CLI: buat aplikasi + konektor GitHub, daftarkan redirect `https://<domain>/api/auth/callback/logto-github` (tanpa spasi di akhir), isi `LOGTO_ENDPOINT`, `LOGTO_INTERNAL_ENDPOINT`, `LOGTO_CLIENT_ID`, `LOGTO_CLIENT_SECRET` di `/srv/noc/shared/.env`, lalu `sudo systemctl restart noc-web`.

---

## 🔧 Referensi CLI noc-system

Engine CLI `noc-system` terpasang secara global di `/usr/local/bin/noc-system` di server produksi:

```bash
noc-system <perintah> [opsi]
```

### Daftar Subperintah
- `noc-system doctor` / `noc-system specs`:
  Memeriksa kelayakan spesifikasi perangkat keras server sebelum instalasi/deploy (CPU cores, RAM bebas, swap active, sisa disk, status Docker daemon, port 3000/8080/5432, dan koneksi internet).
- `noc-system features [up <logto|genieacs|osrm|9router|all>]`:
  Tanpa argumen: status 8 komponen beserta tautan akses. Dengan `up`: memasang add-on Docker per fitur (memakai `/srv/noc/shared/.env`, memeriksa status kontainer sebelum mencetak tautan, GenieACS otomatis memasang konfigurasi dari repo, OSRM mengikuti `NOC_OSRM_REGION`).
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

## 🛟 Pemecahan Masalah & Anti-Freeze

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

## 📄 Lisensi

Dilisensikan di bawah [MIT License](LICENSE). Hak Cipta (c) 2026 NOC SYSTEM contributors & ngodingpakeai contributors. Lihat juga [Pemberitahuan Pihak Ketiga](THIRD_PARTY_NOTICES.md).
