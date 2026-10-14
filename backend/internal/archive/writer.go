package archive

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultQueueSize     = 16384
	defaultBatchSize     = 2000
	defaultFlushInterval = 5 * time.Second
	defaultMaxPending    = 100_000
	defaultRetention     = 30 * 24 * time.Hour
	defaultPurgeBatch    = 50_000
	defaultPurgeEvery    = time.Hour
	insertTimeout        = 15 * time.Second
	shutdownTimeout      = 10 * time.Second
	maxRetryDelay        = 30 * time.Second
	// logEvery menjaga log tidak dibanjiri bila database mati lama.
	logEvery = 30
)

// MinRetention melindungi dari salah ketik (mis. 1 detik) yang akan menghapus
// hampir seluruh arsip. Masa simpan di bawah ini dinaikkan ke batas ini.
const MinRetention = 24 * time.Hour

// Sample adalah traffic total satu router pada satu detik (Mbps).
type Sample struct {
	RouterID string
	At       time.Time
	RxMbps   float64
	TxMbps   float64
}

// Store adalah tempat sampel disimpan. Implementasi aslinya PostgreSQL.
type Store interface {
	// Insert menyimpan sampel. Sampel dengan router dan detik yang sama
	// menggantikan yang lama. Mengembalikan jumlah baris yang tersimpan; sampel
	// milik router yang tidak ada di database dilewati, bukan menggagalkan
	// seluruh batch.
	Insert(ctx context.Context, samples []Sample) (written int, err error)
	// ApplyRetention meminta database menegakkan masa simpan sendiri bila bisa
	// (kebijakan retensi TimescaleDB) dan melaporkan apakah ia melakukannya.
	// Bila enforce benar, kebijakan yang ada disamakan dengan retention; bila
	// salah, kebijakan yang sudah ada dibiarkan apa adanya.
	ApplyRetention(ctx context.Context, retention time.Duration, enforce bool) (managed bool, err error)
	// Purge menghapus sampel yang lebih tua dari before, bertahap per batch baris.
	Purge(ctx context.Context, before time.Time, batch int) (deleted int64, err error)
}

// Options mengatur Writer. Logger wajib diisi.
type Options struct {
	Logger *slog.Logger
	// QueueSize adalah berapa sampel yang boleh menunggu dari jalur polling;
	// bila penuh, sampel baru dibuang daripada menahan polling. Default 16.384.
	QueueSize int
	// BatchSize adalah sampel maksimum per INSERT. Default 2.000.
	BatchSize int
	// FlushInterval adalah jarak penyimpanan berkala. Default 5 detik.
	FlushInterval time.Duration
	// MaxPending membatasi sampel yang ditahan saat database tidak bisa
	// dihubungi; lewat batas ini sampel tertua dibuang. Default 100.000
	// (sekitar satu jam untuk 25 router) supaya memori tetap terbatas.
	MaxPending int
	// Retention adalah berapa lama sampel disimpan. Bila diisi, masa simpan ini
	// ditegakkan di database mana pun: kebijakan Timescale disamakan, atau
	// penulis yang menghapus. Bila kosong, penulis memakai 30 hari untuk
	// pembersihannya dan kebijakan retensi Timescale yang sudah ada tidak
	// diubah. Minimal MinRetention (24 jam).
	Retention time.Duration
	// PurgeBatch adalah baris maksimum per perintah hapus. Default 50.000.
	PurgeBatch int
	// PurgeEvery adalah jarak pembersihan. Default 1 jam.
	PurgeEvery time.Duration
	// RetryBase adalah jeda sebelum mencoba lagi setelah gagal menyimpan; digandakan
	// tiap kegagalan berturut-turut sampai 30 detik. Default 1 detik.
	RetryBase time.Duration
	Now       func() time.Time
}

// Stats adalah hitungan kerja Writer, untuk log dan pemantauan.
type Stats struct {
	Enqueued uint64 // sampel yang diterima Writer
	Written  uint64 // baris yang tersimpan di database
	Dropped  uint64 // dibuang karena antrean atau penampung penuh, atau tidak valid
	Skipped  uint64 // dilewati database karena router tidak ada
	Failures uint64 // percobaan simpan yang gagal
	Pending  int    // sampel yang masih menunggu disimpan
	LastErr  string // error terakhir; kosong bila percobaan terakhir berhasil
	Purged   uint64 // baris lama yang dihapus penulis (bukan oleh database)
	// LastPurge adalah kapan penegakan retensi terakhir selesai; nol bila belum.
	LastPurge time.Time
}

// Writer menyimpan sampel traffic ke arsip secara asinkron. Enqueue tidak
// pernah menunggu database, jadi polling 1 sampel per detik tidak terganggu
// oleh arsip yang lambat atau mati.
type Writer struct {
	store Store
	opts  Options
	queue chan Sample

	enqueued, written, dropped, skipped, failures, purged atomic.Uint64
	pending                                               atomic.Int64
	retentionExplicit                                     bool

	mu        sync.Mutex
	lastErr   string
	lastPurge time.Time
}

// NewWriter membuat Writer. Panggil Run agar sampel mulai disimpan.
func NewWriter(store Store, opts Options) *Writer {
	if opts.QueueSize <= 0 {
		opts.QueueSize = defaultQueueSize
	}
	if opts.BatchSize <= 0 {
		opts.BatchSize = defaultBatchSize
	}
	if opts.FlushInterval <= 0 {
		opts.FlushInterval = defaultFlushInterval
	}
	if opts.MaxPending <= 0 {
		opts.MaxPending = defaultMaxPending
	}
	retentionExplicit := opts.Retention > 0
	if opts.Retention <= 0 {
		opts.Retention = defaultRetention
	}
	if opts.Retention < MinRetention {
		opts.Logger.Warn("masa simpan arsip terlalu pendek; dinaikkan ke batas minimum",
			"diminta", opts.Retention.String(), "dipakai", MinRetention.String())
		opts.Retention = MinRetention
	}
	if opts.PurgeBatch <= 0 {
		opts.PurgeBatch = defaultPurgeBatch
	}
	if opts.PurgeEvery <= 0 {
		opts.PurgeEvery = defaultPurgeEvery
	}
	if opts.RetryBase <= 0 {
		opts.RetryBase = time.Second
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Writer{
		store:             store,
		opts:              opts,
		retentionExplicit: retentionExplicit,
		queue:             make(chan Sample, opts.QueueSize),
	}
}

// Enqueue menerima satu sampel tanpa menunggu. Mengembalikan false bila sampel
// dibuang: router bukan UUID yang valid (tabel arsip memakai UUID), nilainya
// negatif atau bukan angka, atau antrean penuh.
func (w *Writer) Enqueue(routerID string, at time.Time, rxMbps, txMbps float64) bool {
	w.enqueued.Add(1)
	if !validRouterID(routerID) || !validRate(rxMbps) || !validRate(txMbps) {
		w.dropped.Add(1)
		return false
	}
	select {
	case w.queue <- Sample{RouterID: routerID, At: at.UTC().Truncate(time.Second), RxMbps: rxMbps, TxMbps: txMbps}:
		w.pending.Add(1)
		return true
	default:
		w.dropped.Add(1)
		return false
	}
}

// Stats memberi salinan hitungan saat ini.
func (w *Writer) Stats() Stats {
	w.mu.Lock()
	lastErr, lastPurge := w.lastErr, w.lastPurge
	w.mu.Unlock()
	return Stats{
		Enqueued:  w.enqueued.Load(),
		Written:   w.written.Load(),
		Dropped:   w.dropped.Load(),
		Skipped:   w.skipped.Load(),
		Failures:  w.failures.Load(),
		Pending:   int(w.pending.Load()),
		LastErr:   lastErr,
		Purged:    w.purged.Load(),
		LastPurge: lastPurge,
	}
}

// Run menyimpan sampel sampai ctx dibatalkan, lalu menyimpan sisanya sekali lagi
// (paling lama 10 detik) sebelum kembali.
func (w *Writer) Run(ctx context.Context) {
	log := w.opts.Logger
	flush := time.NewTicker(w.opts.FlushInterval)
	defer flush.Stop()
	purge := time.NewTicker(w.opts.PurgeEvery)
	defer purge.Stop()

	var buffer []Sample
	var retryAt time.Time
	failures := 0
	warnedFull := false // peringatan penampung penuh dicatat sekali per gangguan

	// trim menegakkan MaxPending: yang tertua dibuang, yang terbaru disimpan.
	trim := func() {
		over := len(buffer) - w.opts.MaxPending
		if over <= 0 {
			return
		}
		buffer = buffer[over:]
		w.dropped.Add(uint64(over))
		w.pending.Store(int64(len(buffer)) + int64(len(w.queue)))
		if !warnedFull {
			warnedFull = true
			log.Warn("penampung arsip penuh; sampel tertua dibuang", "batas", w.opts.MaxPending)
		}
	}

	// attempt menyimpan buffer; yang gagal tetap di buffer untuk dicoba lagi.
	attempt := func(ctx context.Context, force bool) {
		if len(buffer) == 0 {
			return
		}
		if !force && w.opts.Now().Before(retryAt) {
			return
		}
		remaining, err := w.flush(ctx, buffer)
		buffer = remaining
		w.pending.Store(int64(len(buffer)) + int64(len(w.queue)))
		if err == nil {
			if failures > 0 {
				log.Info("arsip traffic pulih", "gagal_berturut", failures)
			}
			failures = 0
			warnedFull = false
			retryAt = time.Time{}
			w.setLastErr("")
			return
		}
		if errors.Is(err, context.Canceled) && ctx.Err() != nil {
			// Writer sedang dihentikan dan Insert terputus di tengah jalan. Itu bukan
			// kegagalan database: sampelnya tetap di buffer dan disimpan oleh
			// penyimpanan akhir, jadi tidak dihitung dan tidak dicatat sebagai gagal.
			return
		}
		failures++
		w.failures.Add(1)
		w.setLastErr(err.Error())
		retryAt = w.opts.Now().Add(retryDelay(w.opts.RetryBase, failures))
		if failures == 1 || failures%logEvery == 0 {
			log.Warn("gagal menyimpan arsip traffic; akan dicoba lagi", "error", err.Error(), "menunggu", len(buffer), "gagal_berturut", failures)
		}
		trim()
	}

	w.purge(ctx)
	for {
		select {
		case s := <-w.queue:
			buffer = append(buffer, s)
			trim()
			if len(buffer) >= w.opts.BatchSize {
				attempt(ctx, false)
			}
		case <-flush.C:
			attempt(ctx, false)
		case <-purge.C:
			w.purge(ctx)
		case <-ctx.Done():
			// Ambil sisa antrean lalu simpan sekali lagi, dengan batas waktu.
			for drained := false; !drained; {
				select {
				case s := <-w.queue:
					buffer = append(buffer, s)
				default:
					drained = true
				}
			}
			final, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
			attempt(final, true)
			cancel()
			if len(buffer) > 0 {
				log.Warn("arsip traffic berhenti dengan sampel yang belum tersimpan", "hilang", len(buffer))
			}
			return
		}
	}
}

// flush menyimpan buffer per batch dan mengembalikan yang belum tersimpan.
func (w *Writer) flush(ctx context.Context, buffer []Sample) ([]Sample, error) {
	for len(buffer) > 0 {
		n := min(len(buffer), w.opts.BatchSize)
		batch := dedupe(buffer[:n])
		insertCtx, cancel := context.WithTimeout(ctx, insertTimeout)
		written, err := w.store.Insert(insertCtx, batch)
		cancel()
		if err != nil {
			return buffer, fmt.Errorf("simpan %d sampel: %w", len(batch), err)
		}
		w.written.Add(uint64(written))
		if skipped := len(batch) - written; skipped > 0 {
			w.skipped.Add(uint64(skipped))
		}
		buffer = buffer[n:]
	}
	return nil, nil
}

// dedupe menyisakan satu sampel per router per detik (yang terakhir menang).
// INSERT ... ON CONFLICT DO UPDATE menolak batch yang memuat kunci yang sama dua
// kali, jadi ini juga mencegah satu sampel ganda menggagalkan satu batch.
func dedupe(samples []Sample) []Sample {
	type key struct {
		router string
		at     int64
	}
	last := make(map[key]int, len(samples))
	for i, s := range samples {
		last[key{s.RouterID, s.At.Unix()}] = i
	}
	if len(last) == len(samples) {
		return samples
	}
	out := make([]Sample, 0, len(last))
	for i, s := range samples {
		if last[key{s.RouterID, s.At.Unix()}] == i {
			out = append(out, s)
		}
	}
	return out
}

// purge menegakkan masa simpan. Database yang mengurusnya sendiri (hypertable
// TimescaleDB dengan kebijakan retensi) dibiarkan; selain itu penulis menghapus
// sampel yang lewat masa simpan, bertahap per batch.
func (w *Writer) purge(ctx context.Context) {
	log := w.opts.Logger
	managed, err := w.store.ApplyRetention(ctx, w.opts.Retention, w.retentionExplicit)
	if err != nil {
		log.Warn("tidak bisa menerapkan retensi arsip traffic", "error", err.Error())
		return
	}
	if managed {
		w.markPurged()
		return
	}
	deleted, err := w.store.Purge(ctx, w.opts.Now().Add(-w.opts.Retention), w.opts.PurgeBatch)
	if deleted > 0 {
		w.purged.Add(uint64(deleted))
		log.Info("arsip traffic lama dibersihkan", "baris", deleted)
	}
	if err != nil {
		if errors.Is(err, context.Canceled) && ctx.Err() != nil {
			return // dihentikan di tengah pembersihan; putaran berikutnya melanjutkan
		}
		log.Warn("gagal membersihkan arsip traffic lama", "error", err.Error(), "terhapus_sebelum_gagal", deleted)
		return
	}
	w.markPurged()
}

func (w *Writer) markPurged() {
	w.mu.Lock()
	w.lastPurge = w.opts.Now()
	w.mu.Unlock()
}

func (w *Writer) setLastErr(s string) {
	w.mu.Lock()
	w.lastErr = s
	w.mu.Unlock()
}

// retryDelay menggandakan jeda tiap kegagalan berturut-turut, sampai maxRetryDelay.
func retryDelay(base time.Duration, failures int) time.Duration {
	delay := base
	for i := 1; i < failures && delay < maxRetryDelay; i++ {
		delay *= 2
	}
	return min(delay, maxRetryDelay)
}
