# Keputusan Jalur Backend & Konsekuensi Arsitektur

- **Status:** Accepted
- **Tanggal:** 2026-10-13
- **Konteks:** ADR-0001 & PRD Integrasi Perangkat Nyata

## Ringkasan Eksekutif

Backend NOC ISP memakai **Arsitektur Hibrida (Hybrid Co-existence)**: Go Daemon memegang *Real-time Data Plane* (jalur panas), sedangkan Next.js + Drizzle ORM + Better Auth memegang *Management Plane* (jalur kontrol). Keputusan ini menurunkan ADR-0001 (`docs/adr/0001-stack-decision.md`) menjadi batas tanggung jawab yang konkret untuk fase "Pondasi Backend & Uji Koneksi". Tidak ada satu stack tunggal yang melayani kedua jalur, karena kebutuhan keduanya bertolak belakang: jalur panas peka latensi dan memori, jalur kontrol peka kecepatan pengembangan, keamanan tipe, dan keamanan akses.

## Evaluasi Mendalam Kedua Opsi

### Opsi A: Service Go Terpisah (`backend/`)

**Lingkup beban kerja**

- Polling interval 1 detik ke MikroTik REST, OLT HSGQ, dan GenieACS NBI (TR-069).
- Native UDP socket listener: Syslog (UDP 514) dan NetFlow (UDP 2055).
- In-memory ring buffer untuk metrik terbaru, rule engine anomali jaringan (antrean, CPU, port, optik, offline).
- Native WebSocket hub yang menyiarkan snapshot lalu delta per detik ke operator.

**Karakteristik performa empiris (lab Docker, ADR-0001)**

- Latensi pemrosesan < 2 ms per siklus evaluasi.
- RAM sekitar 18 MB RSS.
- Throughput sekitar 10.000 metrik/detik.
- Isolasi timeout lewat goroutine: satu router yang timeout tidak menahan router lain.

**Kelebihan**

- Socket UDP, goroutine, dan channel adalah fitur bawaan; tanpa dependensi runtime tambahan.
- Satu biner statis, jejak memori kecil, konkurensi murah.
- Latensi stabil karena tidak ada event-loop tunggal yang dibagi dengan rendering UI.

**Kekurangan**

- Bahasa kedua di repositori (Go dan TypeScript); tipe tidak dibagi otomatis.
- Kontrak HTTP/WebSocket harus dijaga manual (golden file dan tes kontrak).
- Dua proses untuk dioperasikan dan dipantau.

### Opsi B: Next.js Route Handlers + Drizzle ORM (`src/app/api/`)

**Lingkup beban kerja**

- Rendering Web App (React Server Components).
- Better Auth: sesi, cookie, dan RBAC.
- CRUD perangkat, preferensi, dan audit log.
- Penerbit HMAC realtime ticket (`/api/realtime/ticket`).

**Karakteristik performa**

- Type-safety end-to-end dari skema sampai UI.
- Migrasi skema Drizzle terpusat dan dapat ditinjau.
- Overhead RAM sekitar 180 MB RSS.
- Kelemahan event-loop: UDP dan polling berfrekuensi tinggi bersaing dengan rendering dan request web; satu pekerjaan sinkron yang lambat menunda semuanya.

**Kelebihan**

- Satu bahasa, satu alat uji, pengembangan fitur admin paling cepat.
- Auth, RBAC, dan validasi Zod sudah terpasang dan teruji.
- Overhead query non-panas Drizzle < 0,2 ms.

**Kekurangan**

- Tidak cocok untuk listener UDP 514/2055 dan polling 1 detik ke banyak perangkat.
- Memori lebih besar dan tidak ada isolasi per perangkat.
- WebSocket hub berumur panjang bertentangan dengan model route handler yang berumur pendek.

## Keputusan Arsitektur: Hibrida (*Hybrid Co-existence*)

**Pembagian peran ketat**

| Plane | Komponen | Tanggung jawab |
| --- | --- | --- |
| Real-time Data Plane (Jalur Panas) | Go Daemon (`backend/`) | Polling, UDP Syslog/NetFlow, ring buffer, rule engine, WebSocket hub, tulis time-series |
| Management Plane (Jalur Kontrol) | Next.js + Drizzle + Better Auth | UI, auth, RBAC, CRUD, audit log, penerbitan ticket |

**Batas antarmuka inter-service**

- **Kepemilikan DB:** Drizzle adalah pemilik migrasi tunggal. Go membaca tabel yang sudah dimigrasi dan menulis time-series dengan parameterized query; Go tidak pernah membuat atau mengubah skema.
- **Auth:** shared `REALTIME_TOKEN_SECRET`. Next.js menerbitkan ticket bertanda HMAC-SHA256 berumur pendek lewat `/api/realtime/ticket`; Go memverifikasinya di handshake WebSocket dan endpoint baca. Secret tidak pernah dikirim ke browser.
- **Kontrak:** HTTP/WebSocket dikunci golden file dan tes kontrak.

## Matriks Komparasi

| Dimensi | Opsi A: Go Daemon | Opsi B: Next.js + Drizzle | Pemenang |
| --- | --- | --- | --- |
| Throughput | ~10.000 metrik/detik | Terbatas satu event-loop bersama UI | A |
| Latensi | < 2 ms | Variabel, tergantung beban render | A |
| RAM / Memori | ~18 MB RSS | ~180 MB RSS | A |
| CPU | Multi-core lewat goroutine | Satu thread JS utama | A |
| Protokol UDP (Syslog 514, NetFlow 2055) | Native | Tidak cocok | A |
| Kompleksitas UI / CRUD / Auth | Perlu dibangun sendiri | Bawaan, type-safe | B |
| Operasional | Satu biner, proses terpisah | Satu aplikasi, sudah ada | Seri (dua proses = biaya terkelola) |

## Konsekuensi

**Teknis**

- Dua bahasa. Mitigasi: Go hanya memegang jalur panas; kontrak dikunci tes.
- Skema dipakai dua sisi. Mitigasi: Drizzle pemilik tunggal migrasi; Go hanya baca/tulis tabel yang sudah ada.

**Konkurensi**

- Setiap perangkat dipoll dalam goroutine sendiri dengan timeout; perangkat lambat tidak menahan yang lain.
- Penulisan time-series dibatch; ring buffer dilindungi sehingga pembacaan WebSocket tidak memblokir polling.
- Next.js tidak pernah menjalankan loop polling atau listener UDP.

**Deployment (Docker dual-container)**

- Kontainer 1: Next.js (web + management plane). Kontainer 2: Go Daemon (data plane). PostgreSQL terpisah.
- Migrasi Drizzle dijalankan lebih dulu; Go dimulai setelah skema siap dan `DATABASE_URL` tersedia.
- Port UDP 514 dan 2055 hanya dibuka pada kontainer Go.

**Keamanan (Zero Secret Leak)**

- `REALTIME_TOKEN_SECRET`, kredensial perangkat, dan connection string hanya ada di sisi server dan tidak pernah memakai prefiks `NEXT_PUBLIC_`.
- Kredensial perangkat tidak ditulis ke log, audit log, maupun respons API.
- Ticket berumur pendek dan membawa izin dari peran asli; menyembunyikan UI bukan pemeriksaan akses.
- Semua SQL di sisi Go wajib parameterized.

## Rujukan

- ADR-0001: `docs/adr/0001-stack-decision.md`
- `docs/benchmark-summary.md`
- `backend/README.md`
