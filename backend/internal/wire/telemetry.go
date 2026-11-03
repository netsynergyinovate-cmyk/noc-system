package wire

import "noc-isp/backend/internal/state"

// CriticalOpticalDbm: Rx ONU di bawah nilai ini masuk daftar "redaman kritis" dashboard.
// Dikirim di Telemetry supaya UI tidak menulis angkanya sendiri.
const CriticalOpticalDbm = -24.5

// RouterTelemetry adalah keterjangkauan router ditambah isi /system/resource terakhir.
// Resource kosong (null) bila router belum pernah dibaca.
type RouterTelemetry struct {
	RouterHealth
	CPULoad       *int   `json:"cpuLoad"`
	MemoryUsage   *int   `json:"memoryUsage"` // persen terpakai
	UptimeSeconds *int64 `json:"uptimeSeconds"`
	Version       string `json:"version"`
	Board         string `json:"board"`
}

// NewRouterTelemetry menggabungkan router state dan resource-nya (ok=false: belum ada).
func NewRouterTelemetry(r state.Router, res state.Resource, ok bool) RouterTelemetry {
	out := RouterTelemetry{RouterHealth: NewRouterHealth(r)}
	if !ok {
		return out
	}
	cpu := res.CPULoad
	up := int64(res.Uptime.Seconds())
	out.CPULoad, out.UptimeSeconds = &cpu, &up
	if res.TotalMemory > 0 {
		used := int((res.TotalMemory - min(res.FreeMemory, res.TotalMemory)) * 100 / res.TotalMemory)
		out.MemoryUsage = &used
	}
	out.Version, out.Board = res.Version, res.Board
	return out
}

// OltTelemetry: ringkasan satu OLT dari hasil polling backend (olt_pon_ports, olt_onus).
type OltTelemetry struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Host         string `json:"host"`
	Status       string `json:"status"`
	PonPortCount int    `json:"ponPortCount"`
	OnuOnline    int    `json:"onuOnline"`
	OnuTotal     int    `json:"onuTotal"`
}

// LatencyItem: satu pengukuran TCP round-trip. LatencyMs null bila tidak terjangkau.
type LatencyItem struct {
	Name      string `json:"name"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	LatencyMs *int   `json:"latencyMs"`
	Status    string `json:"status"` // online, timeout, error
}

// Latency: hasil pengukuran terakhir. MeasuredAt null sebelum pengukuran pertama selesai.
type Latency struct {
	AvgLatencyMs *int          `json:"avgLatencyMs"`
	OnlineCount  int           `json:"onlineCount"`
	TotalCount   int           `json:"totalCount"`
	Items        []LatencyItem `json:"items"`
	MeasuredAt   *int64        `json:"measuredAt"`
}

// CriticalOptic: ONU dengan Rx di bawah CriticalOpticalDbm.
type CriticalOptic struct {
	ID    string  `json:"id"`
	User  string  `json:"user"`
	Pon   string  `json:"pon"`
	Odp   string  `json:"odp"`
	Rx    float64 `json:"rx"`
	Badge string  `json:"badge"` // Critical, High Atten, Degrading
}

// VlanTraffic: laju satu VLAN PON (vlan1101..) di trunk router ke OLT, dari counter
// byte interface. DownMbps/UpMbps null sampai laju pertama bisa dihitung.
type VlanTraffic struct {
	RouterID string   `json:"routerId"`
	Name     string   `json:"name"`
	Running  bool     `json:"running"`
	Disabled bool     `json:"disabled"`
	DownMbps *float64 `json:"downMbps"`
	UpMbps   *float64 `json:"upMbps"`
	// At: detik unix pembacaan counter; titik grafik dibuat per nilai At, bukan per pesan.
	At *int64 `json:"at"`
}

// VlanSample: satu titik laju VLAN (detik unix pembacaan counter, Mbps).
type VlanSample struct {
	At       int64   `json:"at"`
	DownMbps float64 `json:"downMbps"`
	UpMbps   float64 `json:"upMbps"`
}

// VlanHistory: titik terakhir satu VLAN (paling lama 5 menit), dibaca browser sekali saat
// dibuka supaya grafik tidak mulai dari kosong; sesudahnya titik baru datang lewat telemetri.
type VlanHistory struct {
	RouterID string       `json:"routerId"`
	Name     string       `json:"name"`
	Samples  []VlanSample `json:"samples"`
}

// PonPort: kondisi satu port PON OLT aktif dari olt_pon_ports (jumlah ONU online dan
// daya Rx terakhir). RxPowerDbm null bila OLT tidak melaporkannya.
type PonPort struct {
	OltName    string   `json:"oltName"`
	PonIndex   int      `json:"ponIndex"`
	OnuOnline  int      `json:"onuOnline"`
	RxPowerDbm *float64 `json:"rxPowerDbm"`
}

// ActiveAlert: satu alert aktif dari tabel alerts.
type ActiveAlert struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Severity   string `json:"severity"`
	Title      string `json:"title"`
	Location   string `json:"location"`
	DetectedAt int64  `json:"detectedAt"`
}

// ActiveAlerts: Total = semua alert aktif, Items = yang terbaru saja.
type ActiveAlerts struct {
	Total int           `json:"total"`
	Items []ActiveAlert `json:"items"`
}

// Telemetry adalah semua data dashboard di luar traffic dan pelanggan. Dikirim hub
// sebagai {"type":"telemetry","data":...} hanya saat isinya berubah, dan dilayani
// GET /api/v1/dashboard/telemetry. Daftar kosong selalu [] di JSON.
type Telemetry struct {
	Routers            []RouterTelemetry `json:"routers"`
	Olts               []OltTelemetry    `json:"olts"`
	Latency            Latency           `json:"latency"`
	CriticalOptics     []CriticalOptic   `json:"criticalOptics"`
	CriticalOpticalDbm float64           `json:"criticalOpticalDbm"`
	Vlans              []VlanTraffic     `json:"vlans"`
	Pons               []PonPort         `json:"pons"`
	Alerts             ActiveAlerts      `json:"alerts"`
	// DatabaseOK false bila bagian dari database (OLT, optik, alert) gagal dibaca;
	// angka lain tetap yang terakhir berhasil dibaca.
	DatabaseOK bool `json:"databaseOk"`
}
