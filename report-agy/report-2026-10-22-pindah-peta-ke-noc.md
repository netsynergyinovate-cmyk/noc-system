# Pindah aplikasi peta ke NOC SYSTEM (2026-10-22)

Sumber: `E:\Halaman Maps\pages-maps\ngodingpakeai-starter` commit `a70f427`.

## Keputusan pengguna
- Semua halaman peta lama diganti.
- Data lama dimigrasi ke model baru. Saat diperiksa, DB live hanya berisi 0 `network_cables`, 0 `network_routes`, 0 `map_drawing_layers`, 2 `network_infrastructure`, dan 1 pelanggan berkoordinat. Perangkat dan pelanggan itu otomatis tampil di peta baru (dibaca langsung dari tabel NOC), jadi tidak ada skrip salin data.
- Edit di peta disimpan di lapisan `map_overrides`, bukan ditulis ke tabel inti NOC.

## Perubahan
- `src/services/map/`: logika server peta (adapter, central-mapper, topology, loss-budget, undo, geo, types). `client.ts` sekarang memanggil service NOC di proses yang sama (`readExternalDataset`, `listCpeDevices`, `getVlanPonTraffic`, `getRouterQueues`, `snapToRoads`), tanpa HTTP dan API key.
- `src/components/peta/`: 21 komponen UI peta (Leaflet).
- `src/app/api/peta/*`: 23 handler. GET memakai `withApiSession`; tulis memakai `withApiPermission({ map: ["manage"] })`.
- `src/app/(protected)/app/peta/`: halaman baru, mengisi layar di dalam AppShell.
- `src/lib/permissions.ts`: izin baru `map:manage` (admin ya, `user` tidak).
- Skema + migrasi `drizzle/0031_map_network.sql`: hanya CREATE untuk `map_devices`, `map_customers`, `cable_routes`, `cable_segments`, `cable_segment_samples`, `map_layers`, `map_overrides`, `map_undo_entries`. Tabel lokal `customers`/`network_devices` milik aplikasi peta diganti nama agar tidak bentrok dengan tabel inti.
- Dihapus: `/app/peta/{kabel,gambar,topologi}`, `/app/infrastruktur/peta`, `/app/pelanggan/peta`, `/app/kabel`, 13 komponen peta lama yang tidak terpakai lagi, `src/lib/map-auto-refresh.ts`, menu "Jalur Kabel" dan "Lapisan Gambar". Tautan "Lihat Peta" diarahkan ke `/app/peta`.
- Test: 7 test unit peta di-port (`tests/peta-*.test.mjs`, 41 kasus). Test yang subjeknya dihapus ikut dibuang atau dipangkas.

## Bukti uji
- `npm run typecheck`: lulus, 0 error.
- `npx eslint` berkas yang diubah: 0 error.
- `node --test tests/peta-*.test.mjs`: 41/41 lulus.
- `npm test` akhir: 2029 test, 1977 lulus, 52 gagal (HEAD: 2127/2071/56). Semua kegagalan sudah ada di HEAD, kecuali `audit-service-integration` yang gagal sekali di level berkas lalu lulus 3x saat dijalankan sendiri (flaky, tidak menyentuh kode peta).
- `npm run build`: sukses, rute `/app/peta` dan `/api/peta/*` terdaftar.
- `docker compose build migrator app`, migrator: "PostgreSQL migrations applied."; 8 tabel ada; app healthy; backend dan postgres tidak di-restart.
- `/app/peta` tanpa login 307 ke `/sign-in`; `/api/peta/data` tanpa login 401.

## Batasan
- `/app/topologi` (hierarchy-map-board) masih memakai komponen dan API `/api/map/*` lama. API lama yang tidak lagi punya pemakai UI (`config`, `data-source`, `drawing-layers`, `layers`, `legend`, `markers`, `unified`) belum dihapus.
- Koreksi di peta (lokasi, induk, port) tinggal di `map_overrides`; fitur NOC lain yang membaca `network_infrastructure` tidak melihatnya.
- Kabel yang dibuat lewat API lama tampil di peta baru sebagai jalur hanya-baca.
- Akun peran `user` bisa melihat peta, tetapi setiap aksi tulis ditolak 403 (tombol tetap tampil).
