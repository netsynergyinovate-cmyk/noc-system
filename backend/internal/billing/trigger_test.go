package billing

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Tes Scheduler.TriggerManual dengan Runner palsu (tanpa database).

type triggerRunner struct {
	trigger Trigger
	calls   int
	out     RunOutcome
	err     error
	panicky bool
}

func (r *triggerRunner) RunOnce(_ context.Context, trigger Trigger) (RunOutcome, error) {
	r.calls++
	r.trigger = trigger
	if r.panicky {
		panic("boom")
	}
	return r.out, r.err
}

func newTriggerScheduler(t *testing.T, r Runner) *Scheduler {
	t.Helper()
	s, err := NewScheduler(SchedulerOptions{
		Syncer: r, Store: &fakeScheduleStore{order: &callLog{}}, Minute: 5,
		Clock: newFakeClock(time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestTriggerManualRunsSyncWithManualTrigger(t *testing.T) {
	r := &triggerRunner{out: RunOutcome{Status: RunSuccess, Trigger: TriggerManual, RunID: "r1"}}
	out, err := newTriggerScheduler(t, r).TriggerManual(context.Background())
	if err != nil {
		t.Fatalf("TriggerManual = %v, want nil", err)
	}
	if r.calls != 1 || r.trigger != TriggerManual {
		t.Errorf("RunOnce dipanggil %d kali dengan %q, want 1 kali dengan %q", r.calls, r.trigger, TriggerManual)
	}
	if out.Status != RunSuccess || out.RunID != "r1" {
		t.Errorf("outcome = %+v", out)
	}
}

func TestTriggerManualReportsRunInProgress(t *testing.T) {
	// Syncer melaporkan sinkron berjalan sebagai RunSkipped tanpa galat.
	r := &triggerRunner{out: RunOutcome{Status: RunSkipped, Trigger: TriggerManual}}
	_, err := newTriggerScheduler(t, r).TriggerManual(context.Background())
	if !errors.Is(err, ErrRunInProgress) {
		t.Fatalf("TriggerManual = %v, want ErrRunInProgress", err)
	}
}

func TestTriggerManualPassesFailuresThrough(t *testing.T) {
	cause := errors.New("sumber mati")
	r := &triggerRunner{out: RunOutcome{Status: RunFailed, RunID: "r2"}, err: cause}
	out, err := newTriggerScheduler(t, r).TriggerManual(context.Background())
	if !errors.Is(err, cause) || errors.Is(err, ErrRunInProgress) {
		t.Errorf("TriggerManual = %v, want %v", err, cause)
	}
	if out.RunID != "r2" {
		t.Errorf("outcome = %+v", out)
	}
}

func TestTriggerManualSurvivesPanic(t *testing.T) {
	r := &triggerRunner{panicky: true}
	_, err := newTriggerScheduler(t, r).TriggerManual(context.Background())
	var pe *PanicError
	if !errors.As(err, &pe) {
		t.Fatalf("TriggerManual = %v, want *PanicError", err)
	}
}

// Dua pemicu bersamaan: yang kedua melihat ErrRunInProgress selama yang pertama jalan.
func TestTriggerManualWhileRunInProgress(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	r := &blockingRunner{started: started, release: release, lock: make(chan struct{}, 1)}
	s := newTriggerScheduler(t, r)

	firstErr := make(chan error, 1)
	go func() {
		_, err := s.TriggerManual(context.Background())
		firstErr <- err
	}()
	select {
	case <-started:
	case <-time.After(watchdog):
		t.Fatal("sinkron pertama tidak mulai")
	}
	if _, err := s.TriggerManual(context.Background()); !errors.Is(err, ErrRunInProgress) {
		t.Errorf("pemicu kedua = %v, want ErrRunInProgress", err)
	}
	close(release)
	if err := <-firstErr; err != nil {
		t.Errorf("pemicu pertama = %v, want nil", err)
	}
}

// blockingRunner meniru Syncer: hanya satu RunOnce sekaligus, yang lain RunSkipped.
type blockingRunner struct {
	started, release chan struct{}
	lock             chan struct{} // kapasitas 1: penanda "sedang berjalan"
}

func (r *blockingRunner) RunOnce(_ context.Context, trigger Trigger) (RunOutcome, error) {
	select {
	case r.lock <- struct{}{}:
	default:
		return RunOutcome{Status: RunSkipped, Trigger: trigger}, nil
	}
	defer func() { <-r.lock }()
	close(r.started)
	<-r.release
	return RunOutcome{Status: RunSuccess, Trigger: trigger}, nil
}
