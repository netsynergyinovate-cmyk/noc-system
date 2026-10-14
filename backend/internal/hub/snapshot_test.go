package hub

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/state"
)

func TestSnapshotOnEmptyManager(t *testing.T) {
	tokens, err := auth.NewTokens(testSecret)
	if err != nil {
		t.Fatal(err)
	}
	h := New(state.NewManager(), Options{
		Verifier:       tokens,
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		AllowedOrigins: []string{testOrigin},
		Now:            func() time.Time { return time.Unix(t0, 0) },
	})
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	clock := &atomic.Int64{}
	clock.Store(t0)
	hr := &harness{t: t, hub: h, server: server, tokens: tokens, clock: clock}

	conn := hr.connect()
	data := readRaw(t, conn)

	var head struct{ Type string }
	if err := json.Unmarshal(data, &head); err != nil || head.Type != typeSnapshot {
		t.Fatalf("pesan pertama = %s, want snapshot", data)
	}
	raw := string(data)
	for _, want := range []string{
		`"routers":[]`,
		`"customers":[]`,
		`"traffic":{"times":[],"rx":[],"tx":[]}`,
	} {
		if !strings.Contains(raw, want) {
			t.Errorf("snapshot %s tidak memuat %s", raw, want)
		}
	}
	if strings.Contains(raw, "null") {
		t.Errorf("snapshot memuat null: %s", raw)
	}
}

func TestSnapshotGuaranteesFirstMessageBeforeDeltaOrStatus(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StatusFlush = time.Millisecond })

	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := int64(1); ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			change, err := h.mgr.SetOnline("budi", i%2 == 0)
			if err == nil {
				h.hub.NotifyChange(change)
			}
			tickAt(h, i)
			time.Sleep(time.Millisecond)
		}
	}()
	t.Cleanup(func() { close(stop); <-done })

	for i := 0; i < 5; i++ {
		conn := h.connect()
		data := readRaw(t, conn)
		var head struct{ Type string }
		if err := json.Unmarshal(data, &head); err != nil || head.Type != typeSnapshot {
			t.Fatalf("klien %d: pesan pertama = %s, want snapshot", i, data)
		}
		// Sesudah snapshot, pesan berikutnya boleh delta atau status.
		next := readRaw(t, conn)
		if err := json.Unmarshal(next, &head); err != nil ||
			(head.Type != typeDelta && head.Type != typeStatus) {
			t.Fatalf("klien %d: pesan kedua = %s, want delta/status", i, next)
		}
	}
}

func TestSnapshotReflectsDynamicallyAddedCustomers(t *testing.T) {
	h := newHarness(t, nil)

	first := h.connect()
	snap1 := readAs[snapshotMessage](t, first, typeSnapshot)
	if len(snap1.Routers) != 1 || len(snap1.Customers) != 2 {
		t.Fatalf("snapshot 1 = %d router, %d pelanggan; want 1, 2", len(snap1.Routers), len(snap1.Customers))
	}

	if err := h.mgr.UpsertRouter(state.Router{ID: "r2", Name: "RTR-2", Host: "10.0.0.2", Active: true}); err != nil {
		t.Fatal(err)
	}
	if err := h.mgr.UpsertCustomer(state.Customer{
		ID: "c3", Name: "Dewi", PPPoEUsername: "dewi", RouterID: "r2", BillingStatus: "lunas", IsOnline: true,
	}); err != nil {
		t.Fatal(err)
	}

	second := h.connect()
	snap2 := readAs[snapshotMessage](t, second, typeSnapshot)
	if len(snap2.Routers) != 2 || len(snap2.Customers) != 3 {
		t.Fatalf("snapshot 2 = %d router, %d pelanggan; want 2, 3", len(snap2.Routers), len(snap2.Customers))
	}
	var gotRouter, gotCustomer bool
	for _, r := range snap2.Routers {
		gotRouter = gotRouter || r.ID == "r2"
	}
	for _, c := range snap2.Customers {
		gotCustomer = gotCustomer || (c.ID == "c3" && c.RouterID == "r2")
	}
	if !gotRouter || !gotCustomer {
		t.Errorf("snapshot 2 tidak memuat r2/c3: %+v", snap2)
	}
}
