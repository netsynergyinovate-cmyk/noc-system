package engine

import (
	"context"
	"sort"
	"sync"
	"testing"
	"time"
)

type fakeSender struct {
	mu   sync.Mutex
	sent  map[string]string
	count int
}

func (f *fakeSender) Send(_ context.Context, target, message string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.sent == nil {
		f.sent = map[string]string{}
	}
	f.sent[target] = message
	f.count++
	return nil
}

func (f *fakeSender) targets() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for t := range f.sent {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

func newNotifier(min string) (*WhatsappNotifier, *fakeSender) {
	s := &fakeSender{}
	return &WhatsappNotifier{
		Sender:      s,
		Recipients:  func() []string { return []string{"6281", "6282"} },
		Template:    "{severity} {kind} {subject}",
		MinSeverity: min,
	}, s
}

func ev(sev string, active bool) Event {
	return Event{Kind: "cpu", Severity: sev, Active: active, RouterID: "r1", Time: time.Unix(0, 0).UTC()}
}

func TestNotifierSendsOnNewCritical(t *testing.T) {
	n, s := newNotifier("critical")
	n.Sink([]Event{ev("critical", true)})
	n.Wait()
	if got := s.targets(); len(got) != 2 {
		t.Fatalf("want 2 recipients, got %v", got)
	}
	if m := s.sent["6281"]; m != "\U0001F6A8 KRITIS cpu r1" {
		t.Fatalf("message = %q", m)
	}
}

func TestNotifierDedupAndRecovery(t *testing.T) {
	n, s := newNotifier("critical")
	n.Recipients = func() []string { return []string{"6281"} }
	a := ev("critical", true)
	a.Key = "cpu:r1"
	n.Sink([]Event{a})
	n.Sink([]Event{a})
	n.Wait()
	if m := s.sent["6281"]; m != "\U0001F6A8 KRITIS cpu r1" {
		t.Fatalf("message = %q", m)
	}
	if s.count != 1 {
		t.Fatalf("dedup: want 1 send, got %d", s.count)
	}
	r := a
	r.Active = false
	n.Sink([]Event{r})
	n.Wait()
	want := "\u2705 *NOC RECOVERY*\nGangguan: cpu\nPerangkat: r1\nRouter: r1\nWaktu Pulih: 1970-01-01 00:00:00\nStatus: Sudah Normal Kembali"
	if s.count != 2 || s.sent["6281"] != want {
		t.Fatalf("recovery: count=%d msg=%q", s.count, s.sent["6281"])
	}
	if len(n.activeKeys) != 0 {
		t.Fatalf("tracker not cleared: %v", n.activeKeys)
	}
	n.Sink([]Event{r}) // pulih tanpa aktif sebelumnya: diam
	n.Wait()
	if s.count != 2 {
		t.Fatalf("untracked recovery must not send, count=%d", s.count)
	}
}

func TestNotifierIgnoresResolved(t *testing.T) {
	n, s := newNotifier("warning")
	n.Sink([]Event{ev("critical", false)})
	n.Wait()
	if got := s.targets(); len(got) != 0 {
		t.Fatalf("resolved event must not send, got %v", got)
	}
}

func TestNotifierIgnoresBelowMinSeverity(t *testing.T) {
	n, s := newNotifier("critical")
	n.Sink([]Event{ev("warning", true), ev("info", true)})
	n.Wait()
	if got := s.targets(); len(got) != 0 {
		t.Fatalf("below min severity must not send, got %v", got)
	}
}
