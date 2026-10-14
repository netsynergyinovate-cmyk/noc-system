package engine

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

var t0 = time.Unix(1_700_000_000, 0)

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// fakeSource menyediakan keadaan jaringan tetap.
type fakeSource struct {
	routers   []state.Router
	customers []state.Customer
}

func (f *fakeSource) Routers() []state.Router     { return f.routers }
func (f *fakeSource) Customers() []state.Customer { return f.customers }

// scriptedRule mengembalikan kondisi yang diatur test.
type scriptedRule struct {
	name  string
	conds []Condition
	panic bool
}

func (r *scriptedRule) Name() string { return r.name }
func (r *scriptedRule) Evaluate(Observation, time.Time) []Condition {
	if r.panic {
		panic("aturan rusak")
	}
	return r.conds
}

func newEngine(t *testing.T, rules ...Rule) (*Engine, *[]Event) {
	t.Helper()
	var mu sync.Mutex
	received := &[]Event{}
	engine, err := New(Options{
		Logger: quietLogger(),
		Source: &fakeSource{},
		Rules:  rules,
		Sink: func(batch []Event) {
			mu.Lock()
			defer mu.Unlock()
			*received = append(*received, batch...)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return engine, received
}

func cond(key string, forDuration time.Duration) Condition {
	return Condition{Key: key, Kind: "offline", Severity: "warning", CustomerID: "c-" + key, For: forDuration}
}

func at(seconds int) time.Time { return t0.Add(time.Duration(seconds) * time.Second) }

func TestEventsOnlyWhenAConditionStartsOrEnds(t *testing.T) {
	rule := &scriptedRule{name: "uji", conds: []Condition{cond("a", 0)}}
	engine, sink := newEngine(t, rule)

	started := engine.Evaluate(at(0))
	if len(started) != 1 || !started[0].Active || started[0].Key != "a" {
		t.Fatalf("evaluasi pertama = %+v, want satu event mulai", started)
	}

	// Gangguan yang sama berlangsung terus: tidak ada event ulang.
	for second := 1; second <= 5; second++ {
		if events := engine.Evaluate(at(second)); len(events) != 0 {
			t.Fatalf("detik %d: event ulang %+v selama gangguan berlangsung", second, events)
		}
	}

	rule.conds = nil
	ended := engine.Evaluate(at(6))
	if len(ended) != 1 || ended[0].Active {
		t.Fatalf("setelah selesai = %+v, want satu event selesai", ended)
	}
	if ended[0].ID != started[0].ID {
		t.Errorf("ID event selesai %q berbeda dari event mulai %q", ended[0].ID, started[0].ID)
	}
	if ended[0].StartedAt != at(0) || ended[0].Time != at(6) || ended[0].Duration() != 6*time.Second {
		t.Errorf("selesai: StartedAt=%v Time=%v Duration=%v", ended[0].StartedAt, ended[0].Time, ended[0].Duration())
	}

	if events := engine.Evaluate(at(7)); len(events) != 0 {
		t.Errorf("setelah selesai masih ada event: %+v", events)
	}
	if len(*sink) != 2 {
		t.Errorf("Sink menerima %d event, want 2 (mulai dan selesai)", len(*sink))
	}
}

func TestConditionMustHoldForItsDurationBeforeFiring(t *testing.T) {
	rule := &scriptedRule{name: "uji", conds: []Condition{cond("a", 30*time.Second)}}
	engine, _ := newEngine(t, rule)

	for _, second := range []int{0, 10, 29} {
		if events := engine.Evaluate(at(second)); len(events) != 0 {
			t.Fatalf("detik %d: event %+v sebelum 30 detik terpenuhi", second, events)
		}
	}
	if len(engine.Active()) != 0 {
		t.Error("Active() memuat kondisi yang belum memenuhi durasi")
	}
	events := engine.Evaluate(at(30))
	if len(events) != 1 || !events[0].Active || events[0].StartedAt != at(0) {
		t.Fatalf("detik 30 = %+v, want event mulai dengan StartedAt detik 0", events)
	}
}

func TestShortBlipNeverBecomesAnEvent(t *testing.T) {
	rule := &scriptedRule{name: "uji", conds: []Condition{cond("a", 30*time.Second)}}
	engine, sink := newEngine(t, rule)

	engine.Evaluate(at(0))
	engine.Evaluate(at(20))
	rule.conds = nil // pulih sebelum 30 detik
	if events := engine.Evaluate(at(25)); len(events) != 0 {
		t.Errorf("gangguan sesaat menghasilkan event selesai: %+v", events)
	}
	if len(*sink) != 0 {
		t.Errorf("Sink menerima %d event untuk gangguan sesaat, want 0", len(*sink))
	}
}

func TestFlappingConditionRestartsItsClockEachTime(t *testing.T) {
	rule := &scriptedRule{name: "uji"}
	engine, sink := newEngine(t, rule)

	// Hidup 20 detik, mati, hidup 20 detik, mati, ...: tidak pernah mencapai 30 detik.
	for cycle := 0; cycle < 3; cycle++ {
		base := cycle * 21
		rule.conds = []Condition{cond("a", 30*time.Second)}
		engine.Evaluate(at(base))
		engine.Evaluate(at(base + 19))
		rule.conds = nil
		engine.Evaluate(at(base + 20))
	}
	if len(*sink) != 0 {
		t.Fatalf("kondisi yang berkedip menghasilkan %d event, want 0", len(*sink))
	}

	// Setelah bertahan penuh 30 detik, barulah menjadi gangguan, dihitung dari
	// kemunculan terakhir, bukan dari kemunculan pertama.
	rule.conds = []Condition{cond("a", 30*time.Second)}
	engine.Evaluate(at(100))
	if events := engine.Evaluate(at(129)); len(events) != 0 {
		t.Fatalf("detik 129 = %+v, want belum ada event", events)
	}
	if events := engine.Evaluate(at(130)); len(events) != 1 {
		t.Fatalf("detik 130 = %+v, want satu event", events)
	}
}

func TestSinceBackdatesTheStartOfTheCondition(t *testing.T) {
	c := cond("a", 30*time.Second)
	c.Since = at(-45) // sudah 45 detik bermasalah menurut data
	rule := &scriptedRule{name: "uji", conds: []Condition{c}}
	engine, _ := newEngine(t, rule)

	events := engine.Evaluate(at(0))
	if len(events) != 1 || events[0].StartedAt != at(-45) {
		t.Fatalf("events = %+v, want langsung mulai dengan StartedAt = Since", events)
	}
	if events[0].Duration() != 45*time.Second {
		t.Errorf("Duration = %s, want 45s", events[0].Duration())
	}
}

func TestSinceInTheFutureIsClampedToNow(t *testing.T) {
	c := cond("a", 30*time.Second)
	c.Since = at(500) // jam yang tidak cocok tidak boleh menunda gangguan tanpa batas
	rule := &scriptedRule{name: "uji", conds: []Condition{c}}
	engine, _ := newEngine(t, rule)

	engine.Evaluate(at(0))
	if events := engine.Evaluate(at(30)); len(events) != 1 {
		t.Errorf("events = %+v, want satu event 30 detik sejak pertama terlihat", events)
	}
}

func TestEachNewEpisodeGetsItsOwnID(t *testing.T) {
	rule := &scriptedRule{name: "uji", conds: []Condition{cond("a", 0)}}
	engine, _ := newEngine(t, rule)

	first := engine.Evaluate(at(0))[0]
	rule.conds = nil
	engine.Evaluate(at(1))
	rule.conds = []Condition{cond("a", 0)}
	second := engine.Evaluate(at(2))[0]
	if first.ID == second.ID {
		t.Errorf("dua gangguan berbeda memakai ID yang sama: %q", first.ID)
	}
}

func TestIndependentConditionsAreTrackedSeparatelyInStableOrder(t *testing.T) {
	rule := &scriptedRule{name: "uji", conds: []Condition{cond("c", 0), cond("a", 0), cond("b", 0)}}
	engine, _ := newEngine(t, rule)

	events := engine.Evaluate(at(0))
	if len(events) != 3 || events[0].Key != "a" || events[1].Key != "b" || events[2].Key != "c" {
		t.Fatalf("urutan event = %+v, want a, b, c", events)
	}
	rule.conds = []Condition{cond("b", 0)}
	ended := engine.Evaluate(at(1))
	if len(ended) != 2 || ended[0].Key != "a" || ended[1].Key != "c" || ended[0].Active || ended[1].Active {
		t.Fatalf("selesai = %+v, want a dan c selesai, b tetap berjalan", ended)
	}
	if active := engine.Active(); len(active) != 1 || active[0].Key != "b" {
		t.Errorf("Active() = %+v, want hanya b", active)
	}
}

func TestActiveListsOnlyFiringConditionsOldestFirst(t *testing.T) {
	old := cond("lama", 0)
	old.Since = at(-100)
	rule := &scriptedRule{name: "uji", conds: []Condition{cond("baru", 0), old, cond("tertunda", time.Hour)}}
	engine, _ := newEngine(t, rule)
	engine.Evaluate(at(0))

	active := engine.Active()
	if len(active) != 2 || active[0].Key != "lama" || active[1].Key != "baru" {
		t.Errorf("Active() = %+v, want lama lalu baru, tanpa yang tertunda", active)
	}
}

func TestPanickingRuleDoesNotStopOtherRules(t *testing.T) {
	good := &scriptedRule{name: "baik", conds: []Condition{cond("a", 0)}}
	bad := &scriptedRule{name: "rusak", panic: true}
	engine, _ := newEngine(t, bad, good)

	events := engine.Evaluate(at(0))
	if len(events) != 1 || events[0].Key != "a" {
		t.Errorf("events = %+v, want aturan yang baik tetap berjalan", events)
	}
	// Aturan yang rusak tidak boleh menyelesaikan gangguan milik aturan lain.
	if events = engine.Evaluate(at(1)); len(events) != 0 {
		t.Errorf("evaluasi berikutnya = %+v, want tidak ada event", events)
	}
}

func TestConditionWithoutKeyIsIgnored(t *testing.T) {
	rule := &scriptedRule{name: "uji", conds: []Condition{{Kind: "offline"}}}
	engine, _ := newEngine(t, rule)
	if events := engine.Evaluate(at(0)); len(events) != 0 {
		t.Errorf("kondisi tanpa Key menghasilkan event: %+v", events)
	}
}

func TestEventDetailIsCopiedFromTheCondition(t *testing.T) {
	c := cond("a", 0)
	c.Detail = map[string]any{"name": "Budi"}
	rule := &scriptedRule{name: "uji", conds: []Condition{c}}
	engine, _ := newEngine(t, rule)

	event := engine.Evaluate(at(0))[0]
	event.Detail["name"] = "DIUBAH"
	if got := engine.Active()[0].Detail["name"]; got != "Budi" {
		t.Errorf("mengubah Detail event memengaruhi engine: %v", got)
	}
}

func TestNewValidatesOptions(t *testing.T) {
	if _, err := New(Options{Source: &fakeSource{}}); err == nil {
		t.Error("tanpa Logger seharusnya ditolak")
	}
	if _, err := New(Options{Logger: quietLogger()}); err == nil {
		t.Error("tanpa Source seharusnya ditolak")
	}
}

func TestRunEvaluatesPeriodicallyAndStopsOnCancel(t *testing.T) {
	source := &fakeSource{customers: []state.Customer{{ID: "c1", RouterID: "r1", IsOnline: false}}}
	var mu sync.Mutex
	var got []Event
	engine, err := New(Options{
		Logger:   quietLogger(),
		Source:   source,
		Rules:    []Rule{OfflineRule{After: time.Millisecond}},
		Interval: 10 * time.Millisecond,
		Sink: func(batch []Event) {
			mu.Lock()
			defer mu.Unlock()
			got = append(got, batch...)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { engine.Run(ctx); close(done) }()

	deadline := time.Now().Add(3 * time.Second)
	for {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Run tidak pernah mengirim event")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// Dibiarkan berjalan beberapa putaran lagi: tetap hanya satu event mulai.
	time.Sleep(60 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run tidak berhenti setelah ctx dibatalkan")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || !got[0].Active {
		t.Errorf("events = %+v, want tepat satu event mulai meski dievaluasi berkali-kali", got)
	}
}

func TestSinkGetsOneBatchPerEvaluationAndNothingWhenQuiet(t *testing.T) {
	var batches [][]Event
	conds := make([]Condition, 0, 300)
	for i := 0; i < 300; i++ {
		conds = append(conds, cond("k"+string(rune('a'+i%26))+string(rune('a'+i/26)), 0))
	}
	rule := &scriptedRule{name: "uji", conds: conds}
	engine, err := New(Options{
		Logger: quietLogger(),
		Source: &fakeSource{},
		Rules:  []Rule{rule},
		Sink:   func(batch []Event) { batches = append(batches, batch) },
	})
	if err != nil {
		t.Fatal(err)
	}

	engine.Evaluate(at(0)) // 300 gangguan mulai bersamaan, mis. satu router mati
	if len(batches) != 1 || len(batches[0]) != 300 {
		t.Fatalf("batch = %d buah (isi %v), want satu batch berisi 300 event", len(batches), len(batches))
	}
	engine.Evaluate(at(1)) // tidak ada perubahan
	if len(batches) != 1 {
		t.Errorf("Sink dipanggil %d kali, want tidak dipanggil bila tidak ada event", len(batches))
	}
}
