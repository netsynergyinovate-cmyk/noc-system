package netflow

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/netip"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// ExporterStatus mencatat status router pengirim NetFlow.
type ExporterStatus struct {
	IP           string    `json:"ip"`
	RouterID     string    `json:"routerId"`
	Version      uint16    `json:"version"`
	Packets      uint64    `json:"packets"`
	Flows        uint64    `json:"flows"`
	SamplingRate uint32    `json:"samplingRate"`
	LastSeen     time.Time `json:"lastSeen"`
}

// ReceiverHealth mencatat metrik kesehatan penerima UDP NetFlow.
type ReceiverHealth struct {
	Active         bool             `json:"active"`
	Addr           string           `json:"addr"`
	UptimeSeconds  int64            `json:"uptimeSeconds"`
	TotalPackets   uint64           `json:"totalPackets"`
	TotalFlows     uint64           `json:"totalFlows"`
	TotalBytes     uint64           `json:"totalBytes"`
	UnknownSources   uint64           `json:"unknownSources"`
	UnknownTemplates uint64           `json:"unknownTemplates"`
	LastReceivedAt   *time.Time       `json:"lastReceivedAt,omitempty"`
	Exporters        []ExporterStatus `json:"exporters"`
}

type FlowSink interface {
	HandleFlows(ctx context.Context, records []Record) error
}

type Server struct {
	conn      *net.UDPConn
	sink      FlowSink
	logger    *slog.Logger
	startedAt time.Time

	// resolve memetakan alamat pengirim ke router; nil = terima semua.
	resolve  func(netip.Addr) (string, bool)
	warnedAt         map[netip.Addr]time.Time
	unknown          atomic.Uint64
	unknownTemplates atomic.Uint64
	templateCache    *TemplateCache
	mu             sync.RWMutex
	samplingRates  map[string]uint32
	exporters      map[netip.Addr]*ExporterStatus
	totalPackets   uint64
	totalFlows     uint64
	totalBytes     uint64
	lastReceivedAt time.Time
}

// SetResolver: hanya paket dari pengirim yang dikenali yang diterima, dan
// setiap flow ditandai router pengirimnya. Panggil sebelum ListenAndServe.
func (s *Server) SetResolver(fn func(netip.Addr) (string, bool)) { s.resolve = fn }

// UnknownSource: paket dari pengirim yang tidak dikenali (dibuang).
func (s *Server) UnknownSource() uint64 { return s.unknown.Load() }

// NewServer membuka socket UDP di addr (kosong = ":2055").
func NewServer(addr string, sink FlowSink, logger *slog.Logger) (*Server, error) {
	if sink == nil {
		return nil, errors.New("netflow: sink wajib")
	}
	if addr == "" {
		addr = ":2055"
	}
	if logger == nil {
		logger = slog.Default()
	}
	ua, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp", ua)
	if err != nil {
		return nil, err
	}
	return &Server{
		conn:          conn,
		sink:          sink,
		logger:        logger,
		startedAt:     time.Now(),
		warnedAt:      map[netip.Addr]time.Time{},
		samplingRates: map[string]uint32{},
		exporters:     map[netip.Addr]*ExporterStatus{},
		templateCache: NewTemplateCache(),
	}, nil
}

// Addr alamat yang benar-benar didengarkan.
func (s *Server) Addr() net.Addr { return s.conn.LocalAddr() }

// SetSamplingRate menetapkan pengali sampling rate manual untuk router (atau alamat IP).
func (s *Server) SetSamplingRate(routerOrIP string, rate uint32) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.samplingRates == nil {
		s.samplingRates = map[string]uint32{}
	}
	if rate > 0 {
		s.samplingRates[routerOrIP] = rate
	} else {
		delete(s.samplingRates, routerOrIP)
	}
}

func (s *Server) getSamplingRate(routerID, ipStr string) uint32 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.samplingRates != nil {
		if r, ok := s.samplingRates[routerID]; ok && r > 0 {
			return r
		}
		if r, ok := s.samplingRates[ipStr]; ok && r > 0 {
			return r
		}
	}
	return 0
}

// Exporters mengembalikan daftar status exporter yang terdeteksi secara thread-safe.
func (s *Server) Exporters() []ExporterStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	res := make([]ExporterStatus, 0, len(s.exporters))
	for _, exp := range s.exporters {
		res = append(res, *exp)
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].LastSeen.After(res[j].LastSeen)
	})
	return res
}

// Health mengembalikan metrik kesehatan penerima secara thread-safe.
func (s *Server) Health() ReceiverHealth {
	s.mu.RLock()
	defer s.mu.RUnlock()
	exps := make([]ExporterStatus, 0, len(s.exporters))
	for _, exp := range s.exporters {
		exps = append(exps, *exp)
	}
	sort.Slice(exps, func(i, j int) bool {
		return exps[i].LastSeen.After(exps[j].LastSeen)
	})

	var lastAt *time.Time
	if !s.lastReceivedAt.IsZero() {
		t := s.lastReceivedAt
		lastAt = &t
	}

	var uptime int64
	if !s.startedAt.IsZero() {
		uptime = int64(time.Since(s.startedAt).Seconds())
		if uptime < 0 {
			uptime = 0
		}
	}

	addr := ""
	if s.conn != nil && s.conn.LocalAddr() != nil {
		addr = s.conn.LocalAddr().String()
	}

	return ReceiverHealth{
		Active:         s.conn != nil,
		Addr:           addr,
		UptimeSeconds:  uptime,
		TotalPackets:   s.totalPackets,
		TotalFlows:     s.totalFlows,
		TotalBytes:     s.totalBytes,
		UnknownSources:   s.unknown.Load(),
		UnknownTemplates: s.unknownTemplates.Load(),
		LastReceivedAt:   lastAt,
		Exporters:        exps,
	}
}

// ListenAndServe membaca datagram sampai ctx selesai.
func (s *Server) ListenAndServe(ctx context.Context) error {
	go func() {
		<-ctx.Done()
		_ = s.conn.SetReadDeadline(time.Now())
	}()
	defer s.conn.Close()
	buf := make([]byte, 65535)
	for {
		n, from, err := s.conn.ReadFromUDP(buf)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				continue
			}
			return err
		}
		addr := from.AddrPort().Addr().Unmap()
		routerID := ""
		if s.resolve != nil {
			id, ok := s.resolve(addr)
			if !ok {
				s.unknown.Add(1)
				s.mu.Lock()
				if s.warnedAt == nil {
					s.warnedAt = map[netip.Addr]time.Time{}
				}
				now := time.Now()
				if now.Sub(s.warnedAt[addr]) > 10*time.Minute {
					s.warnedAt[addr] = now
					s.logger.Warn("netflow dari alamat yang bukan router terdaftar dibuang; petakan lewat NETFLOW_SOURCE_MAP bila ini router", "alamat", addr.String())
				}
				s.mu.Unlock()
				continue
			}
			routerID = id
		}

		version, recs, detectedRate, unk, err := ParsePacketWithCache(addr, buf[:n], s.templateCache)
		if unk > 0 {
			s.unknownTemplates.Add(uint64(unk))
		}
		if err != nil {
			s.logger.Warn("netflow: paket dibuang", "from", from.String(), "error", err)
			continue
		}

		now := time.Now()
		s.mu.Lock()
		exp := s.exporters[addr]
		if exp == nil {
			exp = &ExporterStatus{
				IP:       addr.String(),
				RouterID: routerID,
			}
			s.exporters[addr] = exp
		}
		if detectedRate > 1 {
			exp.SamplingRate = detectedRate
		}
		effectiveRate := exp.SamplingRate
		if s.samplingRates != nil {
			if r, ok := s.samplingRates[routerID]; ok && r > 0 {
				effectiveRate = r
			} else if r, ok := s.samplingRates[addr.String()]; ok && r > 0 {
				effectiveRate = r
			}
		}
		if effectiveRate == 0 {
			effectiveRate = 1
		}
		exp.RouterID = routerID
		exp.Version = version
		exp.Packets++
		exp.Flows += uint64(len(recs))
		exp.SamplingRate = effectiveRate
		exp.LastSeen = now
		s.totalPackets++
		s.totalFlows += uint64(len(recs))
		s.lastReceivedAt = now
		s.mu.Unlock()

		// Terapkan pengali sampling rate per router
		var batchBytes uint64
		for i := range recs {
			if effectiveRate > 1 {
				recs[i].Bytes = recs[i].Bytes * uint64(effectiveRate)
				recs[i].Pkts = recs[i].Pkts * uint64(effectiveRate)
			}
			batchBytes += recs[i].Bytes
		}

		s.mu.Lock()
		s.totalBytes += batchBytes
		s.mu.Unlock()

		for i := range recs {
			recs[i].RouterID = routerID
		}

		if len(recs) > 0 {
			if err := s.sink.HandleFlows(ctx, recs); err != nil {
				s.logger.Error("netflow: sink gagal", "error", err)
			}
		}
	}
}

// FlowSinkFunc mengadaptasi fungsi biasa menjadi FlowSink.
type FlowSinkFunc func(ctx context.Context, records []Record) error

func (f FlowSinkFunc) HandleFlows(ctx context.Context, records []Record) error {
	return f(ctx, records)
}

// DefaultBufferSize adalah kapasitas antrian BufferedSink bila tidak ditentukan.
const DefaultBufferSize = 1024

// BufferedSink membungkus FlowSink dengan antrian terbatas dan satu worker.
// HandleFlows tidak pernah memblokir: bila antrian penuh, batch dibuang dan
// dihitung di DropCount, sehingga banjir UDP tidak menghabiskan RAM maupun
// menahan loop baca socket.
type BufferedSink struct {
	inner   FlowSink
	queue   chan []Record
	dropped atomic.Uint64
	logger  *slog.Logger
}

// NewBufferedSink membuat sink berantrian. size <= 0 memakai DefaultBufferSize.
// Panggil Run di goroutine sendiri agar antrian dikosongkan.
func NewBufferedSink(inner FlowSink, size int, logger *slog.Logger) *BufferedSink {
	if size <= 0 {
		size = DefaultBufferSize
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &BufferedSink{inner: inner, queue: make(chan []Record, size), logger: logger}
}

// HandleFlows memasukkan batch ke antrian tanpa menunggu.
func (b *BufferedSink) HandleFlows(_ context.Context, records []Record) error {
	select {
	case b.queue <- records:
	default:
		b.dropped.Add(1)
	}
	return nil
}

// DropCount jumlah batch (paket) yang dibuang karena antrian penuh.
func (b *BufferedSink) DropCount() uint64 { return b.dropped.Load() }

// Run mengosongkan antrian ke sink asli sampai ctx selesai.
func (b *BufferedSink) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case recs := <-b.queue:
			if err := b.inner.HandleFlows(ctx, recs); err != nil {
				b.logger.Error("netflow: sink gagal", "error", err)
			}
		}
	}
}
