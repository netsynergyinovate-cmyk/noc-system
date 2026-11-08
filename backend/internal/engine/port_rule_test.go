package engine

import (
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

func portObservation(at time.Time, errors uint64) Observation {
	return Observation{
		Routers: []state.Router{{ID: "r1", Name: "RTR-1", Host: "10.0.0.1", Active: true}},
		Interfaces: map[string]InterfaceSample{
			"r1": {
				At: at,
				Interfaces: []state.Interface{
					{Name: "ether1-wan", Type: "ether", Running: true, RxError: errors},
					{Name: "ether2-lan", Type: "ether", Running: true}, // tidak ada error
					// Interface virtual ikut menaikkan penghitung karena enkapsulasi;
					// bukan kerusakan port dan tidak boleh menjadi alert.
					{Name: "wg0", Type: "wg", Running: true, RxError: errors},
				},
			},
		},
	}
}

func TestPortRuleNeedsTwoSamplesBeforeFiring(t *testing.T) {
	rule := &PortRule{ThresholdErrors: 20, After: time.Minute}
	if conds := rule.Evaluate(portObservation(t0, 0), t0); len(conds) != 0 {
		t.Fatalf("sampel pertama tidak boleh langsung menjadi gangguan: %+v", conds)
	}

	at := t0.Add(10 * time.Second)
	conds := rule.Evaluate(portObservation(at, 5), at)
	if len(conds) != 1 {
		t.Fatalf("kenaikan 5 error / 10 detik = 30/menit harus terdeteksi, dapat %+v", conds)
	}
	c := conds[0]
	if c.Key != "port:r1:ether1-wan" || c.Kind != "port" || c.RouterID != "r1" {
		t.Errorf("kondisi salah: %+v", c)
	}
	if got := c.Detail["interface"]; got != "ether1-wan" {
		t.Errorf("detail interface = %v, want ether1-wan", got)
	}
	if got := c.Detail["errorsPerMinute"]; got != float64(30) {
		t.Errorf("detail errorsPerMinute = %v, want 30", got)
	}
}

func TestPortRuleKeepsConditionBetweenInterfaceSamples(t *testing.T) {
	rule := &PortRule{ThresholdErrors: 20, After: time.Minute}
	at := t0.Add(10 * time.Second)
	rule.Evaluate(portObservation(t0, 0), t0)
	rule.Evaluate(portObservation(at, 5), at)

	// Engine mengevaluasi tiap detik; sampel interface belum berubah. Kondisi
	// harus tetap ada supaya syarat "selama 1 menit" bisa tercapai.
	if conds := rule.Evaluate(portObservation(at, 5), at.Add(time.Second)); len(conds) != 1 {
		t.Fatalf("kondisi harus bertahan di antara sampel, dapat %+v", conds)
	}
}

func TestPortRuleIgnoresStaleSamplesAndCounterResets(t *testing.T) {
	if conds := (&PortRule{ThresholdErrors: 20}).Evaluate(portObservation(t0, 0), t0.Add(2*time.Minute)); len(conds) != 0 {
		t.Errorf("sampel basi tidak boleh dipakai: %+v", conds)
	}

	rule := &PortRule{ThresholdErrors: 20}
	rule.Evaluate(portObservation(t0, 100), t0)
	// Router reboot: penghitung kembali ke 1, bukan kenaikan 1 - 100.
	if conds := rule.Evaluate(portObservation(t0.Add(10*time.Second), 1), t0.Add(10*time.Second)); len(conds) != 0 {
		t.Errorf("counter yang turun bukan error baru: %+v", conds)
	}
}

// portSource adalah Source yang juga menyediakan sampel interface, seperti
// state.Manager di produksi.
type portSource struct {
	interfaces []state.Interface
	at         time.Time
}

func (s *portSource) Routers() []state.Router {
	return []state.Router{{ID: "r1", Name: "RTR-1", Host: "10.0.0.1", Active: true}}
}
func (s *portSource) Customers() []state.Customer { return nil }
func (s *portSource) RouterInterfaces(string) ([]state.Interface, time.Time, bool) {
	return s.interfaces, s.at, !s.at.IsZero()
}

func TestEngineReadsRealInterfaceSamplesAndFiresAfterDuration(t *testing.T) {
	src := &portSource{}
	engine, err := New(Options{
		Logger: quietLogger(),
		Source: src,
		Rules:  []Rule{&PortRule{ThresholdErrors: 20, After: time.Minute}},
	})
	if err != nil {
		t.Fatal(err)
	}

	src.interfaces = []state.Interface{{Name: "ether1-wan", Running: true}}
	src.at = t0
	if events := engine.Evaluate(t0); len(events) != 0 {
		t.Fatalf("sampel pertama tidak boleh menjadi event: %+v", events)
	}

	src.interfaces = []state.Interface{{Name: "ether1-wan", Running: true, RxError: 5}}
	src.at = t0.Add(10 * time.Second)
	if events := engine.Evaluate(src.at); len(events) != 0 {
		t.Fatalf("gangguan belum boleh mulai sebelum 1 menit: %+v", events)
	}

	// Sampel yang sama masih segar (10 detik lalu); kondisi harus bertahan
	// sampai durasi For terpenuhi.
	events := engine.Evaluate(t0.Add(70 * time.Second))
	if len(events) != 1 || !events[0].Active || events[0].Kind != "port" {
		t.Fatalf("event mulai port setelah 1 menit = %+v", events)
	}
}
