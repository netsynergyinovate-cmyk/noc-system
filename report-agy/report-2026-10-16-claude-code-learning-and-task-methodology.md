# Laporan Pembelajaran: Metodologi & Alur Kerja Claude Code pada Proyek NOC System

**Tanggal**: 16 Oktober 2026  
**Sumber Analisis**: 
- `C:\Users\afria\.claude\projects\e--NOC-SYSTEM\memory\` (`MEMORY.md`, `noc-task-loop.md`, `noc-phase5-frontend-rules.md`, `noc-live-setup.md`, `noc-ontweb-lessons.md`, `noc-graphify.md`, `noc-genieacs.md`)
- `C:\Users\afria\.claude\history.jsonl`
- Log Git commit repositori `e:\NOC SYSTEM`

---

## 1. Ringkasan Eksekutif

Berdasarkan penelusuran riwayat sesi, berkas memori (`.claude/memory`), dan jejak interaksi pada proyek `E:\NOC SYSTEM`, Claude Code bekerja menggunakan kerangka kerja eksekusi tugas bertahap yang sangat terstruktur, disiplin tinggi, hemat token, dan berorientasi pada verifikasi mandiri sebelum melapor ke pengguna.

---

## 2. Lima Pilar Alur Kerja Claude Code yang Dipelajari

### A. Disiplin Task Loop & Batasan Lingkup (*Surgical Task Focus*)
- **Satu Task dalam Satu Waktu**: Hanya mengerjakan task yang sedang aktif (`task next`), tidak merembet ke berkas atau modul di luar instruksi task tersebut.
- **Perlindungan Berkas Pengguna (*File Boundary*)**: Tidak pernah mengubah berkas milik sesi pengguna lain (seperti komponen peta `customer-map`, `settings-board`, atau berkas konfigurasi sensitif) kecuali diinstruksikan secara eksplisit.
- **Checkpoint Bertahap**: Berhenti dan menunggu konfirmasi `"lanjut"` dari pengguna setiap kali terjadi pergantian fase atau transisi layer (misalnya dari frontend mock ke backend nyata).

### B. Gerbang Verifikasi Mandiri Sebelum Melapor (*Self-Gated Testing*)
Claude Code tidak pernah menyatakan pekerjaan selesai hanya dari perkiraan kode. Setiap task wajib melewati gerbang kualitas:
1. `npm run lint` — memastikan tidak menambah galat baru dari baseline yang ada.
2. `npm run typecheck` — 0 TypeScript error.
3. `npm test` — menjalankan unit test terarah dan e2e yang relevan.
4. `npm run build` / `docker compose build app` — memastikan kompilasi lulus tanpa kegagalan bundler.

### C. Efisiensi Token & Knowledge Graph (*Graphify & Caveman Mode*)
- **Pemanfaatan `graphify`**: Menggunakan query graf AST (`graphify query`, `graphify path`, `graphify explain`) untuk memahami relasi fungsi dan komponen tanpa perlu membaca ulang puluhan berkas teks secara penuh.
- **Gaya Komunikasi Lugas (*No Fluff*)**: Bahasa Indonesia yang ringkas, teknis, to-the-point, menghilangkan basa-basi pembuka/penutup agar konteks prompt tetap awet dan hemat token.

### D. Transparansi Penuh: Data Nyata vs Data Tiruan (*Zero Silent Dummy*)
- **Larangan Dummy Diam-Diam**: Pengguna sangat menekankan keandalan data jaringan MikroTik/OLT nyata.
- Apabila suatu fitur belum tersambung ke perangkat fisik atau backend Go, komponen **wajib** diberi label/badge tiruan (*mock badge*) yang jelas, dan tidak boleh menyimpan kredensial/token bot secara sembarangan di penyimpanan lokal peramban.

### E. Integrasi Siklus Docker & GitHub Resmi
- **Sinkronisasi Kontainer**: Perubahan di host tidak otomatis terlihat di peramban sebelum kontainer `app` dan `backend` di-build ulang (`docker compose build app backend` lalu recreate).
- **Akun GitHub & Registry yang Sah**: Seluruh commit dan push diarahkan ke organisasi `netsynergyinovate-cmyk/noc-system` dengan image GHCR `ghcr.io/netsynergyinovate-cmyk/noc-system`, bukan akun pribadi.

---

## 3. Komitmen Standar Kerja untuk Sesi Ini

Mengadopsi seluruh prinsip di atas secara konsisten:
1. Menjaga komunikasi dalam Bahasa Indonesia yang padat dan akurat.
2. Setiap modifikasi fitur langsung diuji dengan unit test + typecheck.
3. Melakukan rebuild Docker container agar perubahan live langsung terkonfirmasi di `http://localhost:3000`.
4. Menyimpan rekapitulasi setiap pekerjaan di folder `report-agy/`.

