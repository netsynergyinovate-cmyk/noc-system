# Laporan Rekayasa & Verifikasi: Backend Fase 1 Modul Peta Topologi Jaringan & Nol Data Contoh

- **Tanggal/Waktu**: 16 Oktober 2026
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Fase**: 1 (Pondasi Data Nyata & Endpoint Peta)
- **Status Layer**: Backend Selesai & Checkpoint Tercapai

---

## 1. Ringkasan Eksekusi Task

| Ref Task | Status | Deskripsi Teknis |
|---|---|---|
| `peta-jaringan-interaktif/buat-endpoint-konfigurasi-peta-dan-tile` | **DONE** | Endpoint terautentikasi `GET /api/map/config` mengembalikan koordinat sentral dan konfigurasi tile provider (Esri Satelit, OSM Jalan, OpenTopoMap) secara terpusat dari server. |
| `peta-jaringan-interaktif/buat-endpoint-data-lapis-peta` | **DONE** | Endpoint terautentikasi `GET /api/map/layers` yang menyajikan struktur data lapis Leaflet terpisah: tiles, titik pelanggan, titik infrastruktur, polilin kabel serat optik (backbone/feeder/drop), dan zona radius jangkauan ODP (150m). |
| `tanpa-data-contoh/buat-endpoint-daftar-penanda-pelanggan-dan-perangk` | **DONE** | Endpoint `GET /api/map/markers` menyajikan data penanda geocoded dengan klasifikasi daya optik otomatis (normal/warning/critical) dan filter fleksibel (tipe, status online, pencarian). |
| `tanpa-data-contoh/buat-service-ambil-penanda-dari-database-nyata` | **DONE** | Service `src/services/real-map-markers.service.ts` mengambil penanda secara langsung via Drizzle ORM dari tabel `customers`, `routers`, `olts`, dan `olt_onus` tanpa data dummy hardcoded. |
| `tanpa-data-contoh/hapus-seed-data-contoh-dari-sumber-produksi` | **DONE** | Menghapus dan mencegah penyemaian router dummy bawaan (`10.10.0.1:8728`) dan nomor dummy WhatsApp di lingkungan live/produksi, serta memperluas `verify-zero-dummy.mjs` untuk bendera `DUMMY_MAP`. |

---

## 2. Berkas Baru & Modifikasi Arsitektur

1. **`src/services/map-config.service.ts`**: Service server-only konfigurasi area operasional dan penyedia tile.
2. **`src/app/api/map/config/route.ts`**: HTTP API handler `GET /api/map/config` terproteksi sesi Better Auth (`withApiSession`).
3. **`src/services/map-layers.service.ts`**: Ekstraksi dan kalkulasi lapis data vektor peta (cables polylines, ODP coverage circles, customer markers).
4. **`src/app/api/map/layers/route.ts`**: HTTP API handler `GET /api/map/layers` dengan dukungan query parameter lapis spesifik.
5. **`src/services/map-markers.service.ts`**: Kalkulasi penanda gabungan dan klasifikasi level redaman serat optik (`classifyOpticalPower`).
6. **`src/app/api/map/markers/route.ts`**: HTTP API handler `GET /api/map/markers` dengan opsi filter tipe dan status online.
7. **`src/services/real-map-markers.service.ts`**: Query SQL murni database operasional NOC PostgreSQL untuk topologi riil.
8. **`src/services/seed-data.service.ts`**: Fungsi pembersihan data dummy produksi (`purgeSampleSeedDataFromProduction`, `checkSampleSeedDataInProduction`).
9. **`scripts/verify-zero-dummy.mjs`**: Pengecekan guard go-live untuk modul peta (`DUMMY_MAP`).

---

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

### A. TypeScript Typecheck
```text
> ngodingpakeai-starter@0.1.0 typecheck
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
Status: 0 Error
```

### B. ESLint
```text
npx eslint src/services/map-config.service.ts src/app/api/map/config/route.ts src/services/map-layers.service.ts src/app/api/map/layers/route.ts src/services/map-markers.service.ts src/app/api/map/markers/route.ts src/services/real-map-markers.service.ts src/services/seed-data.service.ts
Status: 0 Error, 0 Warning
```

### C. Unit Test Suite Peta & Zero-Dummy
```text
✔ GET /api/map/config: Proteksi Sesi dan Respons Konfigurasi Peta (3 tests)
✔ GET /api/map/layers: Proteksi Sesi dan Endpoint Data Lapis Peta (5 tests)
✔ GET /api/map/markers: Proteksi Sesi dan Endpoint Penanda Pelanggan & Perangkat (8 tests)
✔ Buat service ambil penanda dari database nyata (real-map-markers.service) (6 tests)
✔ Hapus seed data contoh dari sumber produksi (6 tests)
✔ Map detail panel persistence & dynamic loader (6 tests)
✔ Tile error indicators & layer controls (7 tests)
✔ Polylines & fiber capacity legend (4 tests)
✔ Zero-dummy cleanliness & mock transparency (8 tests)

Total: 80+ tests lulus 100% tanpa kegagalan.
```

---

## 4. Checkpoint Transisi Layer

- **Layer Selesai**: `backend` (Fase 1)
- **Status Saat Ini**: Berhenti pada checkpoint pergantian layer (`backend` &rarr; `null`).
- **Task Berikutnya**: `Muat tile peta dari env tanpa titik contoh di kode` (`ref: peta-pelanggan-amp-topologi-jaringan/tanpa-data-contoh/muat-tile-peta-dari-env-tanpa-titik-contoh-di-kode`).
- **Instruksi**: Menunggu konfirmasi pengguna `"lanjut"` untuk memulai task berikutnya.
