package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/engine"
	"noc-isp/backend/internal/wire"
)

// Dari "router" sampai layar: webhook PPP -> state -> hub -> klien WebSocket.
// Target PRD: perubahan online/offline tampil kurang dari 1 detik.
func TestPPPWebhookReachesDashboardWithinASecond(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StatusFlush = 50 * time.Millisecond })
	const token = "0123456789abcdef0123456789abcdef"
	webhook, err := collector.NewWebhookHandler(collector.WebhookOptions{
		Token: token, Presence: h.mgr, Notify: h.hub.NotifyChange, Logger: h.hub.opts.Logger,
	})
	if err != nil {
		t.Fatal(err)
	}
	hookServer := httptest.NewServer(webhook)
	defer hookServer.Close()

	conn := h.connect()
	snap := readAs[snapshotMessage](t, conn, typeSnapshot)
	if !snap.Customers[0].IsOnline {
		t.Fatal("budi seharusnya online di snapshot awal")
	}

	// Script PPP on-down di router: tidak ada tick hub sama sekali di sini.
	form := url.Values{"event": {"down"}, "user": {"budi"}}
	req, _ := http.NewRequest(http.MethodPost, hookServer.URL, strings.NewReader(form.Encode()))
	req.Header.Set("X-Webhook-Token", token)
	started := time.Now()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("webhook status = %d, want 200", resp.StatusCode)
	}

	status := readAs[statusMessage](t, conn, typeStatus)
	elapsed := time.Since(started)
	if len(status.StatusChanges) != 1 || status.StatusChanges[0].CustomerID != "c1" || status.StatusChanges[0].IsOnline {
		t.Fatalf("StatusChanges = %+v, want c1 offline", status.StatusChanges)
	}
	if elapsed >= time.Second {
		t.Errorf("dari webhook sampai klien = %s, want < 1 detik", elapsed)
	}
	t.Logf("webhook -> klien WebSocket: %s", elapsed)

	// Dashboard baru yang tersambung sesudahnya langsung melihat keadaan terbaru.
	late := h.connect()
	if got := readAs[snapshotMessage](t, late, typeSnapshot); got.Customers[0].IsOnline {
		t.Error("snapshot untuk klien baru masih menampilkan budi online")
	}
}

// Seluruh jalur: webhook PPP -> state -> rule engine -> hub -> klien WebSocket.
// Batas "offline lama" dipercepat dari 30 detik menjadi 100 ms agar test cepat.
func TestOfflineAlertFlowsFromWebhookToTheDashboard(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StatusFlush = 20 * time.Millisecond })
	const token = "0123456789abcdef0123456789abcdef"
	webhook, err := collector.NewWebhookHandler(collector.WebhookOptions{
		Token: token, Presence: h.mgr, Notify: h.hub.NotifyChange, Logger: h.hub.opts.Logger,
	})
	if err != nil {
		t.Fatal(err)
	}
	hookServer := httptest.NewServer(webhook)
	defer hookServer.Close()

	// Siti offline sejak fixture dibuat; online-kan agar hanya Budi yang diuji.
	if _, err := h.mgr.SetOnline("siti", true); err != nil {
		t.Fatal(err)
	}

	alerts, err := engine.New(engine.Options{
		Logger:   h.hub.opts.Logger,
		Source:   h.mgr,
		Rules:    []engine.Rule{engine.OfflineRule{After: 100 * time.Millisecond}},
		Interval: 10 * time.Millisecond,
		Sink:     func(events []engine.Event) { h.hub.PublishEvents(wire.NewEvents(events)) },
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go alerts.Run(ctx)

	post := func(event string) {
		t.Helper()
		form := url.Values{"event": {event}, "user": {"budi"}}
		req, _ := http.NewRequest(http.MethodPost, hookServer.URL, strings.NewReader(form.Encode()))
		req.Header.Set("X-Webhook-Token", token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("webhook %s: status = %d", event, resp.StatusCode)
		}
	}

	conn := h.connect()
	readAs[snapshotMessage](t, conn, typeSnapshot)

	post("down")
	// Dashboard melihat pelanggan offline (pesan status) dan, setelah batasnya
	// lewat, gangguannya diumumkan (pesan events), masing-masing tepat sekali.
	first := readExactlyOnce(t, conn, typeStatus, typeEvents)
	var started eventsMessage
	if err := json.Unmarshal(first[typeEvents], &started); err != nil {
		t.Fatal(err)
	}
	if len(started.Events) != 1 || !started.Events[0].Active || started.Events[0].CustomerID != "c1" || started.Events[0].Kind != "offline" {
		t.Fatalf("event mulai = %+v", started.Events)
	}
	if started.Events[0].Detail["pppoeUsername"] != "budi" {
		t.Errorf("Detail = %v", started.Events[0].Detail)
	}

	// Engine terus mengevaluasi tiap 10 ms, tetapi gangguan yang sama tidak
	// diumumkan lagi. Pesan berikutnya harus event selesai, bukan pengulangan.
	time.Sleep(150 * time.Millisecond)
	post("up")
	second := readExactlyOnce(t, conn, typeStatus, typeEvents)
	var ended eventsMessage
	if err := json.Unmarshal(second[typeEvents], &ended); err != nil {
		t.Fatal(err)
	}
	if len(ended.Events) != 1 || ended.Events[0].Active || ended.Events[0].ID != started.Events[0].ID {
		t.Fatalf("event selesai = %+v, want ID %q dan Active=false", ended.Events, started.Events[0].ID)
	}
}

// readExactlyOnce membaca pesan sampai semua tipe yang diminta muncul, dalam
// urutan apa pun, dan gagal bila ada tipe lain atau satu tipe tiba dua kali.
func readExactlyOnce(t *testing.T, conn *websocket.Conn, types ...string) map[string][]byte {
	t.Helper()
	got := make(map[string][]byte)
	for len(got) < len(types) {
		data := readRaw(t, conn)
		var head struct{ Type string }
		if err := json.Unmarshal(data, &head); err != nil {
			t.Fatalf("pesan bukan JSON: %s", data)
		}
		if !slices.Contains(types, head.Type) {
			t.Fatalf("pesan tak terduga bertipe %q: %s", head.Type, data)
		}
		if _, dup := got[head.Type]; dup {
			t.Fatalf("pesan bertipe %q tiba dua kali: %s", head.Type, data)
		}
		got[head.Type] = data
	}
	return got
}
