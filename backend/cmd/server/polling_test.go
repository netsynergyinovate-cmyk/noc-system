package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"noc-isp/backend/internal/state"
)

type fakeDB struct {
	calls []dbCall
	err   error
}

type dbCall struct {
	sql  string
	args []any
}

func (f *fakeDB) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	f.calls = append(f.calls, dbCall{sql: sql, args: arguments})
	if f.err != nil {
		return pgconn.CommandTag{}, f.err
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func TestPersistIsolirRouter(t *testing.T) {
	mgr := state.NewManager()
	_ = mgr.UpsertRouter(state.Router{ID: "r1"})
	_ = mgr.UpsertRouter(state.Router{ID: "r2"})
	_ = mgr.UpsertCustomer(state.Customer{
		ID:            "c1",
		PPPoEUsername: "17060001797@runsnet.id",
		RouterID:      "r1",
		BillingStatus: "lunas",
	})
	_ = mgr.UpsertCustomer(state.Customer{
		ID:            "c2",
		PPPoEUsername: "other@runsnet.id",
		RouterID:      "r2", // different router
		BillingStatus: "lunas",
	})

	db := &fakeDB{}
	ctx := context.Background()

	// 1. Sukses persist untuk customer r1
	isolated := map[string]bool{
		"17060001797@runsnet.id": true,
		"other@runsnet.id":       true, // belongs to r2, must be ignored for r1
		"unknown@runsnet.id":     true, // unknown
	}

	err := persistIsolirRouter(ctx, db, mgr, "r1", isolated, nil)
	if err != nil {
		t.Fatalf("persistIsolirRouter() error = %v", err)
	}

	if len(db.calls) != 2 {
		t.Fatalf("db.calls = %d, want 2 (update + bersihkan)", len(db.calls))
	}
	call := db.calls[0]
	if !strings.Contains(call.sql, "isolir_router IS DISTINCT FROM u.v") {
		t.Errorf("SQL query salah: %s", call.sql)
	}
	ids := call.args[0].([]string)
	vals := call.args[1].([]bool)
	if len(ids) != 1 || ids[0] != "c1" || len(vals) != 1 || vals[0] != true {
		t.Errorf("args salah: ids=%v vals=%v", ids, vals)
	}

	// Manager harus sudah terupdate setelah DB sukses
	c1, ok := mgr.CustomerByPPPoE("17060001797@runsnet.id")
	if !ok || c1.IsolirRouter == nil || *c1.IsolirRouter != true {
		t.Errorf("Manager c1.IsolirRouter = %+v, want true", c1.IsolirRouter)
	}

	// 2. DB error: Manager TIDAK boleh diupdate (Manager never precedes DB)
	dbErr := &fakeDB{err: errors.New("db error")}
	isolated2 := map[string]bool{
		"17060001797@runsnet.id": false,
	}
	err2 := persistIsolirRouter(ctx, dbErr, mgr, "r1", isolated2, nil)
	if err2 == nil {
		t.Fatal("harus error saat DB gagal")
	}

	c1AfterErr, _ := mgr.CustomerByPPPoE("17060001797@runsnet.id")
	if c1AfterErr.IsolirRouter == nil || *c1AfterErr.IsolirRouter != true {
		t.Errorf("Manager tidak boleh mendahului DB: IsolirRouter berubah jadi %+v", c1AfterErr.IsolirRouter)
	}
}

// Sesi hilang = bukti hilang: pelanggan router itu yang tidak ada di putaran ini kembali
// ke billing (NULL di DB, nil di Manager), pelanggan router lain tidak disentuh.
func TestPersistIsolirRouterClearsCustomersWithoutSession(t *testing.T) {
	mgr := state.NewManager()
	_ = mgr.UpsertRouter(state.Router{ID: "r1"})
	_ = mgr.UpsertRouter(state.Router{ID: "r2"})
	for _, c := range []state.Customer{
		{ID: "c1", PPPoEUsername: "u1", RouterID: "r1", BillingStatus: "lunas"},
		{ID: "c2", PPPoEUsername: "u2", RouterID: "r1", BillingStatus: "isolir"},
		{ID: "c3", PPPoEUsername: "u3", RouterID: "r2", BillingStatus: "lunas"},
	} {
		if err := mgr.UpsertCustomer(c); err != nil {
			t.Fatal(err)
		}
	}
	mgr.SetIsolirRouter(map[string]bool{"c1": true, "c2": false, "c3": true})

	db := &fakeDB{}
	if err := persistIsolirRouter(context.Background(), db, mgr, "r1", map[string]bool{"u1": true}, nil); err != nil {
		t.Fatal(err)
	}
	clear := db.calls[1]
	if !strings.Contains(clear.sql, "isolir_router = NULL") || clear.args[0] != "r1" {
		t.Fatalf("query bersihkan salah: %+v", clear)
	}
	if ids := clear.args[1].([]string); len(ids) != 1 || ids[0] != "c1" {
		t.Errorf("id yang dipertahankan = %v, want [c1]", ids)
	}
	byID := map[string]state.Customer{}
	for _, c := range mgr.Customers() {
		byID[c.ID] = c
	}
	if byID["c1"].IsolirRouter == nil || !*byID["c1"].IsolirRouter {
		t.Errorf("c1 punya sesi, harus tetap isolir: %+v", byID["c1"].IsolirRouter)
	}
	if byID["c2"].IsolirRouter != nil {
		t.Errorf("c2 tanpa sesi harus nil, dapat %v", *byID["c2"].IsolirRouter)
	}
	if got := byID["c2"].EffectiveBillingStatus(); got != "isolir" {
		t.Errorf("c2 kembali ke billing isolir, dapat %q", got)
	}
	if byID["c3"].IsolirRouter == nil || !*byID["c3"].IsolirRouter {
		t.Errorf("c3 router lain tidak boleh tersentuh")
	}
}
