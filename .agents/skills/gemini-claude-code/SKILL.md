---
name: gemini-claude-code
description: "Metodologi rekayasa perangkat lunak gabungan Gemini & Claude Code: penalaran mendalam (deep reasoning), investigasi akar masalah (root cause analysis), disiplin task-loop tanpa rembetan, gerbang verifikasi pengujian mandiri sebelum klaim selesai, pencegahan data dummy (zero-dummy), dan sinkronisasi kontainer Docker secara deterministik."
---

# Skill: Gemini & Claude Code (Unified Engineering Standard)

Standar rekayasa perangkat lunak terpadu yang menggabungkan kemampuan **analisis & penalaran mendalam Gemini** dengan **disiplin eksekusi task tanpa kompromi Claude Code**. Skill ini dirancang untuk memastikan setiap pekerjaan diselesaikan secara tuntas, presisi, berbasis data, dan terverifikasi secara nyata tanpa tambal-sulam asal-asalan.

---

## 1. Prinsip Utama: Anti Asal-Asalan (Root-Cause Analysis)

1. **Investigasi Akar Masalah, Bukan Menambal Gejala**:
   - Jangan pernah menyimpulkan penyebab galat sebelum membaca kode sumber terkait, memeriksa pesan error lengkap, dan menelusuri alur log.
   - Contoh nyata di proyek ini: Saat koneksi OLT gagal dengan HTTP 404, jangan sekadar menambahkan mock atau ganti URL; telusuri protokol fisiknya hingga terbukti perangkat menggunakan Telnet CLI port 2323 tanpa web JSON API sama sekali.
2. **Defensive & Strict Engineering**:
   - Selalu perhitungkan *edge cases*: negosiasi protokol gantung (misal IAC Telnet), timeout jaringan, sesi tersangkut (*single-session lockout* pada web server ONT), nilai numerik ekstrem (`-inf`, `NaN`), dan sanitasi input via validator Zod.
   - Jangan pernah membungkus error dengan `try/catch` kosong atau menyembunyikan kegagalan secara diam-diam.

---

## 2. Disiplin Task-Loop & Batasan Lingkup (Surgical Scope)

1. **Fokus Tunggal pada Task Aktif**:
   - Selesaikan hanya apa yang diminta. Jangan melakukan refactor liar pada berkas yang tidak relevan.
   - Perubahan kode harus minimal, presisi, dan terarah (*surgical edits*).
2. **Hormati Batas Berkas Pengguna (*File Ownership Protection*)**:
   - Berkas yang sedang aktif dikerjakan di sesi pengguna (seperti `src/components/dashboard/customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tidak boleh diubah kecuali ada instruksi langsung dari pengguna.
3. **Checkpoint Antar-Layer & Antar-Fase**:
   - Setiap terjadi transisi fase atau pergantian layer besar (misalnya dari tampilan UI mock ke integrasi backend Go/MikroTik nyata), hentikan sejenak, laporkan status, dan minta konfirmasi `"lanjut"`.

---

## 3. Gerbang Verifikasi Sebelum Melapor (Evidence Before Assertions)

Sebelum menyatakan bahwa suatu pekerjaan, perbaikan, atau fitur telah selesai, **wajib** menjalankan seluruh gerbang verifikasi mandiri dan memeriksa hasilnya secara objektif:

```bash
# 1. Pastikan tidak ada kesalahan tipe TypeScript
npm run typecheck

# 2. Pastikan kode bersih dan lolos linter (tidak menambah galat dari baseline)
npx eslint <berkas-yang-diubah>

# 3. Jalankan pengujian unit terarah & e2e terkait
node --test tests/<spesifikasi-terkait>.test.mjs

# 4. Verifikasi kompilasi kontainer aplikasi
docker compose build app
```

> **Hukum Integritas**: Dilarang membuat klaim sukses ("Sudah diperbaiki", "Semua tes lolos") tanpa melampirkan bukti keluaran nyata dari perintah terminal.

---

## 4. Prinsip Zero-Dummy & Kejujuran Data Telemetri

1. **Transparansi Status**:
   - Pengguna menuntut telemetri jaringan yang akurat. Jika suatu data belum tersambung ke perangkat fisik atau backend Go, komponen **wajib** diberi label/badge tiruan (*mock badge*) yang jelas.
2. **Keamanan Rahasia & Kredensial**:
   - Jangan pernah menyimpan kredensial router, community SNMP, atau token bot WhatsApp ke dalam *localStorage* peramban.
   - Gunakan sesi terautentikasi dan izin berbasis peran (`withApiPermission`).

---

## 5. Sinkronisasi Siklus Runtime Docker

1. **Host vs Container Synchronization**:
   - Karena aplikasi berjalan di dalam container Docker (`compose.yaml`), mengedit kode di host **tidak otomatis terlihat** di browser sebelum container di-build dan di-restart:
     ```bash
     docker compose build app && docker compose up -d --no-deps app
     ```
2. **Pemetaan URL Jaringan**:
   - Bedakan `BACKEND_INTERNAL_URL` (panggilan server-ke-server antar kontainer di jaringan Compose, misal `http://backend:8080`) dengan `BACKEND_URL` (alamat yang dikirim ke browser pengguna, misal `http://localhost:8080`).

---

## 6. Gaya Komunikasi & Efisiensi Token (Smart Caveman / No Fluff)

1. **Bahasa Indonesia Lugas & To-The-Point**:
   - Gunakan pola: `[Masalah] -> [Solusi Teknis & Rationale] -> [Hasil/Verifikasi]`.
   - Hindari pembuka berbelit-belit, basa-basi permohonan maaf, atau pengulangan panjang yang memboroskan konteks prompt.
2. **Pencatatan Dokumentasi Terpusat**:
   - Setiap hasil prompt, pengujian, dan keputusan teknis dicatat secara rapi ke dalam berkas markdown di folder `report-agy/`.

---

## 7. Irama Interaksi & Eksekusi Lapangan (Claude Code Cadence)

1. **Live Step Update (1–2 Kalimat Padat)**:
   - Setiap transisi langkah eksekusi, laporkan 1–2 kalimat berisi temuan riil dan tindakan langsung berikutnya (contoh: *"WAN TR-069 dibuat di F609... Sekarang cek lease DHCP dan sesi PPPoE..."*).
2. **Keterbukaan Output Telemetri Lapangan**:
   - Sertakan cuplikan data nyata dari output terminal/perangkat: alamat IP manajemen, uptime sesi PPPoE pelanggan, status kontainer, atau nilai parser.
3. **Network Safety First (Zero Disturbance)**:
   - Jangan pernah memutus atau mengganggu sesi PPPoE pelanggan saat merekonfigurasi perangkat fisik, OLT CLI, atau merestart daemon backend.
4. **Eksekusi Mandiri & Siklus Tuntas**:
   - Tidak menunggu izin untuk pengujian atau kompilasi teknis rutin; telusuri akar masalah, perbaiki, uji, bangun kontainer, dan simpan catatan teknis.

---

## 8. Format Standar Dashboard Status CLI (Live HUD Ala Claude Code)

Untuk transparansi operasional dan akuntabilitas agen tanpa memboroskan ruang, tampilkan HUD 1–2 baris bergaya Claude Code di awal respon:

```text
[CAVEMAN] Gemini 3.8 Flash [high] think ctx:~28% | NOC SYSTEM | ponytail:on | context7:ready
>> Task: <Judul Task Yang Sedang Dikerjakan>
```

---

## 9. Protokol Anti-Bug UI & Integritas Elemen Interaktif (Zero Broken Buttons)

1. **Audit Total Tombol & Input**:
   - Setiap elemen tombol non-submit wajib memiliki atribut eksplisit `type="button"`.
   - Dilarang membuat handler tiruan kosong (`onClick={() => {}}`).
   - Setiap aksi asinkron pada tombol wajib menggunakan blok `finally { setLoading(false) }` agar tombol tidak pernah terkunci mati (*deadlock* di status disabled) saat terjadi kegagalan jaringan atau API.
   - Setiap aksi mutasi wajib menyertakan umpan balik visual nyata ke pengguna (Toast notifikasi / pesan error merah / penutupan dialog).
2. **Proteksi Penumpukan CSS & Pointer-Events**:
   - Saat menambahkan layer, card, dialog, atau komponen di atas peta Leaflet / kanvas, periksa tuntas `z-index` dan `pointer-events`.
   - Kontainer pembungkus dekoratif wajib menggunakan `pointer-events-none` dan hanya tombol/kontrol aktif yang memakai `pointer-events-auto` agar event klik tidak terhalang.
3. **Preservasi Regresi Tampilan**:
   - Saat meredesain komponen, dilarang membuang fungsi interaktif, ukuran target sentuh (*touch target*), atau atribut aksesibilitas yang sudah ada sebelumnya.

---

## 10. Mandat Ponytail, React Best Practices & Context7

1. **Ponytail Mode (YAGNI & Anti-Bloat)**: Bangun kode paling minimal yang bekerja tuntas. Jangan membuat boilerplate atau abstraksi yang tidak diminta.
2. **React Best Practices**: Audit interaktivitas komponen, hindari rerender berlebih, dan gunakan pola lifecycle yang aman.
3. **Dokumentasi Wajib Context7**: Setiap penggunaan API, SDK, pustaka pihak ketiga, atau konfigurasi framework (Next.js, Tailwind, Drizzle, dll.) wajib merujuk dokumentasi resmi via Context7 (`@upstash/context7-mcp`).




