# Ringkasan Uji Banding Stack Lokal

Dua uji dijalankan di lab Docker lokal (50 iterasi masing-masing). Data mentah: `src/lib/dashboard/benchmark-results.json` (`npm run benchmark:run`) dan `src/lib/dashboard/benchmark-db-results.json` (`npm run benchmark:db`). Ringkasan dihitung oleh `compileBenchmarkSummary()` di `src/lib/dashboard/stack-benchmark.ts` dan tampil di tab Ringkasan halaman uji banding.

## Metodologi

- **Uji 1, Go vs Node.js**: pipeline yang sama (parse & kumpul metrik, evaluasi aturan, agregasi trafik) dijalankan di kedua runtime. Diukur latensi per langkah (ms) dan memori proses (Go `Sys`, Node RSS).
- **Uji 2, Drizzle vs SQL langsung**: skenario sama dijalankan lewat Drizzle dan SQL langsung (UNNEST/COPY). Output kedua jalur diverifikasi identik (`verified: true`) sebelum diukur. Diukur latensi dan alokasi heap.
- Rasio = nilai lambat / nilai cepat; >1 berarti Go (Uji 1) atau SQL langsung (Uji 2) unggul.
- Batas: Uji 2 memakai klien DB tiruan (`mode: "mock"`): yang terukur biaya lapisan akses, bukan kecepatan PostgreSQL. Ulangi dengan `mode: "live"` sebelum angka dipakai untuk kapasitas.

## Uji 1: Go vs Node.js (ms)

| Langkah | Go avg | Go p50 | Go p95 | Node avg | Node p50 | Node p95 | Rasio avg |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Parse & kumpul metrik | 0,183 | 0,183 | 0,268 | 0,953 | 0,823 | 1,805 | 5,2x |
| Evaluasi aturan | 0,034 | 0,034 | 0,043 | 0,105 | 0,081 | 0,160 | 3,1x |
| Agregasi trafik | 0,054 | 0,053 | 0,061 | 0,057 | 0,046 | 0,133 | 1,1x |
| **Pipeline lengkap** | 0,305 | 0,293 | 0,374 | 1,140 | 1,005 | 1,954 | **3,7x** (p95: 5,2x) |

Memori: Go 17,2 MB vs Node 87,7 MB RSS, **5,1x lebih hemat**.

## Uji 2: Drizzle vs SQL langsung (ms)

| Skenario | SQL avg | SQL p50 | SQL p95 | Drizzle avg | Drizzle p50 | Drizzle p95 | Rasio avg | Hemat heap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Agregasi trafik 1 jam | 0,297 | 0,283 | 0,378 | 0,459 | 0,433 | 0,702 | 1,54x | 3,21x |
| Agregasi trafik 6 jam | 0,279 | 0,274 | 0,308 | 0,303 | 0,291 | 0,383 | 1,09x | 1,15x |
| Agregasi trafik 24 jam | 0,227 | 0,216 | 0,269 | 0,251 | 0,231 | 0,371 | 1,10x | 1,18x |
| Agregasi trafik 7 hari | 0,243 | 0,238 | 0,271 | 0,281 | 0,269 | 0,354 | 1,15x | 1,17x |
| Batch upsert (1.000 sampel) | 1,099 | 1,089 | 1,304 | 1,273 | 0,992 | 2,022 | 1,16x | 1,09x |
| Metrik pelanggan | 0,005 | 0,003 | 0,020 | 0,016 | 0,011 | 0,044 | 3,16x | 1,82x |

## Kesimpulan: stack hibrida

| Lapisan | Pilihan | Dasar bukti |
| --- | --- | --- |
| Kolektor, rule engine, WebSocket streaming | Go daemon | Pipeline 3,7x lebih cepat (p95 5,2x), memori 5,1x lebih hemat |
| Ingest time-series & agregasi | PostgreSQL SQL langsung (COPY/UNNEST) | Batch upsert 1,16x, agregasi 1,09x-1,54x, heap lebih hemat |
| Web, sesi auth, CRUD admin, audit | Next.js + Drizzle ORM | Selisih Drizzle kecil di jalur non-panas; tipe aman dan migrasi terkelola |

Justifikasi: Go dipakai di jalur panas (polling, evaluasi, siaran) tempat selisih latensi dan memori nyata. SQL langsung dipakai hanya untuk tulis/agregasi volume tinggi. Selisih Drizzle pada CRUD jarang terpanggil tidak sebanding biaya menulis ulang, sehingga Next.js + Drizzle dipertahankan.
