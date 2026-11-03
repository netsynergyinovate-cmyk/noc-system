package hub

import (
	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/wire"
)

// Protokol WebSocket (semua pesan teks JSON).
//
// Klien -> server, pesan pertama dan satu-satunya yang diharapkan:
//
//	{"type":"auth","token":"<tiket dari Next.js>"}
//
// Server -> klien setelah auth berhasil:
//
//	{"type":"snapshot", ...}  sekali, langsung setelah auth
//	{"type":"delta", ...}     satu per detik
//	{"type":"status", ...}    perubahan status pelanggan, segera (tanpa menunggu detik berikutnya)
//	{"type":"events", ...}    saat ada gangguan mulai atau selesai (satu pesan berisi daftar)
//	{"type":"telemetry","data":{...}} resource router, OLT, latensi, optik kritis, alert aktif
//	                          (wire.Telemetry); sesudah snapshot bila sudah ada, lalu tiap isinya berubah
//
// Status tagihan (lunas/isolir) pelanggan ikut di snapshot (billingStatus tiap
// pelanggan). Sinkron billing yang berhasil mengubahnya menambahkan
// "billingChanges":[{"customerId":..,"status":..}] pada delta BERIKUTNYA; kunci itu
// tidak ada pada delta lain. Model pengirimannya: perubahan disiarkan sekali ke
// semua klien yang tersambung; klien yang snapshot-nya sudah memuat sebuah
// perubahan tidak menerimanya lagi; klien yang tidak tersambung menerima status
// berlaku lewat snapshot saat tersambung kembali. Lihat Hub.tick.
//
// Nama field mengikuti tipe di frontend (src/lib/dashboard/types.ts).

const (
	typeAuth      = "auth"
	typeSnapshot  = "snapshot"
	typeDelta     = "delta"
	typeStatus    = "status"
	typeEvents    = "events"
	typeTelemetry = "telemetry"
)

type authMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

// snapshotMessage memuat seluruh kondisi. Traffic berhenti di Time (detik
// terakhir yang sudah disiarkan sebagai delta), sehingga delta berikutnya
// bersambung tanpa celah dan tanpa titik ganda.
type snapshotMessage struct {
	Type      string             `json:"type"`
	Time      int64              `json:"time"`
	Routers   []wire.Router      `json:"routers"`
	Customers []wire.Customer    `json:"customers"`
	Traffic   wire.TrafficSeries `json:"traffic"`
}

// telemetryMessage membungkus wire.Telemetry; tidak membawa `time` karena isinya
// hanya dikirim saat berubah.
type telemetryMessage struct {
	Type string         `json:"type"`
	Data wire.Telemetry `json:"data"`
}

type trafficPoint struct {
	Time int64   `json:"time"`
	Rx   float64 `json:"rx"`
	Tx   float64 `json:"tx"`
}

// statusChange memuat keadaan terbaru pelanggan yang berubah; menerapkannya
// dua kali tidak berbahaya.
type statusChange struct {
	CustomerID      string   `json:"customerId"`
	IsOnline        bool     `json:"isOnline"`
	Status          string   `json:"status,omitempty"` // "online" atau "offline"
	OpticalPowerDbm *float64 `json:"opticalPowerDbm"`
}

func statusLabel(isOnline bool) string {
	if isOnline {
		return "online"
	}
	return "offline"
}

// billingChange memuat status tagihan terbaru pelanggan yang berubah karena
// sinkron billing yang berhasil; menerapkannya dua kali tidak berbahaya.
type billingChange struct {
	CustomerID string `json:"customerId"`
	Status     string `json:"status"` // "lunas" atau "isolir"
}

// deltaMessage dikirim tiap detik. Traffic null berarti tidak ada router yang
// melapor pada detik itu. BillingChanges ada HANYA bila ada isinya (kuncinya
// hilang, bukan [], pada delta biasa) dan paling banyak Options.MaxBillingChanges.
type deltaMessage struct {
	Type           string          `json:"type"`
	Time           int64           `json:"time"`
	Traffic        *trafficPoint   `json:"traffic"`
	StatusChanges  []statusChange  `json:"statusChanges"`
	BillingChanges []billingChange `json:"billingChanges,omitempty"`
}

// statusMessage menyiarkan perubahan status segera setelah terjadi, supaya
// dashboard tidak menunggu delta detik berikutnya. Isinya sama dengan
// statusChanges pada delta.
type statusMessage struct {
	Type          string         `json:"type"`
	Time          int64          `json:"time"`
	StatusChanges []statusChange `json:"statusChanges"`
}

// eventsMessage membawa semua gangguan yang mulai atau selesai pada satu putaran
// evaluasi. Satu pesan berisi daftar, supaya ratusan pelanggan yang putus
// bersamaan tidak membanjiri antrean klien.
type eventsMessage struct {
	Type   string       `json:"type"`
	Events []wire.Event `json:"events"`
}

func newStatusChange(c state.Customer) statusChange {
	return statusChange{
		CustomerID:      c.ID,
		IsOnline:        c.IsOnline,
		Status:          statusLabel(c.IsOnline),
		OpticalPowerDbm: wire.Optional(c.OpticalPowerDbm, c.HasOptical),
	}
}
