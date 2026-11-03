package state

import (
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"
)

// billingManager membuat Manager dengan pelanggan c1..cN, semuanya "lunas".
func billingManager(t *testing.T, n int) *Manager {
	t.Helper()
	m := newTestManager(t)
	for i := 1; i <= n; i++ {
		id := fmt.Sprintf("c%03d", i)
		err := m.UpsertCustomer(Customer{
			ID: id, Name: id, PPPoEUsername: "u-" + id, RouterID: "r1", IsOnline: true, BillingStatus: BillingLunas,
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	return m
}

func statusOf(t *testing.T, m *Manager, id string) string {
	t.Helper()
	for _, c := range m.Customers() {
		if c.ID == id {
			return c.BillingStatus
		}
	}
	t.Fatalf("pelanggan %s tidak ada", id)
	return ""
}

func queuedIDs(queued []QueuedBilling) []string {
	out := make([]string, len(queued))
	for i, q := range queued {
		out[i] = q.CustomerID
	}
	return out
}

func TestSetBillingStatusesUpdatesStateAndSnapshot(t *testing.T) {
	m := billingManager(t, 3)
	applied := m.SetBillingStatuses([]BillingChange{{"c001", BillingIsolir}, {"c003", BillingIsolir}})
	want := []BillingChange{{"c001", BillingIsolir}, {"c003", BillingIsolir}}
	if !reflect.DeepEqual(applied, want) {
		t.Errorf("applied = %+v, want %+v", applied, want)
	}
	snap := m.Snapshot()
	got := map[string]string{}
	for _, c := range snap.Customers {
		got[c.ID] = c.BillingStatus
	}
	if got["c001"] != BillingIsolir || got["c002"] != BillingLunas || got["c003"] != BillingIsolir {
		t.Errorf("status di snapshot = %v", got)
	}
}

func TestSetBillingStatusesDoesNotTouchOnlineStateOrOtherFields(t *testing.T) {
	m := billingManager(t, 1)
	before := m.Customers()[0]
	m.SetBillingStatuses([]BillingChange{{"c001", BillingIsolir}})
	after := m.Customers()[0]
	if after.BillingStatus != BillingIsolir {
		t.Fatalf("status = %q", after.BillingStatus)
	}
	after.BillingStatus, after.LastUpdatedAt = before.BillingStatus, before.LastUpdatedAt
	if !reflect.DeepEqual(before, after) {
		t.Errorf("sinkron billing mengubah bidang lain:\nsebelum %+v\nsesudah %+v", before, after)
	}
	if got, ok := m.CustomerByPPPoE("u-c001"); !ok || got.BillingStatus != BillingIsolir {
		t.Errorf("CustomerByPPPoE = %+v, %v", got, ok)
	}
}

func TestUnchangedStatusIsNeitherReportedNorQueued(t *testing.T) {
	m := billingManager(t, 3)
	applied := m.SetBillingStatuses([]BillingChange{
		{"c001", BillingLunas}, // sudah lunas
		{"c002", BillingIsolir},
		{"c003", BillingLunas}, // sudah lunas
	})
	if want := []BillingChange{{"c002", BillingIsolir}}; !reflect.DeepEqual(applied, want) {
		t.Errorf("applied = %+v, want %+v", applied, want)
	}
	if got := queuedIDs(m.DrainBillingChanges(0)); !reflect.DeepEqual(got, []string{"c002"}) {
		t.Errorf("antrean = %v, want hanya c002", got)
	}

	// Tidak ada yang berubah sama sekali: tidak ada antrean dan nomor urut tidak maju.
	seq := m.Snapshot().BillingSeq
	if got := m.SetBillingStatuses([]BillingChange{{"c001", BillingLunas}, {"c002", BillingIsolir}}); len(got) != 0 {
		t.Errorf("applied = %+v, want kosong", got)
	}
	if got := m.DrainBillingChanges(0); got != nil {
		t.Errorf("antrean = %+v, want nil", got)
	}
	if m.Snapshot().BillingSeq != seq {
		t.Error("nomor urut maju walau tidak ada yang berubah")
	}
	if got := m.SetBillingStatuses(nil); got != nil {
		t.Errorf("masukan kosong = %+v, want nil", got)
	}
}

func TestUnknownCustomersAndInvalidStatusesAreIgnoredWithoutPanic(t *testing.T) {
	m := billingManager(t, 2)
	applied := m.SetBillingStatuses([]BillingChange{
		{"tidak-ada", BillingIsolir},
		{"", BillingIsolir},
		{"c001", ""},
		{"c001", "LUNAS"},
		{"c001", "paid"},
		{"c002", BillingIsolir}, // satu-satunya yang sah
	})
	if want := []BillingChange{{"c002", BillingIsolir}}; !reflect.DeepEqual(applied, want) {
		t.Errorf("applied = %+v, want %+v", applied, want)
	}
	if got := statusOf(t, m, "c001"); got != BillingLunas {
		t.Errorf("c001 = %q, status tidak sah tidak boleh tersimpan", got)
	}
	if n := len(m.Customers()); n != 2 {
		t.Errorf("jumlah pelanggan = %d, want 2 (id asing tidak boleh menciptakan pelanggan)", n)
	}
	if got := queuedIDs(m.DrainBillingChanges(0)); !reflect.DeepEqual(got, []string{"c002"}) {
		t.Errorf("antrean = %v, want hanya c002", got)
	}

	// Manager kosong juga tidak panik.
	empty := NewManager()
	if got := empty.SetBillingStatuses([]BillingChange{{"c001", BillingIsolir}}); len(got) != 0 {
		t.Errorf("Manager kosong menerapkan %+v", got)
	}
	if got := empty.DrainBillingChanges(10); got != nil {
		t.Errorf("Manager kosong: antrean = %+v", got)
	}
}

func TestApplyingTheSameChangeTwiceYieldsOneQueuedChange(t *testing.T) {
	m := billingManager(t, 2)
	change := []BillingChange{{"c001", BillingIsolir}}
	if first := m.SetBillingStatuses(change); len(first) != 1 {
		t.Fatalf("pertama = %+v", first)
	}
	if second := m.SetBillingStatuses(change); len(second) != 0 {
		t.Errorf("kedua = %+v, want kosong (idempoten)", second)
	}
	drained := m.DrainBillingChanges(0)
	if len(drained) != 1 || drained[0].CustomerID != "c001" || drained[0].Status != BillingIsolir {
		t.Errorf("antrean = %+v, want satu entri c001 isolir", drained)
	}
	// Diterapkan lagi sesudah diambil: tetap tidak ada perubahan baru.
	if again := m.SetBillingStatuses(change); len(again) != 0 || m.DrainBillingChanges(0) != nil {
		t.Errorf("penerapan ketiga menghasilkan perubahan: %+v", again)
	}
}

func TestDrainReturnsSortedLatestStatusThenEmpties(t *testing.T) {
	m := billingManager(t, 5)
	m.SetBillingStatuses([]BillingChange{{"c005", BillingIsolir}, {"c002", BillingIsolir}, {"c004", BillingIsolir}})
	// c002 berbalik sebelum diambil: yang disiarkan keadaan terbarunya.
	m.SetBillingStatuses([]BillingChange{{"c002", BillingLunas}})

	drained := m.DrainBillingChanges(0)
	got := make([]BillingChange, len(drained))
	for i, q := range drained {
		got[i] = q.BillingChange
	}
	want := []BillingChange{{"c002", BillingLunas}, {"c004", BillingIsolir}, {"c005", BillingIsolir}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("antrean = %+v, want %+v", got, want)
	}
	if again := m.DrainBillingChanges(0); again != nil {
		t.Errorf("pengambilan kedua = %+v, want nil", again)
	}
}

func TestDrainLimitSplitsInIDOrderWithoutLossOrRepeat(t *testing.T) {
	m := billingManager(t, 25)
	var all []BillingChange
	for i := 25; i >= 1; i-- { // masukan terbalik: urutan antrean tidak bergantung padanya
		all = append(all, BillingChange{fmt.Sprintf("c%03d", i), BillingIsolir})
	}
	m.SetBillingStatuses(all)

	var batches [][]string
	var seen []string
	for {
		part := m.DrainBillingChanges(10)
		if part == nil {
			break
		}
		batches = append(batches, queuedIDs(part))
		seen = append(seen, queuedIDs(part)...)
	}
	if len(batches) != 3 || len(batches[0]) != 10 || len(batches[1]) != 10 || len(batches[2]) != 5 {
		t.Fatalf("pecahan = %v, want 10+10+5", batches)
	}
	for i, id := range seen {
		if want := fmt.Sprintf("c%03d", i+1); id != want {
			t.Fatalf("urutan[%d] = %s, want %s", i, id, want)
		}
	}
}

func TestLimitedDrainKeepsTheRemainderChangeableAndUnique(t *testing.T) {
	m := billingManager(t, 4)
	m.SetBillingStatuses([]BillingChange{{"c001", BillingIsolir}, {"c002", BillingIsolir}, {"c003", BillingIsolir}})
	first := m.DrainBillingChanges(2)
	if got := queuedIDs(first); !reflect.DeepEqual(got, []string{"c001", "c002"}) {
		t.Fatalf("pecahan pertama = %v", got)
	}
	// Sisa (c003) berbalik sebelum diambil: yang diambil keadaan terbarunya.
	m.SetBillingStatuses([]BillingChange{{"c003", BillingLunas}})
	rest := m.DrainBillingChanges(2)
	if len(rest) != 1 || rest[0].CustomerID != "c003" || rest[0].Status != BillingLunas {
		t.Errorf("sisa = %+v, want c003 lunas", rest)
	}
}

func TestBillingSeqIsPerBatchAndMatchesSnapshot(t *testing.T) {
	m := billingManager(t, 4)
	if got := m.Snapshot().BillingSeq; got != 0 {
		t.Fatalf("BillingSeq awal = %d, want 0", got)
	}
	m.SetBillingStatuses([]BillingChange{{"c001", BillingIsolir}, {"c002", BillingIsolir}})
	if got := m.Snapshot().BillingSeq; got != 1 {
		t.Errorf("BillingSeq = %d, want 1", got)
	}
	m.SetBillingStatuses([]BillingChange{{"c003", BillingIsolir}})
	if got := m.Snapshot().BillingSeq; got != 2 {
		t.Errorf("BillingSeq = %d, want 2", got)
	}
	// c001 diubah lagi pada kelompok ketiga: antreannya memakai nomor urut terakhir.
	m.SetBillingStatuses([]BillingChange{{"c001", BillingLunas}})
	seqs := map[string]uint64{}
	for _, q := range m.DrainBillingChanges(0) {
		seqs[q.CustomerID] = q.Seq
	}
	want := map[string]uint64{"c001": 3, "c002": 1, "c003": 2}
	if !reflect.DeepEqual(seqs, want) {
		t.Errorf("nomor urut = %v, want %v", seqs, want)
	}
	// Mengambil antrean tidak memundurkan nomor urut.
	if got := m.Snapshot().BillingSeq; got != 3 {
		t.Errorf("BillingSeq sesudah diambil = %d, want 3", got)
	}
}

func TestBillingChangesDoNotAffectOnlineChangeDetection(t *testing.T) {
	m := billingManager(t, 1)
	m.SetBillingStatuses([]BillingChange{{"c001", BillingIsolir}})
	change, err := m.SetOnline("u-c001", true)
	if err != nil || change.Changed() {
		t.Errorf("SetOnline(true) sesudah perubahan tagihan: Changed = %v, err = %v", change.Changed(), err)
	}
	if change.After.BillingStatus != BillingIsolir {
		t.Errorf("status tagihan hilang: %q", change.After.BillingStatus)
	}
}

// Penulis, pembaca snapshot, dan pengambil antrean berjalan bersamaan. Yang dijaga:
//   - kelompok yang menyentuh dua pelanggan terlihat utuh (snapshot tidak pernah
//     melihat separuhnya);
//   - tidak ada perubahan yang hilang: status terakhir yang diambil pengambil sama
//     dengan status akhir di Manager untuk setiap pelanggan.
func TestConcurrentWritersReadersAndDrainerConverge(t *testing.T) {
	const pairs = 40
	m := billingManager(t, pairs*2)
	pairIDs := func(p int) (string, string) {
		return fmt.Sprintf("c%03d", 2*p+1), fmt.Sprintf("c%03d", 2*p+2)
	}

	var (
		writers sync.WaitGroup
		support sync.WaitGroup
		stop    = make(chan struct{})
		mu      sync.Mutex
		last    = map[string]string{} // status terakhir yang diambil per pelanggan
	)

	// Dua penulis memegang separuh pasangan masing-masing, supaya status akhir tiap
	// pelanggan pasti ditentukan satu penulis.
	for w := 0; w < 2; w++ {
		writers.Add(1)
		go func(w int) {
			defer writers.Done()
			for round := 0; round < 60; round++ {
				status := BillingIsolir
				if round%2 == 1 {
					status = BillingLunas
				}
				for p := w; p < pairs; p += 2 {
					a, b := pairIDs(p)
					m.SetBillingStatuses([]BillingChange{{a, status}, {b, status}})
				}
			}
		}(w)
	}

	var failures []string
	support.Add(1)
	go func() { // pembaca snapshot
		defer support.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			byID := map[string]string{}
			snap := m.Snapshot()
			for _, c := range snap.Customers {
				byID[c.ID] = c.BillingStatus
			}
			for p := 0; p < pairs; p++ {
				a, b := pairIDs(p)
				if byID[a] != byID[b] {
					mu.Lock()
					failures = append(failures, fmt.Sprintf("snapshot melihat separuh kelompok: %s=%s %s=%s", a, byID[a], b, byID[b]))
					mu.Unlock()
					return
				}
			}
		}
	}()
	support.Add(1)
	go func() { // pengambil antrean, dengan batas supaya sisa juga teruji
		defer support.Done()
		drain := func() {
			for _, q := range m.DrainBillingChanges(7) {
				mu.Lock()
				last[q.CustomerID] = q.Status
				mu.Unlock()
			}
		}
		for {
			select {
			case <-stop:
				return
			default:
				drain()
			}
		}
	}()

	writers.Wait()
	close(stop)
	support.Wait()
	for {
		rest := m.DrainBillingChanges(7)
		if rest == nil {
			break
		}
		for _, q := range rest {
			last[q.CustomerID] = q.Status
		}
	}

	if len(failures) > 0 {
		t.Fatal(failures[0])
	}
	for _, c := range m.Customers() {
		// Ronde terakhir (59) ganjil, jadi lunas; semua pelanggan berubah paling sedikit sekali.
		if c.BillingStatus != BillingLunas {
			t.Errorf("%s = %q, want lunas", c.ID, c.BillingStatus)
		}
		if got, ok := last[c.ID]; !ok || got != c.BillingStatus {
			t.Errorf("%s: status terakhir yang disiarkan = %q (ada=%v), status akhir = %q", c.ID, got, ok, c.BillingStatus)
		}
	}
	if left := m.DrainBillingChanges(0); left != nil {
		t.Errorf("sisa antrean = %+v", left)
	}
}

func TestSetBillingStatusesUsesTheManagerClockForLastUpdatedAt(t *testing.T) {
	now := time.Unix(2_000_000_000, 0)
	m := NewManager(WithClock(func() time.Time { return now }))
	_ = m.UpsertRouter(Router{ID: "r1"})
	_ = m.UpsertCustomer(Customer{ID: "c1", PPPoEUsername: "u1", RouterID: "r1", BillingStatus: BillingLunas, LastUpdatedAt: time.Unix(1, 0)})
	m.SetBillingStatuses([]BillingChange{{"c1", BillingIsolir}})
	if got := m.Customers()[0].LastUpdatedAt; !got.Equal(now) {
		t.Errorf("LastUpdatedAt = %v, want %v", got, now)
	}
}
func TestRouterOverrideWinsOverBillingInSnapshotAndDrain(t *testing.T) {
	m := NewManager()
	_ = m.UpsertRouter(Router{ID: "r1"})
	_ = m.UpsertCustomer(Customer{ID: "c1", PPPoEUsername: "u1", RouterID: "r1", BillingStatus: BillingLunas})

	// Belum ada bukti router: EffectiveBillingStatus mengikuti billing
	if got := m.Customers()[0].EffectiveBillingStatus(); got != BillingLunas {
		t.Fatalf("EffectiveBillingStatus sebelum router = %q, want lunas", got)
	}

	// Bukti router masuk: isolir = true
	changed := m.SetIsolirRouter(map[string]bool{"c1": true})
	if changed != 1 {
		t.Fatalf("SetIsolirRouter changed = %d, want 1", changed)
	}

	c := m.Customers()[0]
	if c.BillingStatus != BillingLunas {
		t.Errorf("raw BillingStatus harus tetap lunas, got %q", c.BillingStatus)
	}
	if c.EffectiveBillingStatus() != BillingIsolir {
		t.Errorf("EffectiveBillingStatus harus isolir, got %q", c.EffectiveBillingStatus())
	}

	drained := m.DrainBillingChanges(0)
	if len(drained) != 1 || drained[0].CustomerID != "c1" || drained[0].Status != BillingIsolir {
		t.Fatalf("DrainBillingChanges = %+v, want c1 isolir", drained)
	}
}

func TestBillingChangeUnderRouterOverrideDoesNotBroadcast(t *testing.T) {
	m := NewManager()
	_ = m.UpsertRouter(Router{ID: "r1"})
	_ = m.UpsertCustomer(Customer{ID: "c1", PPPoEUsername: "u1", RouterID: "r1", BillingStatus: BillingLunas})

	// Router isolir aktif dan sudah didrain
	m.SetIsolirRouter(map[string]bool{"c1": true})
	_ = m.DrainBillingChanges(0)

	// Sinkron billing mengubah status tagihan dari lunas ke isolir
	applied := m.SetBillingStatuses([]BillingChange{{"c1", BillingIsolir}})
	if len(applied) != 1 {
		t.Fatalf("SetBillingStatuses applied = %d, want 1", len(applied))
	}
	if c := m.Customers()[0]; c.BillingStatus != BillingIsolir {
		t.Fatalf("raw BillingStatus = %q, want isolir", c.BillingStatus)
	}

	// Karena effective status sudah isolir sebelumnya (karena router override),
	// tidak ada perubahan efektif -> antrean siaran tetap kosong!
	if left := m.DrainBillingChanges(0); len(left) != 0 {
		t.Errorf("DrainBillingChanges = %+v, want kosong karena effective status tidak berubah", left)
	}
}

func TestBillingServiceMismatchUsesRawBillingStatus(t *testing.T) {
	now := time.Now()
	m := NewManager(WithClock(func() time.Time { return now }))
	_ = m.UpsertRouter(Router{ID: "r1"})
	// c1: billing isolir, online, tapi router override mengatakan false (tidak masuk address-list isolir)
	isoFalse := false
	_ = m.UpsertCustomer(Customer{
		ID:            "c1",
		PPPoEUsername: "u1",
		RouterID:      "r1",
		BillingStatus: BillingIsolir,
		IsOnline:      true,
		IsolirRouter:  &isoFalse,
		StatusSince:   now.Add(-time.Hour),
	})

	mismatches := m.BillingServiceMismatches()
	if len(mismatches) != 1 || mismatches[0].CustomerID != "c1" || mismatches[0].Type != "isolir_online" {
		t.Fatalf("BillingServiceMismatches = %+v, want c1 isolir_online", mismatches)
	}
}
