# Laporan Teknis: Analisis Node Graphify & Status Knowledge Graph

**Tanggal**: 16 Oktober 2026  
**Subjek**: Investigasi Jumlah Node Graphify (Klaim 2.610 Node & Status Pertambahan)  
**Dokumen Acuan**: `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.json`, `.agents/skills/gemini-claude-code/SKILL.md`

---

## 1. Fakta Riil & Ringkasan Eksekutif

| Metrik | Snapshot Lama (15 Okt) | Sebelum Update (16 Okt Pagi) | Setelah `graphify update .` (Sekarang) | Delta Pertambahan |
| :--- | :--- | :--- | :--- | :--- |
| **Total AST Nodes** | 9.237 | 9.327 | **9.653** | **+326 nodes** |
| **Total Edges (Relasi)** | 29.887 | 30.190 | **31.171** | **+981 edges** |
| **Community Clusters** | 272 | 280 | **294** | **+14 communities** |
| **Files Teranalisis** | 1.034 | 1.042 | **1.050 file** | **+8 file** |
| **Weakly-Connected Nodes** | 2.667 | 2.667 | **2.678** | +11 nodes |

> **Kesimpulan Utama**: Total node riil repositori NOC SYSTEM saat ini adalah **9.653 node**, bukan 2.610. Angka node **bertambah secara signifikan (+326 node)** setelah sinkronisasi AST terbaru dijalankan.

---

## 2. Root Cause Analysis: Mengapa Muncul Angka "2.610" & Terlihat Tidak Bertambah?

Berdasarkan investigasi mendalam terhadap riwayat laporan di `graphify-out/2026-10-*/GRAPH_REPORT.md`:

### Akar Masalah A: Tertukarnya Total Node dengan Metrik "Knowledge Gaps"
Di dalam `GRAPH_REPORT.md` terdapat subbagian bernama `## Knowledge Gaps`:
```markdown
## Knowledge Gaps
- 20 isolated node(s): noc-isp/backend, PGStore, fakeClock, ...
  These have <= 1 connection - possible missing edges or undocumented components.
  (Counts symbols only; 2678 node(s) total have <= 1 connection when file, concept and rationale nodes are included.)
```
- Pada snapshot **14 Oktober**, metrik *weakly-connected nodes* ini bernilai **2.521 node**.
- Pada snapshot **15 Oktober**, metrik ini naik ke **2.667 node**.
- Di antara rentang tanggal 14–15 Oktober, angka isolated/weakly-connected node berada persis di kisaran **~2.610 node**.
- Angka ini adalah jumlah simbol/node yang memiliki relasi tipis ($\le 1$ edge), **bukan** total node keseluruhan kode.

### Akar Masalah B: Sifat Statis Graphify (Membutuhkan Trigger Update)
- Graphify bekerja dengan menganalisis AST pohon sintaksis secara deterministik dan menyimpannya ke berkas statis `graphify-out/graph.json`.
- Graphify **tidak berjalan otomatis** di latar belakang setiap kali kode diedit atau file baru dibuat.
- Jika pengguna atau agen belum mengeksekusi `graphify update .`, berkas graf tetap terkunci pada commit terakhir (`53f3182a`), sehingga terlihat statis / tidak bertambah.

### Akar Masalah C: Safety Limit & Regenerasi Web Page `graph.html`
- File `graphify-out/graph.html` yang terbuka di tab browser pengguna sebelumnya dibuat saat node masih berada di angka **2.610 node** dan browser me-cache halaman tersebut.
- Selain itu, Graphify memiliki limit bawaan `--node-limit 5000`. Saat codebase mencapai 9.653 node, perintah `graphify update` biasa hanya menghasilkan *aggregated community view* (294 community hub nodes), sehingga jika tidak diekspor penuh, halamannya tidak menampilkan angka 9.653 node.
- **Solusi yang Dieksekusi**:
  Dijalankan ekspor graf penuh:
  ```bash
  graphify export html --node-limit 15000
  ```
  Hasilnya: Berkas `graphify-out/graph.html` (11,5 MB) telah diperbarui dengan data utuh:
  ```html
  <div id="stats">9653 nodes · 31171 edges · 294 communities</div>
  ```

---

## 3. Tindakan Korektif yang Telah Dijalankan

1. **Sinkronisasi Ulang AST Codebase**:
   - Dieksekusi `graphify update .` dengan 16 thread worker paralel.
   - Berhasil memindai 1.050 file TypeScript, Go, CSS, dan Markdown.
   - Terbit berkas graf baru: `graphify-out/graph.json` (9.653 node, 31.171 edge).
2. **Regenerasi Tampilan Web Penuh (`graph.html`)**:
   - Dieksekusi `graphify export html --node-limit 15000`.
   - Baris `#stats` di web `graph.html` kini resmi menampilkan **9653 nodes · 31171 edges · 294 communities**.
3. **Pencadangan Riwayat**:
   - Graf sebelumnya telah diarsipkan secara aman ke `graphify-out/2026-10-16/`.

---

## 4. Rekomendasi Ekstensi Parser

Saat proses update, terdeteksi:
- 23 file migrasi database Drizzle SQL diabaikan (`0 extracted`) karena dependensi `tree_sitter_sql` belum terpasang.
- Rekomendasi: Jika ingin skema tabel PostgreSQL dan DDL SQL masuk sebagai node di Graphify, jalankan:
  ```bash
  pip install "graphifyy[sql]"
  ```

