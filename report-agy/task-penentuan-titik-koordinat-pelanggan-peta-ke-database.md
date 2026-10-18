# Laporan Teknis: Penentuan & Penyimpanan Titik Koordinat Pelanggan di Peta ke Database PostgreSQL

## 1. Ringkasan Eksekutif
Fitur penentuan atau pemilihan titik koordinat pelanggan di halaman peta (`/app/peta` dan `/app/pelanggan/peta`) telah berhasil diimplementasikan dan diuji secara menyeluruh. Fitur ini memungkinkan operator jaringan untuk:
1. Menentukan titik koordinat rumah pelanggan secara visual langsung di kanvas peta (Google Hybrid/Satelit/OSM) menggunakan pin seret (*draggable marker*).
2. Memilih pelanggan dari modal dialog interaktif yang dilengkapi pencarian instan (nama, username PPPoE, ODP) serta filter tab status (Belum Ada GPS, Semua, Sudah Ada Titik).
3. Melakukan inspeksi koordinat bebas dengan mengklik sembarang titik di peta, menyalin koordinat latitude/longitude ke clipboard, atau langsung menautkannya ke pelanggan (*Workflow 2: Map-first*).
4. Menyimpan koordinat baru langsung ke tabel `customers` (`latitude`, `longitude`) di basis data PostgreSQL operasional melalui endpoint `PATCH /api/customers/[id]/location` tanpa me-reload halaman (*zero-dummy*, *real-time optimistic sync*).

---

## 2. Perubahan Teknis yang Dilakukan

### A. Komponen Modal Pemilih Pelanggan (`src/components/map/customer-coordinate-picker-modal.tsx`)
- Dibuat komponen modal dialog menggunakan primitif Shadcn UI (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`).
- **Pencarian Cepat**: Filter `useMemo` multi-kriteria mencocokkan nama pelanggan, username PPPoE, dan nama ODP.
- **Filter Tab**:
  - `Belum Ada GPS` (default): Menampilkan pelanggan yang belum memiliki koordinat (`latitude === null`).
  - `Semua`: Menampilkan seluruh 70 pelanggan terdaftar di PostgreSQL.
  - `Sudah Ada Titik`: Menampilkan pelanggan yang sudah terpetakan untuk kebutuhan relokasi/pemindahan titik.
- **Prefilled Coordinate Support**: Jika operator mengklik peta terlebih dahulu sebelum membuka modal, koordinat tersebut ditampilkan pada banner atas modal dan otomatis terisi saat pelanggan dipilih.
- **Interaksi Ergonomis**: Setiap kartu pelanggan dapat diklik di seluruh area atau via tombol aksi (`data-testid="select-customer-plot-[id]"`).

### B. Integrasi Kanvas Peta & Bilah Alat (`src/components/map/network-map.tsx`)
1. **Bilah Alat Atas (Top Toolbar)**:
   - Ditambahkan tombol `data-testid="open-customer-coordinate-picker-button"` (*Tentukan Titik*) dengan ikon `MapPin` dan badge dinamis jumlah pelanggan belum terpetakan.
2. **Penyempurnaan Empty-State Banner**:
   - Ditambahkan tombol CTA langsung `data-testid="start-plot-customer-button"` (*Tentukan Titik di Peta Sekarang*) yang memicu modal pemilih.
   - Ditambahkan opsi dismiss `data-testid="dismiss-unmapped-banner-button"` (*Lihat Peta Saja*) sehingga operator dapat mengakses kanvas satelit meskipun belum ada pelanggan yang berkoordinat.
3. **Marker Interaktif di Leaflet**:
   - `draft-customer-plotting-marker`: Pin seret (*draggable pin*) dengan tooltip koordinat real-time yang mengikuti kursor saat digeser.
   - `CircleMarker`: Penanda lingkaran hijau untuk titik inspeksi koordinat bebas.
4. **Floating Action Cards**:
   - `customer-coordinate-confirmation-card`: Kartu terapung di bagian bawah layar saat mode plotting aktif. Menampilkan nama pelanggan, username PPPoE, ODP, koordinat terpilih, tombol Batal, dan tombol `Simpan ke Database`.
   - `inspected-map-coord-card`: Kartu terapung saat klik peta bebas. Menampilkan koordinat desimal, tombol salin clipboard dengan feedback visual `✓`, dan tombol `Plot Pelanggan`.
5. **Handler Simpan ke Database (`handleSavePlottedCustomer`)**:
   - Mengeksekusi `PATCH /api/customers/${plottingCustomer.id}/location` dengan payload `{ latitude, longitude }`.
   - Memperbarui state lokal pelanggan secara reaktif, menyinkronkan ringkasan (`summary.geocodedCustomers`, `summary.unmappedCustomers`), dan mengarahkan kamera peta ke titik baru via `flyToWithoutOcclusion`.

---

## 3. Bukti Verifikasi Mandiri

### A. TypeScript Typecheck
```bash
npm run typecheck
```
**Hasil**:
```
> ngodingpakeai-starter@0.1.0 typecheck
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
(0 TypeScript error)
```

### B. Linting ESLint
```bash
npx eslint src/components/map/network-map.tsx src/components/map/customer-coordinate-picker-modal.tsx tests/customer-coordinate-picking.test.mjs
```
**Hasil**:
```
0 errors, 0 warnings
```

### C. Unit Test Suite (`node --test`)
```bash
node --test tests/customer-coordinate-picking.test.mjs tests/empty-points-explanation.test.mjs tests/main-map-page-perfected.test.mjs
```
**Hasil**:
```
▶ Fitur Pemilihan & Penyimpanan Titik Koordinat Pelanggan di Peta
  ✔ 1. Berkas komponen modal dan servis backend tersedia dan valid (0.8031ms)
  ✔ 2. CustomerCoordinatePickerModal menyediakan kontrol pencarian, filter, dan data-testid yang lengkap (1.1523ms)
  ✔ 3. network-map.tsx mengintegrasikan tombol bilah atas dan aksi plotting dari empty-state (0.6998ms)
  ✔ 4. network-map.tsx memiliki kartu konfirmasi dan penyimpanan koordinat langsung ke database (0.5889ms)
  ✔ 5. Endpoint backend PATCH /api/customers/[id]/location memvalidasi dan menyimpan ke tabel customers PostgreSQL (0.3521ms)
✔ Fitur Pemilihan & Penyimpanan Titik Koordinat Pelanggan di Peta (4.3715ms)
ℹ tests 39, pass 39, fail 0 (100% lulus)
```

### D. Kompilasi & Runtime Docker
```bash
docker compose build app; docker compose up -d --no-deps app
```
**Hasil**:
- Image `nocsystem-app:latest` sukses dibangun (43.7 detik).
- Kontainer `nocsystem-app-1` berstatus **Up (healthy)**.

### E. Verifikasi Otomatis End-to-End Browser (Playwright)
Eksekusi: `node scripts/verify-customer-coordinate-picking.mjs`
1. **Alur 1 (Pilih Pelanggan -> Klik Peta -> Simpan)**:
   - Pelanggan: `FEBRIANTO` (`17060001813@runsnet.id`).
   - Koordinat yang di-plot: `-2.578556, 101.218500`.
   - Hasil PostgreSQL:
     ```json
     {
       "id": "603a78e1-688a-4924-96c7-fc82b9e2f259",
       "name": "FEBRIANTO",
       "pppoe_username": "17060001813@runsnet.id",
       "latitude": "-2.578556",
       "longitude": "101.218500"
     }
     ```
2. **Alur 2 (Klik Peta Bebas -> Kartu Inspeksi -> Tautkan Pelanggan -> Simpan)**:
   - Pelanggan: `MAS HASAN` (`17060001508@runsnet.id`).
   - Koordinat inspeksi: `-2.578679, 101.221955`.
   - Hasil PostgreSQL:
     ```json
     {
       "id": "abeb4856-f223-4d03-9a57-241dd9569a8a",
       "name": "MAS HASAN",
       "pppoe_username": "17060001508@runsnet.id",
       "latitude": "-2.578679",
       "longitude": "101.221955"
     }
     ```
3. **Daftar Artefak Bukti Tangkapan Layar**:
   - `screenshots/plot-step-1-initial-map.png`: Tampilan awal kanvas peta satelit.
   - `screenshots/plot-step-2-picker-modal.png`: Modal pemilih pelanggan dengan tab filter.
   - `screenshots/plot-step-3-filtered-customer.png`: Filter pencarian nama/username pelanggan.
   - `screenshots/plot-step-4-plotting-mode-active.png`: Indikator mode plotting aktif.
   - `screenshots/plot-step-5-confirmation-card.png`: Draggable pin dan kartu konfirmasi koordinat.
   - `screenshots/plot-step-6-saved-marker.png`: Titik pelanggan terpetakan di kanvas satelit.
   - `screenshots/plot-step-7-map-click-inspected.png`: Kartu inspeksi koordinat bebas dari klik peta.
   - `screenshots/plot-step-8-prefilled-modal.png`: Modal dengan koordinat prefill otomatis.
   - `screenshots/plot-step-9-hasan-confirmation.png`: Kartu konfirmasi untuk MAS HASAN.
   - `screenshots/plot-step-10-hasan-saved.png`: Titik MAS HASAN tersimpan dengan telemetri riil ONT (-21.02 dBm, SN: 90:88:A9:03:DC:60).

