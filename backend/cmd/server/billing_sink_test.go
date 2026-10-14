package main

import (
	"context"
	"reflect"
	"testing"
	"time"

	"noc-isp/backend/internal/billing"
	"noc-isp/backend/internal/state"
)

// Tes pemasangan pendengar perubahan status: billing.StatusChange -> state.Manager.

func sinkManager(t *testing.T) *state.Manager {
	t.Helper()
	m := state.NewManager()
	if err := m.UpsertRouter(state.Router{ID: "r1"}); err != nil {
		t.Fatal(err)
	}
	for id, status := range map[string]string{"c1": "lunas", "c2": "isolir", "c3": "lunas"} {
		if err := m.UpsertCustomer(state.Customer{ID: id, PPPoEUsername: "u-" + id, RouterID: "r1", BillingStatus: status}); err != nil {
			t.Fatal(err)
		}
	}
	return m
}

func drained(m *state.Manager) []state.BillingChange {
	var out []state.BillingChange
	for _, q := range m.DrainBillingChanges(0) {
		out = append(out, q.BillingChange)
	}
	return out
}

func TestBillingStatusSinkMapsChangesToTheManager(t *testing.T) {
	m := sinkManager(t)
	logger, _ := testLogger()
	sink := billingStatusSink(m, logger)
	err := sink([]billing.StatusChange{
		{CustomerID: "c1", From: billing.StatusLunas, To: billing.StatusIsolir},
		{CustomerID: "c2", From: billing.StatusIsolir, To: billing.StatusLunas},
		{CustomerID: "tidak-dikenal", From: billing.StatusLunas, To: billing.StatusIsolir}, // diabaikan
	})
	if err != nil {
		t.Fatalf("sink: %v", err)
	}
	want := []state.BillingChange{{CustomerID: "c1", Status: "isolir"}, {CustomerID: "c2", Status: "lunas"}}
	if got := drained(m); !reflect.DeepEqual(got, want) {
		t.Errorf("antrean Manager = %+v, want %+v", got, want)
	}
	// Diterapkan lagi: tidak ada perubahan baru.
	_ = sink([]billing.StatusChange{{CustomerID: "c1", To: billing.StatusIsolir}})
	if got := drained(m); got != nil {
		t.Errorf("penerapan kedua menghasilkan %+v", got)
	}
}

func TestBillingStatusSinkWithoutChangesTouchesNothing(t *testing.T) {
	m := sinkManager(t)
	logger, logs := testLogger()
	if err := billingStatusSink(m, logger)(nil); err != nil {
		t.Fatal(err)
	}
	if got := drained(m); got != nil || logs.String() != "" {
		t.Errorf("antrean %+v, log %q", got, logs)
	}
}

// captureSyncers mengganti pembuat Syncer dengan yang mencatat opsinya.
func captureSyncers(t *testing.T) *[]billing.SyncerOptions {
	t.Helper()
	var captured []billing.SyncerOptions
	original := newBillingSyncer
	newBillingSyncer = func(src billing.InvoiceSource, store billing.RunStore, opts billing.SyncerOptions) (*billing.Syncer, error) {
		captured = append(captured, opts)
		return original(src, store, opts)
	}
	t.Cleanup(func() { newBillingSyncer = original })
	return &captured
}

type changeSource struct{}

func (changeSource) Invoices(context.Context) ([]billing.Invoice, billing.Stats, error) {
	return []billing.Invoice{{Name: "u-c1", Ref: "INV-1", Status: billing.StatusIsolir}}, billing.Stats{Pages: 1, Rows: 1}, nil
}

type changeStore struct{ *stubStore }

func (changeStore) LoadCustomers(context.Context) ([]billing.Customer, error) {
	return []billing.Customer{{ID: "c1", PPPoE: "u-c1", Status: billing.StatusLunas}}, nil
}

// startBillingWithSink memasang pendengar ke Syncer yang sungguh dipakai, dan
// pendengar itu meneruskan hasil sinkron ke Manager.
func TestStartBillingWithSinkInstallsTheListenerOnTheRealSyncer(t *testing.T) {
	captured := captureSyncers(t)
	pool, err := openArchivePool(context.Background(), "postgres://noc:rahasia-sekali@127.0.0.1:1/noc?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	logger, _ := testLogger()
	settings, err := loadBillingSettings(envFrom(fullBillingEnv(map[string]string{"BILLING_URL": "http://127.0.0.1:1"})))
	if err != nil {
		t.Fatal(err)
	}
	m := sinkManager(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wait, err := startBillingWithSink(ctx, logger, settings, pool, billingStatusSink(m, logger))
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	wait()

	if len(*captured) != 1 || (*captured)[0].OnStatusChanges == nil {
		t.Fatalf("opsi Syncer = %+v, want satu dengan OnStatusChanges terpasang", *captured)
	}
	// Syncer dari opsi yang sama, dijalankan sungguh-sungguh dengan sumber dan
	// penyimpanan palsu: perubahannya sampai ke Manager.
	syncer, err := billing.NewSyncer(changeSource{}, changeStore{&stubStore{}}, (*captured)[0])
	if err != nil {
		t.Fatal(err)
	}
	out, err := syncer.RunOnce(context.Background(), billing.TriggerSchedule)
	if err != nil || out.Status != billing.RunSuccess || out.NotifyErr != nil {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if got, want := drained(m), []state.BillingChange{{CustomerID: "c1", Status: "isolir"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("antrean Manager = %+v, want %+v", got, want)
	}
}

func TestStartBillingWithoutASinkLeavesTheListenerEmpty(t *testing.T) {
	captured := captureSyncers(t)
	pool, err := openArchivePool(context.Background(), "postgres://noc:rahasia-sekali@127.0.0.1:1/noc?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	logger, _ := testLogger()
	settings, _ := loadBillingSettings(envFrom(fullBillingEnv(map[string]string{"BILLING_URL": "http://127.0.0.1:1"})))
	ctx, cancel := context.WithCancel(context.Background())
	wait, err := startBilling(ctx, logger, settings, pool)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	wait()
	if len(*captured) != 1 || (*captured)[0].OnStatusChanges != nil {
		t.Errorf("opsi Syncer = %+v, want OnStatusChanges kosong", *captured)
	}
}

// Billing mati, atau tanpa database: tidak ada Syncer dan pendengar tidak pernah dipanggil.
func TestSinkIsNeverCalledWhenBillingIsOffOrHasNoDatabase(t *testing.T) {
	captured := captureSyncers(t)
	logger, _ := testLogger()
	called := 0
	sink := func([]billing.StatusChange) error { called++; return nil }

	enabled, _ := loadBillingSettings(envFrom(fullBillingEnv(nil)))
	for name, tc := range map[string]struct {
		settings billingSettings
		db       billing.DB
	}{
		"billing mati":   {billingSettings{}, nil},
		"tanpa database": {enabled, nil},
	} {
		wait, err := startBillingWithSink(context.Background(), logger, tc.settings, tc.db, sink)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		done := make(chan struct{})
		go func() { wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatalf("%s: wait tidak kembali", name)
		}
	}
	if called != 0 || len(*captured) != 0 {
		t.Errorf("pendengar dipanggil %d kali, Syncer dibuat %d kali; want 0 dan 0", called, len(*captured))
	}
}
