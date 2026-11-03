package collector

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"time"
)

// Laju per VLAN PON dari counter byte /interface (type=vlan), sama dengan laju
// interface uplink: selisih counter / selang waktu, satu permintaan massal per detik.
//
// Konvensi jaringan ini: vlan1101..vlan1109 adalah VLAN PON 1..9 di trunk MikroTik ke OLT.
// Interface itu menghadap pelanggan, jadi Tx = download dan Rx = upload.

const vlanProplist = "name,rx-byte,tx-byte,running,disabled"

var vlanPonRE = regexp.MustCompile(`^vlan110[0-9]$`)

// JobVLAN adalah nama job polling counter VLAN PON.
const JobVLAN = "vlan"

// VlanRate adalah keadaan satu VLAN PON pada satu pembacaan.
type VlanRate struct {
	Name     string
	Running  bool
	Disabled bool
	// RateOK salah pada pembacaan pertama dan saat counter turun (router restart):
	// belum ada laju yang bisa dihitung, jadi DownMbps/UpMbps jangan dipakai.
	RateOK   bool
	DownMbps float64
	UpMbps   float64
	// At: saat pembacaan counter (titik tengah permintaan); dasar sumbu waktu grafik. Nol bila belum ada laju.
	At time.Time
}

type rawVlan struct {
	Name     string `json:"name"`
	RxByte   string `json:"rx-byte"`
	TxByte   string `json:"tx-byte"`
	Running  string `json:"running"`
	Disabled string `json:"disabled"`
}

// vlanCounters membaca semua interface VLAN PON dalam satu permintaan.
func (c *Client) vlanCounters(ctx context.Context) ([]rawVlan, error) {
	body, err := c.getQuery(ctx, vlanProplist, url.Values{"type": {"vlan"}}, "interface")
	if err != nil {
		return nil, err
	}
	return parseVlans(body)
}

func parseVlans(body []byte) ([]rawVlan, error) {
	var rows []rawVlan
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("jawaban /interface bukan daftar yang valid: %w", err)
	}
	out := rows[:0]
	for _, r := range rows {
		if vlanPonRE.MatchString(r.Name) {
			out = append(out, r)
		}
	}
	return out, nil
}

// vlanRates menghitung laju tiap VLAN terhadap pembacaan sebelumnya (prev diperbarui).
func vlanRates(prev map[string]ifSample, rows []rawVlan, at time.Time) []VlanRate {
	out := make([]VlanRate, 0, len(rows))
	for _, r := range rows {
		rx, errRx := strconv.ParseUint(r.RxByte, 10, 64)
		tx, errTx := strconv.ParseUint(r.TxByte, 10, 64)
		v := VlanRate{Name: r.Name, Running: r.Running == "true", Disabled: r.Disabled == "true"}
		if errRx == nil && errTx == nil {
			cur := ifSample{At: at, Rx: rx, Tx: tx}
			if p, ok := prev[r.Name]; ok {
				if rxMbps, txMbps, ok := ifRate(p, cur); ok {
					v.RateOK, v.DownMbps, v.UpMbps, v.At = true, txMbps, rxMbps, at
				}
			}
			prev[r.Name] = cur
		}
		out = append(out, v)
	}
	return out
}

// runVlans: satu putaran job JobVLAN.
func (p *Poller) runVlans(ctx context.Context, w *worker, _ time.Time) (int, error) {
	t0 := p.opts.Now()
	rows, err := w.client.vlanCounters(ctx)
	t1 := p.opts.Now()
	if err != nil {
		return 0, err
	}
	if w.vlanPrev == nil {
		w.vlanPrev = make(map[string]ifSample)
	}
	// Router membaca counter di tengah permintaan; pakai titik tengahnya.
	rates := vlanRates(w.vlanPrev, rows, t0.Add(t1.Sub(t0)/2))
	p.opts.OnVlans(w.routerID, rates)
	return len(rates), nil
}
