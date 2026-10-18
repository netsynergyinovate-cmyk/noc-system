# Laporan Pengerjaan Task: Bangun Endpoint Simpan Koreksi Koordinat Pelanggan

## 1. Identitas Task
- **Ref**: `peta-pelanggan-amp-topologi-jaringan/titik-pelanggan-di-peta/bangun-endpoint-simpan-koreksi-koordinat-pelanggan`
- **Judul**: Bangun endpoint simpan koreksi koordinat pelanggan
- **Fitur**: Titik Pelanggan di Peta
- **Fase**: 2, **Layer**: backend
- **Plan ID**: `409c8d5c-8560-44f7-9ccf-bb3ce0b765f9`
- **Workspace ID**: `694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd`

---

## 2. Ringkasan Perubahan Teknis
Telah dibangun endpoint backend dan service untuk menyimpan koreksi posisi koordinat pelanggan (`latitude` & `longitude`) ke basis data PostgreSQL operasional dengan proteksi sesi dan jejak audit:

1. **Validator Fleksibel (`src/validators/customer-location.ts`)**:
   - `updateCustomerLocationSchema` dengan preprocessor Zod:
     - Menerima format standar `{ latitude, longitude }` maupun alias Leaflet `{ lat, lng }`.
     - Menerima string numerik (misal `"-2.578611"`).
     - Menjamin batasan bola bumi yang ketat: $-90 \le \text{latitude} \le 90$ dan $-180 \le \text{longitude} \le 180$.

2. **Domain Service & Audit Trail (`src/services/customer-location.service.ts`)**:
   - Fungsi `updateCustomerLocation(customerId, input, actorUserId)`:
     - Mendukung lookup baik berbasis UUID `customers.id` maupun `customers.pppoeUsername`.
     - Melakukan `UPDATE customers SET latitude = ..., longitude = ..., last_updated_at = NOW() WHERE id = ... RETURNING ...` menggunakan Drizzle ORM.
     - Menyimpan entri jejak audit ke tabel `auditLog` (`action: "update_customer_location"`, `target: customer:${customerId}`, koordinat lama dan baru).
     - Menyediakan fallback memori aman di lingkungan pengembangan non-produksi untuk kelancaran sesi pengujian simulasi.

3. **HTTP API Routes**:
   - `src/app/api/customers/[id]/location/route.ts`:
     - Mendukung metode HTTP `PATCH`, `PUT`, `POST` berproteksi sesi pengguna `withApiSession`.
     - Mengembalikan pesan keberhasilan Bahasa Indonesia dan objek koordinat terbarui.
   - `src/app/api/map/customers/[id]/location/route.ts`:
     - Endpoint alias terdedikasi untuk lapisan peta (`GET`, `PATCH`, `PUT`, `POST`).
   - `src/app/api/customers/[id]/route.ts`:
     - Mendukung metode `PATCH` langsung untuk pembaruan koordinat titik pelanggan.

---

## 3. Bukti Pengujian Mandiri (Evidence Before Assertions)
1. **TypeScript Typecheck**:
   - Perintah: `npm run typecheck`
   - Hasil: **Exit Code 0** (0 error).
2. **ESLint**:
   - Perintah: `npx eslint "src/validators/customer-location.ts" "src/services/customer-location.service.ts" "src/app/api/customers/[id]/location/route.ts" "src/app/api/map/customers/[id]/location/route.ts" "src/app/api/customers/[id]/route.ts"`
   - Hasil: **Exit Code 0** (0 error, 0 warning).
3. **Unit & Integration Test**:
   - Perintah: `node --test tests/customer-location-correction-endpoint.test.mjs`
   - Hasil: **6 pass, 0 fail**.
4. **Regresi Seluruh Fitur Pelanggan & Peta**:
   - Perintah: `node --test tests/customer-location-correction-endpoint.test.mjs tests/customer-search-filter-endpoint.test.mjs tests/customer-detail-endpoint.test.mjs tests/geocoded-customers-endpoint.test.mjs tests/customer-drag-and-save-location.test.mjs tests/customer-detail-panel.test.mjs`
   - Hasil: **49 pass, 0 fail**.

---

## 4. Kepatuhan Zero-Dummy & Boundaries
- Koreksi koordinat disimpan langsung ke tabel `customers` kolom `latitude` dan `longitude` di database PostgreSQL.
- Jejak perubahan dicatat ke `audit_log`.
- Berkas sesi pengguna aktif (`customer-map.tsx`, `settings-board.tsx`, `cpe-board.tsx`) tidak disentuh.
