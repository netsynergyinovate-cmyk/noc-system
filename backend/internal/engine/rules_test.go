package engine

import (
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

func offlineEngine(t *testing.T, mgr *state.Manager, after time.Duration) *Engine {
	t.Helper()
	engine, err := New(Options{
		Logger: quietLogger(),
		Source: mgr,
		Rules:  []Rule{OfflineRule{After: after}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return engine
}

func TestOfflineRuleProducesConditionsOnlyForOfflineCustomers(t *testing.T) {
	obs := Observation{Customers: []state.Customer{
		{ID: "c1", Name: "Budi", PPPoEUsername: "budi", RouterID: "r1", IsOnline: true},
		{ID: "c2", Name: "Siti", PPPoEUsername: "siti", RouterID: "r2", IsOnline: false, StatusSince: at(-10)},
	}}
	conds := OfflineRule{}.Evaluate(obs, at(0))
	if len(conds) != 1 {
		t.Fatalf("kondisi = %+v, want satu untuk pelanggan offline", conds)
	}
	c := conds[0]
	if c.Key != "offline:c2" || c.Kind != "offline" || c.RouterID != "r2" || c.CustomerID != "c2" {
		t.Errorf("kondisi = %+v", c)
	}
	if c.For != DefaultOfflineAfter {
		t.Errorf("For = %s, want default %s", c.For, DefaultOfflineAfter)
	}
	if !c.Since.Equal(at(-10)) {
		t.Errorf("Since = %v, want StatusSince pelanggan", c.Since)
	}
	if c.Detail["pppoeUsername"] != "siti" || c.Detail["name"] != "Siti" {
		t.Errorf("Detail = %v", c.Detail)
	}
	if custom := (OfflineRule{After: time.Minute}).Evaluate(obs, at(0)); custom[0].For != time.Minute {
		t.Errorf("For = %s, want 1m", custom[0].For)
	}
}

// Dari state sungguhan: pelanggan putus, lewat 30 detik menjadi event, tersambung
// lagi menjadi event selesai; putus sebentar tidak menjadi apa-apa.
func TestOfflineAlertLifecycleAgainstTheStateManager(t *testing.T) {
	clock := t0
	mgr := state.NewManager(state.WithClock(func() time.Time { return clock }))
	_ = mgr.UpsertRouter(state.Router{ID: "r1", Active: true})
	for _, c := range []state.Customer{
		{ID: "c1", Name: "Budi", PPPoEUsername: "budi", RouterID: "r1", IsOnline: true},
		{ID: "c2", Name: "Siti", PPPoEUsername: "siti", RouterID: "r1", IsOnline: true},
	} {
		if err := mgr.UpsertCustomer(c); err != nil {
			t.Fatal(err)
		}
	}
	engine := offlineEngine(t, mgr, 30*time.Second)

	if events := engine.Evaluate(clock); len(events) != 0 {
		t.Fatalf("semua online: events = %+v, want kosong", events)
	}

	// Budi putus di detik 10 dan tidak kembali; Siti putus di detik 12 dan kembali di 25.
	clock = at(10)
	_, _ = mgr.SetOnline("budi", false)
	clock = at(12)
	_, _ = mgr.SetOnline("siti", false)
	engine.Evaluate(at(12))
	clock = at(25)
	_, _ = mgr.SetOnline("siti", true)

	if events := engine.Evaluate(at(39)); len(events) != 0 {
		t.Fatalf("detik 39 (budi putus 29 detik): events = %+v, want kosong", events)
	}
	events := engine.Evaluate(at(40))
	if len(events) != 1 || events[0].Key != "offline:c1" || !events[0].Active {
		t.Fatalf("detik 40 = %+v, want satu event mulai untuk budi", events)
	}
	if events[0].StartedAt != at(10) {
		t.Errorf("StartedAt = %v, want detik 10 (saat budi benar-benar putus)", events[0].StartedAt)
	}
	if events[0].Detail["pppoeUsername"] != "budi" {
		t.Errorf("Detail = %v", events[0].Detail)
	}

	clock = at(100)
	_, _ = mgr.SetOnline("budi", true)
	ended := engine.Evaluate(at(100))
	if len(ended) != 1 || ended[0].Active || ended[0].ID != events[0].ID || ended[0].Duration() != 90*time.Second {
		t.Fatalf("selesai = %+v, want event selesai dengan ID sama dan lama 90 detik", ended)
	}
	if siti := engine.Active(); len(siti) != 0 {
		t.Errorf("Active() = %+v, want kosong", siti)
	}
}

// Setelah backend dinyalakan ulang, pelanggan yang sudah lama offline langsung
// dikenali; tidak menunggu 30 detik lagi.
func TestAlreadyOfflineCustomersFireImmediatelyWhenStatusSinceIsOld(t *testing.T) {
	mgr := state.NewManager()
	_ = mgr.UpsertRouter(state.Router{ID: "r1", Active: true})
	_ = mgr.UpsertCustomer(state.Customer{
		ID: "c1", PPPoEUsername: "budi", RouterID: "r1", IsOnline: false,
		StatusSince: t0.Add(-10 * time.Minute),
	})
	events := offlineEngine(t, mgr, 30*time.Second).Evaluate(t0)
	if len(events) != 1 || events[0].Duration() != 10*time.Minute {
		t.Errorf("events = %+v, want satu event dengan lama 10 menit", events)
	}
}

func TestQueueRuleProducesConditionsForCongestedQueues(t *testing.T) {
	obs := Observation{Customers: []state.Customer{
		{ID: "c1", Name: "Budi", PPPoEUsername: "budi", RouterID: "r1", IsOnline: true, HasQueue: false},
		{ID: "c2", Name: "Siti", PPPoEUsername: "siti", RouterID: "r1", IsOnline: false, HasQueue: true, QueueUpRatio: 1.0},
		{ID: "c3", Name: "Agus", PPPoEUsername: "agus", RouterID: "r1", IsOnline: true, HasQueue: true, QueueDownRatio: 0.94, QueueUpRatio: 0.5},
		{ID: "c4", Name: "Eka", PPPoEUsername: "eka", RouterID: "r1", IsOnline: true, HasQueue: true, QueueUpRatio: 0.96, QueueDownRatio: 0.5},
		{ID: "c5", Name: "Rio", PPPoEUsername: "rio", RouterID: "r1", IsOnline: true, HasQueue: true, QueueUpRatio: 0.2, QueueDownRatio: 0.99},
		{ID: "c6", Name: "Dwi", PPPoEUsername: "dwi", RouterID: "r1", IsOnline: true, HasQueue: true, QueueUpRatio: 0.98, QueueDownRatio: 0.98},
	}}
	conds := QueueRule{}.Evaluate(obs, at(0))
	if len(conds) != 3 {
		t.Fatalf("kondisi = %d, want 3", len(conds))
	}

	cEka := conds[0]
	if cEka.Key != "queue:c4" || cEka.Detail["cause"] != "Upload" {
		t.Errorf("Eka = %+v", cEka)
	}
	cRio := conds[1]
	if cRio.Key != "queue:c5" || cRio.Detail["cause"] != "Download" {
		t.Errorf("Rio = %+v", cRio)
	}
	cDwi := conds[2]
	if cDwi.Key != "queue:c6" || cDwi.Detail["cause"] != "Upload dan download" {
		t.Errorf("Dwi = %+v", cDwi)
	}

	if cEka.For != DefaultQueueAfter {
		t.Errorf("For = %s, want default %s", cEka.For, DefaultQueueAfter)
	}
}

func TestDefaultThresholdConfigAndMakeRules(t *testing.T) {
	cfg := DefaultThresholdConfig()
	if cfg.QueueRatio != 0.95 || cfg.CpuPercent != 85 || cfg.OpticalDbm != -25 ||
		cfg.PortErrors != 20 || cfg.PortAfter != time.Minute ||
		cfg.OfflineAfter != DefaultOfflineAfter || cfg.QueueAfter != DefaultQueueAfter || cfg.CpuAfter != DefaultCpuAfter {
		t.Fatalf("default = %+v", cfg)
	}
	rules := MakeRules(cfg)
	want := []string{"offline", "queue", "cpu", "optical", "port", "billing_mismatch"}
	if len(rules) != len(want) {
		t.Fatalf("rules = %d, want %d", len(rules), len(want))
	}
	for i, r := range rules {
		if r.Name() != want[i] {
			t.Errorf("rule %d = %s, want %s", i, r.Name(), want[i])
		}
	}
}

func TestRulesUseDynamicThresholds(t *testing.T) {
	cfg := DefaultThresholdConfig()
	cfg.QueueRatio, cfg.QueueAfter = 0.80, 10*time.Second
	cfg.CpuPercent, cfg.CpuAfter = 70, time.Minute
	cfg.OpticalDbm, cfg.OpticalAfter = -28, 5*time.Second
	cfg.OfflineAfter = 2 * time.Minute
	obs := Observation{
		Routers: []state.Router{{ID: "r1", Active: true, HasResource: true, Resource: state.Resource{CPULoad: 75}}},
		Customers: []state.Customer{
			{ID: "c1", RouterID: "r1", IsOnline: true, HasQueue: true, QueueDownRatio: 0.85},
			{ID: "c2", RouterID: "r1", IsOnline: true, HasOptical: true, OpticalPowerDbm: -26},
			{ID: "c3", RouterID: "r1", IsOnline: true, HasOptical: true, OpticalPowerDbm: -29},
			{ID: "c4", RouterID: "r1", IsOnline: false},
		},
	}
	got := map[string]Condition{}
	for _, r := range MakeRules(cfg) {
		for _, c := range r.Evaluate(obs, at(0)) {
			got[c.Key] = c
		}
	}
	if c, ok := got["queue:c1"]; !ok || c.For != 10*time.Second {
		t.Errorf("queue:c1 = %+v", c)
	}
	if c, ok := got["cpu:r1"]; !ok || c.For != time.Minute {
		t.Errorf("cpu:r1 = %+v", c)
	}
	if _, ok := got["optical:c2"]; ok {
		t.Error("-26 dBm tidak boleh alert pada ambang -28")
	}
	if c, ok := got["optical:c3"]; !ok || c.For != 5*time.Second {
		t.Errorf("optical:c3 = %+v", c)
	}
	if c, ok := got["offline:c4"]; !ok || c.For != 2*time.Minute {
		t.Errorf("offline:c4 = %+v", c)
	}
	// Bawaan: 0.85 dan 75% tidak melewati 0.95 / 85.
	for _, r := range MakeRules(DefaultThresholdConfig()) {
		for _, c := range r.Evaluate(obs, at(0)) {
			if c.Kind == "queue" || c.Kind == "cpu" {
				t.Errorf("bawaan tidak boleh alert: %+v", c)
			}
		}
	}
}
