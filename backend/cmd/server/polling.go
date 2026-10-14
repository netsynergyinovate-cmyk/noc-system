package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"noc-isp/backend/internal/archive"
	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/state"
)

// archivingRecorder meneruskan sampel traffic ke Manager (grafik langsung) dan
// ke penulis arsip (histori di traffic_samples). Metode lain (SetQueues, dst)
// datang dari *state.Manager yang disematkan.
type archivingRecorder struct {
	*state.Manager
	archive archive.Recorder
}

func (r archivingRecorder) RecordTraffic(routerID string, p state.TrafficPoint) (bool, error) {
	return r.archive.RecordTraffic(routerID, p)
}

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
	// Arsip traffic: tanpa ini /api/v1/traffic/history selalu kosong. Penulis
	// berbatch dan asinkron, jadi database yang lambat tidak menahan polling.
	writer := archive.NewWriter(archive.NewPGStore(pool), archive.Options{Logger: logger})
	go writer.Run(ctx)
	recorder := archivingRecorder{
		Manager: manager,
		archive: archive.Recorder{Next: manager, Writer: writer},
	}
	poller := collector.NewPoller(recorder, collector.PollerOptions{
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
	logger.Info("polling router, arsip traffic, dan impor pelanggan PPPoE aktif", "cek_router_tiap", fleetEvery.String())
}
