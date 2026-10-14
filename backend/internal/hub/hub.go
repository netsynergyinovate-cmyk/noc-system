package hub

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/wire"
)

const (
	defaultMaxClients  = 100
	defaultSendBuffer  = 128
	defaultAuthTimeout = 5 * time.Second
	defaultInterval    = time.Second
	defaultDelay       = time.Second
	defaultPingPeriod  = 25 * time.Second
	defaultPongWait    = 60 * time.Second
	defaultMaxAge      = 30 * time.Minute

	// maxCatchUp membatasi berapa detik yang dikejar bila tick terlambat; yang
	// lebih lama dilewati supaya satu keterlambatan tidak membanjiri klien.
	maxCatchUp = 60

	// minSendBuffer menjamin satu putaran kejar-ketinggalan penuh (maxCatchUp delta)
	// plus sedikit ruang untuk event tidak membuat klien yang sehat dianggap lambat.
	minSendBuffer = maxCatchUp + 16

	// defaultMaxBillingChanges membatasi billingChanges pada satu delta. Satu entri
	// sekitar 70 byte (UUID 36 karakter), jadi batas ini menjaga satu delta di bawah
	// ~150 KB. Jauh di atas banjir yang masuk akal (satu sinkron per jam mengubah
	// puluhan sampai ratusan pelanggan), tetapi cukup rendah agar sinkron yang
	// mengubah puluhan ribu pelanggan sekaligus tidak menjadi satu frame raksasa.
	defaultMaxBillingChanges = 2000
)

// CloseReauth adalah kode close aplikasi (rentang 4000-4999) yang berarti "sesi
// perlu diperbarui": ambil tiket baru dan sambung ulang. Berbeda dari 1008
// (tiket ditolak) yang berarti jangan mencoba lagi dengan tiket yang sama.
const CloseReauth = 4401

var errServerFull = errors.New("hub: jumlah klien maksimum tercapai")

// Options mengatur Hub. Verifier dan Logger wajib diisi.
type Options struct {
	Verifier auth.Verifier
	Logger   *slog.Logger

	// AllowedOrigins adalah origin browser yang boleh membuka koneksi, mis.
	// "http://localhost:3000". Permintaan tanpa header Origin (klien non-browser)
	// diizinkan, tetapi tetap wajib membawa tiket.
	AllowedOrigins []string

	MaxClients  int           // default 100
	SendBuffer  int           // pesan yang boleh antre per klien; default 128, minimal 76
	AuthTimeout time.Duration // batas waktu menunggu pesan auth; default 5 detik
	Interval    time.Duration // jarak antar tick; default 1 detik
	PingPeriod  time.Duration // jarak ping ke klien; default 25 detik
	PongWait    time.Duration // batas menunggu balasan klien; default 60 detik
	// MaxConnectionAge membatasi umur satu koneksi. Tiket hanya diperiksa saat
	// koneksi dibuka, jadi tanpa batas ini pengguna yang sudah logout atau
	// dinonaktifkan tetap tersambung. Setelah batas ini koneksi ditutup dengan
	// kode CloseReauth dan dashboard harus meminta tiket baru (yang hanya
	// diberikan Next.js kepada pengguna yang masih login) lalu menyambung
	// ulang. 0 memakai 30 menit; nilai negatif mematikan batas.
	MaxConnectionAge time.Duration
	// StatusFlush: bila > 0, perubahan status pelanggan disiarkan segera setelah
	// jeda sependek ini (perubahan dalam jeda digabung), bukan menunggu delta
	// detik berikutnya. 0 berarti hanya lewat delta per detik.
	StatusFlush time.Duration
	// Delay memberi collector waktu melaporkan sebuah detik sebelum disiarkan.
	Delay time.Duration // default 1 detik
	Now   func() time.Time
	// MaxBillingChanges adalah jumlah perubahan status tagihan paling banyak pada
	// SATU delta; default 2000. Bila lebih banyak menunggu, sisanya (menurut urutan
	// ID pelanggan) dikirim pada delta detik berikutnya, tidak pernah dibuang dan
	// tidak pernah dikirim dua kali.
	MaxBillingChanges int
}

// Hub menyiarkan kondisi dari state.Manager ke dashboard yang sudah login:
// satu snapshot saat tersambung, lalu satu delta per detik dan event anomali.
type Hub struct {
	opts     Options
	mgr      *state.Manager
	upgrader websocket.Upgrader

	mu          sync.Mutex
	clients     map[*client]struct{}
	pending     map[string]statusChange // perubahan yang menunggu tick berikutnya
	lastEmitted int64                   // detik terakhir yang sudah disiarkan
	flushTimer  *time.Timer             // pengiriman cepat perubahan status yang sedang menunggu
	closed      bool
}

// New membuat Hub. Panggil Run agar delta mulai dikirim.
func New(mgr *state.Manager, opts Options) *Hub {
	if opts.MaxClients <= 0 {
		opts.MaxClients = defaultMaxClients
	}
	if opts.SendBuffer <= 0 {
		opts.SendBuffer = defaultSendBuffer
	}
	opts.SendBuffer = max(opts.SendBuffer, minSendBuffer)
	if opts.AuthTimeout <= 0 {
		opts.AuthTimeout = defaultAuthTimeout
	}
	if opts.Interval <= 0 {
		opts.Interval = defaultInterval
	}
	if opts.Delay <= 0 {
		opts.Delay = defaultDelay
	}
	if opts.PingPeriod <= 0 {
		opts.PingPeriod = defaultPingPeriod
	}
	if opts.PongWait <= 0 {
		opts.PongWait = defaultPongWait
	}
	if opts.MaxConnectionAge == 0 {
		opts.MaxConnectionAge = defaultMaxAge
	}
	if opts.MaxBillingChanges <= 0 {
		opts.MaxBillingChanges = defaultMaxBillingChanges
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}

	h := &Hub{
		opts:    opts,
		mgr:     mgr,
		clients: make(map[*client]struct{}),
		pending: make(map[string]statusChange),
	}
	h.lastEmitted = opts.Now().Add(-opts.Delay).Unix()
	h.upgrader = websocket.Upgrader{
		CheckOrigin: h.checkOrigin,
		// Klien tidak mengirim data selain pesan auth; buffer kecil cukup.
		ReadBufferSize:  1024,
		WriteBufferSize: 4096,
	}
	return h
}

func (h *Hub) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return slices.Contains(h.opts.AllowedOrigins, origin)
}

// Run mengirim delta tiap Interval sampai ctx dibatalkan, lalu menutup semua
// koneksi dengan kode "going away".
func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(h.opts.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			h.shutdown()
			return
		case <-ticker.C:
			h.tick(h.opts.Now())
		}
	}
}

// NotifyChange dipanggil collector atau rule engine setelah mengubah state.
// Perubahan yang tidak mengubah status diabaikan; perubahan berulang pada
// pelanggan yang sama dalam satu detik digabung menjadi keadaan terakhir.
func (h *Hub) NotifyChange(change state.Change) {
	if !change.Changed() {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pending[change.After.ID] = newStatusChange(change.After)
	if h.opts.StatusFlush > 0 && h.flushTimer == nil && !h.closed {
		h.flushTimer = time.AfterFunc(h.opts.StatusFlush, h.flushStatus)
	}
}

// flushStatus menyiarkan perubahan status yang menunggu, tanpa menunggu tick.
func (h *Hub) flushStatus() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.flushTimer = nil
	if h.closed || len(h.pending) == 0 {
		return
	}
	h.broadcastLocked(statusMessage{
		Type:          typeStatus,
		Time:          h.opts.Now().Unix(),
		StatusChanges: h.drainPendingLocked(),
	})
}

// PublishEvents menyiarkan gangguan yang mulai atau selesai segera ke semua
// klien, sebagai satu pesan berisi daftar.
func (h *Hub) PublishEvents(events []wire.Event) {
	if len(events) == 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.broadcastLocked(eventsMessage{Type: typeEvents, Events: events})
}

// tick menyiarkan semua detik yang belum disiarkan sampai now-Delay. Biasanya
// satu detik; lebih bila tick terlambat.
//
// Perubahan status tagihan (billingChanges) diambil dari state.Manager pada TIAP
// detik yang disiarkan, paling banyak MaxBillingChanges per delta. Jadi perubahan
// dari sinkron billing yang berhasil tiba pada delta berikutnya, bukan menunggu
// sinkron berikutnya, dan banjir yang melebihi batas habis dalam beberapa detik
// berturut-turut. Hub yang tidak punya klien tetap mengambilnya (klien baru
// menerima status berlaku lewat snapshot).
func (h *Hub) tick(now time.Time) {
	target := now.Add(-h.opts.Delay).Unix()

	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || target <= h.lastEmitted {
		return
	}
	first := h.lastEmitted + 1
	if target-first+1 > maxCatchUp {
		first = target - maxCatchUp + 1
	}
	for second := first; second <= target; second++ {
		msg := h.buildDeltaLocked(second, second == first)
		h.broadcastDeltaLocked(msg, h.mgr.DrainBillingChanges(h.opts.MaxBillingChanges))
	}
	h.lastEmitted = target
}

// buildDeltaLocked membangun delta untuk satu detik: total traffic semua router
// yang melapor pada detik itu (nil bila tidak ada, jadi "traffic": null) dan,
// hanya pada isFirstTick, perubahan status yang menunggu. Detik kejar-ketinggalan
// berikutnya membawa daftar kosong.
func (h *Hub) buildDeltaLocked(second int64, isFirstTick bool) deltaMessage {
	msg := deltaMessage{Type: typeDelta, Time: second, StatusChanges: []statusChange{}}
	if total, reporting := h.mgr.TotalAt(second); reporting > 0 {
		msg.Traffic = &trafficPoint{Time: second, Rx: total.RxMbps, Tx: total.TxMbps}
	}
	if isFirstTick {
		msg.StatusChanges = h.drainPendingLocked()
	}
	return msg
}

func (h *Hub) drainPendingLocked() []statusChange {
	out := make([]statusChange, 0, len(h.pending))
	for _, change := range h.pending {
		out = append(out, change)
	}
	clear(h.pending)
	// Urutan tetap supaya keluaran bisa diuji dan dibandingkan.
	slices.SortFunc(out, func(a, b statusChange) int {
		switch {
		case a.CustomerID < b.CustomerID:
			return -1
		case a.CustomerID > b.CustomerID:
			return 1
		}
		return 0
	})
	return out
}

// snapshotLocked membangun snapshot yang bersambung dengan delta berikutnya, dan
// mengembalikan juga nomor urut perubahan status tagihan terakhir yang sudah
// termuat di dalamnya (state.Snapshot.BillingSeq).
func (h *Hub) snapshotLocked() (snapshotMessage, uint64) {
	snap := h.mgr.Snapshot()
	msg := snapshotMessage{
		Type:      typeSnapshot,
		Time:      h.lastEmitted,
		Routers:   wire.NewRouters(snap.Routers),
		Customers: wire.NewCustomers(snap.Customers),
	}
	// Detik yang belum disiarkan akan tiba lewat delta; jangan dobel.
	sent := snap.Traffic
	for i, p := range snap.Traffic {
		if p.Time > h.lastEmitted {
			sent = snap.Traffic[:i]
			break
		}
	}
	msg.Traffic = wire.NewTrafficSeries(sent)
	// Jaminan protokol: daftar kosong selalu [] di JSON, tidak pernah null.
	if msg.Routers == nil {
		msg.Routers = []wire.Router{}
	}
	if msg.Customers == nil {
		msg.Customers = []wire.Customer{}
	}
	if msg.Traffic.Times == nil {
		msg.Traffic.Times = []int64{}
	}
	if msg.Traffic.Rx == nil {
		msg.Traffic.Rx = []float64{}
	}
	if msg.Traffic.Tx == nil {
		msg.Traffic.Tx = []float64{}
	}
	return msg, snap.BillingSeq
}

// register memasukkan klien dan mengantrekan snapshot sebagai pesan pertamanya.
// Keduanya terjadi dalam satu kunci yang sama dengan tick, sehingga klien tidak
// pernah menerima delta sebelum snapshot atau kehilangan delta sesudahnya.
func (h *Hub) register(c *client) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || len(h.clients) >= h.opts.MaxClients {
		return errServerFull
	}
	snapshot, billingSeq := h.snapshotLocked()
	prepared, err := prepare(snapshot)
	if err != nil {
		return err
	}
	c.send <- prepared // kosong dan berkapasitas > 0, tidak memblokir
	// Status tagihan di snapshot ini sudah mencakup semua perubahan sampai nomor urut
	// ini; delta berikutnya tidak perlu mengulangnya untuk klien ini.
	c.billingSeen = billingSeq
	h.clients[c] = struct{}{}
	return nil
}

func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
}

// broadcastLocked menyiarkan satu pesan. Klien yang antreannya penuh (terlalu
// lambat) diputus; hub tidak pernah menunggu klien.
func (h *Hub) broadcastLocked(v any) {
	prepared, err := prepare(v)
	if err != nil {
		h.opts.Logger.Error("gagal menyiapkan pesan WebSocket", "error", err)
		return
	}
	for c := range h.clients {
		h.sendLocked(c, prepared)
	}
}

// sendLocked mengantrekan pesan untuk satu klien. Klien yang antreannya penuh
// diputus dan dikeluarkan dari hub; hub tidak pernah menunggu.
func (h *Hub) sendLocked(c *client, prepared *websocket.PreparedMessage) {
	select {
	case c.send <- prepared:
	default:
		h.opts.Logger.Warn("klien WebSocket terlalu lambat, koneksi diputus", "user", c.userID)
		delete(h.clients, c)
		c.close(websocket.ClosePolicyViolation, "terlalu lambat")
	}
}

// broadcastDeltaLocked menyiarkan satu delta beserta perubahan status tagihan yang
// baru diambil dari Manager (queued, terurut menurut ID pelanggan).
//
// Setiap klien menerima perubahan yang BELUM tercermin di snapshot-nya: klien yang
// tersambung sesudah sebuah perubahan terjadi tetapi sebelum disiarkan sudah
// membaca status barunya dari snapshot, jadi perubahan itu tidak dikirim lagi
// kepadanya (nomor urutnya tidak lebih besar dari billingSeen klien itu). Hampir
// selalu semua klien butuh isi yang sama dan pesan disiapkan sekali; klien yang
// tersambung di tengah membentuk kelompok sendiri dengan pesan sendiri.
func (h *Hub) broadcastDeltaLocked(msg deltaMessage, queued []state.QueuedBilling) {
	if len(queued) == 0 {
		h.broadcastLocked(msg)
		return
	}
	lowest, highest := queued[0].Seq, queued[0].Seq
	for _, q := range queued {
		lowest, highest = min(lowest, q.Seq), max(highest, q.Seq)
	}
	// Kunci kelompok: 0 = belum melihat satu pun (hampir semua klien), highest =
	// sudah melihat semuanya, selain itu nomor urut yang sudah dilihat.
	groups := make(map[uint64][]*client)
	for c := range h.clients {
		key := c.billingSeen
		switch {
		case key < lowest:
			key = 0
		case key >= highest:
			key = highest
		}
		groups[key] = append(groups[key], c)
	}
	for seen, clients := range groups {
		forGroup := msg
		for _, q := range queued {
			if q.Seq > seen {
				forGroup.BillingChanges = append(forGroup.BillingChanges, billingChange{
					CustomerID: q.CustomerID, Status: q.Status,
				})
			}
		}
		prepared, err := prepare(forGroup)
		if err != nil {
			h.opts.Logger.Error("gagal menyiapkan pesan WebSocket", "error", err)
			continue
		}
		for _, c := range clients {
			h.sendLocked(c, prepared)
		}
	}
}

func (h *Hub) shutdown() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	if h.flushTimer != nil {
		h.flushTimer.Stop()
		h.flushTimer = nil
	}
	for c := range h.clients {
		delete(h.clients, c)
		c.close(websocket.CloseGoingAway, "server berhenti")
	}
}

func prepare(v any) (*websocket.PreparedMessage, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return websocket.NewPreparedMessage(websocket.TextMessage, data)
}
