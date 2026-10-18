# Laporan Hasil Pengerjaan Task: Buat Skema Relasi Induk Anak Perangkat (Backend)

## 1. Identifikasi Task
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9` (Peta Pelanggan & Topologi Jaringan)
- **Feature**: `Hubungan Induk–Anak` (Fase 3, Layer: `backend`)
- **Task Ref**: `peta-pelanggan-amp-topologi-jaringan/hubungan-induk-anak/buat-skema-relasi-induk-anak-perangkat`
- **Tanggal/Waktu**: 2026-10-16T23:12:00+07:00

---

## 2. Analisis & Akar Masalah
Sebelumnya, relasi antar perangkat fisik jaringan hanya dicatat secara implisit melalui kolom string sederhana `parent_id` pada tabel `network_infrastructure`. Tidak ada tabel relasi formal yang menampung:
1. Hubungan tipe relasi mendalam (`hierarchy`, `feeder`, `backup`, `distribution`).
2. Pencatatan interface/port fisik pada perangkat induk (`parent_port`, misal: "PON 1/1") dan perangkat anak (`child_port`, misal: "IN-1").
3. Validasi aturan hierarki perangkat telekomunikasi (Core Server/Router/OLT tidak boleh menjadi anak; ODC hanya boleh menginduk ke Core; ODP menginduk ke ODC/Core; Pole menginduk ke ODP/ODC).
4. Mekanisme deteksi siklus (loop / circular dependency prevention).
5. Foreign key constraint berkaskade di tingkat database fisik dan relasi Drizzle ORM (`relations`).

---

## 3. Implementasi Rekayasa Backend
1. **Skema Database & Drizzle ORM (`src/db/schema/network-infrastructure.ts`)**:
   - Menambahkan tabel `network_device_relations`:
     - `id`: Primary key UUID.
     - `parent_id`: Foreign key ke `network_infrastructure.id` (`onDelete: "cascade"`).
     - `child_id`: Foreign key ke `network_infrastructure.id` (`onDelete: "cascade"`).
     - `relation_type`: Enum `hierarchy`, `feeder`, `backup`, `distribution`.
     - `parent_port`: Port pada induk (varchar/text).
     - `child_port`: Port pada anak (varchar/text).
     - `status`: Status aktif, standby, atau maintenance.
     - `details`: Metadata jsonb fleksibel.
     - Check constraint database: `parent_id != child_id` dan validasi tipe relasi.
   - Menambahkan relasi Drizzle ORM:
     - `networkInfrastructureRelations`: memetakan `parent`, `children`, `parentRelations`, `childRelations`.
     - `networkDeviceRelationsRelations`: memetakan `parent` dan `child`.
   - Mengintegrasikan `"server"` ke dalam `infrastructureTypes` dan `InfrastructureDeviceType`.

2. **Migrasi Database PostgreSQL (`drizzle/0026_device_relations.sql`)**:
   - Berkas migrasi Drizzle committed yang membuat tabel `network_device_relations`, check constraint pencegahan self-loop, foreign key cascade, dan indeks query performa tinggi (`parent_idx`, `child_idx`, `type_idx`).
   - Berhasil diaplikasikan ke PostgreSQL development database (`npm run db:migrate`).

3. **Modul Aturan Hierarki Murni (`src/lib/hierarchy-rules.ts`)**:
   - `validateHierarchyTypes(parentType, childType, relationType)`:
     - Memvalidasi kepatuhan alur Server/Router/OLT (Tier 1) ➔ ODC (Tier 2) ➔ ODP (Tier 3) ➔ Pole (Tier 4).
     - Menolak penempatan Core Root sebagai child simpul lain.
     - Menolak pembalikan tier vertikal (misal ODP menjadi parent dari ODC/Router).

4. **Skema Validasi Zod (`src/validators/device-relations.ts`)**:
   - `createDeviceRelationSchema`: Validasi strict Zod, pencegahan self-reference via `.refine()`, dan default values.
   - `updateDeviceRelationSchema`: Validasi parsial pembaruan port, status, dan metadata.
   - `queryDeviceRelationsSchema`: Validasi parameter query filter.

5. **Service Relasi Perangkat (`src/services/device-relations.service.ts`)**:
   - `createDeviceRelation`: Validasi keberadaan perangkat, validasi hierarki tipe, deteksi siklus `detectHierarchyCycle`, upsert ke tabel relasi, dan sinkronisasi otomatis kolom `parentId` di `network_infrastructure`.
   - `getDeviceRelations`: Mengambil daftar relasi terindeks dengan informasi nama dan tipe perangkat induk & anak.
   - `updateDeviceRelation` & `deleteDeviceRelation`: Modifikasi dan pembersihan relasi secara aman.
   - `getDeviceAncestors`: Traversal rekursif silsilah leluhur perangkat ke atas sampai ke root.
   - `getDeviceHierarchyTree`: Membangun representasi pohon hierarkis bersarang (nested tree) dari root ke child nodes.

6. **Endpoint API Backend**:
   - `GET /api/devices/relations`: List relasi perangkat dengan dukungan filter (terproteksi `withApiSession`).
   - `POST /api/devices/relations`: Pembuatan relasi baru dengan validasi Zod & siklus (terproteksi `withApiSession`).
   - `PATCH /api/devices/relations/[id]`: Pembaruan status/port relasi (terproteksi `withApiSession`).
   - `DELETE /api/devices/relations/[id]`: Penghapusan relasi dan pembersihan parentId (terproteksi `withApiSession`).
   - `GET /api/devices/hierarchy/tree`: Endpoint pembacaan struktur pohon relasi perangkat.

---

## 4. Bukti Verifikasi Mandiri (*Evidence Before Assertions*)
1. **Unit Testing (`node --test tests/device-parent-child-schema.test.mjs`)**:
   - 7/7 test lulus 100% (durasi: 96ms).
2. **Regression Testing Topologi & Hierarki Peta**:
   - 71/71 test unit terkait topologi, jalur kabel, dan hierarki lulus 100% (durasi: 310ms).
3. **Pemeriksaan Tipe TypeScript (`npm run typecheck`)**:
   - `Generating route types...`
   - `✓ Types generated successfully`
   - 0 error TypeScript.
4. **Pemeriksaan Linter (`npx eslint ...`)**:
   - 0 error, 0 warning.
5. **Database PostgreSQL Migration (`npm run db:migrate`)**:
   - `PostgreSQL migrations applied.`
   - Tabel `network_device_relations` terpasang secara fisik di PostgreSQL.
