# Laporan Pengerjaan Task: Buat Endpoint Hapus Perangkat

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/peletakan-infrastruktur/buat-endpoint-hapus-perangkat`
- **Judul**: Buat endpoint hapus perangkat
- **Fitur**: Peletakan Infrastruktur
- **Fase**: 2, **Layer**: backend
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Workspace ID**: `694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd`

---

## 2. Ringkasan Perubahan Teknis
Telah dirancang, diimplementasikan, dan diverifikasi fungsionalitas penghapusan titik perangkat infrastruktur fisik jaringan peta yang aman dan berintegritas referensial:

1. **Service Layer (`src/services/map-infrastructure.service.ts`)**:
   - Fungsi `deleteInfrastructurePoint(id, actorUserId)`:
     - Mendeteksi nama dan jenis perangkat sebelum dilakukan penghapusan.
     - **Pembersihan Kabel Optik**: Menghapus seluruh entitas kabel terhubung pada tabel `network_cables` (`sourceId` atau `targetId`) agar tidak terjadi referensi menggantung (*orphaned edges*).
     - **Pelepasan Relasi Turunan**: Mengubah relasi `parentId` menjadi `null` pada simpul hilir yang sebelumnya menginduk ke perangkat ini.
     - **Penghapusan Entitas Master**: Menghapus record dari tabel `network_infrastructure`.
     - **Audit Logging**: Mencatat mutasi penghapusan ke tabel `audit_log` dengan aksi `"delete_infrastructure_point"`, identitas perangkat, tipe, serta identitas teknisi penanggung jawab.

2. **HTTP API Route Handlers**:
   - `src/app/api/infrastructure/[id]/route.ts`: Menyediakan handler `DELETE` terautentikasi untuk REST API.
   - `src/app/api/map/infrastructure/[id]/route.ts`: Menyediakan handler `DELETE` terautentikasi untuk panel interaktif peta.
   - `src/app/api/infrastructure/route.ts` & `src/app/api/map/infrastructure/route.ts`: Menyediakan handler `DELETE` tingkat koleksi dengan identitas perangkat yang dapat dikirimkan melalui URL parameter kueri (`?id=...`) atau body JSON (`{ id: "..." }`).

---

## 3. Bukti Pengujian Mandiri (Evidence Before Assertions)
1. **TypeScript Typecheck**:
   - Perintah: `npm run typecheck`
   - Hasil: **Exit Code 0** (0 error, route types terkompilasi bersih).
2. **ESLint**:
   - Perintah: `npx eslint "src/services/map-infrastructure.service.ts" "src/app/api/infrastructure/[id]/route.ts" "src/app/api/map/infrastructure/[id]/route.ts" "src/app/api/infrastructure/route.ts" "src/app/api/map/infrastructure/route.ts"`
   - Hasil: **Exit Code 0** (0 error, 0 warning).
3. **Unit & Integration Test**:
   - Perintah: `node --test tests/infrastructure-delete-endpoint.test.mjs`
   - Hasil: **6 pass, 0 fail**.
4. **Regresi Seluruh Pengujian Infrastruktur**:
   - Perintah: `node --test tests/infrastructure-*.test.mjs`
   - Hasil: **49 pass, 0 fail**.

---

## 4. Kepatuhan Zero-Dummy & Boundaries
- Menghapus record dari tabel PostgreSQL nyata `network_infrastructure` dan membersihkan relasi terkait secara persisten.
- Berkas sesi pengguna aktif (`customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tidak disentuh.
