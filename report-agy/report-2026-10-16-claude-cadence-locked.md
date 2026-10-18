# Laporan Penguncian Irama Eksekusi Lapangan (Claude Code Cadence)

**Tanggal**: 16 Oktober 2026  
**Subjek**: Penguncian Gaya & Irama Eksekusi Lapangan Claude Code untuk Seluruh Pengerjaan Task  
**Berkas Terkunci**: `GEMINI.md`, `.agents/skills/gemini-claude-code/SKILL.md`, `.claude/skills/gemini-claude-code/SKILL.md`

---

## 1. Analisis Tangkapan Layar Claude Code (`media_1792122440617_58d412ba.png`)

Berdasarkan bukti tangkapan layar sesi Claude Code yang diunggah pengguna:
- **Pola Komunikasi**: 1–2 kalimat update padat sebelum/setelah aksi alat.
- **Transparansi Output**: Menampilkan potongan data nyata (sesi PPPoE `172.16.15.205`, IP lease DHCP, status start kontainer `nocsystem-backend-1`).
- **Prinsip Keselamatan Jaringan**: Layanan PPPoE pelanggan dijaga agar tidak terputus saat merestart daemon/kontainer.
- **Siklus Tertutup**: Eksekusi perintah -> Validasi output -> Simpan *lessons* ke memori/laporan.

---

## 2. Pasal Terkunci: Pasal 7 (Claude Code Cadence)

1. **Live Step Update (1–2 Kalimat Padat)**:
   Setiap transisi langkah, laporkan secara langsung fakta teknis yang diperoleh dan tindakan konkret berikutnya tanpa kalimat pembuka yang bertele-tele.
2. **Keterbukaan Telemetri Lapangan**:
   Sertakan potongan kunci output terminal/perangkat (IP manajemen, status antarmuka, uptime PPPoE, hasil uji).
3. **Network Safety First (Zero Disturbance)**:
   Dilarang memutus sesi PPPoE pelanggan aktif saat melakukan modifikasi konfigurasi atau rebuild container.
4. **Eksekusi Mandiri & Siklus Tuntas**:
   Lakukan investigasi, perbaikan, pengujian mandiri, build container, dan catat hasil secara deterministik.

