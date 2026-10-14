package billing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime"
	"runtime/debug"
	"slices"
	"time"
)

const (
	// DefaultSyncTimeout adalah batas waktu satu sinkron penuh (login, semua
	// halaman, pencocokan, dan penyimpanan). Sinkron yang melewatinya dibatalkan
	// dan ditandai failed, supaya satu sistem billing yang menggantung tidak
	// menahan sinkron berikutnya selamanya.
	DefaultSyncTimeout = 10 * time.Minute
	// DefaultKeepRuns adalah jumlah sinkron selesai yang disimpan di log: dua
	// minggu pada satu sinkron per jam. Sinkron success terbaru selalu disimpan
	// (lihat Store.PruneRuns) walau lebih tua.
	DefaultKeepRuns = 24 * 14

	// DefaultMaxReadAttempts adalah jumlah percobaan membaca sumber bila kegagalannya
	// sementara (Failure.Transient): satu percobaan awal ditambah dua ulangan.
	DefaultMaxReadAttempts = 3
	// DefaultFirstRetryDelay dan DefaultSecondRetryDelay adalah jeda sebelum
	// percobaan kedua dan ketiga. Cukup lama supaya gangguan singkat sempat reda,
	// dan cukup pendek supaya seluruh urutan (60 detik) jauh di bawah
	// DefaultSyncTimeout.
	DefaultFirstRetryDelay  = 15 * time.Second
	DefaultSecondRetryDelay = 45 * time.Second

	// failureWriteTimeout membatasi penulisan catatan gagal. Konteksnya sengaja
	// terpisah dari konteks sinkron: sinkron yang gagal karena dibatalkan atau
	// kehabisan waktu punya konteks yang sudah mati, dan menulis dengannya akan
	// gagal juga, meninggalkan baris running.
	failureWriteTimeout = 10 * time.Second
	// pruneTimeout membatasi pemangkasan riwayat sesudah sinkron berhasil.
	pruneTimeout = time.Minute
)

// Galat yang dibuat Syncer. Pesannya disimpan apa adanya di log sinkron dan
// tampil di dashboard, jadi ditulis sebagai kalimat Indonesia lengkap. Semuanya
// dibedakan dengan errors.Is.
var (
	// ErrEmptyInvoiceSource berarti sumber tagihan menjawab tanpa satu pun tagihan.
	// Hasil kosong akan menghapus billing_status seluruh pelanggan (ApplySuccess
	// memperlakukan pelanggan tanpa tagihan sebagai "tanpa status"), padahal
	// penyebab paling mungkin adalah halaman yang berubah atau sesi yang rusak,
	// bukan billing yang benar-benar kosong. Sinkron karenanya gagal dan status
	// lama dipertahankan.
	ErrEmptyInvoiceSource = errors.New("Sumber billing tidak mengembalikan satu pun tagihan; status lama dipertahankan.")
	// ErrSyncCanceled berarti sinkron dihentikan karena konteks induknya dibatalkan,
	// yaitu backend berhenti.
	ErrSyncCanceled = errors.New("Sinkron dibatalkan karena backend berhenti.")
	// ErrSyncTimeout berarti sinkron melewati batas waktunya (SyncerOptions.Timeout).
	ErrSyncTimeout = errors.New("Sinkron melewati batas waktu.")
	// ErrSyncPanic berarti ada kode di dalam sinkron yang panik. Penyebabnya galat
	// pemrograman; detailnya hanya ada di log, tidak di log sinkron.
	ErrSyncPanic = errors.New("Sinkron berhenti karena kesalahan internal.")
	// ErrAnomalousDrop berarti jumlah tagihan turun drastis dibanding sinkron
	// berhasil terakhir (lihat DropGuard). Angkanya ada di
	// *InvoiceDropError.
	ErrAnomalousDrop = errors.New("Jumlah tagihan turun drastis.")
)

// InvoiceDropError menyebut jumlah tagihan sinkron berhasil terakhir (Previous) dan
// jumlah yang baru saja terbaca (Current). errors.Is(err, ErrAnomalousDrop) benar
// untuknya.
type InvoiceDropError struct {
	Previous, Current int
}

func (e *InvoiceDropError) Error() string {
	return fmt.Sprintf("%s Dari %d ke %d tagihan.", ErrAnomalousDrop.Error(), e.Previous, e.Current)
}

func (e *InvoiceDropError) Unwrap() error { return ErrAnomalousDrop }

// reasonError membawa pesan baku (sentinel) tetapi tetap membuka penyebab
// aslinya lewat errors.Is dan errors.As. Pesan baku itulah yang disimpan di log
// sinkron; penyebab asli ("context canceled", dsb.) tidak berguna bagi operator.
type reasonError struct {
	reason error
	cause  error
}

func (e *reasonError) Error() string   { return e.reason.Error() }
func (e *reasonError) Unwrap() []error { return []error{e.reason, e.cause} }

// PanicError adalah panic yang ditangkap dan diubah menjadi galat. Teksnya baku
// (ErrSyncPanic); Detail dan Stack hanya untuk log.
type PanicError struct {
	// Detail adalah jenis nilai panic, ditambah pesannya bila itu galat runtime
	// (indeks di luar batas, pointer nil, dst.). Nilai panic lain TIDAK dicetak:
	// panic(fmt.Sprintf("... %s", sandi)) tidak boleh sampai ke log.
	Detail string
	Stack  []byte
}

func (e *PanicError) Error() string { return ErrSyncPanic.Error() }
func (e *PanicError) Unwrap() error { return ErrSyncPanic }

func newPanicError(recovered any) *PanicError {
	detail := fmt.Sprintf("%T", recovered)
	if re, ok := recovered.(runtime.Error); ok {
		detail += ": " + re.Error()
	}
	return &PanicError{Detail: detail, Stack: debug.Stack()}
}

// guard menjalankan fn dan mengubah panic di dalamnya menjadi *PanicError.
func guard(fn func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = newPanicError(r)
		}
	}()
	return fn()
}

// InvoiceSource membaca daftar tagihan terbaru. *Scraper memenuhinya. Hasilnya
// harus semua-atau-tidak-sama-sekali (lihat Scraper.Invoices).
type InvoiceSource interface {
	Invoices(ctx context.Context) ([]Invoice, Stats, error)
}

// RunStore adalah bagian Store yang dipakai satu sinkron. *Store memenuhinya.
type RunStore interface {
	BeginRun(ctx context.Context, trigger Trigger, now time.Time) (string, error)
	LoadCustomers(ctx context.Context) ([]Customer, error)
	ApplySuccess(ctx context.Context, runID string, res Result, now time.Time) error
	FailRun(ctx context.Context, runID string, cause error, now time.Time) error
	PruneRuns(ctx context.Context, keep int) (int, error)
	// LastSuccess memberi ringkasan sinkron success terbaru; bool kedua salah bila
	// belum pernah ada. Pembanding penjaga hasil yang menyusut.
	LastSuccess(ctx context.Context) (SuccessRun, bool, error)
}

var (
	_ InvoiceSource = (*Scraper)(nil)
	_ RunStore      = (*Store)(nil)
	_ ScheduleStore = (*Store)(nil)
)

// RunStatus adalah akhir dari satu panggilan RunOnce.
type RunStatus string

const (
	// RunSuccess berarti hasil sudah diterapkan dan log ditutup success.
	RunSuccess RunStatus = "success"
	// RunFailed berarti sinkron gagal. Bila RunID terisi, log-nya sudah ditutup
	// failed (kecuali RunOutcome.Err juga memuat kegagalan menulisnya).
	RunFailed RunStatus = "failed"
	// RunSkipped berarti sudah ada sinkron yang berjalan; tidak ada yang ditulis.
	RunSkipped RunStatus = "skipped"
)

// RunOutcome menceritakan satu panggilan RunOnce.
type RunOutcome struct {
	Status  RunStatus
	Trigger Trigger
	// RunID adalah ID baris log; kosong bila sinkron dilewati atau BeginRun gagal.
	RunID      string
	StartedAt  time.Time
	FinishedAt time.Time
	// Counts hanya terisi pada RunSuccess.
	Counts Counts
	// Stats adalah ringkasan pembacaan; terisi sejauh sumber mengembalikannya.
	Stats Stats
	// Pruned adalah jumlah sinkron lama yang dibuang sesudah sinkron berhasil.
	Pruned int
	// Err adalah penyebab pada RunFailed (sama dengan galat yang dikembalikan).
	Err error
	// NotifyErr adalah galat (atau *PanicError) dari pendengar perubahan status
	// (SyncerOptions.OnStatusChanges) pada RunSuccess. Sinkronnya sendiri tetap
	// berhasil dan sudah tersimpan; ini hanya memberi tahu bahwa dashboard mungkin
	// belum menerima perubahannya. Nil bila tidak ada pendengar atau ia berhasil.
	NotifyErr error
	// Failure menggolongkan Err pada RunFailed (jenis dan pesan yang disimpan di
	// log sinkron); nol pada sinkron yang berhasil atau dilewati.
	Failure Failure
	// Attempts adalah berapa kali sumber dibaca dalam sinkron ini (1 bila tidak ada
	// ulangan; 0 bila pembacaan tidak pernah dimulai).
	Attempts int
}

// Duration adalah lama sinkron menurut jam Syncer.
func (o RunOutcome) Duration() time.Duration { return o.FinishedAt.Sub(o.StartedAt) }

// SyncerOptions mengatur Syncer. Semuanya boleh kosong.
type SyncerOptions struct {
	// Logger mencatat awal, akhir, dan kegagalan tiap sinkron. Kosong berarti
	// tidak mencatat apa pun. Hanya hitungan, nama tahap, dan pesan galat yang
	// dicatat: tidak pernah kata sandi, token, cookie, atau isi tagihan.
	Logger *slog.Logger
	// Now adalah jam; bawaannya time.Now. Dipakai untuk waktu mulai dan selesai
	// di log sinkron dan untuk lama sinkron.
	Now func() time.Time
	// Timeout adalah batas waktu satu sinkron; nol berarti DefaultSyncTimeout.
	Timeout time.Duration
	// Keep adalah jumlah sinkron selesai yang dipertahankan; nol berarti
	// DefaultKeepRuns.
	Keep int

	// MaxReadAttempts adalah jumlah percobaan membaca sumber bila kegagalannya
	// sementara (Classify(err).Transient); nol berarti DefaultMaxReadAttempts, satu
	// berarti tanpa ulangan. Kegagalan permanen tidak pernah diulang berapa pun nilainya.
	MaxReadAttempts int
	// RetryDelays adalah jeda sebelum percobaan kedua, ketiga, dan seterusnya. Kosong
	// berarti DefaultFirstRetryDelay lalu DefaultSecondRetryDelay; bila percobaan
	// lebih banyak daripada jeda, jeda terakhir dipakai terus. Nol berarti ulangi
	// segera (tes). Tidak boleh negatif.
	RetryDelays []time.Duration
	// After menunggu d lalu mengirim waktu ke kanal yang dikembalikan, seperti
	// time.After. Bawaannya pewaktu sungguhan; tes memasang pewaktu palsu supaya
	// tidak ada yang menunggu waktu sungguhan.
	After func(d time.Duration) <-chan time.Time

	// DropGuard mengatur penjaga hasil yang menyusut drastis. Nil berarti
	// DefaultDropGuard(); bila diisi harus lolos DropGuard.Validate, dan Percent 0
	// mematikan penjaga. cmd/server mengisinya dari BILLING_DROP_PERCENT dan
	// BILLING_DROP_MIN_INVOICES (DropGuardFromEnv).
	DropGuard *DropGuard

	// OnStatusChanges memberi tahu perubahan status Lunas/Isolir yang baru saja
	// diterapkan (Result.Changes), supaya sisi lain (cmd/server: state.Manager lalu
	// WebSocket hub) bisa meneruskannya ke dashboard. Nil berarti tidak ada pendengar.
	//
	//   - Dipanggil TEPAT SEKALI per sinkron yang berhasil (RunSuccess), sesudah
	//     Store.ApplySuccess kembali tanpa galat, yaitu sesudah transaksi
	//     ter-commit; changes boleh kosong. Tidak pernah dipanggil pada sinkron yang
	//     gagal, dilewati, dibatalkan, bersumber kosong, atau ditolak penjaga
	//     penurunan, karena pada semuanya status tidak berubah.
	//   - changes adalah salinan: mengubahnya tidak memengaruhi apa pun.
	//   - Dipanggil di goroutine sinkron dan RunOnce menunggunya; buat cepat dan
	//     jangan memblokir (tidak ada konteks dan tidak ada batas waktu).
	//   - Galat atau panic di dalamnya tidak menggagalkan sinkron yang sudah
	//     tersimpan: dicatat di log dan dikembalikan lewat RunOutcome.NotifyErr.
	OnStatusChanges func(changes []StatusChange) error
}

// Syncer menjalankan satu sinkron billing dari awal sampai akhir: membaca
// tagihan, mencocokkannya dengan pelanggan, menerapkan hasilnya, dan mencatat
// hasilnya di log sinkron. Tidak tahu kapan dijalankan (itu Scheduler). Satu-
// satunya yang diulangnya adalah PEMBACAAN sumber, dan hanya bila kegagalannya
// sementara (lihat readInvoices); sisanya gagal sekali dan status lama bertahan.
// Aman dipanggil dari beberapa goroutine: sinkron kedua yang tiba saat yang
// pertama berjalan dilewati, bukan ditumpuk.
type Syncer struct {
	source  InvoiceSource
	store   RunStore
	log     *slog.Logger
	now     func() time.Time
	timeout time.Duration
	keep    int

	maxAttempts int
	retryDelays []time.Duration
	after       func(d time.Duration) <-chan time.Time
	drop        DropGuard
	onChanges   func(changes []StatusChange) error

	// derive membuat konteks sinkron dari konteks induk. Bawaannya menambah
	// batas waktu; tes memasang yang lain supaya batas waktu bisa dicoba tanpa
	// menunggu.
	derive func(parent context.Context) (context.Context, context.CancelFunc)
}

// NewSyncer menyusun Syncer. source dan store wajib ada.
func NewSyncer(source InvoiceSource, store RunStore, opts SyncerOptions) (*Syncer, error) {
	if source == nil || store == nil {
		return nil, errors.New("billing: Syncer butuh sumber tagihan dan penyimpanan")
	}
	if opts.Timeout < 0 {
		return nil, errors.New("billing: batas waktu sinkron tidak boleh negatif")
	}
	if opts.Keep < 0 {
		return nil, errors.New("billing: jumlah sinkron yang disimpan tidak boleh negatif")
	}
	if opts.MaxReadAttempts < 0 {
		return nil, errors.New("billing: jumlah percobaan baca tidak boleh negatif")
	}
	for _, d := range opts.RetryDelays {
		if d < 0 {
			return nil, errors.New("billing: jeda percobaan ulang tidak boleh negatif")
		}
	}
	drop := DefaultDropGuard()
	if opts.DropGuard != nil {
		drop = *opts.DropGuard
		if err := drop.Validate(); err != nil {
			return nil, err
		}
	}
	s := &Syncer{
		source: source, store: store, log: opts.Logger, now: opts.Now, timeout: opts.Timeout, keep: opts.Keep,
		maxAttempts: opts.MaxReadAttempts, retryDelays: slices.Clone(opts.RetryDelays), after: opts.After,
		drop: drop, onChanges: opts.OnStatusChanges,
	}
	if s.maxAttempts == 0 {
		s.maxAttempts = DefaultMaxReadAttempts
	}
	if len(s.retryDelays) == 0 {
		s.retryDelays = []time.Duration{DefaultFirstRetryDelay, DefaultSecondRetryDelay}
	}
	if s.after == nil {
		s.after = time.After
	}
	if s.log == nil {
		s.log = slog.New(slog.DiscardHandler)
	}
	if s.now == nil {
		s.now = time.Now
	}
	if s.timeout == 0 {
		s.timeout = DefaultSyncTimeout
	}
	if s.keep == 0 {
		s.keep = DefaultKeepRuns
	}
	s.derive = func(parent context.Context) (context.Context, context.CancelFunc) {
		return context.WithTimeout(parent, s.timeout)
	}
	return s, nil
}

// Nama tahap untuk log. Tahap menunjukkan di langkah mana sinkron berhenti; itu
// bukan klasifikasi galat.
const (
	stageBegin     = "mulai"
	stageInvoices  = "baca_tagihan"
	stageCompare   = "bandingkan"
	stageCustomers = "baca_pelanggan"
	stageMatch     = "cocokkan"
	stageApply     = "terapkan"
)

// RunOnce menjalankan satu sinkron.
//
//   - Sudah ada sinkron berjalan (ErrRunInProgress): RunSkipped dan galat nil.
//     Itu keadaan biasa (mis. dua pemicu bersamaan), bukan kegagalan, jadi tidak
//     ada baris log dan tidak ada catatan gagal.
//   - Berhasil: RunSuccess dan galat nil. Pendengar perubahan status
//     (SyncerOptions.OnStatusChanges) dipanggil sekali, sesudah transaksi ter-commit;
//     galat atau panic-nya hanya dicatat (RunOutcome.NotifyErr). Pemangkasan riwayat
//     sesudahnya hanya dicatat bila gagal; sinkron yang sudah berhasil tidak ikut
//     gagal karenanya.
//   - Pembacaan sumber yang gagal sementara (network, timeout, server_error)
//     diulang di dalam sinkron yang sama, paling banyak MaxReadAttempts kali dan
//     tidak melewati batas waktu sinkron; hasilnya tetap SATU baris log. Kegagalan
//     permanen tidak pernah diulang.
//   - Hasil yang menyusut drastis dibanding sinkron berhasil terakhir ditolak
//     (ErrAnomalousDrop) sebelum menyentuh data apa pun.
//   - Gagal sesudah BeginRun, apa pun sebabnya (galat sumber, sumber kosong, galat
//     database, panic, konteks dibatalkan, batas waktu): log sinkron ditutup failed
//     dengan Classify(penyebab).Message (bukan teks mentah galatnya),
//     billing_status dan customers tidak disentuh, dan galat
//     penyebabnya dikembalikan bersama RunFailed. Bila penulisan catatan gagal itu
//     sendiri gagal, galatnya digabung (errors.Join) ke galat yang dikembalikan.
//   - Gagal sebelum ada baris log (BeginRun gagal): RunFailed tanpa RunID.
//
// Pembatalan ctx berarti backend berhenti: sinkron diberhentikan seketika dan
// ditandai failed dengan ErrSyncCanceled. Catatan gagalnya ditulis dengan konteks
// terpisah yang tidak ikut dibatalkan.
func (s *Syncer) RunOnce(parent context.Context, trigger Trigger) (RunOutcome, error) {
	started := s.now().UTC()
	out := RunOutcome{Trigger: trigger, StartedAt: started}

	ctx, cancel := s.derive(parent)
	defer cancel()

	var runID string
	err := guard(func() (e error) {
		runID, e = s.store.BeginRun(ctx, trigger, started)
		return e
	})
	if errors.Is(err, ErrRunInProgress) {
		out.Status, out.FinishedAt = RunSkipped, s.now().UTC()
		s.log.Info("sinkron billing dilewati: masih ada sinkron yang berjalan", "trigger", string(trigger))
		return out, nil
	}
	if err != nil {
		// Belum ada baris log, jadi tidak ada yang bisa ditutup.
		return s.fail(parent, ctx, out, stageBegin, err)
	}
	out.RunID = runID
	s.log.Info("sinkron billing dimulai", "run_id", runID, "trigger", string(trigger))

	var (
		invoices  []Invoice
		customers []Customer
		res       Result
	)
	steps := []struct {
		stage string
		run   func() error
	}{
		{stageInvoices, func() (e error) {
			invoices, e = s.readInvoices(ctx, runID, started, &out)
			return e
		}},
		{stageCompare, func() error {
			return s.checkNoDrasticDrop(ctx, len(invoices))
		}},
		{stageCustomers, func() (e error) {
			customers, e = s.store.LoadCustomers(ctx)
			return e
		}},
		{stageMatch, func() error {
			res = MatchInvoices(invoices, customers)
			return nil
		}},
		{stageApply, func() error {
			return s.store.ApplySuccess(ctx, runID, res, s.now().UTC())
		}},
	}
	for _, step := range steps {
		if err := guard(step.run); err != nil {
			return s.fail(parent, ctx, out, step.stage, err)
		}
	}

	out.Status, out.FinishedAt, out.Counts = RunSuccess, s.now().UTC(), res.Counts
	c := res.Counts
	s.log.Info("sinkron billing selesai",
		"run_id", runID, "trigger", string(trigger),
		"tagihan", c.Invoices,
		"cocok", c.MatchedExact+c.MatchedNormalized,
		"tidak_cocok", c.UnmatchedUnknown+c.UnmatchedDuplicate+c.UnmatchedAmbiguous,
		"tanpa_tagihan", c.WithoutInvoice,
		"berubah", c.StatusesChanged,
		"halaman", out.Stats.Pages,
		"durasi", out.Duration().String())

	// Sesudah commit dan sebelum pemangkasan (yang bisa lama): dashboard tidak perlu
	// menunggu pembersihan riwayat.
	out.NotifyErr = s.notifyChanges(runID, res.Changes)
	out.Pruned = s.prune(parent, runID)
	return out, nil
}

// notifyChanges memberi tahu pendengar perubahan status. Sinkronnya sudah
// ter-commit, jadi apa pun yang terjadi di sini hanya dicatat: galat dan panic
// pendengar tidak boleh membatalkan hasil yang sudah tersimpan, dan tidak boleh
// menggagalkan pemangkasan sesudahnya.
func (s *Syncer) notifyChanges(runID string, changes []StatusChange) (err error) {
	if s.onChanges == nil {
		return nil
	}
	defer func() {
		if r := recover(); r != nil {
			pe := newPanicError(r)
			s.log.Error("pendengar perubahan status billing panik; sinkron tetap berhasil dan tersimpan",
				"run_id", runID, "panic", pe.Detail, "stack", string(pe.Stack))
			err = pe
		}
	}()
	if notifyErr := s.onChanges(slices.Clone(changes)); notifyErr != nil {
		s.log.Error("pendengar perubahan status billing gagal; sinkron tetap berhasil dan tersimpan",
			"run_id", runID, "error", notifyErr.Error())
		return notifyErr
	}
	s.log.Debug("perubahan status billing diteruskan", "run_id", runID, "berubah", len(changes))
	return nil
}

// readInvoices membaca sumber, mengulangnya bila kegagalannya sementara, dan
// menolak hasil kosong. Semua percobaan satu sinkron berbagi SATU baris log; hanya
// akhir dari seluruh urutan yang dicatat sebagai sukses atau gagal.
//
//   - Diulang hanya bila Classify(err).Transient (network, timeout, server_error).
//     Kegagalan permanen langsung dikembalikan: mengulang login yang ditolak
//     berisiko mengunci akun billing, dan mengulang halaman yang berubah atau
//     status yang tidak dikenal tidak akan berhasil.
//   - Paling banyak s.maxAttempts percobaan, dengan jeda s.retryDelays[i] sebelum
//     percobaan ke-(i+2) (jeda terakhir dipakai terus bila jedanya kurang).
//   - Tidak pernah melewati batas waktu sinkron: bila sisa waktu (menurut jam
//     Syncer, dihitung dari waktu mulai) tidak lebih panjang daripada jeda
//     berikutnya, tidak ada waktu tersisa untuk percobaan itu sendiri, jadi
//     sinkron berhenti dan gagal dengan galat percobaan terakhir.
//   - Konteks yang dibatalkan memutus jeda seketika. Galat yang dikembalikan tetap
//     galat percobaan terakhir; fail yang menerangkannya sebagai henti atau
//     batas waktu.
//   - Tiap percobaan memanggil source.Invoices lagi. Scraper membuang sesinya
//     sendiri bila pembacaan gagal (lihat Scraper.Invoices), jadi tiap ulangan
//     mulai dengan login dan cookiejar baru.
func (s *Syncer) readInvoices(ctx context.Context, runID string, started time.Time, out *RunOutcome) ([]Invoice, error) {
	deadline := started.Add(s.timeout)
	for attempt := 1; ; attempt++ {
		list, stats, err := s.source.Invoices(ctx)
		out.Stats, out.Attempts = stats, attempt
		if err == nil {
			if len(list) == 0 {
				return nil, ErrEmptyInvoiceSource
			}
			return list, nil
		}

		failure := Classify(err)
		s.log.Warn("percobaan membaca tagihan billing gagal", append([]any{
			"run_id", runID, "percobaan", attempt, "dari", s.maxAttempts,
			"jenis", string(failure.Kind), "sementara", failure.Transient},
			errorAttrs(stageInvoices, attempt, err)...)...)
		if !failure.Transient || attempt >= s.maxAttempts || ctx.Err() != nil {
			return nil, err
		}

		delay := s.retryDelay(attempt)
		if remaining := deadline.Sub(s.now()); remaining <= delay {
			s.log.Warn("sisa waktu sinkron billing tidak cukup untuk mengulang; berhenti",
				"run_id", runID, "percobaan", attempt, "sisa", remaining.String(), "jeda", delay.String())
			return nil, err
		}
		s.log.Info("membaca tagihan billing diulang", "run_id", runID,
			"percobaan_berikutnya", attempt+1, "jeda", delay.String())
		select {
		case <-ctx.Done():
			return nil, err
		case <-s.after(delay):
		}
	}
}

// retryDelay memberi jeda sebelum percobaan ke-(attempt+1).
func (s *Syncer) retryDelay(attempt int) time.Duration {
	return s.retryDelays[min(attempt, len(s.retryDelays))-1]
}

// checkNoDrasticDrop menolak hasil baca yang jauh lebih sedikit daripada sinkron
// berhasil terakhir (lihat DropGuard untuk alasannya). Tanpa pembanding (sinkron
// berhasil pertama) tidak ada yang dijaga. Bila pembanding tidak bisa dibaca, sinkron
// gagal: tanpa pembanding, aman tidaknya hasil tidak diketahui. Penjaga yang dimatikan
// (Percent 0) tidak membaca pembanding sama sekali.
func (s *Syncer) checkNoDrasticDrop(ctx context.Context, got int) error {
	if !s.drop.Enabled() {
		return nil
	}
	last, ok, err := s.store.LastSuccess(ctx)
	if err != nil {
		return err
	}
	if ok && drasticDrop(last.Invoices, got, s.drop.MinInvoices, s.drop.Percent) {
		return &InvoiceDropError{Previous: last.Invoices, Current: got}
	}
	return nil
}

// prune membuang sinkron lama. Kegagalannya hanya dicatat.
func (s *Syncer) prune(parent context.Context, runID string) int {
	ctx, cancel := context.WithTimeout(parent, pruneTimeout)
	defer cancel()
	var pruned int
	err := guard(func() (e error) {
		pruned, e = s.store.PruneRuns(ctx, s.keep)
		return e
	})
	if err != nil {
		s.log.Warn("gagal memangkas riwayat sinkron billing; sinkron ini tetap berhasil",
			"run_id", runID, "error", err.Error())
		return 0
	}
	if pruned > 0 {
		s.log.Info("riwayat sinkron billing dipangkas", "run_id", runID, "dibuang", pruned, "dipertahankan", s.keep)
	} else {
		s.log.Debug("riwayat sinkron billing tidak perlu dipangkas", "run_id", runID, "dipertahankan", s.keep)
	}
	return pruned
}

// fail menutup sinkron sebagai gagal: memilih pesan yang tepat, menulisnya ke
// log sinkron, mencatatnya, dan menyusun hasil.
func (s *Syncer) fail(parent, ctx context.Context, out RunOutcome, stage string, err error) (RunOutcome, error) {
	cause := explainFailure(parent, ctx, err)
	failure := Classify(cause)
	out.Status, out.Err, out.Failure = RunFailed, cause, failure

	var recordErr error
	if out.RunID != "" {
		// Konteks terpisah dari sinkron: bila sinkron gagal karena dibatalkan atau
		// kehabisan waktu, konteksnya sudah mati dan penulisan dengannya pasti gagal.
		writeCtx, cancel := context.WithTimeout(context.WithoutCancel(parent), failureWriteTimeout)
		defer cancel()
		// Yang disimpan (dan tampil di dashboard) adalah pesan hasil Classify, bukan
		// teks mentah galat. Teks mentah tetap ada di log server di bawah.
		record := &recordedFailure{failure: failure, cause: cause}
		recordErr = guard(func() error { return s.store.FailRun(writeCtx, out.RunID, record, s.now().UTC()) })
	}
	out.FinishedAt = s.now().UTC()

	attrs := []any{
		"run_id", out.RunID, "trigger", string(out.Trigger), "tahap", stage,
		"jenis", string(failure.Kind), "percobaan", out.Attempts,
		"durasi", out.Duration().String(),
	}
	attrs = append(attrs, errorAttrs(stage, out.Attempts, cause)...)
	var pe *PanicError
	if errors.As(cause, &pe) {
		attrs = append(attrs, "panic", pe.Detail, "stack", string(pe.Stack))
	}
	s.log.Error("sinkron billing gagal", attrs...)

	switch {
	case recordErr == nil:
	case errors.Is(recordErr, ErrRunNotRunning):
		// Baris log sudah ditutup oleh langkah sebelumnya (mis. penerapan sudah
		// ter-commit sebelum galatnya muncul); tidak ada yang perlu ditulis lagi.
		s.log.Warn("log sinkron billing sudah ditutup; catatan gagal tidak ditulis", "run_id", out.RunID)
	default:
		s.log.Error("gagal menulis catatan sinkron billing yang gagal; baris berstatus running akan dipulihkan saat backend dimulai ulang",
			"run_id", out.RunID, "error", recordErr.Error())
		out.Err = errors.Join(cause, fmt.Errorf("billing: catat sinkron gagal: %w", recordErr))
		return out, out.Err
	}
	return out, cause
}

// extractErrorMeta mengambil atribut terstruktur galat tanpa membaca teksnya:
// path dan kode HTTP dari *StatusError (kosong/0 bila bukan), serta kategori
// (Network, Auth, Parsing, DropAnomaly, Internal). Path tidak memuat query.
func extractErrorMeta(err error) (path string, code int, category string) {
	var se *StatusError
	if errors.As(err, &se) {
		path, code = se.Path, se.Code
	}
	return path, code, Classify(err).Category()
}

// errorAttrs menyusun atribut log galat: stage, attempt, category, error_type,
// path (bila ada), code (bila ada), dan error yang sudah dibersihkan dari rahasia.
func errorAttrs(stage string, attempt int, err error) []any {
	path, code, category := extractErrorMeta(err)
	attrs := []any{
		"stage", stage, "attempt", attempt, "category", category,
		"error_type", fmt.Sprintf("%T", err),
	}
	if path != "" {
		attrs = append(attrs, "path", scrubSensitive(path))
	}
	if code != 0 {
		attrs = append(attrs, "code", code)
	}
	return append(attrs, "error", scrubSensitive(err.Error()))
}

// explainFailure mengganti galat yang sebenarnya akibat penghentian dengan pesan
// yang dimengerti operator. Panic tidak diganti: itu galat pemrograman yang harus
// tampak apa adanya.
func explainFailure(parent, ctx context.Context, err error) error {
	var pe *PanicError
	if errors.As(err, &pe) {
		return err
	}
	switch {
	case parent.Err() != nil:
		return &reasonError{reason: ErrSyncCanceled, cause: err}
	case ctx.Err() != nil:
		// Konteks induk hidup tetapi konteks sinkron mati: batas waktu sinkron.
		return &reasonError{reason: ErrSyncTimeout, cause: err}
	}
	return err
}
