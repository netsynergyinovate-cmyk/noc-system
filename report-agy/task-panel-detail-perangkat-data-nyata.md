# Laporan Task: Buat Panel Detail Perangkat dengan Data Nyata dari Backend

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/peletakan-infrastruktur/buat-panel-detail-perangkat-dengan-data-nyata-dari`
- **Judul**: Buat panel detail perangkat dengan data nyata dari backend
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Fase**: Fase 2 ("Peletakan Infrastruktur", layer: `frontend`)
- **Status**: SELESAI

---

## 2. Root Cause & Analisis Rekayasa Mendalam
Pada implementasi peta infrastruktur sebelumnya, saat pengguna mengklik salah satu penanda perangkat fisik (Core Router, OLT, ODP, ODC, Tiang), informasi yang ditampilkan masih berupa kartu inline sederhana yang belum menguraikan data relasi telemetri jaringan secara nyata:
1. **Kurangnya Agregasi Nyata Pelanggan ODP**: Kotak pembagi distribusi fiber (ODP) belum menampilkan daftar dan jumlah pelanggan yang tersambung secara riil dari database PostgreSQL.
2. **Kurangnya Navigasi Operasional**: Petugas lapangan yang menginspeksi titik di peta membutuhkan tombol cepat untuk menyalin koordinat GPS ke clipboard, membuka navigasi rute ke Google Maps saat berada di lapangan, serta pintasan langsung ke konfigurasi router MikroTik atau OLT PON terkait.
3. **Standar Zero-Dummy**: Komponen detail harus membaca data nyata yang dikirim backend (tidak menggunakan angka acak atau hardcoded) dan menangani berbagai variasi jenis perangkat (`router`, `olt`, `odp`, `odc`, `pole`).

---

## 3. Detail Implementasi & Perubahan Berkas

### A. Komponen Panel Baru (`src/components/map/device-detail-panel.tsx`)
1. **Header Semantik & Status Dinamis**:
   - Badge tipe perangkat (`data-testid="device-type-badge"`) dengan ikon semantik dan palet warna per jenis:
     - Router (BGP Gateway): Violet `#8b5cf6`
     - OLT (Optical Line Terminal): Cyan `#06b6d4`
     - ODP (Kotak Distribusi Fiber): Amber `#f59e0b`
     - ODC (Sentral Feeder): Blue `#3b82f6`
     - Tiang (Distribusi Tiang): Slate `#64748b`
   - Badge status operasional (`data-testid="device-status-badge"`): `Aktif` dengan pulse dot hijau atau `Nonaktif`.
   - Nama perangkat (`data-testid="device-name"`) dan host (`data-testid="device-host"`).
2. **Grid Informasi Metrik**:
   - Peran / Kategori jaringan.
   - Koordinat GPS presisi (`data-testid="device-coordinates"`).
   - Khusus ODP: Agregasi jumlah pelanggan terhubung (`data-testid="odp-connected-customers"`), perincian status sesi Online vs Offline dari data pelanggan PostgreSQL yang dicocokkan berdasarkan `c.odpName`.
   - Daftar pelanggan terhubung (`data-testid="odp-customer-list-section"`) dengan nama, username PPPoE, indikator status online/offline, dan redaman optik dBm.
   - Khusus OLT: Rincian merek/brand hardware dan antarmuka PON.
3. **Aksi Peta & Navigasi Lapangan**:
   - Tombol pusatkan peta (`data-testid="focus-infra-button"`) dengan animasi `flyTo`.
   - Tombol Salin GPS (`data-testid="copy-device-coordinates-button"`) dengan status feedback "Tersalin!".
   - Tombol Navigasi Google Maps (`data-testid="open-device-gmaps-button"`).
   - Tombol tutup panel (`data-testid="close-infra-panel"`).
4. **Pintasan Cepat Operasional**:
   - `shortcut-manage-router`: Buka `/app/router` untuk Router MikroTik.
   - `shortcut-manage-olt`: Buka `/app/cpe` untuk manajemen OLT & optik PON.
   - `shortcut-odp-customers`: Buka `/app/pelanggan?search=<odp_name>` untuk memfilter pelanggan di ODP ini.
   - `shortcut-odp-cpe`: Buka `/app/cpe` untuk informasi CPE.

### B. Integrasi Komponen di Peta (`src/components/map/network-map.tsx`)
- Mengimpor `DeviceDetailPanel` dan merendernya secara kondisional saat `selectedInfra !== null`.
- Menghubungkan callback penutupan `handleSelectInfra(null)` dan pemusatan kamera peta `map.flyTo([lat, lng], 17)`.
- Membersihkan import yang tidak terpakai sehingga 0 warning ESLint.

---

## 4. Bukti Uji Mandiri (Evidence Before Assertions)

### A. TypeScript Typecheck
```bash
> npm run typecheck
✓ Types generated successfully
(Exit Code: 0)
```

### B. ESLint
```bash
> npx eslint src/components/map/device-detail-panel.tsx src/components/map/network-map.tsx
(Exit Code: 0, 0 warning, 0 error)
```

### C. Node Test Suite
```bash
> node --test tests/device-detail-panel.test.mjs
▶ Panel Detail Perangkat Infrastruktur Peta (Data Nyata)
  ✔ Komponen DeviceDetailPanel diekspor dan memiliki kontainer data-testid='infra-detail-panel' (0.5178ms)
  ✔ Menampilkan badge tipe perangkat dan status aktif/nonaktif (0.124ms)
  ✔ Menampilkan nama perangkat, host, dan koordinat GPS (0.7012ms)
  ✔ Menyediakan tombol aksi: pusatkan peta, salin koordinat, rute Google Maps, dan tutup panel (0.1228ms)
  ✔ Menghitung data pelanggan terhubung secara nyata untuk ODP dari daftar pelanggan (0.1333ms)
  ✔ Menyediakan pintasan navigasi operasional sesuai tipe perangkat (0.1003ms)
  ✔ Terintegrasi dengan komponen NetworkMap utama (0.14ms)
✔ Panel Detail Perangkat Infrastruktur Peta (Data Nyata) (3.2596ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

### D. Regresi Peta Lengkap
```bash
> node --test tests/device-detail-panel.test.mjs tests/device-type-picker-placement.test.mjs tests/customer-drag-and-save-location.test.mjs tests/infrastructure-map-page.test.mjs tests/customer-detail-panel.test.mjs tests/pelanggan-peta-page.test.mjs tests/network-map-service.test.mjs tests/real-map-markers-service.test.mjs
ℹ tests 51
ℹ pass 51
ℹ fail 0
```
Semua 51 tes lulus 100%.
