# Laporan Rekayasa: Penguncian Memori Integritas UI & Standar Anti-Bug (Claude Code)

Tanggal: 18 Oktober 2026  
Status: Terkunci Permanen di 3 Lapisan Memori

---

## 1. Latar Belakang & Identifikasi Akar Masalah
Instruksi pengguna menuntut penghentian kebiasaan buruk yang sering menghasilkan bug fungsionalitas UI (misalnya tombol tidak merespons klik, form me-refresh halaman liar, atau regresi tampilan).

Akar masalah riil yang diidentifikasi dari riwayat git dan eksekusi test:
1. **Dead Handlers**: Tombol dibuat secara visual tanpa event binding riil atau fungsi kosong.
2. **State Deadlock**: `disabled={loading}` tanpa proteksi `finally { setLoading(false) }`, menyebabkan tombol terkunci mati permanen jika fetch gagal.
3. **Layering & Pointer-Events**: Layering Leaflet canvas, dialog, atau backdrop menutupi tombol tanpa konfigurasi `pointer-events: none` pada elemen pembungkus dekoratif.
4. **Form Reload Collision**: Button di dalam form tidak diberi `type="button"`, memicu submit liar bawaan peramban.
5. **Kurangnya Uji Terminal Nyata**: Redesain komponen (seperti pada commit `1cc5d12`) merusak touch-target tombol dan lebar responsif tablet karena tidak memverifikasi test suite `small-screen-touch-typography` dan `tablet-responsive-layout`.

---

## 2. Implementasi Penguncian Memori (3 Lapisan)

### Lapisan 1: Global Rules Antigravity CLI
Berkas: `C:\Users\afria\.gemini\config\rules\ui-interaction-integrity.md`
- Berlaku otomatis di semua workspace dan sesi baru.
- Menegakkan kewajiban deklarasi `type="button"`, proteksi `finally`, pemeriksaan pointer-events, dan larangan klaim sukses tanpa bukti terminal.

### Lapisan 2: Aturan Permanen Workspace (Project Immutable Rules)
Berkas: `E:\NOC SYSTEM\GEMINI.md`
- Ditambahkan **Bab 9: Protokol Anti-Bug UI & Integritas Elemen Interaktif (Zero Broken Buttons)**.
- Menjadi acuan mutlak pada setiap session start di repositori ini.

### Lapisan 3: Standard Rekayasa Skill Terpadu
Berkas: `E:\NOC SYSTEM\.agents\skills\gemini-claude-code\SKILL.md`
- Ditambahkan **Bab 9: Protokol Anti-Bug UI & Integritas Elemen Interaktif (Zero Broken Buttons)**.
- Menyediakan pedoman audit elemen interaktif dan pencegahan regresi.

---

## 3. Hasil Verifikasi Terminal
- `npm run typecheck`: 0 TypeScript error (100% Pass).
- Kompilasi berkas: Lolos tanpa konflik sintaks.
