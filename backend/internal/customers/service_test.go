package customers

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"noc-isp/backend/internal/collector"
)

type mockDB struct {
	customers []mockCustRow
	onus      []mockOnuRow
	billing   []mockBillRow
}

type mockCustRow struct {
	id       string
	username string
	isOnline bool
	rxPower  *float64
}

type mockOnuRow struct {
	customerID string
	status     string
	rxPower    *float64
	ponIndex   int
	onuIndex   int
}

type mockBillRow struct {
	custID string
	ip     string
}

func (m *mockDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if contains(sql, "FROM customers") {
		return &custRowsFake{data: m.customers}, nil
	}
	if contains(sql, "FROM olt_onus") {
		return &onuRowsFake{data: m.onus}, nil
	}
	if contains(sql, "FROM runsnet_customers") {
		return &billRowsFake{data: m.billing}, nil
	}
	return &emptyRows{}, nil
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || stringContains(s, sub))
}

func stringContains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

type custRowsFake struct {
	data []mockCustRow
	idx  int
}

func (r *custRowsFake) Close()                                       {}
func (r *custRowsFake) Err() error                                   { return nil }
func (r *custRowsFake) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *custRowsFake) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *custRowsFake) Values() ([]any, error)                       { return nil, nil }
func (r *custRowsFake) RawValues() [][]byte                          { return nil }
func (r *custRowsFake) Conn() *pgx.Conn                              { return nil }
func (r *custRowsFake) TypeMap() *pgtype.Map                         { return nil }
func (r *custRowsFake) Next() bool {
	r.idx++
	return r.idx <= len(r.data)
}
func (r *custRowsFake) Scan(dest ...any) error {
	row := r.data[r.idx-1]
	*dest[0].(*string) = row.id
	*dest[1].(*string) = row.username
	*dest[2].(*bool) = row.isOnline
	if row.rxPower != nil {
		*dest[3].(**float64) = row.rxPower
	} else {
		*dest[3].(**float64) = nil
	}
	return nil
}

type onuRowsFake struct {
	data []mockOnuRow
	idx  int
}

func (r *onuRowsFake) Close()                                       {}
func (r *onuRowsFake) Err() error                                   { return nil }
func (r *onuRowsFake) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *onuRowsFake) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *onuRowsFake) Values() ([]any, error)                       { return nil, nil }
func (r *onuRowsFake) RawValues() [][]byte                          { return nil }
func (r *onuRowsFake) Conn() *pgx.Conn                              { return nil }
func (r *onuRowsFake) TypeMap() *pgtype.Map                         { return nil }
func (r *onuRowsFake) Next() bool {
	r.idx++
	return r.idx <= len(r.data)
}
func (r *onuRowsFake) Scan(dest ...any) error {
	row := r.data[r.idx-1]
	*dest[0].(*string) = row.customerID
	*dest[1].(*string) = row.status
	if row.rxPower != nil {
		*dest[2].(**float64) = row.rxPower
	} else {
		*dest[2].(**float64) = nil
	}
	*dest[3].(*int) = row.ponIndex
	*dest[4].(*int) = row.onuIndex
	return nil
}

type billRowsFake struct {
	data []mockBillRow
	idx  int
}

func (r *billRowsFake) Close()                                       {}
func (r *billRowsFake) Err() error                                   { return nil }
func (r *billRowsFake) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *billRowsFake) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *billRowsFake) Values() ([]any, error)                       { return nil, nil }
func (r *billRowsFake) RawValues() [][]byte                          { return nil }
func (r *billRowsFake) Conn() *pgx.Conn                              { return nil }
func (r *billRowsFake) TypeMap() *pgtype.Map                         { return nil }
func (r *billRowsFake) Next() bool {
	r.idx++
	return r.idx <= len(r.data)
}
func (r *billRowsFake) Scan(dest ...any) error {
	row := r.data[r.idx-1]
	*dest[0].(*string) = row.custID
	*dest[1].(*string) = row.ip
	return nil
}

type emptyRows struct{}

func (e *emptyRows) Close()                                       {}
func (e *emptyRows) Err() error                                   { return nil }
func (e *emptyRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (e *emptyRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (e *emptyRows) Values() ([]any, error)                       { return nil, nil }
func (e *emptyRows) RawValues() [][]byte                          { return nil }
func (e *emptyRows) Conn() *pgx.Conn                              { return nil }
func (e *emptyRows) TypeMap() *pgtype.Map                         { return nil }
func (e *emptyRows) Next() bool                                   { return false }
func (e *emptyRows) Scan(dest ...any) error                       { return nil }

type mockSessionLookup struct {
	sessions map[string]collector.CustomerSession
}

func (m *mockSessionLookup) LookupCustomer(customerID string) (collector.CustomerSession, bool) {
	s, ok := m.sessions[customerID]
	return s, ok
}

func (m *mockSessionLookup) LookupUser(username string) (collector.CustomerSession, bool) {
	s, ok := m.sessions[username]
	return s, ok
}

func f(v float64) *float64 { return &v }

func TestGetLiveStatusMikrotikAndOLTLOSDetection(t *testing.T) {
	db := &mockDB{
		customers: []mockCustRow{
			{id: "c-normal", username: "user1@runsnet.id", isOnline: true},
			{id: "c-los-onu", username: "user2@runsnet.id", isOnline: false},
		},
		onus: []mockOnuRow{
			{customerID: "c-normal", status: "online", rxPower: f(-19.25), ponIndex: 1, onuIndex: 1},
			{customerID: "c-los-onu", status: "los", rxPower: nil, ponIndex: 1, onuIndex: 2},
		},
		billing: []mockBillRow{
			{custID: "user1", ip: "172.16.1.10"},
		},
	}

	sessions := &mockSessionLookup{
		sessions: map[string]collector.CustomerSession{
			"c-normal": {IP: "172.16.15.101", Uptime: "3d 4h"},
		},
	}

	svc := NewService(db, sessions, nil, nil)
	svc.now = func() time.Time { return time.Unix(1700000000, 0) }

	res, err := svc.GetLiveStatus(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// 1. Pelanggan normal: IP MikroTik terbaca, Uptime MikroTik terbaca, redaman OLT terbaca, OnuLos=false
	normal, ok := res["c-normal"]
	if !ok {
		t.Fatal("c-normal not found")
	}
	if normal.IP == nil || *normal.IP != "172.16.15.101" {
		t.Errorf("normal IP = %v, want 172.16.15.101", normal.IP)
	}
	if normal.Uptime == nil || *normal.Uptime != "3h 4j 0m" {
		t.Errorf("normal Uptime = %v, want 3h 4j 0m", *normal.Uptime)
	}
	if normal.OnuLos {
		t.Errorf("normal OnuLos should be false")
	}
	if normal.RxSource == nil || *normal.RxSource != "olt" {
		t.Errorf("normal RxSource = %v, want olt", normal.RxSource)
	}

	// 2. Pelanggan c-los-onu: status OLT 'los' -> OnuLos=true seketika, RxDbm=nil
	los1, ok := res["c-los-onu"]
	if !ok {
		t.Fatal("c-los-onu not found")
	}
	if !los1.OnuLos {
		t.Errorf("c-los-onu OnuLos should be true")
	}
	if los1.RxDbm != nil {
		t.Errorf("c-los-onu RxDbm should be nil during LOS")
	}
	if los1.RxSource == nil || *los1.RxSource != "olt" {
		t.Errorf("c-los-onu RxSource = %v, want olt", los1.RxSource)
	}
}

func TestParseCpeDeviceGenieAcs(t *testing.T) {
	raw := map[string]any{
		"_lastInform": 1700000000000,
		"VirtualParameters": map[string]any{
			"pppoeUsername": map[string]any{"_value": "cust101@runsnet.id"},
			"ipPppoe":       map[string]any{"_value": "172.16.20.55"},
			"rxPower":       map[string]any{"_value": -18.75},
			"connectedDevices": map[string]any{
				"_value": `["192.168.1.2","192.168.1.3","192.168.1.4"]`,
			},
		},
		"InternetGatewayDevice": map[string]any{
			"DeviceInfo": map[string]any{
				"UpTime": map[string]any{"_value": 7200},
			},
			"LANDevice": map[string]any{
				"WLANConfiguration": map[string]any{
					"1": map[string]any{
						"SSID": map[string]any{"_value": "WIFI-CUST101"},
					},
				},
			},
		},
	}

	info := parseCpeDevice(raw, 1700000100)
	if info.PPPoEUsername != "cust101@runsnet.id" {
		t.Errorf("PPPoEUsername = %s", info.PPPoEUsername)
	}
	if info.WanIP != "172.16.20.55" {
		t.Errorf("WanIP = %s", info.WanIP)
	}
	if !info.IsOnline {
		t.Errorf("IsOnline should be true")
	}
	if info.UptimeText != "2j 0m" {
		t.Errorf("UptimeText = %s, want 2j 0m", info.UptimeText)
	}
	if info.SSID != "WIFI-CUST101" {
		t.Errorf("SSID = %s", info.SSID)
	}
	if info.ClientsCount == nil || *info.ClientsCount != 3 {
		t.Errorf("ClientsCount = %v, want 3", info.ClientsCount)
	}
	if info.RxDbm == nil || *info.RxDbm != -18.75 {
		t.Errorf("RxDbm = %v, want -18.75", info.RxDbm)
	}
}
