package olt

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ponytail: endpoint dan format JSON di bawah adalah asumsi web API HSGQ
// (/api/v1/system, /api/v1/pon, /api/v1/onu, Basic auth); cocokkan dengan
// firmware OLT nyata sebelum produksi. Batas: hanya HTTP(S) JSON, tanpa SNMP/CLI.
const (
	hsgqPathSystem = "/api/v1/system"
	hsgqPathPon    = "/api/v1/pon"
	hsgqPathOnu    = "/api/v1/onu"

	hsgqDefaultTimeout = 10 * time.Second
	hsgqMaxBody        = 8 << 20 // 8 MiB
)

type hsgqDriver struct {
	cfg    Config
	client *http.Client
	base   string
}

func init() {
	Register("hsgq", newHsgq)
	// Nama lama yang sudah terlanjur disimpan di tabel olts (isian bebas di wizard
	// versi sebelumnya); semuanya driver HSGQ yang sama.
	Register("hsgq-gpon", newHsgq)
	Register("hsgq-epon", newHsgq)
}

func newHsgq(cfg Config) (Driver, error) {
	host := strings.TrimRight(strings.TrimSpace(cfg.Host), "/")
	if host == "" {
		return nil, errors.New("olt/hsgq: host kosong")
	}
	if !strings.Contains(host, "://") {
		host = "http://" + host
	}
	t := cfg.Timeout
	if t <= 0 {
		t = hsgqDefaultTimeout
	}
	return &hsgqDriver{cfg: cfg, client: &http.Client{Timeout: t}, base: host}, nil
}

func (d *hsgqDriver) Name() string { return "hsgq" }

// get mengambil path dan mengembalikan body hanya untuk status 200.
func (d *hsgqDriver) get(ctx context.Context, path string) ([]byte, error) {
	if d.client == nil {
		return nil, errors.New("olt/hsgq: driver sudah ditutup")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.base+path, nil)
	if err != nil {
		return nil, err
	}
	if d.cfg.Username != "" {
		req.SetBasicAuth(d.cfg.Username, d.cfg.Password)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("olt/hsgq: %s: %w", path, err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, fmt.Errorf("olt/hsgq: kredensial ditolak (HTTP %d)", resp.StatusCode)
	default:
		return nil, fmt.Errorf("olt/hsgq: %s: HTTP %d", path, resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, hsgqMaxBody))
	if err != nil {
		return nil, fmt.Errorf("olt/hsgq: baca %s: %w", path, err)
	}
	return b, nil
}

func (d *hsgqDriver) TestConnection(ctx context.Context) error {
	_, err := d.get(ctx, hsgqPathSystem)
	return err
}

func (d *hsgqDriver) FetchPonPorts(ctx context.Context) ([]PonPortStats, error) {
	b, err := d.get(ctx, hsgqPathPon)
	if err != nil {
		return nil, err
	}
	list, err := decodeObjects(b, "ports", "pon", "data")
	if err != nil {
		return nil, fmt.Errorf("olt/hsgq: JSON PON tidak valid: %w", err)
	}
	out := make([]PonPortStats, 0, len(list))
	for i, p := range list {
		idx, ok := p.integer("ponIndex", "pon_index", "id", "pon")
		if !ok {
			return nil, fmt.Errorf("olt/hsgq: port ke-%d tanpa nomor PON", i+1)
		}
		online, _ := p.integer("onuOnlineCount", "online_onu", "onlineOnu", "onu_online")
		s := PonPortStats{
			Index:          idx,
			RxPowerDbm:     p.float("rxPowerDbm", "rx_power", "rxPower"),
			TxPowerDbm:     p.float("txPowerDbm", "tx_power", "txPower"),
			AttenuationDb:  p.float("attenuationDb", "attenuation_db", "attenuation"),
			OnuOnlineCount: online,
		}
		// Redaman dihitung dari selisih daya hanya bila OLT tidak melaporkannya.
		if s.AttenuationDb == nil && s.RxPowerDbm != nil && s.TxPowerDbm != nil {
			s.AttenuationDb = f64(*s.TxPowerDbm - *s.RxPowerDbm)
		}
		out = append(out, s)
	}
	return out, nil
}

func (d *hsgqDriver) FetchOnus(ctx context.Context) ([]OnuStats, error) {
	b, err := d.get(ctx, hsgqPathOnu)
	if err != nil {
		return nil, err
	}
	list, err := decodeObjects(b, "onus", "onu", "data")
	if err != nil {
		return nil, fmt.Errorf("olt/hsgq: JSON ONU tidak valid: %w", err)
	}
	out := make([]OnuStats, 0, len(list))
	for i, o := range list {
		pon, okPon := o.integer("ponIndex", "pon_index", "pon")
		onu, okOnu := o.integer("onuIndex", "onu_index", "id")
		if !okPon || !okOnu {
			return nil, fmt.Errorf("olt/hsgq: ONU ke-%d tanpa nomor PON atau ONU", i+1)
		}
		state := normalizeState(o.text("status", "state"))
		s := OnuStats{
			PonIndex:     pon,
			OnuIndex:     onu,
			MacAddress:   strings.ToUpper(o.text("macAddress", "mac")),
			SerialNumber: strings.ToUpper(o.text("serialNumber", "serial_number", "sn")),
			State:        state,
			IsOnline:     state == "online",
		}
		if s.IsOnline { // ONU offline atau LOS tidak punya pembacaan optik yang berarti
			s.RxPowerDbm = o.float("rxPowerDbm", "rx_power", "rxPower")
			s.TxPowerDbm = o.float("txPowerDbm", "tx_power", "txPower")
			s.AttenuationDb = o.float("attenuationDb", "attenuation_db", "attenuation")
		}
		out = append(out, s)
	}
	return out, nil
}

func (d *hsgqDriver) Close() error {
	if d.client != nil {
		d.client.CloseIdleConnections()
		d.client = nil
	}
	return nil
}
