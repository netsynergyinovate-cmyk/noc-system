# Tab CPE/ONT di halaman GenieACS (2026-11-14)

## Permintaan
Halaman GenieACS perlu tempat untuk memasangkan ONT pelanggan ke ACS, dengan nama tab "CPE/ONT".

## Temuan
- `GenieacsOltMatch` (daftar ONU OLT dicocokkan ke GenieACS lewat PPPoE/MAC, tombol "Pasang GenieACS" via web ONT, "atau via OLT" (telnet tr069-bind), "Daftarkan ke GenieACS" massal) masih utuh, tetapi yatim sejak commit `c2fcf99` mencopot tab "Cocokkan OLT".
- API-nya masih ada: `/api/ont-web/tr069`, `/api/olts/[id]/onus/[pon]/[onu]/tr069-bind`, hook `useLiveOnus`, `useGenieacsRegistry`.

## Perubahan
- `src/components/dashboard/genieacs-board.tsx`: tab baru `CPE/ONT` (value `cpe`) di antara Perangkat dan Konfigurasi. Isinya kartu panduan `genieacs-cpe-guide` (ACS URL dan Periodic Inform dari `/api/cpe/config`, yaitu Pengaturan "Pasang GenieACS"; 4 jalur: web ONT, OLT, massal, manual di modem; peringatan PPPoE bisa sambung ulang bila WAN TR-069 dibuat) dan `GenieacsOltMatch`.
- `src/components/dashboard/genieacs-olt-match.tsx`: tombol segarkan diberi `type="button"`, `aria-label`, dan `title`.
- Data OLT hanya dimuat saat tab dibuka, karena Radix TabsContent tidak me-mount tab yang tidak aktif.

## Uji
- `npm run typecheck`: 0 error.
- `npx eslint` pada 2 berkas: 0 error.
- `node --test tests/onu-inventory.test.mjs`: 17/17 lulus.
- `docker compose build app`: sukses (`Image nocsystem-app Built`). Container belum dijalankan dan tab belum dicek di peramban.

## Lanjutan: pengaturan GenieACS + tombol UI (2026-11-14)
### Simpan pengaturan "tidak bisa"
- Akar: kolom Alamat ACS kosong (yang terlihat `http://172.16.0.1:7547` hanya placeholder). Validasi URL gagal dan tombol membatalkan klik tanpa pesan (`if (!valid) e.preventDefault()`).
- Perbaikan `ont-web-settings-panel.tsx`: klik saat tidak valid menampilkan alasan (role=alert) "Isi Alamat ACS lengkap ... (teks abu-abu hanya contoh)" atau interval 30–86400; sandi GGCLink/F609 ikut dikosongkan setelah simpan.
### Pengaturan terpisah
- `OntWebSettingsDialog` (ikon ⚙ `btn-genieacs-settings`) di header halaman GenieACS, dibungkus `<Can to="manageCpe">` (API tetap `cpe:manage`). Simpan memuat ulang data halaman.
- Dialog per-ONT (`ont-web-dialog.tsx`) tidak lagi memuat form; hanya baris "ACS yang dipasang: ..." atau alasan blokir yang menunjuk ke ikon ⚙.
### Tab Konfigurasi
- `/api/cpe/config` menambah `tunnelHost` (host dari GENIEACS_TUNNEL_TARGET, tanpa user SSH) dan `uiUrl` (GENIEACS_UI_URL, disanitasi).
- Panel: "lewat tunnel SSH ke server <host>" (hanya developer) dan tautan "Buka GenieACS UI": GENIEACS_UI_URL, atau host halaman + port 7558 (dibaca saat klik).
- `compose.coolify.yaml`: UI GenieACS `7558:7558` (LAN, punya login sendiri). `compose.tunnel-server.yaml`: forward 7558. `.env.example`: GENIEACS_UI_URL.
### Uji
- Browser (localhost:3001, akun admin uji lokal sementara, sudah dihapus): ikon ⚙ tampil; dialog memuat pengaturan; simpan nilai valid -> "Pengaturan disimpan." (DB lokal, nilai sama); ACS kosong -> alert pesan; tab Konfigurasi menampilkan baris tunnel dan tautan UI.
- typecheck 0 error, eslint 0, genieacs-config-lib/env-example-reference/startup-validator/onu-inventory lulus.
- UI 7558 lewat tunnel: "administratively prohibited" sampai server redeploy + permitopen 7558.
