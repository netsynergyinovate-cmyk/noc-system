package state

import (
	"testing"
	"time"
)

func TestBillingServiceMismatches(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	m := NewManager(WithClock(func() time.Time { return now }))
	if err := m.UpsertRouter(Router{ID: "r1"}); err != nil {
		t.Fatal(err)
	}
	old, recent := now.Add(-11*time.Minute), now.Add(-5*time.Minute)
	for _, c := range []Customer{
		{ID: "c5", PPPoEUsername: "u5", RouterID: "r1", BillingStatus: BillingLunas, IsOnline: false, StatusSince: old},    // lunas_offline
		{ID: "c1", PPPoEUsername: "u1", RouterID: "r1", BillingStatus: BillingIsolir, IsOnline: true, StatusSince: recent}, // isolir_online
		{ID: "c2", PPPoEUsername: "u2", RouterID: "r1", BillingStatus: BillingLunas, IsOnline: false, StatusSince: recent}, // offline sebentar
		{ID: "c3", PPPoEUsername: "u3", RouterID: "r1", BillingStatus: BillingIsolir, IsOnline: false, StatusSince: old},   // wajar
		{ID: "c4", PPPoEUsername: "u4", RouterID: "r1", BillingStatus: BillingLunas, IsOnline: true, StatusSince: old},     // wajar
	} {
		if err := m.UpsertCustomer(c); err != nil {
			t.Fatal(err)
		}
	}
	got := m.BillingServiceMismatches()
	if len(got) != 2 || got[0].CustomerID != "c1" || got[0].Type != "isolir_online" ||
		got[1].CustomerID != "c5" || got[1].Type != "lunas_offline" {
		t.Fatalf("got %+v", got)
	}
	if empty := NewManager().BillingServiceMismatches(); empty == nil || len(empty) != 0 {
		t.Errorf("kosong harus slice non-nil, got %#v", empty)
	}
}
