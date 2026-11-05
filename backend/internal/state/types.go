package state

import "time"

// TrafficWindow adalah jumlah sampel traffic yang disimpan: 300 titik pada
// 1 sampel per detik = 5 menit terakhir. Harus sama dengan di frontend.
const TrafficWindow = 300

// WeakOpticalDbm: Rx power ONU di bawah nilai ini dianggap lemah. Harus sama
// dengan WEAK_OPTICAL_DBM di frontend.
const WeakOpticalDbm = -25.0

// Health adalah warna titik pelanggan di peta.
type Health string

const (
	HealthOK       Health = "ok"       // hijau: online, sinyal normal
	HealthWarning  Health = "warning"  // kuning: online, sinyal optik lemah
	HealthCritical Health = "critical" // merah: offline
)

// Router adalah router MikroTik yang dipantau.
type Router struct {
	ID     string
	Name   string
	Host   string
	Active bool
	// Protocol "rest" atau "api" dari database. Dipakai untuk label dan
	// pemilihan layanan pada notifikasi; poller memakai nilai yang sama.
	Protocol string

	// Reachable salah bila sumber data router gagal berturut-turut sampai
	// melewati ambang anti-flapping. Diisi true oleh UpsertRouter untuk router baru.
	Reachable           bool
	LastError           string // pesan galat terakhir yang sudah disanitasi
	LastErrorAt         int64  // detik unix galat terakhir
	ConsecutiveFailures int
	// LastOKAt adalah detik unix terakhir sebuah pembacaan dari router berhasil;
	// 0 bila belum pernah. Dasar pesan "data terakhir diperbarui ...".
	LastOKAt int64

	HasResource bool
	Resource    Resource
}

// Customer adalah pelanggan PPPoE. Semua field berupa nilai (tanpa pointer)
// supaya menyalinnya selalu menghasilkan salinan yang terpisah; kolom yang
// bisa kosong memakai penanda Has*.
type Customer struct {
	ID            string
	Name          string
	PPPoEUsername string
	RouterID      string
	Address       string
	// ODPName adalah nama ODP atau lokasi tempat pelanggan tersambung (teks bebas
	// menurut penamaan ISP); kosong bila belum diketahui.
	ODPName       string
	BillingStatus string // "lunas" atau "isolir"

	// IsolirRouter adalah status isolir dari router MikroTik (nil = tidak ada bukti).
	IsolirRouter *bool

	Latitude, Longitude float64
	HasLocation         bool

	// OpticalPowerDbm adalah Rx power ONU dari OLT; makin negatif makin lemah.
	OpticalPowerDbm float64
	HasOptical      bool

	QueueUpRatio   float64
	QueueDownRatio float64
	HasQueue       bool

	IsOnline bool
	// StatusSince adalah kapan IsOnline berubah ke nilainya sekarang. Berbeda
	// dengan LastUpdatedAt, ia tidak ikut berubah saat data lain (mis. sinyal
	// optik) diperbarui.
	StatusSince   time.Time
	LastUpdatedAt time.Time
}

// EffectiveBillingStatus mengembalikan status isolir/lunas efektif pelanggan:
// status dari router (IsolirRouter) bila ada bukti, atau status tagihan (BillingStatus)
// sebagai cadangan.
func (c Customer) EffectiveBillingStatus() string {
	if c.IsolirRouter != nil {
		if *c.IsolirRouter {
			return BillingIsolir
		}
		return BillingLunas
	}
	return c.BillingStatus
}

// Health menurunkan warna titik dari status dan sinyal optik. Aturannya sama
// dengan getCustomerHealth di frontend.
func (c Customer) Health() Health {
	switch {
	case !c.IsOnline:
		return HealthCritical
	case c.HasOptical && c.OpticalPowerDbm < WeakOpticalDbm:
		return HealthWarning
	default:
		return HealthOK
	}
}

// TrafficPoint adalah satu sampel traffic dalam Mbps pada detik Time (unix).
type TrafficPoint struct {
	Time   int64
	RxMbps float64
	TxMbps float64
}

// Counts adalah angka ringkasan untuk kartu metrik dashboard.
type Counts struct {
	Online        int
	Offline       int
	WeakSignal    int
	ActiveRouters int
	TotalRouters  int
}

// Snapshot adalah salinan konsisten seluruh kondisi, untuk dikirim ke
// dashboard yang baru tersambung. Pemanggil bebas mengubahnya.
type Snapshot struct {
	Routers   []Router
	Customers []Customer
	// Traffic adalah total semua router per detik, tertua lebih dulu.
	Traffic []TrafficPoint
	Counts  Counts
	// BillingSeq adalah nomor urut perubahan status tagihan terakhir yang sudah
	// tercermin di Customers (lihat QueuedBilling.Seq). Hub memakainya agar klien
	// yang snapshot-nya sudah memuat sebuah perubahan tidak menerimanya lagi.
	BillingSeq uint64
}

// Change menjelaskan perubahan satu pelanggan. Rule engine dan WebSocket hub
// hanya perlu bertindak bila Changed() bernilai true.
type Change struct {
	Before Customer
	After  Customer
}

// OnlineChanged benar bila pelanggan berpindah online/offline.
func (c Change) OnlineChanged() bool { return c.Before.IsOnline != c.After.IsOnline }

// HealthChanged benar bila warna titik berubah.
func (c Change) HealthChanged() bool { return c.Before.Health() != c.After.Health() }

// Changed benar bila ada perubahan yang perlu disiarkan.
func (c Change) Changed() bool { return c.OnlineChanged() || c.HealthChanged() }

// Resource adalah kondisi perangkat router dari /system/resource. Dipakai aturan
// "beban router tinggi" (CPU lebih dari 85% selama 3 menit).
type Resource struct {
	CPULoad     int // persen, 0 sampai 100
	FreeMemory  uint64
	TotalMemory uint64
	Uptime      time.Duration
	Version     string
	Board       string
	// At adalah kapan data ini diambil.
	At time.Time
}

// Interface adalah satu interface router dengan penghitung error dan drop sejak
// router menyala. Penghitungnya hanya naik; aturan "kerusakan port" melihat
// kenaikan di antara dua sampel.
type Interface struct {
	Name     string
	Type     string
	Running  bool
	Disabled bool
	RxError  uint64
	TxError  uint64
	RxDrop   uint64
	TxDrop   uint64
}

// QueueRatio mewakili rasio pemakaian queue untuk satu pelanggan.
type QueueRatio struct {
	PPPoEUsername string
	UpRatio       float64
	DownRatio     float64
}
