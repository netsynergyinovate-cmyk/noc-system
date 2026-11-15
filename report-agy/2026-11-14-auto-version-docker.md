# Versi naik otomatis per redeploy (Docker/Coolify) + Docker lokal ke GenieACS server

## Versi
- Masalah: hanya deploy native (CLI) yang menaikkan versi; Coolify build dari git memakai package.json 1.0.0.0.
- `src/lib/app-version.ts`: `nextDeployVersion(last, pkg)`: package.json menang bila lebih tinggi, selain itu build +1.
- `src/services/build-version.service.ts`: `ensureBuildVersion()` saat start (instrumentation, setelah migrasi+seed): baca `.next/BUILD_ID`; bila belum tercatat (`deploy_runs.dijalankan_oleh = "build <id>"`), sisipkan baris deploy berhasil (otomatis) dengan versi berikutnya; pasang `process.env.APP_VERSION`. Dilewati bila APP_VERSION diisi, server native (/srv/noc/current), atau tanpa BUILD_ID (npm run dev).
- Tanpa migrasi. Batasan: dua instance start bersamaan bisa mencatat ganda.
- Uji: tests/app-version.test.mjs 9/9; tsc 0; eslint 0.

## Docker lokal ke GenieACS server
- compose.yaml: backend dapat GENIEACS_NBI_URL; app+backend `extra_hosts host.docker.internal:host-gateway`.
- .env: GENIEACS_NBI_URL=http://host.docker.internal:7558 (SSH tunnel ke 127.0.0.1:7557 server).

## Docker Desktop crash
- Galat: "initializing Inference manager ... remove ...\Docker\run\dockerInference: The file cannot be accessed by the system". Socket AF_UNIX rusak, muncul lagi tiap start.
- Tindakan: folder run dipindah (run.old-*), settings-store.json EnableDockerAI=false, EnableInference=false (cadangan settings-store.json.bak-20261114). Pengguna menjalankan factory reset 20:40.

## Perbaikan: versi tidak naik saat redeploy Coolify (2026-11-14, lanjutan)
- Akar masalah: Coolify memakai Docker build cache secara default (docs Coolify, "Build cache"; `SOURCE_COMMIT` sengaja dikeluarkan dari build). Redeploy commit yang sama memakai ulang layer `npm run build`, jadi `.next/BUILD_ID` sama dan penanda `build <BUILD_ID>` dianggap restart. Versi tetap.
- Perbaikan: `src/services/build-version.service.ts` memakai penanda `build <BUILD_ID> <os.hostname()>`. Di Docker, hostname = ID container, yang baru di setiap container yang dibuat ulang. Restart container yang sama tetap memakai versi yang sama.
- Bukti (Docker lokal, DB dengan riwayat 1.0.0.0):
  - container baru: `Versi aplikasi: 1.0.0.1` (penanda `build vSsrZeBVndK7eUXmeLmek 0a8633ac2cc0`)
  - `docker restart`: tetap `1.0.0.1`
  - `docker compose up -d --force-recreate app` (image sama, meniru cache Coolify): `1.0.0.2`
- typecheck 0 error, eslint 0 error, `tests/app-version.test.mjs` 9/9.
- Batas: kalau env `APP_VERSION` diisi di Coolify, fitur ini dilewati. Tampilan versi di UI belum dicek lewat login peramban.
