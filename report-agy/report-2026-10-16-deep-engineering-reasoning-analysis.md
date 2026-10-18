# Analisis Mendalam Arsitektur & Penalaran Rekayasa (Deep Engineering Reasoning)

**Tanggal**: 16 Oktober 2026  
**Objek Analisis**: Repositori `E:\NOC SYSTEM` (Next.js App Router, Go Collector & Hub, PostgreSQL/Drizzle, MikroTik REST/Telnet, OLT Telnet, GenieACS TR-069, Web-ONT Drivers)

---

## 1. Pendahuluan

Laporan ini membedah penalaran teknis mendalam (*deep reasoning*), mitigasi jebakan nyata, dan keputusan arsitektural penting yang telah terbukti dalam codebase ini. Hal ini memastikan setiap tugas baru dikerjakan dengan standar rekayasa tertinggi, tanpa asumsi asal-asalan.

---

## 2. Bedah Kasus & Penalaran Mendalam

### A. Pengukuran Trafik Jaringan: Interface Byte Counter vs Queue Rate
* **Tantangan Historis**: Pengguna mencatat bahwa grafik grafik trafik sering terlambat ~3 detik dan tidak cocok dengan Winbox jika mengambil data dari Simple Queue.
* **Akar Masalah**: RouterOS melakukan *rate-smoothing* internal pada Simple Queue yang menunda angka riil, dan queue hanya mencakup pelanggan ber-queue tanpa menghitung overhead framing PPPoE.
* **Solusi Rekayasa (`ifrate.go`)**:
  - Membaca counter akumulatif hardware `/interface rx-byte, tx-byte` per detik.
  - Menghitung laju secara matematis: `rate = (current_bytes - prev_bytes) / elapsed_seconds`.
  - Hasil: Grafik dashboard identik 1:1 dengan Winbox live counter tanpa jeda.

### B. Driver Telnet OLT HSGQ-XE08ID: Protokol CLI Tanpa API JSON
* **Tantangan Historis**: Request HTTP ke OLT menghasilkan 404.
* **Akar Masalah**: Perangkat keras OLT fisik (HSGQ-XE08ID) sama sekali tidak memiliki Web JSON API, hanya CLI Telnet pada port 2323.
* **Solusi Rekayasa (`backend/internal/olt/`)**:
  - Stateful Telnet session: Menolak negosiasi opsi IAC (*Interpret as Command*) agar koneksi tidak menggantung.
  - Toleransi banner: Banner OLT memuat kata disclaimer "fail", yang ditangani khusus agar tidak memicu kegagalan login palsu.
  - Proteksi integritas database: Polling rutin memperbarui status nama dan daya optik ONU, namun **dilarang keras menimpa kolom `customer_id`** yang telah dipetakan oleh admin.
  - Sanitasi pembacaan optik: Menangani nilai numerik `-inf` dan `NaN` dari modul optik yang rusak agar tidak merusak constraint PostgreSQL.

### C. Reverse Engineering Web Server Mini ONT (ZTE F609 & GM22)
* **Tantangan Historis**: ONT menolak login berulang dan memblokir IP selama 1 menit.
* **Akar Masalah**: Firmware web server Boa/Mini-web ZTE bersifat *single-session*. Jika koneksi terputus tanpa eksekusi `logout` formal, sesi tersangkut di memori modem.
* **Solusi Rekayasa (`backend/internal/ontweb/`)**:
  - Membungkus seluruh alur HTTP dengan blok `try/finally` yang wajib mengeksekusi `POST / logout=1` meskipun terjadi error di tengah proses.
  - Menghitung checksum integritas `EBOOVALUE = crc32(nama_field + nilai_field)` yang diwajibkan oleh ZTE F609.
  - Menjaga koneksi internet pelanggan: Form WAN PPPoE modem terkunci oleh operator; driver tidak menyentuh WAN PPPoE, melainkan menambahkan WAN TR-069 mandiri bertipe DHCP tanpa VLAN (`EnsureWAN`).

### D. Komunikasi Antar-Kontainer vs Browser Client
* **Tantangan Historis**: Galat "Backend tidak dapat dihubungi" saat Next.js memanggil backend dari server component.
* **Akar Masalah**: Konfigurasi tunggal `BACKEND_URL` dipakai untuk browser dan server. Di dalam Docker, `localhost:8080` merujuk ke kontainer Next.js itu sendiri, bukan kontainer Go backend. Namun jika diubah ke `backend:8080`, browser pengguna dari luar Docker akan gagal tersambung ke WebSocket.
* **Solusi Rekayasa (`src/lib/env.ts` & `compose.yaml`)**:
  - Memisahkan secara tegas:
    * `BACKEND_INTERNAL_URL = http://backend:8080` (komunikasi antar kontainer server-to-server).
    * `BACKEND_URL = http://localhost:8080` (alamat publik yang dikirim ke browser untuk tiket WebSocket).
  - Diberikan fallback otomatis sehingga pengujian lokal non-Docker tetap berjalan normal.

### E. Pencegahan Kebocoran State di Next.js Server Components
* **Tantangan Historis**: Risiko data pengguna A tampil di layar pengguna B.
* **Akar Masalah**: Pada Next.js App Router (Server Components), variabel global di level modul dibagi bersama di antara semua permintaan koneksi yang masuk.
* **Solusi Rekayasa (`src/lib/session-store.ts`)**:
  - Menggunakan factory function `createSessionStore` yang di-instansiasi secara unik per request melalui React Context (`SessionProvider`).
  - Pemisahan peran visual vs otoritas server: "Peran tiruan" (*preview role*) murni hanya memengaruhi rendering DOM di browser; seluruh endpoint API backend tetap divalidasi oleh `withApiPermission` berdasarkan peran database sesungguhnya.

---

## 3. Kesimpulan

Codebase ini dibangun di atas pondasi rekayasa yang sangat solid, presisi terhadap protokol fisik, dan penuh dengan penanganan *edge cases* nyata. Standar penalaran ini dipegang penuh untuk setiap penugasan tugas baru.

