package engine

import (
	"testing"

	"noc-isp/backend/internal/state"
)

func TestBillingMismatchRule(t *testing.T) {
	obs := Observation{Customers: []state.Customer{
		{ID: "c1", RouterID: "r1", BillingStatus: "isolir", IsOnline: true},
		{ID: "c2", BillingStatus: "isolir", IsOnline: false},
		{ID: "c3", BillingStatus: "lunas", IsOnline: true},
	}}
	conds := BillingMismatchRule{}.Evaluate(obs, at(0))
	if len(conds) != 1 {
		t.Fatalf("conds = %+v", conds)
	}
	c := conds[0]
	if c.Key != "billing_mismatch:isolir:c1" || c.Kind != "billing_mismatch" || c.Severity != "warning" || c.RouterID != "r1" || c.CustomerID != "c1" {
		t.Errorf("cond = %+v", c)
	}
	if (BillingMismatchRule{}).Name() != "billing_mismatch" {
		t.Error("Name")
	}
}
