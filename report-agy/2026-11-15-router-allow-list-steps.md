# Notifikasi router diputus: perintah yang benar + tombol Salin

## Gejala
`read tcp 10.0.5.5:53026->103.167.70.136:80: connection reset by peer`, 114× berturut-turut.
Notifikasi menyarankan `/ip service set www address=103.167.70.136/32,10.0.5.0/24`, dan tombol Salin tidak bekerja.

## Akar masalah
- `103.167.70.136` adalah IP router CORE CIARA sendiri. Server keluar ke internet lewat router itu
  (PPPoE `17060001092`), jadi ipify mengembalikan IP router. Router tidak pernah melihat server dengan IP itu.
- `10.0.5.x` adalah IP container Coolify (berganti tiap redeploy: .2 lalu .5). Docker men-SNAT-nya, jadi router juga tidak pernah melihatnya.
- Bukti lapangan 14-11: router melihat server sebagai `172.16.15.254` (alamat PPPoE). Perintah lama MENGGANTI
  address= dengan dua IP yang salah, sehingga memutus akses yang benar. IP PPPoE juga bisa berganti setelah mati listrik.
- Tombol Salin memakai `navigator.clipboard`, yang hanya ada di secure context. Dasbor dibuka lewat http://IP, jadi galatnya ditelan diam-diam.

## Perubahan
- Go `internal/netsource`: IP publik yang sama dengan IP router tidak dipakai (`usablePublic`), dan IP lokal kosong di dalam container (`/.dockerenv`).
- `router-health.ts`: sebab `closed` kini punya 3 langkah:
  1. Baca IP server menurut router: `/ip firewall connection print where protocol=tcp and dst-address~"HOST:PORT\$"` (hanya baca).
  2. Kolom isian IP (divalidasi IPv4) yang menyusun perintah TAMBAH:
     `/ip service set www address=([/ip service get www address],"172.16.15.0/24")`. Entri lama tetap. IP privat ditulis /24 supaya tahan perubahan IP PPPoE/DHCP.
  3. Buang sesi basi: `/ip service disable www` lalu `/ip service enable www`.
- `src/lib/clipboard.ts`: memakai `navigator.clipboard` bila tersedia, kalau tidak fallback `execCommand` dengan textarea di dalam popover. Tombol menampilkan Tersalin atau Gagal.
- `notification-bell.tsx`: langkah bernomor, tombol Salin per perintah, "Salin pesan untuk admin". Tombol Panduan yang tidak perlu dan pembacaan address= lama (gagal saat router menolak) dihapus.

## Bukti uji
- `go test ./internal/netsource/ ./internal/wire/ ./internal/routerproxy/`: ok.
- `node --test tests/router-health.test.mjs`: 8 pass 0 fail (termasuk penolakan masukan berbahaya seperti `1.2.3.4"; /system reboot`).
- `tests/router-source-ip.test.mjs`: 1 fail yang sama juga terjadi di HEAD bersih (baseline `CONNECTION_CLOSED`).
- eslint 3 berkas: 0 error. `npm run typecheck`: lulus. `npm run build`: lulus.
- Belum dicek visual di browser (lonceng hanya muncul di mode live dengan router mati). Docker build belum dijalankan.

## Batas
- Aplikasi tidak bisa membuka akses router sendiri, karena router menolaknya sebelum login. Langkah 1 dan 2 wajib dijalankan di router.
- Agar permanen setelah mati listrik, beri akun PPPoE server IP tetap (`/ppp secret ... remote-address=`) di luar pool, atau biarkan entri /24.
