package state

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"testing"
	"time"
)

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	m := NewManager(WithClock(func() time.Time { return time.Unix(1_700_000_000, 0) }))
	for _, r := range []Router{
		{ID: "r1", Name: "RTR-1", Host: "10.0.0.1", Active: true},
		{ID: "r2", Name: "RTR-2", Host: "10.0.0.2", Active: false},
	} {
		if err := m.UpsertRouter(r); err != nil {
			t.Fatalf("UpsertRouter(%s): %v", r.ID, err)
		}
	}
	return m
}

func addCustomer(t *testing.T, m *Manager, id, pppoe string, online bool) {
	t.Helper()
	err := m.UpsertCustomer(Customer{ID: id, Name: id, PPPoEUsername: pppoe, RouterID: "r1", IsOnline: online})
	if err != nil {
		t.Fatalf("UpsertCustomer(%s): %v", id, err)
	}
}

func TestSetQueuesClearsStaleRatiosAndIgnoresOtherRouters(t *testing.T) {
	m := newTestManager(t)
	addCustomer(t, m, "c1", "budi", true)
	addCustomer(t, m, "c2", "siti", true)
	if err := m.UpsertCustomer(Customer{ID: "c3", Name: "c3", PPPoEUsername: "agus", RouterID: "r2"}); err != nil {
		t.Fatal(err)
	}

	if _, err := m.SetQueues("r1", []QueueRatio{
		{PPPoEUsername: "budi", UpRatio: 0.9, DownRatio: 0.99},
		{PPPoEUsername: "siti", UpRatio: 0.5, DownRatio: 0.6},
	}); err != nil {
		t.Fatal(err)
	}
	for _, username := range []string{"budi", "siti"} {
		c, _ := m.CustomerByPPPoE(username)
		if !c.HasQueue {
			t.Fatalf("%s harus punya data queue setelah polling pertama", username)
		}
	}

	// Polling kedua hanya melihat queue budi. Siti tidak lagi punya queue dan
	// angka lamanya tidak boleh tetap dipakai.
	if _, err := m.SetQueues("r1", []QueueRatio{
		{PPPoEUsername: "budi", UpRatio: 0.1, DownRatio: 0.2},
	}); err != nil {
		t.Fatal(err)
	}
	budi, _ := m.CustomerByPPPoE("budi")
	if !budi.HasQueue || budi.QueueUpRatio != 0.1 || budi.QueueDownRatio != 0.2 {
		t.Errorf("budi = %+v, want rasio queue baru 0.1/0.2", budi)
	}
	siti, _ := m.CustomerByPPPoE("siti")
	if siti.HasQueue || siti.QueueUpRatio != 0 || siti.QueueDownRatio != 0 {
		t.Errorf("siti = %+v, want data queue dibuang", siti)
	}

	// Queue yang dilaporkan router lain tidak boleh mengubah pelanggan r2.
	if _, err := m.SetQueues("r1", []QueueRatio{
		{PPPoEUsername: "agus", UpRatio: 1, DownRatio: 1},
	}); err != nil {
		t.Fatal(err)
	}
	agus, _ := m.CustomerByPPPoE("agus")
	if agus.HasQueue {
		t.Errorf("agus milik r2 tidak boleh menerima queue dari r1: %+v", agus)
	}
}

func TestHealth(t *testing.T) {
	tests := []struct {
		name string
		c    Customer
		want Health
	}{
		{"offline", Customer{IsOnline: false, HasOptical: true, OpticalPowerDbm: -10}, HealthCritical},
		{"online normal", Customer{IsOnline: true, HasOptical: true, OpticalPowerDbm: -20}, HealthOK},
		{"online tanpa data optik", Customer{IsOnline: true}, HealthOK},
		{"online sinyal lemah", Customer{IsOnline: true, HasOptical: true, OpticalPowerDbm: -26.5}, HealthWarning},
		{"tepat di ambang bukan lemah", Customer{IsOnline: true, HasOptical: true, OpticalPowerDbm: WeakOpticalDbm}, HealthOK},
		{"offline dengan sinyal lemah tetap merah", Customer{IsOnline: false, HasOptical: true, OpticalPowerDbm: -30}, HealthCritical},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.c.Health(); got != tt.want {
				t.Errorf("Health() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSetOnlineReportsChangeOnlyOnFlip(t *testing.T) {
	m := newTestManager(t)
	addCustomer(t, m, "c1", "budi", true)

	change, err := m.SetOnline("budi", true)
	if err != nil || change.Changed() {
		t.Errorf("SetOnline(true) pada pelanggan yang sudah online: Changed() = %v, err = %v; want false, nil", change.Changed(), err)
	}

	change, err = m.SetOnline("budi", false)
	if err != nil {
		t.Fatalf("SetOnline(false): %v", err)
	}
	if !change.OnlineChanged() || !change.HealthChanged() || !change.Changed() {
		t.Errorf("putus: OnlineChanged/HealthChanged/Changed = %v/%v/%v, want true semua",
			change.OnlineChanged(), change.HealthChanged(), change.Changed())
	}
	if !change.Before.IsOnline || change.After.IsOnline {
		t.Errorf("Before.IsOnline = %v, After.IsOnline = %v; want true, false", change.Before.IsOnline, change.After.IsOnline)
	}

	if change, _ = m.SetOnline("budi", false); change.Changed() {
		t.Error("memutus pelanggan yang sudah offline tidak boleh dianggap perubahan")
	}
}

func TestSetOnlineUnknownCustomer(t *testing.T) {
	m := newTestManager(t)
	if _, err := m.SetOnline("tidak-ada", true); !errors.Is(err, ErrUnknownCustomer) {
		t.Errorf("err = %v, want ErrUnknownCustomer", err)
	}
	if _, err := m.SetOpticalPower("tidak-ada", -20); !errors.Is(err, ErrUnknownCustomer) {
		t.Errorf("err = %v, want ErrUnknownCustomer", err)
	}
}

func TestSetOpticalPowerChangesHealthAcrossThreshold(t *testing.T) {
	m := newTestManager(t)
	addCustomer(t, m, "c1", "budi", true)

	change, err := m.SetOpticalPower("c1", -19.5)
	if err != nil {
		t.Fatalf("SetOpticalPower: %v", err)
	}
	if change.Changed() {
		t.Error("data optik pertama yang normal tidak mengubah warna dari hijau")
	}

	change, _ = m.SetOpticalPower("c1", -27)
	if !change.HealthChanged() || change.OnlineChanged() || change.After.Health() != HealthWarning {
		t.Errorf("melemah: HealthChanged=%v OnlineChanged=%v After=%q; want true, false, warning",
			change.HealthChanged(), change.OnlineChanged(), change.After.Health())
	}

	if change, _ = m.SetOpticalPower("c1", -28); change.Changed() {
		t.Error("sinyal tetap lemah (hanya nilainya berubah) bukan perubahan status")
	}
}

func TestSetUpdatesLastUpdatedAt(t *testing.T) {
	now := time.Unix(100, 0)
	m := NewManager(WithClock(func() time.Time { return now }))
	_ = m.UpsertRouter(Router{ID: "r1", Active: true})
	_ = m.UpsertCustomer(Customer{ID: "c1", PPPoEUsername: "budi", RouterID: "r1"})
	now = time.Unix(200, 0)
	change, _ := m.SetOnline("budi", true)
	if !change.After.LastUpdatedAt.Equal(time.Unix(200, 0)) {
		t.Errorf("LastUpdatedAt = %v, want 200", change.After.LastUpdatedAt)
	}
}

func TestUpsertCustomerValidation(t *testing.T) {
	m := newTestManager(t)
	addCustomer(t, m, "c1", "budi", true)

	if err := m.UpsertCustomer(Customer{PPPoEUsername: "x", RouterID: "r1"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("tanpa ID: err = %v, want ErrInvalid", err)
	}
	if err := m.UpsertCustomer(Customer{ID: "c9", RouterID: "r1"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("tanpa username: err = %v, want ErrInvalid", err)
	}
	if err := m.UpsertCustomer(Customer{ID: "c9", PPPoEUsername: "x", RouterID: "hilang"}); !errors.Is(err, ErrUnknownRouter) {
		t.Errorf("router tidak dikenal: err = %v, want ErrUnknownRouter", err)
	}
	if err := m.UpsertCustomer(Customer{ID: "c2", PPPoEUsername: "budi", RouterID: "r1"}); !errors.Is(err, ErrDuplicatePPPoE) {
		t.Errorf("username kembar: err = %v, want ErrDuplicatePPPoE", err)
	}
	if got := len(m.Snapshot().Customers); got != 1 {
		t.Errorf("jumlah pelanggan = %d, want 1 (penolakan tidak boleh menyisakan data)", got)
	}
}

func TestUpsertCustomerRenameFreesOldUsername(t *testing.T) {
	m := newTestManager(t)
	addCustomer(t, m, "c1", "budi", true)
	addCustomer(t, m, "c1", "budi.baru", true)

	if _, err := m.SetOnline("budi", false); !errors.Is(err, ErrUnknownCustomer) {
		t.Errorf("username lama masih terdaftar: err = %v", err)
	}
	if _, err := m.SetOnline("budi.baru", false); err != nil {
		t.Errorf("username baru tidak ditemukan: %v", err)
	}
	// Username lama sekarang boleh dipakai pelanggan lain.
	addCustomer(t, m, "c2", "budi", true)
}

func TestCountsMatchDashboardCards(t *testing.T) {
	m := newTestManager(t)
	addCustomer(t, m, "c1", "a", true)
	addCustomer(t, m, "c2", "b", true)
	addCustomer(t, m, "c3", "c", false)
	if _, err := m.SetOpticalPower("c2", -26); err != nil {
		t.Fatal(err)
	}
	if _, err := m.SetOpticalPower("c3", -29); err != nil { // offline: tidak dihitung lemah
		t.Fatal(err)
	}

	want := Counts{Online: 2, Offline: 1, WeakSignal: 1, ActiveRouters: 1, TotalRouters: 2}
	if got := m.Counts(); got != want {
		t.Errorf("Counts() = %+v, want %+v", got, want)
	}
	if got := m.Snapshot().Counts; got != want {
		t.Errorf("Snapshot().Counts = %+v, want %+v", got, want)
	}
}

func TestSnapshotIsIndependentCopy(t *testing.T) {
	m := newTestManager(t)
	addCustomer(t, m, "c1", "budi", true)
	_, _ = m.RecordTraffic("r1", TrafficPoint{Time: 1, RxMbps: 10})

	snap := m.Snapshot()
	snap.Customers[0].IsOnline = false
	snap.Routers[0].Active = false
	snap.Traffic[0].RxMbps = 999

	after := m.Snapshot()
	if !after.Customers[0].IsOnline || !after.Routers[0].Active || after.Traffic[0].RxMbps != 10 {
		t.Errorf("mengubah Snapshot memengaruhi state: %+v", after)
	}
}

func TestSnapshotKeepsRegistrationOrder(t *testing.T) {
	m := newTestManager(t)
	for _, id := range []string{"z", "a", "m"} {
		addCustomer(t, m, id, "u-"+id, true)
	}
	got := ""
	for _, c := range m.Snapshot().Customers {
		got += c.ID
	}
	if got != "zam" {
		t.Errorf("urutan pelanggan = %q, want %q", got, "zam")
	}
}

func TestRecordTrafficRules(t *testing.T) {
	m := newTestManager(t)

	if _, err := m.RecordTraffic("hilang", TrafficPoint{Time: 1}); !errors.Is(err, ErrUnknownRouter) {
		t.Errorf("router tidak dikenal: err = %v, want ErrUnknownRouter", err)
	}

	for _, p := range []TrafficPoint{{Time: 10, RxMbps: 1}, {Time: 11, RxMbps: 2}} {
		if ok, err := m.RecordTraffic("r1", p); !ok || err != nil {
			t.Fatalf("RecordTraffic(%+v) = %v, %v", p, ok, err)
		}
	}
	// Detik yang sama menggantikan, bukan menambah titik.
	if ok, _ := m.RecordTraffic("r1", TrafficPoint{Time: 11, RxMbps: 5}); !ok {
		t.Error("sampel detik yang sama harus diterima sebagai pengganti")
	}
	// Sampel yang lebih tua diabaikan.
	if ok, _ := m.RecordTraffic("r1", TrafficPoint{Time: 5, RxMbps: 7}); ok {
		t.Error("sampel yang lebih tua dari yang terakhir harus diabaikan")
	}

	got, err := m.RouterTraffic("r1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Time != 10 || got[1].Time != 11 || got[1].RxMbps != 5 {
		t.Errorf("RouterTraffic = %+v, want dua titik (10, 11) dengan titik 11 = 5 Mbps", got)
	}
}

func TestTrafficWindowIs300Points(t *testing.T) {
	m := newTestManager(t)
	for s := int64(1); s <= 1000; s++ {
		_, _ = m.RecordTraffic("r1", TrafficPoint{Time: s, RxMbps: float64(s)})
	}
	series, _ := m.RouterTraffic("r1")
	if len(series) != TrafficWindow {
		t.Fatalf("panjang riwayat = %d, want %d", len(series), TrafficWindow)
	}
	if series[0].Time != 701 || series[len(series)-1].Time != 1000 {
		t.Errorf("rentang = %d..%d, want 701..1000", series[0].Time, series[len(series)-1].Time)
	}
	if got := len(m.Snapshot().Traffic); got != TrafficWindow {
		t.Errorf("Snapshot().Traffic = %d titik, want %d", got, TrafficWindow)
	}
}

func TestTotalTrafficSumsRoutersPerSecond(t *testing.T) {
	m := newTestManager(t)
	record := func(router string, sec int64, rx, tx float64) {
		t.Helper()
		if _, err := m.RecordTraffic(router, TrafficPoint{Time: sec, RxMbps: rx, TxMbps: tx}); err != nil {
			t.Fatal(err)
		}
	}
	record("r1", 100, 10, 1)
	record("r2", 100, 20, 2)
	record("r1", 101, 11, 1)
	// r2 belum melapor detik 101.

	total, reporting := m.TotalAt(100)
	if total.RxMbps != 30 || total.TxMbps != 3 || reporting != 2 {
		t.Errorf("TotalAt(100) = %+v dari %d router, want rx 30, tx 3 dari 2 router", total, reporting)
	}
	total, reporting = m.TotalAt(101)
	if total.RxMbps != 11 || reporting != 1 {
		t.Errorf("TotalAt(101) = %+v dari %d router, want rx 11 dari 1 router", total, reporting)
	}
	if _, reporting = m.TotalAt(999); reporting != 0 {
		t.Errorf("TotalAt(999) reporting = %d, want 0", reporting)
	}

	series := m.Snapshot().Traffic
	if len(series) != 2 || series[0].Time != 100 || series[0].RxMbps != 30 || series[1].Time != 101 || series[1].RxMbps != 11 {
		t.Errorf("Snapshot().Traffic = %+v, want [100:30, 101:11]", series)
	}
}

func TestUpsertRouterKeepsTrafficHistory(t *testing.T) {
	m := newTestManager(t)
	_, _ = m.RecordTraffic("r1", TrafficPoint{Time: 1, RxMbps: 4})
	if err := m.UpsertRouter(Router{ID: "r1", Name: "baru", Active: false}); err != nil {
		t.Fatal(err)
	}
	series, _ := m.RouterTraffic("r1")
	if len(series) != 1 {
		t.Errorf("riwayat traffic hilang setelah UpsertRouter: %+v", series)
	}
	if m.Counts().ActiveRouters != 0 {
		t.Error("status aktif router tidak ikut diperbarui")
	}
	if err := m.UpsertRouter(Router{}); !errors.Is(err, ErrInvalid) {
		t.Errorf("router tanpa ID: err = %v, want ErrInvalid", err)
	}
}

// Menjalankan banyak penulis dan pembaca bersamaan. Tanpa -race (butuh cgo)
// test ini tetap menangkap deadlock, panic, dan hasil akhir yang salah.
func TestConcurrentAccess(t *testing.T) {
	m := newTestManager(t)
	const customers = 200
	for i := 0; i < customers; i++ {
		addCustomer(t, m, fmt.Sprintf("c%d", i), fmt.Sprintf("user%d", i), true)
	}

	var wg sync.WaitGroup
	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < 500; i++ {
				user := fmt.Sprintf("user%d", (w*37+i)%customers)
				_, _ = m.SetOnline(user, i%2 == 0)
				_, _ = m.SetOpticalPower(fmt.Sprintf("c%d", (w*11+i)%customers), -20-float64(i%10))
				_, _ = m.RecordTraffic("r1", TrafficPoint{Time: int64(i), RxMbps: 1})
			}
		}(w)
	}
	for r := 0; r < 4; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				snap := m.Snapshot()
				if snap.Counts.Online+snap.Counts.Offline != customers {
					t.Errorf("online+offline = %d, want %d", snap.Counts.Online+snap.Counts.Offline, customers)
					return
				}
				_ = m.Counts()
				_, _ = m.TotalAt(int64(i))
			}
		}()
	}
	wg.Wait()

	if got := m.Counts(); got.Online+got.Offline != customers {
		t.Errorf("setelah selesai online+offline = %d, want %d", got.Online+got.Offline, customers)
	}
}

func heapInUse() uint64 {
	runtime.GC()
	runtime.GC()
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return stats.HeapAlloc
}

// Memori harus berhenti bertambah setelah ring buffer penuh. Target PRD:
// backend < 200 MB; state sendiri harus jauh di bawah itu, bahkan untuk
// 2.000 pelanggan dan 20 router yang melapor 24 jam penuh.
func TestMemoryStaysBoundedOverLongRun(t *testing.T) {
	m := NewManager()
	const routers, customers = 20, 2000
	for i := 0; i < routers; i++ {
		_ = m.UpsertRouter(Router{ID: fmt.Sprintf("r%d", i), Name: fmt.Sprintf("RTR-%d", i), Active: true})
	}
	for i := 0; i < customers; i++ {
		err := m.UpsertCustomer(Customer{
			ID: fmt.Sprintf("c%d", i), Name: fmt.Sprintf("Pelanggan %d", i),
			PPPoEUsername: fmt.Sprintf("user%d", i), RouterID: fmt.Sprintf("r%d", i%routers),
			Address: "Jl. Mawar No. 1", IsOnline: true,
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	feed := func(from, to int64) {
		for s := from; s < to; s++ {
			for i := 0; i < routers; i++ {
				_, _ = m.RecordTraffic(fmt.Sprintf("r%d", i), TrafficPoint{Time: s, RxMbps: 1, TxMbps: 1})
			}
		}
	}
	feed(0, TrafficWindow) // buffer baru saja penuh
	full := heapInUse()
	feed(TrafficWindow, 24*3600) // 24 jam pada 1 sampel per detik
	after := heapInUse()

	const limit = 2 << 20 // 2 MB
	if after > full && after-full > limit {
		t.Errorf("heap naik %d byte setelah 24 jam data, batas %d: ring buffer tidak membatasi memori", after-full, limit)
	}
	const total = 32 << 20 // jauh di bawah target 200 MB
	if after > total {
		t.Errorf("heap = %d byte untuk %d pelanggan dan %d router, batas %d", after, customers, routers, total)
	}
	t.Logf("heap setelah buffer penuh: %.2f MB, setelah 24 jam: %.2f MB", float64(full)/(1<<20), float64(after)/(1<<20))
	runtime.KeepAlive(m)
}

func TestStatusSinceTracksOnlyRealStatusChanges(t *testing.T) {
	now := time.Unix(1000, 0)
	m := NewManager(WithClock(func() time.Time { return now }))
	_ = m.UpsertRouter(Router{ID: "r1", Active: true})
	_ = m.UpsertCustomer(Customer{ID: "c1", PPPoEUsername: "budi", RouterID: "r1", IsOnline: true})

	since := func() time.Time {
		c, _ := m.CustomerByPPPoE("budi")
		return c.StatusSince
	}
	if !since().Equal(time.Unix(1000, 0)) {
		t.Fatalf("StatusSince awal = %v, want waktu didaftarkan", since())
	}

	now = time.Unix(2000, 0)
	_, _ = m.SetOnline("budi", true) // status sama: tidak mengulang hitungan
	_, _ = m.SetOpticalPower("c1", -22)
	if !since().Equal(time.Unix(1000, 0)) {
		t.Errorf("StatusSince = %v setelah pembaruan tanpa perubahan status, want tetap 1000", since())
	}

	now = time.Unix(3000, 0)
	_, _ = m.SetOnline("budi", false)
	if !since().Equal(time.Unix(3000, 0)) {
		t.Errorf("StatusSince = %v setelah putus, want 3000", since())
	}

	// Mengganti data pelanggan tanpa mengubah status mempertahankan hitungan.
	now = time.Unix(4000, 0)
	_ = m.UpsertCustomer(Customer{ID: "c1", Name: "Budi Baru", PPPoEUsername: "budi", RouterID: "r1", IsOnline: false})
	if !since().Equal(time.Unix(3000, 0)) {
		t.Errorf("StatusSince = %v setelah Upsert tanpa perubahan status, want tetap 3000", since())
	}
	// Mengganti data sekaligus mengubah status memulai hitungan baru.
	_ = m.UpsertCustomer(Customer{ID: "c1", PPPoEUsername: "budi", RouterID: "r1", IsOnline: true})
	if !since().Equal(time.Unix(4000, 0)) {
		t.Errorf("StatusSince = %v setelah Upsert yang mengubah status, want 4000", since())
	}
}

func TestRouterResourceAndInterfacesAreStoredPerRouter(t *testing.T) {
	m := newTestManager(t)
	if _, ok := m.RouterResource("r1"); ok {
		t.Error("RouterResource sebelum ada data seharusnya false")
	}
	if _, _, ok := m.RouterInterfaces("r1"); ok {
		t.Error("RouterInterfaces sebelum ada data seharusnya false")
	}

	at := time.Unix(1_700_000_000, 0)
	res := Resource{CPULoad: 42, FreeMemory: 100, TotalMemory: 400, Uptime: time.Hour, Version: "7.15", Board: "RB4011", At: at}
	if err := m.SetRouterResource("r1", res); err != nil {
		t.Fatal(err)
	}
	if got, ok := m.RouterResource("r1"); !ok || got != res {
		t.Errorf("RouterResource = %+v, %v; want %+v", got, ok, res)
	}
	if _, ok := m.RouterResource("r2"); ok {
		t.Error("data r1 tidak boleh terlihat di r2")
	}

	ifaces := []Interface{{Name: "ether1", Type: "ether", Running: true, RxError: 3}, {Name: "sfp1", Disabled: true}}
	if err := m.SetRouterInterfaces("r1", ifaces, at); err != nil {
		t.Fatal(err)
	}
	ifaces[0].RxError = 999 // mengubah slice asal tidak boleh memengaruhi state
	got, gotAt, ok := m.RouterInterfaces("r1")
	if !ok || len(got) != 2 || got[0].RxError != 3 || !gotAt.Equal(at) {
		t.Errorf("RouterInterfaces = %+v at %v, %v", got, gotAt, ok)
	}
	got[0].RxError = 777 // dan sebaliknya
	if again, _, _ := m.RouterInterfaces("r1"); again[0].RxError != 3 {
		t.Error("mengubah hasil RouterInterfaces memengaruhi state")
	}

	// Mengganti data router tidak menghapus resource-nya.
	_ = m.UpsertRouter(Router{ID: "r1", Name: "baru", Active: true})
	if _, ok := m.RouterResource("r1"); !ok {
		t.Error("UpsertRouter menghapus data resource")
	}

	for name, err := range map[string]error{
		"resource":   m.SetRouterResource("hilang", res),
		"interfaces": m.SetRouterInterfaces("hilang", nil, at),
	} {
		if !errors.Is(err, ErrUnknownRouter) {
			t.Errorf("%s untuk router tak dikenal: err = %v, want ErrUnknownRouter", name, err)
		}
	}
}
