# API key untuk aplikasi luar

Aplikasi lain menarik (atau mengubah) data NOC dengan API key, tanpa login.

## Membuat key

Admin (izin `apiKey:manage`) buka menu **API Key** (`/app/api-key`), isi
nama aplikasi, pilih akses, klik **Buat key**. Key (`noc_...`) tampil SEKALI;
database hanya menyimpan hash SHA-256-nya (`api_keys.key_hash`). **Cabut** membuat
key langsung ditolak (401); baris tetap ada untuk jejak.

- `read` (Hanya baca): cuma GET/HEAD/OPTIONS. Metode lain 403 `READ_ONLY_API_KEY`.
- `read-write` (Baca + tulis): boleh POST/PUT/PATCH/DELETE ke API yang ada, sebatas
  peran akun pembuat key (dibaca ulang dari `user.role` tiap permintaan).
- Key bertindak sebagai pembuatnya: jejak audit mencatat akun itu. Akun diblokir =
  key-nya ikut ditolak.
- Key tidak bisa membuat, melihat, atau mencabut key (`/api/api-keys` butuh sesi
  login, 403 `SESSION_REQUIRED`).

## Memakai key

Kirim header `Authorization: Bearer <key>` ke endpoint mana pun yang memakai
`withApiSession`/`withApiPermission` (`src/lib/api.ts`). Pemeriksaan Origin tidak
berlaku untuk key, karena browser tidak pernah mengirim header itu sendiri.

Tarik data massal per tabel:

```http
GET /api/v1/data
→ { "data": ["routers", "olts", "customers", ...] }

GET /api/v1/data?dataset=customers&limit=500&offset=0
→ { "data": [ ...baris... ],
    "meta": { "dataset": "customers", "limit": 500, "offset": 0, "nextOffset": 500 } }
```

`limit` 1–1000 (bawaan 100). Ulangi dengan `offset=nextOffset` sampai `nextOffset`
bernilai `null`. Urutan stabil menurut kunci utama tabel.

Endpoint lain tetap bisa dipakai dengan key, mis. `GET /api/routers`,
`GET /api/customers`, `GET /api/alerts`, `POST /api/alerts/{id}/handle` (key
`read-write`).

## Yang TIDAK pernah keluar

Daftar dataset ada di `src/services/external-data.service.ts`. Dibuang: kolom
`password_enc` router/OLT, `payload` tugas CPE (bisa memuat sandi WiFi baru).
Tidak ada sama sekali: `user`, `account`, `session`, `verification`, `api_keys`,
`billing_credentials`, `ont_web_settings`, `notes`, dan tabel internal (migrasi,
onboarding, pelacakan seed). Tabel baru TIDAK otomatis ikut; tambahkan ke daftar
itu dengan sengaja dan buang kolom rahasianya.

## Batas yang diketahui

- Belum ada pembatas laju per key; aplikasi luar sebaiknya menarik bertahap.
- Belum ada filter `updatedSince`; sinkron bertahap harus menarik ulang per halaman.
- Ambang (`alert-thresholds`) dan alert ditangani (`alerts`, kolom `handledBy`/
  `handledAt`) sudah di database. Yang masih di `localStorage` peramban
  (pengaturan WhatsApp, tiket alert, catatan mismatch billing, status anomali,
  mapping ONU, riwayat diagnosa CPE, pengaturan aplikasi) belum bisa ditarik.
