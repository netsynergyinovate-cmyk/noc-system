package collector

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Laju interface dari counter byte (/interface rx-byte, tx-byte), seperti yang ditampilkan Winbox.
//
// Mengapa bukan jumlah `rate` simple queue: `rate` queue dihaluskan RouterOS sehingga tertinggal
// sekitar 3 detik dari laju sebenarnya (diukur terhadap counter interface yang sama), dan hanya
// mencakup pelanggan yang punya queue (tanpa overhead PPPoE dan trafik non-queue). Counter byte
// dibaca tiap detik, laju = selisih / selang waktu, jadi sama dengan Winbox dan tanpa jeda.

const ifProplist = "name,rx-byte,tx-byte,comment"

// IfCounters adalah counter byte kumulatif satu interface.
type IfCounters struct {
	Name    string
	Comment string
	RxBytes uint64
	TxBytes uint64
}

type rawIf struct {
	Name    string `json:"name"`
	Comment string `json:"comment"`
	RxByte  string `json:"rx-byte"`
	TxByte  string `json:"tx-byte"`
}

func parseIfCounters(body []byte) ([]IfCounters, error) {
	var rows []rawIf
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("jawaban /interface bukan daftar yang valid: %w", err)
	}
	out := make([]IfCounters, 0, len(rows))
	for _, r := range rows {
		if r.Name == "" {
			continue
		}
		rx, errRx := strconv.ParseUint(r.RxByte, 10, 64)
		tx, errTx := strconv.ParseUint(r.TxByte, 10, 64)
		out = append(out, IfCounters{Name: r.Name, Comment: r.Comment, RxBytes: rx, TxBytes: tx})
		if errRx != nil || errTx != nil {
			out[len(out)-1].RxBytes, out[len(out)-1].TxBytes = 0, 0 // tanpa counter: tidak bisa dipakai
		}
	}
	return out, nil
}

// InterfaceCounters membaca counter satu interface menurut namanya.
func (c *Client) InterfaceCounters(ctx context.Context, name string) (IfCounters, error) {
	body, err := c.getQuery(ctx, ifProplist, url.Values{"name": {name}}, "interface")
	if err != nil {
		return IfCounters{}, err
	}
	rows, err := parseIfCounters(body)
	if err != nil {
		return IfCounters{}, err
	}
	for _, r := range rows {
		if r.Name == name {
			return r, nil
		}
	}
	return IfCounters{}, fmt.Errorf("interface %q tidak ada di router", name)
}

// FindInterfaceByComment mencari TEPAT satu interface dengan komentar itu (tanpa membedakan
// huruf besar/kecil). Nama kosong bila tidak ada atau ambigu: lebih baik tidak menebak.
func (c *Client) FindInterfaceByComment(ctx context.Context, comment string) (string, error) {
	body, err := c.get(ctx, ifProplist, "interface")
	if err != nil {
		return "", err
	}
	rows, err := parseIfCounters(body)
	if err != nil {
		return "", err
	}
	return pickByComment(rows, comment), nil
}

func pickByComment(rows []IfCounters, comment string) string {
	found := ""
	for _, r := range rows {
		if strings.EqualFold(strings.TrimSpace(r.Comment), comment) {
			if found != "" {
				return ""
			}
			found = r.Name
		}
	}
	return found
}

// ifSample adalah satu pembacaan counter beserta saatnya.
type ifSample struct {
	At time.Time
	Rx uint64
	Tx uint64
}

// maxIfGap: selang antar pembacaan yang lebih lama dari ini tidak dipakai (laju rata-rata
// selama lubang bukan laju "saat ini").
const maxIfGap = 15 * time.Second

// ifRate menghitung laju dalam Mbps dari dua pembacaan. ok=false bila selangnya tidak masuk akal
// atau counter turun (router restart / interface dibuat ulang).
func ifRate(prev, cur ifSample) (rxMbps, txMbps float64, ok bool) {
	dt := cur.At.Sub(prev.At)
	if dt <= 0 || dt > maxIfGap || cur.Rx < prev.Rx || cur.Tx < prev.Tx {
		return 0, 0, false
	}
	sec := dt.Seconds()
	return float64(cur.Rx-prev.Rx) * 8 / sec / 1e6, float64(cur.Tx-prev.Tx) * 8 / sec / 1e6, true
}
