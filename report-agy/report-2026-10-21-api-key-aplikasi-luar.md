# API key untuk aplikasi luar (2026-10-21)

## Permintaan
Semua data aplikasi ke database + API key supaya aplikasi lain bisa menarik data NOC.
Keputusan user: API key dulu (data localStorage dipindah bertahap), akses baca + tulis,
semua dataset tanpa rahasia.

## Perubahan
- `src/db/schema/api-keys.ts` + `drizzle/0030_api_keys.sql`: tabel `api_keys` (hash SHA-256,
  prefix, akses `read`/`read-write`, pemilik, terakhir dipakai, dicabut).
- `src/services/api-keys.service.ts`: buat (key `noc_` 256 bit, tampil sekali), daftar, cabut,
  cari pemilik (tolak key dicabut / akun diblokir).
- `src/lib/api.ts`: `withApiSession` menerima `Authorization: Bearer noc_...`, bertindak sebagai
  pemilik key; key `read` menolak metode selain GET/HEAD/OPTIONS; cek Origin dilewati hanya untuk key.
- `src/lib/permissions.ts`: izin `apiKey:manage` (admin saja).
- `src/app/api/api-keys/route.ts`, `[id]/route.ts`: GET/POST/DELETE, hanya dari sesi login, tercatat di audit.
- `src/app/api/v1/data/route.ts` + `src/services/external-data.service.ts`: tarik 28 dataset
  dengan paginasi `limit`/`offset`; `password_enc` dan `cpe_tasks.payload` dibuang; tabel akun,
  sesi, kredensial billing, web-ONT, catatan tidak ada.
- `src/app/(protected)/app/api-key/page.tsx`, `src/components/dashboard/api-key-board.tsx`,
  menu "API Key" di `app-nav.tsx`.
- `docs/noc/api-key.md`, bullet AGENTS.md, `tests/api-keys.test.mjs`.

## Bukti uji
- `npm run typecheck`: 0 error.
- `npx eslint <file yang diubah>`: 0 error.
- `npm test`: 2121 tes, 2066 lulus, 55 gagal. Tes baru `API key: baca data tanpa rahasia,
  hanya-baca menolak tulis, cabut berlaku` lulus. 55 yang gagal tidak menyentuh file ini
  (assertion lama jumlah migrasi 15, snapshot 0023 hilang, kolom `olts`, modul peta yang sedang
  diubah di working tree).
- Docker: lihat bagian bawah.

## Batas
- Belum ada rate limit per key dan filter `updatedSince`.
- Data di localStorage (alert ditangani, ambang, WhatsApp, tiket, mismatch, anomali, mapping ONU,
  riwayat diagnosa CPE, pengaturan app) belum di DB, jadi belum bisa ditarik.
