package netflow

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ReaderDB adalah interface pembacaan database (pgxpool.Pool memenuhi ini).
type ReaderDB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Reader struct {
	db ReaderDB
}

func NewReader(db ReaderDB) *Reader {
	return &Reader{db: db}
}

// SummaryData mewakili agregat trafik masuk/keluar.
type SummaryData struct {
	RxBytes            int64   `json:"rxBytes"`
	TxBytes            int64   `json:"txBytes"`
	TotalBytes         int64   `json:"totalBytes"`
	RxBps              float64 `json:"rxBps"`
	TxBps              float64 `json:"txBps"`
	TotalBps           float64 `json:"totalBps"`
	Packets            int64   `json:"packets"`
	Flows              int64   `json:"flows"`
	UplinkCapacityBps  *int64  `json:"uplinkCapacityBps"`  // nil bila tidak terdefinisi ("tidak dapat dibaca")
	UplinkUsagePercent *float64 `json:"uplinkUsagePercent"` // nil bila tidak terdefinisi ("tidak dapat dibaca")
	UplinkRemainingBps *int64  `json:"uplinkRemainingBps"` // nil bila tidak terdefinisi
	BusyInterfaceName  *string `json:"busyInterfaceName"`  // nil bila tidak diketahui
	BusyRouterName     *string `json:"busyRouterName"`     // nil bila tidak diketahui
	BusyThroughputBps  *float64 `json:"busyThroughputBps"` // nil bila tidak diketahui
}

// TopTalkerRecord mewakili pelanggan/IP pemakai terbesar.
type TopTalkerRecord struct {
	IP            string   `json:"ip"`
	CustomerID    *string  `json:"customerId"`
	CustomerName  *string  `json:"customerName"`
	PppoeUsername *string  `json:"pppoeUsername"`
	PlanMbps      *int     `json:"planMbps"`
	OdpName       *string  `json:"odpName"`
	RxBytes       int64    `json:"rxBytes"`
	TxBytes       int64    `json:"txBytes"`
	TotalBytes    int64    `json:"totalBytes"`
	Packets       int64    `json:"packets"`
	Flows         int64    `json:"flows"`
	ThroughputBps float64  `json:"throughputBps"`
	TopProtocol   string   `json:"topProtocol"`
	IsMapped      bool     `json:"isMapped"`
}

// CustomerUsageRecord mewakili pemakaian per pelanggan sebagai bahan FUP.
type CustomerUsageRecord struct {
	CustomerID        string   `json:"customerId"`
	CustomerName      string   `json:"customerName"`
	PppoeUsername     string   `json:"pppoeUsername"`
	PlanMbps          int      `json:"planMbps"`
	OdpName           *string  `json:"odpName"`
	RxBytes           int64    `json:"rxBytes"`
	TxBytes           int64    `json:"txBytes"`
	TotalBytes        int64    `json:"totalBytes"`
	Packets           int64    `json:"packets"`
	Flows             int64    `json:"flows"`
	PeakThroughputBps *float64 `json:"peakThroughputBps"` // nil bila belum terukur
	PeakTime          *int64   `json:"peakTime"`          // nil bila belum terukur
	FupLimitBytes     *int64   `json:"fupLimitBytes"`     // nil bila tidak ditetapkan di paket
	FupUsagePercent   *float64 `json:"fupUsagePercent"`   // nil bila FUP tidak ada
	Status            string   `json:"status"`            // "normal", "warning", "exceeded", "untracked"
}

// SessionRecord mewakili detail satu sesi NetFlow.
type SessionRecord struct {
	ID         string `json:"id"`
	RouterID   string `json:"routerId"`
	RouterName string `json:"routerName"`
	CustomerID *string `json:"customerId"`
	CustomerName *string `json:"customerName"`
	Direction  string `json:"direction"`
	SrcIP      string `json:"srcIp"`
	SrcPort    int    `json:"srcPort"`
	DstIP      string `json:"dstIp"`
	DstPort    int    `json:"dstPort"`
	Protocol   string `json:"protocol"`
	Bytes      int64  `json:"bytes"`
	Packets    int    `json:"packets"`
	Flows      int    `json:"flows"`
	CapturedAt int64  `json:"capturedAt"`
	PonPort    *string `json:"ponPort"`
}

func parseRangeDuration(rangeStr string) time.Duration {
	switch rangeStr {
	case "1h":
		return time.Hour
	case "6h":
		return 6 * time.Hour
	case "24h":
		return 24 * time.Hour
	case "7d":
		return 7 * 24 * time.Hour
	case "30d":
		return 30 * 24 * time.Hour
	default:
		return time.Hour
	}
}

// Summary menghitung total trafik masuk dan keluar langsung dari kolom direction di netflow_samples.
func (r *Reader) Summary(ctx context.Context, rangeStr string, routerID string) (*SummaryData, error) {
	d := parseRangeDuration(rangeStr)
	from := time.Now().Add(-d)
	secs := d.Seconds()

	query := `
		SELECT
			COALESCE(SUM(CASE WHEN direction = 'down' THEN bytes ELSE 0 END), 0)::bigint AS rx_bytes,
			COALESCE(SUM(CASE WHEN direction = 'up' THEN bytes ELSE 0 END), 0)::bigint AS tx_bytes,
			COALESCE(SUM(bytes), 0)::bigint AS total_bytes,
			COALESCE(SUM(packets), 0)::bigint AS total_packets,
			COALESCE(SUM(flows), 0)::bigint AS total_flows
		FROM netflow_samples
		WHERE captured_at >= $1
	`
	args := []any{from}
	if routerID != "" {
		query += " AND router_id = $2"
		args = append(args, routerID)
	}

	var rxBytes, txBytes, totalBytes, totalPkts, totalFlows int64
	err := r.db.QueryRow(ctx, query, args...).Scan(&rxBytes, &txBytes, &totalBytes, &totalPkts, &totalFlows)
	if err != nil {
		return nil, fmt.Errorf("summary query: %w", err)
	}

	res := &SummaryData{
		RxBytes:    rxBytes,
		TxBytes:    txBytes,
		TotalBytes: totalBytes,
		RxBps:      float64(rxBytes*8) / secs,
		TxBps:      float64(txBytes*8) / secs,
		TotalBps:   float64(totalBytes*8) / secs,
		Packets:    totalPkts,
		Flows:      totalFlows,
	}

	// Cari antarmuka tersibuk dari router dengan sampel terbanyak
	busyQuery := `
		SELECT r.name, COALESCE(SUM(ns.bytes), 0)::bigint
		FROM netflow_samples ns
		JOIN routers r ON r.id = ns.router_id
		WHERE ns.captured_at >= $1
		GROUP BY r.name
		ORDER BY 2 DESC
		LIMIT 1
	`
	var rName string
	var rBytes int64
	if err := r.db.QueryRow(ctx, busyQuery, from).Scan(&rName, &rBytes); err == nil && rName != "" {
		res.BusyRouterName = &rName
		res.BusyInterfaceName = nil
		bps := float64(rBytes*8) / secs
		res.BusyThroughputBps = &bps
	}

	return res, nil
}

// TopTalkers mengelompokkan trafik per pelanggan/IP menggunakan join riil ke tabel customers.
func (r *Reader) TopTalkers(ctx context.Context, rangeStr string, routerID string, limit int) ([]TopTalkerRecord, error) {
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	d := parseRangeDuration(rangeStr)
	from := time.Now().Add(-d)
	secs := d.Seconds()

	query := `
		SELECT
			CASE WHEN ns.direction = 'up' THEN ns.src_ip ELSE ns.dst_ip END AS client_ip,
			ns.customer_id::text,
			c.name,
			c.pppoe_username,
			c.odp_name,
			COALESCE(SUM(CASE WHEN ns.direction = 'down' THEN ns.bytes ELSE 0 END), 0)::bigint AS rx_bytes,
			COALESCE(SUM(CASE WHEN ns.direction = 'up' THEN ns.bytes ELSE 0 END), 0)::bigint AS tx_bytes,
			COALESCE(SUM(ns.bytes), 0)::bigint AS total_bytes,
			COALESCE(SUM(ns.packets), 0)::bigint AS total_packets,
			COALESCE(SUM(ns.flows), 0)::bigint AS total_flows,
			MODE() WITHIN GROUP (ORDER BY ns.protocol) AS top_proto
		FROM netflow_samples ns
		LEFT JOIN customers c ON c.id = ns.customer_id
		WHERE ns.captured_at >= $1
	`
	args := []any{from}
	if routerID != "" {
		query += " AND ns.router_id = $2"
		args = append(args, routerID)
	}

	query += fmt.Sprintf(`
		GROUP BY 1, 2, 3, 4, 5
		ORDER BY total_bytes DESC
		LIMIT %d
	`, limit)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("toptalkers query: %w", err)
	}
	defer rows.Close()

	results := []TopTalkerRecord{}
	for rows.Next() {
		var (
			ip        string
			custID    *string
			custName  *string
			pppoeUser *string
			odpName   *string
			rx        int64
			tx        int64
			tot       int64
			pkts      int64
			flows     int64
			topProto  *string
		)
		if err := rows.Scan(&ip, &custID, &custName, &pppoeUser, &odpName, &rx, &tx, &tot, &pkts, &flows, &topProto); err != nil {
			return nil, err
		}
		proto := "TCP"
		if topProto != nil && *topProto != "" {
			proto = *topProto
		}
		results = append(results, TopTalkerRecord{
			IP:            ip,
			CustomerID:    custID,
			CustomerName:  custName,
			PppoeUsername: pppoeUser,
			PlanMbps:      nil,
			OdpName:       odpName,
			RxBytes:       rx,
			TxBytes:       tx,
			TotalBytes:    tot,
			Packets:       pkts,
			Flows:         flows,
			ThroughputBps: float64(tot*8) / secs,
			TopProtocol:   proto,
			IsMapped:      custID != nil,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

// CustomerUsage menghitung pemakaian bulanan riil tiap pelanggan untuk FUP.
func (r *Reader) CustomerUsage(ctx context.Context, rangeStr string, limit int) ([]CustomerUsageRecord, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	d := parseRangeDuration(rangeStr)
	if rangeStr == "" {
		d = 30 * 24 * time.Hour
	}
	from := time.Now().Add(-d)

	query := fmt.Sprintf(`
		WITH customer_buckets AS (
			SELECT
				customer_id,
				captured_at,
				SUM(bytes) AS bucket_bytes
			FROM netflow_samples
			WHERE captured_at >= $1 AND customer_id IS NOT NULL
			GROUP BY customer_id, captured_at
		),
		customer_peaks AS (
			SELECT
				customer_id,
				MAX(bucket_bytes * 8.0 / 300.0) AS peak_bps,
				(ARRAY_AGG(EXTRACT(EPOCH FROM captured_at)::bigint ORDER BY bucket_bytes DESC))[1] AS peak_epoch
			FROM customer_buckets
			GROUP BY customer_id
		)
		SELECT
			c.id::text,
			c.name,
			COALESCE(c.pppoe_username, ''),
			c.odp_name,
			COALESCE(SUM(CASE WHEN ns.direction = 'down' THEN ns.bytes ELSE 0 END), 0)::bigint AS rx_bytes,
			COALESCE(SUM(CASE WHEN ns.direction = 'up' THEN ns.bytes ELSE 0 END), 0)::bigint AS tx_bytes,
			COALESCE(SUM(ns.bytes), 0)::bigint AS total_bytes,
			COALESCE(SUM(ns.packets), 0)::bigint AS total_packets,
			COALESCE(SUM(ns.flows), 0)::bigint AS total_flows,
			cp.peak_bps,
			cp.peak_epoch
		FROM customers c
		JOIN netflow_samples ns ON ns.customer_id = c.id
		LEFT JOIN customer_peaks cp ON cp.customer_id = c.id
		WHERE ns.captured_at >= $1
		GROUP BY c.id, c.name, c.pppoe_username, c.odp_name, cp.peak_bps, cp.peak_epoch
		ORDER BY total_bytes DESC
		LIMIT %d
	`, limit)

	rows, err := r.db.Query(ctx, query, from)
	if err != nil {
		return nil, fmt.Errorf("customer usage query: %w", err)
	}
	defer rows.Close()

	records := []CustomerUsageRecord{}
	for rows.Next() {
		var (
			cid      string
			name     string
			pppoe    string
			odp      *string
			rx       int64
			tx       int64
			tot      int64
			pkts     int64
			flows    int64
			peakBps  *float64
			lastSeen *int64
		)
		if err := rows.Scan(&cid, &name, &pppoe, &odp, &rx, &tx, &tot, &pkts, &flows, &peakBps, &lastSeen); err != nil {
			return nil, err
		}

		records = append(records, CustomerUsageRecord{
			CustomerID:        cid,
			CustomerName:      name,
			PppoeUsername:     pppoe,
			PlanMbps:          0,
			OdpName:           odp,
			RxBytes:           rx,
			TxBytes:           tx,
			TotalBytes:        tot,
			Packets:           pkts,
			Flows:             flows,
			PeakThroughputBps: peakBps,
			PeakTime:          lastSeen,
			FupLimitBytes:     nil,
			FupUsagePercent:   nil,
			Status:            "untracked",
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

// SessionFilter parameter pencarian sesi.
type SessionFilter struct {
	RangeStr   string
	RouterID   string
	CustomerID string
	PonPort    string
	Protocol   string
	Query      string
	Limit      int
	Offset     int
}

// Sessions membaca sesi percakapan riil dari tabel netflow_samples.
func (r *Reader) Sessions(ctx context.Context, filter SessionFilter) ([]SessionRecord, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	d := parseRangeDuration(filter.RangeStr)
	from := time.Now().Add(-d)

	query := `
		SELECT
			ns.id::text,
			COALESCE(ns.router_id::text, ''),
			COALESCE(r.name, 'Router tidak dikenal'),
			ns.customer_id::text,
			c.name,
			COALESCE(ns.direction, ''),
			ns.src_ip,
			ns.src_port,
			ns.dst_ip,
			ns.dst_port,
			ns.protocol,
			ns.bytes,
			ns.packets,
			ns.flows,
			EXTRACT(EPOCH FROM ns.captured_at)::bigint,
			CASE WHEN onu.pon_index IS NOT NULL THEN 'PON-' || onu.pon_index::text ELSE NULL END AS pon_port
		FROM netflow_samples ns
		LEFT JOIN routers r ON r.id = ns.router_id
		LEFT JOIN customers c ON c.id = ns.customer_id
		LEFT JOIN olt_onus onu ON onu.customer_id = c.id
		WHERE ns.captured_at >= $1
	`
	args := []any{from}
	paramIdx := 2

	if filter.RouterID != "" {
		query += fmt.Sprintf(" AND ns.router_id = $%d", paramIdx)
		args = append(args, filter.RouterID)
		paramIdx++
	}
	if filter.CustomerID != "" {
		query += fmt.Sprintf(" AND ns.customer_id = $%d", paramIdx)
		args = append(args, filter.CustomerID)
		paramIdx++
	}
	if filter.PonPort != "" {
		query += fmt.Sprintf(" AND ('PON-' || onu.pon_index::text = $%d OR onu.pon_index::text = $%d)", paramIdx, paramIdx)
		args = append(args, filter.PonPort)
		paramIdx++
	}
	if filter.Protocol != "" && filter.Protocol != "ALL" {
		query += fmt.Sprintf(" AND ns.protocol = $%d", paramIdx)
		args = append(args, filter.Protocol)
		paramIdx++
	}
	if filter.Query != "" {
		clean := strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(filter.Query), "%", "\\%"), "_", "\\_")
		q := "%" + clean + "%"
		query += fmt.Sprintf(" AND (ns.src_ip ILIKE $%d OR ns.dst_ip ILIKE $%d)", paramIdx, paramIdx)
		args = append(args, q)
		paramIdx++
	}

	query += fmt.Sprintf(" ORDER BY ns.captured_at DESC, ns.bytes DESC LIMIT %d OFFSET %d", limit, filter.Offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("sessions query: %w", err)
	}
	defer rows.Close()

	sessions := []SessionRecord{}
	for rows.Next() {
		var (
			s        SessionRecord
			custID   *string
			custName *string
			pon      *string
		)
		if err := rows.Scan(
			&s.ID,
			&s.RouterID,
			&s.RouterName,
			&custID,
			&custName,
			&s.Direction,
			&s.SrcIP,
			&s.SrcPort,
			&s.DstIP,
			&s.DstPort,
			&s.Protocol,
			&s.Bytes,
			&s.Packets,
			&s.Flows,
			&s.CapturedAt,
			&pon,
		); err != nil {
			return nil, err
		}
		s.CustomerID = custID
		s.CustomerName = custName
		s.PonPort = pon
		sessions = append(sessions, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return sessions, nil
}
