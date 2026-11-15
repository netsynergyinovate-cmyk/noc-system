# Bootstrap router: saran IP server salah di Docker (read ECONNRESET)

## Gejala
Langkah 3 "Masuk & periksa" -> `read ECONNRESET`. UI menyarankan allow-list `10.0.5.6`.

## Akar masalah
- ECONNRESET = router menerima TCP port API lalu me-reset: IP sumber tidak ada di `/ip service api address=`.
- `outboundSourceIp` memakai `socket.localAddress`. Di container (Coolify) itu IP container `10.0.5.6`, yang tidak pernah dilihat router (Docker SNAT ke IP host). Saran allow-list jadi salah.
- Go `netsource.SourceIP` sudah benar (router publik -> IP publik); jalur TS bootstrap tidak memakainya.

## Perubahan
- `src/services/outbound-source-ip.ts`: `publicIp()` (dipindah dari prepare route), `inContainer` (`/.dockerenv`, `/run/.containerenv`), `isPrivateHost`, `pickRouterSourceIp` (aturan Go + container = null untuk router privat), `routerSourceIp`.
- `bootstrap/_shared.ts` `failure()` dan `router-provision.service.ts` `resolveServerIp` memakai `routerSourceIp`.
- `bootstrap/prepare/route.ts`: `localIp` null di container, kirim `inContainer`.
- `router-bootstrap-panel.tsx`: label "lokal tidak diketahui (container)", label perkiraan yang jujur, perintah log firewall sementara (action=log) untuk membaca src-address pasti, `connection print` difilter `protocol=tcp`.

## Bukti uji
- `npm run typecheck`: 0 error.
- `npx eslint` (5 berkas): 0 error.
- `node --test tests/router-source-ip.test.mjs tests/router-discovery.test.mjs`: 16 pass, 1 fail.
  - Gagal `CONNECTION_CLOSED menyertakan IP publik DAN IP LAN server` juga gagal di HEAD (versi tes HEAD: 8 pass 1 fail); `connection-error-notice.tsx` tidak diubah.
- `docker compose build app`: belum dijalankan.

## Catatan lapangan
Output `/ip firewall connection print where dst-port=8728` pengguna hanya berisi UDP pelanggan (172.16.15.x) ke internet, tanpa TCP dari server: pakai rule log untuk menangkap src-address sebenarnya.

## Lanjutan: pesan galat jelas (bukan "read ECONNRESET")
- Bukti lapangan (log APP-API): server di belakang router yang sama lewat PPPoE `17060001092`, router melihat `172.16.15.254`, bukan `103.167.70.136` (IP router sendiri). Allow-list tidak memuatnya, sehingga router me-reset.
- `src/lib/mikrotik/api-client.ts`: ECONNRESET/EPIPE dan soket ditutup router dipetakan ke pesan `REJECTED` (allow-list api, catatan PPPoE/LAN, max-sessions, reject tcp-reset) + kode asli.
- `bootstrap/_shared.ts`: galat jaringan menambahkan `Tujuan: host:port.`
- Panel: poin "Koneksi ditutup" menyebut PPPoE/LAN dan sesi penuh.
- Uji: `npx tsc --noEmit` exit 0; eslint 3 berkas exit 0; `tests/router-api-client.test.mjs` 5/5 (tes baru reset setelah connect); router-source-ip + server-cli-bootstrap 14 pass 1 fail (baseline lama); graphify update exit 0. Docker build belum.

## Lanjutan 2: kartu penyebab + perintah MikroTik
- `api-client.ts`: kode baru `CONNECTION_RESET` (ECONNRESET/EPIPE/close), pesan singkat "Router memutus koneksi API (...)".
- `_shared.ts`: CONNECTION_RESET dihitung galat jaringan (sourceIp + Tujuan host:port).
- Panel: state `errorCode`; untuk CONNECTION_RESET tampil kartu `ResetHelp` di langkah 3 (1. allow-list: print, rule log, set address IP_SERVER; 2. sesi API penuh; 3. rule reject input). Blok perkiraan IP + log di langkah 2 disembunyikan untuk kode ini agar tidak dobel.
- Uji: tsc 0, eslint 0, node --test 3 berkas 19 pass 1 fail (baseline CONNECTION_CLOSED); graphify exit 0. Belum dicek visual di browser; Docker build belum.
