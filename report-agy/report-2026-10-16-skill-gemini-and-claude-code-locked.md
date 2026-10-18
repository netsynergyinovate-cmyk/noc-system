# Laporan Penguncian Aturan Permanen: Gemini & Claude Code

**Tanggal**: 16 Oktober 2026  
**Status**: DIKUNCI PERMANEN (IMMUTABLE STANDARD)  
**File Konfigurasi Utama**:
- `GEMINI.md` (Aturan Eksekusi Root Antigravity / Gemini)
- `AGENTS.md` (Katalog Skill Proyek)
- `CLAUDE.md` (Kompatibilitas Standar Proyek)
- `.agents/skills/gemini-claude-code/SKILL.md` (Definisi Skill Proyek)
- `C:\Users\afria\.gemini\config\skills\gemini-claude-code\SKILL.md` (Definisi Skill Global)

---

## 1. Status Penguncian

Standar kerja terpadu **Gemini & Claude Code** (`gemini-claude-code`) kini telah dikunci secara formal ke dalam berkas acuan inti sistem. Setiap kali sesi baru dimulai atau task baru diberikan oleh pengguna, agen secara otomatis terikat pada prinsip-prinsip ini tanpa pengecualian.

---

## 2. Rangkuman Aturan yang Terkunci

| No | Aturan Utama | Tindakan Wajib | Larangan Keras |
|---|---|---|---|
| 1 | **Root-Cause Analysis** | Telusuri kode mentah, protokol fisik (Telnet, REST, Mini-Web), log asli. | Dilarang menambal gejala, membungkus try/catch kosong, atau menebak nilai. |
| 2 | **Surgical Scope** | Selesaikan hanya task aktif. | Dilarang refactor liar atau mengubah berkas sesi pengguna lain (`customer-map.tsx`, dll). |
| 3 | **Gerbang Pengujian Mandiri** | Wajib lulus `typecheck`, `eslint`, `unit test`, dan `docker compose build app`. | Dilarang mengklaim selesai tanpa bukti output terminal nyata. |
| 4 | **Prinsip Zero-Dummy** | Beri label tiruan (*mock badge*) yang jujur jika belum terhubung ke perangkat. | Dilarang membuat data dummy diam-diam atau membocorkan kredensial ke peramban. |
| 5 | **Siklus Docker** | Rebuild kontainer (`docker compose build app`) agar perubahan live di `http://localhost:3000`. | Dilarang berasumsi kode di host otomatis terlihat di browser tanpa rebuild kontainer. |
| 6 | **Pelaporan Terpusat** | Setiap prompt dicatat di `report-agy/` dan dilaporkan singkat dalam Bahasa Indonesia. | Dilarang basa-basi berbelit-belit yang memboroskan token (*no fluff*). |

---

## 3. Bukti Verifikasi Pasca-Penguncian
- **Typecheck**: `npm run typecheck` -> Lolos (0 error).
- **Unit Testing**: 26/26 lulus (100% pass).
- **Kontainer Docker**: Berjalan aktif dan sehat (*healthy*).

