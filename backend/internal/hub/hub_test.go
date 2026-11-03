package hub

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/wire"
)

const (
	testSecret = "0123456789abcdef0123456789abcdef"
	testOrigin = "http://localhost:3000"
	// T0 adalah detik pertama yang belum disiarkan saat hub dibuat.
	t0 = int64(1_700_000_000)
)

type harness struct {
	t      *testing.T
	mgr    *state.Manager
	hub    *Hub
	server *httptest.Server
	tokens *auth.Tokens
	clock  *atomic.Int64 // detik unix "sekarang"
}

// newHarness membuat hub dengan jam palsu: detik terakhir yang disiarkan adalah
// t0-1, jadi tick(t0+1 detik) menyiarkan detik t0.
func newHarness(t *testing.T, tweak func(*Options)) *harness {
	t.Helper()
	tokens, err := auth.NewTokens(testSecret)
	if err != nil {
		t.Fatal(err)
	}
	mgr := state.NewManager()
	_ = mgr.UpsertRouter(state.Router{ID: "r1", Name: "RTR-1", Host: "10.0.0.1", Active: true})
	_ = mgr.UpsertCustomer(state.Customer{
		ID: "c1", Name: "Budi", PPPoEUsername: "budi", RouterID: "r1", BillingStatus: "lunas",
		Latitude: -6.9, Longitude: 107.6, HasLocation: true, IsOnline: true,
		OpticalPowerDbm: -20.5, HasOptical: true,
	})
	_ = mgr.UpsertCustomer(state.Customer{
		ID: "c2", Name: "Siti", PPPoEUsername: "siti", RouterID: "r1", BillingStatus: "isolir", IsOnline: false,
	})

	clock := &atomic.Int64{}
	clock.Store(t0)
	opts := Options{
		Verifier:       tokens,
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		AllowedOrigins: []string{testOrigin},
		Now:            func() time.Time { return time.Unix(clock.Load(), 0) },
	}
	if tweak != nil {
		tweak(&opts)
	}
	h := New(mgr, opts)
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	return &harness{t: t, mgr: mgr, hub: h, server: server, tokens: tokens, clock: clock}
}

func (h *harness) ticket() string {
	h.t.Helper()
	token, err := h.tokens.Issue("user-1", time.Unix(h.clock.Load(), 0), time.Minute)
	if err != nil {
		h.t.Fatal(err)
	}
	return token
}

func (h *harness) dial(origin string) (*websocket.Conn, *http.Response, error) {
	header := http.Header{}
	if origin != "" {
		header.Set("Origin", origin)
	}
	url := "ws" + strings.TrimPrefix(h.server.URL, "http")
	return websocket.DefaultDialer.Dial(url, header)
}

// connect membuka koneksi dan mengirim tiket yang sah.
func (h *harness) connect() *websocket.Conn {
	h.t.Helper()
	conn, _, err := h.dial(testOrigin)
	if err != nil {
		h.t.Fatalf("dial: %v", err)
	}
	h.t.Cleanup(func() { conn.Close() })
	if err := conn.WriteJSON(authMessage{Type: typeAuth, Token: h.ticket()}); err != nil {
		h.t.Fatalf("kirim auth: %v", err)
	}
	return conn
}

func readRaw(t *testing.T, conn *websocket.Conn) []byte {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("baca pesan: %v", err)
	}
	return data
}

func readAs[T any](t *testing.T, conn *websocket.Conn, wantType string) T {
	t.Helper()
	data := readRaw(t, conn)
	var head struct{ Type string }
	if err := json.Unmarshal(data, &head); err != nil || head.Type != wantType {
		t.Fatalf("pesan = %s, want type %q", data, wantType)
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("decode %s: %v", data, err)
	}
	return v
}

func closeCodeOf(t *testing.T, conn *websocket.Conn) int {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, data, err := conn.ReadMessage()
	var closeErr *websocket.CloseError
	if !errors.As(err, &closeErr) {
		t.Fatalf("diharapkan frame close, dapat data=%q err=%v", data, err)
	}
	return closeErr.Code
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("menunggu %s: habis waktu", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func tickAt(h *harness, secondsAfterT0 int64) {
	h.hub.tick(time.Unix(t0+secondsAfterT0, 0))
}

func TestRejectsConnectionWithoutValidTicket(t *testing.T) {
	h := newHarness(t, nil)
	expired, _ := h.tokens.Issue("user-1", time.Unix(t0-3600, 0), time.Minute)
	otherTokens, _ := auth.NewTokens("ffffffffffffffffffffffffffffffff")
	foreign, _ := otherTokens.Issue("user-1", time.Unix(t0, 0), time.Minute)

	tests := map[string]any{
		"tanpa tiket":        authMessage{Type: typeAuth},
		"tipe pesan salah":   authMessage{Type: "subscribe", Token: h.ticket()},
		"tiket sampah":       authMessage{Type: typeAuth, Token: "asal-asalan"},
		"tiket kedaluwarsa":  authMessage{Type: typeAuth, Token: expired},
		"tiket rahasia lain": authMessage{Type: typeAuth, Token: foreign},
		"bukan objek JSON":   []int{1, 2, 3},
	}
	for name, payload := range tests {
		t.Run(name, func(t *testing.T) {
			conn, _, err := h.dial(testOrigin)
			if err != nil {
				t.Fatalf("dial: %v", err)
			}
			defer conn.Close()
			if err := conn.WriteJSON(payload); err != nil {
				t.Fatal(err)
			}
			// Satu-satunya hal yang boleh diterima adalah frame close; data apa
			// pun (mis. snapshot) berarti kebocoran sebelum login.
			if code := closeCodeOf(t, conn); code != websocket.ClosePolicyViolation {
				t.Errorf("kode close = %d, want %d", code, websocket.ClosePolicyViolation)
			}
		})
	}
	if n := h.hub.ClientCount(); n != 0 {
		t.Errorf("ClientCount = %d, want 0 setelah semua ditolak", n)
	}
}

func TestRejectsNonJSONFirstMessage(t *testing.T) {
	h := newHarness(t, nil)
	conn, _, err := h.dial(testOrigin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.WriteMessage(websocket.TextMessage, []byte("halo"))
	if code := closeCodeOf(t, conn); code != websocket.ClosePolicyViolation {
		t.Errorf("kode close = %d, want %d", code, websocket.ClosePolicyViolation)
	}
}

func TestSilentClientIsClosedAfterAuthTimeout(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.AuthTimeout = 100 * time.Millisecond })
	conn, _, err := h.dial(testOrigin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if code := closeCodeOf(t, conn); code != websocket.ClosePolicyViolation {
		t.Errorf("kode close = %d, want %d", code, websocket.ClosePolicyViolation)
	}
}

func TestSnapshotIsTheFirstMessage(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()

	snap := readAs[snapshotMessage](t, conn, typeSnapshot)
	if snap.Time != t0-1 {
		t.Errorf("Time = %d, want %d", snap.Time, t0-1)
	}
	if len(snap.Routers) != 1 || snap.Routers[0].ID != "r1" || !snap.Routers[0].Active {
		t.Errorf("Routers = %+v", snap.Routers)
	}
	if len(snap.Customers) != 2 {
		t.Fatalf("jumlah pelanggan = %d, want 2", len(snap.Customers))
	}
	budi, siti := snap.Customers[0], snap.Customers[1]
	if budi.PPPoEUsername != "budi" || !budi.IsOnline || budi.OpticalPowerDbm == nil || *budi.OpticalPowerDbm != -20.5 {
		t.Errorf("pelanggan pertama = %+v", budi)
	}
	if budi.Latitude == nil || *budi.Latitude != -6.9 {
		t.Errorf("koordinat pelanggan pertama = %v, %v", budi.Latitude, budi.Longitude)
	}
	if siti.IsOnline || siti.Latitude != nil || siti.OpticalPowerDbm != nil {
		t.Errorf("data kosong harus null, bukan 0: %+v", siti)
	}
	if h.hub.ClientCount() != 1 {
		t.Errorf("ClientCount = %d, want 1", h.hub.ClientCount())
	}
}

func TestSnapshotUsesFrontendFieldNames(t *testing.T) {
	h := newHarness(t, nil)
	raw := string(readRaw(t, h.connect()))
	for _, field := range []string{
		`"pppoeUsername"`, `"routerId"`, `"billingStatus"`, `"opticalPowerDbm"`, `"isOnline"`,
		`"times"`, `"rx"`, `"tx"`,
	} {
		if !strings.Contains(raw, field) {
			t.Errorf("snapshot tidak memuat field %s: %s", field, raw)
		}
	}
	if !strings.Contains(raw, `"latitude":null`) {
		t.Errorf("koordinat kosong harus null: %s", raw)
	}
}

func TestDeltaCarriesTrafficAndStatusChanges(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	_, _ = h.mgr.RecordTraffic("r1", state.TrafficPoint{Time: t0, RxMbps: 120.5, TxMbps: 20})
	change, _ := h.mgr.SetOnline("budi", false)
	h.hub.NotifyChange(change)
	tickAt(h, 1)

	delta := readAs[deltaMessage](t, conn, typeDelta)
	if delta.Time != t0 {
		t.Errorf("Time = %d, want %d", delta.Time, t0)
	}
	if delta.Traffic == nil || delta.Traffic.Time != t0 || delta.Traffic.Rx != 120.5 || delta.Traffic.Tx != 20 {
		t.Errorf("Traffic = %+v, want {t0 120.5 20}", delta.Traffic)
	}
	if len(delta.StatusChanges) != 1 || delta.StatusChanges[0].CustomerID != "c1" || delta.StatusChanges[0].IsOnline {
		t.Errorf("StatusChanges = %+v, want c1 offline", delta.StatusChanges)
	}
}

func TestQuietSecondHasNullTrafficAndEmptyChanges(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	tickAt(h, 1) // tidak ada router yang melapor
	raw := string(readRaw(t, conn))
	if !strings.Contains(raw, `"traffic":null`) || !strings.Contains(raw, `"statusChanges":[]`) {
		t.Errorf("delta sepi = %s, want traffic null dan statusChanges []", raw)
	}
}

func TestUnchangedAndRepeatedChangesAreCoalesced(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	// Menyetel status yang sama bukan perubahan.
	same, _ := h.mgr.SetOnline("budi", true)
	h.hub.NotifyChange(same)
	// Putus lalu tersambung lagi dalam satu detik: hanya keadaan akhir yang dikirim.
	down, _ := h.mgr.SetOnline("siti", true)
	h.hub.NotifyChange(down)
	up, _ := h.mgr.SetOnline("siti", false)
	h.hub.NotifyChange(up)
	flap, _ := h.mgr.SetOnline("siti", true)
	h.hub.NotifyChange(flap)

	tickAt(h, 1)
	delta := readAs[deltaMessage](t, conn, typeDelta)
	if len(delta.StatusChanges) != 1 || delta.StatusChanges[0].CustomerID != "c2" || !delta.StatusChanges[0].IsOnline {
		t.Errorf("StatusChanges = %+v, want hanya c2 online", delta.StatusChanges)
	}

	// Setelah dikirim, antrean kosong.
	tickAt(h, 2)
	if again := readAs[deltaMessage](t, conn, typeDelta); len(again.StatusChanges) != 0 {
		t.Errorf("perubahan terkirim dua kali: %+v", again.StatusChanges)
	}
}

func TestOpticalChangeIsDelivered(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	change, _ := h.mgr.SetOpticalPower("c1", -27.2)
	h.hub.NotifyChange(change)
	tickAt(h, 1)
	delta := readAs[deltaMessage](t, conn, typeDelta)
	if len(delta.StatusChanges) != 1 || delta.StatusChanges[0].OpticalPowerDbm == nil || *delta.StatusChanges[0].OpticalPowerDbm != -27.2 {
		t.Errorf("StatusChanges = %+v, want c1 dengan -27.2 dBm", delta.StatusChanges)
	}
}

func TestSnapshotAndDeltasJoinWithoutGapOrDuplicate(t *testing.T) {
	h := newHarness(t, nil)
	for sec := t0 - 5; sec <= t0+2; sec++ {
		_, _ = h.mgr.RecordTraffic("r1", state.TrafficPoint{Time: sec, RxMbps: float64(sec - t0)})
	}
	conn := h.connect()

	snap := readAs[snapshotMessage](t, conn, typeSnapshot)
	if n := len(snap.Traffic.Times); n == 0 || snap.Traffic.Times[n-1] != t0-1 {
		t.Fatalf("snapshot harus berhenti di detik yang sudah disiarkan (%d): %v", t0-1, snap.Traffic.Times)
	}
	for i := range snap.Traffic.Times {
		if len(snap.Traffic.Rx) != len(snap.Traffic.Times) || len(snap.Traffic.Tx) != len(snap.Traffic.Times) {
			t.Fatalf("kolom traffic tidak sejajar: %+v", snap.Traffic)
		}
		if i > 0 && snap.Traffic.Times[i] != snap.Traffic.Times[i-1]+1 {
			t.Errorf("snapshot berlubang: %v", snap.Traffic.Times)
		}
	}

	// Detik yang tadinya "belum disiarkan" harus datang lewat delta, berurutan.
	tickAt(h, 3)
	var seen []int64
	for i := 0; i < 3; i++ {
		d := readAs[deltaMessage](t, conn, typeDelta)
		if d.Traffic == nil {
			t.Fatalf("delta %d tanpa traffic", d.Time)
		}
		seen = append(seen, d.Traffic.Time)
	}
	want := []int64{t0, t0 + 1, t0 + 2}
	for i := range want {
		if seen[i] != want[i] {
			t.Fatalf("delta berurutan = %v, want %v", seen, want)
		}
	}
}

func TestLateTickCatchesUpSecondBySecond(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	change, _ := h.mgr.SetOnline("budi", false)
	h.hub.NotifyChange(change)
	tickAt(h, 4) // terlambat: detik t0..t0+3 belum disiarkan
	for i := int64(0); i < 4; i++ {
		d := readAs[deltaMessage](t, conn, typeDelta)
		if d.Time != t0+i {
			t.Fatalf("delta ke-%d bertanda waktu %d, want %d", i, d.Time, t0+i)
		}
		wantChanges := 0
		if i == 0 {
			wantChanges = 1 // perubahan hanya dikirim sekali, di delta pertama
		}
		if len(d.StatusChanges) != wantChanges {
			t.Errorf("delta %d: StatusChanges = %d, want %d", d.Time, len(d.StatusChanges), wantChanges)
		}
	}
}

func TestVeryLateTickSkipsOldSeconds(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	tickAt(h, 1000)
	first := readAs[deltaMessage](t, conn, typeDelta)
	if want := t0 + 999 - maxCatchUp + 1; first.Time != want {
		t.Errorf("delta pertama = %d, want %d (hanya %d detik terakhir yang dikejar)", first.Time, want, maxCatchUp)
	}
	last := first
	for i := 1; i < maxCatchUp; i++ {
		last = readAs[deltaMessage](t, conn, typeDelta)
	}
	if last.Time != t0+999 {
		t.Errorf("delta terakhir = %d, want %d", last.Time, t0+999)
	}
}

func TestTickBeforeNextSecondDoesNothing(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	h.hub.tick(time.Unix(t0, 0)) // target = t0-1, sudah disiarkan
	_ = conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	if _, data, err := conn.ReadMessage(); err == nil {
		t.Errorf("tick terlalu dini mengirim %s", data)
	}
}

func TestEveryClientReceivesTheSameDelta(t *testing.T) {
	h := newHarness(t, nil)
	a, b := h.connect(), h.connect()
	readAs[snapshotMessage](t, a, typeSnapshot)
	readAs[snapshotMessage](t, b, typeSnapshot)

	_, _ = h.mgr.RecordTraffic("r1", state.TrafficPoint{Time: t0, RxMbps: 7})
	tickAt(h, 1)
	for name, conn := range map[string]*websocket.Conn{"a": a, "b": b} {
		d := readAs[deltaMessage](t, conn, typeDelta)
		if d.Traffic == nil || d.Traffic.Rx != 7 {
			t.Errorf("klien %s: delta = %+v", name, d)
		}
	}
}

func TestPublishEventReachesClients(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	h.hub.PublishEvents([]wire.Event{
		{ID: "e1", Kind: "offline", Severity: "warning", Active: true, CustomerID: "c1", Time: t0, StartedAt: t0 - 30},
		{ID: "e2", Kind: "offline", Severity: "warning", Active: false, CustomerID: "c2", Time: t0},
	})
	msg := readAs[eventsMessage](t, conn, typeEvents)
	if len(msg.Events) != 2 || msg.Events[0].ID != "e1" || !msg.Events[0].Active || msg.Events[0].StartedAt != t0-30 || msg.Events[1].Active {
		t.Errorf("events = %+v, want dua event dalam satu pesan", msg.Events)
	}
}

func TestOriginPolicy(t *testing.T) {
	h := newHarness(t, nil)

	if _, resp, err := h.dial("http://jahat.example"); err == nil {
		t.Error("origin asing seharusnya ditolak")
	} else if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Errorf("origin asing: respons = %v, want 403", resp)
	}
	for _, origin := range []string{testOrigin, ""} { // browser sah, dan klien non-browser
		conn, _, err := h.dial(origin)
		if err != nil {
			t.Errorf("origin %q seharusnya diizinkan: %v", origin, err)
			continue
		}
		conn.Close()
	}
}

func TestMaxClientsAndSlotIsFreedOnDisconnect(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxClients = 1 })
	first := h.connect()
	readAs[snapshotMessage](t, first, typeSnapshot)

	second := h.connect()
	if code := closeCodeOf(t, second); code != websocket.CloseTryAgainLater {
		t.Errorf("klien kedua: kode close = %d, want %d", code, websocket.CloseTryAgainLater)
	}

	first.Close()
	waitFor(t, "slot klien dibebaskan", func() bool { return h.hub.ClientCount() == 0 })
	third := h.connect()
	readAs[snapshotMessage](t, third, typeSnapshot)
}

func TestClientThatSendsDataIsDisconnected(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"subscribe"}`)); err != nil {
		t.Fatal(err)
	}
	if code := closeCodeOf(t, conn); code != websocket.ClosePolicyViolation {
		t.Errorf("kode close = %d, want %d", code, websocket.ClosePolicyViolation)
	}
	waitFor(t, "klien dilepas", func() bool { return h.hub.ClientCount() == 0 })
}

func TestSlowClientIsDroppedWithoutBlockingBroadcast(t *testing.T) {
	h := newHarness(t, nil)
	slow := &client{
		hub:  h.hub,
		send: make(chan *websocket.PreparedMessage, 1),
		done: make(chan struct{}),
	}
	slow.send <- nil // antrean sudah penuh
	h.hub.mu.Lock()
	h.hub.clients[slow] = struct{}{}
	h.hub.mu.Unlock()

	finished := make(chan struct{})
	go func() {
		h.hub.PublishEvents([]wire.Event{{ID: "e1"}})
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("PublishEvent menunggu klien yang lambat")
	}

	if h.hub.ClientCount() != 0 {
		t.Error("klien yang lambat seharusnya dikeluarkan dari hub")
	}
	select {
	case <-slow.done:
	default:
		t.Error("klien yang lambat seharusnya diminta menutup koneksi")
	}
	if slow.closeCode != websocket.ClosePolicyViolation {
		t.Errorf("kode close = %d, want %d", slow.closeCode, websocket.ClosePolicyViolation)
	}
}

func TestIdleClientStaysConnectedWhileAnsweringPings(t *testing.T) {
	h := newHarness(t, func(o *Options) {
		o.PingPeriod = 30 * time.Millisecond
		o.PongWait = 200 * time.Millisecond
	})
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	// Membaca membuat gorilla menjawab ping dengan pong otomatis.
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	time.Sleep(600 * time.Millisecond) // tiga kali PongWait
	if h.hub.ClientCount() != 1 {
		t.Error("klien yang menjawab ping tidak boleh diputus")
	}
}

func TestDeadClientIsRemovedWhenPongsStop(t *testing.T) {
	h := newHarness(t, func(o *Options) {
		o.PingPeriod = 30 * time.Millisecond
		o.PongWait = 150 * time.Millisecond
	})
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)
	// Klien tidak lagi membaca sehingga tidak ada pong yang terkirim.
	waitFor(t, "klien yang mati dikeluarkan", func() bool { return h.hub.ClientCount() == 0 })
}

func TestRunBroadcastsOnItsOwnAndStopsClientsOnShutdown(t *testing.T) {
	h := newHarness(t, func(o *Options) {
		o.Interval = 20 * time.Millisecond
		o.Delay = time.Millisecond
		o.Now = time.Now
	})
	// Router melapor untuk detik berjalan, supaya delta pertama membawa traffic.
	go func() {
		for i := 0; i < 200; i++ {
			_, _ = h.mgr.RecordTraffic("r1", state.TrafficPoint{Time: time.Now().Unix(), RxMbps: 5})
			time.Sleep(10 * time.Millisecond)
		}
	}()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { h.hub.Run(ctx); close(done) }()

	conn, _, err := h.dial(testOrigin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	token, _ := h.tokens.Issue("user-1", time.Now(), time.Minute)
	if err := conn.WriteJSON(authMessage{Type: typeAuth, Token: token}); err != nil {
		t.Fatal(err)
	}
	readAs[snapshotMessage](t, conn, typeSnapshot)

	// Ticker hub sendiri (tanpa tickAt) harus menghasilkan delta. Detik berganti
	// paling lama 1 detik sekali, jadi beri waktu secukupnya.
	_ = conn.SetReadDeadline(time.Now().Add(4 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("tidak ada delta dari Run: %v", err)
	}
	if !strings.Contains(string(data), `"type":"delta"`) {
		t.Errorf("pesan = %s, want delta", data)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run tidak berhenti setelah ctx dibatalkan")
	}
	// Koneksi ditutup dengan "going away" (pesan delta yang sudah antre boleh
	// lebih dulu terbaca).
	for {
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, _, err := conn.ReadMessage()
		var closeErr *websocket.CloseError
		if errors.As(err, &closeErr) {
			if closeErr.Code != websocket.CloseGoingAway {
				t.Errorf("kode close = %d, want %d", closeErr.Code, websocket.CloseGoingAway)
			}
			break
		}
		if err != nil {
			t.Fatalf("seharusnya frame close, dapat %v", err)
		}
	}

	// Setelah berhenti, koneksi baru ditolak.
	late, _, err := h.dial(testOrigin)
	if err == nil {
		defer late.Close()
		_ = late.WriteJSON(authMessage{Type: typeAuth, Token: token})
		if code := closeCodeOf(t, late); code != websocket.CloseTryAgainLater {
			t.Errorf("koneksi setelah shutdown: kode close = %d, want %d", code, websocket.CloseTryAgainLater)
		}
	}
}

func TestSendBufferIsRaisedToFitACatchUpBurst(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.SendBuffer = 1 })
	if h.hub.opts.SendBuffer < maxCatchUp {
		t.Errorf("SendBuffer = %d, want setidaknya %d agar kejar-ketinggalan tidak memutus klien sehat", h.hub.opts.SendBuffer, maxCatchUp)
	}
}

func TestStatusChangeIsFlushedImmediatelyWhenEnabled(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StatusFlush = 20 * time.Millisecond })
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	// Tidak ada tick sama sekali: perubahan harus tetap sampai dalam waktu singkat.
	started := time.Now()
	change, _ := h.mgr.SetOnline("budi", false)
	h.hub.NotifyChange(change)
	status := readAs[statusMessage](t, conn, typeStatus)
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Errorf("perubahan tiba setelah %s, want jauh di bawah 1 detik", elapsed)
	}
	if len(status.StatusChanges) != 1 || status.StatusChanges[0].CustomerID != "c1" || status.StatusChanges[0].IsOnline {
		t.Errorf("StatusChanges = %+v, want c1 offline", status.StatusChanges)
	}

	// Sudah terkirim, jadi delta detik berikutnya tidak membawanya lagi.
	tickAt(h, 1)
	if d := readAs[deltaMessage](t, conn, typeDelta); len(d.StatusChanges) != 0 {
		t.Errorf("perubahan terkirim dua kali: %+v", d.StatusChanges)
	}
}

func TestStatusFlushCoalescesChangesWithinTheWindow(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StatusFlush = 100 * time.Millisecond })
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	a, _ := h.mgr.SetOnline("budi", false)
	h.hub.NotifyChange(a)
	b, _ := h.mgr.SetOnline("siti", true)
	h.hub.NotifyChange(b)

	status := readAs[statusMessage](t, conn, typeStatus)
	if len(status.StatusChanges) != 2 {
		t.Errorf("StatusChanges = %+v, want dua perubahan dalam satu pesan", status.StatusChanges)
	}
}

func TestNoStatusMessageWhenFlushDisabled(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	change, _ := h.mgr.SetOnline("budi", false)
	h.hub.NotifyChange(change)
	time.Sleep(200 * time.Millisecond)
	// Tetap sampai lewat delta per detik. Bila ada pesan status yang bocor, ia
	// akan tiba lebih dulu dan readAs menggagalkan test.
	tickAt(h, 1)
	if d := readAs[deltaMessage](t, conn, typeDelta); len(d.StatusChanges) != 1 {
		t.Errorf("StatusChanges = %+v, want 1", d.StatusChanges)
	}
}

func TestShutdownCancelsPendingStatusFlush(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StatusFlush = 50 * time.Millisecond })
	change, _ := h.mgr.SetOnline("budi", false)
	h.hub.NotifyChange(change)
	h.hub.shutdown()
	time.Sleep(120 * time.Millisecond) // timer yang lupa dibatalkan akan menyiarkan ke hub yang sudah tutup
	if h.hub.ClientCount() != 0 {
		t.Error("hub yang sudah berhenti tidak boleh punya klien")
	}
}

// Router mati: ratusan pelanggan menjadi gangguan pada detik yang sama. Satu
// pesan berisi daftar tidak boleh membuat dashboard dianggap lambat dan diputus.
func TestLargeEventBurstIsOneMessageAndDoesNotDropTheClient(t *testing.T) {
	h := newHarness(t, nil)
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	burst := make([]wire.Event, 0, 500)
	for i := 0; i < 500; i++ {
		burst = append(burst, wire.Event{ID: "e" + strconv.Itoa(i), Kind: "offline", Severity: "warning", Active: true, Time: t0})
	}
	h.hub.PublishEvents(burst)

	msg := readAs[eventsMessage](t, conn, typeEvents)
	if len(msg.Events) != 500 {
		t.Errorf("jumlah event = %d, want 500 dalam satu pesan", len(msg.Events))
	}
	if h.hub.ClientCount() != 1 {
		t.Error("klien diputus karena banjir event")
	}
	// Tetap berfungsi sesudahnya.
	tickAt(h, 1)
	readAs[deltaMessage](t, conn, typeDelta)

	h.hub.PublishEvents(nil) // kosong tidak mengirim apa pun
	tickAt(h, 2)
	readAs[deltaMessage](t, conn, typeDelta)
}

func TestConnectionIsClosedForReauthAfterMaxAge(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxConnectionAge = 150 * time.Millisecond })
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot) // tersambung dan berfungsi dulu

	if code := closeCodeOf(t, conn); code != CloseReauth {
		t.Errorf("kode close = %d, want %d (perlu tiket baru)", code, CloseReauth)
	}
	waitFor(t, "klien dilepas dari hub", func() bool { return h.hub.ClientCount() == 0 })

	// Menyambung ulang dengan tiket baru langsung berhasil.
	again := h.connect()
	readAs[snapshotMessage](t, again, typeSnapshot)
}

func TestConnectionAgeLimitCanBeDisabledAndDefaultsToThirtyMinutes(t *testing.T) {
	if h := newHarness(t, nil); h.hub.opts.MaxConnectionAge != 30*time.Minute {
		t.Errorf("default = %s, want 30 menit", h.hub.opts.MaxConnectionAge)
	}
	h := newHarness(t, func(o *Options) { o.MaxConnectionAge = -1 })
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)
	time.Sleep(200 * time.Millisecond)
	if h.hub.ClientCount() != 1 {
		t.Error("batas yang dimatikan tidak boleh menutup koneksi")
	}
}

func TestReauthTimerIsStoppedWhenTheClientLeavesEarly(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxConnectionAge = 200 * time.Millisecond })
	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)
	conn.Close()
	waitFor(t, "klien dilepas", func() bool { return h.hub.ClientCount() == 0 })
	time.Sleep(300 * time.Millisecond) // timer yang lupa dihentikan akan menyentuh klien yang sudah pergi
	if h.hub.ClientCount() != 0 {
		t.Error("hub memiliki klien yang seharusnya sudah pergi")
	}
}

func TestTelemetryIsReplayedToNewClientsAndBroadcastToConnectedOnes(t *testing.T) {
	h := newHarness(t, nil)
	early := h.connect()
	readAs[snapshotMessage](t, early, typeSnapshot)

	cpu := 42
	h.hub.PublishTelemetry(wire.Telemetry{Routers: []wire.RouterTelemetry{{CPULoad: &cpu}}})
	got := readAs[telemetryMessage](t, early, typeTelemetry)
	if got.Data.Routers[0].CPULoad == nil || *got.Data.Routers[0].CPULoad != 42 {
		t.Fatalf("klien tersambung harus menerima telemetri segera: %+v", got.Data)
	}

	late := h.connect()
	readAs[snapshotMessage](t, late, typeSnapshot)
	got = readAs[telemetryMessage](t, late, typeTelemetry)
	if got.Data.Routers[0].CPULoad == nil || *got.Data.Routers[0].CPULoad != 42 {
		t.Fatalf("klien baru harus menerima telemetri terakhir setelah snapshot: %+v", got.Data)
	}
}
