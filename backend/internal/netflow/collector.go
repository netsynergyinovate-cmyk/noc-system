package netflow

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"sync/atomic"
	"time"
)

type FlowSink interface {
	HandleFlows(ctx context.Context, records []Record) error
}

type Server struct {
	conn   *net.UDPConn
	sink   FlowSink
	logger *slog.Logger
}

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
	return &Server{conn: conn, sink: sink, logger: logger}, nil
}

// Addr alamat yang benar-benar didengarkan.
func (s *Server) Addr() net.Addr { return s.conn.LocalAddr() }

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
		_, recs, err := ParseV5(buf[:n])
		if err != nil {
			s.logger.Warn("netflow: paket dibuang", "from", from.String(), "error", err)
			continue
		}
		if err := s.sink.HandleFlows(ctx, recs); err != nil {
			s.logger.Error("netflow: sink gagal", "error", err)
		}
	}
}

// FlowSinkFunc mengadaptasi fungsi biasa menjadi FlowSink.
type FlowSinkFunc func(ctx context.Context, records []Record) error

func (f FlowSinkFunc) HandleFlows(ctx context.Context, records []Record) error { return f(ctx, records) }

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
