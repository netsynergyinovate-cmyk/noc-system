package hub

import (
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"noc-isp/backend/internal/state"
)

// readNoMessage mengembalikan pesan yang tiba dalam jeda singkat, atau "" bila sepi.
func readNoMessage(conn *websocket.Conn) string {
	_ = conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	_, data, err := conn.ReadMessage()
	if err != nil {
		return ""
	}
	return string(data)
}

func TestDeltaCalculationStrictlyMonotonic(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	snap := readAs[snapshotMessage](t, conn, typeSnapshot)

	prev := snap.Time
	for i := int64(1); i <= 5; i++ {
		tickAt(h, i) // menyiarkan detik t0+i-1
		d := readAs[deltaMessage](t, conn, typeDelta)
		if d.Time != prev+1 {
			t.Fatalf("delta ke-%d bertanda %d, want %d (strictly monotonic)", i, d.Time, prev+1)
		}
		prev = d.Time
	}
	if want := snap.Time + 5; prev != want {
		t.Errorf("delta terakhir = %d, want %d", prev, want)
	}
}

func TestDeltaAggregateTrafficCalculation(t *testing.T) {
	h := newHarness(t, nil)
	if err := h.mgr.UpsertRouter(state.Router{ID: "r2", Name: "RTR-2", Host: "10.0.0.2", Active: true}); err != nil {
		t.Fatal(err)
	}
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	_, _ = h.mgr.RecordTraffic("r1", state.TrafficPoint{Time: t0, RxMbps: 10.5, TxMbps: 2.0})
	_, _ = h.mgr.RecordTraffic("r2", state.TrafficPoint{Time: t0, RxMbps: 5.5, TxMbps: 1.0})
	tickAt(h, 1)

	d := readAs[deltaMessage](t, conn, typeDelta)
	if d.Time != t0 {
		t.Fatalf("Time = %d, want %d", d.Time, t0)
	}
	if d.Traffic == nil || d.Traffic.Time != t0 || d.Traffic.Rx != 16.0 || d.Traffic.Tx != 3.0 {
		t.Errorf("Traffic = %+v, want {%d 16.0 3.0}", d.Traffic, t0)
	}
}

func TestDeltaZeroTrafficProducesNull(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	tickAt(h, 1) // tidak ada router yang melapor pada t0
	raw := string(readRaw(t, conn))
	if !strings.Contains(raw, `"traffic":null`) {
		t.Errorf("delta = %s, want \"traffic\":null", raw)
	}
}

func TestDeltaCatchUpBoundedAt60Seconds(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	tickAt(h, 120)
	target := t0 + 120 - 1 // now - Delay(1s)
	var times []int64
	for i := 0; i < maxCatchUp; i++ {
		times = append(times, readAs[deltaMessage](t, conn, typeDelta).Time)
	}
	if len(times) != 60 || maxCatchUp != 60 {
		t.Fatalf("diterima %d delta, maxCatchUp=%d; want 60", len(times), maxCatchUp)
	}
	if times[0] != target-59 || times[59] != target {
		t.Errorf("rentang delta = %d..%d, want %d..%d", times[0], times[59], target-59, target)
	}
	for i := 1; i < len(times); i++ {
		if times[i] != times[i-1]+1 {
			t.Fatalf("delta tidak berurutan: %v", times)
		}
	}

	h.hub.mu.Lock()
	last := h.hub.lastEmitted
	h.hub.mu.Unlock()
	if last != target {
		t.Errorf("lastEmitted = %d, want %d", last, target)
	}

	// Tidak ada delta ke-61.
	if raw := readNoMessage(conn); raw != "" {
		t.Errorf("delta berlebih setelah batas kejar: %s", raw)
	}
}

func TestDeltaSeamlessTransitionFromSnapshot(t *testing.T) {
	h := newHarness(t, nil)
	tickAt(h, 3) // sebelum klien tersambung, hub sudah menyiarkan sampai t0+2

	conn := h.connect()
	snap := readAs[snapshotMessage](t, conn, typeSnapshot)
	if snap.Time != t0+2 {
		t.Fatalf("snapshot.Time = %d, want %d", snap.Time, t0+2)
	}

	for i := int64(1); i <= 3; i++ {
		tickAt(h, 3+i)
		d := readAs[deltaMessage](t, conn, typeDelta)
		if want := snap.Time + i; d.Time != want {
			t.Fatalf("delta ke-%d = %d, want %d (tanpa celah/tumpang tindih)", i, d.Time, want)
		}
	}
}
