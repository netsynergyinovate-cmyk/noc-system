package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/wire"
)

type fakeRows struct {
	data [][]any
	i    int
}

func (r *fakeRows) Close()                                       {}
func (r *fakeRows) Err() error                                   { return nil }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return r.data[r.i-1], nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }
func (r *fakeRows) TypeMap() *pgtype.Map                         { return nil }
func (r *fakeRows) Next() bool {
	if r.i >= len(r.data) {
		return false
	}
	r.i++
	return true
}
func (r *fakeRows) Scan(dest ...any) error {
	row := r.data[r.i-1]
	if len(row) != len(dest) {
		return errors.New("jumlah kolom tidak cocok")
	}
	for i, d := range dest {
		v := row[i]
		switch p := d.(type) {
		case *string:
			*p = v.(string)
		case *int:
			*p = v.(int)
		case *int64:
			*p = v.(int64)
		case *float64:
			*p = v.(float64)
		case **float64:
			if v == nil {
				*p = nil
			} else {
				f := v.(float64)
				*p = &f
			}
		case **string:
			if v == nil {
				*p = nil
			} else {
				*p = strPtr(v.(string))
			}
		default:
			return errors.New("tipe tujuan tidak didukung")
		}
	}
	return nil
}

// fakeDB menjawab tiga query dari isi tetap; fail membuatnya gagal.
type fakeDB struct {
	mu     sync.Mutex
	olts   [][]any
	optics [][]any
	pons   [][]any
	alerts [][]any
	fail   bool
}

func (d *fakeDB) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.fail {
		return nil, errors.New("db mati")
	}
	switch {
	case strings.Contains(sql, "FROM olts"):
		return &fakeRows{data: d.olts}, nil
	case strings.Contains(sql, "JOIN olts"):
		return &fakeRows{data: d.pons}, nil
	case strings.Contains(sql, "FROM olt_onus u LEFT JOIN"):
		return &fakeRows{data: d.optics}, nil
	default:
		return &fakeRows{data: d.alerts}, nil
	}
}

type fakeSource struct {
	routers []state.Router
	res     map[string]state.Resource
}

func (s fakeSource) Routers() []state.Router { return append([]state.Router(nil), s.routers...) }
func (s fakeSource) RouterResource(id string) (state.Resource, bool) {
	r, ok := s.res[id]
	return r, ok
}

type recorder struct {
	mu  sync.Mutex
	got []wire.Telemetry
}

func (r *recorder) publish(t wire.Telemetry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.got = append(r.got, t)
}
func (r *recorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.got)
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func newService(src Source, db Querier, rec *recorder) *Service {
	return New(Options{Source: src, DB: db, Logger: quiet(), Publish: rec.publish, PublicTargets: []Target{}})
}

func TestRouterResourceBecomesTelemetry(t *testing.T) {
	src := fakeSource{
		routers: []state.Router{{ID: "r1", Name: "Core", Host: "10.0.0.1", Active: true, Reachable: true}},
		res: map[string]state.Resource{"r1": {
			CPULoad: 12, TotalMemory: 1000, FreeMemory: 250, Uptime: 90 * time.Second, Version: "7.15", Board: "CCR",
		}},
	}
	rec := &recorder{}
	s := newService(src, nil, rec)
	s.refresh(t.Context())

	got := s.Latest().Routers[0]
	if got.CPULoad == nil || *got.CPULoad != 12 || got.MemoryUsage == nil || *got.MemoryUsage != 75 {
		t.Fatalf("cpu/ram salah: %+v", got)
	}
	if got.UptimeSeconds == nil || *got.UptimeSeconds != 90 || got.Version != "7.15" {
		t.Fatalf("uptime/versi salah: %+v", got)
	}
}

func TestRouterWithoutResourceHasNullResource(t *testing.T) {
	src := fakeSource{routers: []state.Router{{ID: "r1", Name: "Core"}}}
	s := newService(src, nil, &recorder{})
	got := s.Latest().Routers[0]
	if got.CPULoad != nil || got.MemoryUsage != nil || got.UptimeSeconds != nil {
		t.Fatalf("resource belum dibaca harus null: %+v", got)
	}
}

func TestPublishesOnlyWhenContentChanges(t *testing.T) {
	src := fakeSource{routers: []state.Router{{ID: "r1", Name: "Core"}}, res: map[string]state.Resource{}}
	rec := &recorder{}
	s := newService(src, nil, rec)

	s.refresh(t.Context())
	s.refresh(t.Context())
	// Pembangunan pertama di New() menyiapkan keadaan awal tanpa publish.
	if rec.count() != 1 {
		t.Fatalf("publish = %d, want 1 (refresh kedua tanpa perubahan)", rec.count())
	}

	src.res["r1"] = state.Resource{CPULoad: 50, TotalMemory: 10}
	s.refresh(t.Context())
	if rec.count() != 2 {
		t.Fatalf("publish = %d, want 2 setelah CPU berubah", rec.count())
	}
}

func TestDatabaseRowsAndFailureKeepsLastGood(t *testing.T) {
	db := &fakeDB{
		olts:   [][]any{{"o1", "HSGQ", "10.0.0.2", "aktif", 8, 30, 40}},
		pons:   [][]any{{"HSGQ", 2, 12, -18.5}, {"HSGQ", 6, 0, nil}},
		optics: [][]any{{"u1", 1, 3, -27.5, "SN1", nil, "Warung Budi", nil, nil, nil}},
		alerts: [][]any{{"a1", "offline", "critical", "", "ODP-1", int64(1700000000), 5}},
	}
	s := newService(fakeSource{}, db, &recorder{})
	s.refresh(t.Context())

	got := s.Latest()
	if !got.DatabaseOK || len(got.Olts) != 1 || got.Olts[0].OnuOnline != 30 || got.Olts[0].PonPortCount != 8 {
		t.Fatalf("OLT salah: %+v", got)
	}
	if o := got.CriticalOptics[0]; o.User != "Warung Budi" || o.Badge != "Critical" || o.Pon != "PON 1 • ONU 3" || o.Odp != "SN: SN1" {
		t.Fatalf("optik salah: %+v", o)
	}
	if len(got.Pons) != 2 || got.Pons[0].PonIndex != 2 || got.Pons[0].OnuOnline != 12 || *got.Pons[0].RxPowerDbm != -18.5 || got.Pons[1].RxPowerDbm != nil {
		t.Fatalf("PON salah: %+v", got.Pons)
	}
	if got.Alerts.Total != 5 || got.Alerts.Items[0].Location != "ODP-1" {
		t.Fatalf("alert salah: %+v", got.Alerts)
	}

	db.mu.Lock()
	db.fail = true
	db.mu.Unlock()
	s.refresh(t.Context())
	got = s.Latest()
	if got.DatabaseOK || len(got.Olts) != 1 {
		t.Fatalf("gagal baca harus menandai databaseOk=false dan mempertahankan data lama: %+v", got)
	}
}

func TestEmptyListsAreArraysNotNull(t *testing.T) {
	s := newService(fakeSource{}, nil, &recorder{})
	got := s.Latest()
	if got.Routers == nil || got.Olts == nil || got.CriticalOptics == nil || got.Alerts.Items == nil || got.Latency.Items == nil {
		t.Fatalf("daftar kosong harus [] bukan null: %+v", got)
	}
}

func TestLatencyMeasuresRoutersOltsAndPublicTargets(t *testing.T) {
	db := &fakeDB{olts: [][]any{{"o1", "HSGQ", "10.0.0.2", "aktif", 0, 0, 0}}}
	var mu sync.Mutex
	dialed := map[string]bool{}
	rec := &recorder{}
	s := New(Options{
		Source: fakeSource{routers: []state.Router{{ID: "r1", Name: "Core", Host: "10.0.0.1"}}},
		DB:     db, Logger: quiet(), Publish: rec.publish,
		PublicTargets: []Target{{Name: "DNS", Addr: "1.1.1.1:53"}},
		Dial: func(_ context.Context, _, addr string) (net.Conn, error) {
			mu.Lock()
			dialed[addr] = true
			mu.Unlock()
			if addr == "10.0.0.2:23" {
				return nil, &net.OpError{Op: "dial", Err: context.DeadlineExceeded}
			}
			c, _ := net.Pipe()
			return c, nil
		},
	})
	s.refresh(t.Context()) // memuat OLT supaya hostnya ikut diukur
	s.measure(t.Context())

	for _, want := range []string{"10.0.0.1:80", "10.0.0.2:23", "1.1.1.1:53"} {
		if !dialed[want] {
			t.Errorf("%s tidak diukur: %v", want, dialed)
		}
	}
	lat := s.Latest().Latency
	if lat.TotalCount != 3 || lat.OnlineCount != 2 || lat.AvgLatencyMs == nil || lat.MeasuredAt == nil {
		t.Fatalf("ringkasan latensi salah: %+v", lat)
	}
	for _, it := range lat.Items {
		if it.Name == "HSGQ" && (it.Status != "timeout" || it.LatencyMs != nil) {
			t.Errorf("OLT timeout harus status timeout tanpa ms: %+v", it)
		}
	}
}

func TestRouterAddrUsesRestPort(t *testing.T) {
	for host, want := range map[string]string{
		"10.0.0.1":           "10.0.0.1:80",
		"10.0.0.1:8080":      "10.0.0.1:8080",
		"https://10.0.0.1":   "10.0.0.1:443",
		"10.0.0.1:443":       "10.0.0.1:443",
		"http://192.168.1.1": "192.168.1.1:80",
	} {
		got, ok := routerAddr(host)
		if !ok || got != want {
			t.Errorf("routerAddr(%q) = %q,%v want %q", host, got, ok, want)
		}
	}
	if _, ok := routerAddr("ftp://x"); ok {
		t.Error("skema ftp harus ditolak")
	}
}

func TestVlanRatesArePublishedImmediatelyAndNullUntilRateKnown(t *testing.T) {
	src := fakeSource{routers: []state.Router{{ID: "r1", Name: "Core"}}}
	rec := &recorder{}
	s := newService(src, nil, rec)

	s.SetVlans("r1", []collector.VlanRate{{Name: "vlan1102", Running: true}, {Name: "vlan1101", Running: true, RateOK: true, DownMbps: 12.5, UpMbps: 1.5}})
	if rec.count() != 1 {
		t.Fatalf("SetVlans harus langsung menyiarkan perubahan, publish = %d", rec.count())
	}
	v := s.Latest().Vlans
	if len(v) != 2 || v[0].Name != "vlan1101" || v[0].DownMbps == nil || *v[0].DownMbps != 12.5 {
		t.Fatalf("VLAN terurut dengan laju: %+v", v)
	}
	if v[1].DownMbps != nil || v[1].UpMbps != nil {
		t.Fatalf("laju belum diketahui harus null: %+v", v[1])
	}
}

func TestConcurrentUpdatesEndWithLatestEqualToLastPublished(t *testing.T) {
	src := fakeSource{routers: []state.Router{{ID: "r1", Name: "Core"}}}
	rec := &recorder{}
	s := newService(src, nil, rec)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				s.SetVlans("r1", []collector.VlanRate{{Name: "vlan1101", RateOK: true, DownMbps: float64(i*100 + j)}})
				s.measure(t.Context())
			}
		}()
	}
	wg.Wait()
	rec.mu.Lock()
	defer rec.mu.Unlock()
	last := rec.got[len(rec.got)-1]
	got, _ := json.Marshal(s.Latest())
	want, _ := json.Marshal(last)
	if string(got) != string(want) {
		t.Fatalf("Latest() berbeda dari publikasi terakhir:\n%s\n%s", got, want)
	}
}

func TestVlanHistoryKeepsLastFiveMinutesInOrderWithoutDuplicates(t *testing.T) {
	s := newService(fakeSource{routers: []state.Router{{ID: "r1", Name: "Core"}}}, nil, &recorder{})
	base := time.Unix(1_000_000, 0)
	for i := 0; i < VlanHistoryPoints+10; i++ {
		rate := collector.VlanRate{Name: "vlan1101", RateOK: true, DownMbps: float64(i), At: base.Add(time.Duration(i) * time.Second)}
		s.SetVlans("r1", []collector.VlanRate{rate})
		s.SetVlans("r1", []collector.VlanRate{rate}) // pesan ulang dengan sampel sama
	}
	s.SetVlans("r1", []collector.VlanRate{{Name: "vlan1102"}}) // belum ada laju: tidak dicatat

	h := s.VlanHistory()
	if len(h) != 1 || h[0].Name != "vlan1101" || len(h[0].Samples) != VlanHistoryPoints {
		t.Fatalf("history = %+v", h)
	}
	if h[0].Samples[0].DownMbps != 10 || h[0].Samples[VlanHistoryPoints-1].DownMbps != float64(VlanHistoryPoints+9) {
		t.Fatalf("jendela salah: %v .. %v", h[0].Samples[0], h[0].Samples[VlanHistoryPoints-1])
	}
}
