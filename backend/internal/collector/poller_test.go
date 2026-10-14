package collector

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

type recordedPoint struct {
	router string
	point  state.TrafficPoint
}

// fakeRecorder mengumpulkan sampel; err bila diisi dikembalikan ke Poller.
type fakeRecorder struct {
	mu     sync.Mutex
	points []recordedPoint
	err    error
}

func (f *fakeRecorder) RecordTraffic(routerID string, p state.TrafficPoint) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return false, f.err
	}
	f.points = append(f.points, recordedPoint{routerID, p})
	return true, nil
}

func (f *fakeRecorder) SetQueues(ratios []state.QueueRatio) ([]state.Change, error) {
	return nil, nil
}

func (f *fakeRecorder) snapshot() []recordedPoint {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]recordedPoint(nil), f.points...)
}

func newPoller(rec Recorder, tweak func(*PollerOptions)) *Poller {
	opts := PollerOptions{
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Interval: 20 * time.Millisecond,
	}
	if tweak != nil {
		tweak(&opts)
	}
	return NewPoller(rec, opts)
}

func waitUntil(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("menunggu %s: habis waktu", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func stopAndWait(t *testing.T, p *Poller, cancel context.CancelFunc) {
	t.Helper()
	cancel()
	done := make(chan struct{})
	go func() { p.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("goroutine polling tidak berhenti setelah ctx dibatalkan")
	}
}

func TestPollerRecordsOneAggregatedPointPerPoll(t *testing.T) {
	server := fakeRouter(t, okHandler(queueJSON))
	rec := &fakeRecorder{}
	p := newPoller(rec, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, target(server)); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "tiga sampel", func() bool { return len(rec.snapshot()) >= 3 })
	stopAndWait(t, p, cancel)

	points := rec.snapshot()
	for i, rp := range points {
		if rp.router != "r1" {
			t.Errorf("sampel %d untuk router %q, want r1", i, rp.router)
		}
		if rp.point.RxMbps != 10.5 || rp.point.TxMbps != 1.5 {
			t.Errorf("sampel %d = %+v, want rx 10,5 dan tx 1,5 Mbps", i, rp.point)
		}
		if rp.point.Time == 0 {
			t.Errorf("sampel %d tanpa waktu", i)
		}
		if i > 0 && rp.point.Time < points[i-1].point.Time {
			t.Errorf("waktu sampel mundur: %d lalu %d", points[i-1].point.Time, rp.point.Time)
		}
	}
}

func TestPollerStatusReflectsSuccess(t *testing.T) {
	server := fakeRouter(t, okHandler(queueJSON))
	p := newPoller(&fakeRecorder{}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, target(server)); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "status sukses", func() bool {
		s, _ := p.Status("r1")
		return !s.LastSuccess.IsZero()
	})
	s, ok := p.Status("r1")
	if !ok || s.ConsecutiveFailures != 0 || s.LastError != "" || s.LastItemCount != 2 || s.LastDuration < 0 {
		t.Errorf("Status = %+v, ok = %v", s, ok)
	}
	stopAndWait(t, p, cancel)
}

func TestPollerReportsFailuresThenRecovers(t *testing.T) {
	var calls atomic.Int32
	server := fakeRouter(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) <= 4 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		okHandler(queueJSON)(w, r)
	})
	rec := &fakeRecorder{}
	p := newPoller(rec, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, target(server)); err != nil {
		t.Fatal(err)
	}

	waitUntil(t, "kegagalan terbaca di Status", func() bool {
		s, _ := p.Status("r1")
		return s.ConsecutiveFailures >= 3 && strings.Contains(s.LastError, "menolak login")
	})
	if n := len(rec.snapshot()); n != 0 {
		t.Errorf("ada %d sampel saat router menolak login, want 0 (jangan mengarang traffic)", n)
	}

	waitUntil(t, "pulih", func() bool { return len(rec.snapshot()) >= 1 })
	waitUntil(t, "status pulih", func() bool {
		s, _ := p.Status("r1")
		return s.ConsecutiveFailures == 0 && s.LastError == ""
	})
	stopAndWait(t, p, cancel)
}

func TestPollerSlowsDownOnRepeatedFailuresAndSpeedsUpAfterRecovery(t *testing.T) {
	var mu sync.Mutex
	var times []time.Time
	var healthy atomic.Bool
	server := fakeRouter(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		times = append(times, time.Now())
		mu.Unlock()
		if healthy.Load() {
			okHandler(queueJSON)(w, r)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	})
	rec := &fakeRecorder{}
	p := newPoller(rec, func(o *PollerOptions) { o.Interval = 30 * time.Millisecond })
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, target(server)); err != nil {
		t.Fatal(err)
	}

	waitUntil(t, "tujuh permintaan gagal", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(times) >= 7
	})
	mu.Lock()
	gaps := make([]time.Duration, 0, len(times)-1)
	for i := 1; i < len(times); i++ {
		gaps = append(gaps, times[i].Sub(times[i-1]))
	}
	mu.Unlock()
	// Beberapa kegagalan pertama masih mengikuti interval; sesudahnya jaraknya
	// harus makin lebar, bukan tetap menembak tiap interval.
	if last := gaps[len(gaps)-1]; last < 90*time.Millisecond {
		t.Errorf("jarak permintaan terakhir = %s, want melebar (>= 3x interval) setelah gagal berulang; semua jarak: %v", last, gaps)
	}

	healthy.Store(true)
	waitUntil(t, "kembali ke ritme normal", func() bool { return len(rec.snapshot()) >= 3 })
	stopAndWait(t, p, cancel)
}

func TestPollerNeverOverlapsRequestsToTheSameRouter(t *testing.T) {
	var inFlight, maxInFlight, calls atomic.Int32
	server := fakeRouter(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		now := inFlight.Add(1)
		for {
			prev := maxInFlight.Load()
			if now <= prev || maxInFlight.CompareAndSwap(prev, now) {
				break
			}
		}
		defer inFlight.Add(-1)
		select { // router yang lambat: lebih lama dari batas waktu permintaan
		case <-time.After(300 * time.Millisecond):
		case <-r.Context().Done():
		}
	})
	p := newPoller(&fakeRecorder{}, func(o *PollerOptions) { o.Interval = 20 * time.Millisecond })
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, target(server)); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "status timeout", func() bool {
		s, _ := p.Status("r1")
		return s.ConsecutiveFailures >= 2 && strings.Contains(s.LastError, "tidak menjawab")
	})
	stopAndWait(t, p, cancel)

	if got := maxInFlight.Load(); got != 1 {
		t.Errorf("permintaan bersamaan maksimum = %d, want 1: permintaan yang macet tidak boleh menumpuk", got)
	}
}

func TestPollerSurfacesRecorderErrors(t *testing.T) {
	server := fakeRouter(t, okHandler(queueJSON))
	rec := &fakeRecorder{err: errors.New("router tidak terdaftar")}
	p := newPoller(rec, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, target(server)); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "error penyimpanan", func() bool {
		s, _ := p.Status("r1")
		return strings.Contains(s.LastError, "simpan sampel traffic")
	})
	stopAndWait(t, p, cancel)
}

func TestPollerStartAndStopRules(t *testing.T) {
	server := fakeRouter(t, okHandler(queueJSON))
	p := newPoller(&fakeRecorder{}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := p.Start(ctx, Target{RouterID: "x", BaseURL: "bukan-url", Username: "u"}); err == nil {
		t.Error("target tidak valid seharusnya ditolak")
	}
	if _, ok := p.Status("x"); ok {
		t.Error("target yang ditolak tidak boleh meninggalkan worker")
	}
	if err := p.Start(ctx, target(server)); err != nil {
		t.Fatal(err)
	}
	if err := p.Start(ctx, target(server)); err == nil {
		t.Error("router yang sama dipoll dua kali seharusnya ditolak")
	}
	p.Stop("tidak-ada") // tidak boleh panik

	p.Stop("r1")
	if _, ok := p.Status("r1"); ok {
		t.Error("Status masih ada setelah Stop")
	}
	done := make(chan struct{})
	go func() { p.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Stop tidak menghentikan goroutine")
	}
	// Setelah Stop, router boleh dimulai lagi (mis. kata sandi diganti).
	if err := p.Start(ctx, target(server)); err != nil {
		t.Errorf("Start setelah Stop: %v", err)
	}
}

func TestPollerPollsRoutersIndependently(t *testing.T) {
	healthy := fakeRouter(t, okHandler(queueJSON))
	broken := fakeRouter(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusInternalServerError) })
	rec := &fakeRecorder{}
	p := newPoller(rec, nil)
	ctx, cancel := context.WithCancel(context.Background())

	a := target(healthy)
	a.RouterID = "sehat"
	b := target(broken)
	b.RouterID = "rusak"
	if err := p.Start(ctx, a); err != nil {
		t.Fatal(err)
	}
	if err := p.Start(ctx, b); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "router sehat terus tercatat", func() bool { return len(rec.snapshot()) >= 4 })
	waitUntil(t, "router rusak terbaca gagal", func() bool {
		s, _ := p.Status("rusak")
		return s.ConsecutiveFailures > 0
	})
	stopAndWait(t, p, cancel)

	for _, rp := range rec.snapshot() {
		if rp.router != "sehat" {
			t.Errorf("sampel dari router %q, want hanya dari router yang sehat", rp.router)
		}
	}
}

// Menyambungkan Poller ke state.Manager yang sebenarnya, seperti di server.
func TestPollerFeedsTheStateManager(t *testing.T) {
	server := fakeRouter(t, okHandler(queueJSON))
	mgr := state.NewManager()
	if err := mgr.UpsertRouter(state.Router{ID: "r1", Name: "RTR-1", Active: true}); err != nil {
		t.Fatal(err)
	}
	p := newPoller(mgr, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, target(server)); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "traffic masuk ke state", func() bool { return len(mgr.TrafficSeries()) >= 2 })
	stopAndWait(t, p, cancel)

	series := mgr.TrafficSeries()
	last := series[len(series)-1]
	if last.RxMbps != 10.5 || last.TxMbps != 1.5 {
		t.Errorf("titik terakhir = %+v, want rx 10,5 dan tx 1,5", last)
	}
	if total, n := mgr.TotalAt(last.Time); n != 1 || total.RxMbps != 10.5 {
		t.Errorf("TotalAt(%d) = %+v dari %d router", last.Time, total, n)
	}
}

func TestBackoffGrowsAndIsCapped(t *testing.T) {
	interval := time.Second
	want := []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 30 * time.Second, 30 * time.Second}
	for extra, w := range want {
		if got := backoff(interval, extra); got != w {
			t.Errorf("backoff(%s, %d) = %s, want %s", interval, extra, got, w)
		}
	}
	if got := backoff(interval, 10_000); got != maxBackoff {
		t.Errorf("backoff untuk kegagalan sangat banyak = %s, want %s", got, maxBackoff)
	}
}
