# Router tidak langsung tersambung setelah mati listrik (EOF)

## Gejala
Banner "Mikrotik CORE CIARA tidak terjangkau: Router menutup koneksi", `hubungi router: EOF`,
gagal 3441× berturut-turut (~2 jam pada polling 2 dtk), lalu pulih sendiri.

## Akar masalah (hipotesis terkuat, belum dibuktikan di router)
- RouterOS membatasi tiap layanan `/ip service` ke `max-sessions` (bawaan 20, dokumentasi MikroTik "Services").
- Transport REST backend (`defaultRouterTransport`, `backend/internal/collector/fleet.go`) memakai
  `MaxIdleConnsPerHost: 20` tanpa `MaxConnsPerHost`: backend bisa memegang seluruh 20 slot www.
- Saat server/link mati tanpa FIN, sesi itu tetap tercatat di router sampai keepalive TCP router
  habis (Linux bawaan 7200 dtk + probe ≈ 2 jam, cocok dengan 3441 × 2 dtk). Sambungan baru diterima
  lalu langsung ditutup = EOF.
- Allow-list /24 untuk IP privat (tahan perubahan DHCP) sudah ada sebelumnya, jadi IP berubah bukan penyebabnya.

## Perubahan
- `fleet.go`: `routerMaxConns = 6`, dipakai untuk `MaxConnsPerHost` dan `MaxIdleConnsPerHost`.
  Sesi basi maksimal 6, 14 slot tersisa, sehingga backend langsung tersambung lagi.
- `src/lib/dashboard/router-health.ts`: petunjuk EOF kini menyebut sesi basi dan cara membuangnya
  (`/ip service disable www` lalu `/ip service enable www`), dan tidak lagi memastikan IP belum diizinkan.

## Bukti uji
- `go test ./internal/collector/ ./internal/routerproxy/ -count=1`: ok (termasuk
  `TestDefaultHTTPClientCapsConnectionsPerRouter`: 20 permintaan serentak, koneksi puncak ≤ 6).
- `node --test tests/router-health.test.mjs`: 7 pass, 0 fail.
- `npx eslint src/lib/dashboard/router-health.ts`: 0 error. `npm run typecheck`: lulus.
- `docker compose build app`: TIDAK dijalankan (Docker Desktop mati di PC dev).

## Verifikasi di lapangan
Saat kejadian berikutnya, sebelum disable/enable:
`/ip firewall connection print count-only where protocol=tcp dst-port=80` dan
`/ip service print detail where name=www` (lihat max-sessions).
