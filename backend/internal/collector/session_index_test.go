package collector

import (
	"net/netip"
	"testing"

	"noc-isp/backend/internal/state"
)

type indexPresence struct{ syslogPresence }

func (indexPresence) CustomerByPPPoE(name string) (state.Customer, bool) {
	switch name {
	case "a@runsnet.id":
		return state.Customer{ID: "cust-a", RouterID: "r1"}, true
	case "b@runsnet.id":
		return state.Customer{ID: "cust-b", RouterID: "r2"}, true
	}
	return state.Customer{}, false
}

func TestSessionIndexMapsIPsPerRouter(t *testing.T) {
	x := NewSessionIndex(indexPresence{})
	x.Update("r1", []PPPSession{
		{Name: "a@runsnet.id", Service: "pppoe", Address: "172.16.15.247"},
		{Name: "b@runsnet.id", Service: "pppoe", Address: "172.16.15.248"}, // milik router lain
		{Name: "tidak-dikenal", Service: "pppoe", Address: "172.16.15.249"},
		{Name: "a@runsnet.id", Service: "l2tp", Address: "10.9.9.9"}, // bukan PPPoE
		{Name: "a@runsnet.id", Service: "pppoe", Address: "0.0.0.0"},
	})
	sess, ok := x.LookupCustomer("cust-a")
	if !ok || sess.IP != "172.16.15.247" {
		t.Errorf("LookupCustomer = %+v, ok=%v", sess, ok)
	}
	sessUser, ok := x.LookupUser("A@RUNSNET.ID")
	if !ok || sessUser.IP != "172.16.15.247" {
		t.Errorf("LookupUser = %+v, ok=%v", sessUser, ok)
	}
	if id, ok := x.Lookup("r1", netip.MustParseAddr("172.16.15.247")); !ok || id != "cust-a" {
		t.Fatalf("Lookup = %q %v", id, ok)
	}
	for _, ip := range []string{"172.16.15.248", "172.16.15.249", "10.9.9.9", "0.0.0.0"} {
		if _, ok := x.Lookup("r1", netip.MustParseAddr(ip)); ok {
			t.Errorf("%s seharusnya tidak terpetakan", ip)
		}
	}
	// Polling berikutnya mengganti peta: sesi yang hilang tidak terpetakan lagi.
	x.Update("r1", nil)
	if _, ok := x.Lookup("r1", netip.MustParseAddr("172.16.15.247")); ok {
		t.Error("peta lama tidak diganti")
	}
}
