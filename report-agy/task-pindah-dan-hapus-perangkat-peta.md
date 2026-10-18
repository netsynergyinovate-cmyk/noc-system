# Laporan Task: Wujudkan Pindah dan Hapus Perangkat di Peta

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/peletakan-infrastruktur/wujudkan-pindah-dan-hapus-perangkat-di-peta`
- **Judul**: Wujudkan pindah dan hapus perangkat di peta
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Fase**: Fase 2 ("Peletakan Infrastruktur", layer: `frontend`)
- **Status**: SELESAI

---

## 2. Root Cause & Analisis Rekayasa Mendalam
Dalam pengelolaan operasional jaringan fisik di lapangan:
1. **Dinamika Penataan Infrastruktur**: Kotak ODP, tiang fiber, atau perangkat seringkali perlu digeser titik koordinatnya saat ada perbaikan tiang, relokasi kabel aerial, atau koreksi GPS oleh teknisi di lapangan.
2. **Pembersihan Perangkat Usang**: Perangkat yang sudah dibongkar atau salah ditempatkan harus dapat dihapus secara langsung dari antarmuka peta tanpa perlu query database manual.
3. **Network Safety & Defensive Operations**: Aksi penghapusan perangkat bersifat destruktif sehingga wajib dilengkapi dialog konfirmasi (`delete-infra-confirm-dialog`) dan jejak audit PostgreSQL (`auditLog`), sementara pemindahan lokasi harus menyediakan preview draggable marker interaktif sebelum disimpan secara permanen.

---

## 3. Detail Implementasi & Perubahan Berkas

### A. Validator Zod (`src/validators/infrastructure-placement.ts`)
1. `updateInfrastructureLocationSchema`: Memvalidasi koordinat latitude (-90 s/d 90) dan longitude (-180 s/d 180).
2. `updateInfrastructurePointSchema`: Skema pembaruan titik perangkat lengkap.
3. `deleteInfrastructurePointSchema`: Validasi ID perangkat wajib berupa string non-kosong.

### B. Service Database & Audit (`src/services/map-infrastructure.service.ts`)
1. `updateInfrastructureLocation(id, input, actorUserId)`:
   - Memvalidasi ID dan koordinat numerik.
   - Menyimpan riwayat perubahan ke tabel `auditLog` dengan aksi `move_infrastructure_point`.
2. `deleteInfrastructurePoint(id, actorUserId)`:
   - Memvalidasi ID perangkat.
   - Menyimpan jejak audit ke tabel `auditLog` dengan aksi `delete_infrastructure_point`.

### C. API Endpoints (`src/app/api/map/infrastructure/`)
1. `src/app/api/map/infrastructure/route.ts`:
   - Menambahkan handler `PATCH` untuk pemindahan koordinat.
   - Menambahkan handler `DELETE` untuk penghapusan perangkat.
2. `src/app/api/map/infrastructure/[id]/route.ts`:
   - Rute RESTful per item ID yang mengekspor handler `PATCH` dan `DELETE`.

### D. Komponen Panel Detail (`src/components/map/device-detail-panel.tsx`)
1. **Tombol Aksi**:
   - `move-infra-button`: Tombol "Pindah Lokasi" untuk masuk ke mode geser.
   - `delete-infra-button`: Tombol "Hapus Titik" untuk memicu dialog konfirmasi.
2. **Kontrol Mode Geser Aktif (`data-testid="infra-move-controls"`)**:
   - Menampilkan koordinat baru yang dipilih di peta (`infra-draft-coords`).
   - Tombol Batal (`cancel-move-infra-button`).
   - Tombol Simpan Posisi (`save-infra-location-button`) dengan loading spinner.
3. **Dialog Konfirmasi Hapus (`data-testid="delete-infra-confirm-dialog"`)**:
   - Pesan peringatan keamanan jaringan.
   - Tombol Batal (`cancel-delete-infra-button`).
   - Tombol Konfirmasi Hapus (`confirm-delete-infra-button`) berpenampilan destruktif.

### E. Integrasi Peta Leaflet (`src/components/map/network-map.tsx`)
1. **Draggable Marker (`data-testid="draggable-infra-marker"`)**:
   - Ditampilkan saat mode geser aktif (`isMovingInfra && infraMoveDraftCoords`).
   - Mengikuti drag teknisi dan memperbarui koordinat draft secara real-time.
2. **Map Location Picker**:
   - Menangkap klik di peta saat mode pindah aktif dan langsung memindahkan pin.
3. **Optimistic UI Updates & Notifikasi**:
   - Memperbarui state lokal `data.infrastructure` secara instan.
   - Menampilkan banner notifikasi aksi sukses (`data-testid="infra-action-success-message"`).

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
> npx eslint src/validators/infrastructure-placement.ts src/services/map-infrastructure.service.ts src/app/api/map/infrastructure/route.ts src/app/api/map/infrastructure/[id]/route.ts src/components/map/device-detail-panel.tsx src/components/map/network-map.tsx
(Exit Code: 0, 0 warning, 0 error)
```

### C. Node Test Suites (Semua 74 Uji Lulus 100%)
```bash
> node --test tests/infrastructure-move-and-delete.test.mjs tests/infrastructure-device-markers.test.mjs tests/marker-distinction.test.mjs tests/device-detail-panel.test.mjs tests/device-type-picker-placement.test.mjs tests/customer-drag-and-save-location.test.mjs tests/infrastructure-map-page.test.mjs tests/customer-detail-panel.test.mjs tests/pelanggan-peta-page.test.mjs tests/network-map-service.test.mjs tests/real-map-markers-service.test.mjs
ℹ tests 74
ℹ pass 74
ℹ fail 0
ℹ duration_ms 240.4ms
```
