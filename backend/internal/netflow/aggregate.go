package netflow

import (
	"context"
	"log/slog"
	"net/netip"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// CustomerIndex memetakan IP sesi PPPoE ke pelanggan per router (diisi dari
// polling /ppp/active).
type CustomerIndex interface {
	Lookup(routerID string, ip netip.Addr) (customerID string, ok bool)
}

// Execer adalah bagian pgxpool.Pool yang dipakai penyimpan; di tes diganti tiruan.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

const (
	// BucketSize: lebar bucket agregat; sama dengan arsip trafik pelanggan.
	BucketSize = 5 * time.Minute
	// TopPeers: lawan terbesar per pelanggan per arah per bucket yang disimpan;
	// sisanya digabung ke satu baris "lainnya" (IP 0.0.0.0).
	TopPeers = 10
)

type flowKey struct {
	bucket     int64
	routerID   string
	customerID string
	direction  string
	peer       netip.Addr
	port       uint16
	proto      uint8
}

type flowAcc struct {
	customerIP     netip.Addr
	bytes, packets uint64
	flows          uint32
}

// Aggregator menjumlahkan flow per pelanggan per bucket 5 menit dan
// menyimpan bucket yang sudah lewat ke netflow_samples.
// shortcut: bucket memakai waktu terima, bukan waktu flow; router perlu
// active-flow-timeout pendek (mis. 1m) supaya flow panjang tidak menumpuk
// di satu bucket.
type Aggregator struct {
	index     CustomerIndex
	db        Execer
	logger    *slog.Logger
	retention time.Duration
	now       func() time.Time

	mu        sync.Mutex
	acc       map[flowKey]*flowAcc
	unmatched atomic.Uint64
}

func NewAggregator(index CustomerIndex, db Execer, retention time.Duration, logger *slog.Logger) *Aggregator {
	return &Aggregator{index: index, db: db, logger: logger, retention: retention, now: time.Now, acc: map[flowKey]*flowAcc{}}
}

// Unmatched: flow yang tidak menyentuh IP pelanggan mana pun (dibuang).
func (a *Aggregator) Unmatched() uint64 { return a.unmatched.Load() }

// HandleFlows memenuhi FlowSink.
func (a *Aggregator) HandleFlows(_ context.Context, records []Record) error {
	bucket := a.now().UTC().Truncate(BucketSize).Unix()
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, r := range records {
		src, okSrc := netip.AddrFromSlice(r.SrcAddr.To4())
		dst, okDst := netip.AddrFromSlice(r.DstAddr.To4())
		if !okSrc || !okDst {
			continue
		}
		key := flowKey{bucket: bucket, routerID: r.RouterID, proto: r.Proto}
		var customerIP netip.Addr
		if id, ok := a.index.Lookup(r.RouterID, src); ok {
			key.customerID, key.direction, key.peer, key.port, customerIP = id, "up", dst, r.DstPort, src
		} else if id, ok := a.index.Lookup(r.RouterID, dst); ok {
			key.customerID, key.direction, key.peer, key.port, customerIP = id, "down", src, r.SrcPort, dst
		} else {
			a.unmatched.Add(1)
			continue
		}
		acc := a.acc[key]
		if acc == nil {
			acc = &flowAcc{}
			a.acc[key] = acc
		}
		acc.customerIP = customerIP
		acc.bytes += uint64(r.Bytes)
		acc.packets += uint64(r.Pkts)
		acc.flows++
	}
	return nil
}

// Row adalah satu baris netflow_samples hasil agregasi.
type Row struct {
	Bucket     time.Time
	RouterID   string
	CustomerID string
	Direction  string
	SrcIP      string
	DstIP      string
	Port       uint16
	Proto      string
	Bytes      uint64
	Packets    uint64
	Flows      uint32
}

func protoName(p uint8) string {
	switch p {
	case 6:
		return "TCP"
	case 17:
		return "UDP"
	case 1:
		return "ICMP"
	}
	return strconv.Itoa(int(p))
}

// takeCompleted mengeluarkan bucket yang sudah selesai menjadi baris: 10 lawan
// terbesar per pelanggan per arah, sisanya satu baris "lainnya".
func (a *Aggregator) takeCompleted(before int64) []Row {
	a.mu.Lock()
	type group struct {
		bucket                          int64
		routerID, customerID, direction string
	}
	type item struct {
		key flowKey
		acc *flowAcc
	}
	groups := map[group][]item{}
	for k, v := range a.acc {
		if k.bucket >= before {
			continue
		}
		g := group{k.bucket, k.routerID, k.customerID, k.direction}
		groups[g] = append(groups[g], item{k, v})
		delete(a.acc, k)
	}
	a.mu.Unlock()

	var rows []Row
	for g, items := range groups {
		sort.Slice(items, func(i, j int) bool { return items[i].acc.bytes > items[j].acc.bytes })
		var rest flowAcc
		for i, it := range items {
			if i >= TopPeers {
				rest.customerIP = it.acc.customerIP
				rest.bytes += it.acc.bytes
				rest.packets += it.acc.packets
				rest.flows += it.acc.flows
				continue
			}
			rows = append(rows, makeRow(g.bucket, g.routerID, g.customerID, g.direction, it.key.peer.String(), it.key.port, protoName(it.key.proto), it.acc))
		}
		if rest.flows > 0 {
			rows = append(rows, makeRow(g.bucket, g.routerID, g.customerID, g.direction, "0.0.0.0", 0, "lainnya", &rest))
		}
	}
	return rows
}

func makeRow(bucket int64, routerID, customerID, dir, peer string, port uint16, proto string, acc *flowAcc) Row {
	row := Row{
		Bucket: time.Unix(bucket, 0).UTC(), RouterID: routerID, CustomerID: customerID, Direction: dir,
		Port: port, Proto: proto, Bytes: acc.bytes, Packets: acc.packets, Flows: acc.flows,
	}
	if dir == "up" {
		row.SrcIP, row.DstIP = acc.customerIP.String(), peer
	} else {
		row.SrcIP, row.DstIP = peer, acc.customerIP.String()
	}
	return row
}

const netflowInsertSQL = `INSERT INTO netflow_samples
  (router_id, customer_id, direction, src_ip, dst_ip, src_port, dst_port, protocol, bytes, packets, flows, captured_at)
SELECT r::uuid, c::uuid, d, s, t, 0, p, pr, b, LEAST(k, 2147483647)::int, f, at
FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[], $8::bigint[], $9::bigint[], $10::int[], $11::timestamptz[])
  AS u(r, c, d, s, t, p, pr, b, k, f, at)`

// Run menyimpan bucket yang sudah selesai tiap menit dan menghapus baris lama
// tiap jam, sampai ctx selesai. Bucket berjalan disimpan saat berhenti.
func (a *Aggregator) Run(ctx context.Context) {
	flush := time.NewTicker(time.Minute)
	defer flush.Stop()
	purge := time.NewTicker(time.Hour)
	defer purge.Stop()
	a.purge(ctx)
	for {
		select {
		case <-ctx.Done():
			// Simpan sisa dengan konteks baru: ctx sudah dibatalkan.
			done, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			a.store(done, a.takeCompleted(1<<62))
			cancel()
			return
		case <-flush.C:
			a.store(ctx, a.takeCompleted(a.now().UTC().Truncate(BucketSize).Unix()))
		case <-purge.C:
			a.purge(ctx)
		}
	}
}

func (a *Aggregator) store(ctx context.Context, rows []Row) {
	if len(rows) == 0 {
		return
	}
	n := len(rows)
	routers, customers, dirs, srcs, dsts, protos := make([]string, n), make([]string, n), make([]string, n), make([]string, n), make([]string, n), make([]string, n)
	ports, flows := make([]int32, n), make([]int32, n)
	bytes, packets := make([]int64, n), make([]int64, n)
	at := make([]time.Time, n)
	for i, r := range rows {
		routers[i], customers[i], dirs[i], srcs[i], dsts[i], protos[i] = r.RouterID, r.CustomerID, r.Direction, r.SrcIP, r.DstIP, r.Proto
		ports[i], flows[i] = int32(r.Port), int32(min(r.Flows, 1<<31-1))
		bytes[i], packets[i] = int64(r.Bytes), int64(r.Packets)
		at[i] = r.Bucket
	}
	if _, err := a.db.Exec(ctx, netflowInsertSQL, routers, customers, dirs, srcs, dsts, ports, protos, bytes, packets, flows, at); err != nil {
		a.logger.Warn("agregat NetFlow gagal disimpan", "baris", n, "error", err)
	}
}

func (a *Aggregator) purge(ctx context.Context) {
	tag, err := a.db.Exec(ctx, `DELETE FROM netflow_samples WHERE captured_at < $1`, a.now().Add(-a.retention))
	if err != nil {
		if ctx.Err() == nil {
			a.logger.Warn("hapus NetFlow lama gagal", "error", err)
		}
		return
	}
	if tag.RowsAffected() > 0 {
		a.logger.Info("NetFlow lama dihapus", "baris", tag.RowsAffected())
	}
}
