package hub

import (
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestPublishCustomerStatusBroadcastsStatusMessage(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StatusFlush = 20 * time.Millisecond })
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	dbm := -23.5
	h.hub.PublishCustomerStatus("c1", false, &dbm)

	msg := readAs[statusMessage](t, conn, typeStatus)
	if len(msg.StatusChanges) != 1 {
		t.Fatalf("StatusChanges = %+v, want 1", msg.StatusChanges)
	}
	got := msg.StatusChanges[0]
	if got.CustomerID != "c1" || got.IsOnline || got.Status != "offline" {
		t.Errorf("change = %+v, want c1 offline/\"offline\"", got)
	}
	if got.OpticalPowerDbm == nil || *got.OpticalPowerDbm != dbm {
		t.Errorf("OpticalPowerDbm = %v, want %v", got.OpticalPowerDbm, dbm)
	}

	h.hub.PublishCustomerStatus("c2", true, nil)
	msg = readAs[statusMessage](t, conn, typeStatus)
	if c := msg.StatusChanges[0]; c.CustomerID != "c2" || !c.IsOnline || c.Status != "online" {
		t.Errorf("change = %+v, want c2 online/\"online\"", c)
	}
}

func TestPublishCustomerStatusCoalescesRepeatedChanges(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StatusFlush = 100 * time.Millisecond })
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	h.hub.PublishCustomerStatus("c1", false, nil)
	h.hub.PublishCustomerStatus("c1", true, nil)
	h.hub.PublishCustomerStatus("c1", false, nil)
	h.hub.PublishCustomerStatus("c2", true, nil)

	msg := readAs[statusMessage](t, conn, typeStatus)
	if len(msg.StatusChanges) != 2 {
		t.Fatalf("StatusChanges = %+v, want 2 (c1 digabung)", msg.StatusChanges)
	}
	if c := msg.StatusChanges[0]; c.CustomerID != "c1" || c.IsOnline || c.Status != "offline" {
		t.Errorf("c1 = %+v, want keadaan terakhir offline", c)
	}
	if c := msg.StatusChanges[1]; c.CustomerID != "c2" || !c.IsOnline {
		t.Errorf("c2 = %+v, want online", c)
	}

	// Sudah terkirim, jadi tidak ada pesan status kedua.
	tickAt(h, 1)
	if d := readAs[deltaMessage](t, conn, typeDelta); len(d.StatusChanges) != 0 {
		t.Errorf("perubahan terkirim dua kali: %+v", d.StatusChanges)
	}
}

func TestClientCountTracksRegisterAndUnregister(t *testing.T) {
	h := newHarness(t, nil)
	if n := h.hub.ClientCount(); n != 0 {
		t.Fatalf("ClientCount awal = %d, want 0", n)
	}

	a := &client{hub: h.hub, send: make(chan *websocket.PreparedMessage, minSendBuffer), done: make(chan struct{})}
	b := &client{hub: h.hub, send: make(chan *websocket.PreparedMessage, minSendBuffer), done: make(chan struct{})}
	if err := h.hub.register(a); err != nil {
		t.Fatal(err)
	}
	if n := h.hub.ClientCount(); n != 1 {
		t.Errorf("ClientCount = %d, want 1", n)
	}
	if err := h.hub.register(b); err != nil {
		t.Fatal(err)
	}
	if n := h.hub.ClientCount(); n != 2 {
		t.Errorf("ClientCount = %d, want 2", n)
	}
	h.hub.unregister(a)
	if n := h.hub.ClientCount(); n != 1 {
		t.Errorf("ClientCount = %d, want 1 setelah unregister", n)
	}
	h.hub.unregister(b)
	if n := h.hub.ClientCount(); n != 0 {
		t.Errorf("ClientCount = %d, want 0", n)
	}
}

func TestBroadcastRawReachesClientsAndDropsSlowConsumer(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	slow := &client{
		hub:  h.hub,
		send: make(chan *websocket.PreparedMessage, 1),
		done: make(chan struct{}),
	}
	slow.send <- nil // antrean penuh
	h.hub.mu.Lock()
	h.hub.clients[slow] = struct{}{}
	h.hub.mu.Unlock()

	finished := make(chan error, 1)
	go func() { finished <- h.hub.BroadcastRaw(map[string]any{"type": "custom", "n": 1}) }()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatalf("BroadcastRaw: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("BroadcastRaw menunggu klien yang lambat")
	}

	raw := readRaw(t, conn)
	if string(raw) != `{"n":1,"type":"custom"}` {
		t.Errorf("pesan = %s, want custom", raw)
	}

	if n := h.hub.ClientCount(); n != 1 {
		t.Errorf("ClientCount = %d, want 1 (klien lambat dikeluarkan)", n)
	}
	select {
	case <-slow.done:
	default:
		t.Error("klien lambat seharusnya diminta menutup koneksi")
	}
	if slow.closeCode != websocket.ClosePolicyViolation {
		t.Errorf("kode close = %d, want %d", slow.closeCode, websocket.ClosePolicyViolation)
	}
}

func TestBroadcastRawRejectsUnserializableMessage(t *testing.T) {
	h := newHarness(t, nil)
	if err := h.hub.BroadcastRaw(make(chan int)); err == nil {
		t.Error("BroadcastRaw(chan) = nil, want error")
	}
}
