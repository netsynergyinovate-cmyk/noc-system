package wire

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"noc-isp/backend/internal/engine"
	"noc-isp/backend/internal/state"
)

func TestCustomerEncodesMissingDataAsNull(t *testing.T) {
	data, err := json.Marshal(NewCustomer(state.Customer{ID: "c1", PPPoEUsername: "budi", RouterID: "r1"}))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"latitude":null`, `"longitude":null`, `"opticalPowerDbm":null`, `"isOnline":false`,
		// ODP yang belum diketahui adalah teks kosong, bukan null: frontend cukup
		// memeriksa string kosong dan tidak perlu menangani dua bentuk.
		`"odpName":""`,
	} {
		if !strings.Contains(string(data), want) {
			t.Errorf("%s tidak memuat %s", data, want)
		}
	}
}

func TestCustomerEncodesPresentDataAndFrontendFieldNames(t *testing.T) {
	data, _ := json.Marshal(NewCustomer(state.Customer{
		ID: "c1", PPPoEUsername: "budi", RouterID: "r1", BillingStatus: "isolir", ODPName: "ODP-CHP-04",
		Latitude: -6.9, Longitude: 107.6, HasLocation: true,
		OpticalPowerDbm: -26.5, HasOptical: true, IsOnline: true,
	}))
	for _, want := range []string{
		`"pppoeUsername":"budi"`, `"routerId":"r1"`, `"billingStatus":"isolir"`, `"odpName":"ODP-CHP-04"`,
		`"latitude":-6.9`, `"longitude":107.6`, `"opticalPowerDbm":-26.5`, `"isOnline":true`,
	} {
		if !strings.Contains(string(data), want) {
			t.Errorf("%s tidak memuat %s", data, want)
		}
	}
}
func TestCustomerEncodesRouterOverrideStatus(t *testing.T) {
	iso := true
	c := state.Customer{
		ID:            "c1",
		PPPoEUsername: "budi",
		RouterID:      "r1",
		BillingStatus: "lunas", // raw billing is lunas
		IsolirRouter:  &iso,    // router override is isolir
	}
	wc := NewCustomer(c)
	if wc.BillingStatus != "isolir" {
		t.Errorf("BillingStatus = %q, want isolir (router override)", wc.BillingStatus)
	}
}

func TestEmptyListsEncodeAsArraysNotNull(t *testing.T) {
	for name, v := range map[string]any{
		"routers":   NewRouters(nil),
		"customers": NewCustomers(nil),
		"traffic":   NewTrafficSeries(nil),
	} {
		data, _ := json.Marshal(v)
		if strings.Contains(string(data), "null") {
			t.Errorf("%s kosong = %s, tidak boleh memuat null", name, data)
		}
	}
}

func TestTrafficSeriesColumnsAreAligned(t *testing.T) {
	series := NewTrafficSeries([]state.TrafficPoint{
		{Time: 10, RxMbps: 1, TxMbps: 2},
		{Time: 11, RxMbps: 3, TxMbps: 4},
	})
	if len(series.Times) != 2 || series.Times[1] != 11 || series.Rx[1] != 3 || series.Tx[0] != 2 {
		t.Errorf("series = %+v", series)
	}
}

func TestCountsFieldNames(t *testing.T) {
	data, _ := json.Marshal(NewCounts(state.Counts{Online: 1, Offline: 2, WeakSignal: 3, ActiveRouters: 4, TotalRouters: 5}))
	want := `{"online":1,"offline":2,"weakSignal":3,"activeRouters":4,"totalRouters":5}`
	if string(data) != want {
		t.Errorf("counts = %s, want %s", data, want)
	}
}

func TestEventEncodesLikeTheFrontendExpects(t *testing.T) {
	started := time.Unix(1_700_000_000, 0)
	event := NewEvent(engine.Event{
		ID: "offline:c1#1", Kind: "offline", Severity: "warning", Active: true,
		CustomerID: "c1", Time: started.Add(30 * time.Second), StartedAt: started,
		Detail: map[string]any{"pppoeUsername": "budi"},
	})
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"id":"offline:c1#1"`, `"kind":"offline"`, `"active":true`, `"customerId":"c1"`,
		`"time":1700000030`, `"startedAt":1700000000`, `"detail":{"pppoeUsername":"budi"}`,
	} {
		if !strings.Contains(string(data), want) {
			t.Errorf("%s tidak memuat %s", data, want)
		}
	}
	if strings.Contains(string(data), "routerId") {
		t.Errorf("routerId kosong seharusnya dihilangkan: %s", data)
	}
	if got := NewEvents(nil); got == nil || len(got) != 0 {
		t.Errorf("NewEvents(nil) = %v, want slice kosong (bukan nil)", got)
	}
}
