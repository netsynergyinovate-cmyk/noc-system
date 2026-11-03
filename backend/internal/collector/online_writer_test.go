package collector

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"noc-isp/backend/internal/state"
)

type recExec struct {
	mu    sync.Mutex
	calls [][]any
	sqls  []string
	err   error
	errOn string
}

func (r *recExec) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, args)
	r.sqls = append(r.sqls, query)
	if r.err != nil {
		if r.errOn == "" || strings.Contains(query, r.errOn) {
			return pgconn.CommandTag{}, r.err
		}
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func (r *recExec) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

func (r *recExec) callsFor(snippet string) [][]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	var res [][]any
	for i, q := range r.sqls {
		if strings.Contains(q, snippet) {
			res = append(res, r.calls[i])
		}
	}
	return res
}
func change(id string, before, after bool) state.Change {
	return state.Change{
		Before: state.Customer{ID: id, IsOnline: before},
		After:  state.Customer{ID: id, IsOnline: after},
	}
}

func TestOnlineWriterWritesTransitionsAndPurgesAtStart(t *testing.T) {
	db := &recExec{}
	w := NewOnlineWriter(db, discard)
	fixedTime := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	w.now = func() time.Time { return fixedTime }

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()

	w.Notify(change("c1", true, false)) // transisi down
	w.Notify(change("c2", true, true))  // bukan transisi: tidak ditulis
	w.Notify(change("c3", false, true)) // transisi up

	// 1 purge di awal + 2 update + 2 insert event = 5 pemanggilan
	deadline := time.Now().Add(2 * time.Second)
	for db.count() < 5 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	<-done

	if db.count() != 5 {
		t.Fatalf("harus 5 penulisan (1 purge + 2 update + 2 insert), got %d (%v)", db.count(), db.calls)
	}

	// 1. Purge dipanggil dengan cutoff now - 400d
	purges := db.callsFor("DELETE FROM customer_connection_events")
	if len(purges) != 1 {
		t.Fatalf("harus ada 1 panggilan purge, got %d", len(purges))
	}
	cutoff, ok := purges[0][0].(time.Time)
	if !ok {
		t.Fatalf("argumen purge bukan time.Time: %v", purges[0][0])
	}
	expectedCutoff := fixedTime.Add(-connectionEventRetention)
	if !cutoff.Equal(expectedCutoff) {
		t.Errorf("cutoff purge salah: got %v, want %v", cutoff, expectedCutoff)
	}

	// 2. Update status hanya untuk transisi
	updates := db.callsFor("UPDATE customers")
	if len(updates) != 2 {
		t.Fatalf("harus ada 2 update status, got %d", len(updates))
	}
	if updates[0][0] != "c1" || updates[0][1] != false {
		t.Errorf("update c1 salah: %v", updates[0])
	}
	if updates[1][0] != "c3" || updates[1][1] != true {
		t.Errorf("update c3 salah: %v", updates[1])
	}

	// 3. Insert event hanya untuk transisi
	events := db.callsFor("INSERT INTO customer_connection_events")
	if len(events) != 2 {
		t.Fatalf("harus ada 2 insert event, got %d", len(events))
	}
	if events[0][0] != "c1" || events[0][1] != "down" || !events[0][2].(time.Time).Equal(fixedTime) {
		t.Errorf("event c1 salah: %v", events[0])
	}
	if events[1][0] != "c3" || events[1][1] != "up" || !events[1][2].(time.Time).Equal(fixedTime) {
		t.Errorf("event c3 salah: %v", events[1])
	}
}

func TestOnlineWriterErrorOnOneStatementDoesNotBlockTheOther(t *testing.T) {
	fixedTime := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	dbErr := errors.New("simulasi db error")

	t.Run("error pada UPDATE tetap menulis event", func(t *testing.T) {
		db := &recExec{err: dbErr, errOn: "UPDATE customers"}
		w := NewOnlineWriter(db, discard)
		w.now = func() time.Time { return fixedTime }

		w.writeChange(context.Background(), change("c1", true, false))

		updates := db.callsFor("UPDATE customers")
		events := db.callsFor("INSERT INTO customer_connection_events")
		if len(updates) != 1 {
			t.Fatalf("UPDATE harus dicoba sekali, got %d", len(updates))
		}
		if len(events) != 1 {
			t.Fatalf("INSERT event harus tetap dijalankan meski UPDATE gagal, got %d", len(events))
		}
		if events[0][0] != "c1" || events[0][1] != "down" {
			t.Errorf("args event salah: %v", events[0])
		}
	})

	t.Run("error pada INSERT event tetap mengupdate status", func(t *testing.T) {
		db := &recExec{err: dbErr, errOn: "INSERT INTO customer_connection_events"}
		w := NewOnlineWriter(db, discard)
		w.now = func() time.Time { return fixedTime }

		w.writeChange(context.Background(), change("c1", true, false))

		updates := db.callsFor("UPDATE customers")
		events := db.callsFor("INSERT INTO customer_connection_events")
		if len(updates) != 1 {
			t.Fatalf("UPDATE status harus tetap dijalankan, got %d", len(updates))
		}
		if len(events) != 1 {
			t.Fatalf("INSERT event harus dicoba meski gagal, got %d", len(events))
		}
		if updates[0][0] != "c1" || updates[0][1] != false {
			t.Errorf("args update salah: %v", updates[0])
		}
	})
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
