package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// startStreaming menjalankan Hub.Run dengan interval pendek dan menggerakkan jam
// palsu harness satu detik tiap 10 ms, sehingga delta mengalir terus tanpa
// menunggu waktu nyata. Mengembalikan cancel dan channel yang tertutup saat Run
// selesai.
func startStreaming(t *testing.T, h *harness) (cancel context.CancelFunc, runDone <-chan struct{}) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.hub.Run(ctx)
	}()
	go func() {
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.clock.Add(1)
			}
		}
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	return cancel, done
}

// jsonUnmarshalTyped decode data ke v setelah memastikan field type = want.
// Aman dipakai dari goroutine (tidak memanggil t.Fatal).
func jsonUnmarshalTyped(data []byte, want string, v any) error {
	var head struct{ Type string }
	if err := json.Unmarshal(data, &head); err != nil {
		return err
	}
	if head.Type != want {
		return fmt.Errorf("pesan bertipe %q, want %q: %s", head.Type, want, data)
	}
	return json.Unmarshal(data, v)
}

// readDeltaTimes membaca n delta berturut-turut dan memastikan tiap detik tepat
// satu lebih besar dari sebelumnya (tanpa celah, tanpa ganda, tanpa mundur).
// after adalah Time snapshot; delta pertama harus after+1.
func readDeltaTimes(t *testing.T, conn *websocket.Conn, after int64, n int) []int64 {
	t.Helper()
	times := make([]int64, 0, n)
	prev := after
	for i := 0; i < n; i++ {
		d := readAs[deltaMessage](t, conn, typeDelta)
		if d.Time != prev+1 {
			t.Fatalf("delta ke-%d: Time = %d, want %d (strictly monotonic, tanpa celah)", i, d.Time, prev+1)
		}
		prev = d.Time
		times = append(times, d.Time)
	}
	return times
}

func TestContinuousDeltaStream(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.Interval = 20 * time.Millisecond })
	startStreaming(t, h)

	conn := h.connect()
	snap := readAs[snapshotMessage](t, conn, typeSnapshot)

	times := readDeltaTimes(t, conn, snap.Time, 8)
	if len(times) != 8 {
		t.Fatalf("delta diterima = %d, want 8", len(times))
	}
}

func TestMultipleClientsReceiveConsistentStream(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.Interval = 20 * time.Millisecond })
	startStreaming(t, h)

	const clients, deltas = 3, 8
	type result struct {
		snapTime int64
		times    []int64
		raw      map[int64]string
	}
	results := make([]result, clients)
	conns := make([]*websocket.Conn, clients)
	for i := range conns {
		conns[i] = h.connect() // t.Fatal hanya boleh di goroutine test
	}

	var wg sync.WaitGroup
	errs := make(chan error, clients)
	for i, conn := range conns {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := result{raw: map[int64]string{}}
			read := func() ([]byte, error) {
				_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
				_, data, err := conn.ReadMessage()
				return data, err
			}
			first, err := read()
			if err != nil {
				errs <- err
				return
			}
			var snap snapshotMessage
			if err := jsonUnmarshalTyped(first, typeSnapshot, &snap); err != nil {
				errs <- err
				return
			}
			r.snapTime = snap.Time
			prev := snap.Time
			for j := 0; j < deltas; j++ {
				data, err := read()
				if err != nil {
					errs <- err
					return
				}
				var d deltaMessage
				if err := jsonUnmarshalTyped(data, typeDelta, &d); err != nil {
					errs <- err
					return
				}
				if d.Time != prev+1 {
					errs <- errors.New("delta tidak berurutan tanpa celah")
					return
				}
				prev = d.Time
				r.times = append(r.times, d.Time)
				r.raw[d.Time] = string(data)
			}
			results[i] = r
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}

	// Detik yang sama harus identik di semua klien yang menerimanya.
	seen := map[int64]string{}
	for i, r := range results {
		if len(r.times) != deltas {
			t.Fatalf("klien %d menerima %d delta, want %d", i, len(r.times), deltas)
		}
		for ts, raw := range r.raw {
			if prev, ok := seen[ts]; ok && prev != raw {
				t.Errorf("delta detik %d berbeda antar klien:\n%s\n%s", ts, prev, raw)
			}
			seen[ts] = raw
		}
	}
}

func TestGracefulShutdownClosesAllStreamClients(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.Interval = 20 * time.Millisecond })
	cancel, runDone := startStreaming(t, h)

	conns := []*websocket.Conn{h.connect(), h.connect()}
	for _, conn := range conns {
		snap := readAs[snapshotMessage](t, conn, typeSnapshot)
		readDeltaTimes(t, conn, snap.Time, 2) // pastikan benar-benar sedang mengalir
	}

	cancel()
	select {
	case <-runDone:
	case <-time.After(3 * time.Second):
		t.Fatal("Run tidak berhenti setelah ctx dibatalkan")
	}

	for i, conn := range conns {
		// Delta yang sudah antre boleh masih tiba; yang diharapkan akhirnya frame close.
		var closeErr *websocket.CloseError
		for {
			_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
			_, _, err := conn.ReadMessage()
			if err == nil {
				continue
			}
			if !errors.As(err, &closeErr) {
				t.Fatalf("klien %d: diharapkan frame close, dapat %v", i, err)
			}
			break
		}
		if closeErr.Code != websocket.CloseGoingAway {
			t.Errorf("klien %d: kode close = %d, want %d", i, closeErr.Code, websocket.CloseGoingAway)
		}
	}
	waitFor(t, "semua klien dikeluarkan", func() bool { return h.hub.ClientCount() == 0 })
}
