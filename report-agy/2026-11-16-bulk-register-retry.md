# 2026-11-16 — Daftar massal GenieACS: ulang galat jaringan, lanjut bila login ditolak

## Masalah
Dialog "Daftarkan N perangkat ke GenieACS" (metode web ONT) berhenti total setelah satu
modem menolak login admin ("Putaran dihentikan: Nama pengguna atau kata sandi admin modem
salah"): 0 berhasil, 1 gagal, sisanya dilewati. Pengguna minta: gagal diulang 3 kali, lalu
lanjut.

## Keputusan
- Login ditolak/terkunci/kredensial kosong TIDAK diulang (modem mengunci setelah 3 login
  salah). Sisa modem merek yang sama dilewati (kredensial bawaan per merek), merek lain lanjut.
- Galat sementara (timeout, tak terjangkau, sesi sibuk, gagal umum, cari IP gagal, backend /
  server tak terjangkau) diulang sampai 3 kali (jeda 3 dtk), lalu lanjut.
- Galat yang berlaku untuk semua modem (ACS belum diatur / ACS URL tidak sah, backend belum
  dikonfigurasi, 403) tetap menghentikan putaran. `acs_url_invalid` baru ditambahkan.
- Galat lain (pelanggan offline, ONU belum dipetakan, bukan modem yang dikenal) = lanjut.

## Berkas
- `src/lib/dashboard/onu-inventory.ts`: `BULK_ATTEMPTS`, `bulkFailureAction(code, status)`.
- `src/components/dashboard/bulk-register-dialog.tsx`: loop ulang + lewati merek; teks
  pernyataan diperbarui.
- `tests/onu-inventory.test.mjs`: tes `bulkFailureAction`.

## Bukti uji
- `node --test tests/onu-inventory.test.mjs`: 19/19 lulus.
- `npx tsc --noEmit -p .`: exit 0. `npx eslint` dua berkas: bersih.

## Belum
- Belum dicoba di browser, belum di-build Docker, belum di-deploy.
- Akar kegagalan login: kredensial admin bawaan merek yang gagal di Pengaturan GenieACS ⚙
  salah/berbeda dari modem; perlu dicek pengguna.
