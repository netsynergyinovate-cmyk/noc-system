# **Product Requirements Document (PRD)**

# **Integrasi & Koneksi MikroTik RouterOS v7 (Zero-Delay Pipeline)**

| Parameter | Spesifikasi |
| :---- | :---- |
| **Dokumen ID** | PRD-NOC-MIKROTIK-001 |
| **Versi** | 1.0 (Final Engineering Spec) |
| **Status** | Ready for Implementation / Engineering Review |
| **Target Sistem** | NOC SYSTEM ([netsynergyinovate-cmyk/noc-system](https://github.com/netsynergyinovate-cmyk/noc-system)) |
| **Target Infrastruktur Operasional** | ISP RunsNet Mukomuko (Core BRAS MikroTik RouterOS v7) |
| **Tanggal** | 5 November 2026 |

# **1\. Latar Belakang & Pernyataan Masalah (Problem Statement)**

Modul koneksi MikroTik pada platform NOC System saat ini menghadapi sejumlah kendala teknis dan arsitektural yang menghambat keandalan operasional ISP di lapangan:

* **Beban CPU Berlebih & Delay Polling:** Polling berkala REST API (interval 1 detik) ke `/rest/queue/simple` dan `/rest/interface` menyebabkan lonjakan CPU pada RouterOS hingga 90–100% dan menimbulkan latensi data yang terasa lambat di dashboard.  
* **Ketidakcocokan Protokol & Port (Mismatch 8728 vs 80):** Form penambahan router di frontend menetapkan default port **8728** (Binary API), padahal backend Go mencoba memanggil via HTTP REST API (port 80/443). Mismatch ini menyebabkan kegagalan koneksi fisik seketika.  
* **Ketergantungan pada Data Mock & Simulator:** Saat koneksi fisik gagal, sistem jatuh (*fallback*) ke `MikrotikSimulatorClient` yang menghasilkan data CPU dan latensi acak (*random jitter*), mengaburkan status keterputusan jaringan yang sebenarnya dari pandangan teknisi.  
* **Anomali Perhitungan Trafik (Counter Rollover):** Ketiadaan validasi saat router me-reboot atau counter byte di-reset menyebabkan selisih \$(Byte\_t \- Byte\_{t-1})\$ menghasilkan angka negatif ekstrem atau lonjakan palsu (*spike*) ratusan Gbps pada grafik.  
* **Keterlambatan Deteksi PPPoE (30 Detik):** Keterputusan sesi pelanggan baru terdeteksi setelah 30 detik akibat jeda polling berkala pada `/rest/ppp/active`.

PRD ini merinci perombakan total subsistem integrasi MikroTik menjadi arsitektur **Zero-Delay Pipeline** yang terpusat di Backend Go.

# **2\. Tujuan & Batasan (Goals & Non-Goals)**

## **A. Tujuan Utama (Goals)**

* **Zero Polling Delay:** Latensi streaming bandwidth interface ke dashboard dipangkas menjadi \$\< 10\\text{ ms}\$ (dari sebelumnya 1–5 detik).  
* **Deteksi Sesi Instan (0-Detik):** Keterputusan atau penyambungan sesi pelanggan PPPoE terdeteksi secara *real-time* (0 detik latensi) menggunakan mekanisme *event-driven webhook*.  
* **Efisiensi Beban Router:** Tambahan beban CPU MikroTik akibat proses monitoring ditekan di bawah \$15%\$ dari total kapasitas CPU router core.  
* **Arsitektur Single-Gateway:** Menghilangkan seluruh duplikasi koneksi fisik dari Next.js; Backend Go menjadi satu-satunya gerbang komunikasi ke perangkat jaringan.  
* **100% Integritas Data Riil:** Mengeliminasi seluruh data tiruan, *random jitter*, dan fallback simulator palsu di lingkungan produksi.

## **B. Batasan (Non-Goals)**

* Tidak menggantikan sistem RADIUS atau billing utama (RunsNet) yang sudah ada.  
* Tidak mencakup manajemen perangkat OLT atau konfigurasi CPE TR-069 (dikelola dalam modul terpisah).

# **3\. Persona Pengguna & Alur Kerja**

* **Network Administrator (Admin Jaringan):** Menambahkan router core MikroTik baru, mengonfigurasi kredensial, dan memastikan koneksi terenkripsi stabil.  
* **NOC Operator (Operator Pemantau):** Mengamati grafik trafik interface, beban CPU, dan sesi pelanggan secara *live* tanpa jeda refresh.  
* **Field Technician (Teknisi Lapangan):** Menerima notifikasi instan begitu ada sesi PPPoE atau antarmuka fisik yang putus (*down*) tanpa menunggu jeda polling.

# **4\. Arsitektur Teknis & Alur Data**

## **A. Pola Arsitektur Single-Gateway**

```
[Router MikroTik Core v7]
       │
       ├─────────────────────────┬──────────────────────────┐
       ▼ (1. Binary Socket 8728) ▼ (2. Webhook /hooks/ppp)  ▼ (3. Syslog UDP 5514)
┌────────────────────────────────────────────────────────────────────────┐
│                          BACKEND GO ENGINE                             │
│  • RouterOS Client (Persistent TCP Socket via github.com/go-routeros)  │
│  • In-Memory Thread-Safe State Store (sync.RWMutex)                    │
│  • Webhook Receiver (/hooks/ppp) & Syslog Listener (:5514)             │
│  • WebSocket Hub: Broadcast State Snapshot + Delta Stream              │
└────────────────────┬───────────────────────────────────┬───────────────┘
                     │                                   │
                     ▼ (Streaming Delta <10ms)           ▼ (Agregasi 1-5 Menit)
            [Next.js Dashboard UI]              [PostgreSQL (traffic_archive)]
```

## **B. Pemisahan Hot-Path vs Cold-Path**

* **Jalur Hot-Path (RAM/WebSocket):**  
  * Data bit rate interface diambil secara streaming melalui persistent TCP socket (`/interface/monitor-traffic`).  
  * Data disimpan di RAM Go dan langsung disiarkan ke frontend via WebSocket. Tidak ada query database yang dieksekusi per detik.  
* **Jalur Cold-Path (PostgreSQL Database):**  
  * Go mengagregasi data dari RAM (rata-rata dan peak) tiap 1–5 menit.  
  * Hanya data agregat yang di-insert secara *batch* ke PostgreSQL untuk riwayat grafik harian/bulanan.

# **5\. Spesifikasi Fungsional (Functional Requirements)**

## **FR-01: Form Tambah & Konfigurasi Router (`/app/router/new`)**

* **Field Input:**  
  * `Nama Router` (String, Wajib, min 3 karakter).  
  * `Host / IP Address` (IPv4/FQDN, Wajib).  
  * `Protokol & Port` (Selector Dropdown):  
    * Opsi A (Rekomendasi Realtime): **Binary API (Port 8728 / 8729 TLS)**.  
    * Opsi B: **REST API (Port 80 / 443 HTTPS)**.  
  * `Username & Password` (Wajib, hak akses minimal group `read` dan `api`).  
* **Validasi Frontend:**  
  * Port default otomatis disesuaikan berdasarkan protokol yang dipilih (8728 untuk Binary, 80 untuk REST).  
  * Menolak duplikasi IP router yang sudah terdaftar.

## **FR-02: Pre-Flight Connection Check yang Ketat**

* Tombol **"Uji Koneksi"** wajib mengeksekusi tes koneksi fisik ke backend Go sebelum data disimpan ke database.  
* Batas waktu (*timeout*) pengujian dibatasi maksimal **5 detik**.  
* **Penghapusan Fallback Simulator:** Jika koneksi gagal, sistem harus mengembalikan rincian error yang jelas (`AUTH_FAILED`, `CONNECTION_TIMEOUT`, `HOST_UNREACHABLE`), bukan mengembalikan status sukses palsu.

## **FR-03: Engine Poller & Fleet Manager Go**

* Backend Go membaca daftar router aktif dari PostgreSQL menggunakan pola *Reconcile Loop* berkala.  
* Begitu router baru ditambahkan dengan status `aktif`, Go otomatis menginisialisasi worker baru tanpa me-restart service.  
* Mengimplementasikan *reconnection watcher* dengan algoritma *exponential backoff* jika koneksi TCP ke router terputus.

## **FR-04: Algoritma Laju Trafik Anti-Rollover (`ifrate.go`)**

Fungsi perhitungan delta rate wajib menangani kondisi saat router me-reboot atau interface mengalami reset:

```
func CalculateRateSafe(currentBytes, previousBytes uint64, intervalSec float64) uint64 {
    if currentBytes < previousBytes {
        // Counter reset/reboot terdeteksi; lewati interval ini untuk mencegah lonjakan Gbps palsu
        return 0
    }
    deltaBytes := currentBytes - previousBytes
    return uint64(float64(deltaBytes * 8) / intervalSec)
}
```

## **FR-05: Event-Driven PPPoE Monitoring via Webhook (`/hooks/ppp`)**

* Endpoint HTTP POST `/hooks/ppp` menerima payload JSON dari MikroTik.  
* Begitu payload diterima, status koneksi pelanggan di tabel `customers` dan cache RAM langsung diperbarui, dan event disiarkan ke antarmuka operator dalam waktu \$\< 100\\text{ ms}\$.

## **FR-06: Manajemen Lifecycle Tool Torch (`/rest/tool/torch`)**

* Pemanggilan Torch dibatasi maksimal 5 detik per sesi capture.  
* Go HTTP Client wajib menyertakan `context.WithTimeout`. Jika pengguna menutup tab atau membatalkan capture, sinyal pembatalan TCP otomatis mematikan proses Torch di RouterOS.

# **6\. Konfigurasi MikroTik (RouterOS v7 Production Scripts)**

## **A. Skrip Webhook PPP Profile (Deteksi Sesi 0-Detik)**

Di menu `/ppp/profile` (Profile default pelanggan), tambahkan skrip:

* **Tab Scripts \-\> On Up:**

```
/tool fetch http-method=post http-header-field="Content-Type: application/json" \
  url="http://10.20.0.1:8080/hooks/ppp" \
  http-data="{\"event\":\"up\",\"user\":\"$user\",\"interface\":\"$interface\",\"address\":\"$remote-address\"}" \
  keep-result=no
```

* **Tab Scripts \-\> On Down:**

```
/tool fetch http-method=post http-header-field="Content-Type: application/json" \
  url="http://10.20.0.1:8080/hooks/ppp" \
  http-data="{\"event\":\"down\",\"user\":\"$user\",\"interface\":\"$interface\"}" \
  keep-result=no
```

## **B. Konfigurasi Syslog UDP (Deteksi Link Flapping)**

```
/system logging action add name=noc-syslog target=remote remote=10.20.0.1 remote-port=5514
/system logging add topics=interface,warning action=noc-syslog
/system logging add topics=pppoe,info action=noc-syslog
```

# **7\. Persyaratan Non-Fungsional (Non-Functional Requirements)**

* **Keamanan Kredensial:** Kata sandi router wajib dienkripsi simetris menggunakan **AES-256-GCM** sebelum disimpan ke PostgreSQL. Kunci enkripsi dikelola melalui environment variable `DEVICE_SECRET`.  
* **Ketersediaan (Availability):** Jika satu router down, worker router lain tidak boleh terganggu (*isolated worker pool*).  
* **Performa Jaringan:** Penggunaan bandwidth manajemen antara Go Backend dan MikroTik dibatasi maksimal 50 Kbps per router untuk telemetri continuous stream.

# **8\. Kriteria Penerimaan (Acceptance Criteria / Definition of Done)**

* Form `/app/router/new` memiliki selector protokol yang benar dan menolak data jika uji koneksi gagal dalam 5 detik.  
* Tidak ada lagi modul `ssh2` atau `src/lib/mikrotik/client.ts` yang membuat koneksi mandiri dari Next.js.  
* Grafik trafik di `/app/router` mengalir lancar via WebSocket dengan data murni (tanpa simulasi jitter matematika).  
* Saat modem pelanggan dimatikan atau dicabut, dashboard menampilkan status "Offline" dalam waktu kurang dari 1 detik.  
* Saat router MikroTik di-reboot, grafik trafik tidak menampilkan lonjakan angka negatif atau angka lonjakan palsu ratusan Gbps.  
* Seluruh test suite `tests/` dan `backend:test` lulus pengujian tanpa fallback simulator.

# **9\. Rencana Implementasi & Jadwal Rilis (Milestones)**

| Milestone | Durasi | Sasaran & Deliverables |
| :---- | :---- | :---- |
| **Milestone 1** | Hari 1–2 | **Penyelarasan Form & Pre-flight Validator**\* Perbaiki form `/app/router/new` (default port, selector protokol).\* Hapus `MikrotikSimulatorClient` dari alur produksi. |
| **Milestone 2** | Hari 3–4 | **Refaktorisasi Go Collector & Anti-Rollover**\* Terapkan algoritma aman pada `ifrate.go`.\* Implementasikan streaming socket biner `/interface/monitor-traffic` di Go.\* Buat thread-safe state store di RAM Go untuk jalur Hot-Path. |
| **Milestone 3** | Hari 5 | **Aktivasi Webhook PPP & Syslog Listener**\* Uji integrasi endpoint `/hooks/ppp` dan listener UDP 5514.\* Pasang skrip PPP Profile pada router uji RunsNet. |
| **Milestone 4** | Hari 6–7 | **Uji Beban & Validasi E2E**\* Uji koneksi router nyata, simulasi reboot, dan verifikasi latensi dashboard.\* Final sign-off dan deployment produksi. |

