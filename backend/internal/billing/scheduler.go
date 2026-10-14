package billing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// DefaultCatchUpDelay adalah jeda sebelum sinkron susulan saat backend baru hidup,
// supaya server HTTP, pool database, dan pekerja lain sempat siap lebih dulu.
const DefaultCatchUpDelay = 10 * time.Second

const (
	// CredentialFailureLimit adalah jumlah sinkron berturut-turut yang gagal karena
	// login ditolak (FailureCredentials) sebelum penjadwal berhenti mencoba tiap
	// jam. Kredensial yang salah tidak akan membaik sendiri, sedangkan percobaan
	// login yang ditolak terus-menerus bisa mengunci akun billing.
	CredentialFailureLimit = 3
	// CredentialBackoff adalah jarak antar percobaan sesudah batas itu tercapai,
	// sampai ada yang berhasil. Dihitung dalam slot (jam penuh), bukan detik, supaya
	// selisih beberapa milidetik antara pewaktu dan jam dinding tidak membuat satu
	// slot terlewat lagi.
	CredentialBackoff = 6 * time.Hour
)

// Clock adalah jam dan pewaktu yang dipakai Scheduler. Tes menggantinya dengan jam
// palsu yang digerakkan tangan, jadi tidak ada tes yang menunggu waktu sungguhan.
type Clock interface {
	Now() time.Time
	// After mengirim waktu ke kanal yang dikembalikan setelah d berlalu.
	After(d time.Duration) <-chan time.Time
}

type systemClock struct{}

func (systemClock) Now() time.Time                         { return time.Now() }
func (systemClock) After(d time.Duration) <-chan time.Time { return time.After(d) }

// Runner menjalankan satu sinkron. *Syncer memenuhinya.
type Runner interface {
	RunOnce(ctx context.Context, trigger Trigger) (RunOutcome, error)
}

// ScheduleStore adalah bagian Store yang dipakai penjadwal. *Store memenuhinya.
type ScheduleStore interface {
	// RecoverStaleRuns menutup sinkron yang tertinggal berstatus running.
	RecoverStaleRuns(ctx context.Context, now time.Time) (int, error)
	// LastSuccessAt memberi waktu selesai sinkron success terbaru; bool kedua
	// salah bila belum pernah ada.
	LastSuccessAt(ctx context.Context) (time.Time, bool, error)
	// RecentFinishedRuns memberi paling banyak limit sinkron selesai, terbaru dulu.
	RecentFinishedRuns(ctx context.Context, limit int) ([]FinishedRun, error)
}

var _ Runner = (*Syncer)(nil)

// SchedulerOptions mengatur Scheduler.
type SchedulerOptions struct {
	// Syncer dan Store wajib ada.
	Syncer Runner
	Store  ScheduleStore
	// Minute adalah menit dalam jam UTC tempat sinkron dimulai (0-59). Nol berarti
	// menit 0, bukan bawaan: bawaan (DefaultSyncMinute) diberikan oleh
	// SyncMinuteFromEnv.
	Minute int
	// Clock bawaannya jam sistem.
	Clock Clock
	// Logger bawaannya tidak mencatat apa pun.
	Logger *slog.Logger
	// CatchUpDelay adalah jeda sebelum sinkron susulan saat mulai; nol berarti
	// DefaultCatchUpDelay.
	CatchUpDelay time.Duration
}

// Scheduler menjalankan sinkron billing sekali tiap jam, pada menit yang sama
// (lihat NextRun). Tidak pernah menjalankan dua sinkron sekaligus: ia memanggil
// Syncer di goroutine Run sendiri dan menunggu hasilnya.
//
// Perlindungan akun: sesudah CredentialFailureLimit sinkron berturut-turut yang
// gagal karena login ditolak, slot jam-jaman dilewati dan sinkron hanya dicoba
// sekali tiap CredentialBackoff, sampai ada yang berhasil. Slot yang dilewati
// dicatat sekali di log dan TIDAK menulis baris di log sinkron. Hitungannya
// disimpan di memori dan dihitung ulang dari log sinkron saat Run mulai, supaya
// mulai ulang backend tidak menghapus perlindungan ini.
type Scheduler struct {
	syncer    Runner
	store     ScheduleStore
	minute    int
	clock     Clock
	log       *slog.Logger
	catchUp   time.Duration
	recovered bool

	// restored benar sesudah hitungan di bawah dibaca dari log sinkron satu kali.
	restored bool
	// credFailures adalah jumlah sinkron terakhir yang berturut-turut gagal karena
	// login ditolak; credLast adalah kapan percobaan terakhir itu dimulai.
	credFailures int
	credLast     time.Time
}

// NewScheduler memeriksa opts dan menyusun Scheduler. Menit di luar 0-59 ditolak.
func NewScheduler(opts SchedulerOptions) (*Scheduler, error) {
	if opts.Syncer == nil || opts.Store == nil {
		return nil, errors.New("billing: Scheduler butuh Syncer dan Store")
	}
	if !ValidSyncMinute(opts.Minute) {
		return nil, fmt.Errorf("%w: menit sinkron %d di luar %d-%d",
			ErrInvalidConfig, opts.Minute, MinSyncMinute, MaxSyncMinute)
	}
	if opts.CatchUpDelay < 0 {
		return nil, errors.New("billing: jeda sinkron susulan tidak boleh negatif")
	}
	s := &Scheduler{
		syncer: opts.Syncer, store: opts.Store, minute: opts.Minute,
		clock: opts.Clock, log: opts.Logger, catchUp: opts.CatchUpDelay,
	}
	if s.clock == nil {
		s.clock = systemClock{}
	}
	if s.log == nil {
		s.log = slog.New(slog.DiscardHandler)
	}
	if s.catchUp == 0 {
		s.catchUp = DefaultCatchUpDelay
	}
	return s, nil
}

// NextRunAt memberi saat sinkron terjadwal berikutnya sesudah now (UTC). Dipakai
// endpoint status sinkron untuk nextRunAt.
func (s *Scheduler) NextRunAt(now time.Time) time.Time { return NextRun(now, s.minute) }

// Run menjalankan penjadwal sampai ctx dibatalkan, lalu mengembalikan ctx.Err().
// Blokir. Panggil sekali per Scheduler.
//
// Urutannya:
//
//  1. RecoverStaleRuns sekali: sinkron yang tertinggal berstatus running oleh
//     proses yang mati akan menghalangi BeginRun selamanya. Bila pemulihan gagal
//     (mis. database belum siap), ia dicoba lagi sebelum sinkron berikutnya.
//     Sesudahnya kegagalan login beruntun dihitung ulang dari log sinkron
//     (restoreCredentialGuard), supaya mulai ulang tidak membuka lagi percobaan
//     tiap jam. Bila membaca log gagal, dicoba lagi sebelum sinkron berikutnya.
//  2. Sinkron susulan: bila belum pernah ada sinkron yang berhasil, atau yang
//     terakhir lebih tua dari satu interval, satu sinkron dijalankan sesudah
//     CatchUpDelay alih-alih menunggu slot, kecuali slot berikutnya datang lebih
//     dulu (maka slot itulah yang menyusul). Galat saat membacanya tidak menahan
//     penjadwal; ia menunggu slot seperti biasa.
//     Sinkron susulan pun tunduk pada perlindungan login di bawah.
//  3. Loop: tunggu slot berikutnya, jalankan satu sinkron, ulangi. Bila sinkron
//     melewati satu slot atau lebih, slot yang terlewat dilewati, bukan dikejar:
//     sesudah selesai penjadwal langsung menunggu slot berikutnya yang belum lewat.
//
// Sinkron yang sedang berjalan saat ctx dibatalkan ikut dibatalkan oleh Syncer
// (dan ditandai failed); Run baru kembali sesudah Syncer kembali, jadi tidak ada
// goroutine yang tertinggal.
func (s *Scheduler) Run(ctx context.Context) error {
	now := s.clock.Now()
	s.log.Info("penjadwal sinkron billing dimulai",
		"menit", s.minute, "sinkron_berikutnya", s.NextRunAt(now).Format(time.RFC3339))

	s.recoverStale(ctx)
	if err := ctx.Err(); err != nil {
		return err
	}
	s.restoreCredentialGuard(ctx)
	if err := ctx.Err(); err != nil {
		return err
	}

	if catchUp, why := s.needsCatchUp(ctx, now); catchUp {
		if s.NextRunAt(now).Sub(now) > s.catchUp {
			s.log.Info("sinkron susulan dijadwalkan", "alasan", why, "jeda", s.catchUp.String())
			if !s.sleep(ctx, s.catchUp) {
				return ctx.Err()
			}
			s.sync(ctx)
		} else {
			s.log.Info("slot sinkron berikutnya datang lebih dulu; dipakai sebagai sinkron susulan", "alasan", why)
		}
	}

	for {
		slot := NextRun(s.clock.Now(), s.minute)
		if !s.waitUntil(ctx, slot) {
			return ctx.Err()
		}
		s.sync(ctx)
		if err := ctx.Err(); err != nil {
			return err
		}
		if missed := s.missedSlots(slot); missed > 0 {
			s.log.Warn("sinkron melewati slot berikutnya; slot yang terlewat dilewati",
				"dilewati", missed, "sinkron_berikutnya", s.NextRunAt(s.clock.Now()).Format(time.RFC3339))
		}
	}
}

// recoverStale memanggil RecoverStaleRuns sampai berhasil satu kali.
func (s *Scheduler) recoverStale(ctx context.Context) {
	if s.recovered {
		return
	}
	n, err := s.store.RecoverStaleRuns(ctx, s.clock.Now())
	if err != nil {
		if ctx.Err() == nil {
			s.log.Warn("gagal memulihkan sinkron billing yang terputus; dicoba lagi sebelum sinkron berikutnya",
				"error", err.Error())
		}
		return
	}
	s.recovered = true
	if n > 0 {
		s.log.Warn("sinkron billing yang terputus ditandai gagal", "jumlah", n)
	}
}

// needsCatchUp memutuskan apakah backend yang baru hidup harus segera menyinkron.
func (s *Scheduler) needsCatchUp(ctx context.Context, now time.Time) (bool, string) {
	last, ok, err := s.store.LastSuccessAt(ctx)
	switch {
	case err != nil:
		if ctx.Err() == nil {
			s.log.Warn("gagal membaca sinkron billing terakhir; menunggu slot berikutnya tanpa sinkron susulan",
				"error", err.Error())
		}
		return false, ""
	case !ok:
		return true, "belum pernah ada sinkron yang berhasil"
	case now.Sub(last) > SyncInterval:
		return true, "sinkron berhasil terakhir lebih tua dari satu interval"
	}
	return false, ""
}

// sync menjalankan satu sinkron dan menjaga penjadwal tetap hidup bila Runner
// panik. Hasilnya dicatat oleh Syncer sendiri; di sini hanya dipakai untuk
// menghitung kegagalan login beruntun.
func (s *Scheduler) sync(ctx context.Context) {
	s.recoverStale(ctx)
	s.restoreCredentialGuard(ctx)

	now := s.clock.Now()
	if blocked, next := s.credentialGuard(now); blocked {
		// Tidak ada baris di log sinkron: tidak ada sinkron yang berjalan, dan
		// dashboard tidak boleh mengira ada percobaan baru yang gagal.
		s.log.Warn("sinkron billing dilewati: login ditolak berulang kali, akun billing dilindungi dari percobaan login beruntun",
			"gagal_berturut", s.credFailures, "percobaan_berikutnya", next.Format(time.RFC3339),
			"tindakan", "perbaiki BILLING_USERNAME dan BILLING_PASSWORD lalu mulai ulang backend untuk mencoba sekarang")
		return
	}

	var out RunOutcome
	err := guard(func() error {
		var runErr error
		out, runErr = s.syncer.RunOnce(ctx, TriggerSchedule)
		return runErr
	})
	var pe *PanicError
	if errors.As(err, &pe) {
		s.log.Error("sinkron billing panik; penjadwal tetap berjalan", "panic", pe.Detail, "stack", string(pe.Stack))
	}
	s.countCredentialFailure(now, out, err)
}

// TriggerManual menjalankan satu sinkron sekarang atas permintaan petugas. Aman
// dipanggil dari goroutine lain: tidak menyentuh keadaan penjadwal (hitungan
// login beruntun dan jadwal jam-jaman tetap milik Run), dan Syncer sendiri yang
// menjamin hanya satu sinkron berjalan (indeks unik di BeginRun).
//
// Sudah ada sinkron berjalan, dari penjadwal atau petugas lain: ErrRunInProgress
// dan tidak ada baris log. Syncer melaporkannya sebagai RunSkipped tanpa galat;
// di sini diubah jadi galat supaya pemanggil tidak mengira sinkron baru selesai.
// Gagal sungguhan: galat penyebab dikembalikan bersama RunOutcome-nya.
func (s *Scheduler) TriggerManual(ctx context.Context) (RunOutcome, error) {
	var out RunOutcome
	err := guard(func() error {
		var runErr error
		out, runErr = s.syncer.RunOnce(ctx, TriggerManual)
		return runErr
	})
	var pe *PanicError
	if errors.As(err, &pe) {
		s.log.Error("sinkron billing manual panik", "panic", pe.Detail, "stack", string(pe.Stack))
	}
	if err == nil && out.Status == RunSkipped {
		return out, ErrRunInProgress
	}
	return out, err
}

// countCredentialFailure memperbarui hitungan login beruntun sesudah satu percobaan
// yang dimulai pada `at`:
//
//   - berhasil: hitungan kembali nol;
//   - gagal karena login ditolak: hitungan naik dan percobaan ini dicatat;
//   - gagal karena sebab lain: hitungan kembali nol (login ternyata tidak ditolak);
//   - dilewati, atau gagal sebelum ada baris log (BeginRun gagal, mis. database
//     mati): hitungan tidak berubah, karena billing tidak pernah dihubungi dan
//     log sinkron, sumber hitungan sesudah mulai ulang, tidak mencatat apa-apa.
func (s *Scheduler) countCredentialFailure(at time.Time, out RunOutcome, err error) {
	switch {
	case err == nil && out.Status == RunSkipped:
		return
	case err == nil:
		s.credFailures = 0
		return
	case out.RunID == "":
		return
	case Classify(err).Kind != FailureCredentials:
		s.credFailures = 0
		return
	}
	s.credFailures++
	s.credLast = at
	if s.credFailures == CredentialFailureLimit {
		s.log.Error("login ke sistem billing ditolak berturut-turut; sinkron berikutnya hanya dicoba sekali per "+CredentialBackoff.String()+" sampai berhasil",
			"gagal_berturut", s.credFailures)
	}
}

// credentialGuard memutuskan apakah slot pada `now` harus dilewati, dan kapan
// percobaan berikutnya diizinkan. Perbandingannya per slot: percobaan terakhir pada
// slot S mengizinkan percobaan lagi mulai slot S+CredentialBackoff.
func (s *Scheduler) credentialGuard(now time.Time) (blocked bool, next time.Time) {
	if s.credFailures < CredentialFailureLimit {
		return false, time.Time{}
	}
	next = PreviousRun(s.credLast, s.minute).Add(CredentialBackoff)
	return PreviousRun(now, s.minute).Before(next), next
}

// restoreCredentialGuard menghitung ulang kegagalan login beruntun dari log sinkron
// (satu kali; bila membacanya gagal, dicoba lagi sebelum sinkron berikutnya). Yang
// dibaca hanya CredentialFailureLimit sinkron selesai terakhir: kalau semuanya gagal
// karena login ditolak, perlindungan aktif; kalau ada yang berhasil atau gagal karena
// sebab lain, hitungannya berhenti di situ, sama seperti hitungan di memori.
// Kegagalan login dikenali dari pesannya (isCredentialsMessage), satu-satunya
// jejak jenis kegagalan yang tersimpan.
func (s *Scheduler) restoreCredentialGuard(ctx context.Context) {
	if s.restored {
		return
	}
	runs, err := s.store.RecentFinishedRuns(ctx, CredentialFailureLimit)
	if err != nil {
		if ctx.Err() == nil {
			s.log.Warn("gagal membaca log sinkron billing untuk perlindungan login; dicoba lagi sebelum sinkron berikutnya",
				"error", err.Error())
		}
		return
	}
	s.restored = true
	s.credFailures, s.credLast = 0, time.Time{}
	for _, r := range runs {
		if r.Success || !isCredentialsMessage(r.Message) {
			break
		}
		if s.credFailures == 0 {
			s.credLast = r.StartedAt
		}
		s.credFailures++
	}
	if s.credFailures > 0 {
		s.log.Warn("kegagalan login billing beruntun dipulihkan dari log sinkron",
			"gagal_berturut", s.credFailures, "percobaan_terakhir", s.credLast.Format(time.RFC3339))
	}
}

// missedSlots menghitung slot sesudah `ran` yang sudah lewat saat sinkron selesai.
func (s *Scheduler) missedSlots(ran time.Time) int {
	last := PreviousRun(s.clock.Now(), s.minute)
	if !last.After(ran) {
		return 0
	}
	return int(last.Sub(ran) / SyncInterval)
}

// waitUntil menunggu sampai jam mencapai target. Mengembalikan false bila ctx
// dibatalkan lebih dulu. Jam diperiksa ulang sesudah pewaktu berbunyi, karena
// pewaktu berjalan menurut jam monoton sedangkan target menurut jam dinding, dan
// keduanya bisa berselisih (jam disetel ulang, komputer tidur).
func (s *Scheduler) waitUntil(ctx context.Context, target time.Time) bool {
	for {
		if ctx.Err() != nil {
			return false
		}
		remaining := target.Sub(s.clock.Now())
		if remaining <= 0 {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-s.clock.After(remaining):
		}
	}
}

// sleep menunggu d. Mengembalikan false bila ctx dibatalkan lebih dulu.
func (s *Scheduler) sleep(ctx context.Context, d time.Duration) bool {
	if ctx.Err() != nil {
		return false
	}
	select {
	case <-ctx.Done():
		return false
	case <-s.clock.After(d):
		return true
	}
}
