package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/state"
)

// fleetEvery adalah seberapa sering daftar router di database dibandingkan dengan
// router yang sedang dipoll (tambah, ubah kredensial, nonaktifkan).
const fleetEvery = 15 * time.Second

// startRouterPolling menyalakan polling semua router aktif di database dan
// pengimpor pelanggan PPPoE dari /ppp/secret. Tanpa deviceSecret kata sandi
// router tidak bisa dibuka, jadi keduanya tidak dijalankan (satu baris log).
// Semua berjalan di goroutine dan berhenti saat ctx selesai.
func startRouterPolling(
	ctx context.Context,
	deviceSecret string,
	pool *pgxpool.Pool,
	manager *state.Manager,
	notify func(state.Change),
	logger *slog.Logger,
) {
	if deviceSecret == "" {
		logger.Warn("polling router dimatikan: isi DEVICE_SECRET (sama dengan aplikasi Next.js) agar backend bisa membuka kata sandi router")
		return
	}
	poller := collector.NewPoller(manager, collector.PollerOptions{
		Logger:     logger,
		HTTPClient: collector.DefaultHTTPClient(),
		Backup: &collector.BackupOptions{
			Store:    manager,
			Presence: manager,
			Notify:   notify,
		},
	})
	load := func(ctx context.Context) ([]collector.Target, error) {
		return collector.LoadTargets(ctx, pool, deviceSecret, logger)
	}
	go collector.NewFleet(poller, load, logger).Run(ctx, fleetEvery)
	go collector.NewImporter(load, pool, nil, logger).Run(ctx, 0)
	logger.Info("polling router dan impor pelanggan PPPoE aktif", "cek_router_tiap", fleetEvery.String())
}
