package collector

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"noc-isp/backend/internal/olt"
)

func TestLoadOltTargetsSkipsUnknownDriverAndBadPassword(t *testing.T) {
	q := targetQuerier{rows: [][]any{
		{"o1", "OLT Utama", "10.0.0.9", "hsgq", "admin", nodeCipher32},
		{"o2", "OLT ZTE", "10.0.0.10", "zte-c320", "admin", nodeCipher32}, // driver belum ada
		{"o3", "OLT Rusak", "10.0.0.11", "hsgq", "admin", "bukan-format"},
	}}
	got, err := LoadOltTargets(context.Background(), q, nodeKey32, discard)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "o1" || got[0].Config.Password != "sandi-Monitor-123!" || got[0].Config.Host != "10.0.0.9" {
		t.Fatalf("hanya o1 yang valid: %+v", got)
	}
}

type fakeRunner struct {
	polls  *atomic.Int32
	closed *atomic.Int32
	err    error
}

func (r fakeRunner) PollOnce(context.Context) error { r.polls.Add(1); return r.err }
func (r fakeRunner) Close() error                   { r.closed.Add(1); return nil }

func newTestOltFleet(targets *[]OltTarget, polls, closed *atomic.Int32, runnerErr error) *OltFleet {
	f := NewOltFleet(func(context.Context) ([]OltTarget, error) { return *targets, nil }, nil, 10*time.Millisecond, discard)
	f.build = func(t OltTarget) (oltRunner, error) {
		if t.Driver == "rusak" {
			return nil, errors.New("driver rusak")
		}
		return fakeRunner{polls: polls, closed: closed, err: runnerErr}, nil
	}
	return f
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("waktu habis menunggu kondisi")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestOltFleetStartsPollsRestartsAndStops(t *testing.T) {
	var polls, closed atomic.Int32
	cur := []OltTarget{{ID: "a", Name: "A", Driver: "hsgq", Config: olt.Config{Host: "h1", Password: "p"}}}
	f := newTestOltFleet(&cur, &polls, &closed, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := f.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return polls.Load() >= 3 }) // polling berulang tiap interval
	if f.Running() != 1 {
		t.Fatalf("running=%d", f.Running())
	}

	_ = f.Reconcile(ctx) // tidak berubah: tidak dimulai ulang
	if closed.Load() != 0 {
		t.Fatalf("tidak boleh ditutup bila tidak berubah, closed=%d", closed.Load())
	}

	cur[0].Config.Password = "baru" // kredensial berubah: dipoll ulang
	_ = f.Reconcile(ctx)
	waitFor(t, func() bool { return closed.Load() >= 1 })
	if f.Running() != 1 {
		t.Fatalf("running=%d", f.Running())
	}

	cur = nil // dinonaktifkan atau dihapus
	_ = f.Reconcile(ctx)
	waitFor(t, func() bool { return closed.Load() >= 2 })
	if f.Running() != 0 {
		t.Fatalf("running=%d", f.Running())
	}
}

func TestOltFleetBadDriverDoesNotBlockOthersAndFailuresDoNotStopPolling(t *testing.T) {
	var polls, closed atomic.Int32
	cur := []OltTarget{
		{ID: "bad", Name: "Rusak", Driver: "rusak"},
		{ID: "ok", Name: "OK", Driver: "hsgq", Config: olt.Config{Host: "h"}},
	}
	f := newTestOltFleet(&cur, &polls, &closed, errors.New("OLT tidak menjawab"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := f.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	if f.Running() != 1 {
		t.Fatalf("hanya OLT yang valid dipoll, running=%d", f.Running())
	}
	// Polling terus berjalan walau tiap putaran gagal.
	waitFor(t, func() bool { return polls.Load() >= 4 })
}
