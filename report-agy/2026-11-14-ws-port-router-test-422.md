# WS gagal ke :3000 & 422 uji router (2026-11-14)

## WebSocket `ws://192.168.0.25:3000/ws` gagal
- Chunk deploy memakai `/api/realtime/ticket`; `wsUrl` = `BACKEND_URL` + `/ws`.
- Probe: `192.168.0.25:3000/ws` -> 404 (Next.js, tidak ada /ws); `192.168.0.25:8090/ws` -> 400 tanpa upgrade, 101 dengan upgrade + Origin `http://192.168.0.25:3000`, 403 untuk Origin asing.
- Akar: env Coolify `BACKEND_URL` menunjuk ke port app (3000). Perbaikan konfigurasi, bukan kode:
  `BACKEND_URL=http://192.168.0.25:8090`, lalu redeploy/restart service `app`.

## 422 `POST /api/routers/test`
- 422 = `VALIDATION_ERROR` (Zod) atau `INVALID_HOST` (`sanitizeHost`: path, spasi, kredensial di host, port 0).
- `router-test-panel.tsx` menimpa semua 422 dengan pesan umum, sehingga alasan host hilang.
- Perubahan: 422 dengan `error.code === "INVALID_HOST"` kini menampilkan pesan server (Indonesia).

## Bukti
- `npx tsc --noEmit -p .` -> 0 error.
- `npx eslint src/components/dashboard/router-test-panel.tsx` -> 0 error.
- Belum diuji di UI/Docker build.
