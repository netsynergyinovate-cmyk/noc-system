# Laporan Pembuatan & Pengaktifan Skill: Gemini & Claude Code

**Tanggal**: 16 Oktober 2026  
**Nama Skill**: `gemini-claude-code` ("Gemini & Claude Code")  
**Lokasi Berkas Skill**:
1. `.agents/skills/gemini-claude-code/SKILL.md` (Level Proyek Workspace)
2. `C:\Users\afria\.gemini\config\skills\gemini-claude-code\SKILL.md` (Level Global Gemini / Antigravity)
3. `.claude/skills/gemini-claude-code/SKILL.md` (Kompatibilitas Claude Code)

---

## 1. Tujuan Skill

Mengabadikan standar rekayasa perangkat lunak tertinggi yang memadukan:
- **Analisis & Penalaran Mendalam (Deep Reasoning)**: Investigasi akar masalah teknis riil sebelum menyentuh kode, mitigasi *edge cases*, pencegahan kebocoran data sesi, dan arsitektur defensif.
- **Disiplin Task Claude Code**: Pengerjaan bedah terfokus (*surgical edits*), perlindungan berkas aktif pengguna, gerbang pengujian mandiri sebelum klaim selesai, dan transparansi penuh tanpa data dummy diam-diam.
- **Sinkronisasi Siklus Docker**: Kompilasi kontainer deterministik (`compose build app`) agar perubahan live dapat dibuktikan secara nyata.

---

## 2. Enam Pilar Standar yang Terkunci dalam Skill

1. **Investigasi Akar Masalah (*Root Cause First*)**: Tidak ada tambal-sulam instan/gejala; penelusuran protokol dan log nyata.
2. **Disiplin Batasan Lingkup (*Surgical Scope*)**: Tidak merembet ke modul lain; menjaga berkas sesi pengguna lain.
3. **Gerbang Verifikasi Mandiri (*Evidence Before Claims*)**: Wajib lulus `typecheck`, `eslint`, dan `unit test` sebelum melapor.
4. **Prinsip Zero-Dummy**: Kejujuran telemetri; data tiruan wajib berlabel jelas; rahasia tidak boleh bocor ke penyimpanan browser.
5. **Siklus Runtime Docker**: Sinkronisasi host-to-container terverifikasi dan pemisahan alamat jaringan internal vs browser.
6. **Efisiensi Token & Dokumentasi Terpusat**: Komunikasi to-the-point (*smart caveman* / *no fluff*) dan pencatatan berkas laporan di `report-agy/`.

