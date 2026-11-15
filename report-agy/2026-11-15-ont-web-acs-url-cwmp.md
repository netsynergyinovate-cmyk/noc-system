# Pasang GenieACS lewat web ONT: ACS URL harus CWMP yang dicapai modem

Tanggal: 2026-11-15

## Gejala

Modem PEMERINTAH DESA TUNGGAL JAYA (PPPoE `17060001824@runsnet.id`, SN `D0:5F:AF:D3:C7:1D`,
CDTC 15CR, IP `172.16.15.251`): dialog menulis "Modem sudah memakai pengaturan ini; tidak ada
yang diubah", tetapi modem tidak pernah muncul di GenieACS.

## Akar masalah

1. **ACS URL salah tersimpan.** Dialog menampilkan `ACS yang dipasang: http://genieacs:7557`.
   Nilai itu dibaca dari `ont_web_settings.acs_url` (isian ikon ⚙ / impor konfigurasi). `genieacs`
   adalah nama layanan di jaringan Docker (tidak bisa di-resolve modem) dan `7557` adalah port NBI
   (API, sama dengan `GENIEACS_NBI_URL` di `compose.coolify.yaml`), bukan CWMP `7547`.
   Validasi lama (Go `ValidateACSURL`, Zod `ontWebSettingsSchema`, regex panel ⚙) hanya memeriksa
   skema `http(s)` dan tanpa user, jadi nilai ini lolos.
2. **Sukses palsu.** Driver FD511GW membandingkan isian modem dengan pengaturan; karena modem
   sudah diberi URL yang sama (salah) sebelumnya, `Changed=false` dan pesan hijau terdengar seperti
   "sudah beres". Tidak ada pengecekan ke GenieACS.

## Perubahan

- `backend/internal/ontweb/config.go` `ValidateACSURL`: tolak host tanpa domain (nama layanan
  Docker), `localhost`/`*.localhost`, loopback/unspecified (`127.x`, `0.0.0.0`, `::1`), dan port
  NBI/UI/FS GenieACS (`7557`, `7558`, `7567`). Pesan menyebut alasannya.
- `backend/internal/httpapi/ontweb.go`: validasi dipindah dari `loadFromDB` ke `install`; nilai
  salah dijawab `409 acs_url_invalid` dengan pesan untuk petugas SEBELUM login ke modem (dulu
  500 `internal` tanpa penjelasan). Pesan "tidak ada yang diubah" kini menyatakan itu belum bukti
  modem melapor. Jawaban memuat `acsUrl`.
- `src/lib/genieacs/acs-url.ts` (baru) `acsUrlProblem`: aturan yang sama di TS, dipakai
  `ontWebSettingsSchema` (server) dan panel ⚙ (pesan merah di bawah isian + catatan CWMP 7547 vs
  NBI 7557).
- `src/lib/dashboard/onu-inventory.ts` `informEvidence` + `lastInformAt` di `CpeLite`
  (`use-genieacs-registry.ts`): status dari daftar GenieACS (pencocokan PPPoE/MAC yang sama dengan
  kolom "Terdaftar"): `informing` hanya bila perangkat ada dan `_lastInform` dalam 15 menit;
  selain itu `stale` / `missing` / `loading` / `unreadable`.
- `src/components/dashboard/ont-web-dialog.tsx`: blok "Status di GenieACS" + tombol
  "Periksa GenieACS" (memuat ulang registry, `finally`), daftar penyebab bila belum melapor
  (menunggu inform pertama, ACS tak terjangkau dari jaringan pelanggan / port 7547, WAN TR-069
  belum ada, tidak cocok PPPoE/MAC). Tombol Pasang diblok bila ACS tersimpan tidak sah. Pesan
  hasil pasang tidak lagi hijau; hijau hanya untuk bukti inform.

## Bukti uji

```
go test ./internal/ontweb/ ./internal/httpapi/ ./internal/cpe/   -> ok (3 paket)
  TestValidateACSURL (genieacs:7557, genieacs:7547, localhost, 127.0.0.1, [::1], :7557/:7558/:7567)
  TestOntWebRejectsUnreachableACSURL (409 acs_url_invalid, 0 login modem)
  TestOntWebUnchangedIsNotClaimedConnected
node --test tests/ont-web-validator.test.mjs tests/onu-inventory.test.mjs -> 27/27 lulus
npm run typecheck -> 0 error
npx eslint <7 berkas src yang diubah> -> 0 error
```

`tests/onu-mapping-endpoint.test.mjs` gagal bila dijalankan langsung dengan `node --test`
(`ERR_MODULE_NOT_FOUND src/lib/auth.ts`, butuh loader `scripts/test.mjs`); tidak terkait.

## Tindakan operator (belum dilakukan, butuh izin)

1. Buka ⚙ Pengaturan di `/app/genieacs`, ganti Alamat ACS ke URL CWMP yang dicapai modem dari
   172.16.15.x, mis. `http://<IP server/NAT yang terlihat dari jaringan pelanggan>:7547`
   (GenieACS lokal lama memakai `http://172.16.0.1:7547`). Panel sekarang menolak `genieacs:7557`.
2. Pastikan port 7547 GenieACS server (Coolify) terjangkau dari jaringan pelanggan
   (route/NAT/firewall CORE CIARA).
3. Pasang ulang modem 172.16.15.251, lalu "Periksa GenieACS" sampai status "Terbukti melapor".

## Belum diverifikasi

- `docker compose build app` / `npm run build` tidak dijalankan; UI dialog belum dilihat di
  peramban.
- Konfigurasi produksi (isi `ont_web_settings`, port 7547 di server) tidak disentuh.
