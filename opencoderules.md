# OPENCODE & MULTI-AGENT EXECUTION RULES
Repository: NOC-APP (NOC SYSTEM)

> **ATURAN MUTLAK**: File ini wajib dibaca dan dipatuhi oleh agent sebelum mengeksekusi instruksi atau task apa pun.

---

## 1. Pembagian Peran Multi-Agent (Routing Model)
* **Model 1: Explorer & Analyst (`9router/combo2` = Gemini Flash, via Subagent `explore`, param `model: "9router/combo2"`)**
  - **Tugas**: Membaca file mentah berukuran besar, dokumen PRD, arsitektur codebase, dan menganalisis log error terminal.
  - **Isolasi Konteks**: Dijalankan di child session (`subagent`) agar context window sesi utama tidak membengkak dan token tidak habis.
  - **Output**: Hanya mengirimkan ringkasan padat (10–20 baris) atau instruksi perbaikan teknis ke sesi utama.
* **Model 2: Builder & Executor (Claude Sonnet / Main Session)**
  - **Tugas**: Melakukan penulisan kode presisi, refactoring, eksekusi command, dan commit.
  - **LARANGAN KERAS**: Dilarang membaca file mentah besar langsung di sesi utama.
  - Menerima konteks matang yang sudah disaring dari Gemini Flash.

---

## 2. Alur Estafet Kerja (Siklus 1 Task = 1 Agent)
Setiap task NgodingPakeAI dikerjakan dalam satu siklus sekuensial (estafet, BUKAN paralel sembarangan):
1. **Fase BACA (Gemini Flash)**:
   - Ambil task dari NgodingPakeAI.
   - Pindai file terkait dan PRD via subagent.
   - Buat ringkasan rencana perubahan singkat.
2. **Fase EKSEKUSI (Claude Sonnet)**:
   - Tulis/edit kode dengan perubahan minimal (YAGNI).
   - Simpan file.
3. **Fase VALIDASI & ERROR (Gemini Flash + Claude Sonnet)**:
   - Jalankan `npm run typecheck` atau tes terkait.
   - Jika ada error: Gemini Flash membaca log error dan memberikan saran perbaikan -> Claude Sonnet mengeksekusi perbaikan.
4. **Fase SELESAI**:
   - Jalankan `npx ngodingpakeai task complete <ref>`.

---

## 3. Konfigurasi 9router
* Gunakan mode **Fallback — try in order** pada 9router.
* 9router berfungsi sebagai router kestabilan koneksi, BUKAN pembagi tugas fungsional.
* Pembagian kerja teknis (Flash baca vs Sonnet tulis) dikendalikan sepenuhnya oleh orchestrator agent di harness Antigravity.

---

## 4. Disiplin Task NgodingPakeAI
* Wajib patuh pada alur kerja resmi NgodingPakeAI (`npx ngodingpakeai task next --plan <planId>`).
* **Satu task per putaran**:
  - `task start <ref>` sebelum bekerja.
  - Kerjakan hanya ruang lingkup task tersebut (no scope creep).
  - `task complete <ref>` setelah lolos typecheck & verifikasi.
* **Checkpoint Gate**: Jika layer berubah (frontend -> backend) atau `phase.current` bertambah, agent wajib BERHENTI dan melapor ke user untuk verifikasi manual sebelum lanjut.

---

## 5. Responsivitas Chat User
* **Prioritas Utama**: Setiap kali user mengirim pesan, agent WAJIB langsung membaca dan merespons pesan user.
* Dilarang menahan atau mengabaikan chat user hanya karena sedang menunggu task selesai.

---

## 6. Integrasi MCP Graphify (Knowledge Graph)
* Manfaatkan tool `graphify` (`query_graph`, `graphify_node`, `recall`) untuk memetakan dependensi sebelum merombak modul besar.
* Simpan keputusan arsitektural permanen ke memori Graphify via `remember`.

---

## 7. Format CLI Status Dashboard
Setiap kali melaporkan status, tampilkan panel ringkas:
```text
[ACTIVE AGENTS]
- Builder (Claude Sonnet): [STATUS]
- Explorer (Gemini Flash): [STATUS]

[PROCESSES]
- Web Server : [PORT/STATUS]
- Database   : [PORT/STATUS]

[TASK PIPELINE]
- Current Task : [NAMA TASK]
- Phase/Layer  : [PHASE / LAYER]
- Status       : [RUNNING / DONE]
```
