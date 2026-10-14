# ADR-0001: Pemilihan Stack Arsitektur Hibrida (Go Daemon + PostgreSQL Raw SQL + Next.js 15)

- **Status:** Accepted (Final)
- **Tanggal:** 2026-10-12

## Konteks & Latar Belakang

Sistem NOC ISP harus mengumpulkan metrik dari banyak router/OLT, mengevaluasi aturan alert, dan menyiarkan pembaruan ke operator secara real-time. Di sisi lain, sistem butuh aplikasi web dengan otentikasi, RBAC, CRUD admin, dan audit log. Satu stack untuk semua jalur dinilai berisiko: jalur panas (polling, evaluasi, siaran) sensitif terhadap latensi dan memori, sedangkan jalur admin sensitif terhadap kecepatan pengembangan dan keamanan tipe. Dua uji banding dijalankan di lab Docker lokal untuk memutuskan dengan data, bukan perkiraan.

## Hasil Uji Empiris Lab Docker

Sumber: `src/lib/dashboard/benchmark-results.json`, `src/lib/dashboard/benchmark-db-results.json`, ringkasan di `docs/benchmark-summary.md`.

**Uji 1: Go vs Node.js (jalur realtime)**

- Pipeline lengkap 3,7x lebih cepat (p95 5,2x).
- RAM 5,1x lebih hemat: 18 MB vs 92 MB RSS.
- Goroutine per router: satu router timeout tidak menahan yang lain.

**Uji 2: Drizzle vs PostgreSQL Raw SQL (UNNEST/COPY)**

- Batch upsert 1,16x lebih cepat.
- Query agregasi 1,09x-1,54x lebih cepat.
- Heap 1,1x-3,2x lebih hemat.
- Overhead Drizzle pada query non-panas < 0,2 ms.

## Keputusan Final 3 Layer

1. **Koleksi & Real-time:** Go Daemon (Collector + Rule Engine + WebSocket Hub).
2. **Time-series Ingest & Agregasi:** PostgreSQL Raw SQL (UNNEST/COPY). Opsi TimescaleDB hypertable tersedia bila volume tumbuh.
3. **Web App, Auth, RBAC, Admin CRUD, Audit Log:** Next.js 15 App Router + Drizzle ORM + Better Auth. Alasan: typesafety end-to-end, migrasi skema terkelola, overhead query non-panas < 0,2 ms tidak membebani sistem.

## Konsekuensi & Mitigasi

- **Dua bahasa (Go dan TypeScript).** Mitigasi: batas jelas lewat kontrak HTTP/WebSocket yang dikunci golden file dan tes kontrak; Go hanya memegang jalur panas.
- **Skema dipakai dua sisi.** Mitigasi: Drizzle satu-satunya pemilik skema dan migrasi; Go dan Raw SQL hanya membaca/menulis tabel yang sudah dimigrasi.
- **Raw SQL lebih rawan salah ketik dan injeksi.** Mitigasi: wajib parameterized query; output kedua jalur diverifikasi identik pada benchmark.
- **Angka lab bukan produksi.** Mitigasi: uji ulang di perangkat nyata sebelum promosi; keputusan ditinjau bila selisih tidak bertahan.
- **Operasional dua proses.** Mitigasi: Go berupa satu biner; tidak ada runtime tambahan.
