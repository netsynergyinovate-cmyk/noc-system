package netflow

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestBufferedSinkProcessesAsync(t *testing.T) {
	var got atomic.Int64
	done := make(chan struct{})
	b := NewBufferedSink(FlowSinkFunc(func(_ context.Context, r []Record) error {
		if got.Add(int64(len(r))) == 3 {
			close(done)
		}
		return nil
	}), 8, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go b.Run(ctx)

	for i := 0; i < 3; i++ {
		_ = b.HandleFlows(ctx, []Record{{}})
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("flow tidak diproses, got=%d", got.Load())
	}
	if b.DropCount() != 0 {
		t.Fatalf("DropCount = %d, mau 0", b.DropCount())
	}
}

func TestBufferedSinkDropsWhenFullWithoutBlocking(t *testing.T) {
	b := NewBufferedSink(FlowSinkFunc(func(context.Context, []Record) error { return nil }), 2, nil)
	// Run tidak dijalankan: antrian pasti penuh.
	finished := make(chan struct{})
	go func() {
		for i := 0; i < 10; i++ {
			_ = b.HandleFlows(context.Background(), []Record{{}})
		}
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("HandleFlows memblokir saat antrian penuh")
	}
	if b.DropCount() != 8 {
		t.Fatalf("DropCount = %d, mau 8", b.DropCount())
	}
}
