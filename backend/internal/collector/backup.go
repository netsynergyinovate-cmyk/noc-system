package collector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"noc-isp/backend/internal/state"
)

// Kolom yang diminta ke router untuk jalur cadangan.
const (
	pppActiveProplist = "name,service,address,uptime"
	resourceProplist  = "cpu-load,free-memory,total-memory,uptime,version,board-name"
	interfaceProplist = "name,type,running,disabled,rx-error,tx-error,rx-drop,tx-drop"
)

// PPPSession adalah satu sesi PPP yang sedang aktif di router.
type PPPSession struct {
	Name    string
	Service string // pppoe, pptp, l2tp, ...
	Address string // IP sesi; dipakai NetFlow untuk mengenali pelanggan
	Uptime  string // waktu aktif sesi di router MikroTik
}

// PPPActive mengambil daftar sesi PPP aktif (/ppp/active).
func (c *Client) PPPActive(ctx context.Context) ([]PPPSession, error) {
	body, err := c.get(ctx, pppActiveProplist, "ppp", "active")
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Name    string `json:"name"`
		Service string `json:"service"`
		Address string `json:"address"`
		Uptime  string `json:"uptime"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("jawaban /ppp/active bukan daftar yang valid: %w", err)
	}
	sessions := make([]PPPSession, 0, len(rows))
	for _, row := range rows {
		sessions = append(sessions, PPPSession{Name: row.Name, Service: row.Service, Address: row.Address, Uptime: row.Uptime})
	}
	return sessions, nil
}

// Resource mengambil kondisi perangkat (/system/resource). Berbeda dari daftar
// lain, jawabannya satu objek, bukan array.
func (c *Client) Resource(ctx context.Context) (state.Resource, error) {
	body, err := c.get(ctx, resourceProplist, "system", "resource")
	if err != nil {
		return state.Resource{}, err
	}
	var raw struct {
		CPULoad     string `json:"cpu-load"`
		FreeMemory  string `json:"free-memory"`
		TotalMemory string `json:"total-memory"`
		Uptime      string `json:"uptime"`
		Version     string `json:"version"`
		Board       string `json:"board-name"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return state.Resource{}, fmt.Errorf("jawaban /system/resource bukan objek yang valid: %w", err)
	}
	cpu, err := strconv.Atoi(raw.CPULoad)
	if err != nil || cpu < 0 || cpu > 100 {
		return state.Resource{}, errors.New("jawaban /system/resource tidak memuat cpu-load yang valid")
	}
	total, err := strconv.ParseUint(raw.TotalMemory, 10, 64)
	if err != nil || total == 0 {
		return state.Resource{}, errors.New("jawaban /system/resource tidak memuat total-memory yang valid")
	}
	// Bagian yang tidak terbaca dibiarkan nol; hanya CPU dan memori yang dipakai
	// aturan, jadi uptime atau versi yang aneh tidak boleh menggagalkan polling.
	free, _ := strconv.ParseUint(raw.FreeMemory, 10, 64)
	return state.Resource{
		CPULoad:     cpu,
		FreeMemory:  min(free, total),
		TotalMemory: total,
		Uptime:      parseUptime(raw.Uptime),
		Version:     raw.Version,
		Board:       raw.Board,
	}, nil
}

// Interfaces mengambil daftar interface beserta penghitung error dan drop
// (/interface).
func (c *Client) Interfaces(ctx context.Context) ([]state.Interface, error) {
	body, err := c.get(ctx, interfaceProplist, "interface")
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Name     string `json:"name"`
		Type     string `json:"type"`
		Running  string `json:"running"`
		Disabled string `json:"disabled"`
		RxError  string `json:"rx-error"`
		TxError  string `json:"tx-error"`
		RxDrop   string `json:"rx-drop"`
		TxDrop   string `json:"tx-drop"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("jawaban /interface bukan daftar yang valid: %w", err)
	}
	interfaces := make([]state.Interface, 0, len(rows))
	for _, row := range rows {
		if row.Name == "" {
			continue
		}
		interfaces = append(interfaces, state.Interface{
			Name:     row.Name,
			Type:     row.Type,
			Running:  row.Running == "true",
			Disabled: row.Disabled == "true",
			RxError:  counter(row.RxError),
			TxError:  counter(row.TxError),
			RxDrop:   counter(row.RxDrop),
			TxDrop:   counter(row.TxDrop),
		})
	}
	return interfaces, nil
}

// counter membaca penghitung RouterOS; yang tidak terbaca dianggap nol.
func counter(s string) uint64 {
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

var uptimePart = regexp.MustCompile(`(\d+)([wdhms])`)

// parseUptime membaca durasi gaya RouterOS seperti "1w2d3h4m5s". Teks yang tidak
// dikenali menghasilkan 0.
func parseUptime(s string) time.Duration {
	units := map[string]time.Duration{
		"w": 7 * 24 * time.Hour, "d": 24 * time.Hour, "h": time.Hour, "m": time.Minute, "s": time.Second,
	}
	var total time.Duration
	for _, part := range uptimePart.FindAllStringSubmatch(s, -1) {
		n, err := strconv.ParseInt(part[1], 10, 64)
		if err != nil || n > 1<<20 {
			return 0
		}
		total += time.Duration(n) * units[part[2]]
	}
	return total
}

// reconcileResult merangkum satu rekonsiliasi.
type reconcileResult struct {
	Checked int // pelanggan milik router yang diperiksa
	Flipped int // yang statusnya diubah
	Skipped int // beda dengan router tetapi statusnya berubah setelah data diambil
}

// reconcilePresence menyamakan status pelanggan satu router dengan daftar sesi
// PPPoE aktif dari router itu. Ini jaring pengaman bila webhook dan syslog
// terlewat.
//
// observedAt adalah saat permintaan dikirim. Pelanggan yang statusnya berubah
// setelah itu (mis. webhook "up" tiba selagi daftar sedang diambil) dilewati:
// daftar itu mungkin belum memuat perubahan tersebut, dan menimpanya akan
// membalikkan status yang benar.
func reconcilePresence(p Presence, notify func(state.Change), routerID string, sessions []PPPSession, observedAt time.Time) reconcileResult {
	active := make(map[string]struct{}, len(sessions))
	for _, s := range sessions {
		// Sesi VPN (pptp, l2tp, ...) bukan pelanggan PPPoE.
		if s.Service == "" || strings.EqualFold(s.Service, "pppoe") {
			active[s.Name] = struct{}{}
		}
	}

	var result reconcileResult
	for _, c := range p.Customers() {
		if c.RouterID != routerID {
			continue
		}
		result.Checked++
		_, shouldBeOnline := active[c.PPPoEUsername]
		if c.IsOnline == shouldBeOnline {
			continue
		}
		if c.StatusSince.After(observedAt) {
			result.Skipped++
			continue
		}
		change, err := p.SetOnline(c.PPPoEUsername, shouldBeOnline)
		if err != nil {
			continue // pelanggan dihapus di sela pemeriksaan
		}
		if change.Changed() {
			result.Flipped++
			if notify != nil {
				notify(change)
			}
		}
	}
	return result
}

// PPPActiveAddress mengembalikan alamat IP sesi PPP aktif bernama name
// (/ppp/active), atau ok=false bila pelanggan itu sedang tidak terhubung di
// router ini. Nama dicocokkan persis dulu; bila tidak ada, tanpa membedakan
// huruf besar/kecil asal hanya SATU sesi yang cocok (tidak pernah menebak).
func (c *Client) PPPActiveAddress(ctx context.Context, name string) (addr string, ok bool, err error) {
	body, err := c.get(ctx, "name,address", "ppp", "active")
	if err != nil {
		return "", false, err
	}
	var rows []struct {
		Name    string `json:"name"`
		Address string `json:"address"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return "", false, fmt.Errorf("jawaban /ppp/active bukan daftar yang valid: %w", err)
	}
	var folded []string
	for _, r := range rows {
		if r.Address == "" {
			continue
		}
		if r.Name == name {
			return r.Address, true, nil
		}
		if strings.EqualFold(r.Name, name) {
			folded = append(folded, r.Address)
		}
	}
	if len(folded) == 1 {
		return folded[0], true, nil
	}
	return "", false, nil
}

// macValue mengubah "D0:5F:AF:D3:C7:1F" (atau dengan "-") menjadi angka; ok=false bila bukan MAC.
func macValue(s string) (v uint64, ok bool) {
	s = strings.NewReplacer(":", "", "-", "").Replace(strings.TrimSpace(s))
	if len(s) != 12 {
		return 0, false
	}
	n, err := strconv.ParseUint(s, 16, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// PPPActiveByMAC mencari sesi PPP aktif yang caller-id-nya (MAC WAN modem) berdekatan
// dengan mac (MAC ONU di OLT). Modem memakai blok alamat berurutan: ONU di OLT
// D0:5F:AF:D3:C7:1D, LAN ...1E, WAN (yang dilihat router sebagai caller-id) ...1F.
// Cocok bila lima oktet pertama sama dan selisih terakhir 1..maxDelta. Tidak pernah
// menebak: lebih dari satu kandidat dianggap tidak ditemukan.
func (c *Client) PPPActiveByMAC(ctx context.Context, mac string, maxDelta uint64) (addr string, ok bool, err error) {
	want, valid := macValue(mac)
	if !valid {
		return "", false, nil
	}
	body, err := c.get(ctx, "name,address,caller-id", "ppp", "active")
	if err != nil {
		return "", false, err
	}
	var rows []struct {
		Address  string `json:"address"`
		CallerID string `json:"caller-id"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return "", false, fmt.Errorf("jawaban /ppp/active bukan daftar yang valid: %w", err)
	}
	var found []string
	for _, r := range rows {
		got, valid := macValue(r.CallerID)
		if !valid || r.Address == "" || got>>8 != want>>8 {
			continue
		}
		if d := got - want; got > want && d >= 1 && d <= maxDelta {
			found = append(found, r.Address)
		}
	}
	if len(found) != 1 {
		return "", false, nil
	}
	return found[0], true, nil
}
