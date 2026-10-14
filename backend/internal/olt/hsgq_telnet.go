package olt

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// Driver "hsgq-telnet": OLT HSGQ seri XE (EPON) yang hanya punya CLI telnet
// (mis. HSGQ-XE08ID). Semua perintah berupa "show": tidak ada yang mengubah
// konfigurasi OLT. Satu sesi dipakai untuk satu putaran polling lalu ditutup,
// karena jumlah sesi VTY OLT terbatas.

const (
	hsgqTelnetDefaultTimeout = 15 * time.Second
	// snapshotTTL: FetchPonPorts dan FetchOnus dipanggil berurutan oleh poller;
	// keduanya memakai satu pembacaan, bukan dua sesi telnet.
	snapshotTTL = 10 * time.Second
)

// cliConn adalah bagian sesi yang dipakai driver; di tes diganti tiruan.
type cliConn interface {
	run(ctx context.Context, cmd string) (string, error)
	Close() error
}

type hsgqTelnetDriver struct {
	cfg  Config
	open func(ctx context.Context) (cliConn, error)
	now  func() time.Time

	mu     sync.Mutex
	snap   *cliSnapshot
	snapAt time.Time
	closed bool
}

type cliSnapshot struct {
	ports []PonPortStats
	onus  []OnuStats
}

func init() {
	Register("hsgq-telnet", newHsgqTelnet)
}

func newHsgqTelnet(cfg Config) (Driver, error) {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return nil, errors.New("olt/hsgq-telnet: host kosong")
	}
	if strings.Contains(host, "://") {
		return nil, errors.New("olt/hsgq-telnet: host tidak boleh memuat skema; tulis alamat atau alamat:port")
	}
	if cfg.Username == "" {
		return nil, errors.New("olt/hsgq-telnet: username kosong")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = hsgqTelnetDefaultTimeout
	}
	d := &hsgqTelnetDriver{cfg: cfg, now: time.Now}
	d.open = func(ctx context.Context) (cliConn, error) {
		s, err := dialTelnet(ctx, host, cfg.Timeout)
		if err != nil {
			return nil, err
		}
		if err := s.login(ctx, cfg.Username, cfg.Password); err != nil {
			s.Close()
			return nil, err
		}
		// "show onu-info" dan kawan-kawan hanya ada di mode konfigurasi; masuk ke
		// mode itu tidak mengubah apa pun.
		for _, c := range []string{"enable", "configure"} {
			if _, err := s.run(ctx, c); err != nil {
				s.Close()
				return nil, fmt.Errorf("olt/hsgq-telnet: perintah %q: %w", c, err)
			}
		}
		return s, nil
	}
	return d, nil
}

func (d *hsgqTelnetDriver) Name() string { return "hsgq-telnet" }

func (d *hsgqTelnetDriver) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closed = true
	d.snap = nil
	return nil
}

func (d *hsgqTelnetDriver) TestConnection(ctx context.Context) error {
	if d.isClosed() {
		return errors.New("olt/hsgq-telnet: driver sudah ditutup")
	}
	c, err := d.open(ctx)
	if err != nil {
		return err
	}
	defer closeSession(ctx, c)
	if _, err := c.run(ctx, "show version"); err != nil {
		return fmt.Errorf("olt/hsgq-telnet: show version: %w", err)
	}
	return nil
}

func (d *hsgqTelnetDriver) isClosed() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.closed
}

// closeSession keluar dengan rapi supaya slot VTY OLT dilepas segera.
func closeSession(ctx context.Context, c cliConn) {
	quit, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	_, _ = c.run(quit, "end")
	_ = c.Close()
}

func (d *hsgqTelnetDriver) FetchPonPorts(ctx context.Context) ([]PonPortStats, error) {
	s, err := d.snapshot(ctx)
	if err != nil {
		return nil, err
	}
	return s.ports, nil
}

func (d *hsgqTelnetDriver) FetchOnus(ctx context.Context) ([]OnuStats, error) {
	s, err := d.snapshot(ctx)
	if err != nil {
		return nil, err
	}
	return s.onus, nil
}

func (d *hsgqTelnetDriver) snapshot(ctx context.Context) (*cliSnapshot, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return nil, errors.New("olt/hsgq-telnet: driver sudah ditutup")
	}
	if d.snap != nil && d.now().Sub(d.snapAt) < snapshotTTL {
		return d.snap, nil
	}
	c, err := d.open(ctx)
	if err != nil {
		return nil, err
	}
	defer closeSession(ctx, c)
	snap, err := collectHsgq(ctx, c)
	if err != nil {
		return nil, err
	}
	d.snap, d.snapAt = snap, d.now()
	return snap, nil
}

// collectHsgq menjalankan perintah baca dan menggabungkan hasilnya.
func collectHsgq(ctx context.Context, c cliConn) (*cliSnapshot, error) {
	infoOut, err := c.run(ctx, "show onu-info all")
	if err != nil {
		return nil, fmt.Errorf("olt/hsgq-telnet: show onu-info all: %w", err)
	}
	rows := parseOnuInfo(infoOut)

	// Nama lengkap dan model: bukan inti polling, jadi kegagalannya tidak
	// menggagalkan putaran (ONU tetap tampil dengan MAC dan status).
	versions := map[[2]int]onuVersion{}
	if out, err := c.run(ctx, "show onu-version all"); err == nil {
		versions = parseOnuVersion(out)
	}

	ponOut, err := c.run(ctx, "show pon-info")
	if err != nil {
		return nil, fmt.Errorf("olt/hsgq-telnet: show pon-info: %w", err)
	}
	pons := parsePonInfo(ponOut)

	// Bacaan optik hanya ada untuk ONU online: tanya hanya PON yang punya ONU online.
	online := map[int]bool{}
	for _, r := range rows {
		if r.Status == "online" {
			online[r.Pon] = true
		}
	}
	optical := map[[2]int]opticalReading{}
	var ponIDs []int
	for p := range online {
		ponIDs = append(ponIDs, p)
	}
	sort.Ints(ponIDs)
	for _, p := range ponIDs {
		out, err := c.run(ctx, fmt.Sprintf("show optical-diag %d", p))
		if err != nil {
			continue // PON ini tanpa bacaan optik; yang lain tetap
		}
		for k, v := range parseOpticalDiag(out) {
			optical[k] = v
		}
	}

	snap := &cliSnapshot{}
	rxSum := map[int]float64{}
	rxN := map[int]int{}
	for _, r := range rows {
		k := key(r.Pon, r.Onu)
		o := OnuStats{
			PonIndex:   r.Pon,
			OnuIndex:   r.Onu,
			MacAddress: r.MAC,
			State:      r.Status,
			IsOnline:   r.Status == "online",
		}
		if v, ok := versions[k]; ok {
			o.Name, o.Model = v.Name, v.Model
		}
		if rd, ok := optical[k]; ok && o.IsOnline {
			o.RxPowerDbm, o.TxPowerDbm = rd.RxDbm, rd.TxDbm
			if o.Name == "" {
				o.Name = rd.Name
			}
			if rd.RxDbm != nil {
				rxSum[r.Pon] += *rd.RxDbm
				rxN[r.Pon]++
			}
		}
		snap.onus = append(snap.onus, o)
	}
	for _, p := range pons {
		s := PonPortStats{Index: p.Index, OnuOnlineCount: p.Online}
		if n := rxN[p.Index]; n > 0 {
			avg := rxSum[p.Index] / float64(n)
			s.RxPowerDbm = &avg // rata-rata daya terima ONU di port ini
		}
		snap.ports = append(snap.ports, s)
	}
	return snap, nil
}
