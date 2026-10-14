package collector

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"noc-isp/backend/internal/state"
)

const (
	defaultInterval = time.Second
	// failuresBeforeBackoff: gagal beberapa kali berturut-turut dulu sebelum
	// melambat, supaya gangguan sesaat tidak langsung mengurangi frekuensi.
	failuresBeforeBackoff = 3
	maxBackoff            = 30 * time.Second
	// logEvery menjaga log tidak dibanjiri bila router mati lama.
	logEvery = 60

	// Nilai bawaan jalur cadangan (PRD).
	defaultPPPActiveEvery = 30 * time.Second
	defaultResourceEvery  = 5 * time.Second
	defaultInterfaceEvery = 10 * time.Second
	maxBackupTimeout      = 10 * time.Second

	// Nama job, dipakai di log dan Poller.JobStatus.
	JobQueue     = "queue"
	JobPPPActive = "ppp-active"
	JobResource  = "resource"
	JobInterface = "interface"
)

// Recorder menerima sampel traffic; *state.Manager memenuhinya.
type Recorder interface {
	RecordTraffic(routerID string, p state.TrafficPoint) (accepted bool, err error)
	SetQueues(ratios []state.QueueRatio) ([]state.Change, error)
}

// BackupStore menyimpan data perangkat dari jalur cadangan; *state.Manager
// memenuhinya.
type BackupStore interface {
	SetRouterResource(routerID string, r state.Resource) error
	SetRouterInterfaces(routerID string, interfaces []state.Interface, at time.Time) error
}

// BackupOptions mengaktifkan jalur cadangan: polling berkala yang berjalan
// berdampingan dengan polling queue tiap detik. Bagian yang dependensinya nil
// dilewati: tanpa Store tidak ada polling resource dan interface, tanpa
// Presence tidak ada polling /ppp/active.
type BackupOptions struct {
	Store    BackupStore
	Presence Presence
	// Notify dipanggil saat polling /ppp/active mengubah status pelanggan
	// (mis. Hub.NotifyChange); boleh nil.
	Notify func(state.Change)

	// Interval tiap job; 0 memakai nilai bawaan PRD (30 detik, 5 detik, 10 detik).
	PPPActiveEvery time.Duration
	ResourceEvery  time.Duration
	InterfaceEvery time.Duration
}

// PollerOptions mengatur Poller. Logger wajib diisi.
type PollerOptions struct {
	Logger *slog.Logger
	// HTTPClient dipakai semua router; nil berarti klien bawaan dengan verifikasi
	// TLS penuh. Timeout per permintaan diatur lewat RequestTimeout.
	HTTPClient *http.Client
	// Interval antar polling queue; default 1 detik.
	Interval time.Duration
	// RequestTimeout membatasi satu permintaan queue; default 90% dari Interval
	// agar satu permintaan yang macet tidak menumpuk dengan berikutnya.
	RequestTimeout time.Duration
	// Backup mengaktifkan jalur cadangan; nil berarti hanya polling queue.
	Backup *BackupOptions
	// OnResult dipanggil setelah tiap putaran job selesai (err nil = berhasil), dari
	// goroutine job. Dipakai untuk melacak keterjangkauan router. Tidak dipanggil
	// untuk putaran yang dibatalkan karena router dihentikan. Boleh nil.
	OnResult func(routerID, job string, err error)
	Now    func() time.Time
}

// Status adalah kondisi satu job polling pada satu router, untuk rule engine
// dan halaman perangkat.
type Status struct {
	LastSuccess         time.Time
	LastDuration        time.Duration
	LastItemCount       int // jumlah data pada jawaban terakhir yang berhasil
	ConsecutiveFailures int
	LastError           string
}

// Poller menjalankan polling ke tiap router: satu permintaan massal queue tiap
// detik (menjadi sampel traffic), dan bila Backup diisi, polling cadangan untuk
// sesi PPPoE, resource, dan interface.
type Poller struct {
	rec  Recorder
	opts PollerOptions

	mu      sync.Mutex
	workers map[string]*worker
	wg      sync.WaitGroup
}

type worker struct {
	routerID string
	cancel   context.CancelFunc
	client   *Client

	mu     sync.Mutex
	status map[string]*Status
}

type job struct {
	name     string
	interval time.Duration
	timeout  time.Duration
	// run melakukan satu putaran dan mengembalikan jumlah data yang diproses.
	// started adalah saat putaran dimulai (sebelum permintaan dikirim).
	run func(ctx context.Context, w *worker, started time.Time) (items int, err error)
}

// NewPoller membuat Poller tanpa router. Tambahkan lewat Start.
func NewPoller(rec Recorder, opts PollerOptions) *Poller {
	if opts.Interval <= 0 {
		opts.Interval = defaultInterval
	}
	if opts.RequestTimeout <= 0 {
		opts.RequestTimeout = opts.Interval * 9 / 10
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if b := opts.Backup; b != nil {
		backup := *b // jangan mengubah milik pemanggil
		if backup.PPPActiveEvery <= 0 {
			backup.PPPActiveEvery = defaultPPPActiveEvery
		}
		if backup.ResourceEvery <= 0 {
			backup.ResourceEvery = defaultResourceEvery
		}
		if backup.InterfaceEvery <= 0 {
			backup.InterfaceEvery = defaultInterfaceEvery
		}
		opts.Backup = &backup
	}
	return &Poller{rec: rec, opts: opts, workers: make(map[string]*worker)}
}

// Start mulai memoll satu router sampai ctx dibatalkan atau Stop dipanggil.
func (p *Poller) Start(ctx context.Context, t Target) error {
	client, err := NewClient(t, p.opts.HTTPClient)
	if err != nil {
		return err
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if _, exists := p.workers[t.RouterID]; exists {
		return fmt.Errorf("collector: router %q sudah dipoll", t.RouterID)
	}
	workerCtx, cancel := context.WithCancel(ctx)
	w := &worker{routerID: t.RouterID, cancel: cancel, client: client, status: make(map[string]*Status)}
	p.workers[t.RouterID] = w

	if client.base.Scheme == "http" {
		p.opts.Logger.Warn("router dipoll lewat HTTP tanpa enkripsi; kata sandi terkirim polos", "router", t.RouterID)
	}

	for _, j := range p.jobs() {
		w.status[j.name] = &Status{}
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			p.runJob(workerCtx, w, j)
		}()
	}
	return nil
}

// jobs menyusun daftar polling untuk satu router.
func (p *Poller) jobs() []job {
	jobs := []job{{
		name:     JobQueue,
		interval: p.opts.Interval,
		timeout:  p.opts.RequestTimeout,
		run:      p.runQueues,
	}}
	b := p.opts.Backup
	if b == nil {
		return jobs
	}
	if b.Presence != nil {
		jobs = append(jobs, job{name: JobPPPActive, interval: b.PPPActiveEvery, timeout: backupTimeout(b.PPPActiveEvery), run: p.runPPPActive})
	}
	if b.Store != nil {
		jobs = append(jobs,
			job{name: JobResource, interval: b.ResourceEvery, timeout: backupTimeout(b.ResourceEvery), run: p.runResource},
			job{name: JobInterface, interval: b.InterfaceEvery, timeout: backupTimeout(b.InterfaceEvery), run: p.runInterfaces},
		)
	}
	return jobs
}

func backupTimeout(interval time.Duration) time.Duration {
	return min(interval*9/10, maxBackupTimeout)
}

// Stop menghentikan polling satu router. Tidak melakukan apa pun bila router
// itu tidak dipoll.
func (p *Poller) Stop(routerID string) {
	p.mu.Lock()
	w, ok := p.workers[routerID]
	delete(p.workers, routerID)
	p.mu.Unlock()
	if ok {
		w.cancel()
	}
}

// Wait menunggu semua goroutine polling selesai (setelah ctx dibatalkan atau
// Stop dipanggil).
func (p *Poller) Wait() { p.wg.Wait() }

// Status mengembalikan kondisi polling queue (traffic) satu router.
func (p *Poller) Status(routerID string) (Status, bool) {
	return p.JobStatus(routerID, JobQueue)
}

// JobStatus mengembalikan kondisi salah satu job (JobQueue, JobPPPActive,
// JobResource, atau JobInterface) satu router.
func (p *Poller) JobStatus(routerID, jobName string) (Status, bool) {
	p.mu.Lock()
	w, ok := p.workers[routerID]
	p.mu.Unlock()
	if !ok {
		return Status{}, false
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	s, ok := w.status[jobName]
	if !ok {
		return Status{}, false
	}
	return *s, true
}

func (p *Poller) runJob(ctx context.Context, w *worker, j job) {
	log := p.opts.Logger.With("router", w.routerID, "job", j.name)
	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()

	failures := 0
	var downSince time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		err := p.execute(ctx, w, j)
		if ctx.Err() != nil {
			return
		}
		if err == nil {
			if failures > 0 {
				log.Info("polling router pulih", "gagal_berturut", failures, "terputus_selama", p.opts.Now().Sub(downSince).Round(time.Second).String())
				ticker.Reset(j.interval)
			}
			failures = 0
			continue
		}

		failures++
		if failures == 1 {
			downSince = p.opts.Now()
		}
		if failures == 1 || failures%logEvery == 0 {
			log.Warn("polling router gagal", "error", err.Error(), "gagal_berturut", failures)
		}
		// Router yang mati tidak perlu ditanyai sesering biasa.
		if failures >= failuresBeforeBackoff {
			ticker.Reset(backoff(j.interval, failures-failuresBeforeBackoff))
		}
	}
}

// backoff menggandakan jarak polling tiap kegagalan tambahan, sampai maxBackoff.
func backoff(interval time.Duration, extraFailures int) time.Duration {
	delay := interval
	for i := 0; i <= extraFailures && delay < maxBackoff; i++ {
		delay *= 2
	}
	return min(delay, maxBackoff)
}

// execute menjalankan satu putaran job dan mencatat hasilnya di Status.
func (p *Poller) execute(ctx context.Context, w *worker, j job) error {
	started := p.opts.Now()
	reqCtx, cancel := context.WithTimeout(ctx, j.timeout)
	defer cancel()

	items, err := j.run(reqCtx, w, started)
	elapsed := p.opts.Now().Sub(started)
	if p.opts.OnResult != nil && ctx.Err() == nil {
		defer func() { p.opts.OnResult(w.routerID, j.name, err) }()
	}
	if err == nil {
		w.update(j.name, func(s *Status) {
			s.LastSuccess = started
			s.LastDuration = elapsed
			s.LastItemCount = items
			s.ConsecutiveFailures = 0
			s.LastError = ""
		})
		return nil
	}

	if errors.Is(err, context.DeadlineExceeded) {
		err = fmt.Errorf("router tidak menjawab dalam %s", j.timeout)
	}
	w.update(j.name, func(s *Status) {
		s.ConsecutiveFailures++
		s.LastDuration = elapsed
		s.LastError = err.Error()
	})
	return err
}

func (w *worker) update(jobName string, fn func(*Status)) {
	w.mu.Lock()
	defer w.mu.Unlock()
	fn(w.status[jobName])
}

// ---- isi tiap job ----

// runQueues: satu permintaan massal, dijumlahkan menjadi satu sampel traffic.
func (p *Poller) runQueues(ctx context.Context, w *worker, started time.Time) (int, error) {
	samples, err := w.client.Queues(ctx)
	if err != nil {
		return 0, err
	}
	down, up, counted := Totals(samples)
	// Sampel dicap detik saat permintaan dikirim, bukan saat jawaban tiba.
	point := state.TrafficPoint{Time: started.Unix(), RxMbps: down, TxMbps: up}
	if _, err := p.rec.RecordTraffic(w.routerID, point); err != nil {
		return 0, fmt.Errorf("simpan sampel traffic: %w", err)
	}

	var ratios []state.QueueRatio
	for _, s := range samples {
		// Abaikan queue anak karena rule engine hanya mengevaluasi akun PPPoE utama.
		if s.Disabled || !s.TopLevel() {
			continue
		}
		var upRatio, downRatio float64
		if s.UpMax > 0 {
			upRatio = float64(s.UpBps) / float64(s.UpMax)
		}
		if s.DownMax > 0 {
			downRatio = float64(s.DownBps) / float64(s.DownMax)
		}
		ratios = append(ratios, state.QueueRatio{
			PPPoEUsername: s.Name,
			UpRatio:       upRatio,
			DownRatio:     downRatio,
		})
	}
	if len(ratios) > 0 {
		if changes, err := p.rec.SetQueues(ratios); err == nil && len(changes) > 0 && p.opts.Backup != nil && p.opts.Backup.Notify != nil {
			for _, ch := range changes {
				if ch.Changed() {
					p.opts.Backup.Notify(ch)
				}
			}
		}
	}

	return counted, nil
}

// runPPPActive: menyamakan status pelanggan dengan sesi PPPoE yang aktif.
func (p *Poller) runPPPActive(ctx context.Context, w *worker, started time.Time) (int, error) {
	sessions, err := w.client.PPPActive(ctx)
	if err != nil {
		return 0, err
	}
	b := p.opts.Backup
	result := reconcilePresence(b.Presence, b.Notify, w.routerID, sessions, started)
	if result.Flipped > 0 {
		log := p.opts.Logger.With("router", w.routerID)
		// Banyak pelanggan berubah sekaligus: bisa router baru restart, atau
		// jawaban yang janggal. Patut dilihat petugas.
		if result.Flipped >= 20 && result.Flipped*2 > result.Checked {
			log.Warn("polling /ppp/active mengubah status banyak pelanggan sekaligus", "diubah", result.Flipped, "diperiksa", result.Checked)
		} else {
			log.Info("polling /ppp/active menyamakan status pelanggan (webhook/syslog terlewat)", "diubah", result.Flipped)
		}
	}
	return len(sessions), nil
}

func (p *Poller) runResource(ctx context.Context, w *worker, _ time.Time) (int, error) {
	resource, err := w.client.Resource(ctx)
	if err != nil {
		return 0, err
	}
	resource.At = p.opts.Now()
	if err := p.opts.Backup.Store.SetRouterResource(w.routerID, resource); err != nil {
		return 0, fmt.Errorf("simpan resource router: %w", err)
	}
	return 1, nil
}

func (p *Poller) runInterfaces(ctx context.Context, w *worker, _ time.Time) (int, error) {
	interfaces, err := w.client.Interfaces(ctx)
	if err != nil {
		return 0, err
	}
	if err := p.opts.Backup.Store.SetRouterInterfaces(w.routerID, interfaces, p.opts.Now()); err != nil {
		return 0, fmt.Errorf("simpan interface router: %w", err)
	}
	return len(interfaces), nil
}
