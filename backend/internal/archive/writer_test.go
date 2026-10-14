package archive

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

const (
	routerA = "11111111-1111-4111-8111-111111111111"
	routerB = "22222222-2222-4222-8222-222222222222"
)

var base = time.Unix(1_700_000_000, 0)

// fakeStore mencatat batch yang diterima dan bisa diprogram untuk gagal.
type fakeStore struct {
	mu       sync.Mutex
	batches  [][]Sample
	inserts  int
	failures int           // gagalkan sekian Insert berikutnya
	failAll  bool          // gagalkan semua Insert
	block    chan struct{} // bila ada, Insert menunggu sampai ditutup
	skip     int           // jumlah sampel per batch yang "dilewati" database
	managed  bool
	managedE error
	purges   []time.Time
	batches_ []int
	purgeN   int64
	purgeErr error
	// purgeUntilCancel membuat Purge menunggu sampai ctx dibatalkan, seperti
	// penghapusan yang sedang berjalan saat Writer dihentikan.
	purgeUntilCancel bool
	// entered diberi tanda setiap kali Insert dimasuki.
	entered chan struct{}
	applied []applyCall
}

func (f *fakeStore) Insert(ctx context.Context, samples []Sample) (int, error) {
	f.mu.Lock()
	block, entered := f.block, f.entered
	f.mu.Unlock()
	if entered != nil {
		select {
		case entered <- struct{}{}:
		default:
		}
	}
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.inserts++
	if f.failAll || f.failures > 0 {
		if f.failures > 0 {
			f.failures--
		}
		return 0, errors.New("database mati")
	}
	f.batches = append(f.batches, append([]Sample(nil), samples...))
	return max(0, len(samples)-f.skip), nil
}

func (f *fakeStore) ApplyRetention(_ context.Context, retention time.Duration, enforce bool) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.applied = append(f.applied, applyCall{retention, enforce})
	return f.managed, f.managedE
}

func (f *fakeStore) Purge(ctx context.Context, before time.Time, batch int) (int64, error) {
	f.mu.Lock()
	untilCancel := f.purgeUntilCancel
	f.mu.Unlock()
	if untilCancel {
		<-ctx.Done()
		return 0, ctx.Err()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.purges = append(f.purges, before)
	f.batches_ = append(f.batches_, batch)
	return f.purgeN, f.purgeErr
}

func (f *fakeStore) all() []Sample {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []Sample
	for _, b := range f.batches {
		out = append(out, b...)
	}
	return out
}

func (f *fakeStore) setFailAll(v bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failAll = v
}

type applyCall struct {
	retention time.Duration
	enforce   bool
}

func newWriter(store Store, tweak func(*Options)) *Writer {
	opts := Options{
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		FlushInterval: 20 * time.Millisecond,
		RetryBase:     10 * time.Millisecond,
	}
	if tweak != nil {
		tweak(&opts)
	}
	return NewWriter(store, opts)
}

func run(t *testing.T, w *Writer) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()
	var once sync.Once
	stop = func() {
		once.Do(func() {
			cancel()
			select {
			case <-done:
			case <-time.After(15 * time.Second):
				t.Error("Run tidak berhenti setelah ctx dibatalkan")
			}
		})
	}
	t.Cleanup(stop)
	return stop
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("menunggu %s: habis waktu", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestWriterStoresEnqueuedSamplesInBatches(t *testing.T) {
	store := &fakeStore{}
	w := newWriter(store, nil)
	run(t, w)

	for i := 0; i < 5; i++ {
		if !w.Enqueue(routerA, base.Add(time.Duration(i)*time.Second), float64(i), float64(i)/10) {
			t.Fatalf("Enqueue %d ditolak", i)
		}
	}
	waitFor(t, "lima sampel tersimpan", func() bool { return len(store.all()) == 5 })

	got := store.all()
	for i, s := range got {
		if s.RouterID != routerA || !s.At.Equal(base.Add(time.Duration(i)*time.Second)) || s.RxMbps != float64(i) {
			t.Errorf("sampel %d = %+v", i, s)
		}
	}
	if s := w.Stats(); s.Enqueued != 5 || s.Written != 5 || s.Dropped != 0 || s.Failures != 0 || s.LastErr != "" {
		t.Errorf("Stats = %+v", s)
	}
}

func TestEnqueueNormalizesTimeToUTCSeconds(t *testing.T) {
	store := &fakeStore{}
	w := newWriter(store, nil)
	run(t, w)

	zone := time.FixedZone("WIB", 7*3600)
	w.Enqueue(routerA, time.Date(2026, 10, 7, 17, 0, 0, 987_000_000, zone), 1, 1)
	waitFor(t, "tersimpan", func() bool { return len(store.all()) == 1 })
	at := store.all()[0].At
	if at.Location() != time.UTC || at.Nanosecond() != 0 || at.Hour() != 10 {
		t.Errorf("At = %v, want 10:00:00 UTC tanpa pecahan detik", at)
	}
}

func TestFullBatchIsStoredWithoutWaitingForTheTimer(t *testing.T) {
	store := &fakeStore{}
	w := newWriter(store, func(o *Options) {
		o.FlushInterval = time.Hour
		o.BatchSize = 3
	})
	run(t, w)
	for i := 0; i < 3; i++ {
		w.Enqueue(routerA, base.Add(time.Duration(i)*time.Second), 1, 1)
	}
	waitFor(t, "batch penuh tersimpan", func() bool { return len(store.all()) == 3 })
}

func TestDuplicateSecondsKeepTheLastValueOnly(t *testing.T) {
	store := &fakeStore{}
	w := newWriter(store, func(o *Options) { o.FlushInterval = time.Hour })
	stop := run(t, w)

	w.Enqueue(routerA, base, 1, 1)
	w.Enqueue(routerA, base, 9, 2)                           // detik yang sama: yang terakhir menang
	w.Enqueue(routerB, base, 5, 5)                           // router lain, detik yang sama: tetap ada
	w.Enqueue(routerA, base.Add(500*time.Millisecond), 7, 7) // pecahan detik dibulatkan ke detik yang sama
	stop()                                                   // memicu penyimpanan akhir

	got := store.all()
	if len(got) != 2 {
		t.Fatalf("sampel = %+v, want 2 (satu per router per detik)", got)
	}
	byRouter := map[string]Sample{}
	for _, s := range got {
		byRouter[s.RouterID] = s
	}
	if byRouter[routerA].RxMbps != 7 || byRouter[routerB].RxMbps != 5 {
		t.Errorf("hasil = %+v, want router A rx 7 (terakhir) dan router B rx 5", byRouter)
	}
}

func TestDedupeKeepsOrderOfSurvivors(t *testing.T) {
	in := []Sample{
		{RouterID: routerA, At: base, RxMbps: 1},
		{RouterID: routerB, At: base, RxMbps: 2},
		{RouterID: routerA, At: base, RxMbps: 3},
		{RouterID: routerA, At: base.Add(time.Second), RxMbps: 4},
	}
	out := dedupe(in)
	if len(out) != 3 || out[0].RxMbps != 2 || out[1].RxMbps != 3 || out[2].RxMbps != 4 {
		t.Errorf("dedupe = %+v", out)
	}
	if same := dedupe(in[1:2]); len(same) != 1 {
		t.Errorf("dedupe tanpa duplikat = %+v", same)
	}
}

func TestRejectsInvalidSamplesAtTheDoor(t *testing.T) {
	w := newWriter(&fakeStore{}, nil)
	bad := []struct {
		name   string
		router string
		rx, tx float64
	}{
		{"router bukan UUID", "r1", 1, 1},
		{"router kosong", "", 1, 1},
		{"UUID kurang satu huruf", routerA[:35], 1, 1},
		{"UUID dengan huruf bukan heksadesimal", "zzzzzzzz-1111-4111-8111-111111111111", 1, 1},
		{"rx negatif", routerA, -1, 1},
		{"tx negatif", routerA, 1, -0.1},
		{"rx NaN", routerA, nan(), 1},
		{"tx tak hingga", routerA, 1, inf()},
	}
	for _, tt := range bad {
		if w.Enqueue(tt.router, base, tt.rx, tt.tx) {
			t.Errorf("%s: seharusnya ditolak", tt.name)
		}
	}
	if !w.Enqueue(routerA, base, 0, 0) {
		t.Error("nol adalah nilai sah (tidak ada traffic)")
	}
	if !w.Enqueue("AAAAAAAA-1111-4111-8111-111111111111", base, 1, 1) {
		t.Error("UUID huruf besar adalah sah")
	}
	if s := w.Stats(); s.Dropped != uint64(len(bad)) || s.Enqueued != uint64(len(bad))+2 {
		t.Errorf("Stats = %+v", s)
	}
}

func TestEnqueueNeverBlocksEvenWhenTheQueueIsFull(t *testing.T) {
	w := newWriter(&fakeStore{}, func(o *Options) { o.QueueSize = 2 }) // Run tidak dijalankan
	started := time.Now()
	accepted := 0
	for i := 0; i < 1000; i++ {
		if w.Enqueue(routerA, base.Add(time.Duration(i)*time.Second), 1, 1) {
			accepted++
		}
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Errorf("Enqueue memakan %s; tidak boleh menunggu", elapsed)
	}
	if accepted != 2 {
		t.Errorf("diterima = %d, want 2 (sebesar antrean)", accepted)
	}
	if s := w.Stats(); s.Dropped != 998 {
		t.Errorf("Dropped = %d, want 998", s.Dropped)
	}
}

func TestSlowStoreDoesNotSlowDownEnqueue(t *testing.T) {
	store := &fakeStore{block: make(chan struct{})}
	w := newWriter(store, func(o *Options) { o.BatchSize = 10 })
	stop := run(t, w)

	started := time.Now()
	for i := 0; i < 5000; i++ {
		w.Enqueue(routerA, base.Add(time.Duration(i)*time.Second), 1, 1)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Errorf("5.000 Enqueue memakan %s saat database macet; polling akan terganggu", elapsed)
	}
	close(store.block)
	stop()
	if got := len(store.all()); got == 0 {
		t.Error("tidak ada yang tersimpan setelah database pulih")
	}
}

func TestRetriesAfterFailuresWithoutLosingOrReorderingSamples(t *testing.T) {
	store := &fakeStore{failures: 3}
	w := newWriter(store, nil)
	run(t, w)

	for i := 0; i < 6; i++ {
		w.Enqueue(routerA, base.Add(time.Duration(i)*time.Second), float64(i), 0)
	}
	waitFor(t, "kegagalan tercatat", func() bool { return w.Stats().Failures >= 1 })
	if w.Stats().LastErr == "" {
		t.Error("LastErr kosong setelah gagal")
	}
	waitFor(t, "semua tersimpan setelah database pulih", func() bool { return len(store.all()) == 6 })

	for i, s := range store.all() {
		if s.RxMbps != float64(i) {
			t.Errorf("urutan berubah pada indeks %d: %+v", i, store.all())
			break
		}
	}
	// Baris sudah terlihat di store sebelum Writer selesai membukukannya
	// (Written dan LastErr diperbarui setelah Insert kembali), jadi tunggu
	// pembukuan selesai alih-alih membaca Stats seketika.
	waitFor(t, "pembukuan selesai setelah berhasil", func() bool {
		s := w.Stats()
		return s.Written == 6 && s.LastErr == ""
	})
	stats := w.Stats()
	if stats.Failures != 3 || stats.Written != 6 || stats.Dropped != 0 || stats.LastErr != "" {
		t.Errorf("Stats = %+v, want 3 gagal, 6 tersimpan, tidak ada yang dibuang, LastErr kosong", stats)
	}
}

func TestRetryBacksOffInsteadOfHammeringADeadDatabase(t *testing.T) {
	store := &fakeStore{failAll: true}
	w := newWriter(store, func(o *Options) {
		o.FlushInterval = 5 * time.Millisecond
		o.RetryBase = 100 * time.Millisecond
	})
	run(t, w)
	w.Enqueue(routerA, base, 1, 1)

	time.Sleep(450 * time.Millisecond)
	store.mu.Lock()
	attempts := store.inserts
	store.mu.Unlock()
	// Tanpa backoff akan ada sekitar 90 percobaan (tiap 5 ms). Dengan jeda
	// 100 ms, 200 ms, 400 ms hanya 3 sampai 4.
	if attempts < 2 || attempts > 6 {
		t.Errorf("percobaan = %d dalam 450 ms, want 2 sampai 6 (ada backoff)", attempts)
	}
}

func TestRetryDelayGrowsAndIsCapped(t *testing.T) {
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 30 * time.Second, 30 * time.Second}
	for i, w := range want {
		if got := retryDelay(time.Second, i+1); got != w {
			t.Errorf("retryDelay(%d) = %s, want %s", i+1, got, w)
		}
	}
	if got := retryDelay(time.Second, 100_000); got != maxRetryDelay {
		t.Errorf("kegagalan sangat banyak = %s, want %s", got, maxRetryDelay)
	}
}

func TestPendingBufferIsBoundedAndKeepsTheNewestSamples(t *testing.T) {
	store := &fakeStore{failAll: true}
	w := newWriter(store, func(o *Options) {
		o.MaxPending = 5
		o.RetryBase = time.Hour // tidak mencoba lagi selama test, penampung hanya menumpuk
	})
	stop := run(t, w)
	for i := 0; i < 20; i++ {
		w.Enqueue(routerA, base.Add(time.Duration(i)*time.Second), float64(i), 0)
	}
	waitFor(t, "sampel dibuang oleh batas", func() bool { return w.Stats().Dropped >= 15 })

	store.setFailAll(false)
	stop() // penyimpanan akhir sesudah database pulih

	got := store.all()
	if len(got) != 5 {
		t.Fatalf("tersimpan = %d, want 5 (sebesar batas)", len(got))
	}
	if got[0].RxMbps != 15 || got[4].RxMbps != 19 {
		t.Errorf("yang disimpan = %+v, want sampel terbaru 15 sampai 19", got)
	}
	if s := w.Stats(); s.Dropped != 15 {
		t.Errorf("Dropped = %d, want 15", s.Dropped)
	}
}

func TestShutdownStoresWhatIsStillWaiting(t *testing.T) {
	store := &fakeStore{}
	w := newWriter(store, func(o *Options) { o.FlushInterval = time.Hour })
	stop := run(t, w)
	for i := 0; i < 10; i++ {
		w.Enqueue(routerA, base.Add(time.Duration(i)*time.Second), 1, 1)
	}
	stop()
	if got := len(store.all()); got != 10 {
		t.Errorf("tersimpan saat berhenti = %d, want 10", got)
	}
}

func TestShutdownDoesNotHangWhenTheDatabaseIsDown(t *testing.T) {
	store := &fakeStore{failAll: true}
	w := newWriter(store, func(o *Options) { o.FlushInterval = time.Hour })
	stop := run(t, w)
	w.Enqueue(routerA, base, 1, 1)

	started := time.Now()
	stop()
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Errorf("berhenti memakan %s saat database mati", elapsed)
	}
}

func TestRowsSkippedByTheDatabaseAreCounted(t *testing.T) {
	store := &fakeStore{skip: 1} // mis. satu router belum ada di tabel routers
	w := newWriter(store, func(o *Options) { o.FlushInterval = time.Hour })
	stop := run(t, w)
	w.Enqueue(routerA, base, 1, 1)
	w.Enqueue(routerB, base, 1, 1)
	w.Enqueue(routerA, base.Add(time.Second), 1, 1)
	stop()
	if s := w.Stats(); s.Written != 2 || s.Skipped != 1 {
		t.Errorf("Stats = %+v, want 2 tersimpan dan 1 dilewati", s)
	}
}

func TestPurgesOldSamplesOnlyWhenTheDatabaseDoesNotManageRetention(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)

	plain := &fakeStore{purgeN: 7}
	w := newWriter(plain, func(o *Options) {
		o.Now = func() time.Time { return now }
		o.Retention = 48 * time.Hour
		o.PurgeEvery = 20 * time.Millisecond
	})
	run(t, w)
	waitFor(t, "pembersihan dijalankan", func() bool {
		plain.mu.Lock()
		defer plain.mu.Unlock()
		return len(plain.purges) >= 2 // saat mulai, lalu berkala
	})
	plain.mu.Lock()
	if cutoff := plain.purges[0]; !cutoff.Equal(now.Add(-48 * time.Hour)) {
		t.Errorf("batas hapus = %v, want sekarang dikurangi 48 jam", cutoff)
	}
	plain.mu.Unlock()

	managed := &fakeStore{managed: true}
	w2 := newWriter(managed, func(o *Options) { o.PurgeEvery = 20 * time.Millisecond })
	run(t, w2)
	time.Sleep(120 * time.Millisecond)
	managed.mu.Lock()
	defer managed.mu.Unlock()
	if len(managed.purges) != 0 {
		t.Errorf("Purge dipanggil %d kali padahal retensi diurus database", len(managed.purges))
	}
}

func TestPurgeAndRetentionCheckFailuresDoNotStopTheWriter(t *testing.T) {
	store := &fakeStore{managedE: errors.New("tidak bisa memeriksa")}
	w := newWriter(store, func(o *Options) { o.PurgeEvery = 10 * time.Millisecond })
	run(t, w)
	time.Sleep(60 * time.Millisecond)
	w.Enqueue(routerA, base, 1, 1)
	waitFor(t, "tetap menyimpan sampel", func() bool { return len(store.all()) == 1 })

	failing := &fakeStore{purgeErr: errors.New("hapus gagal")}
	w2 := newWriter(failing, func(o *Options) { o.PurgeEvery = 10 * time.Millisecond })
	run(t, w2)
	time.Sleep(60 * time.Millisecond)
	w2.Enqueue(routerA, base, 1, 1)
	waitFor(t, "tetap menyimpan sampel (hapus gagal)", func() bool { return len(failing.all()) == 1 })
}

// ---- Recorder ----

type fakeNext struct {
	accepted bool
	err      error
	calls    int
}

func (f *fakeNext) RecordTraffic(string, state.TrafficPoint) (bool, error) {
	f.calls++
	return f.accepted, f.err
}

func TestRecorderArchivesOnlyWhatTheRealtimePathAccepted(t *testing.T) {
	w := newWriter(&fakeStore{}, nil)
	point := state.TrafficPoint{Time: base.Unix(), RxMbps: 12, TxMbps: 3}

	next := &fakeNext{accepted: true}
	if ok, err := (Recorder{Next: next, Writer: w}).RecordTraffic(routerA, point); !ok || err != nil {
		t.Fatalf("RecordTraffic = %v, %v", ok, err)
	}
	if next.calls != 1 || w.Stats().Enqueued != 1 {
		t.Errorf("diterima: calls=%d enqueued=%d, want 1 dan 1", next.calls, w.Stats().Enqueued)
	}

	rejected := &fakeNext{accepted: false}
	(Recorder{Next: rejected, Writer: w}).RecordTraffic(routerA, point)
	failing := &fakeNext{accepted: true, err: errors.New("router tidak dikenal")}
	if _, err := (Recorder{Next: failing, Writer: w}).RecordTraffic(routerA, point); err == nil {
		t.Error("error dari jalur real-time harus diteruskan")
	}
	if w.Stats().Enqueued != 1 {
		t.Errorf("Enqueued = %d; sampel yang ditolak atau gagal tidak boleh diarsipkan", w.Stats().Enqueued)
	}

	// Tanpa Writer, jalur real-time tetap berjalan.
	if ok, _ := (Recorder{Next: &fakeNext{accepted: true}}).RecordTraffic(routerA, point); !ok {
		t.Error("Recorder tanpa Writer harus tetap meneruskan ke Next")
	}
}

func TestRecorderWorksWithTheRealStateManager(t *testing.T) {
	store := &fakeStore{}
	w := newWriter(store, func(o *Options) { o.FlushInterval = time.Hour })
	stop := run(t, w)

	mgr := state.NewManager()
	_ = mgr.UpsertRouter(state.Router{ID: routerA, Active: true})
	rec := Recorder{Next: mgr, Writer: w}
	for i := 0; i < 3; i++ {
		if ok, err := rec.RecordTraffic(routerA, state.TrafficPoint{Time: base.Unix() + int64(i), RxMbps: float64(i + 1)}); !ok || err != nil {
			t.Fatalf("RecordTraffic %d = %v, %v", i, ok, err)
		}
	}
	// Sampel yang lebih tua dari yang terakhir ditolak Manager, jadi tidak diarsipkan.
	if ok, _ := rec.RecordTraffic(routerA, state.TrafficPoint{Time: base.Unix() - 10, RxMbps: 99}); ok {
		t.Fatal("sampel lama seharusnya ditolak Manager")
	}
	stop()

	if len(mgr.TrafficSeries()) != 3 || len(store.all()) != 3 {
		t.Errorf("state=%d arsip=%d, want 3 dan 3", len(mgr.TrafficSeries()), len(store.all()))
	}
}

func TestValidRouterID(t *testing.T) {
	good := []string{routerA, "ABCDEF01-2345-6789-abcd-ef0123456789", "00000000-0000-0000-0000-000000000000"}
	for _, id := range good {
		if !validRouterID(id) {
			t.Errorf("%q seharusnya valid", id)
		}
	}
	for _, id := range []string{"", "r1", routerA + "0", "11111111111141118111111111111111", "1111111-11111-4111-8111-111111111111", "11111111-1111-4111-8111-11111111111g"} {
		if validRouterID(id) {
			t.Errorf("%q seharusnya tidak valid", id)
		}
	}
}

func nan() float64 { return math.NaN() }
func inf() float64 { return math.Inf(1) }

func TestRetentionIsOnlyEnforcedWhenAskedExplicitly(t *testing.T) {
	implicit := &fakeStore{managed: true}
	w := newWriter(implicit, func(o *Options) { o.PurgeEvery = time.Hour })
	run(t, w)
	waitFor(t, "ApplyRetention dipanggil saat mulai", func() bool {
		implicit.mu.Lock()
		defer implicit.mu.Unlock()
		return len(implicit.applied) >= 1
	})
	implicit.mu.Lock()
	if call := implicit.applied[0]; call.enforce || call.retention != 30*24*time.Hour {
		t.Errorf("tanpa Retention: %+v, want enforce=false dan 30 hari (kebijakan DBA tidak ditimpa)", call)
	}
	implicit.mu.Unlock()

	explicit := &fakeStore{managed: true}
	w2 := newWriter(explicit, func(o *Options) {
		o.Retention = 7 * 24 * time.Hour
		o.PurgeEvery = time.Hour
	})
	run(t, w2)
	waitFor(t, "ApplyRetention eksplisit dipanggil", func() bool {
		explicit.mu.Lock()
		defer explicit.mu.Unlock()
		return len(explicit.applied) >= 1
	})
	explicit.mu.Lock()
	defer explicit.mu.Unlock()
	if call := explicit.applied[0]; !call.enforce || call.retention != 7*24*time.Hour {
		t.Errorf("dengan Retention: %+v, want enforce=true dan 7 hari", call)
	}
}

func TestRetentionBelowTheMinimumIsRaised(t *testing.T) {
	store := &fakeStore{}
	w := newWriter(store, func(o *Options) {
		o.Retention = time.Second // salah ketik yang akan menghapus hampir semuanya
		o.PurgeEvery = time.Hour
	})
	if w.opts.Retention != MinRetention {
		t.Errorf("Retention = %s, want dinaikkan ke %s", w.opts.Retention, MinRetention)
	}
	run(t, w)
	waitFor(t, "pembersihan pertama", func() bool {
		store.mu.Lock()
		defer store.mu.Unlock()
		return len(store.purges) >= 1
	})
	store.mu.Lock()
	defer store.mu.Unlock()
	cutoff := store.purges[0]
	if age := time.Since(cutoff); age < MinRetention-time.Minute {
		t.Errorf("batas hapus berumur %s, want setidaknya %s: data yang masih dipakai ikut terhapus", age, MinRetention)
	}
}

func TestPurgeUsesTheConfiguredBatchSizeAndReportsProgress(t *testing.T) {
	store := &fakeStore{purgeN: 1234}
	w := newWriter(store, func(o *Options) {
		o.PurgeBatch = 777
		o.PurgeEvery = time.Hour
	})
	run(t, w)
	// Purged dan LastPurge diperbarui berurutan setelah Purge kembali, jadi tunggu
	// keduanya sebelum memeriksa.
	waitFor(t, "pembersihan tercatat", func() bool {
		s := w.Stats()
		return s.Purged == 1234 && !s.LastPurge.IsZero()
	})

	store.mu.Lock()
	if store.batches_[0] != 777 {
		t.Errorf("batch = %d, want 777", store.batches_[0])
	}
	store.mu.Unlock()
	if s := w.Stats(); s.Purged != 1234 || s.LastPurge.IsZero() {
		t.Errorf("Stats = %+v, want Purged 1234 dan LastPurge terisi", s)
	}
}

func TestPurgeThatFailsHalfwayStillCountsWhatWasDeleted(t *testing.T) {
	store := &fakeStore{purgeN: 500, purgeErr: errors.New("koneksi putus")}
	w := newWriter(store, func(o *Options) { o.PurgeEvery = time.Hour })
	run(t, w)
	waitFor(t, "baris terhapus tercatat", func() bool { return w.Stats().Purged == 500 })
	if !w.Stats().LastPurge.IsZero() {
		t.Error("LastPurge terisi padahal pembersihan gagal")
	}
}

func TestManagedRetentionMarksTheRunWithoutDeletingAnything(t *testing.T) {
	store := &fakeStore{managed: true}
	w := newWriter(store, func(o *Options) { o.PurgeEvery = time.Hour })
	run(t, w)
	waitFor(t, "penegakan retensi selesai", func() bool { return !w.Stats().LastPurge.IsZero() })
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.purges) != 0 {
		t.Errorf("Purge dipanggil %d kali padahal database mengurus retensi", len(store.purges))
	}
}

// Berhenti saat Insert sedang berjalan memutus Insert itu dengan "context
// canceled". Itu bukan kegagalan database: sampelnya disimpan oleh penyimpanan
// akhir, jadi tidak boleh dihitung sebagai kegagalan atau dicatat sebagai gagal.
func TestShutdownInterruptingAnInsertIsNotCountedAsAFailure(t *testing.T) {
	store := &fakeStore{block: make(chan struct{}), entered: make(chan struct{}, 1)}
	logs := &bytes.Buffer{}
	w := newWriter(store, func(o *Options) {
		o.Logger = slog.New(slog.NewTextHandler(logs, nil))
		o.FlushInterval = 10 * time.Millisecond
	})
	stop := run(t, w)
	w.Enqueue(routerA, base, 1, 1)
	select {
	case <-store.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("Insert tidak pernah dimasuki")
	}

	// Insert terakhir tertahan; ia diputus oleh pembatalan, lalu penyimpanan
	// akhir (konteks baru) berhasil setelah penahan dibuka.
	go func() {
		time.Sleep(100 * time.Millisecond)
		close(store.block)
	}()
	stop()

	if s := w.Stats(); s.Failures != 0 || s.LastErr != "" || s.Written != 1 || s.Pending != 0 {
		t.Errorf("Stats = %+v, want tersimpan 1 tanpa kegagalan", s)
	}
	if got := len(store.all()); got != 1 {
		t.Errorf("tersimpan = %d, want 1 (sampel tidak boleh hilang)", got)
	}
	if strings.Contains(logs.String(), "gagal") {
		t.Errorf("berhenti dicatat sebagai kegagalan database: %s", logs)
	}
}

// Kegagalan database yang sungguhan tetap dihitung, juga saat berhenti.
func TestAGenuineFailureDuringShutdownIsStillCounted(t *testing.T) {
	store := &fakeStore{failAll: true}
	w := newWriter(store, func(o *Options) { o.FlushInterval = time.Hour })
	stop := run(t, w)
	w.Enqueue(routerA, base, 1, 1)
	stop()
	if s := w.Stats(); s.Failures != 1 || s.LastErr == "" {
		t.Errorf("Stats = %+v, want 1 kegagalan sungguhan tercatat", s)
	}
}

func TestShutdownInterruptingAPurgeIsNotLoggedAsAFailure(t *testing.T) {
	store := &fakeStore{purgeUntilCancel: true}
	logs := &bytes.Buffer{}
	w := newWriter(store, func(o *Options) {
		o.Logger = slog.New(slog.NewTextHandler(logs, nil))
		o.PurgeEvery = time.Hour
	})
	stop := run(t, w) // pembersihan saat mulai langsung menunggu pembatalan
	time.Sleep(50 * time.Millisecond)
	stop()
	if strings.Contains(logs.String(), "gagal") {
		t.Errorf("berhenti di tengah pembersihan dicatat sebagai kegagalan: %s", logs)
	}
	if !w.Stats().LastPurge.IsZero() {
		t.Error("pembersihan yang terputus tidak boleh ditandai selesai")
	}
}
