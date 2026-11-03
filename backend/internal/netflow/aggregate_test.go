package netflow

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type fakeIndex map[netip.Addr]string

func (f fakeIndex) Lookup(routerID string, ip netip.Addr) (string, bool) {
	if routerID != "r1" {
		return "", false
	}
	id, ok := f[ip]
	return id, ok
}

type recExec struct {
	mu    sync.Mutex
	calls [][]any
}

func (r *recExec) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, args)
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func rec(src, dst string, sport, dport uint16, bytes uint64) Record {
	return Record{SrcAddr: net.ParseIP(src), DstAddr: net.ParseIP(dst), SrcPort: sport, DstPort: dport, Proto: 6, Bytes: bytes, Pkts: 1, RouterID: "r1"}
}

func TestAggregatorDirectionTopPeersAndOther(t *testing.T) {
	idx := fakeIndex{netip.MustParseAddr("172.16.15.247"): "cust-a"}
	a := NewAggregator(idx, &recExec{}, 7*24*time.Hour, slog.New(slog.NewTextHandler(io.Discard, nil)))
	at := time.Date(2026, 10, 22, 15, 2, 0, 0, time.UTC)
	a.now = func() time.Time { return at }

	var recs []Record
	// Unduh dari 12 server berbeda (port 443): 10 terbesar + 1 baris "lainnya".
	for i := 0; i < 12; i++ {
		recs = append(recs, rec("142.250.0."+strconv.Itoa(i+1), "172.16.15.247", 443, 50000, uint64(1000*(i+1))))
	}
	// Unggah dua flow ke tujuan yang sama digabung.
	recs = append(recs, rec("172.16.15.247", "1.1.1.1", 40000, 53, 100), rec("172.16.15.247", "1.1.1.1", 40001, 53, 50))
	// Bukan pelanggan dan router lain: dibuang.
	recs = append(recs, rec("10.20.0.2", "10.20.30.3", 23, 5000, 999))
	other := rec("172.16.15.247", "8.8.8.8", 1, 2, 1)
	other.RouterID = "r2"
	recs = append(recs, other)
	if err := a.HandleFlows(context.Background(), recs); err != nil {
		t.Fatal(err)
	}
	if a.Unmatched() != 2 {
		t.Fatalf("unmatched = %d, mau 2", a.Unmatched())
	}
	// Bucket berjalan belum dikeluarkan.
	if rows := a.takeCompleted(at.Truncate(BucketSize).Unix()); len(rows) != 0 {
		t.Fatalf("bucket berjalan ikut keluar: %d baris", len(rows))
	}
	rows := a.takeCompleted(at.Add(BucketSize).Truncate(BucketSize).Unix())
	var down, up, rest int
	for _, r := range rows {
		switch {
		case r.Direction == "down" && r.Proto == "lainnya":
			rest++
			if r.Bytes != 1000+2000 || r.Flows != 2 || r.SrcIP != "0.0.0.0" {
				t.Errorf("baris lainnya salah: %+v", r)
			}
		case r.Direction == "down":
			down++
			if r.Port != 443 || r.DstIP != "172.16.15.247" || r.Proto != "TCP" {
				t.Errorf("baris unduh salah: %+v", r)
			}
		case r.Direction == "up":
			up++
			if r.Bytes != 150 || r.Flows != 2 || r.Port != 53 || r.SrcIP != "172.16.15.247" || r.DstIP != "1.1.1.1" {
				t.Errorf("baris unggah salah: %+v", r)
			}
		}
		if r.CustomerID != "cust-a" || r.Bucket != time.Date(2026, 10, 22, 15, 0, 0, 0, time.UTC) {
			t.Errorf("pelanggan/bucket salah: %+v", r)
		}
	}
	if down != TopPeers || up != 1 || rest != 1 {
		t.Fatalf("down=%d up=%d lainnya=%d", down, up, rest)
	}
}

func TestAggregatorStoreSendsOneBatch(t *testing.T) {
	db := &recExec{}
	a := NewAggregator(fakeIndex{netip.MustParseAddr("172.16.0.9"): "c"}, db, time.Hour, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.store(context.Background(), []Row{{RouterID: "r1", CustomerID: "c", Direction: "up", SrcIP: "172.16.0.9", DstIP: "1.1.1.1", Port: 53, Proto: "UDP", Bytes: 9, Packets: 1, Flows: 1, Bucket: time.Now()}})
	if len(db.calls) != 1 || len(db.calls[0]) != 11 {
		t.Fatalf("Exec = %d panggilan", len(db.calls))
	}
	if got := db.calls[0][6].([]string)[0]; got != "UDP" {
		t.Errorf("protokol = %q", got)
	}
}
