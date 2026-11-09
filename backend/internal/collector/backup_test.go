package collector

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

const (
	pppActiveJSON = `[
	  {".id":"*1","name":"dewi","service":"pppoe"},
	  {".id":"*2","name":"andi","service":"pppoe"},
	  {".id":"*3","name":"budi","service":"l2tp"}
	]`
	resourceJSON  = `{"architecture-name":"arm64","board-name":"RB5009UG+S+","cpu-load":"37","free-memory":"900000000","total-memory":"1073741824","uptime":"1w2d3h4m5s","version":"7.15.3 (stable)"}`
	interfaceJSON = `[
	  {".id":"*1","name":"ether1","type":"ether","running":"true","disabled":"false","rx-error":"4","tx-error":"0","rx-drop":"12","tx-drop":"1"},
	  {".id":"*2","name":"sfp-sfpplus1","type":"ether","running":"false","disabled":"true","rx-error":"0","tx-error":"0","rx-drop":"0","tx-drop":"0"},
	  {".id":"*3","name":"","type":"x"}
	]`
)

var t0 = time.Unix(1_700_000_000, 0)

// fakeMikroTik meniru beberapa endpoint REST RouterOS dan mencatat siapa yang
// memanggil apa.
type fakeMikroTik struct {
	mu        sync.Mutex
	responses map[string]string
	status    map[string]int // path -> status HTTP paksaan
	hits      map[string]int
	proplists map[string]string
	badAuth   int
}

func newFakeMikroTik(t *testing.T) (*fakeMikroTik, Target) {
	t.Helper()
	f := &fakeMikroTik{
		responses: map[string]string{
			"/rest/queue/simple":    queueJSON,
			"/rest/ppp/active":      pppActiveJSON,
			"/rest/system/resource": resourceJSON,
			"/rest/interface":       interfaceJSON,
		},
		status:    map[string]int{},
		hits:      map[string]int{},
		proplists: map[string]string{},
	}
	server := httptest.NewServer(f)
	t.Cleanup(server.Close)
	return f, target(server)
}

func (f *fakeMikroTik) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hits[r.URL.Path]++
	f.proplists[r.URL.Path] = r.URL.Query().Get(".proplist")
	if user, pass, ok := r.BasicAuth(); !ok || user != testUser || pass != testPassword {
		f.badAuth++
	}
	if code := f.status[r.URL.Path]; code != 0 {
		w.WriteHeader(code)
		return
	}
	body, ok := f.responses[r.URL.Path]
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(body))
}

func (f *fakeMikroTik) hitCount(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[path]
}

func (f *fakeMikroTik) set(path, body string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.responses[path] = body
}

func (f *fakeMikroTik) fail(path string, code int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.status[path] = code
}

func (f *fakeMikroTik) heal(path string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.status, path)
}

// ---- klien ----

func TestPPPActiveParsesSessions(t *testing.T) {
	fake, tgt := newFakeMikroTik(t)
	client, _ := NewClient(tgt, nil)
	sessions, err := client.PPPActive(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 3 || sessions[0] != (PPPSession{Name: "dewi", Service: "pppoe"}) || sessions[2].Service != "l2tp" {
		t.Errorf("sessions = %+v", sessions)
	}
	if got := fake.proplists["/rest/ppp/active"]; got != "name,service,address,uptime" {
		t.Errorf(".proplist = %q, want hanya kolom yang dibutuhkan", got)
	}
	fake.set("/rest/ppp/active", `{"bukan":"daftar"}`)
	if _, err := client.PPPActive(context.Background()); err == nil {
		t.Error("jawaban objek seharusnya ditolak")
	}
}

func TestResourceParsesASingleObject(t *testing.T) {
	_, tgt := newFakeMikroTik(t)
	client, _ := NewClient(tgt, nil)
	res, err := client.Resource(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	wantUptime := 7*24*time.Hour + 2*24*time.Hour + 3*time.Hour + 4*time.Minute + 5*time.Second
	if res.CPULoad != 37 || res.FreeMemory != 900_000_000 || res.TotalMemory != 1_073_741_824 || res.Uptime != wantUptime ||
		res.Version != "7.15.3 (stable)" || res.Board != "RB5009UG+S+" {
		t.Errorf("Resource = %+v", res)
	}
}

func TestResourceRejectsIncompleteOrImplausibleAnswers(t *testing.T) {
	fake, tgt := newFakeMikroTik(t)
	client, _ := NewClient(tgt, nil)
	for name, body := range map[string]string{
		"tanpa cpu-load":       `{"total-memory":"100"}`,
		"cpu-load > 100":       `{"cpu-load":"101","total-memory":"100"}`,
		"cpu-load negatif":     `{"cpu-load":"-1","total-memory":"100"}`,
		"cpu-load bukan angka": `{"cpu-load":"tinggi","total-memory":"100"}`,
		"tanpa total-memory":   `{"cpu-load":"5"}`,
		"total-memory nol":     `{"cpu-load":"5","total-memory":"0"}`,
		"berupa array":         `[{"cpu-load":"5"}]`,
		"bukan JSON":           `<html>`,
	} {
		fake.set("/rest/system/resource", body)
		if _, err := client.Resource(context.Background()); err == nil {
			t.Errorf("%s: seharusnya ditolak", name)
		}
	}

	// Bagian opsional yang aneh tidak boleh menggagalkan polling.
	fake.set("/rest/system/resource", `{"cpu-load":"5","total-memory":"100","free-memory":"abc","uptime":"???"}`)
	res, err := client.Resource(context.Background())
	if err != nil || res.CPULoad != 5 || res.FreeMemory != 0 || res.Uptime != 0 {
		t.Errorf("Resource = %+v, %v; want CPU terbaca dan sisanya nol", res, err)
	}
	// Memori bebas yang lebih besar dari total (data janggal) dibatasi ke total.
	fake.set("/rest/system/resource", `{"cpu-load":"5","total-memory":"100","free-memory":"500"}`)
	if res, _ = client.Resource(context.Background()); res.FreeMemory != 100 {
		t.Errorf("FreeMemory = %d, want dibatasi ke total 100", res.FreeMemory)
	}
}

func TestInterfacesParsesCountersAndFlags(t *testing.T) {
	_, tgt := newFakeMikroTik(t)
	client, _ := NewClient(tgt, nil)
	interfaces, err := client.Interfaces(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(interfaces) != 2 {
		t.Fatalf("interfaces = %+v, want 2 (yang tanpa nama dilewati)", interfaces)
	}
	want := state.Interface{Name: "ether1", Type: "ether", Running: true, RxError: 4, RxDrop: 12, TxDrop: 1}
	if interfaces[0] != want {
		t.Errorf("interface pertama = %+v, want %+v", interfaces[0], want)
	}
	if !interfaces[1].Disabled || interfaces[1].Running {
		t.Errorf("interface kedua = %+v, want disabled dan tidak running", interfaces[1])
	}
}

func TestParseUptime(t *testing.T) {
	tests := map[string]time.Duration{
		"1w2d3h4m5s":            9*24*time.Hour + 3*time.Hour + 4*time.Minute + 5*time.Second,
		"5s":                    5 * time.Second,
		"30m":                   30 * time.Minute,
		"2d":                    48 * time.Hour,
		"":                      0,
		"???":                   0,
		"99999999999999999999s": 0, // terlalu besar: abaikan, jangan meluap
	}
	for in, want := range tests {
		if got := parseUptime(in); got != want {
			t.Errorf("parseUptime(%q) = %s, want %s", in, got, want)
		}
	}
}

// ---- rekonsiliasi ----

type reconcileRig struct {
	mgr    *state.Manager
	clock  *time.Time
	notify *changeLog
}

func newReconcileRig(t *testing.T) *reconcileRig {
	t.Helper()
	clock := t0
	mgr := state.NewManager(state.WithClock(func() time.Time { return clock }))
	for _, id := range []string{"r1", "r2"} {
		if err := mgr.UpsertRouter(state.Router{ID: id, Active: true}); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range []state.Customer{
		{ID: "c1", PPPoEUsername: "budi", RouterID: "r1", IsOnline: true},
		{ID: "c2", PPPoEUsername: "dewi", RouterID: "r1", IsOnline: false},
		{ID: "c3", PPPoEUsername: "andi", RouterID: "r1", IsOnline: true},
		{ID: "c4", PPPoEUsername: "siti", RouterID: "r2", IsOnline: false},
	} {
		if err := mgr.UpsertCustomer(c); err != nil {
			t.Fatal(err)
		}
	}
	return &reconcileRig{mgr: mgr, clock: &clock, notify: &changeLog{}}
}

func (r *reconcileRig) online(user string) bool {
	c, _ := r.mgr.CustomerByPPPoE(user)
	return c.IsOnline
}

func TestReconcileAlignsStatusWithActiveSessions(t *testing.T) {
	rig := newReconcileRig(t)
	sessions := []PPPSession{
		{Name: "dewi", Service: "pppoe"},
		{Name: "andi", Service: "pppoe"},
		{Name: "budi", Service: "l2tp"},  // sesi VPN, bukan pelanggan PPPoE
		{Name: "siti", Service: "pppoe"}, // milik r2, bukan r1
	}
	*rig.clock = t0.Add(time.Hour)
	result := reconcilePresence(rig.mgr, rig.notify.add, "r1", sessions, rig.clock.Add(time.Second))

	if rig.online("budi") {
		t.Error("budi hanya punya sesi L2TP, seharusnya offline sebagai pelanggan PPPoE")
	}
	if !rig.online("dewi") {
		t.Error("dewi punya sesi PPPoE aktif, seharusnya online")
	}
	if !rig.online("andi") {
		t.Error("andi tetap online")
	}
	if rig.online("siti") {
		t.Error("router r1 tidak boleh mengubah pelanggan milik r2")
	}
	if result.Checked != 3 || result.Flipped != 2 || result.Skipped != 0 {
		t.Errorf("result = %+v, want 3 diperiksa, 2 diubah", result)
	}
	if rig.notify.count() != 2 {
		t.Errorf("notifikasi = %d, want 2 (hanya untuk yang berubah)", rig.notify.count())
	}

	// Diulang dengan data yang sama: tidak ada yang berubah lagi.
	again := reconcilePresence(rig.mgr, rig.notify.add, "r1", sessions, rig.clock.Add(2*time.Second))
	if again.Flipped != 0 || rig.notify.count() != 2 {
		t.Errorf("pengulangan: %+v, notifikasi %d; want tidak ada perubahan", again, rig.notify.count())
	}
}

// Webhook "up" tiba selagi daftar sedang diambil: daftar itu belum memuatnya,
// dan menimpa status yang baru saja benar adalah kesalahan.
func TestReconcileDoesNotOverrideChangesNewerThanTheObservation(t *testing.T) {
	rig := newReconcileRig(t)
	observedAt := t0.Add(time.Hour)

	*rig.clock = observedAt.Add(500 * time.Millisecond) // webhook tiba setelah daftar diminta
	if _, err := rig.mgr.SetOnline("dewi", true); err != nil {
		t.Fatal(err)
	}
	if _, err := rig.mgr.SetOnline("andi", false); err != nil {
		t.Fatal(err)
	}

	// Daftar (diambil sebelum dua perubahan itu) menyatakan dewi tidak aktif dan andi aktif.
	result := reconcilePresence(rig.mgr, rig.notify.add, "r1", []PPPSession{{Name: "andi", Service: "pppoe"}}, observedAt)
	if !rig.online("dewi") || rig.online("andi") {
		t.Error("rekonsiliasi menimpa perubahan yang lebih baru dari data router")
	}
	if result.Skipped != 2 {
		t.Errorf("Skipped = %d, want 2", result.Skipped)
	}
	// budi tidak berubah sejak awal dan tidak ada di daftar: ini yang memang diubah.
	if rig.online("budi") {
		t.Error("budi (tidak ada di daftar dan statusnya lama) seharusnya offline")
	}
}

func TestReconcileWithEmptyListMarksTheRoutersCustomersOffline(t *testing.T) {
	rig := newReconcileRig(t)
	*rig.clock = t0.Add(time.Hour)
	reconcilePresence(rig.mgr, nil, "r1", nil, rig.clock.Add(time.Second)) // notify nil boleh
	if rig.online("budi") || rig.online("andi") {
		t.Error("router tanpa sesi aktif berarti semua pelanggannya offline")
	}
}

// ---- poller dengan jalur cadangan ----

func backupPoller(rec Recorder, mgr *state.Manager, notify func(state.Change), tweak func(*BackupOptions)) *Poller {
	backup := &BackupOptions{
		Store: mgr, Presence: mgr, Notify: notify,
		PPPActiveEvery: 30 * time.Millisecond, ResourceEvery: 20 * time.Millisecond, InterfaceEvery: 25 * time.Millisecond,
	}
	if tweak != nil {
		tweak(backup)
	}
	// Sumber trafik dari queue: tes jalur cadangan menghitung panggilan /rest/interface sendiri.
	return newPoller(rec, func(o *PollerOptions) { o.Backup = backup; o.TrafficFromQueues = true })
}

func registerBackupFixture(t *testing.T) *state.Manager {
	t.Helper()
	mgr := state.NewManager()
	if err := mgr.UpsertRouter(state.Router{ID: "r1", Name: "RTR-1", Active: true}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []state.Customer{
		{ID: "c1", PPPoEUsername: "budi", RouterID: "r1", IsOnline: true, StatusSince: t0.Add(-time.Hour)},
		{ID: "c2", PPPoEUsername: "dewi", RouterID: "r1", IsOnline: false, StatusSince: t0.Add(-time.Hour)},
		{ID: "c3", PPPoEUsername: "andi", RouterID: "r1", IsOnline: true, StatusSince: t0.Add(-time.Hour)},
	} {
		if err := mgr.UpsertCustomer(c); err != nil {
			t.Fatal(err)
		}
	}
	return mgr
}

func TestBackupPollingFillsResourceInterfacesAndPresence(t *testing.T) {
	fake, tgt := newFakeMikroTik(t)
	mgr := registerBackupFixture(t)
	changes := &changeLog{}
	p := backupPoller(mgr, mgr, changes.add, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, tgt); err != nil {
		t.Fatal(err)
	}

	waitUntil(t, "resource tersimpan", func() bool { _, ok := mgr.RouterResource("r1"); return ok })
	waitUntil(t, "interface tersimpan", func() bool { _, _, ok := mgr.RouterInterfaces("r1"); return ok })
	waitUntil(t, "status disamakan", func() bool {
		dewi, _ := mgr.CustomerByPPPoE("dewi")
		budi, _ := mgr.CustomerByPPPoE("budi")
		return dewi.IsOnline && !budi.IsOnline
	})
	waitUntil(t, "traffic juga tetap masuk", func() bool { return len(mgr.TrafficSeries()) >= 1 })
	stopAndWait(t, p, cancel)

	res, _ := mgr.RouterResource("r1")
	if res.CPULoad != 37 || res.At.IsZero() {
		t.Errorf("resource = %+v", res)
	}
	ifaces, at, _ := mgr.RouterInterfaces("r1")
	if len(ifaces) != 2 || ifaces[0].RxError != 4 || at.IsZero() {
		t.Errorf("interfaces = %+v at %v", ifaces, at)
	}
	if changes.count() != 2 {
		t.Errorf("notifikasi = %d, want 2 (dewi online, budi offline)", changes.count())
	}

	for _, path := range []string{"/rest/queue/simple", "/rest/ppp/active", "/rest/system/resource", "/rest/interface"} {
		if fake.hitCount(path) == 0 {
			t.Errorf("%s tidak pernah dipanggil", path)
		}
	}
	if fake.badAuth != 0 {
		t.Errorf("%d permintaan tanpa kredensial yang benar", fake.badAuth)
	}
	if got := fake.proplists["/rest/system/resource"]; !strings.Contains(got, "cpu-load") {
		t.Errorf(".proplist resource = %q", got)
	}
}

func TestBackupJobsReportTheirOwnStatus(t *testing.T) {
	_, tgt := newFakeMikroTik(t)
	mgr := registerBackupFixture(t)
	p := backupPoller(mgr, mgr, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, tgt); err != nil {
		t.Fatal(err)
	}
	for _, job := range []string{JobQueue, JobPPPActive, JobResource, JobInterface} {
		waitUntil(t, "job "+job+" sukses", func() bool {
			s, ok := p.JobStatus("r1", job)
			return ok && !s.LastSuccess.IsZero()
		})
	}
	if s, _ := p.JobStatus("r1", JobInterface); s.LastItemCount != 2 {
		t.Errorf("interface LastItemCount = %d, want 2", s.LastItemCount)
	}
	if s, _ := p.JobStatus("r1", JobPPPActive); s.LastItemCount != 3 {
		t.Errorf("ppp-active LastItemCount = %d, want 3", s.LastItemCount)
	}
	if _, ok := p.JobStatus("r1", "tidak-ada"); ok {
		t.Error("job yang tidak ada seharusnya false")
	}
	stopAndWait(t, p, cancel)
}

func TestFailingBackupJobDoesNotAffectTrafficOrFlipCustomers(t *testing.T) {
	fake, tgt := newFakeMikroTik(t)
	fake.fail("/rest/ppp/active", http.StatusInternalServerError)
	mgr := registerBackupFixture(t)
	p := backupPoller(mgr, mgr, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, tgt); err != nil {
		t.Fatal(err)
	}

	waitUntil(t, "ppp-active gagal terbaca", func() bool {
		s, _ := p.JobStatus("r1", JobPPPActive)
		return s.ConsecutiveFailures >= 2
	})
	waitUntil(t, "traffic tetap masuk", func() bool { return len(mgr.TrafficSeries()) >= 2 })
	if s, _ := p.Status("r1"); s.ConsecutiveFailures != 0 {
		t.Errorf("polling queue ikut gagal: %+v", s)
	}
	// Gagal mengambil daftar sesi bukan berarti semua pelanggan offline.
	if budi, _ := mgr.CustomerByPPPoE("budi"); !budi.IsOnline {
		t.Error("kegagalan polling /ppp/active mengubah status pelanggan")
	}

	// Pulih: rekonsiliasi berjalan lagi.
	fake.heal("/rest/ppp/active")
	waitUntil(t, "status disamakan setelah pulih", func() bool {
		dewi, _ := mgr.CustomerByPPPoE("dewi")
		return dewi.IsOnline
	})
	stopAndWait(t, p, cancel)
}

func TestBackupJobsAreSkippedWhenTheirDependencyIsMissing(t *testing.T) {
	fake, tgt := newFakeMikroTik(t)
	mgr := registerBackupFixture(t)

	// Tanpa Presence: tidak ada /ppp/active. Tanpa Store: tidak ada resource/interface.
	for name, tweak := range map[string]func(*BackupOptions){
		"tanpa Presence": func(b *BackupOptions) { b.Presence = nil },
		"tanpa Store":    func(b *BackupOptions) { b.Store = nil },
	} {
		fake.mu.Lock()
		fake.hits = map[string]int{}
		fake.mu.Unlock()
		p := backupPoller(mgr, mgr, nil, tweak)
		ctx, cancel := context.WithCancel(context.Background())
		if err := p.Start(ctx, tgt); err != nil {
			t.Fatal(err)
		}
		waitUntil(t, name+": job lain berjalan", func() bool { return fake.hitCount("/rest/queue/simple") >= 3 })
		time.Sleep(100 * time.Millisecond)
		stopAndWait(t, p, cancel)

		switch name {
		case "tanpa Presence":
			if fake.hitCount("/rest/ppp/active") != 0 || fake.hitCount("/rest/system/resource") == 0 {
				t.Errorf("%s: hits = %v", name, fake.hits)
			}
		case "tanpa Store":
			if fake.hitCount("/rest/system/resource") != 0 || fake.hitCount("/rest/interface") != 0 || fake.hitCount("/rest/ppp/active") == 0 {
				t.Errorf("%s: hits = %v", name, fake.hits)
			}
		}
	}
}

func TestOnlyQueuePollingRunsWithoutBackupOptions(t *testing.T) {
	fake, tgt := newFakeMikroTik(t)
	// Sumber trafik dari queue: tanpa itu poller juga membaca /rest/interface untuk counter uplink.
	p := newPoller(&fakeRecorder{}, func(o *PollerOptions) { o.TrafficFromQueues = true })
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, tgt); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "queue dipoll", func() bool { return fake.hitCount("/rest/queue/simple") >= 3 })
	stopAndWait(t, p, cancel)
	for _, path := range []string{"/rest/ppp/active", "/rest/system/resource", "/rest/interface"} {
		if n := fake.hitCount(path); n != 0 {
			t.Errorf("%s dipanggil %d kali tanpa BackupOptions", path, n)
		}
	}
}

func TestBackupDefaultsMatchThePRDAndDoNotMutateTheCaller(t *testing.T) {
	mine := &BackupOptions{}
	p := newPoller(&fakeRecorder{}, func(o *PollerOptions) { o.Backup = mine })
	got := p.opts.Backup
	if got.PPPActiveEvery != 30*time.Second || got.ResourceEvery != 5*time.Second || got.InterfaceEvery != 10*time.Second {
		t.Errorf("default = %s, %s, %s; want 30s, 5s, 10s", got.PPPActiveEvery, got.ResourceEvery, got.InterfaceEvery)
	}
	if mine.PPPActiveEvery != 0 || mine.ResourceEvery != 0 || mine.InterfaceEvery != 0 {
		t.Errorf("BackupOptions milik pemanggil diubah: %+v", *mine)
	}
	if got := backupTimeout(5 * time.Second); got != 4500*time.Millisecond {
		t.Errorf("backupTimeout(5s) = %s, want 4,5s", got)
	}
	if got := backupTimeout(time.Minute); got != maxBackupTimeout {
		t.Errorf("backupTimeout(1m) = %s, want %s", got, maxBackupTimeout)
	}
}
