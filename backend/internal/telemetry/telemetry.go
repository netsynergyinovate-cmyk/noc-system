// Package telemetry mengumpulkan data dashboard di luar traffic dan pelanggan
// (resource router, OLT, latensi, redaman optik kritis, alert aktif) dan
// mendorongnya ke Publish tepat saat isinya berubah. Browser tidak perlu polling:
// hub menyiarkan hasilnya lewat WebSocket dan REST melayani yang terakhir.
package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/wire"
)

const (
	defaultInterval     = time.Second
	defaultLatencyEvery = 5 * time.Second
	defaultDialTimeout  = 2 * time.Second
	dbTimeout           = 3 * time.Second
	// Daftar di dashboard satu layar: empat baris cukup.
	listLimit = 4
)

// Source adalah bagian state.Manager yang dibaca; di tes diganti tiruan.
type Source interface {
	Routers() []state.Router
	RouterResource(routerID string) (state.Resource, bool)
}

// Querier adalah bagian pgxpool.Pool yang dipakai; di tes diganti tiruan.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Options mengatur Service. Source dan Publish wajib; DB boleh nil (tanpa
// database, OLT/optik/alert kosong dan DatabaseOK false).
type Options struct {
	Source  Source
	DB      Querier
	Logger  *slog.Logger
	Publish func(wire.Telemetry)

	Interval     time.Duration // jarak baca state dan database; default 1 detik
	LatencyEvery time.Duration // jarak ukur latensi; default 5 detik
	DialTimeout  time.Duration // batas satu ukur latensi; default 2 detik
	// Dial mengukur satu alamat; default net.Dialer. Diganti di tes.
	Dial func(ctx context.Context, network, addr string) (net.Conn, error)
	// PublicTargets: pembanding di luar jaringan sendiri. Nil memakai DNS Cloudflare
	// dan Google; slice kosong (non-nil) mematikannya.
	PublicTargets []Target
}

// Target adalah alamat yang diukur latensinya.
type Target struct {
	Name string
	Addr string // host:port
}

// DefaultPublicTargets: dua DNS publik, untuk membedakan "jaringan kita" dari "internet".
func DefaultPublicTargets() []Target {
	return []Target{
		{Name: "Cloudflare DNS", Addr: "1.1.1.1:53"},
		{Name: "Google DNS", Addr: "8.8.8.8:53"},
	}
}

type dbPart struct {
	olts   []wire.OltTelemetry
	optics []wire.CriticalOptic
	pons   []wire.PonPort
	alerts wire.ActiveAlerts
	ok     bool
}

// Service membangun wire.Telemetry dari state, database, dan pengukuran latensi.
type Service struct {
	opts Options

	pubMu    sync.Mutex // satu penyusun+penyiar sekali jalan: telemetri lama tidak menimpa yang baru
	mu       sync.Mutex
	vlans    map[string][]collector.VlanRate // routerID -> VLAN PON terakhir
	vlanHist map[string][]wire.VlanSample    // routerID\x00nama -> titik terakhir (VlanHistoryPoints)
	db       dbPart
	oltHost  map[string]string // nama OLT -> alamat, bahan target latensi
	latency  wire.Latency
	latest   wire.Telemetry
	last     []byte // JSON yang terakhir dipublikasikan
}

// New membuat Service. Panggil Run agar data mulai dibaca.
func New(opts Options) *Service {
	if opts.Interval <= 0 {
		opts.Interval = defaultInterval
	}
	if opts.LatencyEvery <= 0 {
		opts.LatencyEvery = defaultLatencyEvery
	}
	if opts.DialTimeout <= 0 {
		opts.DialTimeout = defaultDialTimeout
	}
	if opts.Dial == nil {
		opts.Dial = (&net.Dialer{}).DialContext
	}
	if opts.PublicTargets == nil {
		opts.PublicTargets = DefaultPublicTargets()
	}
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	s := &Service{opts: opts, latency: wire.Latency{Items: []wire.LatencyItem{}}, vlans: map[string][]collector.VlanRate{}, vlanHist: map[string][]wire.VlanSample{}}
	s.latest = s.build()
	return s
}

// Latest mengembalikan telemetri terakhir (salinan dangkal; daftar tidak diubah pemanggil).
func (s *Service) Latest() wire.Telemetry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.latest
}

// VlanHistoryPoints: 300 titik = 5 menit pada 1 sampel per detik, sama dengan grafik traffic utama.
const VlanHistoryPoints = 300

// VlanHistory mengembalikan titik terakhir tiap VLAN (urut nama), salinan.
func (s *Service) VlanHistory() []wire.VlanHistory {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]wire.VlanHistory, 0, len(s.vlanHist))
	for key, samples := range s.vlanHist {
		routerID, name, _ := strings.Cut(key, "\x00")
		out = append(out, wire.VlanHistory{RouterID: routerID, Name: name, Samples: slices.Clone(samples)})
	}
	slices.SortFunc(out, func(a, b wire.VlanHistory) int { return strings.Compare(a.RouterID+a.Name, b.RouterID+b.Name) })
	return out
}

// SetDB memasang database; panggil sebelum Run.
func (s *Service) SetDB(db Querier) { s.opts.DB = db }

// SetVlans mencatat laju VLAN PON terbaru satu router dan langsung menyiarkannya bila
// berubah. Dipanggil poller tiap detik; cocok sebagai PollerOptions.OnVlans.
func (s *Service) SetVlans(routerID string, rates []collector.VlanRate) {
	s.mu.Lock()
	s.vlans[routerID] = rates
	for _, v := range rates {
		if !v.RateOK {
			continue
		}
		key := routerID + "\x00" + v.Name
		hist := s.vlanHist[key]
		if at := v.At.Unix(); len(hist) == 0 || at > hist[len(hist)-1].At {
			hist = append(hist, wire.VlanSample{At: at, DownMbps: v.DownMbps, UpMbps: v.UpMbps})
			if len(hist) > VlanHistoryPoints {
				hist = hist[len(hist)-VlanHistoryPoints:]
			}
			s.vlanHist[key] = hist
		}
	}
	s.mu.Unlock()
	s.publishIfChanged()
}

// Run berjalan sampai ctx dibatalkan.
func (s *Service) Run(ctx context.Context) {
	go s.runLatency(ctx)
	s.refresh(ctx)
	ticker := time.NewTicker(s.opts.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.refresh(ctx)
		}
	}
}

func (s *Service) runLatency(ctx context.Context) {
	for {
		s.measure(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(s.opts.LatencyEvery):
		}
	}
}

// refresh membaca database, membangun telemetri, dan mempublikasikannya bila berubah.
func (s *Service) refresh(ctx context.Context) {
	s.readDB(ctx)
	s.publishIfChanged()
}

func (s *Service) publishIfChanged() {
	s.pubMu.Lock()
	defer s.pubMu.Unlock()
	s.mu.Lock()
	t := s.build()
	raw, err := json.Marshal(t)
	if err != nil {
		s.mu.Unlock()
		s.opts.Logger.Error("telemetri tidak bisa disusun", "error", err)
		return
	}
	changed := !bytes.Equal(raw, s.last)
	if changed {
		s.last, s.latest = raw, t
	}
	s.mu.Unlock()
	if changed {
		s.opts.Publish(t)
	}
}

// build menyusun telemetri dari state dan bagian yang tersimpan. Kunci s.mu
// harus dipegang pemanggil, kecuali dari New.
func (s *Service) build() wire.Telemetry {
	routers := s.opts.Source.Routers()
	slices.SortFunc(routers, func(a, b state.Router) int { return strings.Compare(a.Name, b.Name) })
	out := wire.Telemetry{
		Routers:            make([]wire.RouterTelemetry, 0, len(routers)),
		Olts:               nonNil(s.db.olts),
		Latency:            s.latency,
		CriticalOptics:     nonNil(s.db.optics),
		Pons:               nonNil(s.db.pons),
		CriticalOpticalDbm: wire.CriticalOpticalDbm,
		Vlans:              s.vlanTraffic(routers),
		Alerts:             s.db.alerts,
		DatabaseOK:         s.db.ok,
	}
	if out.Alerts.Items == nil {
		out.Alerts.Items = []wire.ActiveAlert{}
	}
	for _, r := range routers {
		res, ok := s.opts.Source.RouterResource(r.ID)
		out.Routers = append(out.Routers, wire.NewRouterTelemetry(r, res, ok))
	}
	return out
}

// vlanTraffic meratakan VLAN semua router (urut router lalu nama VLAN). Kunci s.mu dipegang pemanggil.
func (s *Service) vlanTraffic(routers []state.Router) []wire.VlanTraffic {
	out := []wire.VlanTraffic{}
	for _, r := range routers {
		rates := slices.Clone(s.vlans[r.ID])
		slices.SortFunc(rates, func(a, b collector.VlanRate) int { return strings.Compare(a.Name, b.Name) })
		for _, v := range rates {
			t := wire.VlanTraffic{RouterID: r.ID, Name: v.Name, Running: v.Running, Disabled: v.Disabled}
			if v.RateOK {
				down, up := v.DownMbps, v.UpMbps
				t.DownMbps, t.UpMbps = &down, &up
				at := v.At.Unix()
				t.At = &at
			}
			out = append(out, t)
		}
	}
	return out
}

func nonNil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

const (
	oltsSQL = `SELECT o.id::text, o.name, o.host, o.status,
	(SELECT count(*) FROM olt_pon_ports p WHERE p.olt_id = o.id)::int,
	(SELECT count(*) FROM olt_onus u WHERE u.olt_id = o.id AND u.status = 'online')::int,
	(SELECT count(*) FROM olt_onus u WHERE u.olt_id = o.id)::int
	FROM olts o ORDER BY o.name`

	ponsSQL = `SELECT o.name, p.pon_index, p.onu_online_count, p.rx_power::float8
	FROM olt_pon_ports p JOIN olts o ON o.id = p.olt_id
	WHERE o.status = 'aktif' ORDER BY o.name, p.pon_index`

	opticsSQL = `SELECT u.id::text, u.pon_index, u.onu_index, u.rx_power::float8, u.serial_number,
	c.name, u.description, c.pppoe_username, c.address, c.odp_name
	FROM olt_onus u LEFT JOIN customers c ON c.id = u.customer_id
	WHERE u.rx_power < $1 AND u.status = 'online'
	ORDER BY u.rx_power ASC LIMIT $2`

	alertsSQL = `SELECT a.id::text, a.type, a.severity, COALESCE(a.title, ''),
	COALESCE(NULLIF(a.location_name, ''), NULLIF(a.location_odp, ''), NULLIF(a.location_address, ''), c.name, r.name, ''),
	EXTRACT(EPOCH FROM a.detected_at)::bigint, count(*) OVER ()::int
	FROM alerts a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN routers r ON r.id = a.router_id
	WHERE a.status = 'active' ORDER BY a.started_at DESC LIMIT $1`
)

// readDB memperbarui bagian database. Gagal: bagian lama tetap, ok=false.
func (s *Service) readDB(ctx context.Context) {
	if s.opts.DB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	part, err := s.queryDB(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		if ctx.Err() == nil || !errors.Is(err, context.Canceled) {
			s.opts.Logger.Warn("telemetri: database gagal dibaca", "error", err)
		}
		s.db.ok = false
		return
	}
	s.db = part
	s.oltHost = make(map[string]string, len(part.olts))
	for _, o := range part.olts {
		s.oltHost[o.Name] = o.Host
	}
}

func (s *Service) queryDB(ctx context.Context) (dbPart, error) {
	part := dbPart{ok: true}
	rows, err := s.opts.DB.Query(ctx, oltsSQL)
	if err != nil {
		return part, fmt.Errorf("baca OLT: %w", err)
	}
	for rows.Next() {
		var o wire.OltTelemetry
		if err := rows.Scan(&o.ID, &o.Name, &o.Host, &o.Status, &o.PonPortCount, &o.OnuOnline, &o.OnuTotal); err != nil {
			rows.Close()
			return part, fmt.Errorf("baca baris OLT: %w", err)
		}
		part.olts = append(part.olts, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return part, fmt.Errorf("baca OLT: %w", err)
	}

	rows, err = s.opts.DB.Query(ctx, ponsSQL)
	if err != nil {
		return part, fmt.Errorf("baca port PON: %w", err)
	}
	for rows.Next() {
		var p wire.PonPort
		if err := rows.Scan(&p.OltName, &p.PonIndex, &p.OnuOnline, &p.RxPowerDbm); err != nil {
			rows.Close()
			return part, fmt.Errorf("baca baris port PON: %w", err)
		}
		part.pons = append(part.pons, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return part, fmt.Errorf("baca port PON: %w", err)
	}

	rows, err = s.opts.DB.Query(ctx, opticsSQL, wire.CriticalOpticalDbm, listLimit)
	if err != nil {
		return part, fmt.Errorf("baca redaman optik: %w", err)
	}
	for rows.Next() {
		var (
			c                                     wire.CriticalOptic
			pon, onu                              int
			serial, name, descr, user, addr, odpN *string
		)
		if err := rows.Scan(&c.ID, &pon, &onu, &c.Rx, &serial, &name, &descr, &user, &addr, &odpN); err != nil {
			rows.Close()
			return part, fmt.Errorf("baca baris optik: %w", err)
		}
		c.User = firstNonEmpty(name, descr, user, prefixed("ONT ", serial), strPtr(fmt.Sprintf("ONU %d/%d", pon, onu)))
		c.Pon = fmt.Sprintf("PON %d • ONU %d", pon, onu)
		c.Odp = firstNonEmpty(odpN, addr, prefixed("SN: ", serial), strPtr("Jaringan Distribusi"))
		switch {
		case c.Rx < -27:
			c.Badge = "Critical"
		case c.Rx < -26:
			c.Badge = "High Atten"
		default:
			c.Badge = "Degrading"
		}
		part.optics = append(part.optics, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return part, fmt.Errorf("baca redaman optik: %w", err)
	}

	rows, err = s.opts.DB.Query(ctx, alertsSQL, listLimit)
	if err != nil {
		return part, fmt.Errorf("baca alert aktif: %w", err)
	}
	for rows.Next() {
		var a wire.ActiveAlert
		if err := rows.Scan(&a.ID, &a.Type, &a.Severity, &a.Title, &a.Location, &a.DetectedAt, &part.alerts.Total); err != nil {
			rows.Close()
			return part, fmt.Errorf("baca baris alert: %w", err)
		}
		part.alerts.Items = append(part.alerts.Items, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return part, fmt.Errorf("baca alert aktif: %w", err)
	}
	return part, nil
}

func strPtr(s string) *string { return &s }

func prefixed(prefix string, v *string) *string {
	if v == nil || *v == "" {
		return nil
	}
	return strPtr(prefix + *v)
}

func firstNonEmpty(vals ...*string) string {
	for _, v := range vals {
		if v != nil && *v != "" {
			return *v
		}
	}
	return ""
}

// targets: router (alamat REST yang dipoll collector), OLT (telnet, port 23 bila
// tidak disebut), lalu pembanding publik.
func (s *Service) targets() []Target {
	var out []Target
	for _, r := range s.opts.Source.Routers() {
		if addr, ok := routerAddr(r.Host); ok {
			out = append(out, Target{Name: r.Name, Addr: addr})
		}
	}
	slices.SortFunc(out, func(a, b Target) int { return strings.Compare(a.Name, b.Name) })

	s.mu.Lock()
	names := make([]string, 0, len(s.oltHost))
	for name := range s.oltHost {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		addr := s.oltHost[name]
		if _, _, err := net.SplitHostPort(addr); err != nil {
			addr = net.JoinHostPort(addr, "23")
		}
		out = append(out, Target{Name: name, Addr: addr})
	}
	s.mu.Unlock()
	return append(out, s.opts.PublicTargets...)
}

// routerAddr mengubah Host router menjadi host:port REST, sama dengan yang dipoll collector.
func routerAddr(host string) (string, bool) {
	base, err := collector.BaseURLFromHost(host)
	if err != nil {
		return "", false
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return "", false
	}
	if u.Port() == "" {
		port := "80"
		if u.Scheme == "https" {
			port = "443"
		}
		return net.JoinHostPort(u.Hostname(), port), true
	}
	return u.Host, true
}

// measure mengukur semua target bersamaan, lalu mempublikasikan bila berubah.
func (s *Service) measure(ctx context.Context) {
	targets := s.targets()
	items := make([]wire.LatencyItem, len(targets))
	var wg sync.WaitGroup
	for i, t := range targets {
		wg.Add(1)
		go func() {
			defer wg.Done()
			items[i] = s.probe(ctx, t)
		}()
	}
	wg.Wait()
	if ctx.Err() != nil {
		return
	}

	lat := wire.Latency{Items: items, TotalCount: len(items)}
	sum := 0
	for _, it := range items {
		if it.LatencyMs != nil {
			lat.OnlineCount++
			sum += *it.LatencyMs
		}
	}
	if lat.OnlineCount > 0 {
		avg := sum / lat.OnlineCount
		lat.AvgLatencyMs = &avg
	}
	at := time.Now().Unix()
	lat.MeasuredAt = &at

	s.mu.Lock()
	s.latency = lat
	s.mu.Unlock()
	s.publishIfChanged()
}

func (s *Service) probe(ctx context.Context, t Target) wire.LatencyItem {
	host, portStr, _ := net.SplitHostPort(t.Addr)
	port, _ := strconv.Atoi(portStr)
	item := wire.LatencyItem{Name: t.Name, Host: host, Port: port, Status: "error"}

	ctx, cancel := context.WithTimeout(ctx, s.opts.DialTimeout)
	defer cancel()
	start := time.Now()
	conn, err := s.opts.Dial(ctx, "tcp", t.Addr)
	if err != nil {
		var ne net.Error
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()) {
			item.Status = "timeout"
		}
		return item
	}
	_ = conn.Close()
	ms := int(time.Since(start).Milliseconds())
	item.LatencyMs, item.Status = &ms, "online"
	return item
}
