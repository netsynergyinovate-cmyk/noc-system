# Laporan Pengerjaan Task: Buat Endpoint Perbarui Posisi Perangkat

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/peletakan-infrastruktur/buat-endpoint-perbarui-posisi-perangkat`
- **Judul**: Buat endpoint perbarui posisi perangkat
- **Fitur**: Peletakan Infrastruktur
- **Fase**: 2, **Layer**: backend
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Workspace ID**: `694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd`

---

## 2. Ringkasan Perubahan Teknis
Telah dirancang, disempurnakan, dan diverifikasi rangkaian endpoint untuk memperbarui posisi koordinat perangkat infrastruktur jaringan di peta:

1. **Validator Zod (`src/validators/infrastructure-placement.ts`)**:
   - `updateInfrastructureLocationSchema`: Dilengkapi dengan `z.preprocess` untuk mendukung variasi payload koordinat dari peramban (`{ latitude, longitude }` maupun `{ lat, lng }`), konversi aman dari string numerik, serta validasi batas geografis bumi ($-90 \le \text{lat} \le 90$ dan $-180 \le \text{lng} \le 180$).
   - Mendukung bidang opsional `id`, `address`, dan `notes`.

2. **Service Layer (`src/services/map-infrastructure.service.ts`)**:
   - Fungsi `updateInfrastructureLocation`:
     - Memperbarui koordinat `latitude`, `longitude`, `address`, dan timestamp `updatedAt` pada tabel `network_infrastructure`.
     - Mendukung pencarian entitas baik berbasis `id` (UUID) maupun `name` perangkat.
     - Mencatat mutasi ke tabel `audit_log` dengan aksi `"move_infrastructure_point"` beserta rincian koordinat baru dan penanggung jawab teknisi.

3. **HTTP API Route Handlers**:
   - `src/app/api/infrastructure/[id]/route.ts`: Menyediakan `PATCH` dan alias `PUT` untuk pembaruan posisi perangkat.
   - `src/app/api/infrastructure/[id]/location/route.ts`: Subrute spesifik lokasi yang mendukung `GET` (ambil koordinat saat ini), `PATCH`, `PUT`, dan `POST` terautentikasi.
   - `src/app/api/map/infrastructure/[id]/location/route.ts`: Rute alias peta khusus untuk pemindahan lokasi perangkat.
   - `src/app/api/infrastructure/route.ts`: Mendukung `PATCH` dan `PUT` dengan `id` di query parameter atau request body.

---

## 3. Bukti Pengujian Mandiri (Evidence Before Assertions)
1. **TypeScript Typecheck**:
   - Perintah: `npm run typecheck`
   - Hasil: **Exit Code 0** (0 error, route types terkompilasi bersih).
2. **ESLint**:
   - Perintah: `npx eslint "src/validators/infrastructure-placement.ts" "src/services/map-infrastructure.service.ts" "src/app/api/infrastructure/[id]/route.ts" "src/app/api/infrastructure/[id]/location/route.ts" "src/app/api/map/infrastructure/[id]/location/route.ts" "src/app/api/infrastructure/route.ts"`
   - Hasil: **Exit Code 0** (0 error, 0 warning).
3. **Unit & Integration Test**:
   - Perintah: `node --test tests/infrastructure-update-location-endpoint.test.mjs`
   - Hasil: **6 pass, 0 fail**.
4. **Regresi Seluruh Pengujian Infrastruktur**:
   - Perintah: `node --test tests/infrastructure-*.test.mjs`
   - Hasil: **43 pass, 0 fail**.

---

## 4. Kepatuhan Zero-Dummy & Boundaries
- Koordinat diperbarui langsung ke tabel PostgreSQL `network_infrastructure` dan dicatat ke `audit_log`.
- Berkas sesi pengguna aktif (`customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tidak disentuh.
