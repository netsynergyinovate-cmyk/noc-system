# Laporan Pengerjaan Task: Bangun Endpoint Daftar Pelanggan Berkoordinat

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/titik-pelanggan-di-peta/bangun-endpoint-daftar-pelanggan-berkoordinat`
- **Judul**: Bangun endpoint daftar pelanggan berkoordinat
- **Fitur**: Titik Pelanggan di Peta
- **Fase**: 2, **Layer**: backend
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Workspace ID**: `694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd`

---

## 2. Ringkasan Perubahan Teknis
Telah dibangun endpoint backend dan service untuk menyajikan daftar seluruh pelanggan yang memiliki titik koordinat geografis sah (`latitude` dan `longitude` tidak bernilai null) langsung dari basis data PostgreSQL operasional melalui Drizzle ORM:

1. **Validator Query (`src/validators/customer-location.ts`)**:
   - `geocodedCustomersQuerySchema`: Memvalidasi parameter URL query:
     - `status`: Enum (`"all" | "online" | "offline" | "weak" | "isolir"`), default `"all"`.
     - `odp`: String opsional untuk filter nama ODP induk.
     - `search`: String opsional untuk pencarian nama pelanggan, username PPPoE, atau alamat.
     - `routerId`: ID router penyedia layanan.
     - `limit`: Integer positif (maksimal 1000, default 500).
     - `offset`: Non-negatif integer (default 0).
     - `forceMock`: Boolean opsional untuk pengujian/lingkungan simulasi.

2. **Domain Service (`src/services/customer-location.service.ts`)**:
   - Fungsi `getGeocodedCustomers(query)`:
     - Melakukan query PostgreSQL Drizzle dengan filter `isNotNull(customers.latitude)` dan `isNotNull(customers.longitude)`.
     - Melakukan `leftJoin` ke tabel `routers` (untuk informasi router pemancar) dan `oltOnus` (untuk telemetri optik serial ONU, port PON, rxPower).
     - Menghitung agregasi ringkasan (*summary*): `totalGeocoded`, `onlineCount`, `offlineCount`, `weakOpticalCount` (daya optik $\le -24.5\text{ dBm}$), dan `isolirCount`.
     - Menyediakan metadata transparan `dataSource` (`provider: "PostgreSQL Live"`, `isRealData: true`, `lastSynchronizedAt`).
     - Menyediakan penanganan graceful fallback ke mock lokal terfilter apabila koneksi database offline di lingkungan pengembangan non-produksi.

3. **HTTP API Routes**:
   - `GET /api/customers/geocoded` (`src/app/api/customers/geocoded/route.ts`):
     - Rute utama berproteksi sesi (`withApiSession`).
     - Memvalidasi query params, memanggil `getGeocodedCustomers`, dan mengembalikan JSON `{ ok: true, success: true, data, summary, dataSource }`.
   - `GET /api/map/customers` (`src/app/api/map/customers/route.ts`):
     - Alias endpoint terpadu untuk modul peta.
   - `GET /api/customers?geocoded=true` (`src/app/api/customers/route.ts`):
     - Mempertahankan backward compatibility untuk konsumen lama dengan parameter `geocoded=true`.

---

## 3. Bukti Pengujian Mandiri (Evidence Before Assertions)
1. **TypeScript Typecheck**:
   - Perintah: `npm run typecheck`
   - Hasil: **Exit Code 0** (0 error, rute Next.js terkompilasi bersih).
2. **ESLint**:
   - Perintah: `npx eslint src/app/api/customers/geocoded/route.ts src/app/api/map/customers/route.ts src/app/api/customers/route.ts src/services/customer-location.service.ts src/validators/customer-location.ts`
   - Hasil: **Exit Code 0** (0 error, 0 warning).
3. **Unit & Integration Test**:
   - Perintah: `node --test tests/geocoded-customers-endpoint.test.mjs`
   - Hasil: **11 pass, 0 fail** (Proteksi 401 unauthorised, validasi Zod query schema, ekstraksi koordinat, filter status online/offline/isolir/weak, filter odp & search, dan pagination limit/offset).
4. **Regresi Peta**:
   - Perintah: `node --test tests/map-markers-route.test.mjs tests/real-map-markers-service.test.mjs tests/pelanggan-peta-page.test.mjs tests/infrastructure-move-and-delete.test.mjs`
   - Hasil: **27 pass, 0 fail**.

---

## 4. Kepatuhan Zero-Dummy & Boundaries
- Koordinat pelanggan yang disajikan murni berasal dari kolom `latitude` dan `longitude` tabel `customers` di PostgreSQL.
- Metadata `dataSource` secara transparan mencantumkan status `isRealData: true` dan provider riil.
- Berkas sesi aktif pengguna (`customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tidak disentuh.
