# Ambang batas & alert ditangani ke database (2026-10-21)

## Temuan
- **Alert ditangani**: sudah di database pada mode live (default `compose.yaml`, container
  `DASHBOARD_DATA=live`). `LiveAlertSync` memasang `createLiveAlertActions`, yang memanggil
  `POST /api/alerts/{id}/handle`, lalu `markAlertHandled` mengisi `alerts.status='handled'`,
  `handled_by`, `handled_at`. localStorage `alertHandled` hanya dipakai mode demo untuk alert tiruan
  yang memang tidak punya baris DB. Tidak ada kode yang diubah untuk bagian ini.
- **Ambang batas**: tabel `alert_thresholds`, `GET/PUT/DELETE /api/thresholds`, dan pembacaan oleh
  Go (`LoadThresholdsFromDB` saat start) sudah ada, tetapi UI masih menyimpan ke localStorage
  `alertThresholds`. Akibatnya tabel kosong (0 baris).

## Perubahan
- `src/lib/dashboard/threshold-registry.ts`: sumber nilai diganti dari localStorage ke
  `/api/thresholds`. Snapshot `{ values, status }`; dimuat saat ada pelanggan pertama dan saat
  jendela kembali difokus; simpan/reset async; pesan Indonesia untuk 403 dan server tak terjangkau.
- `src/components/dashboard/threshold-settings.tsx`: simpan/reset async dengan `finally`; simpan dan
  reset diblokir sampai nilai DB termuat; galat muat ditampilkan dengan tombol "Coba muat lagi";
  galat simpan ditampilkan dan draft dipertahankan; teks kejujuran: tersimpan di DB, rule engine
  membacanya setelah backend di-restart.
- `e2e/thresholds.spec.ts`: tes registry memakai server palsu.
- `e2e/thresholds-ui.spec.ts`: login admin, cek tabel lewat API, kosongkan tabel sebelum tiap tes,
  tes server 500/abort/gagal muat, tes akun tanpa izin; tes khusus localStorage dihapus; jumlah tab
  disesuaikan ke 8 (sesuai `settings-board.tsx` di HEAD).
- Docs: AGENTS.md, `docs/noc/thresholds.md`, `docs/noc/api-key.md`.

## Bukti uji
- `npm run typecheck`: 0 error. `npx eslint` pada file yang diubah: 0 error.
- `npm run build`: sukses.
- E2E `e2e/thresholds.spec.ts` + `e2e/thresholds-ui.spec.ts`: **178 passed**. Dijalankan dengan
  config Playwright sementara yang hanya menyalakan server demo 3101 dengan `DATA_MODE=demo`, karena
  `npm run test:e2e` biasa gagal start di mesin ini: cek go-live di `src/instrumentation.ts`
  (`isLive` juga membaca `DATA_MODE`, kemungkinan dari `.env.local`). Masalah ini sudah ada sebelumnya.
- `docker compose build app` + `up -d --no-deps app`: sehat.
- Smoke test container live (API key sementara): GET bawaan, PUT cpu 70 menghasilkan 5 baris di
  `alert_thresholds` dan audit `update_thresholds`, DELETE mengembalikan ke 0 baris. Key sementara dihapus.

## Batas
- Go membaca ambang hanya saat start; perlu restart backend agar ambang baru dipakai.
- Sisa localStorage: pengaturan WhatsApp, tiket alert, catatan mismatch billing, status anomali,
  mapping ONU, riwayat diagnosa CPE, pengaturan aplikasi (`noc_app_settings`).
