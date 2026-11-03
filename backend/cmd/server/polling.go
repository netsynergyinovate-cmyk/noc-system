package main

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"noc-isp/backend/internal/archive"
	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/olt"
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

type isolirBatch struct {
	routerID string
	isolated map[string]bool
}

const isolirUpdateSQL = `UPDATE customers c
SET isolir_router = u.v, isolir_router_at = now()
FROM unnest($1::text[]::uuid[], $2::bool[]) AS u(id, v)
WHERE c.id = u.id AND c.isolir_router IS DISTINCT FROM u.v`

// Pelanggan router ini yang sesinya sudah hilang tidak punya bukti lagi: kembali ke billing.
const isolirClearSQL = `UPDATE customers
SET isolir_router = NULL, isolir_router_at = now()
WHERE router_id = $1::uuid AND isolir_router IS NOT NULL AND id <> ALL($2::text[]::uuid[])`

type isolirDB interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

func persistIsolirRouter(ctx context.Context, db isolirDB, mgr *state.Manager, routerID string, isolated map[string]bool, logger *slog.Logger) error {
	if len(isolated) == 0 || mgr == nil {
		return nil
	}
	updates := make(map[string]bool, len(isolated))
	for username, isIso := range isolated {
		c, ok := mgr.CustomerByPPPoE(username)
		if !ok || c.RouterID != routerID {
			continue
		}
		if isIso || !updates[c.ID] {
			updates[c.ID] = isIso
		}
	}
	if len(updates) == 0 {
		return nil
	}

	ids := make([]string, 0, len(updates))
	vals := make([]bool, 0, len(updates))
	for id, isIso := range updates {
		ids = append(ids, id)
		vals = append(vals, isIso)
	}

	if db != nil {
		if _, err := db.Exec(ctx, isolirUpdateSQL, ids, vals); err != nil {
			if logger != nil {
				logger.Warn("gagal memperbarui isolir_router pelanggan", "router", routerID, "error", err)
			}
			return err
		}
		if _, err := db.Exec(ctx, isolirClearSQL, routerID, ids); err != nil {
			if logger != nil {
				logger.Warn("gagal membersihkan isolir_router pelanggan tanpa sesi", "router", routerID, "error", err)
			}
			return err
		}
	}

	mgr.SetIsolirRouter(updates)
	mgr.ClearIsolirRouter(routerID, updates)
	return nil
}

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
	bindCfg olt.AutoBindConfig,
	// Daftar sesi /ppp/active tiap polling (peta IP pelanggan untuk NetFlow).
	onSessions func(string, []collector.PPPSession),
	// Laju VLAN PON tiap detik (dashboard).
	onVlans func(string, []collector.VlanRate),
) {
	if deviceSecret == "" {
		logger.Warn("polling router dimatikan: isi DEVICE_SECRET (sama dengan aplikasi Next.js) agar backend bisa membuka kata sandi router")
		return
	}
	// Arsip traffic: tanpa ini /api/v1/traffic/history selalu kosong. Penulis
	// berbatch dan asinkron, jadi database yang lambat tidak menahan polling.
	writer := archive.NewWriter(archive.NewPGStore(pool), archive.Options{Logger: logger})
	go writer.Run(ctx)
	// Trafik per pelanggan (rata-rata 5 menit) dari queue dinamis "<pppoe-USERNAME>".
	customerTraffic := archive.NewCustomerTraffic(archive.NewCustomerPGStore(pool), time.Second, logger)
	go customerTraffic.Run(ctx)
	isolirCh := make(chan isolirBatch, 32)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case batch := <-isolirCh:
				timeoutCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
				_ = persistIsolirRouter(timeoutCtx, pool, manager, batch.routerID, batch.isolated, logger)
				cancel()
			}
		}
	}()
	recorder := archivingRecorder{
		Manager: manager,
		archive: archive.Recorder{Next: manager, Writer: writer},
	}
	// Keterjangkauan router: 3 kegagalan berturut-turut = tidak terjangkau (alert
	// tingkat router dan banner di dasbor); satu keberhasilan = pulih.
	tracker := collector.NewSourceFailureTracker()
	poller := collector.NewPoller(recorder, collector.PollerOptions{
		Logger:     logger,
		HTTPClient: collector.DefaultHTTPClient(),
		// Trafik dashboard dari counter interface (sama dengan Winbox). Bawaan: interface berkomentar
		// UPLINK, Rx = download. TRAFFIC_INTERFACE memilih nama interface tertentu;
		// TRAFFIC_INTERFACE_CUSTOMER_SIDE=true bila interface itu menghadap pelanggan (Tx = download).
		// TRAFFIC_SOURCE=queue mengembalikan cara lama (jumlah rate queue).
		TrafficFromQueues:   strings.EqualFold(strings.TrimSpace(os.Getenv("TRAFFIC_SOURCE")), "queue"),
		TrafficInterface:    strings.TrimSpace(os.Getenv("TRAFFIC_INTERFACE")),
		TrafficComment:      strings.TrimSpace(os.Getenv("TRAFFIC_INTERFACE_COMMENT")),
		TrafficCustomerSide: strings.EqualFold(strings.TrimSpace(os.Getenv("TRAFFIC_INTERFACE_CUSTOMER_SIDE")), "true"),
		OnSessions:          onSessions,
		OnVlans:             onVlans,
		OnIsolir: func(routerID string, isolated map[string]bool) {
			select {
			case isolirCh <- isolirBatch{routerID: routerID, isolated: isolated}:
			default:
				logger.Warn("antrean isolir router penuh, lewati putaran ini", "router", routerID)
			}
		},
		OnQueues: func(_ string, at time.Time, samples []collector.QueueSample) {
			rates := make([]archive.CustomerRate, 0, len(samples))
			for _, s := range samples {
				if user, ok := archive.CustomerUsername(s.Name); ok && !s.Disabled && s.TopLevel() {
					rates = append(rates, archive.CustomerRate{Username: user, DownBps: s.DownBps, UpBps: s.UpBps})
				}
			}
			customerTraffic.Add(at, rates)
		},
		OnResult: func(routerID, _ string, err error) {
			now := time.Now().Unix()
			if err != nil {
				tracker.RecordFailure(routerID, err, now, manager, logger)
				return
			}
			manager.NoteRouterSuccess(routerID, now)
			tracker.RecordSuccess(routerID, now, manager, logger)
		},
		Backup: &collector.BackupOptions{
			Store:    manager,
			Presence: manager,
			Notify:   notify,
			// CPU/RAM router tiap 2 detik (timeout 1,8 dtk): 1 detik terlalu ketat untuk router lewat internet publik.
			ResourceEvery: 2 * time.Second,
		},
	})
	load := func(ctx context.Context) ([]collector.Target, error) {
		return collector.LoadTargets(ctx, pool, deviceSecret, logger)
	}
	go collector.NewFleet(poller, load, logger).Run(ctx, fleetEvery)
	go collector.NewImporter(load, pool, nil, logger).Run(ctx, 0)
	// OLT: kondisi optik PON dan ONU dipoll dari tiap OLT aktif lalu disimpan ke
	// olt_pon_ports dan olt_onus (dibaca halaman OLT & Optik).
	loadOlts := func(ctx context.Context) ([]collector.OltTarget, error) {
		return collector.LoadOltTargets(ctx, pool, deviceSecret, logger)
	}
	// Pengikatan profil TR-069 ke ONU baru: MATI kecuali OLT_TR069_AUTOBIND=new|all
	// (bindCfg dibaca sekali di main.go, dipakai juga oleh endpoint manual).
	go collector.NewOltFleet(loadOlts, pool, 0, logger).WithAutoBind(bindCfg).Run(ctx, fleetEvery)
	logger.Info("polling router, arsip traffic, dan impor pelanggan PPPoE aktif", "cek_router_tiap", fleetEvery.String())
}
