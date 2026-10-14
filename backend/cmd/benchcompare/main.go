// Command benchcompare mengukur latensi padanan Go untuk uji banding stack
// lokal: collector (REST MikroTik simulator), rule engine, dan penyajian
// traffic. Hasil berupa JSON di stdout; dipanggil oleh
// scripts/run-benchmark-comparison.mjs. Bukan bagian layanan produksi.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/engine"
	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/wire"
)

const (
	routerCount   = 3
	customerCount = 100
	batchHTTP     = 20
	batchLocal    = 200
)

type source struct{ mgr *state.Manager }

func (s source) Routers() []state.Router     { return s.mgr.Routers() }
func (s source) Customers() []state.Customer { return s.mgr.Customers() }

func main() {
	base := flag.String("url", "http://127.0.0.1:8081", "URL simulator MikroTik")
	n := flag.Int("n", 50, "jumlah iterasi terukur")
	warmup := flag.Int("warmup", 5, "iterasi pemanasan (tidak dihitung)")
	flag.Parse()
	if err := run(*base, *n, *warmup); err != nil {
		fmt.Fprintln(os.Stderr, "benchcompare:", err)
		os.Exit(1)
	}
}

func run(base string, n, warmup int) error {
	if n < 1 || warmup < 0 {
		return fmt.Errorf("n harus >= 1 dan warmup >= 0")
	}
	client, err := collector.NewClient(collector.Target{
		RouterID: "bench", BaseURL: base, Username: "admin", Password: "admin",
	}, &http.Client{Timeout: 5 * time.Second})
	if err != nil {
		return err
	}
	mgr, err := buildState()
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	now := time.Unix(1_700_000_000, 0)

	doCollect := func() error { return collect(client, base) }
	newEngine := func() (*engine.Engine, error) {
		return engine.New(engine.Options{
			Logger: logger,
			Source: source{mgr},
			Rules:  []engine.Rule{engine.CpuRule{}, engine.QueueRule{}, engine.OfflineRule{}},
		})
	}
	doTraffic := func() { _ = wire.NewTrafficSeries(mgr.TrafficSeries()) }

	// Jam Windows kasar (~0,5 ms), jadi satu sampel = rata-rata `reps` panggilan
	// berurutan. `setup` menyiapkan `reps` engine di luar pengukuran: Evaluate
	// kedua pada engine yang sama hanya membandingkan dengan evaluasi lalu.
	type fn func(i int) error
	measure := func(reps int, setup func(int) error, f fn) ([]float64, error) {
		sample := func() (float64, error) {
			if setup != nil {
				if err := setup(reps); err != nil {
					return 0, err
				}
			}
			start := time.Now()
			for i := 0; i < reps; i++ {
				if err := f(i); err != nil {
					return 0, err
				}
			}
			return ms(time.Since(start)) / float64(reps), nil
		}
		for i := 0; i < warmup; i++ {
			if _, err := sample(); err != nil {
				return nil, err
			}
		}
		out := make([]float64, 0, n)
		for i := 0; i < n; i++ {
			v, err := sample()
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	}

	var engines []*engine.Engine
	prepEngines := func(k int) error {
		engines = engines[:0]
		for i := 0; i < k; i++ {
			e, err := newEngine()
			if err != nil {
				return err
			}
			engines = append(engines, e)
		}
		return nil
	}
	evalStep := func(i int) error { engines[i].Evaluate(now); return nil }

	collectMs, err := measure(batchHTTP, nil, func(int) error { return doCollect() })
	if err != nil {
		return err
	}
	evalMs, err := measure(batchLocal, prepEngines, evalStep)
	if err != nil {
		return err
	}
	trafficMs, err := measure(batchLocal, nil, func(int) error { doTraffic(); return nil })
	if err != nil {
		return err
	}
	pipelineMs, err := measure(batchHTTP, prepEngines, func(i int) error {
		if err := doCollect(); err != nil {
			return err
		}
		engines[i].Evaluate(now)
		doTraffic()
		return nil
	})
	if err != nil {
		return err
	}
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return json.NewEncoder(os.Stdout).Encode(map[string]any{
		"goVersion": runtime.Version(),
		"collector": collectMs,
		"eval":      evalMs,
		"traffic":   trafficMs,
		"pipeline":  pipelineMs,
		"memory": map[string]uint64{
			"sysBytes":       m.Sys,
			"heapAllocBytes": m.HeapAlloc,
		},
	})
}

func ms(d time.Duration) float64 { return float64(d.Nanoseconds()) / 1e6 }

// collect meniru collector Node: dua GET paralel (resource dan queue).
func collect(c *collector.Client, base string) error {
	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, errs[0] = c.Queues(context.Background())
	}()
	go func() {
		defer wg.Done()
		errs[1] = getResource(base)
	}()
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

// getResource membaca /rest/system/resource apa adanya: simulator mengirim
// angka JSON, sedangkan RouterOS asli mengirim string, jadi klien produksi
// (Client.Resource) tidak dipakai di sini.
func getResource(base string) error {
	req, err := http.NewRequest(http.MethodGet, base+"/rest/system/resource", nil)
	if err != nil {
		return err
	}
	req.SetBasicAuth("admin", "admin")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("simulator menjawab %d", resp.StatusCode)
	}
	var out map[string]any
	return json.NewDecoder(resp.Body).Decode(&out)
}

// buildState menyiapkan 3 router, 100 pelanggan, dan satu jendela traffic penuh
// secara deterministik.
func buildState() (*state.Manager, error) {
	t0 := time.Unix(1_700_000_000, 0)
	mgr := state.NewManager(state.WithClock(func() time.Time { return t0 }))
	for r := 0; r < routerCount; r++ {
		id := fmt.Sprintf("router-%d", r+1)
		if err := mgr.UpsertRouter(state.Router{ID: id, Name: id, Host: fmt.Sprintf("10.10.0.%d", r+1), Active: true}); err != nil {
			return nil, err
		}
		if err := mgr.SetRouterResource(id, state.Resource{CPULoad: 40 + r*25, TotalMemory: 1 << 30, FreeMemory: 1 << 29, At: t0}); err != nil {
			return nil, err
		}
		for s := 0; s < state.TrafficWindow; s++ {
			p := state.TrafficPoint{Time: t0.Unix() + int64(s), RxMbps: float64(100 + (s*7+r)%50), TxMbps: float64(20 + (s*3+r)%15)}
			if _, err := mgr.RecordTraffic(id, p); err != nil {
				return nil, err
			}
		}
	}
	for i := 0; i < customerCount; i++ {
		c := state.Customer{
			ID:             fmt.Sprintf("c-%d", i),
			Name:           fmt.Sprintf("Pelanggan %d", i),
			PPPoEUsername:  fmt.Sprintf("user-%d", i),
			RouterID:       fmt.Sprintf("router-%d", i%routerCount+1),
			IsOnline:       i%11 != 0,
			StatusSince:    t0.Add(-time.Hour),
			HasQueue:       true,
			QueueUpRatio:   float64(i%20) / 20,
			QueueDownRatio: float64((i*3)%20) / 20,
		}
		if err := mgr.UpsertCustomer(c); err != nil {
			return nil, err
		}
	}
	return mgr, nil
}
