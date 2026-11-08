// Command server menjalankan backend NOC ISP: pengumpul data, rule engine,
// dan WebSocket hub untuk dashboard.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"noc-isp/backend/internal/archive"
	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/billing"
	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/config"
	"noc-isp/backend/internal/diagnostics"
	"noc-isp/backend/internal/engine"
	"noc-isp/backend/internal/httpapi"
	"noc-isp/backend/internal/hub"
	"noc-isp/backend/internal/netflow"
	"noc-isp/backend/internal/olt"
	"noc-isp/backend/internal/ontweb"
	"noc-isp/backend/internal/routerproxy"
	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/telemetry"
	"noc-isp/backend/internal/wire"
)

// version diisi saat build: go build -ldflags "-X main.version=1.0.0".
var version = "dev"

// shutdownGrace adalah batas waktu menunggu permintaan berjalan saat berhenti.
const shutdownGrace = 10 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "backend berhenti karena error:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return fmt.Errorf("baca konfigurasi: %w", err)
	}
	// Konfigurasi billing diperiksa sekarang, sebelum ada yang berjalan, supaya
	// setengah konfigurasi atau menit yang salah menghentikan backend dengan
	// pesan yang jelas seperti kesalahan konfigurasi lainnya.
	billingCfg, err := loadBillingSettings(os.Getenv)
	if err != nil {
		return fmt.Errorf("baca konfigurasi billing: %w", err)
	}
	// Dibaca sekali di sini (bukan di dalam startRouterPolling) karena dipakai
	// DUA tempat: AutoBinder (pengikatan ONU baru) dan endpoint manual
	// POST .../tr069-bind (profileID-nya harus sama).
	bindCfg, err := olt.AutoBindConfigFromEnv(os.Getenv)
	if err != nil {
		// Tidak menghentikan backend: fitur ini opsional dan bawaannya mati;
		// salah ketik di env hanya berarti fitur tetap mati, dicatat jelas.
		fmt.Fprintln(os.Stderr, "peringatan: konfigurasi pengikatan TR-069 tidak valid, fitur dimatikan:", err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Data jaringan di memori; collector mengisinya pada task berikutnya.
	manager := state.NewManager()
	apiOptions := httpapi.Options{Logger: logger, Version: version}
	// notify memberi tahu hub bila status pelanggan berubah; tanpa hub (WebSocket
	// mati) perubahan tetap tersimpan di state.
	notify := func(state.Change) {}
	// publishEvents mengirim gangguan yang mulai atau selesai ke dashboard.
	publishEvents := func([]wire.Event) {}
	// publishTelemetry mengirim resource router, OLT, latensi, optik, dan alert ke dashboard.
	publishTelemetry := func(wire.Telemetry) {}
	if cfg.RealtimeSecret == "" {
		logger.Warn("WebSocket dan REST /api/v1 dimatikan: isi REALTIME_TOKEN_SECRET untuk mengaktifkannya")
	} else {
		tokens, err := auth.NewTokens(cfg.RealtimeSecret)
		if err != nil {
			return fmt.Errorf("siapkan tiket login: %w", err)
		}
		dashboardHub := hub.New(manager, hub.Options{
			Verifier:       tokens,
			Logger:         logger,
			AllowedOrigins: cfg.AllowedOrigins,
			// Perubahan online/offline sampai ke dashboard dalam ~0,1 detik,
			// tidak menunggu delta per detik.
			StatusFlush: 100 * time.Millisecond,
		})
		go dashboardHub.Run(ctx)
		notify = dashboardHub.NotifyChange
		publishEvents = dashboardHub.PublishEvents
		publishTelemetry = dashboardHub.PublishTelemetry
		apiOptions.WebSocket = dashboardHub
		apiOptions.Data = manager
		apiOptions.Verifier = tokens
		apiOptions.AllowedOrigins = cfg.AllowedOrigins
		apiOptions.RouterPreflight = routerproxy.NewPreflighter(logger)
	}

	// Telemetri dashboard (resource router, OLT, VLAN PON, latensi, optik, alert): dihitung
	// di sini dan didorong ke browser lewat hub; browser tidak melakukan polling. Database
	// dipasang di bawah bila ada.
	telemetrySvc := telemetry.New(telemetry.Options{Source: manager, Logger: logger, Publish: publishTelemetry})

	// Arsip traffic (histori). Koneksi dibuat saat dibutuhkan, jadi database yang
	// belum siap tidak menghalangi backend naik; pemantauan real-time tidak
	// bergantung padanya.
	var (
		pool          *pgxpool.Pool
		routerClients *collector.ClientPool
		billingDB     billing.DB              // nil bila DATABASE_URL kosong
		billingRead   billing.ReadDB          // pool yang sama, untuk endpoint /api/v1/billing
		thresholdDB   engine.Querier          // pool yang sama, untuk ambang alert
		alertDB       engine.Execer           // pool yang sama, untuk menyimpan alert engine
		syslogDB      collector.Execer        // pool yang sama, untuk menyimpan log router & NetFlow
		sessions      *collector.SessionIndex // IP sesi -> pelanggan, untuk NetFlow
	)
	if cfg.DatabaseURL == "" {
		logger.Info("histori traffic dimatikan: isi DATABASE_URL untuk mengaktifkan /api/v1/traffic/history")
	} else {
		var err error
		pool, err = openArchivePool(ctx, cfg.DatabaseURL)
		if err != nil {
			return err
		}
		// Satu pool client per router dipakai poller, impor, diagnosa, dan API
		// baca. Setelah koneksi pertama, aksi berikutnya tidak login lagi.
		routerClients = collector.NewClientPool()
		defer pool.Close()
		if nR, nC, err := collector.SyncDatabaseState(ctx, pool, manager, logger); err != nil {
			logger.Warn("gagal memuat data awal router dan pelanggan dari database", "error", err)
		} else {
			logger.Info("data awal router dan pelanggan dimuat ke memori", "routers", nR, "customers", nC)
		}
		go collector.StartDatabaseWatcher(ctx, pool, manager, 15*time.Second, logger)
		// Status online dari polling, webhook, dan syslog ikut ditulis ke
		// customers.is_online; hub tetap menerima perubahan yang sama.
		syslogDB = pool
		onlineWriter := collector.NewOnlineWriter(pool, logger)
		go onlineWriter.Run(ctx)
		notifyHub := notify
		notify = func(c state.Change) {
			notifyHub(c)
			onlineWriter.Notify(c)
		}
		sessions = collector.NewSessionIndex(manager)
		telemetrySvc.SetDB(pool)
		startRouterPolling(ctx, cfg.DeviceSecret, pool, routerClients, manager, notify, logger, bindCfg, sessions.Update, telemetrySvc.SetVlans)
		// Endpoint manual "Daftarkan ke GenieACS" (POST .../tr069-bind): sengaja
		// tetap dipasang walau bindCfg.Mode == off, supaya operator bisa mengikat
		// satu ONU lewat tombol tanpa menyalakan pengikatan otomatis untuk semua.
		apiOptions.OltBind = httpapi.NewOltBindAPI(pool, cfg.DeviceSecret, bindCfg.ProfileID, olt.NewPGBindStore(pool), logger)
		// "Pasang GenieACS lewat web ONT": ACS dan kredensial dibaca dari tabel
		// ont_web_settings per permintaan; hanya batas jaringan modem dari env.
		if ontNets, err := ontweb.PolicyFromEnv(os.Getenv); err != nil {
			fmt.Fprintln(os.Stderr, "peringatan: ONT_WEB_ALLOWED_CIDRS tidak valid, pasang TR-069 lewat web ONT dimatikan:", err)
		} else {
			apiOptions.OntWeb = httpapi.NewOntWebAPI(pool, cfg.DeviceSecret, ontNets, logger)
		}
		apiOptions.History = archive.NewPGStore(pool)
		apiOptions.NetflowQuery = netflow.NewReader(pool)
		apiOptions.Torch = netflow.NewTorchRunner(pool, cfg.DeviceSecret, logger)
		// Satu gateway: Next.js membaca router lewat backend Go, bukan koneksi
		// REST/API sendiri.
		if proxy := routerproxy.NewWithPool(pool, cfg.DeviceSecret, logger, routerClients); proxy != nil {
			apiOptions.Routers = proxy
		}
		// Diagnosa pelanggan 100% Go: worker, trigger otomatis, dan API. Next.js
		// hanya menampilkan hasil dari tabel diagnostic_runs/diagnostic_findings.
		if apiOptions.Routers != nil {
			diagnosticStore := diagnostics.NewStore(pool)
			diagnosticRunner := diagnostics.NewRunner(diagnosticStore, apiOptions.Routers, logger)
			diagnosticService := diagnostics.NewService(diagnosticStore, diagnosticRunner, logger)
			diagnosticService.Start(ctx)
			diagnosticService.StartAutoTrigger(ctx, 15*time.Second)
			apiOptions.Diagnostics = diagnosticService
			logger.Info("diagnosa pelanggan Go aktif", "worker", true, "auto_trigger", true)
		}
		billingDB = pool
		billingRead = pool
		thresholdDB = pool
		alertDB = pool
	}

	if apiOptions.Data != nil {
		go telemetrySvc.Run(ctx)
		apiOptions.Telemetry = telemetrySvc
	}

	// Sinkron billing per jam memakai pool yang sama. Penjadwalnya dihentikan dan
	// ditunggu SEBELUM pool ditutup (defer berjalan terbalik): sinkron yang sedang
	// berjalan perlu menulis catatan gagalnya ke database lebih dulu.
	billingCtx, stopBilling := context.WithCancel(ctx)
	var billingScheduler *billing.Scheduler
	// Perubahan status Lunas/Isolir hasil sinkron masuk ke Manager (dan lewat hub ke
	// dashboard) hanya sesudah database ter-commit.
	waitBilling, err := startBillingWithSink(billingCtx, logger, billingCfg, billingDB,
		billingStatusSink(manager, logger),
		func(s *billing.Scheduler) { billingScheduler = s })
	if err != nil {
		stopBilling()
		return err
	}
	attachBillingAPI(&apiOptions, billingRead, billingScheduler)
	defer func() {
		stopBilling()
		waitBilling()
	}()

	// Rule engine: gangguan baru dikirim saat mulai dan saat selesai, tidak tiap
	// detik. Aturan lain (traffic, CPU, sinyal optik, port) ditambahkan di sini.
	// Ambang dibaca dari alert_thresholds sekali saat start (ubah ambang =
	// restart backend). Tanpa database atau saat gagal dibaca: bawaan PRD.
	thresholds := engine.DefaultThresholdConfig()
	if thresholdDB != nil {
		loaded, err := engine.LoadThresholdsFromDB(ctx, thresholdDB)
		if err != nil {
			logger.Warn("ambang alert dari database gagal dibaca, memakai bawaan", "error", err)
		} else {
			thresholds = loaded
		}
	}
	// Event dikirim ke dashboard lebih dulu (WebSocket), baru disimpan ke tabel
	// alerts yang dibaca halaman Alert dan Deteksi Anomali. Tanpa database,
	// alert hanya hidup di WebSocket.
	var alertWriter *engine.AlertWriter
	if alertDB != nil {
		alertWriter = engine.NewAlertWriter(alertDB, logger)
		// Durasi aturan terpanjang 3 menit (CPU); 6 menit cukup bagi kondisi yang
		// masih berlangsung untuk terdeteksi ulang sebelum yang basi ditutup.
		alertWriter.StartStaleCleanup(ctx, time.Now(), 6*time.Minute)
	}
	alerts, err := engine.New(engine.Options{
		Logger: logger,
		Source: manager,
		Rules:  engine.MakeRules(thresholds),
		Sink: func(events []engine.Event) {
			publishEvents(wire.NewEvents(events))
			if alertWriter != nil {
				saveCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
				defer cancel()
				alertWriter.Record(saveCtx, events)
			}
		},
	})
	if err != nil {
		return fmt.Errorf("siapkan rule engine: %w", err)
	}
	go alerts.Run(ctx)

	if cfg.PPPWebhookToken == "" {
		logger.Info("webhook PPP dimatikan: isi PPP_WEBHOOK_TOKEN untuk mengaktifkan /hooks/ppp")
	} else {
		webhook, err := collector.NewWebhookHandler(collector.WebhookOptions{
			Token: cfg.PPPWebhookToken, Presence: manager, Notify: notify, Logger: logger,
		})
		if err != nil {
			return fmt.Errorf("siapkan webhook PPP: %w", err)
		}
		apiOptions.PPPWebhook = webhook
	}
	if cfg.SyslogAddr != "" {
		syslog, err := collector.ListenSyslog(cfg.SyslogAddr, manager, notify, logger)
		if err != nil {
			return err
		}
		syslog.SetSources(cfg.SyslogSources)
		if syslogDB != nil {
			// Semua baris dari router dikenal disimpan untuk diagnosa pelanggan
			// (buffer memori router hanya belasan menit).
			syslogWriter := collector.NewSyslogWriter(syslogDB, cfg.SyslogRetention, logger)
			go syslogWriter.Run(ctx)
			syslog.SetStore(syslogWriter.Add)
		}
		logger.Info("syslog UDP mendengarkan", "addr", syslog.Addr().String(), "peta_sumber", len(cfg.SyslogSources), "simpan", syslogDB != nil)
		go func() {
			if err := syslog.Serve(ctx); err != nil {
				logger.Error("listener syslog berhenti", "error", err)
			}
		}()
	}

	// NetFlow terisolasi: antrian terbatas + goroutine sendiri. Gagal bind atau
	// berhenti tidak menjatuhkan monitoring utama.
	if cfg.NetflowEnabled {
		// Dengan database: agregat per pelanggan per 5 menit ke netflow_samples
		// (diagnosa pelanggan). Tanpa database: hanya dihitung.
		var sink netflow.FlowSink
		var aggregator *netflow.Aggregator
		if syslogDB != nil && sessions != nil {
			aggregator = netflow.NewAggregator(sessions, syslogDB, cfg.NetflowRetention, logger)
			sink = aggregator
		} else {
			var received atomic.Uint64
			sink = netflow.FlowSinkFunc(func(_ context.Context, recs []netflow.Record) error {
				received.Add(uint64(len(recs)))
				return nil
			})
		}
		buffered := netflow.NewBufferedSink(sink, netflow.DefaultBufferSize, logger)
		netflowServer, err := netflow.NewServer(cfg.NetflowAddr, buffered, logger)
		if err != nil {
			logger.Error("kolektor NetFlow tidak bisa dibuka, dilewati", "addr", cfg.NetflowAddr, "error", err)
		} else {
			apiOptions.Netflow = netflowServer
			// Hanya router terdaftar (Host) atau yang dipetakan NETFLOW_SOURCE_MAP.
			netflowServer.SetResolver(func(addr netip.Addr) (string, bool) {
				if id, ok := cfg.NetflowSources[addr]; ok {
					return id, true
				}
				for _, r := range manager.Routers() {
					if a, ok := collector.RouterAddr(r.Host); ok && a == addr {
						return r.ID, true
					}
				}
				return "", false
			})
			if aggregator != nil {
				go aggregator.Run(ctx)
			}
			go buffered.Run(ctx)
			go func() {
				logger.Info("kolektor NetFlow aktif", "addr", netflowServer.Addr().String(), "simpan", aggregator != nil, "peta_sumber", len(cfg.NetflowSources))
				if err := netflowServer.ListenAndServe(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("kolektor NetFlow berhenti", "err", err)
				}
			}()
		}
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpapi.NewHandler(apiOptions),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	// Bind lebih dulu supaya alamat yang salah atau terpakai langsung gagal.
	listener, err := net.Listen("tcp", cfg.HTTPAddr)
	if err != nil {
		return fmt.Errorf("buka alamat %s: %w", cfg.HTTPAddr, err)
	}

	logger.Info("subsistem aktif",
		"collector", cfg.DatabaseURL != "" || cfg.PPPWebhookToken != "" || cfg.SyslogAddr != "" || cfg.NetflowEnabled,
		"rule_engine", true,
		"websocket_hub", cfg.RealtimeSecret != "")
	logger.Info("backend mendengarkan", "addr", listener.Addr().String(), "version", version)
	return serve(ctx, srv, listener, shutdownGrace)
}

// archiveMaxConns cukup untuk query histori bersamaan (httpapi membatasinya
// empat) ditambah penulis arsip dan pembersihnya.
const archiveMaxConns = 8

// openArchivePool menyiapkan pool tanpa langsung terhubung ke database. Error
// sengaja tidak memuat URL-nya karena membawa kata sandi.
func openArchivePool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("DATABASE_URL tidak bisa dibaca sebagai alamat PostgreSQL")
	}
	poolConfig.MaxConns = archiveMaxConns
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("siapkan koneksi arsip: %w", err)
	}
	return pool, nil
}

// serve menjalankan srv sampai ctx dibatalkan, lalu memberi permintaan yang
// sedang berjalan waktu `grace` untuk selesai sebelum server ditutup.
func serve(ctx context.Context, srv *http.Server, listener net.Listener, grace time.Duration) error {
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(listener) }()

	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
