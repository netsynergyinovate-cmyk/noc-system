# Laporan Eksekusi: Buat Endpoint Metadata Legenda Peta

- **Task Ref**: `peta-pelanggan-amp-topologi-jaringan/penyempurnaan-tampilan-peta/buat-endpoint-metadata-legenda-peta`
- **Task ID**: `c279ba28-aed3-44fe-9c23-4dea9d24aaa7`
- **Feature**: `Penyempurnaan Tampilan Peta` (Layer `backend`, Phase 5/5)
- **Status**: SELESAI (100% Passed)

---

## 1. Analisis Kebutuhan & Desain Metadata Legenda
Untuk menjaga konsistensi visual antara peta Leaflet, dialog panduan simbol, dok legenda mengambang, serta inspektur detail pelanggan/perangkat, backend menyediakan metadata terpusat (*single source of truth*) yang dapat diakses oleh client peramban maupun aplikasi eksternal:
1. **Simbol Titik & Status Pelanggan (`nodes.customers`)**:
   - Status Online (Normal): `#10b981` (Emerald), redaman optik > -23.0 dBm.
   - Status Redaman Optik Kritis (Warning): `#f59e0b` (Amber), daya terima RX <= -24.5 dBm.
   - Status Terisolir: `#f43f5e` (Rose), tagihan belum diselesaikan.
   - Status Offline: `#64748b` (Slate), sesi terputus / LOS.
2. **Simbol Titik Perangkat Infrastruktur Fisik (`nodes.infrastructure`)**:
   - Core Router Gateway: `#6366f1` (Indigo).
   - OLT Central Sentral: `#a855f7` (Purple).
   - ODC Kabinet Distribusi: `#0ea5e9` (Sky).
   - ODP Kotak Splitter Tiang: `#f59e0b` (Amber).
   - Tiang Tumpu Fiber (Pole Span): `#64748b` (Slate).
3. **Kapasitas & Ketebalan Serat Optik (`cables`)**:
   - Backbone Optik: 48 - 96 Core (Tebal 5.0px, Ungu `#8b5cf6`, dash "8, 6").
   - Feeder Utama: 24 Core (Tebal 4.0px, Indigo `#6366f1`, dash "7, 5").
   - Feeder Distribusi: 16 Core (Tebal 3.2px, Cyan `#06b6d4`).
   - Distribusi Cabang: 4 - 8 Core (Tebal 2.5px, Amber `#f59e0b`, dash "6, 4").
   - Drop Core Pelanggan: 1 - 2 Core (Tebal 1.8px, Emerald `#10b981`).
   - Jalur Disorot (Highlight): Tebal 3.5px, Cyan cerah `#22d3ee`, pulse.
4. **Hierarki Level-of-Detail (LOD)**:
   - Overview (Zoom $\le 11$), Regional (Zoom 12-14), Detail (Zoom $\ge 15$).
5. **Panduan Gestur Operasional (`gestures`)**:
   - Pan, Zoom, Inspect, Cull toggle.

---

## 2. Modifikasi Berkas & Implementasi

### A. `src/services/map-legend.service.ts`
- Membuat service `getMapLegendMetadata()` yang menyusun metadata legenda peta, status redaman, simbol infrastruktur, 6 hierarki kapasitas kabel, tingkatan LOD, dan panduan gestur interaksi.

### B. `src/app/api/map/legend/route.ts`
- Route handler baru `GET /api/map/legend` terproteksi sesi (`withApiSession`).
- Mengembalikan metadata legenda lengkap dengan header cache `private, max-age=300`.

### C. `src/app/api/map/config/route.ts`
- Menyelaraskan route master konfigurasi peta agar mendukung query parameter `includeLegend=true` untuk pengambilan konfigurasi peta sekaligus metadata legenda dalam satu panggilan HTTP.

### D. `tests/map-legend-endpoint.test.mjs`
- Dibuat suite pengujian unit 7 skenario memverifikasi struktur payload legenda, detail pelanggan/infrastruktur, 6 hierarki kabel optik, 3 tingkatan LOD, serta proteksi sesi Better Auth HTTP 401 pada endpoint `/api/map/legend` dan `/api/map/config?includeLegend=true`.

---

## 3. Bukti Verifikasi Mandiri

1. **Unit & Integration Tests**:
   - `node --test tests/map-legend-endpoint.test.mjs`
   - **Hasil**: 7 passed, 0 failed.
2. **ESLint**:
   - `npx eslint src/app/api/map/legend/route.ts src/app/api/map/config/route.ts src/services/map-legend.service.ts`
   - **Hasil**: 0 errors, 0 warnings.
3. **TypeScript Typecheck**:
   - `npm run typecheck`
   - **Hasil**: Types generated successfully, 0 errors.
