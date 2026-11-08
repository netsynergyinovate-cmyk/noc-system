package diagnostics

import (
	"testing"
	"time"
)

func f(layer Layer, metric string, status Status) Finding {
	return Finding{Layer: layer, Metric: metric, Label: metric, Status: status}
}

func TestDecideVerdictNoFindingsAndBlindLayers(t *testing.T) {
	v := DecideVerdict(nil, ScopeEvidence{WindowMinutes: 5}, nil, time.Now())
	if v.Layer != nil || v.Scope != "unknown" {
		t.Fatalf("verdict kosong = %+v", v)
	}
	if v.Detail == "" {
		t.Fatal("detail tidak boleh kosong")
	}
}

func TestDecideVerdictHierarchyAndSharedScope(t *testing.T) {
	findings := []Finding{
		f(LayerAktif, "ping", StatusWarn),
		f(LayerOptik, "rx", StatusFail),
		f(LayerMikrotik, "queue", StatusFail),
	}
	ev := ScopeEvidence{
		Router: &ScopeCount{Name: "RTR-1", Affected: 10, Served: 20},
		PON:    &ScopeCount{Name: "1/2", Affected: 8, Served: 20},
	}
	v := DecideVerdict(findings, ev, nil, time.Now())
	if v.Layer == nil || *v.Layer != LayerOptik {
		t.Fatalf("lapisan terpilih = %v, want optik", v.Layer)
	}
	if v.Scope != "shared" || v.Root == nil || v.Root.Kind != "odp" {
		t.Fatalf("scope/root = %+v", v)
	}
	if len(v.Secondary) == 0 {
		t.Fatal("temuan sekunder harus ada")
	}
}

func TestDecideVerdictBillingFailIsOwn(t *testing.T) {
	v := DecideVerdict([]Finding{f(LayerBilling, "status", StatusFail)}, ScopeEvidence{
		Router: &ScopeCount{Name: "RTR", Affected: 20, Served: 20},
	}, nil, time.Now())
	if v.Scope != "own" || v.Root == nil || v.Root.Kind != "customer" {
		t.Fatalf("billing fail harus own/customer: %+v", v)
	}
}

func TestDecideVerdictHoldsPreviousWithinWindow(t *testing.T) {
	prevLayer := string(LayerMikrotik)
	finished := time.Now().Add(-2 * time.Minute)
	v := DecideVerdict([]Finding{
		f(LayerOptik, "rx", StatusWarn),
		f(LayerMikrotik, "queue", StatusWarn),
	}, ScopeEvidence{}, &PreviousVerdict{
		Layer: &prevLayer, FinishedAt: &finished,
	}, time.Now())
	if !v.Held || v.Layer == nil || *v.Layer != LayerMikrotik {
		t.Fatalf("verdict harus ditahan di mikrotik: %+v", v)
	}
}

func TestAddressContains(t *testing.T) {
	cases := []struct {
		entry, ip string
		want      bool
	}{
		{"172.16.15.229", "172.16.15.229", true},
		{"172.16.15.0/24", "172.16.15.229", true},
		{"172.16.15.0/24", "172.16.16.1", false},
		{"172.16.15.1-172.16.15.50", "172.16.15.20", true},
		{"172.16.15.1-172.16.15.50", "172.16.15.60", false},
		{"", "172.16.15.1", false},
	}
	for _, c := range cases {
		if got := addressContains(c.entry, c.ip); got != c.want {
			t.Errorf("addressContains(%q,%q)=%v want %v", c.entry, c.ip, got, c.want)
		}
	}
}

func TestMikrotikQueueHelpers(t *testing.T) {
	rows := []map[string]any{{
		"name": "<pppoe-budi>", "max-limit": "10000000/20000000", "rate": "1000000/2000000",
	}}
	q := findQueue(rows, "budi")
	if q == nil || mStr(q, "max-limit") != "10000000/20000000" {
		t.Fatalf("findQueue = %+v", q)
	}
	first := []map[string]any{{"dropped": "1/2", "packets": "10/20"}}
	second := []map[string]any{{"dropped": "2/5", "packets": "15/30"}}
	if up, down := pairDelta(first, second, "dropped"); up != 1 || down != 3 {
		t.Fatalf("pairDelta dropped = %v/%v", up, down)
	}
	if up, down := pairDelta(first, second, "packets"); up != 5 || down != 10 {
		t.Fatalf("pairDelta packets = %v/%v", up, down)
	}
}

func TestPingStatsAndRate(t *testing.T) {
	loss, avg, ok := pingStats([]map[string]any{
		{"packet-loss": "0", "avg-rtt": "25ms169us"},
	})
	if !ok || loss != 0 || avg < 25 || avg > 26 {
		t.Fatalf("pingStats = %v %v %v", loss, avg, ok)
	}
	if got := parseRateMbps("1Gbps"); got != 1000 {
		t.Fatalf("parseRateMbps = %v", got)
	}
}
