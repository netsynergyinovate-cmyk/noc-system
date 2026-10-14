package olt

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// PonPortWriter menyimpan hasil polling (diimplementasikan lapisan DB).
type PonPortWriter interface {
	UpsertPonPort(ctx context.Context, oltID string, stats PonPortStats) error
	TouchOlt(ctx context.Context, oltID string, at time.Time) error
}

// OnuWriter menyimpan data optik per ONU (opsional).
type OnuWriter interface {
	UpsertOnu(ctx context.Context, oltID string, stats OnuStats) error
}

type PollerOptions struct {
	Driver    Driver
	OltID     string
	Writer    PonPortWriter
	OnuWriter OnuWriter // opsional; nil = ONU tidak dipolling
	Logger    *slog.Logger
	// Now bisa diisi untuk test; default time.Now.
	Now func() time.Time
}

type Poller struct {
	driver    Driver
	oltID     string
	writer    PonPortWriter
	onuWriter OnuWriter
	logger    *slog.Logger
	now       func() time.Time
}

func NewPoller(opts PollerOptions) (*Poller, error) {
	if opts.Driver == nil {
		return nil, errors.New("olt: poller butuh Driver")
	}
	if opts.OltID == "" {
		return nil, errors.New("olt: poller butuh OltID")
	}
	if opts.Writer == nil {
		return nil, errors.New("olt: poller butuh Writer")
	}
	p := &Poller{driver: opts.Driver, oltID: opts.OltID, writer: opts.Writer, onuWriter: opts.OnuWriter, logger: opts.Logger, now: opts.Now}
	if p.logger == nil {
		p.logger = slog.Default()
	}
	if p.now == nil {
		p.now = time.Now
	}
	return p, nil
}

// PollOnce mengambil data PON port, menyimpan semuanya, lalu memperbarui last_seen_at.
// TouchOlt hanya dipanggil bila seluruh langkah sebelumnya sukses.
func (p *Poller) PollOnce(ctx context.Context) error {
	ports, err := p.driver.FetchPonPorts(ctx)
	if errors.Is(err, ErrNotSupported) {
		p.logger.Warn("fitur tidak didukung oleh OLT, dilewati", "olt", p.oltID, "fitur", "pon", "error", err)
		ports, err = nil, nil
	}
	if err != nil {
		return fmt.Errorf("olt %s: ambil PON port: %w", p.oltID, err)
	}
	for _, s := range ports {
		if err := p.writer.UpsertPonPort(ctx, p.oltID, s); err != nil {
			return fmt.Errorf("olt %s: simpan PON %d: %w", p.oltID, s.Index, err)
		}
	}
	if p.onuWriter != nil {
		onus, err := p.driver.FetchOnus(ctx)
		if errors.Is(err, ErrNotSupported) {
			p.logger.Warn("fitur tidak didukung oleh OLT, dilewati", "olt", p.oltID, "fitur", "onu", "error", err)
			onus, err = nil, nil
		}
		if err != nil {
			return fmt.Errorf("olt %s: ambil ONU: %w", p.oltID, err)
		}
		for _, o := range onus {
			if err := p.onuWriter.UpsertOnu(ctx, p.oltID, o); err != nil {
				return fmt.Errorf("olt %s: simpan ONU %d/%d: %w", p.oltID, o.PonIndex, o.OnuIndex, err)
			}
		}
	}
	if err := p.writer.TouchOlt(ctx, p.oltID, p.now()); err != nil {
		return fmt.Errorf("olt %s: update last_seen_at: %w", p.oltID, err)
	}
	return nil
}

// Run memanggil PollOnce segera lalu tiap interval sampai ctx dibatalkan.
// Error polling dicatat dan tidak menghentikan loop.
func (p *Poller) Run(ctx context.Context, interval time.Duration) error {
	if interval <= 0 {
		return errors.New("olt: interval harus > 0")
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if err := p.PollOnce(ctx); err != nil && ctx.Err() == nil {
			p.logger.Warn("polling OLT gagal", "olt", p.oltID, "error", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
	}
}
