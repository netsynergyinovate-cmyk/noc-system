# Kartu "Sinyal Lemah" disamakan dengan alert optik

## Masalah
Dashboard: Sinyal Lemah 7, badge Alert 4. Kartu/peta menghitung Rx < -25 dBm; OpticalRule Go (commit a3dc687, "naik persatuan") baru membuka alert pada <= -26 dBm.

## Perubahan
- Go `state.WeakOpticalDbm` -25 menjadi -26, perbandingan `<=` (Health warning). Tes manager_test diperbarui (-26 lemah, -25,99 belum).
- TS `WEAK_OPTICAL_DBM` -26 + `<=` (health.ts), dashboard-metric-board.tsx, dashboard-metrics.service.ts (`WEAK_DBM`).
- Label: "Rx ≤ -26 dBm", legenda peta "Lemah (≤ -26)".
- Tidak diubah: anomalyRules (ambang tersimpan tetap -25), warna marker peta lain (map-markers, cable-map, real-map-markers), onu-trouble-classifier.
- Batasan: kartu tidak mengikuti ambang optik yang diubah di alert_thresholds.

## Uji
- `go test ./internal/state/ ./internal/engine/` ok.
- `npx tsc --noEmit` 0; eslint 0 error.
- `node --test dashboard-metrics-api + map-markers-route`: 6 pass 3 fail, sama dengan HEAD (baseline).
- gofmt -l menandai berkas karena CRLF working copy (HEAD juga).
