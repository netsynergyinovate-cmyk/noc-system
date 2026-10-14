package hub

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"noc-isp/backend/internal/state"
)

// Tes perubahan status tagihan (billingChanges) lewat hub: model pengiriman, bentuk
// pesan, klien yang tersambung di tengah, klien lambat, banjir, dan golden.

const quietDelta = `{"type":"delta","time":1700000000,"traffic":null,"statusChanges":[]}`

func quietDeltaAt(sec int64) string {
	return fmt.Sprintf(`{"type":"delta","time":%d,"traffic":null,"statusChanges":[]}`, sec)
}

func readDelta(t *testing.T, conn *websocket.Conn) (deltaMessage, string) {
	t.Helper()
	raw := readRaw(t, conn)
	var d deltaMessage
	if err := json.Unmarshal(raw, &d); err != nil || d.Type != typeDelta {
		t.Fatalf("pesan = %s, want delta", raw)
	}
	return d, string(raw)
}

func ids(changes []billingChange) []string {
	out := make([]string, len(changes))
	for i, c := range changes {
		out[i] = c.CustomerID
	}
	return out
}

func bc(id, status string) state.BillingChange {
	return state.BillingChange{CustomerID: id, Status: status}
}

// joined menyambungkan klien dan membaca snapshot-nya (sesudah itu klien pasti sudah
// terdaftar di hub).
func joined(h *harness) (*websocket.Conn, snapshotMessage) {
	h.t.Helper()
	conn := h.connect()
	return conn, readAs[snapshotMessage](h.t, conn, typeSnapshot)
}

func TestBillingChangeReachesEveryConnectedClientOnTheNextDeltaExactlyOnce(t *testing.T) {
	h := newHarness(t, nil)
	a, _ := joined(h)
	b, _ := joined(h)

	// c2 sudah isolir: bukan perubahan, jadi tidak ikut.
	applied := h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir"), bc("c2", "isolir")})
	if len(applied) != 1 {
		t.Fatalf("applied = %+v", applied)
	}
	tickAt(h, 1)
	const want = `{"type":"delta","time":1700000000,"traffic":null,"statusChanges":[],"billingChanges":[{"customerId":"c1","status":"isolir"}]}`
	for name, conn := range map[string]*websocket.Conn{"a": a, "b": b} {
		if _, raw := readDelta(t, conn); raw != want {
			t.Errorf("klien %s: delta = %s\nwant %s", name, raw, want)
		}
	}

	// Sudah dikirim sekali: detik berikutnya kembali ke bentuk lama, tanpa kunci.
	tickAt(h, 2)
	for name, conn := range map[string]*websocket.Conn{"a": a, "b": b} {
		if _, raw := readDelta(t, conn); raw != quietDeltaAt(t0+1) {
			t.Errorf("klien %s: delta kedua = %s, perubahan terkirim dua kali atau kunci tersisa", name, raw)
		}
	}
}

func TestDeltaWithoutBillingChangesKeepsTheOldShape(t *testing.T) {
	h := newHarness(t, nil)
	conn, _ := joined(h)

	// Tidak ada perubahan: sama, id tak dikenal, status tak sah, daftar kosong.
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "lunas"), bc("tidak-ada", "isolir"), bc("c2", "rusak"), bc("c2", "")})
	h.mgr.SetBillingStatuses(nil)
	tickAt(h, 1)
	if _, raw := readDelta(t, conn); raw != quietDelta {
		t.Errorf("delta sepi = %s\nwant %s", raw, quietDelta)
	}

	// Delta dengan traffic dan status online juga tidak berubah bentuknya.
	_, _ = h.mgr.RecordTraffic("r1", state.TrafficPoint{Time: t0 + 1, RxMbps: 120.5, TxMbps: 20})
	change, _ := h.mgr.SetOnline("budi", false)
	h.hub.NotifyChange(change)
	tickAt(h, 2)
	const want = `{"type":"delta","time":1700000001,"traffic":{"time":1700000001,"rx":120.5,"tx":20},"statusChanges":[{"customerId":"c1","isOnline":false,"status":"offline","opticalPowerDbm":-20.5}]}`
	if _, raw := readDelta(t, conn); raw != want {
		t.Errorf("delta = %s\nwant %s", raw, want)
	}
}

func TestSnapshotCarriesTheBillingStatusInForceNow(t *testing.T) {
	h := newHarness(t, nil)
	_, before := joined(h)
	got := map[string]string{}
	for _, c := range before.Customers {
		got[c.ID] = c.BillingStatus
	}
	if !reflect.DeepEqual(got, map[string]string{"c1": "lunas", "c2": "isolir"}) {
		t.Fatalf("snapshot awal = %v", got)
	}

	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir"), bc("c2", "lunas")})
	_, after := joined(h)
	got = map[string]string{}
	for _, c := range after.Customers {
		got[c.ID] = c.BillingStatus
	}
	if !reflect.DeepEqual(got, map[string]string{"c1": "isolir", "c2": "lunas"}) {
		t.Errorf("snapshot sesudah sinkron = %v, want status yang berlaku sekarang", got)
	}
}

func TestClientJoiningAfterTheDeltaGetsTheNewStatusFromItsSnapshotAndNoOldChange(t *testing.T) {
	h := newHarness(t, nil)
	early, _ := joined(h)
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir")})
	tickAt(h, 1)
	if d, _ := readDelta(t, early); len(d.BillingChanges) != 1 {
		t.Fatalf("klien awal: %+v", d.BillingChanges)
	}

	late, snap := joined(h)
	if snap.Customers[0].ID != "c1" || snap.Customers[0].BillingStatus != "isolir" {
		t.Errorf("snapshot klien baru = %+v, want c1 isolir", snap.Customers[0])
	}
	tickAt(h, 2)
	if _, raw := readDelta(t, late); raw != quietDeltaAt(t0+1) {
		t.Errorf("klien baru menerima perubahan lama: %s", raw)
	}
}

// Klien yang tersambung SESUDAH perubahan tetapi SEBELUM delta berikutnya sudah
// membaca status barunya dari snapshot; ia tidak menerimanya lagi, sedangkan klien
// lama tetap menerimanya.
func TestClientJoiningBetweenTheChangeAndTheDeltaIsNotSentItAgain(t *testing.T) {
	h := newHarness(t, nil)
	early, _ := joined(h)
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir")})
	late, snap := joined(h)
	if snap.Customers[0].BillingStatus != "isolir" {
		t.Fatalf("snapshot = %+v", snap.Customers[0])
	}
	tickAt(h, 1)
	if d, _ := readDelta(t, early); !reflect.DeepEqual(ids(d.BillingChanges), []string{"c1"}) {
		t.Errorf("klien lama: %+v", d.BillingChanges)
	}
	if _, raw := readDelta(t, late); raw != quietDelta {
		t.Errorf("klien baru menerima perubahan yang sudah ada di snapshot-nya: %s", raw)
	}
}

func TestClientJoiningBetweenTwoChangesGetsOnlyTheLaterOne(t *testing.T) {
	h := newHarness(t, nil)
	early, _ := joined(h)
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir")})
	mid, _ := joined(h)
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c2", "lunas")})
	last, _ := joined(h)
	tickAt(h, 1)

	want := map[string][]string{"early": {"c1", "c2"}, "mid": {"c2"}, "last": nil}
	for name, conn := range map[string]*websocket.Conn{"early": early, "mid": mid, "last": last} {
		d, _ := readDelta(t, conn)
		if got := ids(d.BillingChanges); len(got) != len(want[name]) || (len(got) > 0 && !reflect.DeepEqual(got, want[name])) {
			t.Errorf("klien %s: perubahan = %v, want %v", name, got, want[name])
		}
	}
}

// Berbalik sesudah klien tersambung: keadaan akhir tetap harus sampai, kalau tidak
// klien itu menyimpan status yang salah selamanya.
func TestChangeThatFlipsBackAfterAClientJoinedStillReachesIt(t *testing.T) {
	h := newHarness(t, nil)
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir")})
	late, snap := joined(h) // melihat c1 isolir
	if snap.Customers[0].BillingStatus != "isolir" {
		t.Fatalf("snapshot = %+v", snap.Customers[0])
	}
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "lunas")})
	tickAt(h, 1)
	d, _ := readDelta(t, late)
	if len(d.BillingChanges) != 1 || d.BillingChanges[0] != (billingChange{"c1", "lunas"}) {
		t.Errorf("perubahan = %+v, want c1 lunas", d.BillingChanges)
	}
}

func TestBillingChangeIsOnlyInTheFirstDeltaOfACatchUp(t *testing.T) {
	h := newHarness(t, nil)
	conn, _ := joined(h)
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir")})
	tickAt(h, 4) // t0..t0+3
	for i := int64(0); i < 4; i++ {
		d, _ := readDelta(t, conn)
		want := 0
		if i == 0 {
			want = 1 // hanya delta pertama membawanya
		}
		if len(d.BillingChanges) != want {
			t.Errorf("delta %d: %d perubahan, want %d", d.Time, len(d.BillingChanges), want)
		}
	}
}

func TestBillingChangeNeverUsesTheStatusMessage(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.StatusFlush = 20 * time.Millisecond })
	conn, _ := joined(h)
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir")})
	time.Sleep(120 * time.Millisecond) // pesan status yang bocor akan tiba lebih dulu
	tickAt(h, 1)
	if d, _ := readDelta(t, conn); len(d.BillingChanges) != 1 {
		t.Errorf("perubahan = %+v", d.BillingChanges)
	}
}

func TestHubWithoutClientsStillDrainsAndLaterClientsSeeTheCurrentStatus(t *testing.T) {
	h := newHarness(t, nil)
	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir")})
	tickAt(h, 1) // tanpa klien
	if left := h.mgr.DrainBillingChanges(0); left != nil {
		t.Fatalf("antrean tidak diambil hub: %+v", left)
	}
	conn, snap := joined(h)
	if snap.Customers[0].BillingStatus != "isolir" {
		t.Errorf("snapshot = %+v", snap.Customers[0])
	}
	tickAt(h, 2)
	if _, raw := readDelta(t, conn); raw != quietDeltaAt(t0+1) {
		t.Errorf("delta = %s", raw)
	}
}

func TestSlowClientIsDroppedOnABillingDeltaWhileOthersStillReceiveIt(t *testing.T) {
	h := newHarness(t, nil)
	healthy, _ := joined(h)
	slow := &client{hub: h.hub, send: make(chan *websocket.PreparedMessage, 1), done: make(chan struct{})}
	slow.send <- nil // antrean penuh
	h.hub.mu.Lock()
	h.hub.clients[slow] = struct{}{}
	h.hub.mu.Unlock()

	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c1", "isolir")})
	finished := make(chan struct{})
	go func() { tickAt(h, 1); close(finished) }()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("tick menunggu klien yang lambat")
	}
	if d, _ := readDelta(t, healthy); len(d.BillingChanges) != 1 {
		t.Errorf("klien sehat: %+v", d.BillingChanges)
	}
	if h.hub.ClientCount() != 1 {
		t.Errorf("ClientCount = %d, want 1 (hanya klien sehat)", h.hub.ClientCount())
	}
	if slow.closeCode != websocket.ClosePolicyViolation {
		t.Errorf("kode close klien lambat = %d, want %d", slow.closeCode, websocket.ClosePolicyViolation)
	}
}

// addCustomers menambah n pelanggan beralamat UUID (seperti customers.id) berstatus lunas.
func addCustomers(t *testing.T, h *harness, n int) []string {
	t.Helper()
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1)
		err := h.mgr.UpsertCustomer(state.Customer{
			ID: out[i], Name: "P" + out[i][len(out[i])-4:], PPPoEUsername: "u-" + out[i], RouterID: "r1", BillingStatus: "lunas",
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	return out
}

func flipAll(h *harness, customers []string) {
	changes := make([]state.BillingChange, len(customers))
	for i, id := range customers {
		changes[i] = bc(id, "isolir")
	}
	h.mgr.SetBillingStatuses(changes)
}

// 500 pelanggan berubah sekaligus: SATU delta yang sah berisi semuanya (batasnya
// 2000), terurut, jauh di bawah batas ukuran, dan klien tidak dianggap lambat.
func TestFloodOf500BillingChangesIsOneValidDeltaWithNothingDropped(t *testing.T) {
	h := newHarness(t, nil)
	conn, _ := joined(h)
	customers := addCustomers(t, h, 500)
	flipAll(h, customers)
	tickAt(h, 1)

	d, raw := readDelta(t, conn)
	if len(d.BillingChanges) != 500 {
		t.Fatalf("billingChanges = %d, want 500 dalam satu delta", len(d.BillingChanges))
	}
	for i, c := range d.BillingChanges {
		if c.CustomerID != customers[i] || c.Status != "isolir" {
			t.Fatalf("entri %d = %+v, want %s isolir (terurut menurut ID)", i, c, customers[i])
		}
	}
	if len(raw) > 64<<10 {
		t.Errorf("delta = %d byte, want di bawah 64 KiB untuk 500 perubahan", len(raw))
	}
	t.Logf("delta dengan 500 perubahan: %d byte", len(raw))
	if h.hub.ClientCount() != 1 {
		t.Error("klien diputus karena banjir perubahan")
	}
	tickAt(h, 2)
	if _, raw := readDelta(t, conn); raw != quietDeltaAt(t0+1) {
		t.Errorf("sesudah banjir: %s", raw)
	}
}

// Di atas batas per delta, sisanya dikirim pada detik-detik berikutnya menurut urutan
// ID: tidak dipotong diam-diam dan tidak ada yang terkirim dua kali.
func TestFloodAboveTheLimitIsSplitAcrossDeltasInOrder(t *testing.T) {
	for name, tc := range map[string]struct {
		limit, total int
		want         []int
	}{
		"batas khusus 100":  {100, 250, []int{100, 100, 50}},
		"batas bawaan 2000": {0, 4500, []int{2000, 2000, 500}},
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, func(o *Options) { o.MaxBillingChanges = tc.limit })
			conn, _ := joined(h)
			customers := addCustomers(t, h, tc.total)
			flipAll(h, customers)
			if tc.limit == 0 && h.hub.opts.MaxBillingChanges != 2000 {
				t.Fatalf("batas bawaan = %d, want 2000", h.hub.opts.MaxBillingChanges)
			}

			tickAt(h, 1)
			tickAt(h, 2)
			tickAt(h, 3)
			var seen []string
			for i, want := range tc.want {
				d, raw := readDelta(t, conn)
				if len(d.BillingChanges) != want {
					t.Fatalf("delta %d memuat %d perubahan, want %d", i, len(d.BillingChanges), want)
				}
				if len(raw) > 256<<10 {
					t.Errorf("delta %d = %d byte, terlalu besar", i, len(raw))
				}
				seen = append(seen, ids(d.BillingChanges)...)
			}
			if !reflect.DeepEqual(seen, customers) {
				t.Errorf("gabungan pecahan tidak sama dengan semua perubahan menurut urutan ID (%d vs %d)", len(seen), len(customers))
			}
			tickAt(h, 4)
			if _, raw := readDelta(t, conn); strings.Contains(raw, "billingChanges") {
				t.Errorf("sisa terkirim lagi: %.120s", raw)
			}
		})
	}
}

// Perubahan datang terus selagi tick berjalan dan klien tersambung di tengah-tengah:
// pada akhirnya setiap klien memegang status yang sama dengan Manager.
func TestEveryClientConvergesWhileChangesTicksAndJoinsRaceEachOther(t *testing.T) {
	h := newHarness(t, nil)
	customers := addCustomers(t, h, 40)

	type view struct {
		mu       sync.Mutex
		status   map[string]string
		lastTime int64
	}
	collect := func() *view {
		conn, snap := joined(h)
		v := &view{status: map[string]string{}, lastTime: snap.Time}
		for _, c := range snap.Customers {
			v.status[c.ID] = c.BillingStatus
		}
		go func() {
			for {
				_, data, err := conn.ReadMessage()
				if err != nil {
					return
				}
				var d deltaMessage
				if json.Unmarshal(data, &d) != nil || d.Type != typeDelta {
					continue
				}
				v.mu.Lock()
				for _, b := range d.BillingChanges {
					v.status[b.CustomerID] = b.Status
				}
				v.lastTime = d.Time
				v.mu.Unlock()
			}
		}()
		return v
	}

	var writer sync.WaitGroup
	writer.Add(1)
	go func() {
		defer writer.Done()
		rng := rand.New(rand.NewSource(7))
		for round := 0; round < 400; round++ {
			var batch []state.BillingChange
			for k := 0; k <= rng.Intn(4); k++ {
				status := "lunas"
				if rng.Intn(2) == 0 {
					status = "isolir"
				}
				batch = append(batch, bc(customers[rng.Intn(len(customers))], status))
			}
			h.mgr.SetBillingStatuses(batch)
			if round%3 == 0 {
				time.Sleep(time.Millisecond)
			}
		}
	}()

	views := []*view{collect()}
	const ticks = 90
	for i := int64(1); i <= ticks; i++ {
		tickAt(h, i)
		if i%10 == 0 {
			views = append(views, collect())
		}
		time.Sleep(2 * time.Millisecond)
	}
	writer.Wait()
	final := int64(ticks) + 3
	for i := int64(ticks) + 1; i <= final; i++ {
		tickAt(h, i) // menguras sisa perubahan
	}

	want := map[string]string{}
	for _, c := range h.mgr.Customers() {
		want[c.ID] = c.BillingStatus
	}
	for i, v := range views {
		waitFor(t, fmt.Sprintf("klien %d menerima delta terakhir", i), func() bool {
			v.mu.Lock()
			defer v.mu.Unlock()
			return v.lastTime == t0+final-1
		})
		v.mu.Lock()
		if !reflect.DeepEqual(v.status, want) {
			for id, w := range want {
				if v.status[id] != w {
					t.Errorf("klien %d: %s = %q, want %q", i, id, v.status[id], w)
					break
				}
			}
		}
		v.mu.Unlock()
	}
}

// --- Golden -----------------------------------------------------------------

// checkGolden membandingkan pesan yang dihasilkan hub dengan testdata/<name> BYTE
// PER BYTE (JSON diberi indentasi dua spasi; akhir baris CRLF karena git autocrlf di
// Windows diabaikan). Berkasnya hanya ditulis bila UPDATE_GOLDEN=1.
// e2e/billing-ws-contract.spec.ts membaca berkas yang sama dan memakainya pada store
// frontend yang sungguhan.
func checkGolden(t *testing.T, name string, message []byte) {
	t.Helper()
	var indented bytes.Buffer
	if err := json.Indent(&indented, bytes.TrimSpace(message), "", "  "); err != nil {
		t.Fatalf("pesan bukan JSON: %v\n%s", err, message)
	}
	indented.WriteByte('\n')
	got := indented.Bytes()
	path := filepath.Join("testdata", name)
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("golden %s ditulis ulang (UPDATE_GOLDEN=1)", name)
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("baca golden %s: %v (buat dengan UPDATE_GOLDEN=1)", name, err)
	}
	want := bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
	if bytes.Equal(got, want) {
		return
	}
	gotLines, wantLines := strings.Split(string(got), "\n"), strings.Split(string(want), "\n")
	for i := 0; i < max(len(gotLines), len(wantLines)); i++ {
		var g, w string
		if i < len(gotLines) {
			g = gotLines[i]
		}
		if i < len(wantLines) {
			w = wantLines[i]
		}
		if g != w {
			t.Fatalf("golden %s berbeda di baris %d:\n  pesan:  %s\n  berkas: %s\n(UPDATE_GOLDEN=1 hanya bila perubahan kontraknya disengaja)", name, i+1, g, w)
		}
	}
	t.Fatalf("golden %s berbeda (panjang %d vs %d)", name, len(got), len(want))
}

// Data tetap dan jam palsu, jadi pesannya sama setiap kali. Snapshot diambil SEBELUM
// sinkron, delta membawa hasilnya: c1 lunas->isolir, c2 isolir->lunas, c3 tetap
// lunas, c4 tetap isolir; c3 juga putus (statusChanges) pada detik yang sama.
func TestGoldenSnapshotAndDeltaWithBillingChanges(t *testing.T) {
	h := newHarness(t, nil)
	if err := h.mgr.UpsertCustomer(state.Customer{
		ID: "c3", Name: "Agus", PPPoEUsername: "agus", RouterID: "r1", BillingStatus: "lunas", IsOnline: true,
		Latitude: -6.91, Longitude: 107.61, HasLocation: true, OpticalPowerDbm: -22.25, HasOptical: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := h.mgr.UpsertCustomer(state.Customer{
		ID: "c4", Name: "Dewi", PPPoEUsername: "dewi", RouterID: "r1", BillingStatus: "isolir", IsOnline: true,
	}); err != nil {
		t.Fatal(err)
	}
	conn := h.connect()
	snapshot := readRaw(t, conn)
	checkGolden(t, "snapshot_billing.golden.json", snapshot)

	h.mgr.SetBillingStatuses([]state.BillingChange{bc("c3", "lunas"), bc("c2", "lunas"), bc("c1", "isolir"), bc("c4", "isolir")})
	_, _ = h.mgr.RecordTraffic("r1", state.TrafficPoint{Time: t0, RxMbps: 120.5, TxMbps: 20})
	change, _ := h.mgr.SetOnline("agus", false)
	h.hub.NotifyChange(change)
	tickAt(h, 1)
	checkGolden(t, "delta_billing.golden.json", readRaw(t, conn))
}
