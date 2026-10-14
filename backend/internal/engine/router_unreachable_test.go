package engine

import (
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

func TestRouterUnreachableRuleOnlyFlagsActiveUnreachableRouters(t *testing.T) {
	obs := Observation{Routers: []state.Router{
		{ID: "ok", Name: "Sehat", Active: true, Reachable: true},
		{ID: "mati", Name: "Core CIARA", Host: "10.0.0.1", Active: true, Reachable: false, LastError: "hubungi router: EOF", ConsecutiveFailures: 5, LastOKAt: t0.Add(-5 * time.Minute).Unix()},
		{ID: "off", Name: "Nonaktif", Active: false, Reachable: false}, // sengaja dimatikan: bukan gangguan
	}}
	conds := RouterUnreachableRule{}.Evaluate(obs, t0)
	if len(conds) != 1 {
		t.Fatalf("hanya satu router yang harus ditandai, got %+v", conds)
	}
	c := conds[0]
	if c.Key != "router-unreachable:mati" || c.Kind != "offline" || c.Severity != "critical" || c.RouterID != "mati" || c.CustomerID != "" {
		t.Errorf("kondisi salah: %+v", c)
	}
	if c.For != DefaultRouterUnreachableAfter {
		t.Errorf("For = %s", c.For)
	}
	if !c.Since.Equal(t0.Add(-5 * time.Minute)) {
		t.Errorf("Since harus pembacaan terakhir yang berhasil: %v", c.Since)
	}
	if c.Detail["lastError"] != "hubungi router: EOF" || c.Detail["routerAlert"] != true {
		t.Errorf("detail: %+v", c.Detail)
	}
}

func TestRouterUnreachableHasNoSinceWhenNeverReadable(t *testing.T) {
	conds := RouterUnreachableRule{After: time.Second}.Evaluate(Observation{Routers: []state.Router{
		{ID: "r", Active: true, Reachable: false},
	}}, t0)
	if len(conds) != 1 || !conds[0].Since.IsZero() || conds[0].For != time.Second {
		t.Fatalf("%+v", conds)
	}
}

func TestRouterUnreachableIsPartOfTheDefaultRules(t *testing.T) {
	found := false
	for _, r := range MakeRules(DefaultThresholdConfig()) {
		if r.Name() == "router_unreachable" {
			found = true
		}
	}
	if !found {
		t.Fatal("aturan harus ikut dalam MakeRules")
	}
}

func TestEngineRaisesAndClearsRouterAlert(t *testing.T) {
	mgr := state.NewManager()
	if err := mgr.UpsertRouter(state.Router{ID: "r1", Name: "Core", Active: true}); err != nil {
		t.Fatal(err)
	}
	engine, err := New(Options{
		Logger: quietLogger(),
		Source: mgr,
		Rules:  []Rule{RouterUnreachableRule{After: 10 * time.Second}},
	})
	if err != nil {
		t.Fatal(err)
	}
	mgr.SetRouterReachability("r1", false, "hubungi router: EOF", t0.Unix())
	if ev := engine.Evaluate(at(0)); len(ev) != 0 {
		t.Fatalf("belum melewati For: %+v", ev)
	}
	ev := engine.Evaluate(at(11))
	if len(ev) != 1 || !ev[0].Active || ev[0].RouterID != "r1" || ev[0].CustomerID != "" || ev[0].Kind != "offline" {
		t.Fatalf("harus ada event mulai tingkat router: %+v", ev)
	}
	mgr.SetRouterReachability("r1", true, "", at(20).Unix())
	ev = engine.Evaluate(at(21))
	if len(ev) != 1 || ev[0].Active {
		t.Fatalf("pulih harus menutup gangguan: %+v", ev)
	}
}
