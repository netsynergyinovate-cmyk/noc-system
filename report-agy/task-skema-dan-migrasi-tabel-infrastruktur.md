# Laporan Pengerjaan Task: Buat Skema dan Migrasi Tabel Infrastruktur

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/peletakan-infrastruktur/buat-skema-dan-migrasi-tabel-infrastruktur`
- **Judul**: Buat skema dan migrasi tabel infrastruktur
- **Fitur**: Peletakan Infrastruktur
- **Fase**: 2, **Layer**: backend
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Workspace ID**: `694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd`

---

## 2. Ringkasan Perubahan Teknis
Telah dirancang dan diimplementasikan skema tabel relasional PostgreSQL untuk infrastruktur fisik peta jaringan dan jalur kabel optik topologi:

1. **Skema Drizzle ORM (`src/db/schema/network-infrastructure.ts`)**:
   - Tabel `network_infrastructure`:
     - `id`: Text primary key dengan default `crypto.randomUUID()`.
     - `name`: Nama unik perangkat infrastruktur (server, ODC, ODP, tiang).
     - `type`: Enum `InfrastructureDeviceType` (`router`, `olt`, `odp`, `odc`, `pole`, `server`) dengan check constraint.
     - `host`: Hostname/IP opsional.
     - `status`: Enum status (`active`, `inactive`, `maintenance`) dengan check constraint.
     - `latitude` & `longitude`: Numeric berpresisi tinggi dengan batasan geografis sah ($-90 \le \text{lat} \le 90$ dan $-180 \le \text{lng} \le 180$).
     - `parentId`: Self-reference hierarki induk-anak (Server $\rightarrow$ ODC $\rightarrow$ ODP).
     - `capacity` & `usedCapacity`: Manajemen kapasitas port/serat.
     - `details`: Metadata fleksibel JSONB.
     - Indeks performa: `network_infra_type_idx`, `network_infra_status_idx`, `network_infra_parent_idx`.
   - Tabel `network_cables`:
     - Jalur kabel polilin menghubungkan perangkat induk ke anak dan pelanggan (`polyline: jsonb`).
     - Atribut kapasitas core, kode warna, dan jenis kabel (`backbone`, `feeder`, `distribution`, `drop_core`).
   - Re-ekspor resmi di `src/db/schema/index.ts`.

2. **Berkas Migrasi SQL (`drizzle/0025_network_infrastructure.sql`)**:
   - DDL lengkap pembuatan tabel `network_infrastructure` dan `network_cables` beserta seluruh index dan check constraint.
   - Dicatat secara resmi pada jurnal migrasi Drizzle `drizzle/meta/_journal.json`.

3. **Integrasi Service (`src/services/map-infrastructure.service.ts`)**:
   - Menyambungkan operasi `createInfrastructurePoint`, `updateInfrastructureLocation`, `deleteInfrastructurePoint`, dan `getNetworkInfrastructureList` langsung ke tabel `network_infrastructure` di PostgreSQL dengan penanganan audit log.

---

## 3. Bukti Pengujian Mandiri (Evidence Before Assertions)
1. **TypeScript Typecheck**:
   - Perintah: `npm run typecheck`
   - Hasil: **Exit Code 0** (0 error, rute terkompilasi bersih).
2. **ESLint**:
   - Perintah: `npx eslint "src/db/schema/network-infrastructure.ts" "src/db/schema/index.ts" "src/services/map-infrastructure.service.ts"`
   - Hasil: **Exit Code 0** (0 error, 0 warning).
3. **Unit & Integration Test**:
   - Perintah: `node --test tests/infrastructure-schema-and-migration.test.mjs`
   - Hasil: **5 pass, 0 fail**.
4. **Regresi Seluruh Fitur Infrastruktur**:
   - Perintah: `node --test tests/infrastructure-schema-and-migration.test.mjs tests/infrastructure-move-and-delete.test.mjs tests/device-detail-panel.test.mjs tests/device-type-picker-placement.test.mjs tests/infrastructure-device-markers.test.mjs tests/infrastructure-map-page.test.mjs`
   - Hasil: **40 pass, 0 fail**.

---

## 4. Kepatuhan Zero-Dummy & Boundaries
- Tabel PostgreSQL nyata `network_infrastructure` dan `network_cables` menyediakan penyimpanan persisten untuk koordinat, kapasitas, dan topologi.
- Berkas sesi pengguna aktif (`customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tidak disentuh.
