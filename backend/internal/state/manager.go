package state

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"
)

var (
	// ErrUnknownRouter berarti router belum didaftarkan lewat UpsertRouter.
	ErrUnknownRouter = errors.New("state: router tidak dikenal")
	// ErrUnknownCustomer berarti pelanggan belum didaftarkan lewat UpsertCustomer.
	ErrUnknownCustomer = errors.New("state: pelanggan tidak dikenal")
	// ErrDuplicatePPPoE berarti username PPPoE sudah dipakai pelanggan lain.
	ErrDuplicatePPPoE = errors.New("state: username PPPoE sudah dipakai pelanggan lain")
	// ErrInvalid berarti data yang diberikan tidak lengkap.
	ErrInvalid = errors.New("state: data tidak valid")
)

type routerState struct {
	Router
	traffic *RingBuffer[TrafficPoint]

	interfaces    []Interface
	interfacesAt  time.Time
	hasInterfaces bool
}

// Manager menyimpan kondisi jaringan terkini di memori dan aman dipakai dari
// banyak goroutine: collector menulis, hub dan rule engine membaca.
//
// Semua data yang keluar dari Manager adalah salinan, jadi pemanggil tidak bisa
// mengubah state-nya tanpa lewat method Manager.
type Manager struct {
	mu            sync.RWMutex
	routers       map[string]*routerState
	routerOrder   []string
	customers     map[string]*Customer
	customerOrder []string
	byPPPoE       map[string]string // username PPPoE -> id pelanggan
	now           func() time.Time

	// billingQueued adalah pelanggan yang status tagihannya berubah dan belum
	// diambil hub (id -> nomor urut perubahan terakhirnya); billingSeq adalah nomor
	// urut terakhir yang dipakai. Lihat billing.go.
	billingQueued map[string]uint64
	billingSeq    uint64
}

// Option mengubah perilaku Manager.
type Option func(*Manager)

// WithClock mengganti sumber waktu (untuk test).
func WithClock(now func() time.Time) Option {
	return func(m *Manager) { m.now = now }
}

// NewManager membuat Manager kosong.
func NewManager(opts ...Option) *Manager {
	m := &Manager{
		routers:   make(map[string]*routerState),
		customers: make(map[string]*Customer),
		byPPPoE:   make(map[string]string),
		now:       time.Now,

		billingQueued: make(map[string]uint64),
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// UpsertRouter menambah router, atau memperbarui datanya tanpa menghapus
// riwayat traffic-nya.
func (m *Manager) UpsertRouter(r Router) error {
	if r.ID == "" {
		return fmt.Errorf("%w: ID router kosong", ErrInvalid)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.routers[r.ID]; ok {
		r.Resource = existing.Router.Resource
		r.HasResource = existing.Router.HasResource
		r.Reachable = existing.Router.Reachable
		r.LastError = existing.Router.LastError
		r.LastErrorAt = existing.Router.LastErrorAt
		r.ConsecutiveFailures = existing.Router.ConsecutiveFailures
		r.LastOKAt = existing.Router.LastOKAt
		existing.Router = r
		return nil
	}
	r.Reachable = true
	m.routers[r.ID] = &routerState{Router: r, traffic: NewRingBuffer[TrafficPoint](TrafficWindow)}
	m.routerOrder = append(m.routerOrder, r.ID)
	return nil
}

// RemoveRouter membuang router beserta pelanggannya dari memori (router dihapus atau tidak lagi aktif di
// database). Mengembalikan false bila router tidak dikenal.
func (m *Manager) RemoveRouter(routerID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.routers[routerID]; !ok {
		return false
	}
	delete(m.routers, routerID)
	m.routerOrder = slices.DeleteFunc(m.routerOrder, func(id string) bool { return id == routerID })
	m.customerOrder = slices.DeleteFunc(m.customerOrder, func(id string) bool {
		c := m.customers[id]
		if c.RouterID != routerID {
			return false
		}
		delete(m.byPPPoE, c.PPPoEUsername)
		delete(m.byPPPoE, strings.ToLower(strings.TrimSpace(c.PPPoEUsername)))
		delete(m.billingQueued, id)
		delete(m.customers, id)
		return true
	})
	return true
}

// UpsertCustomer menambah pelanggan, atau menggantikan datanya. Routernya harus
// sudah terdaftar dan username PPPoE-nya tidak boleh dipakai pelanggan lain.
func (m *Manager) UpsertCustomer(c Customer) error {
	if c.ID == "" || c.PPPoEUsername == "" {
		return fmt.Errorf("%w: ID dan username PPPoE wajib diisi", ErrInvalid)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.routers[c.RouterID]; !ok {
		return fmt.Errorf("%w: %q", ErrUnknownRouter, c.RouterID)
	}
	if owner, taken := m.byPPPoE[c.PPPoEUsername]; taken && owner != c.ID {
		return fmt.Errorf("%w: %q", ErrDuplicatePPPoE, c.PPPoEUsername)
	}
	if c.LastUpdatedAt.IsZero() {
		c.LastUpdatedAt = m.now()
	}
	if existing, ok := m.customers[c.ID]; ok {
		if existing.PPPoEUsername != c.PPPoEUsername {
			delete(m.byPPPoE, existing.PPPoEUsername)
			delete(m.byPPPoE, strings.ToLower(strings.TrimSpace(existing.PPPoEUsername)))
		}
		if c.StatusSince.IsZero() {
			// Mengganti data tanpa mengubah status tidak mengulang hitungan.
			if existing.IsOnline == c.IsOnline {
				c.StatusSince = existing.StatusSince
			} else {
				c.StatusSince = m.now()
			}
		}
		*existing = c
	} else {
		if c.StatusSince.IsZero() {
			c.StatusSince = m.now()
		}
		stored := c
		m.customers[c.ID] = &stored
		m.customerOrder = append(m.customerOrder, c.ID)
	}
	m.byPPPoE[c.PPPoEUsername] = c.ID
	m.byPPPoE[strings.ToLower(strings.TrimSpace(c.PPPoEUsername))] = c.ID
	return nil
}

// CustomerByPPPoE mencari pelanggan dari username PPPoE-nya dan mengembalikan
// salinannya.
func (m *Manager) CustomerByPPPoE(pppoeUsername string) (Customer, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.byPPPoE[pppoeUsername]
	if !ok {
		id, ok = m.byPPPoE[strings.ToLower(strings.TrimSpace(pppoeUsername))]
	}
	if !ok {
		return Customer{}, false
	}
	return *m.customers[id], true
}

// SetOnline mengubah status online pelanggan berdasarkan username PPPoE (kunci
// yang dikirim script PPP on-up/on-down). Hasilnya memberi tahu apakah status
// benar-benar berubah; event hanya perlu dikirim bila Changed().
func (m *Manager) SetOnline(pppoeUsername string, online bool) (Change, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byPPPoE[pppoeUsername]
	if !ok {
		id, ok = m.byPPPoE[strings.ToLower(strings.TrimSpace(pppoeUsername))]
	}
	if !ok {
		return Change{}, fmt.Errorf("%w: %q", ErrUnknownCustomer, pppoeUsername)
	}
	return m.updateLocked(id, func(c *Customer) {
		if c.IsOnline != online {
			c.StatusSince = m.now()
		}
		c.IsOnline = online
	}), nil
}

// SetOpticalPower menyimpan Rx power ONU (dBm) dari OLT.
func (m *Manager) SetOpticalPower(customerID string, dbm float64) (Change, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.customers[customerID]; !ok {
		return Change{}, fmt.Errorf("%w: %q", ErrUnknownCustomer, customerID)
	}
	return m.updateLocked(customerID, func(c *Customer) {
		c.OpticalPowerDbm = dbm
		c.HasOptical = true
	}), nil
}

// updateLocked menerapkan mutasi ke pelanggan yang sudah pasti ada.
func (m *Manager) updateLocked(id string, mutate func(*Customer)) Change {
	c := m.customers[id]
	before := *c
	mutate(c)
	c.LastUpdatedAt = m.now()
	return Change{Before: before, After: *c}
}

// SetQueues menyimpan rasio pemakaian queue untuk sekumpulan pelanggan sekaligus.
// Mengembalikan daftar perubahan pelanggan yang status Health-nya tidak berubah,
// tetapi rule engine tetap perlu memeriksanya untuk mendeteksi kemacetan.
//
// Hanya pelanggan milik routerID yang diubah. Pelanggan router itu yang tidak
// muncul di ratios kehilangan data queue-nya: queue dihapus/dinonaktifkan, jadi
// angka lama tidak boleh terus dipakai aturan antrean (alert akan menggantung).
func (m *Manager) SetQueues(routerID string, ratios []QueueRatio) ([]Change, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	seen := make(map[string]struct{}, len(ratios))
	var changes []Change
	for _, r := range ratios {
		id, ok := m.byPPPoE[r.PPPoEUsername]
		if !ok {
			id, ok = m.byPPPoE[strings.ToLower(strings.TrimSpace(r.PPPoEUsername))]
		}
		if !ok {
			continue // abaikan queue pelanggan yang belum terdaftar
		}
		c := m.customers[id]
		if c == nil || c.RouterID != routerID {
			continue // queue router lain tidak boleh mengubah pelanggan ini
		}
		seen[id] = struct{}{}
		change := m.updateLocked(id, func(c *Customer) {
			c.QueueUpRatio = r.UpRatio
			c.QueueDownRatio = r.DownRatio
			c.HasQueue = true
			c.QueueAt = m.now()
		})
		changes = append(changes, change)
	}
	for _, id := range m.customerOrder {
		c := m.customers[id]
		if c == nil || c.RouterID != routerID || !c.HasQueue {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		changes = append(changes, m.updateLocked(id, func(c *Customer) {
			c.QueueUpRatio = 0
			c.QueueDownRatio = 0
			c.HasQueue = false
			c.QueueAt = time.Time{}
		}))
	}
	return changes, nil
}

// RecordTraffic menyimpan satu sampel traffic router. Sampel dengan detik yang
// sama menggantikan sampel sebelumnya; sampel yang lebih tua dari yang terakhir
// diabaikan (mengembalikan false) supaya urutan waktu tetap menaik.
func (m *Manager) RecordTraffic(routerID string, p TrafficPoint) (accepted bool, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.routers[routerID]
	if !ok {
		return false, fmt.Errorf("%w: %q", ErrUnknownRouter, routerID)
	}
	if last, has := r.traffic.Last(); has {
		switch {
		case p.Time < last.Time:
			return false, nil
		case p.Time == last.Time:
			r.traffic.ReplaceLast(p)
			return true, nil
		}
	}
	r.traffic.Push(p)
	return true, nil
}

// SetRouterResource menyimpan kondisi perangkat terbaru sebuah router.
func (m *Manager) SetRouterResource(routerID string, r Resource) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	router, ok := m.routers[routerID]
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownRouter, routerID)
	}
	router.Resource, router.HasResource = r, true
	return nil
}

// RouterResource mengembalikan kondisi perangkat terbaru; false bila belum pernah
// diambil atau router tidak dikenal.
func (m *Manager) RouterResource(routerID string) (Resource, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	router, ok := m.routers[routerID]
	if !ok || !router.HasResource {
		return Resource{}, false
	}
	return router.Resource, true
}

// SetRouterReachability mencatat apakah sumber data router terjangkau. Saat
// tidak terjangkau, lastErr dan at disimpan dan hitungan gagal bertambah; saat
// terjangkau, galat dan hitungan gagal dibersihkan. Router tak dikenal diabaikan.
func (m *Manager) SetRouterReachability(routerID string, reachable bool, lastErr string, at int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	router, ok := m.routers[routerID]
	if !ok {
		return
	}
	router.Reachable = reachable
	if reachable {
		router.LastError, router.LastErrorAt, router.ConsecutiveFailures = "", 0, 0
		return
	}
	router.LastError, router.LastErrorAt = lastErr, at
	router.ConsecutiveFailures++
}

// NoteRouterSuccess mencatat bahwa satu pembacaan dari router berhasil pada waktu
// at (detik unix). Tidak mengubah status keterjangkauan; itu urusan pelacak
// kegagalan. Router tak dikenal diabaikan.
func (m *Manager) NoteRouterSuccess(routerID string, at int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if router, ok := m.routers[routerID]; ok && at > router.LastOKAt {
		router.LastOKAt = at
	}
}

// RouterReachability mengembalikan status keterjangkauan sumber data router.
// Router tak dikenal dianggap terjangkau tanpa galat.
func (m *Manager) RouterReachability(routerID string) (reachable bool, failures int, lastErr string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	router, ok := m.routers[routerID]
	if !ok {
		return true, 0, ""
	}
	return router.Reachable, router.ConsecutiveFailures, router.LastError
}

// SetRouterInterfaces mengganti daftar interface sebuah router dengan sampel
// terbaru yang diambil pada waktu at.
func (m *Manager) SetRouterInterfaces(routerID string, interfaces []Interface, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	router, ok := m.routers[routerID]
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownRouter, routerID)
	}
	router.interfaces = slices.Clone(interfaces)
	router.interfacesAt, router.hasInterfaces = at, true
	return nil
}

// RouterInterfaces menyalin daftar interface terbaru beserta waktu pengambilannya.
func (m *Manager) RouterInterfaces(routerID string) (interfaces []Interface, at time.Time, ok bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	router, found := m.routers[routerID]
	if !found || !router.hasInterfaces {
		return nil, time.Time{}, false
	}
	return slices.Clone(router.interfaces), router.interfacesAt, true
}

// RouterTraffic menyalin riwayat traffic satu router, tertua lebih dulu.
func (m *Manager) RouterTraffic(routerID string) ([]TrafficPoint, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.routers[routerID]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownRouter, routerID)
	}
	return r.traffic.Snapshot(), nil
}

// TotalAt menjumlahkan sampel semua router pada detik tertentu. Router yang
// belum melapor pada detik itu tidak ikut dihitung; reporting adalah jumlah
// router yang ikut.
func (m *Manager) TotalAt(second int64) (total TrafficPoint, reporting int) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	total.Time = second
	for _, id := range m.routerOrder {
		buf := m.routers[id].traffic
		for i := buf.Len() - 1; i >= 0; i-- {
			p, _ := buf.At(i)
			if p.Time < second {
				break
			}
			if p.Time == second {
				total.RxMbps += p.RxMbps
				total.TxMbps += p.TxMbps
				reporting++
				break
			}
		}
	}
	return total, reporting
}

// Counts menghitung angka ringkasan untuk kartu metrik.
func (m *Manager) Counts() Counts {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.countsLocked()
}

func (m *Manager) countsLocked() Counts {
	counts := Counts{TotalRouters: len(m.routers)}
	for _, r := range m.routers {
		if r.Active {
			counts.ActiveRouters++
		}
	}
	for _, c := range m.customers {
		if c.IsOnline {
			counts.Online++
		} else {
			counts.Offline++
		}
		if c.Health() == HealthWarning {
			counts.WeakSignal++
		}
	}
	return counts
}

// Routers menyalin daftar router sesuai urutan didaftarkan.
func (m *Manager) Routers() []Router {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.routersLocked()
}

func (m *Manager) routersLocked() []Router {
	out := make([]Router, 0, len(m.routerOrder))
	for _, id := range m.routerOrder {
		out = append(out, m.routers[id].Router)
	}
	return out
}

// Customers menyalin daftar pelanggan sesuai urutan didaftarkan.
func (m *Manager) Customers() []Customer {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.customersLocked()
}

func (m *Manager) customersLocked() []Customer {
	out := make([]Customer, 0, len(m.customerOrder))
	for _, id := range m.customerOrder {
		out = append(out, *m.customers[id])
	}
	return out
}

// TrafficSeries menjumlahkan traffic semua router per detik, tertua lebih dulu,
// paling banyak TrafficWindow titik.
func (m *Manager) TrafficSeries() []TrafficPoint {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.trafficSeriesLocked()
}

func (m *Manager) trafficSeriesLocked() []TrafficPoint {
	sums := make(map[int64]*TrafficPoint)
	for _, id := range m.routerOrder {
		m.routers[id].traffic.Each(func(p TrafficPoint) {
			sum, ok := sums[p.Time]
			if !ok {
				sum = &TrafficPoint{Time: p.Time}
				sums[p.Time] = sum
			}
			sum.RxMbps += p.RxMbps
			sum.TxMbps += p.TxMbps
		})
	}
	series := make([]TrafficPoint, 0, len(sums))
	for _, sum := range sums {
		series = append(series, *sum)
	}
	slices.SortFunc(series, func(a, b TrafficPoint) int {
		switch {
		case a.Time < b.Time:
			return -1
		case a.Time > b.Time:
			return 1
		}
		return 0
	})
	if len(series) > TrafficWindow {
		series = series[len(series)-TrafficWindow:]
	}
	return series
}

// Snapshot menyalin seluruh kondisi untuk dikirim ke dashboard baru, dalam satu
// kunci sehingga isinya konsisten. Pelanggan dan router berurutan sesuai waktu
// didaftarkan.
func (m *Manager) Snapshot() Snapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return Snapshot{
		Routers:   m.routersLocked(),
		Customers: m.customersLocked(),
		Traffic:   m.trafficSeriesLocked(),
		Counts:    m.countsLocked(),

		BillingSeq: m.billingSeq,
	}
}
