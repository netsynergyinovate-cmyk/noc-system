package engine

import (
	"context"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"sync"
	"time"

	"noc-isp/backend/internal/state"
)

// Source adalah bagian state.Manager yang dibaca aturan.
type Source interface {
	Routers() []state.Router
	Customers() []state.Customer
}

// Observation adalah salinan keadaan jaringan pada satu putaran evaluasi.
type Observation struct {
	Routers   []state.Router
	Customers []state.Customer
}

// Condition menyatakan "sesuatu sedang bermasalah" pada satu subjek. Aturan
// mengembalikan semua kondisi yang benar saat ini; Engine yang memutuskan kapan
// itu menjadi event.
type Condition struct {
	// Key harus unik dan stabil untuk satu subjek dan satu aturan, mis.
	// "offline:<id pelanggan>". Kondisi yang sama pada evaluasi berikutnya
	// dikenali dari Key ini.
	Key        string
	Kind       string // queue, cpu, optical, offline, port
	Severity   string // info, warning, critical
	RouterID   string
	CustomerID string
	Detail     map[string]any

	// For adalah berapa lama kondisi harus terus benar sebelum dianggap
	// gangguan. Gangguan yang hilang sebelum itu tidak pernah menjadi event.
	For time.Duration
	// Since, bila diisi, adalah kapan kondisi mulai benar menurut data (mis.
	// kapan pelanggan putus), bukan kapan engine pertama melihatnya. Dengan
	// ini hitungan durasi tetap benar setelah backend dinyalakan ulang.
	Since time.Time
}

// Rule menghasilkan kondisi yang sedang benar pada suatu saat.
type Rule interface {
	Name() string
	Evaluate(obs Observation, now time.Time) []Condition
}

// Event adalah satu perubahan status gangguan: mulai (Active) atau selesai.
// Engine tidak mengirim event lagi selama gangguan masih berlangsung.
type Event struct {
	// ID sama untuk event mulai dan event selesai milik satu gangguan.
	ID         string
	Key        string
	Kind       string
	Severity   string
	Active     bool
	RouterID   string
	CustomerID string
	// Time adalah saat perubahan ini (mulai atau selesai); StartedAt adalah
	// saat gangguan dimulai.
	Time      time.Time
	StartedAt time.Time
	Detail    map[string]any
}

// Duration adalah lama gangguan; untuk gangguan yang masih aktif, sampai Time.
func (e Event) Duration() time.Duration { return e.Time.Sub(e.StartedAt) }

// Sink menerima semua event dari satu putaran evaluasi sekaligus, tidak satu per
// satu: saat satu router mati dan ratusan pelanggan menjadi gangguan pada detik
// yang sama, penerima mendapat satu daftar, bukan banjir pesan. Tidak dipanggil
// bila tidak ada event. Dipanggil dari goroutine Engine tanpa mengunci Engine,
// jadi boleh agak lambat tetapi jangan memblokir selamanya.
type Sink func([]Event)

// Options mengatur Engine. Logger dan Source wajib diisi.
type Options struct {
	Logger *slog.Logger
	Source Source
	Rules  []Rule
	Sink   Sink
	// Interval antar evaluasi; default 1 detik.
	Interval time.Duration
	Now      func() time.Time
}

type tracked struct {
	cond      Condition
	startedAt time.Time // saat gangguan dimulai (Since, atau pertama kali terlihat)
	firing    bool
	eventID   string
}

// Engine membandingkan kondisi tiap evaluasi dengan evaluasi sebelumnya dan
// hanya mengeluarkan event saat sebuah gangguan mulai atau selesai.
type Engine struct {
	opts Options

	mu      sync.Mutex
	tracked map[string]*tracked
	counter uint64
}

// New membuat Engine. Panggil Run, atau Evaluate langsung (untuk test).
func New(opts Options) (*Engine, error) {
	if opts.Logger == nil || opts.Source == nil {
		return nil, fmt.Errorf("engine: Logger dan Source wajib diisi")
	}
	if opts.Interval <= 0 {
		opts.Interval = time.Second
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Engine{opts: opts, tracked: make(map[string]*tracked)}, nil
}

// Run mengevaluasi tiap Interval sampai ctx dibatalkan.
func (e *Engine) Run(ctx context.Context) {
	ticker := time.NewTicker(e.opts.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.Evaluate(e.opts.Now())
		}
	}
}

// Evaluate menjalankan semua aturan pada waktu now dan mengirim event yang
// timbul ke Sink. Aman dipanggil dari satu goroutine pada satu waktu.
func (e *Engine) Evaluate(now time.Time) []Event {
	obs := Observation{Routers: e.opts.Source.Routers(), Customers: e.opts.Source.Customers()}

	current := make(map[string]Condition)
	for _, rule := range e.opts.Rules {
		for _, cond := range e.runRule(rule, obs, now) {
			if cond.Key == "" {
				e.opts.Logger.Error("aturan menghasilkan kondisi tanpa Key", "rule", rule.Name())
				continue
			}
			current[cond.Key] = cond
		}
	}

	events := e.advance(current, now)
	if e.opts.Sink != nil && len(events) > 0 {
		e.opts.Sink(events)
	}
	return events
}

// runRule menjalankan satu aturan; aturan yang panik tidak boleh menghentikan
// aturan lain atau engine.
func (e *Engine) runRule(rule Rule, obs Observation, now time.Time) (conds []Condition) {
	defer func() {
		if r := recover(); r != nil {
			e.opts.Logger.Error("aturan panik, dilewati pada putaran ini", "rule", rule.Name(), "panic", fmt.Sprint(r))
			conds = nil
		}
	}()
	return rule.Evaluate(obs, now)
}

// advance memperbarui kondisi yang dilacak dan mengembalikan event yang timbul.
func (e *Engine) advance(current map[string]Condition, now time.Time) []Event {
	e.mu.Lock()
	defer e.mu.Unlock()

	var events []Event
	// Urutan kunci tetap supaya event pada putaran yang sama berurutan.
	for _, key := range slices.Sorted(maps.Keys(current)) {
		cond := current[key]
		t, known := e.tracked[key]
		if !known {
			started := cond.Since
			if started.IsZero() || started.After(now) {
				started = now
			}
			t = &tracked{startedAt: started}
			e.tracked[key] = t
		}
		t.cond = cond
		if !t.firing && now.Sub(t.startedAt) >= cond.For {
			t.firing = true
			e.counter++
			t.eventID = fmt.Sprintf("%s#%d", key, e.counter)
			events = append(events, t.event(now, true))
			e.opts.Logger.Info("gangguan mulai", "kind", cond.Kind, "key", key, "severity", cond.Severity)
		}
	}

	for _, key := range slices.Sorted(maps.Keys(e.tracked)) {
		if _, still := current[key]; still {
			continue
		}
		t := e.tracked[key]
		delete(e.tracked, key)
		if t.firing {
			events = append(events, t.event(now, false))
			e.opts.Logger.Info("gangguan selesai", "kind", t.cond.Kind, "key", key, "lama", now.Sub(t.startedAt).Round(time.Second).String())
		}
		// Kondisi yang hilang sebelum For terpenuhi dibuang tanpa event.
	}
	return events
}

func (t *tracked) event(now time.Time, active bool) Event {
	return Event{
		ID:         t.eventID,
		Key:        t.cond.Key,
		Kind:       t.cond.Kind,
		Severity:   t.cond.Severity,
		Active:     active,
		RouterID:   t.cond.RouterID,
		CustomerID: t.cond.CustomerID,
		Time:       now,
		StartedAt:  t.startedAt,
		Detail:     maps.Clone(t.cond.Detail),
	}
}

// Active mengembalikan gangguan yang sedang berlangsung (yang sudah menjadi
// event), terlama lebih dulu.
func (e *Engine) Active() []Event {
	now := e.opts.Now()
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []Event
	for _, t := range e.tracked {
		if t.firing {
			out = append(out, t.event(now, true))
		}
	}
	slices.SortFunc(out, func(a, b Event) int {
		if c := a.StartedAt.Compare(b.StartedAt); c != 0 {
			return c
		}
		return compareStrings(a.Key, b.Key)
	})
	return out
}

func compareStrings(a, b string) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}
