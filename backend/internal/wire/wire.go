// Package wire berisi bentuk JSON yang dikirim ke dashboard, dipakai bersama oleh
// WebSocket hub dan endpoint REST supaya keduanya tidak pernah berbeda. Nama
// field mengikuti tipe di frontend (src/lib/dashboard/types.ts).
package wire

import (
	"noc-isp/backend/internal/engine"
	"noc-isp/backend/internal/state"
)

// Router adalah router MikroTik.
type Router struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Host   string `json:"host"`
	Active bool   `json:"active"`
}

// Customer adalah pelanggan PPPoE. Data yang belum ada dikirim sebagai null,
// bukan 0, supaya tidak terbaca sebagai koordinat atau sinyal sungguhan.
type Customer struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	PPPoEUsername string `json:"pppoeUsername"`
	RouterID      string `json:"routerId"`
	Address       string `json:"address"`
	// OdpName kosong bila belum diketahui (bukan null).
	OdpName         string   `json:"odpName"`
	Latitude        *float64 `json:"latitude"`
	Longitude       *float64 `json:"longitude"`
	BillingStatus   string   `json:"billingStatus"`
	OpticalPowerDbm *float64 `json:"opticalPowerDbm"`
	IsOnline        bool     `json:"isOnline"`
}

// TrafficSeries berbentuk kolom sejajar (waktu, unduh, unggah dalam Mbps)
// supaya langsung bisa dipakai uPlot.
type TrafficSeries struct {
	Times []int64   `json:"times"`
	Rx    []float64 `json:"rx"`
	Tx    []float64 `json:"tx"`
}

// Counts adalah angka ringkasan untuk kartu metrik.
type Counts struct {
	Online        int `json:"online"`
	Offline       int `json:"offline"`
	WeakSignal    int `json:"weakSignal"`
	ActiveRouters int `json:"activeRouters"`
	TotalRouters  int `json:"totalRouters"`
}

// Optional mengembalikan pointer ke value bila ok, selain itu nil (null di JSON).
func Optional(value float64, ok bool) *float64 {
	if !ok {
		return nil
	}
	return &value
}

// NewRouter mengubah router state menjadi bentuk JSON.
func NewRouter(r state.Router) Router {
	return Router{ID: r.ID, Name: r.Name, Host: r.Host, Active: r.Active}
}

// NewCustomer mengubah pelanggan state menjadi bentuk JSON.
func NewCustomer(c state.Customer) Customer {
	return Customer{
		ID:              c.ID,
		Name:            c.Name,
		PPPoEUsername:   c.PPPoEUsername,
		RouterID:        c.RouterID,
		Address:         c.Address,
		OdpName:         c.ODPName,
		Latitude:        Optional(c.Latitude, c.HasLocation),
		Longitude:       Optional(c.Longitude, c.HasLocation),
		BillingStatus:   c.BillingStatus,
		OpticalPowerDbm: Optional(c.OpticalPowerDbm, c.HasOptical),
		IsOnline:        c.IsOnline,
	}
}

// NewRouters dan NewCustomers mengubah slice; hasilnya tidak pernah nil sehingga
// JSON-nya selalu [] untuk daftar kosong.
func NewRouters(routers []state.Router) []Router {
	out := make([]Router, 0, len(routers))
	for _, r := range routers {
		out = append(out, NewRouter(r))
	}
	return out
}

func NewCustomers(customers []state.Customer) []Customer {
	out := make([]Customer, 0, len(customers))
	for _, c := range customers {
		out = append(out, NewCustomer(c))
	}
	return out
}

// NewTrafficSeries mengubah titik traffic menjadi kolom sejajar. Kolomnya tidak
// pernah nil.
func NewTrafficSeries(points []state.TrafficPoint) TrafficSeries {
	series := TrafficSeries{
		Times: make([]int64, 0, len(points)),
		Rx:    make([]float64, 0, len(points)),
		Tx:    make([]float64, 0, len(points)),
	}
	for _, p := range points {
		series.Times = append(series.Times, p.Time)
		series.Rx = append(series.Rx, p.RxMbps)
		series.Tx = append(series.Tx, p.TxMbps)
	}
	return series
}

// NewCounts mengubah angka ringkasan state menjadi bentuk JSON.
func NewCounts(c state.Counts) Counts {
	return Counts{
		Online:        c.Online,
		Offline:       c.Offline,
		WeakSignal:    c.WeakSignal,
		ActiveRouters: c.ActiveRouters,
		TotalRouters:  c.TotalRouters,
	}
}

// Event adalah gangguan yang mulai atau selesai. Event mulai dan event selesai
// milik satu gangguan memakai ID yang sama.
type Event struct {
	ID         string         `json:"id"`
	Kind       string         `json:"kind"`     // queue, cpu, optical, offline, port
	Severity   string         `json:"severity"` // info, warning, critical
	Active     bool           `json:"active"`   // false = gangguan sudah selesai
	RouterID   string         `json:"routerId,omitempty"`
	CustomerID string         `json:"customerId,omitempty"`
	Time       int64          `json:"time"`      // detik unix perubahan ini
	StartedAt  int64          `json:"startedAt"` // detik unix gangguan dimulai
	Detail     map[string]any `json:"detail,omitempty"`
}

// NewEvent mengubah event engine menjadi bentuk JSON.
func NewEvent(e engine.Event) Event {
	return Event{
		ID:         e.ID,
		Kind:       e.Kind,
		Severity:   e.Severity,
		Active:     e.Active,
		RouterID:   e.RouterID,
		CustomerID: e.CustomerID,
		Time:       e.Time.Unix(),
		StartedAt:  e.StartedAt.Unix(),
		Detail:     e.Detail,
	}
}

// NewEvents mengubah daftar event; hasilnya tidak pernah nil.
func NewEvents(events []engine.Event) []Event {
	out := make([]Event, 0, len(events))
	for _, e := range events {
		out = append(out, NewEvent(e))
	}
	return out
}
