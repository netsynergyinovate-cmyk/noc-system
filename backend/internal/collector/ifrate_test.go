package collector

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestIfRateIsBytesTimes8OverSeconds(t *testing.T) {
	t0 := time.Unix(1000, 0)
	rx, tx, ok := ifRate(ifSample{t0, 1_000_000, 0}, ifSample{t0.Add(time.Second), 26_000_000, 125_000})
	if !ok || !near(rx, 200) || !near(tx, 1) {
		t.Fatalf("rx=%v tx=%v ok=%v (rx 25 MB/detik = 200 Mbps, tx 125 KB/detik = 1 Mbps)", rx, tx, ok)
	}
	// selang bukan satu detik: laju dibagi selang sebenarnya, bukan dianggap satu detik
	rx, _, ok = ifRate(ifSample{t0, 0, 0}, ifSample{t0.Add(500 * time.Millisecond), 12_500_000, 0})
	if !ok || !near(rx, 200) {
		t.Fatalf("500 ms: rx=%v ok=%v", rx, ok)
	}
}

func TestIfRateRefusesSamplesThatAreNotARate(t *testing.T) {
	t0 := time.Unix(1000, 0)
	prev := ifSample{t0, 5000, 5000}
	for name, cur := range map[string]ifSample{
		"counter rx turun (router restart)": {t0.Add(time.Second), 100, 9000},
		"counter tx turun":                  {t0.Add(time.Second), 9000, 100},
		"waktu sama":                        {t0, 6000, 6000},
		"waktu mundur":                      {t0.Add(-time.Second), 6000, 6000},
		"lubang terlalu lama":               {t0.Add(maxIfGap + time.Second), 6000, 6000},
	} {
		if _, _, ok := ifRate(prev, cur); ok {
			t.Errorf("%s: harus ditolak", name)
		}
	}
	if _, _, ok := ifRate(prev, ifSample{t0.Add(maxIfGap), 6000, 6000}); !ok {
		t.Error("tepat di batas selang harus diterima")
	}
}

func TestPickByCommentNeverGuesses(t *testing.T) {
	rows := []IfCounters{{Name: "ether1", Comment: ""}, {Name: "ether2-lan0", Comment: "UPLINK"}, {Name: "ether4-lan1", Comment: "OLT"}}
	if got := pickByComment(rows, "UPLINK"); got != "ether2-lan0" {
		t.Errorf("got %q", got)
	}
	if got := pickByComment(rows, "uplink"); got != "ether2-lan0" {
		t.Errorf("huruf kecil: %q", got)
	}
	if got := pickByComment(rows, "TIDAK ADA"); got != "" {
		t.Errorf("tidak ada: %q", got)
	}
	rows = append(rows, IfCounters{Name: "ether9", Comment: " Uplink "})
	if got := pickByComment(rows, "UPLINK"); got != "" {
		t.Errorf("dua kandidat harus tidak dipilih, got %q", got)
	}
}

func TestParseIfCountersToleratesBadRows(t *testing.T) {
	rows, err := parseIfCounters([]byte(`[{"name":"a","rx-byte":"10","tx-byte":"20","comment":"UPLINK"},{"name":"","rx-byte":"1","tx-byte":"2"},{"name":"b","rx-byte":"x","tx-byte":"2"}]`))
	if err != nil || len(rows) != 2 {
		t.Fatalf("rows=%v err=%v", rows, err)
	}
	if rows[0].RxBytes != 10 || rows[0].TxBytes != 20 || rows[1].RxBytes != 0 || rows[1].TxBytes != 0 {
		t.Fatalf("rows = %+v", rows)
	}
	if _, err := parseIfCounters([]byte(`{"bukan":"daftar"}`)); err == nil {
		t.Error("bukan daftar harus galat")
	}
}

// fakeIfRouter: /rest/interface dengan counter yang bisa diatur dan penyaring name=.
type fakeIfRouter struct {
	mu       sync.Mutex
	rx, tx   uint64
	comment  string
	gone     bool
	hitsList int
	hitsOne  int
}

func (f *fakeIfRouter) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/rest/interface" {
			t.Errorf("path tak terduga %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		name := r.URL.Query().Get("name")
		if name == "" {
			f.hitsList++
		} else {
			f.hitsOne++
		}
		if f.gone {
			fmt.Fprint(w, `[]`)
			return
		}
		all := fmt.Sprintf(`[{"name":"ether1","rx-byte":"1","tx-byte":"1"},{"name":"ether2-lan0","rx-byte":"%d","tx-byte":"%d","comment":%q}]`, f.rx, f.tx, f.comment)
		if name != "" && name != "ether2-lan0" {
			fmt.Fprint(w, `[]`)
			return
		}
		if name != "" {
			fmt.Fprintf(w, `[{"name":"ether2-lan0","rx-byte":"%d","tx-byte":"%d","comment":%q}]`, f.rx, f.tx, f.comment)
			return
		}
		fmt.Fprint(w, all)
	}
}

// pollerWithClock: Poller + worker menunjuk router tiruan; jam dikendalikan tes.
func pollerWithClock(t *testing.T, f *fakeIfRouter, tweak func(*PollerOptions)) (*Poller, *worker, *time.Time) {
	t.Helper()
	srv := fakeRouter(t, f.handler(t))
	now := time.Unix(10_000, 0)
	p := newPoller(&fakeRecorder{}, func(o *PollerOptions) {
		o.Now = func() time.Time { return now }
		if tweak != nil {
			tweak(o)
		}
	})
	client, err := NewClient(target(srv), nil)
	if err != nil {
		t.Fatal(err)
	}
	return p, &worker{routerID: "r1", client: client, status: map[string]*Status{}}, &now
}

func TestInterfaceTrafficUsesUplinkCountersLikeWinbox(t *testing.T) {
	f := &fakeIfRouter{comment: "UPLINK", rx: 1_000_000_000, tx: 50_000_000}
	p, w, now := pollerWithClock(t, f, nil)
	ctx := context.Background()

	if _, _, ok := p.interfaceTraffic(ctx, w); ok {
		t.Fatal("sampel pertama belum punya pembanding")
	}
	*now = now.Add(time.Second)
	f.mu.Lock()
	f.rx += 25_000_000 // 25 MB dalam 1 detik di uplink = 200 Mbps download
	f.tx += 1_500_000  // 12 Mbps upload
	f.mu.Unlock()
	down, up, ok := p.interfaceTraffic(ctx, w)
	if !ok || !near(down, 200) || !near(up, 12) {
		t.Fatalf("down=%v up=%v ok=%v, want 200 dan 12 Mbps", down, up, ok)
	}
	if w.ifName != "ether2-lan0" || f.hitsList != 1 {
		t.Errorf("interface=%q pencarian=%d (pencarian hanya sekali)", w.ifName, f.hitsList)
	}
}

func TestInterfaceTrafficFollowsTheClockNotTheTick(t *testing.T) {
	f := &fakeIfRouter{comment: "UPLINK"}
	p, w, now := pollerWithClock(t, f, nil)
	ctx := context.Background()
	p.interfaceTraffic(ctx, w)
	*now = now.Add(2 * time.Second) // putaran tertunda: selang 2 detik
	f.mu.Lock()
	f.rx = 50_000_000 // 50 MB dalam 2 detik = 200 Mbps
	f.mu.Unlock()
	down, _, ok := p.interfaceTraffic(ctx, w)
	if !ok || !near(down, 200) {
		t.Fatalf("down=%v ok=%v", down, ok)
	}
}

func TestInterfaceTrafficCustomerSideSwapsDirection(t *testing.T) {
	f := &fakeIfRouter{comment: "UPLINK"}
	p, w, now := pollerWithClock(t, f, func(o *PollerOptions) { o.TrafficCustomerSide = true })
	ctx := context.Background()
	p.interfaceTraffic(ctx, w)
	*now = now.Add(time.Second)
	f.mu.Lock()
	f.rx, f.tx = 1_500_000, 25_000_000 // menghadap pelanggan: Tx = download
	f.mu.Unlock()
	down, up, ok := p.interfaceTraffic(ctx, w)
	if !ok || !near(down, 200) || !near(up, 12) {
		t.Fatalf("down=%v up=%v ok=%v", down, up, ok)
	}
}

func TestInterfaceTrafficFallsBackWithoutGuessing(t *testing.T) {
	ctx := context.Background()

	// tanpa interface berkomentar UPLINK: tidak ada tebakan, dan pencarian tidak diulang tiap detik
	f := &fakeIfRouter{comment: "LAIN"}
	p, w, now := pollerWithClock(t, f, nil)
	for i := 0; i < 5; i++ {
		*now = now.Add(time.Second)
		if _, _, ok := p.interfaceTraffic(ctx, w); ok {
			t.Fatal("harus jatuh ke queue")
		}
	}
	if f.hitsList != 1 {
		t.Errorf("pencarian = %d kali, harus sekali per %s", f.hitsList, ifLookupEvery)
	}
	*now = now.Add(ifLookupEvery)
	p.interfaceTraffic(ctx, w)
	if f.hitsList != 2 {
		t.Errorf("sesudah %s pencarian ulang, got %d", ifLookupEvery, f.hitsList)
	}

	// counter turun (router restart): satu sampel dilewati, lalu normal lagi
	f2 := &fakeIfRouter{comment: "UPLINK", rx: 9_000_000_000, tx: 9_000_000_000}
	p2, w2, now2 := pollerWithClock(t, f2, nil)
	p2.interfaceTraffic(ctx, w2)
	*now2 = now2.Add(time.Second)
	f2.mu.Lock()
	f2.rx, f2.tx = 1000, 1000
	f2.mu.Unlock()
	if _, _, ok := p2.interfaceTraffic(ctx, w2); ok {
		t.Fatal("counter turun tidak boleh menghasilkan laju")
	}
	*now2 = now2.Add(time.Second)
	f2.mu.Lock()
	f2.rx += 25_000_000
	f2.mu.Unlock()
	if down, _, ok := p2.interfaceTraffic(ctx, w2); !ok || !near(down, 200) {
		t.Fatalf("sesudah pulih: down=%v ok=%v", down, ok)
	}

	// interface yang dipilih hilang: tidak ada laju (bukan nol palsu)
	f3 := &fakeIfRouter{comment: "UPLINK"}
	p3, w3, now3 := pollerWithClock(t, f3, nil)
	p3.interfaceTraffic(ctx, w3)
	f3.mu.Lock()
	f3.gone = true
	f3.mu.Unlock()
	*now3 = now3.Add(time.Second)
	if _, _, ok := p3.interfaceTraffic(ctx, w3); ok {
		t.Fatal("interface hilang tidak boleh menghasilkan laju")
	}

	// opt-out ke jumlah queue
	f4 := &fakeIfRouter{comment: "UPLINK"}
	p4, w4, _ := pollerWithClock(t, f4, func(o *PollerOptions) { o.TrafficFromQueues = true })
	if _, _, ok := p4.interfaceTraffic(ctx, w4); ok || f4.hitsList+f4.hitsOne != 0 {
		t.Fatal("TrafficFromQueues tidak boleh menyentuh /rest/interface")
	}
}

func TestInterfaceTrafficExplicitInterfaceSkipsTheCommentLookup(t *testing.T) {
	f := &fakeIfRouter{comment: ""} // tanpa komentar sama sekali
	p, w, now := pollerWithClock(t, f, func(o *PollerOptions) { o.TrafficInterface = "ether2-lan0" })
	ctx := context.Background()
	p.interfaceTraffic(ctx, w)
	*now = now.Add(time.Second)
	f.mu.Lock()
	f.rx += 12_500_000
	f.mu.Unlock()
	down, _, ok := p.interfaceTraffic(ctx, w)
	if !ok || !near(down, 100) || f.hitsList != 0 {
		t.Fatalf("down=%v ok=%v pencarian=%d", down, ok, f.hitsList)
	}
}

// Dari ujung ke ujung: titik trafik yang direkam memakai laju interface, bukan jumlah queue.
func TestPollerRecordsInterfaceRateInsteadOfQueueSum(t *testing.T) {
	var mu sync.Mutex
	var calls int
	srv := fakeRouter(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/rest/queue/simple"):
			fmt.Fprint(w, queueJSON) // jumlah queue: rx 10,5 dan tx 1,5 Mbps
		case r.URL.Path == "/rest/interface" && r.URL.Query().Get("name") == "":
			fmt.Fprint(w, `[{"name":"ether2-lan0","rx-byte":"1","tx-byte":"1","comment":"UPLINK"}]`)
		case r.URL.Path == "/rest/interface":
			calls++
			// tiap panggilan counter naik 125 KB rx dan 12,5 KB tx per ~20 ms
			fmt.Fprintf(w, `[{"name":"ether2-lan0","rx-byte":"%d","tx-byte":"%d","comment":"UPLINK"}]`, calls*125_000, calls*12_500)
		}
	})
	rec := &fakeRecorder{}
	p := newPoller(rec, nil)
	ctx, cancel := context.WithCancel(context.Background())
	if err := p.Start(ctx, target(srv)); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "sampel dari interface", func() bool {
		for _, rp := range rec.snapshot() {
			if rp.point.RxMbps > 11 {
				return true
			}
		}
		return false
	})
	stopAndWait(t, p, cancel)
	var fromIf []state.TrafficPoint
	for _, rp := range rec.snapshot() {
		if rp.point.RxMbps > 11 {
			fromIf = append(fromIf, rp.point)
		}
	}
	for _, pt := range fromIf {
		// 125 KB per ~20 ms (+/- jitter jam) = puluhan Mbps, jauh dari 10,5 milik jumlah queue
		if pt.RxMbps < 11 || pt.TxMbps <= 1.5 && pt.TxMbps > 0 && pt.RxMbps/pt.TxMbps < 5 {
			t.Errorf("titik tidak memakai interface: %+v", pt)
		}
	}
	// sampel pertama (belum ada pembanding) memakai jumlah queue sebagai cadangan
	if first := rec.snapshot()[0].point; first.RxMbps != 10.5 || first.TxMbps != 1.5 {
		t.Errorf("sampel pertama = %+v, want cadangan queue 10,5/1,5", first)
	}
}
