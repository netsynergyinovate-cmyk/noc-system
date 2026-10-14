package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"noc-isp/backend/internal/billing"
	"noc-isp/backend/internal/httpapi"
	"noc-isp/backend/internal/state"
)

// billingDisabledMessage adalah satu-satunya baris log saat billing tidak
// dikonfigurasi.
const billingDisabledMessage = "sinkron billing dimatikan (BILLING_URL, BILLING_USERNAME, BILLING_PASSWORD belum diatur)"

// billingSettings adalah konfigurasi sinkron billing dari environment.
type billingSettings struct {
	// Enabled salah bila BILLING_URL, BILLING_USERNAME, dan BILLING_PASSWORD
	// semuanya kosong. Config dan Minute baru berarti bila Enabled.
	Enabled bool
	Config  billing.Config
	// Minute adalah menit dalam jam UTC tempat sinkron dimulai.
	Minute int
	// DropGuard mengatur penjaga hasil yang menyusut drastis (BILLING_DROP_PERCENT
	// dan BILLING_DROP_MIN_INVOICES). Percent 0 mematikannya.
	DropGuard billing.DropGuard
}

// loadBillingSettings membaca konfigurasi billing. Seperti config.Load, nilai yang
// rusak ditolak dengan pesan yang menyebut variabelnya (tidak pernah nilai
// rahasianya), supaya backend tidak jalan dengan setengah konfigurasi:
//
//   - ketiga variabel billing kosong: Enabled salah, bukan galat;
//   - sebagian terisi, atau URL tidak sah: galat;
//   - BILLING_SYNC_MINUTE di luar 0-59 atau bukan bilangan bulat: galat, juga
//     ketika billing sendiri dimatikan, karena salah ketik lebih baik ketahuan
//     sekarang daripada saat billing dinyalakan;
//   - BILLING_DROP_PERCENT di luar 0-100 atau BILLING_DROP_MIN_INVOICES di bawah 1,
//     atau bukan bilangan bulat: galat, dengan alasan yang sama.
func loadBillingSettings(getenv func(string) string) (billingSettings, error) {
	cfg, cfgErr := billing.ConfigFromEnv(getenv)
	minute, minuteErr := billing.SyncMinuteFromEnv(getenv)
	guard, guardErr := billing.DropGuardFromEnv(getenv)
	notConfigured := errors.Is(cfgErr, billing.ErrNotConfigured)
	switch {
	case cfgErr != nil && !notConfigured:
		return billingSettings{}, cfgErr
	case minuteErr != nil:
		return billingSettings{}, minuteErr
	case guardErr != nil:
		return billingSettings{}, guardErr
	case notConfigured:
		return billingSettings{}, nil
	}
	return billingSettings{Enabled: true, Config: cfg, Minute: minute, DropGuard: guard}, nil
}

// syncerOptions menyusun opsi Syncer dari konfigurasi. Dipisah dari startBilling
// supaya nilai yang sampai ke Syncer bisa diuji tanpa database.
func syncerOptions(logger *slog.Logger, settings billingSettings) billing.SyncerOptions {
	guard := settings.DropGuard // salinan: opsi tidak berbagi memori dengan settings
	return billing.SyncerOptions{Logger: logger, DropGuard: &guard}
}

// startBilling memasang sinkron billing per jam. Ia mengembalikan fungsi yang
// menunggu penjadwal berhenti; pemanggil membatalkan ctx lebih dulu lalu
// memanggilnya SEBELUM menutup pool database, supaya sinkron yang sedang
// berjalan sempat ditandai failed.
//
//   - Billing tidak dikonfigurasi: satu baris info, tidak ada yang dijalankan.
//   - Billing dikonfigurasi tetapi db nil (DATABASE_URL kosong): satu baris
//     peringatan, tidak ada yang dijalankan.
//   - Selain itu: Scraper, Store, Syncer, dan Scheduler dibuat dan Scheduler.Run
//     berjalan di goroutinenya sendiri sampai ctx dibatalkan.
//
// onScheduler (boleh kosong) dipanggil dengan Scheduler yang baru dibuat, sebelum
// Run dimulai, dan hanya pada kasus terakhir. Pemanggil memakainya untuk
// menayangkan jadwal sinkron (attachBillingAPI).
func startBilling(ctx context.Context, logger *slog.Logger, settings billingSettings, db billing.DB, onScheduler ...func(*billing.Scheduler)) (wait func(), err error) {
	return startBillingWithSink(ctx, logger, settings, db, nil, onScheduler...)
}

// newBillingSyncer membuat Syncer; variabel supaya tes bisa melihat opsi yang
// sungguh dipasang startBillingWithSink (khususnya pendengar perubahan status).
var newBillingSyncer = billing.NewSyncer

// startBillingWithSink adalah startBilling dengan pendengar perubahan status:
// onChanges dipasang sebagai SyncerOptions.OnStatusChanges, jadi dipanggil sekali
// per sinkron yang berhasil, sesudah commit (lihat billingStatusSink untuk yang
// dipasang main). Pada dua kasus pertama di atas (billing mati, atau tanpa
// database) tidak ada Syncer dan onChanges tidak pernah dipanggil.
func startBillingWithSink(ctx context.Context, logger *slog.Logger, settings billingSettings, db billing.DB, onChanges func([]billing.StatusChange) error, onScheduler ...func(*billing.Scheduler)) (wait func(), err error) {
	noop := func() {}
	if !settings.Enabled {
		logger.Info(billingDisabledMessage)
		return noop, nil
	}
	if db == nil {
		logger.Warn("sinkron billing dimatikan: isi DATABASE_URL supaya hasilnya bisa disimpan")
		return noop, nil
	}

	scraper, err := billing.New(settings.Config, billing.WithLogger(logger))
	if err != nil {
		return nil, fmt.Errorf("siapkan pembaca billing: %w", err)
	}
	store := billing.NewStore(db)
	syncerOpts := syncerOptions(logger, settings)
	syncerOpts.OnStatusChanges = onChanges
	syncer, err := newBillingSyncer(scraper, store, syncerOpts)
	if err != nil {
		scraper.Close()
		return nil, fmt.Errorf("siapkan sinkron billing: %w", err)
	}
	scheduler, err := billing.NewScheduler(billing.SchedulerOptions{
		Syncer: syncer, Store: store, Minute: settings.Minute, Logger: logger,
	})
	if err != nil {
		scraper.Close()
		return nil, fmt.Errorf("siapkan penjadwal billing: %w", err)
	}

	for _, observe := range onScheduler {
		observe(scheduler)
	}

	logger.Info("sinkron billing aktif", "billing", settings.Config, "menit", settings.Minute,
		"penjaga_persen", settings.DropGuard.Percent, "penjaga_minimum_tagihan", settings.DropGuard.MinInvoices)
	if !settings.DropGuard.Enabled() {
		logger.Warn("penjaga penurunan jumlah tagihan dimatikan (" + billing.EnvDropPercent + "=0); hasil baca yang terpotong akan diterapkan")
	}
	return runInBackground(ctx, logger, scheduler.Run, scraper.Close), nil
}

// billingStatusSink meneruskan perubahan status Lunas/Isolir hasil sinkron billing
// ke state.Manager (billing.StatusChange.To -> state.BillingChange.Status). Manager
// menyimpan status barunya, dan hub menyiarkannya ke dashboard pada delta
// berikutnya (billingChanges); klien yang baru tersambung menerimanya lewat
// snapshot. Syncer memanggilnya sesudah commit database, jadi Manager tidak pernah
// mendahului database.
//
// Pelanggan yang tidak dikenal Manager diabaikan oleh Manager (bukan galat):
// Manager hanya memuat pelanggan yang sudah didaftarkan collector.
func billingStatusSink(mgr *state.Manager, logger *slog.Logger) func([]billing.StatusChange) error {
	return func(changes []billing.StatusChange) error {
		if len(changes) == 0 {
			return nil
		}
		mapped := make([]state.BillingChange, len(changes))
		for i, change := range changes {
			mapped[i] = state.BillingChange{CustomerID: change.CustomerID, Status: string(change.To)}
		}
		applied := mgr.SetBillingStatuses(mapped)
		logger.Debug("status tagihan diteruskan ke dashboard",
			"dari_sinkron", len(changes), "diterapkan", len(applied), "diabaikan", len(changes)-len(applied))
		return nil
	}
}

// attachBillingAPI mengaktifkan GET /api/v1/billing dan /api/v1/billing/sync
// hanya bila penjadwal sinkron benar-benar berjalan (scheduler tidak nil, yaitu
// startBilling membuatnya) DAN ada koneksi database untuk membaca. Selain itu
// Options.Billing dibiarkan kosong dan kedua endpoint menjawab 503
// billing_disabled: tanpa penjadwal, nextRunAt tidak punya arti. Jadwal yang
// ditayangkan adalah Scheduler.NextRunAt, jadi selalu sama dengan yang dijalankan.
func attachBillingAPI(opts *httpapi.Options, db billing.ReadDB, scheduler *billing.Scheduler) {
	if scheduler == nil || db == nil {
		return
	}
	opts.Billing = billing.NewReader(db)
	opts.BillingNextRun = scheduler.NextRunAt
	opts.BillingTrigger = scheduler
}

// runInBackground menjalankan run di goroutine sendiri. Fungsi yang dikembalikan
// menunggu run kembali DAN cleanup selesai; galat selain pembatalan dicatat.
func runInBackground(ctx context.Context, logger *slog.Logger, run func(context.Context) error, cleanup func()) (wait func()) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer cleanup()
		if err := run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("penjadwal sinkron billing berhenti", "error", err)
		}
	}()
	return func() { <-done }
}
