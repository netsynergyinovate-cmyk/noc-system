# Laporan 2026-10-22: Dokumentasi bedah aplikasi

## Hasil
- Dokumen baru: `docs/DOKUMENTASI-APLIKASI.md` (874 baris).
- Isi: arsitektur & alur data, jaringan fisik, integrasi perangkat (MikroTik REST, OLT telnet, web modem,
  GenieACS, NetFlow, billing), backend Go (startup, paket, rule engine, protokol WebSocket, REST),
  server Next.js (auth, 181 route, service), database (tabel, migrasi 0000–0031, tumpang tindih),
  status 34 halaman (NYATA/SEBAGIAN/MOCK), checklist fitur per modul, temuan berprioritas P0–P3,
  peta jalan Fase 0–4, infrastruktur & tes, lampiran env.

## Metode
- 4 agen baca-saja paralel: frontend, API/service/DB, backend Go, infra/tes/utang.
- Klaim kritis diverifikasi langsung (nilai rahasia disamarkan, tidak dicetak):
  - `src/app/api/settings/role/route.ts`: POST hanya `withApiSession`, body kosong = admin.
  - `scripts/inspect-mikrotik-vlans.mjs`, `probe-mikrotik-bgp.mjs`, `test-iface-rates.mjs`: `secretKey` tertulis bersama sandi terenkripsi.
  - `src/services/runsnet-billing.service.ts:13-14`, `src/lib/benchmark/auth.ts`: fallback kredensial/kunci di kode.
  - `dt-response-*.json`, `runsnet-*.html` ter-commit; remote `origin` ada.
  - `compose.yaml`: `5432:5432`, `8081:8081`, `4983:4983` tanpa ikat loopback.

## Bukti uji
- Pindai dokumen: tidak ada IP publik, token, atau sandi (hanya positif palsu pada slug anchor).
- 16 tautan anchor internal valid (skrip Node).
- Tidak ada kode yang diubah: typecheck/build/docker tidak relevan.

## Batasan
- Angka tes gagal (±52) diambil dari laporan 10-21/10-22, suite tidak dijalankan.
- Daftar API/service yatim berbasis grep import statis; URL dinamis bisa terlewat.
- Rotasi rahasia dan pembersihan riwayat git belum dilakukan: keputusan pemilik.
