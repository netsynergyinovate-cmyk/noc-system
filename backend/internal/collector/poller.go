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
	// TrafficFromQueues: true = trafik dashboard dari jumlah rate simple queue (cara lama: dihaluskan
	// RouterOS, tertinggal sekitar 3 detik, hanya pelanggan ber-queue). Bawaan false: counter interface.
	TrafficFromQueues bool
	// TrafficInterface: interface yang counter byte-nya menjadi trafik dashboard (sama dengan Winbox).
	// Kosong = cari interface berkomentar TrafficComment di tiap router. Tanpa keduanya (atau bila
	// interface tidak ditemukan) dipakai jumlah rate simple queue seperti sebelumnya.
	TrafficInterface string
	// TrafficComment: komentar interface uplink; bawaan "UPLINK".
	TrafficComment string
	// TrafficCustomerSide: true bila interface itu menghadap pelanggan (mis. ke OLT), jadi Tx =
	// download dan Rx = upload. Bawaan false: interface uplink, Rx = download dan Tx = upload.
	TrafficCustomerSide bool
	// Backup mengaktifkan jalur cadangan; nil berarti hanya polling queue.
	Backup *BackupOptions
	// OnResult dipanggil setelah tiap putaran job selesai (err nil = berhasil), dari
	// goroutine job. Dipakai untuk melacak keterjangkauan router. Tidak dipanggil
	// untuk putaran yang dibatalkan karena router dihentikan. Boleh nil.
	OnResult func(routerID, job string, err error)
	// OnQueues menerima seluruh simple queue tiap polling queue yang berhasil (mis. arsip
	// trafik per pelanggan), dari goroutine job; tidak boleh memblokir. Boleh nil.
	OnQueues func(routerID string, at time.Time, samples []QueueSample)
	// OnSessions menerima daftar sesi /ppp/active tiap polling yang berhasil
	// (mis. peta IP pelanggan untuk NetFlow); tidak boleh memblokir. Boleh nil.
	OnSessions func(routerID string, sessions []PPPSession)
	// OnIsolir menerima peta status isolir router per username PPPoE
	// (true bila IP sesi masuk ke address-list isolir router, false bila tidak);
	// tidak boleh memblokir. Dipanggil bila router memiliki bukti address-list isolir. Boleh nil.
	OnIsolir func(routerID string, isolated map[string]bool)
	// OnVlans menerima laju tiap VLAN PON (vlan1101..) tiap detik, dari goroutine job;
	// tidak boleh memblokir. Nil = job VLAN tidak dijalankan.
	OnVlans func(routerID string, rates []VlanRate)
	Now     func() time.Time
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

	// Sumber trafik dari counter interface (hanya disentuh goroutine job queue, jadi tanpa kunci).
	ifName      string    // interface yang dipakai; kosong = belum/tidak ditemukan
	ifLookupAt  time.Time // terakhir mencari interface berkomentar (untuk membatasi pencarian)
	ifPrev      *ifSample
	ifLogged    bool
	ifFallbackW bool

	isolirErrLogged bool

	// Pembacaan counter VLAN sebelumnya (hanya disentuh goroutine job VLAN).
	vlanPrev map[string]ifSample

	// Aliran monitor-traffic (hanya protokol API biner). Menyimpan laju terakhir
	// yang dikirim router, dalam Mbps, beserta waktunya.
	streamMu     sync.Mutex
	streamRxMbps float64
	streamTxMbps float64
	streamAt     time.Time
	streamIface  string
	streamLogged bool
}

type job struct {
	name       string
	interval   time.Duration
	timeout    time.Duration
	maxBackoff time.Duration
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
		if opts.Interval >= time.Second {
			opts.RequestTimeout = max(2*time.Second, opts.Interval*9/10)
		} else {
			opts.RequestTimeout = opts.Interval * 9 / 10
		}
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.TrafficComment == "" {
		opts.TrafficComment = "UPLINK"
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
	// Hot-path: API biner bisa mengalirkan laju interface lewat
	// /interface/monitor-traffic tanpa membaca counter dua kali tiap detik.
	if client.usesBinaryAPI() && !p.opts.TrafficFromQueues {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			p.streamTraffic(workerCtx, w)
		}()
	}
	return nil
}

// streamTraffic menjaga satu aliran monitor-traffic tetap hidup. Bila koneksi
// putus, aliran dibuka ulang dengan jeda pendek; laju terakhir yang basi tidak
// dipakai (interfaceTraffic kembali ke counter).
func (p *Poller) streamTraffic(ctx context.Context, w *worker) {
	log := p.opts.Logger.With("router", w.routerID, "job", "monitor-traffic")
	name := p.opts.TrafficInterface
	if name == "" {
		if n, err := w.client.FindInterfaceByComment(ctx, p.opts.TrafficComment); err == nil {
			name = n
		}
	}
	if name == "" {
		log.Warn("monitor-traffic dilewati: interface berkomentar tidak ditemukan atau ambigu; memakai counter interface", "komentar", p.opts.TrafficComment)
	}
	failures := 0
	for ctx.Err() == nil {
		if name == "" {
			// Cari ulang tiap 5 menit: interface bisa muncul setelah boot.
			select {
			case <-ctx.Done():
				return
			case <-time.After(ifLookupEvery):
			}
			if n, err := w.client.FindInterfaceByComment(ctx, p.opts.TrafficComment); err == nil && n != "" {
				name = n
			}
			continue
		}
		err := w.client.MonitorTraffic(ctx, name, func(rx, tx float64) {
			now := p.opts.Now()
			w.streamMu.Lock()
			w.streamRxMbps, w.streamTxMbps, w.streamAt, w.streamIface = rx, tx, now, name
			first := !w.streamLogged
			w.streamLogged = true
			w.streamMu.Unlock()
			if first && !p.opts.TrafficCustomerSide {
				log.Info("trafik dashboard mengalir dari monitor-traffic", "interface", name)
			}
			// Hot path: sampel langsung dicatat tanpa menunggu putaran queue.
			down, up := rx, tx
			if p.opts.TrafficCustomerSide {
				down, up = tx, rx
			}
			if _, err := p.rec.RecordTraffic(w.routerID, state.TrafficPoint{Time: now.Unix(), RxMbps: down, TxMbps: up}); err != nil {
				log.Debug("simpan sampel monitor-traffic gagal", "error", err)
			}
		})
		if ctx.Err() != nil {
			return
		}
		failures++
		if err != nil && (failures == 1 || failures%10 == 0) {
			log.Warn("aliran monitor-traffic terputus, mencoba lagi", "error", err, "gagal_berturut", failures)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
		if p.opts.TrafficInterface == "" {
			if n, lookupErr := w.client.FindInterfaceByComment(ctx, p.opts.TrafficComment); lookupErr == nil && n != "" {
				name = n
			}
		}
	}
}

// streamRate mengembalikan laju aliran terakhir bila masih segar. Sampel yang
// lebih tua dari satu interval polling dilewati supaya grafik tidak menampilkan
// angka lama sebagai laju saat ini.
func (w *worker) streamRate(now time.Time) (rx, tx float64, ok bool) {
	w.streamMu.Lock()
	defer w.streamMu.Unlock()
	if w.streamAt.IsZero() || now.Sub(w.streamAt) > 2*time.Second {
		return 0, 0, false
	}
	return w.streamRxMbps, w.streamTxMbps, true
}

// jobs menyusun daftar polling untuk satu router.
func (p *Poller) jobs() []job {
	jobs := []job{{
		name:       JobQueue,
		interval:   p.opts.Interval,
		timeout:    p.opts.RequestTimeout,
		maxBackoff: 2 * time.Second,
		run:        p.runQueues,
	}}
	if p.opts.OnVlans != nil {
		jobs = append(jobs, job{
			name:       JobVLAN,
			interval:   p.opts.Interval,
			timeout:    p.opts.RequestTimeout,
			maxBackoff: 2 * time.Second,
			run:        p.runVlans,
		})
	}
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
		// Router yang mati tidak perlu ditanyai sesering biasa; job real-time dibatasi maxBackoff kecil.
		if failures >= failuresBeforeBackoff {
			capDelay := j.maxBackoff
			if capDelay <= 0 {
				capDelay = maxBackoff
			}
			ticker.Reset(backoffWithCap(j.interval, failures-failuresBeforeBackoff, capDelay))
		}
	}
}

// backoff menggandakan jarak polling tiap kegagalan tambahan, sampai maxBackoff.
func backoff(interval time.Duration, extraFailures int) time.Duration {
	return backoffWithCap(interval, extraFailures, maxBackoff)
}

func backoffWithCap(interval time.Duration, extraFailures int, capDelay time.Duration) time.Duration {
	if capDelay <= 0 {
		capDelay = maxBackoff
	}
	delay := interval
	for i := 0; i <= extraFailures && delay < capDelay; i++ {
		delay *= 2
	}
	return min(delay, capDelay)
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
	if p.opts.OnQueues != nil {
		p.opts.OnQueues(w.routerID, started, samples)
	}
	down, up, counted := Totals(samples)
	// Trafik dashboard dari counter interface (sama dengan Winbox, tanpa jeda); jumlah queue hanya
	// cadangan bila interface tidak tersedia.
	if rx, tx, ok := p.interfaceTraffic(ctx, w); ok {
		down, up = rx, tx
	}
	// Hot path API biner sudah mencatat sampelnya sendiri. Putaran queue hanya
	// mencatat saat aliran sedang tidak segar (putus/ belum mulai).
	if _, _, streaming := w.streamRate(started); !streaming {
		point := state.TrafficPoint{Time: started.Unix(), RxMbps: down, TxMbps: up}
		if _, err := p.rec.RecordTraffic(w.routerID, point); err != nil {
			return 0, fmt.Errorf("simpan sampel traffic: %w", err)
		}
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

// ifLookupEvery: jarak minimal antar pencarian interface berkomentar bila belum ketemu.
const ifLookupEvery = 5 * time.Minute

// interfaceTraffic mengembalikan laju download/upload (Mbps) dari counter interface. ok=false bila
// belum ada pembanding, interface tidak ditemukan, atau pembacaan gagal: pemanggil memakai cadangan.
func (p *Poller) interfaceTraffic(ctx context.Context, w *worker) (downMbps, upMbps float64, ok bool) {
	if p.opts.TrafficFromQueues {
		return 0, 0, false
	}
	now := p.opts.Now()
	// Jalur API biner: laju sudah dikirim router lewat monitor-traffic.
	if rx, tx, ok := w.streamRate(now); ok {
		if p.opts.TrafficCustomerSide {
			return tx, rx, true
		}
		return rx, tx, true
	}
	if w.ifName == "" {
		if p.opts.TrafficInterface != "" {
			w.ifName = p.opts.TrafficInterface
		} else if w.ifLookupAt.IsZero() || now.Sub(w.ifLookupAt) >= ifLookupEvery {
			w.ifLookupAt = now
			name, err := w.client.FindInterfaceByComment(ctx, p.opts.TrafficComment)
			if err == nil && name != "" {
				w.ifName = name
			} else if !w.ifFallbackW {
				w.ifFallbackW = true
				p.opts.Logger.Warn("trafik memakai jumlah rate queue: interface berkomentar tidak ditemukan atau ambigu",
					"router", w.routerID, "komentar", p.opts.TrafficComment)
			}
		}
		if w.ifName == "" {
			return 0, 0, false
		}
	}
	t0 := p.opts.Now()
	cur, err := w.client.InterfaceCounters(ctx, w.ifName)
	t1 := p.opts.Now()
	if err != nil {
		if w.ifPrev != nil && t0.Sub(w.ifPrev.At) > maxIfGap {
			w.ifPrev = nil
		}
		return 0, 0, false
	}
	if !w.ifLogged {
		w.ifLogged = true
		p.opts.Logger.Info("trafik dashboard dari counter interface", "router", w.routerID, "interface", w.ifName, "sisi_pelanggan", p.opts.TrafficCustomerSide)
	}
	// Router membaca counter di tengah permintaan; pakai titik tengahnya sebagai saat pembacaan.
	sample := ifSample{At: t0.Add(t1.Sub(t0) / 2), Rx: cur.RxBytes, Tx: cur.TxBytes}
	prev := w.ifPrev
	w.ifPrev = &sample
	if prev == nil {
		return 0, 0, false
	}
	rx, tx, ok := ifRate(*prev, sample)
	if !ok {
		return 0, 0, false
	}
	if p.opts.TrafficCustomerSide {
		return tx, rx, true
	}
	return rx, tx, true
}

// runPPPActive: menyamakan status pelanggan dengan sesi PPPoE yang aktif.
func (p *Poller) runPPPActive(ctx context.Context, w *worker, started time.Time) (int, error) {
	sessions, err := w.client.PPPActive(ctx)
	if err != nil {
		return 0, err
	}
	if p.opts.OnSessions != nil {
		p.opts.OnSessions(w.routerID, sessions)
	}
	if p.opts.OnIsolir != nil {
		entries, err := w.client.AddressList(ctx)
		if err != nil {
			if p.opts.Logger != nil {
				if !w.isolirErrLogged {
					w.isolirErrLogged = true
					p.opts.Logger.Warn("baca address-list isolir router gagal", "router", w.routerID, "error", err)
				} else {
					p.opts.Logger.Debug("baca address-list isolir router gagal", "router", w.routerID, "error", err)
				}
			}
		} else {
			w.isolirErrLogged = false
			isolated := MatchIsolirSessions(sessions, entries)
			if len(isolated) > 0 {
				p.opts.OnIsolir(w.routerID, isolated)
			}
		}
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
