package collector

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"noc-isp/backend/internal/state"
)

// fakeRows meniru pgx.Rows; Scan menyalin nilai ke tujuan bertipe string,
// bool, *string, *float64 (nil berarti NULL).
type fakeRows struct {
	data [][]any
	i    int
	err  error
}

func (r *fakeRows) Close()                                       {}
func (r *fakeRows) Err() error                                   { return r.err }
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
		case *bool:
			*p = v.(bool)
		case **string:
			if v == nil {
				*p = nil
			} else {
				s := v.(string)
				*p = &s
			}
		case **float64:
			if v == nil {
				*p = nil
			} else {
				f := v.(float64)
				*p = &f
			}
		case **bool:
			if v == nil {
				*p = nil
			} else {
				b := v.(bool)
				*p = &b
			}
		default:
			return errors.New("tipe tujuan tidak didukung")
		}
	}
	return nil
}

type fakeQuerier struct {
	routers, customers [][]any
	err                error
	calls              int
}

func (q *fakeQuerier) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	q.calls++
	if q.err != nil {
		return nil, q.err
	}
	if strings.Contains(sql, "FROM routers") {
		return &fakeRows{data: q.routers}, nil
	}
	return &fakeRows{data: q.customers}, nil
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func sampleQuerier() *fakeQuerier {
	return &fakeQuerier{
		routers: [][]any{{"r1", "RTR-1", "10.0.0.1", "aktif"}},
		customers: [][]any{
			// lengkap
			{"c1", "Budi", "budi", "r1", "Jl. A", "ODP-1", "lunas", -20.5, true, -6.2, 106.8, true},
			// semua kolom nullable kosong
			{"c2", "Dewi", "dewi", "r1", nil, nil, "isolir", nil, false, nil, nil, nil},
			// tanpa router: dilewati
			{"c3", "Eko", "eko", nil, nil, nil, "lunas", nil, false, nil, nil, nil},
		},
	}
}

func TestLoadRouters(t *testing.T) {
	rs, err := LoadRouters(context.Background(), sampleQuerier())
	if err != nil {
		t.Fatal(err)
	}
	if len(rs) != 1 || rs[0].ID != "r1" || rs[0].Name != "RTR-1" || rs[0].Host != "10.0.0.1" || !rs[0].Active {
		t.Fatalf("router salah: %+v", rs)
	}
}

func TestLoadCustomersNullable(t *testing.T) {
	cs, err := LoadCustomers(context.Background(), sampleQuerier())
	if err != nil {
		t.Fatal(err)
	}
	if len(cs) != 2 {
		t.Fatalf("pelanggan tanpa router harus dilewati, dapat %d", len(cs))
	}
	full, empty := cs[0], cs[1]
	if full.Address != "Jl. A" || full.ODPName != "ODP-1" || !full.HasOptical || full.OpticalPowerDbm != -20.5 ||
		!full.HasLocation || full.Latitude != -6.2 || full.Longitude != 106.8 || !full.IsOnline || full.RouterID != "r1" {
		t.Fatalf("pelanggan lengkap salah: %+v", full)
	}
	if empty.Address != "" || empty.ODPName != "" || empty.HasOptical || empty.HasLocation ||
		empty.IsOnline || empty.BillingStatus != "isolir" {
		t.Fatalf("NULL harus jadi nilai nol: %+v", empty)
	}
	if full.IsolirRouter == nil || !*full.IsolirRouter {
		t.Fatalf("isolir_router lengkap salah: %+v", full.IsolirRouter)
	}
	if empty.IsolirRouter != nil {
		t.Fatalf("NULL isolir_router harus nil: %+v", empty.IsolirRouter)
	}
}

func TestLoadErrors(t *testing.T) {
	q := &fakeQuerier{err: errors.New("db mati")}
	if _, err := LoadRouters(context.Background(), q); err == nil {
		t.Fatal("error router harus dikembalikan")
	}
	if _, err := LoadCustomers(context.Background(), q); err == nil {
		t.Fatal("error pelanggan harus dikembalikan")
	}
	if _, _, err := SyncDatabaseState(context.Background(), q, state.NewManager(), quiet()); err == nil {
		t.Fatal("error sinkron harus dikembalikan")
	}
}

func TestSyncDatabaseStateFillsManager(t *testing.T) {
	mgr := state.NewManager()
	nR, nC, err := SyncDatabaseState(context.Background(), sampleQuerier(), mgr, quiet())
	if err != nil || nR != 1 || nC != 2 {
		t.Fatalf("nR=%d nC=%d err=%v", nR, nC, err)
	}
	snap := mgr.Snapshot()
	if len(snap.Routers) != 1 || len(snap.Customers) != 2 {
		t.Fatalf("snapshot: %d router, %d pelanggan", len(snap.Routers), len(snap.Customers))
	}
	if c, ok := mgr.CustomerByPPPoE("budi"); !ok || c.ID != "c1" || !c.IsOnline {
		t.Fatalf("budi tidak termuat: %+v", c)
	}
	// Sinkron ulang tidak menggandakan data.
	if nR, nC, err = SyncDatabaseState(context.Background(), sampleQuerier(), mgr, quiet()); err != nil || nR != 1 || nC != 2 {
		t.Fatalf("sinkron ulang: %d %d %v", nR, nC, err)
	}
	if got := len(mgr.Snapshot().Customers); got != 2 {
		t.Fatalf("pelanggan menggandakan: %d", got)
	}
}

// Router yang dihapus (atau tidak lagi 'aktif') dibuang dari Manager beserta pelanggannya, tanpa menyentuh router lain.
func TestSyncDatabaseStateRemovesRoutersGoneFromDatabase(t *testing.T) {
	mgr := state.NewManager()
	two := &fakeQuerier{
		routers: [][]any{{"r1", "RTR-1", "10.0.0.1", "aktif"}, {"r2", "RTR-2", "10.0.0.2", "aktif"}},
		customers: [][]any{
			{"c1", "Budi", "budi", "r1", nil, nil, "lunas", nil, true, nil, nil, nil},
			{"c2", "Dewi", "dewi", "r2", nil, nil, "lunas", nil, true, nil, nil, nil},
		},
	}
	if _, _, err := SyncDatabaseState(context.Background(), two, mgr, quiet()); err != nil {
		t.Fatal(err)
	}
	one := &fakeQuerier{
		routers:   [][]any{{"r1", "RTR-1", "10.0.0.1", "aktif"}},
		customers: [][]any{{"c1", "Budi", "budi", "r1", nil, nil, "lunas", nil, true, nil, nil, nil}},
	}
	if _, _, err := SyncDatabaseState(context.Background(), one, mgr, quiet()); err != nil {
		t.Fatal(err)
	}
	snap := mgr.Snapshot()
	if len(snap.Routers) != 1 || snap.Routers[0].ID != "r1" || len(snap.Customers) != 1 {
		t.Fatalf("r2 dan pelanggannya harus hilang: %d router, %d pelanggan", len(snap.Routers), len(snap.Customers))
	}
	if _, ok := mgr.CustomerByPPPoE("dewi"); ok {
		t.Fatal("indeks PPPoE pelanggan r2 harus ikut terhapus")
	}
	// Kueri gagal tidak boleh dianggap "semua router dihapus".
	if _, _, err := SyncDatabaseState(context.Background(), &fakeQuerier{err: errors.New("db mati")}, mgr, quiet()); err == nil {
		t.Fatal("galat harus dikembalikan")
	}
	if len(mgr.Snapshot().Routers) != 1 {
		t.Fatal("galat kueri tidak boleh mengosongkan Manager")
	}
}

func TestStartDatabaseWatcher(t *testing.T) {
	q := sampleQuerier()
	mgr := state.NewManager()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		StartDatabaseWatcher(ctx, q, mgr, 5*time.Millisecond, quiet())
		close(done)
	}()
	deadline := time.After(2 * time.Second)
	for len(mgr.Snapshot().Customers) != 2 {
		select {
		case <-deadline:
			t.Fatal("watcher tidak mengisi Manager")
		case <-time.After(5 * time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("watcher tidak berhenti saat ctx selesai")
	}
}
