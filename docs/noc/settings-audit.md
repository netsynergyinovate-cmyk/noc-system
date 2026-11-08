# Audit Pengaturan Sistem & Operasional (`/app/pengaturan`)

Dokumen ini mendokumentasikan hasil audit teknis mendalam terhadap halaman **Pengaturan** (`/app/pengaturan`, komponen `src/components/dashboard/settings-board.tsx`), komponen anaknya, serta keterhubungannya ke backend Next.js, database PostgreSQL, dan backend Go.

Tanggal audit: **26 Oktober 2026**

---

## 1. Rangkuman Status per Tab

| Tab | Status Fungsional | Penyimpanan | Dampak ke Runtime Aplikasi |
|---|---|---|---|
| **1. Umum (`general`)** | **Campuran (Sebagian Real)** | • Mode: `POST /api/settings/mode`<br>• Peran: Better Auth DB<br>• Form lainnya: `localStorage["noc_app_settings"]` | • **Real:** Toggle Mode mengubah `DASHBOARD_DATA` & `DATA_MODE` di runtime Next.js.<br>• **Real:** Kelola peran pengguna menulis ke tabel `user`.<br>• **Dummy:** Nama ISP, Zona Waktu, dan Interval Sampling tidak pernah dibaca modul lain. |
| **2. Alarm & Bot (`alerts`)** | **DUMMY (Fake Success)** | `localStorage["noc_app_settings"]` | • Suara alarm tidak dibaca mesin audio (`sound-engine.ts` memakai key `alertSound`).<br>• Telegram tidak memiliki implementasi sama sekali di codebase.<br>• Tombol tes hanya `setTimeout` 3.5 detik dengan notifikasi sukses palsu. |
| **3. WhatsApp (`whatsapp`)** | **DUMMY di UI** | `localStorage["whatsappConfig"]` | • Konfigurasi dan token API tersimpan plain-text di browser.<br>• Uji kirim memanggil `sendMockWhatsappAlert` (`setTimeout` 400 ms).<br>• *Terputus:* Backend memiliki tabel `whatsapp_recipients`/`whatsapp_logs` dan API `/api/whatsapp/send`, namun UI ini tidak menggunakannya. |
| **4. Ambang Batas (`thresholds`)** | **REAL** | PostgreSQL tabel `alert_thresholds` via `GET/PUT/DELETE /api/thresholds` | • Mengubah nilai ambang batas CPU, offline, optik, dan antrean di database.<br>• Rule engine Go membaca tabel ini saat inisialisasi awal (perlu restart backend Go agar ambang baru berlaku). |
| **5. Perangkat (`devices`)** | **DUMMY (Simulasi)**<br>*(Backend probe mendukung real bila mode diizinkan)* | Daftar: Hardcoded `MOCK_DEVICE_CONFIGS`<br>Uji: `POST /api/devices/test` | • Keempat kartu perangkat menggunakan IP tiruan (`10.10.0.1`, dll.) dan secara eksplisit mengirimkan `mode: "simulator"`.<br>• Backend memproses cabang simulator (menghasilkan latensi dan data CPU/memory tiruan).<br>• **Hanya menjadi nyata** bila mode perangkat diubah menjadi `real` via env per-perangkat. |
| **6. Kolektor & Hub (`collector`)** | **DUMMY** | `localStorage["noc_app_settings"]` | • Alamat WebSocket Hub asli diambil server dari env `BACKEND_URL` lewat `/api/realtime/ticket`. Nilai `wsHubUrl` di UI diabaikan.<br>• Timeout dan interval healthcheck Go dikendalikan env statis di backend (`backend/internal/config/config.go`). |
| **7. Billing (`billing`)** | **DUMMY** | `localStorage["noc_app_settings"]` | • Backend Go menggunakan env `BILLING_URL`, `BILLING_USERNAME`, dan `BILLING_PASSWORD` atau langsung membaca tabel RunsNet.<br>• Form di UI ini tidak tersambung ke API mana pun dan tidak dibaca oleh sistem billing. |
| **8. Panduan Koneksi (`guide`)** | **Statis & DUMMY** | Tidak disimpan | • Fitur salin skrip MikroTik/OLT berfungsi (clipboard browser).<br>• Tombol *"Uji Konektivitas Semua Node"* hanya timer 1,6 detik yang menampilkan teks sukses fiktif (latensi 12 ms, 4 router, 2 OLT). |

---

## 2. Rincian Teknis per Tab

### Tab 1: Umum (`general`)
- **Toggle Mode Simulasi/Live (`handleToggleMode`):**
  - Mengirim `POST /api/settings/mode` dengan payload `{ dataMode: "demo" | "live" }`.
  - Service `runtime-mode.service.ts` mengubah `process.env.DASHBOARD_DATA` dan `DATA_MODE`, serta mencoba menulis ke `.env.local` jika file ada.
  - Proxy `env` (`src/lib/env.ts`) membaca env dinamis ini sehingga halaman me-reload dengan data live/demo.
  - **Kelemahan:** Backend Go tidak membaca variabel ini; perubahan hanya berlaku pada proses Next.js. Di Docker produksi tanpa `.env.local`, nilai kembali ke default saat container restart.
- **Kelola Pengguna & Peran (`SuperAdminUserManager`):**
  - Menggunakan SDK Better Auth (`authClient.admin.listUsers`, `authClient.admin.setRole`).
  - Berfungsi penuh dan tersimpan ke tabel `user`.
- **Nama ISP (`ispName`), Zona Waktu (`timezone`), Refresh Interval (`refreshInterval`):**
  - Disimpan ke `localStorage["noc_app_settings"]` saat tombol *"Simpan Perubahan"* diklik.
  - Tidak ada modul visual, grafik, PDF/ekspor, atau background poller yang membaca nilai ini.

### Tab 2: Alarm & Bot (`alerts`)
- **Volume & Suara:**
  - Field `alertSoundEnabled`, `alertSoundSeverity`, dan `alertVolume` hanya tersimpan di `localStorage["noc_app_settings"]`.
  - Mesin audio aktif (`src/lib/dashboard/sound-engine.ts`) menggunakan key `localStorage` terpisah (`"alertSound"`) dan tidak mengenal volume atau filter severity dari tab ini.
- **Telegram (`telegramBotToken`, `telegramChatId`):**
  - Tidak ada implementasi bot Telegram di seluruh repository (baik di Next.js maupun Go).
  - Tombol *"Uji Kirim Telegram"* (`handleTestTelegram`) hanya menjalankan `setTestSent("telegram")` dengan `setTimeout` 3,5 detik, lalu memunculkan banner sukses palsu.
- **Webhook WhatsApp:**
  - `waWebhookUrl` dan `waAdminPhone` tersimpan di `localStorage` tanpa pemanggil jaringan. Tombol uji juga hanya simulasi `setTimeout`.

### Tab 3: WhatsApp (`whatsapp` / `WhatsappSettings`)
- **Penyimpanan:**
  - Dikelola oleh `src/lib/dashboard/whatsapp-registry.ts`.
  - Disimpan ke `localStorage["whatsappConfig"]` dengan teks pengakuan di UI: *"Disimpan di peramban ini saja (data tiruan)"*.
  - Token API disimpan dalam bentuk teks polos (plain-text) di browser.
- **Uji Kirim:**
  - Memanggil `sendMockWhatsappAlert` (`src/lib/dashboard/whatsapp.ts`), menunggu 400 ms, lalu menulis log status `"delivered"` ke `localStorage`. Tidak ada paket HTTP keluar.
- **Diskoneksi Arsitektur:**
  - Sistem memiliki tabel database nyata: `whatsapp_recipients` dan `whatsapp_logs` (`src/db/schema/whatsapp.ts`).
  - Sistem memiliki service nyata: `src/services/whatsapp.service.ts` dan gateway `src/lib/dashboard/whatsapp-gateway.ts` (mendukung Fonnte, Wablas, custom JSON) dengan rute `/api/whatsapp/send`.
  - Komponen Pengaturan tidak pernah memanggil API tersebut.

### Tab 4: Ambang Batas (`thresholds` / `ThresholdSettings`)
- **Penyimpanan:**
  - Tersambung langsung ke database PostgreSQL melalui `GET`, `PUT`, `DELETE` `/api/thresholds`.
  - Data disimpan di tabel `alert_thresholds` dengan proteksi izin `threshold:manage` dan pencatatan riwayat di `audit_log`.
- **Pemanfaatan di Runtime:**
  - Rule engine Go membaca tabel ini pada saat startup (`backend/cmd/server/main.go` -> `engine.LoadThresholdsFromDB`).
  - **Catatan operasional:** Belum ada mekanisme *hot-reload*. Backend Go harus di-restart agar ambang batas baru mulai dievaluasi.
  - Aturan port error (`PortRule`) sudah dievaluasi oleh Go dari kenaikan `rx-error`/`tx-error` antarmuka fisik; antarmuka virtual diabaikan. Sama seperti ambang lain, perubahan baru berlaku setelah backend di-restart.

### Tab 5: Perangkat (`devices` / `DeviceQuickCards`)
- **Daftar Perangkat:**
  - Menggunakan konstanta `MOCK_DEVICE_CONFIGS` (`src/lib/dashboard/device-config.ts`).
  - Daftar kartu, IP, dan status hidup hanya berada di state React (`useState`).
- **Tombol Uji Koneksi:**
  - Mengirim request ke `POST /api/devices/test`.
  - Secara default payload mengirimkan `mode: "simulator"` dan IP fiktif `10.10.0.1`.
  - Backend `device-connection-tester.ts` mendeteksi mode simulator dan mengembalikan data rekaan (`SIM_LATENCY` dan `SIM_DATA`).
- **Hubungan dengan Environment Mode:**
  - Backend memiliki probe jaringan TCP/HTTP/Telnet nyata melalui `runDeviceConnectionTest`.
  - Bila mode tidak dikirim di body, mode ditentukan oleh `getDeviceMode(type)` dari `mode-switch.service.ts`.
  - Mesin ini memeriksa variabel env per-perangkat: `MIKROTIK_MODE`, `OLT_MODE`, `GENIEACS_MODE`, `BILLING_MODE`.
  - **Penting:** Saklar per-perangkat di environment ini terpisah dari saklar mode global UI (`/api/settings/mode`).

### Tab 6: Kolektor & Hub Go (`collector`)
- **WebSocket Hub:**
  - Input `wsHubUrl` (default `ws://localhost:8080/ws`) disimpan di `localStorage` dan diabaikan.
  - Klien websocket tiket mendapatkan alamat hub dari rute `/api/realtime/ticket`, yang mengambil nilai dari env server `BACKEND_URL`.
- **Parameter Kolektor:**
  - `mikrotikTimeoutMs` dan `healthcheckIntervalSec` tidak dibaca oleh kolektor Go. Backend Go menggunakan file konfigurasi internal statis berbasis environment variables (`BACKEND_ADDR`, `DATABASE_URL`, dll.).

### Tab 7: Billing (`billing`)
- **Kondisi Form:**
  - Input `billingApiUrl`, `billingSyncSchedule`, `autoIsolirMikrotik`, dan `gracePeriodHours` hanya tersimpan di `localStorage`.
- **Kondisi Backend:**
  - Integrasi billing aktif ditangani oleh Go poller dan service `customer-isolir.ts` / RunsNet database.
  - Kredensial billing sesungguhnya diatur via tabel `billing_credentials` atau variabel lingkungan `BILLING_URL`/`BILLING_USERNAME`/`BILLING_PASSWORD`.

### Tab 8: Panduan Koneksi (`guide`)
- Teks panduan konfigurasi MikroTik dan OLT bersifat statis dan dapat disalin ke clipboard.
- Tombol *"Uji Konektivitas Semua Node"* (`handleRunDiagnostics`) hanya melakukan jeda 1600 ms menggunakan `setTimeout` lalu mencetak teks statis:
  `"Sukses! 4 Router MikroTik dan 2 OLT merespons REST API dan SNMP dengan latensi rata-rata 12ms."`

---

## 3. Masalah Desain & Keamanan

1. **Pemberitahuan Simpan yang Menyesatkan (Misleading UI):**
   - Tombol utama *"Simpan Perubahan"* memunculkan notifikasi hijau bahwa pengaturan telah diterapkan ke seluruh aplikasi. Pada kenyataannya, hanya toggle mode data yang dikirim ke server.
2. **Tombol Uji Fake Success:**
   - Tombol tes Telegram, tes WA (tab Alarm), dan tes Diagnosa Node menampilkan status sukses tanpa ada koneksi jaringan keluar. Hal ini berisiko membuat operator berasumsi sistem alarm sudah aktif.
3. **Penyimpanan Rahasia di Sisi Klien:**
   - Token bot Telegram, API key WhatsApp, URL webhook, dan nomor telepon admin disimpan plain-text di `localStorage` browser.

---

## 4. Rekomendasi Roadmap Integrasi

1. **Integrasi WhatsApp:**
   - Hapus `whatsapp-registry.ts` berbasis `localStorage`.
   - Sambungkan UI WhatsApp ke API yang sudah ada: `/api/whatsapp/recipients` dan `/api/whatsapp/send`.
   - Simpan API Key gateway di tabel database (terenkripsi) atau env server, bukan di browser.
2. **Koreksi Tombol Tes Perangkat:**
   - Hubungkan kartu perangkat ke data riil tabel `routers` dan `olts` di PostgreSQL, bukan `MOCK_DEVICE_CONFIGS`.
   - Berikan indikator visual yang jelas apakah tes sedang berjalan dalam mode simulator atau probe jaringan nyata.
3. **Pembersihan Form Dummy:**
   - Nonaktifkan atau sembunyikan input yang belum memiliki backend (Telegram, timeout kolektor, URL billing) untuk menghindari kebingungan operator.
   - Hapus fake success pada tombol uji yang belum terhubung ke API.
