package netflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"noc-isp/backend/internal/collector"
)

var ErrCustomerOffline = errors.New("pelanggan sedang offline: sesi PPPoE tidak aktif")

type TorchCaptureInput struct {
	RouterID        string `json:"routerId"`
	CustomerID      string `json:"customerId"`
	CustomerIP      string `json:"customerIp"`
	PPPoEUsername   string `json:"pppoeUsername"`
	DurationSeconds int    `json:"durationSeconds"`
	RecordedBy      string `json:"recordedBy"`
	UserID          string `json:"userId"`
}

type TorchCaptureItem struct {
	Platform      string   `json:"platform"`
	Domain        string   `json:"domain"`
	Category      string   `json:"category"`
	Confidence    *float64 `json:"confidence"`
	PeerIP        string   `json:"peerIp"`
	Port          int      `json:"port"`
	Protocol      string   `json:"protocol"`
	Bytes         int64    `json:"bytes"`
	Packets       int64    `json:"packets"`
	ThroughputBps int64    `json:"throughputBps"`
}

type TorchCaptureResult struct {
	ID              string             `json:"id"`
	CustomerID      string             `json:"customerId"`
	CustomerIP      string             `json:"customerIp"`
	DurationSeconds int                `json:"durationSeconds"`
	StartedAt       time.Time          `json:"startedAt"`
	EndedAt         time.Time          `json:"endedAt"`
	TotalBytes      int64              `json:"totalBytes"`
	TotalPackets    int64              `json:"totalPackets"`
	FlowCount       int                `json:"flowCount"`
	TopApp          string             `json:"topApp"`
	RecordedBy      string             `json:"recordedBy"`
	Flows           []TorchCaptureItem `json:"flows"`
}

// TorchRunner menjalankan perekaman torch RouterOS secara aman dan serial per router.
type TorchRunner struct {
	db           *pgxpool.Pool
	deviceSecret string
	logger       *slog.Logger
	mu           sync.Mutex
	locks        map[string]*sync.Mutex
}

func NewTorchRunner(db *pgxpool.Pool, deviceSecret string, logger *slog.Logger) *TorchRunner {
	return &TorchRunner{
		db:           db,
		deviceSecret: deviceSecret,
		logger:       logger,
		locks:        make(map[string]*sync.Mutex),
	}
}

func (tr *TorchRunner) routerLock(routerID string) *sync.Mutex {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	l, ok := tr.locks[routerID]
	if !ok {
		l = &sync.Mutex{}
		tr.locks[routerID] = l
	}
	return l
}

func (tr *TorchRunner) RunCapture(ctx context.Context, in TorchCaptureInput) (*TorchCaptureResult, error) {
	dur := time.Duration(in.DurationSeconds) * time.Second
	if in.DurationSeconds != 15 && in.DurationSeconds != 30 && in.DurationSeconds != 60 {
		dur = 15 * time.Second
		in.DurationSeconds = 15
	}

	startedAt := time.Now().UTC()
	endedAt := startedAt.Add(dur)

	// Ambil data pelanggan dan router_id secara server-side dari database
	var routerID, custName, pppoeUser string
	err := tr.db.QueryRow(ctx, "SELECT router_id::text, name, COALESCE(pppoe_username, '') FROM customers WHERE id = $1", in.CustomerID).Scan(&routerID, &custName, &pppoeUser)
	if err != nil {
		return nil, fmt.Errorf("pelanggan tidak ditemukan: %w", err)
	}
	in.RouterID = routerID
	in.PPPoEUsername = pppoeUser
	if in.RecordedBy == "" {
		in.RecordedBy = "Operator"
	}

	// Batasi 1 perekaman torch bersamaan per router agar tidak membebani CPU MikroTik
	l := tr.routerLock(in.RouterID)
	l.Lock()
	defer l.Unlock()

	targets, err := collector.LoadTargets(ctx, tr.db, tr.deviceSecret, tr.logger)
	if err != nil {
		return nil, fmt.Errorf("load targets: %w", err)
	}

	var target *collector.Target
	for i := range targets {
		if targets[i].RouterID == in.RouterID {
			target = &targets[i]
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("router aktif tidak ditemukan")
	}
	client, err := collector.NewClient(*target, nil)
	if err != nil {
		return nil, fmt.Errorf("init router client: %w", err)
	}

	// Cari sesi PPPoE aktif pelanggan di router menggunakan PPPActiveAddress (aman untuk karakter @)
	customerIP, ok, err := client.PPPActiveAddress(ctx, pppoeUser)
	if err != nil {
		return nil, fmt.Errorf("cek sesi pppoe: %w", err)
	}
	if !ok || customerIP == "" {
		return nil, ErrCustomerOffline
	}
	in.CustomerIP = customerIP

	// 1. Ambil DNS cache router untuk memetakan IP tujuan ke nama domain nyata (RouterOS v7 'data' & v6 'address')
	dnsEntries, _ := client.DNSCache(ctx)
	ipToDomain := make(map[string]string)
	cnames := make(map[string]string)
	for _, entry := range dnsEntries {
		val := entry.IPOrTarget()
		if val == "" || entry.Name == "" {
			continue
		}
		if strings.EqualFold(entry.Type, "cname") {
			cnames[val] = entry.Name
		} else {
			ipToDomain[val] = entry.Name
		}
	}
	// Telusuri alias CNAME
	for ip, name := range ipToDomain {
		if alias, exists := cnames[name]; exists && alias != "" {
			ipToDomain[ip] = alias
		}
	}

	// 2. Jalankan Torch spesifik pada interface dynamic PPPoE pelanggan (<pppoe-USERNAME>)
	iface := fmt.Sprintf("<pppoe-%s>", pppoeUser)
	torchEntries, err := client.Torch(ctx, iface, dur)
	if err != nil {
		return nil, fmt.Errorf("torch interface %s: %w", iface, err)
	}

	// Agregasi entri Torch: Torch streaming mengirim status per detik, gabungkan per (peerIP, port, proto)
	type flowAggKey struct {
		peerIP   string
		port     int
		protocol string
	}
	type flowAggVal struct {
		sumBps     int64
		sumPackets int64
		count      int
	}

	aggMap := make(map[flowAggKey]*flowAggVal)
	for _, entry := range torchEntries {
		peerIP := entry.DstAddress
		if peerIP == in.CustomerIP || peerIP == "" {
			peerIP = entry.SrcAddress
		}
		if peerIP == "" {
			continue
		}
		port := int(entry.DstPort)
		if port == 0 {
			port = int(entry.Port)
		}
		key := flowAggKey{peerIP: peerIP, port: port, protocol: entry.Protocol}
		bps := int64(entry.Tx + entry.Rx)
		pkts := int64(entry.TxPackets + entry.RxPackets)
		if val, ok := aggMap[key]; ok {
			val.sumBps += bps
			val.sumPackets += pkts
			val.count++
		} else {
			aggMap[key] = &flowAggVal{sumBps: bps, sumPackets: pkts, count: 1}
		}
	}

	// Kumpulkan IP eksternal yang belum dipetakan nama domainnya dari DNS cache router
	var unmappedIPs []string
	for key := range aggMap {
		if ipToDomain[key.peerIP] == "" && !isLocalIP(key.peerIP) {
			unmappedIPs = append(unmappedIPs, key.peerIP)
		}
	}

	// Lookup PTR secara konkuren untuk IP eksternal yang belum dipetakan
	if len(unmappedIPs) > 0 {
		lookupCtx, cancel := context.WithTimeout(ctx, 400*time.Millisecond)
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 8)
		for _, ip := range unmappedIPs {
			wg.Add(1)
			go func(targetIP string) {
				defer wg.Done()
				select {
				case sem <- struct{}{}:
					defer func() { <-sem }()
				case <-lookupCtx.Done():
					return
				}
				names, err := net.DefaultResolver.LookupAddr(lookupCtx, targetIP)
				if err == nil && len(names) > 0 {
					cleanName := strings.ToLower(strings.TrimSuffix(names[0], "."))
					mu.Lock()
					ipToDomain[targetIP] = cleanName
					mu.Unlock()
				}
			}(ip)
		}
		wg.Wait()
		cancel()
	}

	flows := make([]TorchCaptureItem, 0, len(aggMap))
	var totalBytes int64
	var totalPackets int64
	for key, val := range aggMap {
		durSec := int64(in.DurationSeconds)
		if durSec <= 0 {
			durSec = 15
		}
		// Torch per-second streaming: sumBps adalah total bit dalam durasi penangkapan
		bytesCount := val.sumBps / 8
		packetsCount := val.sumPackets
		avgBps := val.sumBps / durSec
		dnsDom := ipToDomain[key.peerIP]
		platform, domain, category, conf := identifyPlatformAndDomain(ctx, key.peerIP, key.port, dnsDom, tr.db)

		totalBytes += bytesCount
		totalPackets += packetsCount

		flows = append(flows, TorchCaptureItem{
			Platform:      platform,
			Domain:        domain,
			Category:      category,
			Confidence:    conf,
			PeerIP:        key.peerIP,
			Port:          key.port,
			Protocol:      key.protocol,
			Bytes:         bytesCount,
			Packets:       packetsCount,
			ThroughputBps: avgBps,
		})
	}

	// Urutkan aliran trafik terbesar terlebih dahulu
	sort.Slice(flows, func(i, j int) bool {
		return flows[i].ThroughputBps > flows[j].ThroughputBps
	})

	// Pilih topApp dari layanan eksternal (bukan gateway lokal)
	topApp := "Umum"
	for _, f := range flows {
		if !strings.Contains(f.Platform, "Gateway") && !strings.Contains(f.Category, "Lokal") && f.Platform != "" && f.Platform != f.PeerIP {
			topApp = f.Platform
			break
		}
	}
	if topApp == "Umum" && len(flows) > 0 {
		topApp = flows[0].Platform
	}

	flowsJSON, _ := json.Marshal(flows)
	// 3. Simpan ke customer_traffic_captures
	var captureID string
	err = tr.db.QueryRow(ctx, `
		INSERT INTO customer_traffic_captures
		(customer_id, router_id, customer_ip, duration_seconds, started_at, ended_at, total_bytes, total_packets, flow_count, recorded_by, top_app, flows)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id::text
	`, in.CustomerID, target.RouterID, in.CustomerIP, in.DurationSeconds, startedAt, endedAt, totalBytes, totalPackets, len(flows), in.RecordedBy, topApp, flowsJSON).Scan(&captureID)

	if err != nil {
		tr.logger.Error("simpan capture gagal", "error", err)
		return nil, fmt.Errorf("simpan capture: %w", err)
	}

	// 4. Catat jejak audit
	if _, err := tr.db.Exec(ctx, `
		INSERT INTO browsing_access_audit (user_id, customer_id, opened_at, reason)
		VALUES ($1, $2, now(), $3)
	`, in.UserID, in.CustomerID, fmt.Sprintf("Inspeksi Torch %ds oleh %s", in.DurationSeconds, in.RecordedBy)); err != nil {
		tr.logger.Warn("gagal mencatat jejak audit browsing", "error", err)
	}

	return &TorchCaptureResult{
		ID:              captureID,
		CustomerID:      in.CustomerID,
		CustomerIP:      in.CustomerIP,
		DurationSeconds: in.DurationSeconds,
		StartedAt:       startedAt,
		EndedAt:         endedAt,
		TotalBytes:      totalBytes,
		TotalPackets:    totalPackets,
		FlowCount:       len(flows),
		TopApp:          topApp,
		RecordedBy:      in.RecordedBy,
		Flows:           flows,
	}, nil
}

func isLocalIP(ip string) bool {
	if ip == "172.16.0.1" || strings.HasPrefix(ip, "127.") || ip == "::1" {
		return true
	}
	if parsed, err := netip.ParseAddr(ip); err == nil {
		return parsed.IsPrivate() || parsed.IsLoopback()
	}
	return false
}

func identifyPlatformAndDomain(ctx context.Context, peerIP string, port int, observedDomain string, db *pgxpool.Pool) (platform string, domain string, category string, confidence *float64) {
	category = "belum terklasifikasi"

	// 1. Cek apakah alamat IP lokal / gateway
	if isLocalIP(peerIP) {
		return "Router Gateway / DNS Lokal", "", "Jaringan Lokal", nil
	}

	domain = observedDomain
	if domain != "" {
		cleanDom := strings.ToLower(strings.TrimSuffix(domain, "."))
		var cat string
		var conf float64
		err := db.QueryRow(ctx, `
			SELECT category, confidence FROM domain_catalog 
			WHERE domain = $1 OR $1 LIKE '%.' || domain 
			ORDER BY length(domain) DESC LIMIT 1
		`, cleanDom).Scan(&cat, &conf)
		if err == nil {
			category = cat
			confidence = &conf
		}

		// Platform informatif berdasarkan domain nyata yang diobservasi
		switch {
		case strings.Contains(cleanDom, "youtube") || strings.Contains(cleanDom, "googlevideo"):
			platform = "YouTube"
		case strings.Contains(cleanDom, "1e100") || strings.Contains(cleanDom, "google"):
			platform = "Google / YouTube"
		case strings.Contains(cleanDom, "tiktok"):
			platform = "TikTok"
		case strings.Contains(cleanDom, "instagram"):
			platform = "Instagram"
		case strings.Contains(cleanDom, "facebook") || strings.Contains(cleanDom, "fbcdn"):
			platform = "Facebook"
		case strings.Contains(cleanDom, "whatsapp"):
			platform = "WhatsApp"
		case strings.Contains(cleanDom, "netflix"):
			platform = "Netflix"
		case strings.Contains(cleanDom, "shopee"):
			platform = "Shopee"
		case strings.Contains(cleanDom, "tokopedia"):
			platform = "Tokopedia"
		default:
			platform = cleanDom
		}
		return platform, domain, category, confidence
	}

	// Bila domain tidak teridentifikasi, platform adalah IP dan kategori tetap 'belum terklasifikasi'
	return peerIP, "", category, nil
}
