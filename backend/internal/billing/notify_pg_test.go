package billing

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/hub"
	"noc-isp/backend/internal/state"
)

// Dari sinkron billing sampai dashboard: Syncer, Store (PostgreSQL sekali pakai),
// Scraper terhadap server billing tiruan, state.Manager, dan hub dengan klien
// WebSocket sungguhan. Dilewati tanpa TEST_DATABASE_URL.

type wsDelta struct {
	Type           string `json:"type"`
	Time           int64  `json:"time"`
	BillingChanges []struct {
		CustomerID string `json:"customerId"`
		Status     string `json:"status"`
	} `json:"billingChanges"`
}

type wsClient struct {
	t    *testing.T
	conn *websocket.Conn
}

func dialHub(t *testing.T, srv *httptest.Server, tokens *auth.Tokens) (*wsClient, map[string]string) {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+srv.URL[len("http"):], nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	token, err := tokens.Issue("user-1", time.Now(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(map[string]string{"type": "auth", "token": token}); err != nil {
		t.Fatal(err)
	}
	c := &wsClient{t: t, conn: conn}
	var snap struct {
		Type      string `json:"type"`
		Customers []struct {
			ID            string `json:"id"`
			BillingStatus string `json:"billingStatus"`
		} `json:"customers"`
	}
	raw := c.read(5 * time.Second)
	if err := json.Unmarshal(raw, &snap); err != nil || snap.Type != "snapshot" {
		t.Fatalf("pesan pertama = %s, want snapshot", raw)
	}
	statuses := map[string]string{}
	for _, cu := range snap.Customers {
		statuses[cu.ID] = cu.BillingStatus
	}
	return c, statuses
}

func (c *wsClient) read(timeout time.Duration) []byte {
	c.t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(timeout))
	_, data, err := c.conn.ReadMessage()
	if err != nil {
		c.t.Fatalf("baca pesan: %v", err)
	}
	return data
}

// nextBillingChanges membaca delta sampai ada yang memuat billingChanges (id -> status);
// gagal bila tidak ada sampai timeout.
func (c *wsClient) nextBillingChanges(timeout time.Duration) map[string]string {
	c.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		var d wsDelta
		if err := json.Unmarshal(c.read(time.Until(deadline)), &d); err != nil || d.Type != "delta" {
			continue
		}
		if len(d.BillingChanges) > 0 {
			out := map[string]string{}
			for _, b := range d.BillingChanges {
				out[b.CustomerID] = b.Status
			}
			return out
		}
	}
	c.t.Fatal("tidak ada delta dengan billingChanges sampai batas waktu")
	return nil
}

// assertNoBillingChanges membaca n delta berikutnya dan gagal bila satu pun memuat
// billingChanges (atau kuncinya). Membaca per pesan, bukan sampai batas waktu:
// batas waktu baca yang lewat membuat koneksi gorilla tidak bisa dibaca lagi.
func (c *wsClient) assertNoBillingChanges(n int, why string) {
	c.t.Helper()
	for seen := 0; seen < n; {
		data := c.read(5 * time.Second)
		var raw map[string]json.RawMessage
		if json.Unmarshal(data, &raw) != nil || string(raw["type"]) != `"delta"` {
			continue
		}
		seen++
		if _, has := raw["billingChanges"]; has {
			c.t.Fatalf("%s: delta memuat billingChanges: %s", why, data)
		}
	}
}

func TestSyncStatusChangesReachDashboardsThroughRealSyncerStoreManagerAndHub(t *testing.T) {
	f := newPGFixture(t)
	cs, rows := seedCustomers(f) // a lunas->isolir, b tetap, c isolir->lunas, d tanpa tagihan, e isolir->lunas
	fake := newFake(t, rows)

	// Manager hanya memuat a, b, c, d. e sengaja tidak dikenal: perubahannya harus
	// diabaikan tanpa mengganggu yang lain.
	mgr := state.NewManager()
	if err := mgr.UpsertRouter(state.Router{ID: "r1", Name: "RTR", Host: "10.0.0.1", Active: true}); err != nil {
		t.Fatal(err)
	}
	for _, label := range []string{"a", "b", "c", "d"} {
		c := cs[label]
		if err := mgr.UpsertCustomer(state.Customer{
			ID: c.ID, Name: "Uji " + label, PPPoEUsername: c.PPPoE, RouterID: "r1",
			BillingStatus: string(c.Status), IsOnline: true,
		}); err != nil {
			t.Fatal(err)
		}
	}

	var calls atomic.Int32
	sink := func(changes []StatusChange) error {
		calls.Add(1)
		// Pendengar berjalan SESUDAH commit: koneksi lain (di luar transaksi) sudah
		// melihat status baru di database.
		for _, change := range changes {
			var got string
			if err := f.pool.QueryRow(context.Background(),
				`SELECT billing_status FROM customers WHERE id = $1::uuid`, change.CustomerID).Scan(&got); err != nil {
				t.Errorf("baca status di pendengar: %v", err)
			} else if got != string(change.To) {
				t.Errorf("saat pendengar berjalan customers.billing_status %s = %q, want %q (belum ter-commit?)", change.CustomerID, got, change.To)
			}
		}
		mapped := make([]state.BillingChange, len(changes))
		for i, c := range changes {
			mapped[i] = state.BillingChange{CustomerID: c.CustomerID, Status: string(c.To)}
		}
		mgr.SetBillingStatuses(mapped)
		return nil
	}

	tokens, err := auth.NewTokens("0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	dashboardHub := hub.New(mgr, hub.Options{
		Verifier: tokens, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Interval: 20 * time.Millisecond, Delay: time.Millisecond,
	})
	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan struct{})
	go func() { dashboardHub.Run(ctx); close(runDone) }()
	srv := httptest.NewServer(dashboardHub)
	t.Cleanup(func() { srv.Close(); cancel(); <-runDone })

	rig := newPGSyncRig(t, f, fake, nil, func(o *SyncerOptions) { o.OnStatusChanges = sink })

	first, before := dialHub(t, srv, tokens)
	if before[cs["a"].ID] != "lunas" || before[cs["c"].ID] != "isolir" {
		t.Fatalf("snapshot awal = %v", before)
	}

	// 1. Sinkron berhasil: a menjadi isolir dan c menjadi lunas, dan hanya itu.
	if out, err := rig.run(t); err != nil || out.Status != RunSuccess || out.NotifyErr != nil {
		t.Fatalf("sinkron 1 = %+v, %v", out, err)
	}
	got := first.nextBillingChanges(6 * time.Second)
	if want := map[string]string{cs["a"].ID: "isolir", cs["c"].ID: "lunas"}; len(got) != 2 || got[cs["a"].ID] != "isolir" || got[cs["c"].ID] != "lunas" {
		t.Fatalf("billingChanges = %v, want %v (b tidak berubah, d tanpa tagihan, e tidak dikenal)", got, want)
	}
	first.assertNoBillingChanges(2, "sesudah pengiriman pertama")

	// 2. Klien yang tersambung sesudah sinkron membaca status baru dari snapshot.
	second, after := dialHub(t, srv, tokens)
	want := map[string]string{cs["a"].ID: "isolir", cs["b"].ID: "lunas", cs["c"].ID: "lunas", cs["d"].ID: "lunas"}
	for id, status := range want {
		if after[id] != status {
			t.Errorf("snapshot klien baru: %s = %q, want %q", id, after[id], status)
		}
	}
	second.assertNoBillingChanges(2, "klien yang tersambung sesudah sinkron")

	// 3. Sinkron yang tidak mengubah apa pun: pendengar dipanggil, dashboard tidak.
	if out, err := rig.run(t); err != nil || out.Status != RunSuccess || out.Counts.StatusesChanged != 0 {
		t.Fatalf("sinkron 2 = %+v, %v", out, err)
	}
	if n := calls.Load(); n != 2 {
		t.Errorf("pendengar dipanggil %d kali, want 2 (sekali per sinkron berhasil)", n)
	}
	second.assertNoBillingChanges(2, "sinkron tanpa perubahan")

	// 4. Sinkron yang gagal (login ditolak) tidak mengubah database, Manager, maupun dashboard.
	bad := newPGSyncRig(t, f, fake, func(c *Config) { c.Password = "kata-sandi-salah-777" },
		func(o *SyncerOptions) { o.OnStatusChanges = sink })
	fake.mu.Lock()
	fake.rows[0].Status = "Lunas" // a kembali lunas di billing, tetapi sinkron ini tidak membacanya
	fake.mu.Unlock()
	if out, err := bad.run(t); err == nil || out.Status != RunFailed {
		t.Fatalf("sinkron gagal = %+v, %v", out, err)
	}
	if n := calls.Load(); n != 2 {
		t.Errorf("pendengar dipanggil pada sinkron gagal (total %d)", n)
	}
	if st := f.customerStatuses()[cs["a"].ID]; st != StatusIsolir {
		t.Errorf("database berubah oleh sinkron gagal: a = %q", st)
	}
	second.assertNoBillingChanges(2, "sinkron gagal")

	// 5. Sinkron berikutnya membawa a kembali ke lunas, dan hanya a.
	if out, err := rig.run(t); err != nil || out.Status != RunSuccess {
		t.Fatalf("sinkron 3 = %+v, %v", out, err)
	}
	back := second.nextBillingChanges(6 * time.Second)
	if len(back) != 1 || back[cs["a"].ID] != "lunas" {
		t.Errorf("billingChanges = %v, want hanya a lunas", back)
	}
}
