# Standar Rekayasa Terkunci: Gemini & Claude Code

Dokumen ini adalah aturan permanen (*immutable rule*) yang **WAJIB** dijalankan pada setiap awal sesi (*session start*) dan setiap pengerjaan task baru di repositori `NOC SYSTEM`.

Skill acuan: [`.agents/skills/gemini-claude-code/SKILL.md`](.agents/skills/gemini-claude-code/SKILL.md)

---

## 1. Prinsip Utama: Anti Asal-Asalan (Deep Root-Cause Analysis)
- Dilarang keras melakukan tambal-sulam (*quick-fix*) pada gejala permukaan.
- Selalu telusuri akar masalah riil: baca log mentah, periksa batasan protokol fisik (MikroTik REST/Telnet, OLT Telnet CLI, Web-ONT mini web servers, Docker container networking), dan pahami perilakunya sebelum menulis kode.
- Defensive & Strict: Tangani kegagalan timeout, koneksi gantung, sanitasi nilai ekstrem (`-inf`, `NaN`), dan gunakan validator Zod yang ketat.
- Dilarang membungkus error dengan `try/catch` kosong atau menyembunyikan kegagalan secara diam-diam.

## 2. Disiplin Task-Loop & Surgical Scope
- Selesaikan **hanya satu task aktif** secara tuntas tanpa merembet ke modul atau fitur lain.
- **Hormati Batas Berkas Sesi Pengguna**: Jangan pernah memodifikasi berkas yang sedang dikerjakan di sesi pengguna (misal: `src/components/dashboard/customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tanpa instruksi eksplisit dari pengguna.
- Berhenti sejenak (*checkpoint*) untuk konfirmasi setiap ada pergantian layer arsitektur besar.

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)
Sebelum menyatakan suatu pekerjaan selesai atau berhasil, **wajib** mengeksekusi gerbang pengujian mandiri di terminal dan memeriksa hasilnya:
1. `npm run typecheck` — 0 TypeScript error.
2. `npx eslint <files>` — 0 error baru dari baseline.
3. `node --test tests/...` — 100% lulus untuk unit test dan tes integrasi terkait.
4. `docker compose build app` — Kompilasi Docker sukses dan kontainer berjalan sehat.
> **Hukum Integritas**: Dilarang mengklaim sukses tanpa menyertakan bukti keluaran nyata dari perintah pengujian.

## 4. Prinsip Zero-Dummy & Kejujuran Telemetri
- Pengguna menuntut data operasional jaringan riil.
- Dilarang membuat data dummy diam-diam. Jika suatu fitur belum tersambung ke perangkat fisik atau backend Go, komponen **wajib** diberi label/badge tiruan (*mock badge*) yang jelas dan transparan.
- Kredensial rahasia (router, SNMP, bot WhatsApp) tidak boleh disimpan di `localStorage` peramban.

## 5. Sinkronisasi Siklus Runtime Docker
- Mengedit kode di host tidak otomatis terlihat di peramban sebelum kontainer di-build ulang:
  ```bash
  docker compose build app && docker compose up -d --no-deps app
  ```
- Selalu pisahkan `BACKEND_INTERNAL_URL` (`http://backend:8080` antar kontainer) dan `BACKEND_URL` (`http://localhost:8080` untuk browser WebSocket).

## 6. Standar Pelaporan & Efisiensi Token
- Setiap hasil pengerjaan **wajib** didokumentasikan ke dalam folder `report-agy/` dalam format Markdown yang mencatat detail perubahan teknis dan bukti uji.
- Komunikasi dengan pengguna menggunakan Bahasa Indonesia yang padat, teknis, to-the-point (*no fluff* / *smart caveman*).

## 7. Irama Interaksi & Eksekusi Lapangan (Claude Code Cadence)
- **Live Step Update (1–2 Kalimat Padat)**: Setiap pergantian tindakan penting, sampaikan ringkasan fakta teknis yang baru diperoleh dan apa langkah konkret berikutnya tanpa basa-basi (contoh: *"WAN TR-069 dibuat di F609... Sekarang cek lease DHCP dan sesi PPPoE..."*).
- **Transparansi Output Lapangan**: Sertakan potongan kunci dari respons perangkat/terminal (IP lease, uptime sesi PPPoE pelanggan, status container, atau nilai parser).
- **Network Safety First**: Selalu pastikan sesi PPPoE dan konektivitas pelanggan aktif tidak terganggu saat merekonfigurasi perangkat fisik, OLT CLI, atau merestart kontainer daemon backend.
- **Tindakan Mandiri & Siklus Tuntas**: Langsung jalankan investigasi, uji koneksi, build kontainer, verifikasi hasil, dan simpan catatan teknis secara deterministik.

## 8. Standar Dashboard Status CLI (Live HUD Ala Claude Code)
Setiap awal respons pengerjaan atau pergantian task di CLI, **wajib** menyajikan HUD padat dan elegan 1–2 baris bergaya Claude Code:
```text
[CAVEMAN] Gemini 3.8 Flash [high] think ctx:~28% | NOC SYSTEM | ponytail:on | context7:ready
>> Task: <Judul Task Yang Sedang Dikerjakan>
```

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

## 10. Mandat Ponytail, React Best Practices & Context7
1. **Ponytail Mode (YAGNI & Anti-Bloat)**: Bangun kode paling minimal yang bekerja tuntas. Jangan membuat boilerplate atau abstraksi yang tidak diminta.
2. **React Best Practices**: Audit interaktivitas komponen, hindari rerender berlebih, dan gunakan pola lifecycle yang aman.
3. **Dokumentasi Wajib Context7**: Setiap penggunaan API, SDK, pustaka pihak ketiga, atau konfigurasi framework (Next.js, Tailwind, Drizzle, dll.) wajib merujuk dokumentasi resmi via Context7.




