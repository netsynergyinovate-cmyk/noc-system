package collector

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

const webhookToken = "0123456789abcdef0123456789abcdef"

type eventHarness struct {
	t      *testing.T
	mgr    *state.Manager
	notify *changeLog
}

type changeLog struct {
	mu      sync.Mutex
	changes []state.Change
}

func (c *changeLog) add(change state.Change) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.changes = append(c.changes, change)
}

func (c *changeLog) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.changes)
}

// newEventHarness: r1 (10.0.0.1) memiliki budi (online) dan dewi (offline);
// r2 (10.0.0.2) memiliki siti (offline).
func newEventHarness(t *testing.T, r1Host string) *eventHarness {
	t.Helper()
	mgr := state.NewManager()
	for _, r := range []state.Router{
		{ID: "r1", Name: "RTR-1", Host: r1Host, Active: true},
		{ID: "r2", Name: "RTR-2", Host: "10.0.0.2", Active: true},
	} {
		if err := mgr.UpsertRouter(r); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range []state.Customer{
		{ID: "c1", Name: "Budi", PPPoEUsername: "budi", RouterID: "r1", IsOnline: true},
		{ID: "c2", Name: "Siti", PPPoEUsername: "siti", RouterID: "r2", IsOnline: false},
		{ID: "c3", Name: "Dewi", PPPoEUsername: "dewi", RouterID: "r1", IsOnline: false},
	} {
		if err := mgr.UpsertCustomer(c); err != nil {
			t.Fatal(err)
		}
	}
	return &eventHarness{t: t, mgr: mgr, notify: &changeLog{}}
}

func (h *eventHarness) online(user string) bool {
	h.t.Helper()
	c, ok := h.mgr.CustomerByPPPoE(user)
	if !ok {
		h.t.Fatalf("pelanggan %q tidak ada", user)
	}
	return c.IsOnline
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// ---- webhook ----

func (h *eventHarness) webhook() http.Handler {
	h.t.Helper()
	handler, err := NewWebhookHandler(WebhookOptions{
		Token: webhookToken, Presence: h.mgr, Notify: h.notify.add, Logger: discardLogger(),
	})
	if err != nil {
		h.t.Fatal(err)
	}
	return handler
}

type hookRequest struct {
	method  string
	target  string
	body    string
	headers map[string]string
}

func (h *eventHarness) send(handler http.Handler, r hookRequest) *httptest.ResponseRecorder {
	h.t.Helper()
	if r.method == "" {
		r.method = http.MethodPost
	}
	req := httptest.NewRequest(r.method, r.target, strings.NewReader(r.body))
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func formPost(body string) hookRequest {
	return hookRequest{
		target: "/hooks/ppp", body: body,
		headers: map[string]string{"X-Webhook-Token": webhookToken, "Content-Type": "application/x-www-form-urlencoded"},
	}
}

func TestWebhookRequiresTheToken(t *testing.T) {
	h := newEventHarness(t, "10.0.0.1")
	handler := h.webhook()
	cases := map[string]hookRequest{
		"tanpa token":     {target: "/hooks/ppp", body: "event=down&user=budi"},
		"token salah":     {target: "/hooks/ppp", body: "event=down&user=budi", headers: map[string]string{"X-Webhook-Token": "salah"}},
		"token di query":  {method: http.MethodGet, target: "/hooks/ppp?event=down&user=budi&token=" + webhookToken},
		"skema Basic":     {target: "/hooks/ppp", body: "event=down&user=budi", headers: map[string]string{"Authorization": "Basic " + webhookToken}},
		"Bearer kosong":   {target: "/hooks/ppp", body: "event=down&user=budi", headers: map[string]string{"Authorization": "Bearer "}},
		"token terpotong": {target: "/hooks/ppp", body: "event=down&user=budi", headers: map[string]string{"X-Webhook-Token": webhookToken[:20]}},
	}
	for name, req := range cases {
		rec := h.send(handler, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", name, rec.Code)
		}
		if strings.Contains(rec.Body.String(), webhookToken) {
			t.Errorf("%s: jawaban memuat token", name)
		}
	}
	if !h.online("budi") || h.notify.count() != 0 {
		t.Error("permintaan tanpa token tidak boleh mengubah state atau memicu notifikasi")
	}
}

func TestWebhookAcceptsHeaderOrBearer(t *testing.T) {
	h := newEventHarness(t, "10.0.0.1")
	handler := h.webhook()

	rec := h.send(handler, hookRequest{target: "/hooks/ppp", body: "event=down&user=budi", headers: map[string]string{"Authorization": "bearer " + webhookToken}})
	if rec.Code != http.StatusOK {
		t.Fatalf("Bearer: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	rec = h.send(handler, formPost("event=up&user=budi"))
	if rec.Code != http.StatusOK {
		t.Fatalf("X-Webhook-Token: status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestWebhookAppliesEventsAndNotifiesOnlyOnChange(t *testing.T) {
	h := newEventHarness(t, "10.0.0.1")
	handler := h.webhook()

	rec := h.send(handler, formPost("event=down&user=budi"))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"changed":true`) {
		t.Fatalf("status = %d, body = %s; want 200 changed true", rec.Code, rec.Body.String())
	}
	if h.online("budi") {
		t.Error("budi seharusnya offline setelah event down")
	}
	if h.notify.count() != 1 {
		t.Errorf("notifikasi = %d, want 1", h.notify.count())
	}

	// Event yang sama dikirim lagi (router mengulang, atau syslog menyusul).
	rec = h.send(handler, formPost("event=down&user=budi"))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"changed":false`) {
		t.Errorf("event ulang: status = %d, body = %s; want 200 changed false", rec.Code, rec.Body.String())
	}
	if h.notify.count() != 1 {
		t.Errorf("event ulang memicu notifikasi: %d, want tetap 1", h.notify.count())
	}

	if rec = h.send(handler, formPost("event=up&user=budi")); rec.Code != http.StatusOK || !h.online("budi") {
		t.Errorf("event up: status = %d, online = %v", rec.Code, h.online("budi"))
	}
	if h.notify.count() != 2 {
		t.Errorf("notifikasi = %d, want 2", h.notify.count())
	}
}

func TestWebhookSupportsQueryAndJSON(t *testing.T) {
	h := newEventHarness(t, "10.0.0.1")
	handler := h.webhook()

	// Cara paling sederhana di RouterOS: GET dengan query.
	rec := h.send(handler, hookRequest{method: http.MethodGet, target: "/hooks/ppp?event=up&user=siti&router=r2", headers: map[string]string{"X-Webhook-Token": webhookToken}})
	if rec.Code != http.StatusOK || !h.online("siti") {
		t.Fatalf("GET: status = %d, siti online = %v", rec.Code, h.online("siti"))
	}

	rec = h.send(handler, hookRequest{
		target: "/hooks/ppp", body: `{"event":"down","user":"siti","router":"r2"}`,
		headers: map[string]string{"X-Webhook-Token": webhookToken, "Content-Type": "application/json"},
	})
	if rec.Code != http.StatusOK || h.online("siti") {
		t.Fatalf("JSON: status = %d, siti online = %v", rec.Code, h.online("siti"))
	}
}

func TestWebhookAcceptsPRDPPPProfilePayload(t *testing.T) {
	h := newEventHarness(t, "10.0.0.1")
	handler := h.webhook()
	headers := map[string]string{"X-Webhook-Token": webhookToken, "Content-Type": "application/json"}

	// Persis bentuk http-data pada PRD (script On Up / On Down).
	up := `{"event":"up","user":"budi","interface":"<pppoe-budi>","address":"10.20.0.55"}`
	rec := h.send(handler, hookRequest{target: "/hooks/ppp", body: up, headers: headers})
	if rec.Code != http.StatusOK || !h.online("budi") {
		t.Fatalf("payload PRD up: status=%d body=%s online=%v", rec.Code, rec.Body.String(), h.online("budi"))
	}
	down := `{"event":"down","user":"budi","interface":"<pppoe-budi>","address":"10.20.0.55"}`
	rec = h.send(handler, hookRequest{target: "/hooks/ppp", body: down, headers: headers})
	if rec.Code != http.StatusOK || h.online("budi") {
		t.Fatalf("payload PRD down: status=%d body=%s online=%v", rec.Code, rec.Body.String(), h.online("budi"))
	}
}

func TestWebhookRejectsMalformedRequests(t *testing.T) {
	h := newEventHarness(t, "10.0.0.1")
	handler := h.webhook()
	jsonHeaders := map[string]string{"X-Webhook-Token": webhookToken, "Content-Type": "application/json"}

	cases := map[string]hookRequest{
		"tanpa event":            formPost("user=budi"),
		"event salah":            formPost("event=UP&user=budi"),
		"event bukan up/down":    formPost("event=restart&user=budi"),
		"tanpa user":             formPost("event=down"),
		"user kosong":            formPost("event=down&user="),
		"user memuat newline":    formPost("event=down&user=" + url.QueryEscape("budi\nsiti")),
		"user terlalu panjang":   formPost("event=down&user=" + strings.Repeat("a", 129)),
		"parameter tak dikenal":  formPost("event=down&user=budi&admin=1"),
		"parameter diulang":      formPost("event=down&user=budi&user=siti"),
		"router memuat kontrol":  formPost("event=down&user=budi&router=" + url.QueryEscape("r1\x00")),
		"body terlalu besar":     formPost("event=down&user=budi&x=" + strings.Repeat("a", 5000)),
		"JSON rusak":             {target: "/hooks/ppp", body: "{", headers: jsonHeaders},
		"JSON field tak dikenal": {target: "/hooks/ppp", body: `{"event":"down","user":"budi","admin":true}`, headers: jsonHeaders},
	}
	for name, req := range cases {
		rec := h.send(handler, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400 (body %s)", name, rec.Code, rec.Body.String())
		}
	}
	if !h.online("budi") || h.notify.count() != 0 {
		t.Error("permintaan yang ditolak tidak boleh mengubah state")
	}
}

func TestWebhookUnknownCustomerAndRouterMismatch(t *testing.T) {
	h := newEventHarness(t, "10.0.0.1")
	handler := h.webhook()

	if rec := h.send(handler, formPost("event=down&user=orang-asing")); rec.Code != http.StatusNotFound {
		t.Errorf("pelanggan tak dikenal: status = %d, want 404", rec.Code)
	}
	// budi milik r1; r2 tidak boleh mengubahnya.
	rec := h.send(handler, formPost("event=down&user=budi&router=r2"))
	if rec.Code != http.StatusConflict {
		t.Errorf("router tidak cocok: status = %d, want 409", rec.Code)
	}
	if !h.online("budi") || h.notify.count() != 0 {
		t.Error("router yang salah tidak boleh mengubah status pelanggan")
	}
	if rec := h.send(handler, formPost("event=down&user=budi&router=r1")); rec.Code != http.StatusOK {
		t.Errorf("router cocok: status = %d, want 200", rec.Code)
	}
}

func TestWebhookMethodsAndConstruction(t *testing.T) {
	h := newEventHarness(t, "10.0.0.1")
	handler := h.webhook()
	rec := h.send(handler, hookRequest{method: http.MethodPut, target: "/hooks/ppp", headers: map[string]string{"X-Webhook-Token": webhookToken}})
	if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != "GET, POST" {
		t.Errorf("PUT: status = %d, Allow = %q", rec.Code, rec.Header().Get("Allow"))
	}

	if _, err := NewWebhookHandler(WebhookOptions{Token: "pendek", Presence: h.mgr, Logger: discardLogger()}); err == nil {
		t.Error("token pendek seharusnya ditolak")
	}
	if _, err := NewWebhookHandler(WebhookOptions{Token: webhookToken, Logger: discardLogger()}); err == nil {
		t.Error("tanpa Presence seharusnya ditolak")
	}
	// Notify boleh kosong.
	quiet, err := NewWebhookHandler(WebhookOptions{Token: webhookToken, Presence: h.mgr, Logger: discardLogger()})
	if err != nil {
		t.Fatal(err)
	}
	if rec := h.send(quiet, formPost("event=down&user=budi")); rec.Code != http.StatusOK {
		t.Errorf("tanpa Notify: status = %d, want 200", rec.Code)
	}
}

// ---- syslog ----

func TestParseSyslog(t *testing.T) {
	tests := []struct {
		name string
		line string
		want PPPEvent
		ok   bool
	}{
		{"login", "<134>Oct  7 16:55:12 MikroTik ppp,info,account budi logged in, 10.0.0.2 from AA:BB:CC:DD:EE:FF", PPPEvent{"budi", true}, true},
		{"logout", "<134>Oct  7 16:58:01 MikroTik ppp,info,account budi logged out, 169 1200 3400 12 9", PPPEvent{"budi", false}, true},
		{"topik dengan titik dua", "<134>Oct  7 16:55:12 MikroTik ppp,info,account: siti logged in, 10.0.0.3", PPPEvent{"siti", true}, true},
		{"tanpa PRI dan waktu", "ppp,info,account andi.putra001 logged in, 1.2.3.4", PPPEvent{"andi.putra001", true}, true},
		{"nama pembungkus pppoe", "ppp,info,account <pppoe-budi> logged out, 5", PPPEvent{"budi", false}, true},
		{"RFC5424", "<134>1 2026-10-07T16:55:12+07:00 MikroTik - - - ppp,info,account budi logged in, 10.0.0.2", PPPEvent{"budi", true}, true},
		{"login admin (topik system)", "<134>Oct  7 16:55:12 MikroTik system,info,account user admin logged in from 192.168.88.2 via winbox", PPPEvent{}, false},
		{"logout admin (topik system)", "system,info,account user admin logged out from 192.168.88.2 via ssh", PPPEvent{}, false},
		{"topik mirip bukan ppp", "pppoe,info budi logged in, 1.2.3.4", PPPEvent{}, false},
		{"tanpa topik", "budi logged in, 10.0.0.2", PPPEvent{}, false},
		{"baris PPP lain", "<134>Oct  7 16:55:12 MikroTik ppp,info pppoe-in1: terminating... - session closed", PPPEvent{}, false},
		{"kosong", "", PPPEvent{}, false},
		{"tanpa username", "ppp,info,account logged in, 10.0.0.2", PPPEvent{}, false},
		{"username terlalu panjang", "ppp,info,account " + strings.Repeat("a", 200) + " logged in, 10.0.0.2", PPPEvent{}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := ParseSyslog(tt.line)
			if ok != tt.ok || got != tt.want {
				t.Errorf("ParseSyslog(%q) = %+v, %v; want %+v, %v", tt.line, got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestParseOLTLog(t *testing.T) {
	tests := []struct {
		name     string
		msg      string
		wantType string
		wantSev  string
		wantStat string
		wantPon  string
		wantOnu  string
		wantOk   bool
	}{
		{
			name:   "Closed connection false positive",
			msg:    "Connection closed on port 22",
			wantOk: false,
		},
		{
			name:   "Allocated memory false positive",
			msg:    "Allocated 100 buffers on port 1",
			wantOk: false,
		},
		{
			name:     "HSGQ LOS colon format",
			msg:      "<189>HSGQ-OLT: ONU 0/1:3 LOS alarm occurred",
			wantType: "fiber_cut",
			wantSev:  "critical",
			wantStat: "active",
			wantPon:  "0/1",
			wantOnu:  "3",
			wantOk:   true,
		},
		{
			name:     "HSGQ Dying Gasp word format",
			msg:      "<189>HSGQ-OLT: Dying Gasp alarm on PON 0/1 ONU 4",
			wantType: "power_outage",
			wantSev:  "warning",
			wantStat: "active",
			wantPon:  "0/1",
			wantOnu:  "4",
			wantOk:   true,
		},
		{
			name:     "ONU Recovery Online",
			msg:      "<189>HSGQ-OLT: ONU 0/1:3 online",
			wantType: "recovery",
			wantSev:  "info",
			wantStat: "resolved",
			wantPon:  "0/1",
			wantOnu:  "3",
			wantOk:   true,
		},
		{
			name:     "LOS alarm cleared",
			msg:      "<189>HSGQ-OLT: ONU 0/1:3 LOS alarm cleared",
			wantType: "fiber_cut",
			wantSev:  "info",
			wantStat: "resolved",
			wantPon:  "0/1",
			wantOnu:  "3",
			wantOk:   true,
		},
		{
			name:     "Dying Gasp recovered",
			msg:      "<189>HSGQ-OLT: Dying Gasp alarm on PON 0/1 ONU 4 recovered",
			wantType: "power_outage",
			wantSev:  "info",
			wantStat: "resolved",
			wantPon:  "0/1",
			wantOnu:  "4",
			wantOk:   true,
		},
		{
			name:     "Link Down PON only",
			msg:      "<189>HSGQ-OLT: Link Down on port 0/2",
			wantType: "fiber_cut",
			wantSev:  "critical",
			wantStat: "active",
			wantPon:  "0/2",
			wantOnu:  "",
			wantOk:   true,
		},
		{
			name:     "Link Up PON only",
			msg:      "<189>HSGQ-OLT: Link Up on port 0/2",
			wantType: "recovery",
			wantSev:  "info",
			wantStat: "resolved",
			wantPon:  "0/2",
			wantOnu:  "",
			wantOk:   true,
		},
		{
			name:     "ONU deregistered",
			msg:      "<189>HSGQ-OLT: ONU 0/1:5 deregistered",
			wantType: "onu_offline",
			wantSev:  "warning",
			wantStat: "active",
			wantPon:  "0/1",
			wantOnu:  "5",
			wantOk:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := ParseOLTLog(tt.msg, "10.0.0.10")
			if ok != tt.wantOk {
				t.Fatalf("ParseOLTLog() ok = %v, want %v", ok, tt.wantOk)
			}
			if !tt.wantOk {
				return
			}
			if got.Type != tt.wantType || got.Severity != tt.wantSev || got.Status != tt.wantStat || got.PonPort != tt.wantPon || got.OnuID != tt.wantOnu {
				t.Errorf("ParseOLTLog() = %+v; want type=%s sev=%s stat=%s pon=%s onu=%s",
					got, tt.wantType, tt.wantSev, tt.wantStat, tt.wantPon, tt.wantOnu)
			}
		})
	}
}

func TestRouterAddr(t *testing.T) {
	good := map[string]string{
		"10.0.0.1":              "10.0.0.1",
		"10.0.0.1:8728":         "10.0.0.1",
		"https://10.0.0.1":      "10.0.0.1",
		"https://10.0.0.1:443/": "10.0.0.1",
		"http://10.0.0.1:8080":  "10.0.0.1",
		"[2001:db8::1]:443":     "2001:db8::1",
		"::ffff:10.0.0.1":       "10.0.0.1",
	}
	for host, want := range good {
		addr, ok := routerAddr(host)
		if !ok || addr.String() != want {
			t.Errorf("routerAddr(%q) = %v, %v; want %s", host, addr, ok, want)
		}
	}
	for _, host := range []string{"router.contoh.id", "", "bukan-ip:80"} {
		if _, ok := routerAddr(host); ok {
			t.Errorf("routerAddr(%q) seharusnya gagal (nama host tidak diterjemahkan)", host)
		}
	}
}

type syslogRig struct {
	h        *eventHarness
	listener *SyslogListener
	cancel   context.CancelFunc
	done     chan error
}

func startSyslog(t *testing.T, r1Host string) *syslogRig {
	t.Helper()
	h := newEventHarness(t, r1Host)
	listener, err := ListenSyslog("127.0.0.1:0", h.mgr, h.notify.add, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- listener.Serve(ctx) }()
	rig := &syslogRig{h: h, listener: listener, cancel: cancel, done: done}
	t.Cleanup(func() { cancel(); <-done })
	return rig
}

func (r *syslogRig) send(t *testing.T, message string) {
	t.Helper()
	conn, err := net.Dial("udp", r.listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte(message)); err != nil {
		t.Fatal(err)
	}
}

func (r *syslogRig) waitReceived(t *testing.T, n uint64) {
	t.Helper()
	// Received dihitung begitu paket tiba, sebelum diperiksa: ini hanya menunggu
	// paketnya sampai. Untuk hasilnya, tunggu penghitung akhirnya (Applied,
	// Rejected, dst.).
	waitUntil(t, "paket syslog diterima", func() bool { return r.listener.Stats().Received >= n })
}

func TestSyslogAppliesPPPEventsFromAKnownRouter(t *testing.T) {
	rig := startSyslog(t, "127.0.0.1") // router r1 mengirim dari 127.0.0.1

	rig.send(t, "<134>Oct  7 16:58:01 MikroTik ppp,info,account budi logged out, 169 1200 3400")
	waitUntil(t, "budi offline", func() bool { return !rig.h.online("budi") })
	// Status berubah lebih dulu, notifikasi menyusul; tunggu notifikasinya.
	waitUntil(t, "notifikasi budi", func() bool { return rig.h.notify.count() == 1 })
	if rig.h.notify.count() != 1 {
		t.Errorf("notifikasi = %d, want 1", rig.h.notify.count())
	}

	rig.send(t, "<134>Oct  7 16:59:30 MikroTik ppp,info,account dewi logged in, 10.0.0.9 from AA:BB")
	waitUntil(t, "dewi online", func() bool { return rig.h.online("dewi") })
	waitUntil(t, "notifikasi dewi", func() bool { return rig.h.notify.count() == 2 })

	// Kejadian ganda dari jalur lain (webhook sudah mengubahnya) bukan perubahan.
	before := rig.h.notify.count()
	rig.send(t, "ppp,info,account dewi logged in, 10.0.0.9 from AA:BB")
	waitUntil(t, "paket ketiga diproses", func() bool { return rig.listener.Stats().Applied >= 3 })
	if rig.h.notify.count() != before {
		t.Error("event ganda memicu notifikasi lagi")
	}
}

func TestSyslogIgnoresUnknownSources(t *testing.T) {
	rig := startSyslog(t, "10.9.9.9") // 127.0.0.1 bukan alamat router mana pun

	rig.send(t, "ppp,info,account budi logged out, 169")
	// Received naik sebelum paket diperiksa; tunggu hasil akhirnya, bukan itu.
	waitUntil(t, "paket dari sumber tak dikenal tercatat", func() bool { return rig.listener.Stats().UnknownSource == 1 })
	if !rig.h.online("budi") {
		t.Error("paket dari alamat tak dikenal mengubah state")
	}
	if s := rig.listener.Stats(); s.UnknownSource != 1 || s.Applied != 0 {
		t.Errorf("Stats = %+v, want 1 paket dari sumber tak dikenal", s)
	}
}

func TestSyslogRouterCannotChangeAnotherRoutersCustomers(t *testing.T) {
	rig := startSyslog(t, "127.0.0.1")

	// siti milik r2, tetapi paket ini datang dari r1.
	rig.send(t, "ppp,info,account siti logged in, 10.0.0.5")
	rig.send(t, "ppp,info,account orang-asing logged in, 10.0.0.6")
	rig.waitReceived(t, 2)
	waitUntil(t, "keduanya ditolak", func() bool { return rig.listener.Stats().Rejected == 2 })
	if rig.h.online("siti") || rig.h.notify.count() != 0 {
		t.Error("router r1 mengubah pelanggan milik r2")
	}
}

func TestSyslogCountsAndIgnoresOtherLogLines(t *testing.T) {
	rig := startSyslog(t, "127.0.0.1")

	rig.send(t, "<134>Oct  7 17:00:00 MikroTik system,info,account user admin logged in from 192.168.88.2 via winbox")
	rig.send(t, "bukan syslog sama sekali \x00\x01")
	rig.send(t, strings.Repeat("x", maxSyslogPacket+100)) // terlalu besar
	rig.waitReceived(t, 2)
	waitUntil(t, "baris non-PPP terhitung", func() bool { return rig.listener.Stats().NotPPPEvent >= 2 })
	if !rig.h.online("budi") || rig.h.notify.count() != 0 {
		t.Error("baris non-PPP mengubah state")
	}
}

func TestSyslogServeStopsWhenContextIsCancelled(t *testing.T) {
	rig := startSyslog(t, "127.0.0.1")
	rig.cancel()
	select {
	case err := <-rig.done:
		if err != nil {
			t.Errorf("Serve = %v, want nil saat dibatalkan lewat ctx", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Serve tidak berhenti setelah ctx dibatalkan")
	}
	rig.done <- nil // Cleanup menunggu satu nilai lagi
}

func TestListenSyslogRejectsBadOrBusyAddresses(t *testing.T) {
	h := newEventHarness(t, "127.0.0.1")
	if _, err := ListenSyslog("bukan-alamat", h.mgr, nil, discardLogger()); err == nil {
		t.Error("alamat tidak valid seharusnya ditolak")
	}
	first, err := ListenSyslog("127.0.0.1:0", h.mgr, nil, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	defer first.conn.Close()
	if _, err := ListenSyslog(first.Addr().String(), h.mgr, nil, discardLogger()); err == nil {
		t.Error("alamat yang sudah terpakai seharusnya ditolak saat dibuka, bukan saat dipakai")
	}
	if _, err := ListenSyslog("127.0.0.1:0", nil, nil, discardLogger()); err == nil {
		t.Error("tanpa Presence seharusnya ditolak")
	}
}
