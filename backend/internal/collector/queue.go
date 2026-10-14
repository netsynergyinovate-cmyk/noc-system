package collector

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// queueProplist adalah kolom yang diminta ke router. Meminta kolom tertentu saja
// membuat jawaban jauh lebih kecil daripada seluruh data queue.
const queueProplist = "name,rate,max-limit,parent,disabled"

// QueueSample adalah laju satu simple queue pada saat diambil, dalam bit per
// detik. Up adalah traffic dari pelanggan ke jaringan (upload pelanggan), Down
// adalah traffic ke pelanggan (download pelanggan); urutan "upload/download"
// ini sama dengan properti queue RouterOS.
type QueueSample struct {
	Name     string
	Parent   string
	Disabled bool
	UpBps    uint64
	DownBps  uint64
	UpMax    uint64
	DownMax  uint64
}

// TopLevel benar bila queue ini bukan anak queue lain. Menjumlahkan induk dan
// anaknya sekaligus akan menghitung traffic yang sama dua kali.
func (s QueueSample) TopLevel() bool {
	return s.Parent == "" || s.Parent == "none"
}

// Queues mengambil seluruh simple queue dalam satu permintaan.
func (c *Client) Queues(ctx context.Context) ([]QueueSample, error) {
	body, err := c.get(ctx, queueProplist, "queue", "simple")
	if err != nil {
		return nil, err
	}
	return parseQueues(body)
}

type rawQueue struct {
	Name     string `json:"name"`
	Rate     string `json:"rate"`
	MaxLimit string `json:"max-limit"`
	Parent   string `json:"parent"`
	Disabled string `json:"disabled"`
}

// parseQueues membaca jawaban RouterOS: array objek dengan semua nilai berupa
// string. Baris yang laju atau namanya tidak terbaca dilewati, tidak membuat
// seluruh polling gagal: satu queue yang aneh tidak boleh menghentikan traffic
// seluruh router.
func parseQueues(body []byte) ([]QueueSample, error) {
	var rows []rawQueue
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("jawaban router bukan daftar queue yang valid: %w", err)
	}
	samples := make([]QueueSample, 0, len(rows))
	for _, row := range rows {
		up, down, ok := parseRate(row.Rate)
		if !ok {
			continue
		}
		upMax, downMax, _ := parseRate(row.MaxLimit)
		samples = append(samples, QueueSample{
			Name:     row.Name,
			Parent:   row.Parent,
			Disabled: row.Disabled == "true",
			UpBps:    up,
			DownBps:  down,
			UpMax:    upMax,
			DownMax:  downMax,
		})
	}
	return samples, nil
}

// parseRate membaca "upload/download" dalam bit per detik, mis. "1500000/8200000".
func parseRate(s string) (up, down uint64, ok bool) {
	left, right, found := strings.Cut(s, "/")
	if !found {
		return 0, 0, false
	}
	up, err := strconv.ParseUint(left, 10, 64)
	if err != nil {
		return 0, 0, false
	}
	down, err = strconv.ParseUint(right, 10, 64)
	if err != nil {
		return 0, 0, false
	}
	return up, down, true
}

// Totals menjumlahkan laju semua queue aktif tingkat atas dalam Mbps. Download
// adalah traffic ke pelanggan (Rx di dashboard), upload dari pelanggan (Tx).
// counted adalah jumlah queue yang ikut dihitung.
func Totals(samples []QueueSample) (downMbps, upMbps float64, counted int) {
	var down, up uint64
	for _, s := range samples {
		if s.Disabled || !s.TopLevel() {
			continue
		}
		down += s.DownBps
		up += s.UpBps
		counted++
	}
	return float64(down) / 1e6, float64(up) / 1e6, counted
}
