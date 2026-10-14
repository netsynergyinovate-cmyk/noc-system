package olt

import (
	"context"
	"encoding/json"
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

type hsgqPon struct {
	ID        int      `json:"id"`
	RxPower   *float64 `json:"rx_power"`
	TxPower   *float64 `json:"tx_power"`
	OnlineOnu int      `json:"online_onu"`
}

type hsgqOnu struct {
	Pon         int      `json:"pon"`
	ID          int      `json:"id"`
	MAC         string   `json:"mac"`
	Status      string   `json:"status"`
	RxPower     *float64 `json:"rx_power"`
	TxPower     *float64 `json:"tx_power"`
	Attenuation *float64 `json:"attenuation"`
}

func (d *hsgqDriver) FetchPonPorts(ctx context.Context) ([]PonPortStats, error) {
	b, err := d.get(ctx, hsgqPathPon)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Ports []hsgqPon `json:"ports"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("olt/hsgq: JSON PON tidak valid: %w", err)
	}
	out := make([]PonPortStats, 0, len(doc.Ports))
	for _, p := range doc.Ports {
		s := PonPortStats{Index: p.ID, RxPowerDbm: p.RxPower, TxPowerDbm: p.TxPower, OnuOnlineCount: p.OnlineOnu}
		if p.RxPower != nil && p.TxPower != nil {
			s.AttenuationDb = f64(*p.TxPower - *p.RxPower)
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
	var doc struct {
		Onus []hsgqOnu `json:"onus"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("olt/hsgq: JSON ONU tidak valid: %w", err)
	}
	out := make([]OnuStats, 0, len(doc.Onus))
	for _, o := range doc.Onus {
		s := OnuStats{
			PonIndex:   o.Pon,
			OnuIndex:   o.ID,
			MacAddress: strings.ToUpper(strings.TrimSpace(o.MAC)),
			IsOnline:   strings.EqualFold(o.Status, "online"),
		}
		if s.IsOnline { // ONU offline tidak punya pembacaan optik
			s.RxPowerDbm, s.TxPowerDbm, s.AttenuationDb = o.RxPower, o.TxPower, o.Attenuation
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
