package collector

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"noc-isp/backend/internal/state"
)

type recExec struct {
	mu    sync.Mutex
	calls [][]any
	err   error
}

func (r *recExec) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, args)
	return pgconn.NewCommandTag("UPDATE 1"), r.err
}

func (r *recExec) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

func change(id string, before, after bool) state.Change {
	return state.Change{
		Before: state.Customer{ID: id, IsOnline: before},
		After:  state.Customer{ID: id, IsOnline: after},
	}
}

func TestOnlineWriterWritesOnlyOnlineTransitions(t *testing.T) {
	db := &recExec{}
	w := NewOnlineWriter(db, discard)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()

	w.Notify(change("c1", true, false))
	w.Notify(change("c2", true, true)) // tidak berubah: tidak ditulis
	w.Notify(change("c3", false, true))

	deadline := time.Now().Add(2 * time.Second)
	for db.count() < 2 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	<-done

	if db.count() != 2 {
		t.Fatalf("harus 2 penulisan, got %d (%v)", db.count(), db.calls)
	}
	if db.calls[0][0] != "c1" || db.calls[0][1] != false || db.calls[1][0] != "c3" || db.calls[1][1] != true {
		t.Errorf("isi penulisan salah: %v", db.calls)
	}
}

func TestOnlineWriterNeverBlocksAndSurvivesErrors(t *testing.T) {
	db := &recExec{err: errors.New("db mati")}
	w := NewOnlineWriter(db, discard)
	// Tanpa Run: antrean terisi lalu penuh; Notify tidak boleh macet.
	finished := make(chan struct{})
	go func() {
		for i := 0; i < onlineQueueSize+100; i++ {
			w.Notify(change("c", true, false))
		}
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(3 * time.Second):
		t.Fatal("Notify memblokir saat antrean penuh")
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()
	deadline := time.Now().Add(3 * time.Second)
	for db.count() < 10 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	<-done
	if db.count() < 10 {
		t.Fatalf("galat database tidak boleh menghentikan penulis, count=%d", db.count())
	}
}
