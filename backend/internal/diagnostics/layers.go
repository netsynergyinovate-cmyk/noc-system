package diagnostics

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ---------- helper baca router ----------

func (s *runState) read(path string, q url.Values) ([]map[string]any, error) {
	if s.target.RouterID == "" || s.target.RouterStatus != "aktif" {
		return nil, fmt.Errorf("router berstatus %q, tidak dipoll", s.target.RouterStatus)
	}
	if s.routerErr != "" {
		return nil, fmt.Errorf("%s", s.routerErr)
	}
	if s.runner.reader == nil {
		return nil, fmt.Errorf("pembaca router Go belum dikonfigurasi")
	}
	if q == nil {
		q = url.Values{}
	}
	raw, err := s.runner.reader.Read(s.ctx, s.target.RouterID, path, q)
	if err != nil {
		if isRouterDown(err) {
			s.routerErr = err.Error()
		}
		return nil, err
	}
	return decodeRows(raw)
}

func (s *runState) measure(path string, body map[string]any) ([]map[string]any, error) {
	if s.target.RouterID == "" || s.runner.reader == nil {
		return nil, fmt.Errorf("pembaca router Go belum dikonfigurasi")
	}
	raw, err := s.runner.reader.Measure(s.ctx, s.target.RouterID, path, body)
	if err != nil {
		return nil, err
	}
	return decodeRows(raw)
}

func decodeRows(raw []byte) ([]map[string]any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	switch t := v.(type) {
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, x := range t {
			if m, ok := x.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out, nil
	case map[string]any:
		return []map[string]any{t}, nil
	default:
		return nil, nil
	}
}

func (s *runState) readTwice(path string, q url.Values, gap time.Duration) ([]map[string]any, []map[string]any, float64, error) {
	first, err := s.read(path, q)
	if err != nil {
		return nil, nil, 0, err
	}
	firstAt := time.Now()
	select {
	case <-s.ctx.Done():
		return nil, nil, 0, s.ctx.Err()
	case <-time.After(gap):
	}
	second, err := s.read(path, q)
	if err != nil {
		return nil, nil, 0, err
	}
	return first, second, time.Since(firstAt).Seconds(), nil
}

func mStr(m map[string]any, k string) string {
	if v, ok := m[k]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func mNum(m map[string]any, k string) (float64, bool) {
	v, ok := m[k]
	if !ok {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(t), "%"), 64)
		return f, err == nil
	}
	return 0, false
}

func mBool(m map[string]any, k string) bool {
	v := mStr(m, k)
	return v == "true" || v == "yes"
}

func pairBps(v string) (up, down float64) {
	a, b, ok := strings.Cut(v, "/")
	if !ok {
		return 0, 0
	}
	u, _ := strconv.ParseFloat(a, 64)
	d, _ := strconv.ParseFloat(b, 64)
	return u, d
}

func mbps(bps float64) float64 { return bps / 1e6 }

func (s *runState) source(label string) *string {
	at := s.now.Format("02/01/06, 15.04.05")
	return String(fmt.Sprintf("%s · %s", label, at))
}

// ---------- MikroTik ----------

// ---------- Firewall ----------


func statusIf(cond bool, s Status) Status {
	if cond {
		return s
	}
	return StatusOK
}

func ruleMatches(row map[string]any, ip string) bool {
	for _, k := range []string{"src-address", "dst-address"} {
		if addressContains(mStr(row, k), ip) {
			return true
		}
	}
	return false
}

func addressContains(entry, ip string) bool {
	entry = strings.TrimSpace(entry)
	if entry == "" || ip == "" {
		return false
	}
	if entry == ip {
		return true
	}
	if strings.Contains(entry, "/") {
		ok, err := parseCIDRContains(entry, ip)
		return ok && err == nil
	}
	if a, b, ok := strings.Cut(entry, "-"); ok {
		return ipBetween(ip, strings.TrimSpace(a), strings.TrimSpace(b))
	}
	return false
}

func parseCIDRContains(cidr, ip string) (bool, error) {
	_, n, err := netParseCIDR(cidr)
	if err != nil {
		return false, err
	}
	return n.Contains(netParseIP(ip)), nil
}

func ipBetween(ip, a, b string) bool {
	x, y, z := netParseIP(ip).To16(), netParseIP(a).To16(), netParseIP(b).To16()
	if x == nil || y == nil || z == nil {
		return false
	}
	return bytesCompare(x, y) >= 0 && bytesCompare(x, z) <= 0
}

// ---------- Hulu ----------

func (s *runState) layerHulu() []Finding {
	out := []Finding{}
	source := "Router " + s.target.RouterName
	routes, err := s.read("/rest/ip/route", url.Values{"dst-address": []string{"0.0.0.0/0"}})
	if err != nil {
		out = append(out, unchecked(LayerHulu, "default_route", "Default route & link uplink", "Route tidak terbaca: "+err.Error(), String(source)))
		return out
	}
	var route map[string]any
	for _, r := range routes {
		if mStr(r, "active") == "true" {
			route = r
			break
		}
	}
	uplink := ""
	if route == nil {
		out = append(out, Finding{
			Layer: LayerHulu, Metric: "default_route", Label: "Default route & link uplink",
			Value: String("tidak ada"), Threshold: String("1 aktif"), Comparator: String("="),
			Status: StatusFail, Detail: "Tidak ada default route aktif.", SourceRef: String(source + " · /ip/route"), SampledAt: &s.now,
		})
	} else {
		gw := mStr(route, "immediate-gw")
		parts := strings.Split(gw, "%")
		if len(parts) > 1 {
			uplink = parts[1]
		}
		out = append(out, Finding{
			Layer: LayerHulu, Metric: "default_route", Label: "Default route & link uplink",
			Value: String(uplink + ", aktif"), Threshold: String("1 aktif"), Comparator: String("="),
			Status: StatusOK, Detail: "Default route aktif lewat " + gw + ".", SourceRef: String(source + " · /ip/route"), SampledAt: &s.now,
		})
	}
	if uplink != "" {
		out = append(out, s.huluPing("upstream_gateway", "Kualitas ke hop ISP", strings.Split(mStr(route, "immediate-gw"), "%")[0])...)
		out = append(out, s.huluPing("upstream_internet", "Kualitas ke internet (8.8.8.8)", "8.8.8.8")...)
	}
	out = append(out, s.huluUplink(uplink)...)
	out = append(out, s.huluHistory()...)
	out = append(out, s.huluBGP()...)
	out = append(out, s.huluIPv6()...)
	return out
}

func (s *runState) huluPing(metric, label, address string) []Finding {
	res, err := s.measure("/rest/tool/ping", map[string]any{"address": address, "count": "5", "interval": "0.2"})
	if err != nil || len(res) == 0 {
		return []Finding{unchecked(LayerHulu, metric, label, "Ping tidak menghasilkan data.", String("Router "+s.target.RouterName))}
	}
	loss, avg, ok := pingStats(res)
	if !ok {
		return []Finding{unchecked(LayerHulu, metric, label, "Format ping tidak dikenali.", String("Router "+s.target.RouterName))}
	}
	status := StatusOK
	if loss > 5 {
		status = StatusFail
	} else if loss > 1 {
		status = StatusWarn
	}
	return []Finding{{
		Layer: LayerHulu, Metric: metric, Label: label,
		Value:     String(fmt.Sprintf("loss %.0f%%, rata-rata %.1f ms", loss, avg)),
		Threshold: String("loss < 1%"), Comparator: String("<"), Status: status,
		Detail:    "Kualitas jalur dari router ke " + address + ".",
		SourceRef: String("Router " + s.target.RouterName + " · /tool/ping " + address), SampledAt: &s.now,
	}}
}

func (s *runState) huluUplink(uplink string) []Finding {
	if uplink == "" {
		return []Finding{unchecked(LayerHulu, "uplink_util", "Utilisasi uplink", "Nama uplink tidak diketahui.", String("Router "+s.target.RouterName))}
	}
	first, second, gap, err := s.readTwice("/rest/interface", url.Values{"name": []string{uplink}}, 2*time.Second)
	if err != nil || len(first) == 0 || len(second) == 0 {
		return []Finding{unchecked(LayerHulu, "uplink_util", "Utilisasi uplink", "Interface uplink tidak terbaca.", String("Router "+s.target.RouterName))}
	}
	down := ((mNum0(second[0], "rx-byte") - mNum0(first[0], "rx-byte")) * 8) / gap
	up := ((mNum0(second[0], "tx-byte") - mNum0(first[0], "tx-byte")) * 8) / gap
	mon, _ := s.measure("/rest/interface/ethernet/monitor", map[string]any{"numbers": uplink, "once": ""})
	capacity := 0.0
	if len(mon) > 0 {
		capacity = parseRateMbps(mStr(mon[0], "rate"))
	}
	if capacity <= 0 {
		return []Finding{{
			Layer: LayerHulu, Metric: "uplink_util", Label: "Utilisasi uplink " + uplink,
			Value:     String(fmt.Sprintf("unduh %.1f Mbps, unggah %.1f Mbps", mbps(down), mbps(up))),
			Threshold: String("kapasitas tidak diketahui"), Status: StatusUnchecked,
			Detail:    "Kapasitas interface tidak terbaca dari ethernet monitor.",
			SourceRef: String("Router " + s.target.RouterName + " · /interface/ethernet/monitor"), SampledAt: &s.now,
		}}
	}
	pct := (down + up) / (capacity * 1e6) * 100
	return []Finding{{
		Layer: LayerHulu, Metric: "uplink_util", Label: "Utilisasi uplink " + uplink,
		Value:     String(fmt.Sprintf("%.1f%% (%.0f/%.0f Mbps)", pct, mbps(down+up), capacity)),
		Threshold: String("> 80%"), Comparator: String("<"), Status: statusIf(pct > 80, StatusWarn),
		Detail:    "Pemakaian uplink saat diagnosa.",
		SourceRef: String("Router " + s.target.RouterName + " · /interface"), SampledAt: &s.now,
	}}
}

func (s *runState) huluHistory() []Finding {
	var avg, peak float64
	err := s.runner.store.db.QueryRow(s.ctx, `SELECT COALESCE(avg(rx_mbps+tx_mbps),0), COALESCE(max(rx_mbps+tx_mbps),0)
		FROM traffic_samples WHERE router_id = $1::uuid AND sampled_at > now() - interval '24 hours'`,
		s.target.RouterID).Scan(&avg, &peak)
	if err != nil || peak == 0 {
		return []Finding{unchecked(LayerHulu, "uplink_history", "Uplink 24 jam", "Riwayat traffic router belum tersedia.", String("traffic_samples"))}
	}
	return []Finding{{
		Layer: LayerHulu, Metric: "uplink_history", Label: "Uplink 24 jam",
		Value:     String(fmt.Sprintf("rata-rata %.1f Mbps, puncak %.1f Mbps", avg, peak)),
		Threshold: String("kapasitas uplink"), Status: StatusOK,
		Detail: "Riwayat beban uplink 24 jam.", SourceRef: String("traffic_samples"), SampledAt: &s.now,
	}}
}

func (s *runState) huluBGP() []Finding {
	conns, err := s.read("/rest/routing/bgp/connection", nil)
	if err != nil || len(conns) == 0 {
		return []Finding{{
			Layer: LayerHulu, Metric: "bgp", Label: "Peer BGP", Value: String("tidak dipakai"),
			Status: StatusOK, Detail: "Router tidak memakai BGP atau fitur tidak aktif.",
			SourceRef: String("Router " + s.target.RouterName + " · /routing/bgp"), SampledAt: &s.now,
		}}
	}
	sessions, _ := s.read("/rest/routing/bgp/session", nil)
	notEstablished := 0
	for _, row := range sessions {
		if st := strings.ToLower(mStr(row, "state")); st != "" && st != "established" {
			notEstablished++
		}
	}
	status := StatusOK
	if notEstablished > 0 {
		status = StatusFail
	}
	return []Finding{{
		Layer: LayerHulu, Metric: "bgp", Label: "Peer BGP",
		Value:     String(fmt.Sprintf("%d sesi, %d tidak established", len(sessions), notEstablished)),
		Threshold: String("semua established"), Comparator: String("="), Status: status,
		Detail: "Status sesi BGP router.", SourceRef: String("Router " + s.target.RouterName + " · /routing/bgp"), SampledAt: &s.now,
	}}
}

func (s *runState) huluIPv6() []Finding {
	addrs, err := s.read("/rest/ipv6/address", nil)
	if err != nil {
		return []Finding{unchecked(LayerHulu, "ipv6", "IPv6 pelanggan", "IPv6 tidak terbaca.", String("Router "+s.target.RouterName))}
	}
	if len(addrs) == 0 {
		return []Finding{{
			Layer: LayerHulu, Metric: "ipv6", Label: "IPv6 pelanggan", Value: String("tidak dilayankan"),
			Status: StatusOK, Detail: "Router tidak punya alamat IPv6 global.", SourceRef: String("Router " + s.target.RouterName + " · /ipv6/address"), SampledAt: &s.now,
		}}
	}
	return []Finding{{
		Layer: LayerHulu, Metric: "ipv6", Label: "IPv6 pelanggan",
		Value: String(fmt.Sprintf("%d alamat", len(addrs))), Status: StatusOK,
		Detail: "Router memiliki alamat IPv6.", SourceRef: String("Router " + s.target.RouterName + " · /ipv6/address"), SampledAt: &s.now,
	}}
}

// ---------- Optik ----------

func (s *runState) layerOptik() []Finding {
	if s.onu == nil {
		return []Finding{unchecked(LayerOptik, "onu_rx", "Rx ONU", "Belum ada ONU yang dipetakan ke pelanggan ini.", String("OLT/ONU"))}
	}
	source := fmt.Sprintf("OLT %s · PON %d/ONU %d", s.onu.OltName, s.onu.PON, s.onu.ONU)
	age := s.now.Sub(s.onu.CapturedAt)
	if age > 10*time.Minute {
		return []Finding{unchecked(LayerOptik, "onu_rx", "Rx ONU",
			fmt.Sprintf("Sampel OLT terakhir %.0f menit lalu (batas 10 menit): OLT tidak terbaca, data basi.", age.Minutes()), String(source))}
	}
	if s.onu.Status == "los" || s.onu.Status == "offline" {
		return []Finding{{
			Layer: LayerOptik, Metric: "onu_rx", Label: "Rx ONU", Value: String(strings.ToUpper(s.onu.Status)),
			Status: StatusFail, Detail: "OLT melaporkan ONU " + s.onu.Status + ".",
			SourceRef: String(source), SampledAt: &s.onu.CapturedAt,
		}}
	}
	if s.onu.RxPower == nil {
		return []Finding{unchecked(LayerOptik, "onu_rx", "Rx ONU", "ONU online tetapi OLT tidak melaporkan Rx.", String(source))}
	}
	rx := *s.onu.RxPower
	status := StatusOK
	if rx < -27 {
		status = StatusFail
	} else if rx < -25 {
		status = StatusWarn
	}
	return []Finding{{
		Layer: LayerOptik, Metric: "onu_rx", Label: "Rx ONU",
		Value: String(fmt.Sprintf("%.2f dBm", rx)), Threshold: String("-25 s.d. -8 dBm"), Comparator: String("dalam rentang"),
		Status: status, Detail: "Daya terima optik ONU pelanggan.",
		SourceRef: String(source), SampledAt: &s.onu.CapturedAt,
	}}
}

// ---------- ONT / GenieACS (HTTP NBI) ----------

func (s *runState) layerOnt() []Finding {
	base := strings.TrimRight(os.Getenv("GENIEACS_NBI_URL"), "/")
	if base == "" {
		return []Finding{unchecked(LayerOnt, "ont_found", "Modem di GenieACS", "GENIEACS_NBI_URL belum diatur di backend Go.", String("GenieACS"))}
	}
	q := url.QueryEscape(fmt.Sprintf(`{"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username":"%s"}`, s.target.PPPoE))
	req, err := http.NewRequestWithContext(s.ctx, http.MethodGet, base+"/devices/?query="+q, nil)
	if err != nil {
		return []Finding{unchecked(LayerOnt, "ont_found", "Modem di GenieACS", "Permintaan GenieACS tidak valid.", String("GenieACS"))}
	}
	if u, p := os.Getenv("GENIEACS_NBI_USER"), os.Getenv("GENIEACS_NBI_PASSWORD"); u != "" || p != "" {
		req.SetBasicAuth(u, p)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return []Finding{unchecked(LayerOnt, "ont_found", "Modem di GenieACS", "GenieACS tidak dapat dihubungi: "+err.Error(), String("GenieACS"))}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return []Finding{unchecked(LayerOnt, "ont_found", "Modem di GenieACS", fmt.Sprintf("GenieACS menjawab HTTP %d.", res.StatusCode), String("GenieACS"))}
	}
	var devices []map[string]any
	if err := json.NewDecoder(res.Body).Decode(&devices); err != nil {
		return []Finding{unchecked(LayerOnt, "ont_found", "Modem di GenieACS", "Jawaban GenieACS bukan daftar perangkat.", String("GenieACS"))}
	}
	if len(devices) == 0 {
		return []Finding{unchecked(LayerOnt, "ont_found", "Modem di GenieACS", "Tidak ada perangkat GenieACS untuk PPPoE ini.", String("GenieACS"))}
	}
	d := devices[0]
	out := []Finding{{
		Layer: LayerOnt, Metric: "ont_found", Label: "Modem di GenieACS",
		Value: String("ditemukan"), Status: StatusOK, Detail: "Perangkat TR-069 ditemukan.",
		SourceRef: String("GenieACS NBI"), SampledAt: &s.now,
	}}
	last := parseGenieTime(mStr(d, "_lastInform"))
	if !last.IsZero() {
		age := s.now.Sub(last)
		status := StatusOK
		if age > 15*time.Minute {
			status = StatusWarn
		}
		out = append(out, Finding{
			Layer: LayerOnt, Metric: "ont_last_inform", Label: "Laporan terakhir modem",
			Value: String(fmt.Sprintf("%.0f menit lalu", age.Minutes())), Threshold: String("<= 15 menit"),
			Comparator: String("<="), Status: status,
			Detail: "Waktu laporan terakhir modem ke ACS.", SourceRef: String("GenieACS NBI"), SampledAt: &last,
		})
	}
	return out
}

func parseGenieTime(v string) time.Time {
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05.000Z", "2006-01-02T15:04:05Z"} {
		if t, err := time.Parse(layout, v); err == nil {
			return t
		}
	}
	return time.Time{}
}

// ---------- Trafik & NetFlow ----------

func (s *runState) layerTrafik() []Finding {
	out := []Finding{}
	var avg30, max30 float64
	err := s.runner.store.db.QueryRow(s.ctx, `SELECT COALESCE(avg(download_mbps_avg+upload_mbps_avg),0),
		COALESCE(max(download_mbps_max+upload_mbps_max),0)
		FROM customer_traffic_samples WHERE customer_id = $1::uuid
		AND bucket_start > now() - interval '30 minutes'`, s.target.CustomerID).Scan(&avg30, &max30)
	if err != nil || max30 == 0 {
		out = append(out, unchecked(LayerTrafik, "traffic_trend", "Tren trafik pelanggan", "Sampel trafik pelanggan belum tersedia.", String("customer_traffic_samples")))
	} else {
		var baseline float64
		_ = s.runner.store.db.QueryRow(s.ctx, `SELECT COALESCE(avg(download_mbps_avg+upload_mbps_avg),0)
			FROM customer_traffic_samples WHERE customer_id = $1::uuid
			AND bucket_start > now() - interval '7 days'
			AND date_part('hour', bucket_start AT TIME ZONE 'Asia/Jakarta') = date_part('hour', now() AT TIME ZONE 'Asia/Jakarta')`,
			s.target.CustomerID).Scan(&baseline)
		status := StatusOK
		detail := "Trafik sesuai kebiasaannya."
		if baseline > 0 && (avg30 < baseline*0.5 || avg30 > baseline*3) {
			status = StatusWarn
			detail = "Trafik menyimpang dari kebiasaan jam ini 7 hari terakhir."
		}
		out = append(out, Finding{
			Layer: LayerTrafik, Metric: "traffic_trend", Label: "Tren trafik pelanggan",
			Value:     String(fmt.Sprintf("unduh+unggah rata-rata %.1f Mbps, puncak %.1f Mbps; kebiasaan %.1f Mbps", avg30, max30, baseline)),
			Threshold: String("50%–300% kebiasaan"), Comparator: String("dalam rentang"), Status: status,
			Detail: detail, SourceRef: String("customer_traffic_samples"), SampledAt: &s.now,
		})
	}
	var flows int
	var bytes float64
	var top string
	err = s.runner.store.db.QueryRow(s.ctx, `SELECT count(*), COALESCE(sum(bytes),0),
		COALESCE((SELECT dst_ip FROM netflow_samples WHERE customer_id = $1::uuid
			AND captured_at > now() - interval '15 minutes'
			GROUP BY dst_ip ORDER BY sum(bytes) DESC LIMIT 1),'')
		FROM netflow_samples WHERE customer_id = $1::uuid AND captured_at > now() - interval '15 minutes'`,
		s.target.CustomerID).Scan(&flows, &bytes, &top)
	if err != nil || flows == 0 {
		out = append(out, unchecked(LayerTrafik, "netflow_top", "Tujuan & protokol (NetFlow)", "NetFlow pelanggan belum mengalir/tersedia.", String("netflow_samples")))
	} else {
		out = append(out, Finding{
			Layer: LayerTrafik, Metric: "netflow_top", Label: "Tujuan & protokol (NetFlow)",
			Value:  String(fmt.Sprintf("%d flow, %.1f MB, tujuan teratas %s", flows, bytes/1e6, top)),
			Status: StatusOK, Detail: "Ringkasan NetFlow 15 menit terakhir.",
			SourceRef: String("netflow_samples"), SampledAt: &s.now,
		})
	}
	return out
}

// ---------- Aktif ----------

func (s *runState) layerAktif() []Finding {
	out := []Finding{}
	ip := ""
	if s.session != nil {
		ip = mStr(s.session, "address")
	}
	if ip == "" {
		out = append(out, unchecked(LayerAktif, "ping_customer", "Ping ke pelanggan", "Pelanggan tidak memiliki alamat IP aktif (sesi PPPoE terputus).", String("Router "+s.target.RouterName)))
	} else {
		res, err := s.measure("/rest/tool/ping", map[string]any{"address": ip, "count": "10", "interval": "0.2"})
		if err != nil || len(res) == 0 {
			out = append(out, unchecked(LayerAktif, "ping_customer", "Ping ke pelanggan", "Ping tidak menghasilkan data.", String("Router "+s.target.RouterName)))
		} else {
			loss, avg, ok := pingStats(res)
			status := StatusOK
			if !ok {
				status = StatusUnchecked
			} else if loss > 5 {
				status = StatusFail
			} else if loss > 1 {
				status = StatusWarn
			}
			out = append(out, Finding{
				Layer: LayerAktif, Metric: "ping_customer", Label: "Ping ke pelanggan (" + ip + ")",
				Value:     String(fmt.Sprintf("loss %.0f%%, rata-rata %.1f ms", loss, avg)),
				Threshold: String("loss < 1%"), Comparator: String("<"), Status: status,
				Detail:    "Kualitas paket dari router ke pelanggan.",
				SourceRef: String("Router " + s.target.RouterName + " · /tool/ping " + ip), SampledAt: &s.now,
			})
		}
	}

	trace, err := s.measure("/rest/tool/traceroute", map[string]any{"address": "8.8.8.8", "count": "2"})
	if err != nil || len(trace) == 0 {
		out = append(out, unchecked(LayerAktif, "traceroute_upstream", "Traceroute ke upstream (8.8.8.8)", "Traceroute tidak menghasilkan hop.", String("Router "+s.target.RouterName)))
	} else {
		out = append(out, Finding{
			Layer: LayerAktif, Metric: "traceroute_upstream", Label: "Traceroute ke upstream (8.8.8.8)",
			Value: String(fmt.Sprintf("%d hop", len(trace))), Status: StatusOK,
			Detail:    "Jalur routing dari router ke internet.",
			SourceRef: String("Router " + s.target.RouterName + " · /tool/traceroute 8.8.8.8"), SampledAt: &s.now,
		})
	}

	dns, err := s.measure("/rest/tool/ping", map[string]any{"address": "google.com", "count": "2"})
	if err != nil || len(dns) == 0 {
		out = append(out, unchecked(LayerAktif, "dns_resolve", "Resolusi DNS (google.com)", "Resolusi DNS tidak dapat diperiksa.", String("Router "+s.target.RouterName)))
	} else if _, avg, ok := pingStats(dns); ok {
		out = append(out, Finding{
			Layer: LayerAktif, Metric: "dns_resolve", Label: "Resolusi DNS (google.com)",
			Value: String(fmt.Sprintf("terurai, rtt %.1f ms", avg)), Status: StatusOK,
			Detail: "Router berhasil mengurai nama domain.", SourceRef: String("Router " + s.target.RouterName + " · ping google.com"), SampledAt: &s.now,
		})
	}

	out = append(out, s.activeBaseline(ip)...)
	return out
}

func (s *runState) activeBaseline(ip string) []Finding {
	var p95, avg, max float64
	err := s.runner.store.db.QueryRow(s.ctx, `SELECT
		COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY download_mbps_max+upload_mbps_max),0),
		COALESCE(avg(download_mbps_avg+upload_mbps_avg),0),
		COALESCE(max(download_mbps_max+upload_mbps_max),0)
		FROM customer_traffic_samples WHERE customer_id = $1::uuid
		AND bucket_start > now() - interval '14 days'`, s.target.CustomerID).Scan(&p95, &avg, &max)
	if err != nil || p95 == 0 {
		return []Finding{unchecked(LayerAktif, "rate_baseline", "Baseline pemakaian & kapasitas paket", "Sampel 14 hari belum mencukupi.", String("customer_traffic_samples"))}
	}
	planDown := 0.0
	if s.queue != nil {
		_, planDownBps := pairBps(mStr(s.queue, "max-limit"))
		planDown = mbps(planDownBps)
	}
	status := StatusOK
	detail := "Pemakaian berada dalam batas wajar terhadap riwayat mandiri pelanggan."
	value := fmt.Sprintf("puncak %.1f Mbps, rata-rata %.1f Mbps (p95 14 hari %.1f Mbps)", max, avg, p95)
	if planDown > 0 {
		value = fmt.Sprintf("puncak %.1f Mbps (%.0f%% dari paket %.1f Mbps), rata-rata %.1f Mbps", max, max/planDown*100, planDown, avg)
		if max > planDown*0.9 {
			status = StatusWarn
			detail = "Pemakaian mendekati batas paket."
		}
	}
	return []Finding{{
		Layer: LayerAktif, Metric: "rate_baseline", Label: "Baseline pemakaian & kapasitas paket",
		Value: String(value), Threshold: String("< 90% paket"), Comparator: String("<"), Status: status,
		Detail: detail, SourceRef: String("customer_traffic_samples"), SampledAt: &s.now,
	}}
}

// ---------- Billing ----------

func (s *runState) layerBilling() []Finding {
	out := []Finding{}
	custID := strings.SplitN(s.target.PPPoE, "@", 2)[0]
	var status, billingName, syncedAt string
	err := s.runner.store.db.QueryRow(s.ctx, `SELECT status, COALESCE(billing_name,''), synced_at::text
		FROM billing_status WHERE customer_id = $1::uuid ORDER BY synced_at DESC LIMIT 1`, s.target.CustomerID).
		Scan(&status, &billingName, &syncedAt)
	billingSource := "billing_status"
	if err != nil {
		// Backend Go belum pernah menulis billing_status: pakai data RunsNet yang
		// sudah tersinkron, sama seperti halaman billing lama.
		if e := s.runner.store.db.QueryRow(s.ctx, `SELECT COALESCE(status,''), COALESCE(name,''), synced_at::text
			FROM runsnet_customers WHERE cust_id = $1 ORDER BY synced_at DESC LIMIT 1`, custID).
			Scan(&status, &billingName, &syncedAt); e == nil {
			billingSource = "runsnet_customers"
			err = nil
		}
	}
	if err != nil || strings.TrimSpace(status) == "" {
		out = append(out, unchecked(LayerBilling, "billing_status", "Status layanan di billing", "Data billing pelanggan belum tersedia.", String("billing_status")))
	} else {
		st := StatusOK
		if strings.EqualFold(status, "isolir") || strings.EqualFold(status, "inactive") || strings.EqualFold(status, "suspended") {
			st = StatusWarn
		}
		out = append(out, Finding{
			Layer: LayerBilling, Metric: "billing_status", Label: "Status layanan di billing",
			Value: String(status), Threshold: String("Active"), Comparator: String("="), Status: st,
			Detail: "Status billing: " + billingName + " (" + billingSource + ").", SourceRef: String(billingSource), SampledAt: &s.now,
		})
	}

	var invoices int
	var remaining float64
	_ = s.runner.store.db.QueryRow(s.ctx, `SELECT count(*), COALESCE(sum(remaining_amount),0)
		FROM runsnet_invoices WHERE cust_id = $1
		AND lower(COALESCE(status,'')) NOT IN ('lunas','paid','settled')
		AND COALESCE(remaining_amount,0) > 0`, custID).Scan(&invoices, &remaining)
	st := StatusOK
	if invoices > 0 {
		st = StatusWarn
	}
	out = append(out, Finding{
		Layer: LayerBilling, Metric: "arrears", Label: "Tagihan lewat jatuh tempo",
		Value:     String(fmt.Sprintf("%d tagihan, sisa %.0f", invoices, remaining)),
		Threshold: String("0 tagihan"), Comparator: String("="), Status: st,
		Detail: "Tagihan yang belum lunas di RunsNet.", SourceRef: String("runsnet_invoices"), SampledAt: &s.now,
	})

	var syncID string
	_ = s.runner.store.db.QueryRow(s.ctx, `SELECT id::text FROM billing_sync_runs
		WHERE status = 'success' ORDER BY finished_at DESC NULLS LAST LIMIT 1`).Scan(&syncID)
	if syncID == "" {
		out = append(out, unchecked(LayerBilling, "billing_mismatch", "Ketidaksesuaian sinkron billing", "Sinkron billing backend Go belum pernah berhasil.", String("billing_sync_runs")))
	} else {
		var mismatch int
		_ = s.runner.store.db.QueryRow(s.ctx, `SELECT count(*) FROM billing_mismatches
			WHERE run_id = $1::uuid AND $2::uuid = ANY(customer_ids)`, syncID, s.target.CustomerID).Scan(&mismatch)
		out = append(out, Finding{
			Layer: LayerBilling, Metric: "billing_mismatch", Label: "Ketidaksesuaian sinkron billing",
			Value: String(fmt.Sprintf("%d tagihan", mismatch)), Threshold: String("0"), Comparator: String("="),
			Status: statusIf(mismatch > 0, StatusWarn),
			Detail: "Tagihan yang bertabrakan dengan pelanggan ini.", SourceRef: String("billing_mismatches"), SampledAt: &s.now,
		})
	}

	if s.session != nil {
		ip := mStr(s.session, "address")
		lists, _ := s.read("/rest/ip/firewall/address-list", nil)
		isolir := false
		for _, row := range lists {
			if strings.Contains(strings.ToLower(mStr(row, "list")), "isolir") && addressContains(mStr(row, "address"), ip) {
				isolir = true
			}
		}
		billingIsolir := strings.EqualFold(status, "isolir")
		st := StatusOK
		detail := "Status billing dan address-list router cocok."
		if isolir != billingIsolir {
			st = StatusWarn
			detail = "Status billing dan address-list isolir router tidak cocok."
		}
		out = append(out, Finding{
			Layer: LayerBilling, Metric: "billing_network", Label: "Kecocokan billing dengan router",
			Value:  String(fmt.Sprintf("billing %s, isolir router %t", status, isolir)),
			Status: st, Detail: detail, SourceRef: String("Router " + s.target.RouterName + " · address-list"), SampledAt: &s.now,
		})
	} else {
		out = append(out, unchecked(LayerBilling, "billing_network", "Kecocokan billing dengan router", "Router tidak terbaca.", String("Router "+s.target.RouterName)))
	}
	return out
}

// ---------- Log ----------

func (s *runState) layerLog() []Finding {
	out := []Finding{}
	rows, err := s.runner.store.db.Query(s.ctx, `SELECT received_at, COALESCE(topics,''), message
		FROM syslog_events WHERE router_id = $1::uuid
		AND received_at > now() - interval '15 minutes'
		ORDER BY received_at DESC LIMIT 5000`, s.target.RouterID)
	lines := []logLine{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var at time.Time
			var topics, message string
			if rows.Scan(&at, &topics, &message) == nil {
				lines = append(lines, logLine{at, topics, message})
			}
		}
	}
	source := "syslog_events"
	if len(lines) == 0 {
		buf, err := s.read("/rest/log", nil)
		if err == nil && len(buf) > 0 {
			source = "Router " + s.target.RouterName + " · /log (buffer memori, cakupan pendek)"
			for _, row := range buf {
				lines = append(lines, logLine{s.now, mStr(row, "topics"), mStr(row, "message")})
			}
		}
	}
	if len(lines) == 0 {
		return []Finding{unchecked(LayerLog, "log_window", "Jendela log", "Tidak ada baris log dalam 15 menit terakhir.", String(source))}
	}

	flap, authFail, linkDown, conflict, firewallDrop := 0, 0, 0, 0, 0
	for _, l := range lines {
		m := strings.ToLower(l.Message)
		switch {
		case strings.Contains(m, "pppoe") && (strings.Contains(m, "logged out") || strings.Contains(m, "disconnected") || strings.Contains(m, "session terminated")):
			flap++
		case strings.Contains(m, "login failure") || strings.Contains(m, "authentication failed") || strings.Contains(m, "invalid password"):
			authFail++
		case strings.Contains(m, "link down"):
			linkDown++
		case strings.Contains(m, "address conflict") || strings.Contains(m, "duplicate address"):
			conflict++
		case strings.Contains(m, "drop") || strings.Contains(m, "denied") || strings.Contains(m, "blocked"):
			firewallDrop++
		}
	}
	out = append(out, Finding{
		Layer: LayerLog, Metric: "log_window", Label: "Jendela log",
		Value: String(fmt.Sprintf("%d baris", len(lines))), Status: StatusOK,
		Detail: "Log yang dianalisis: " + source + ".", SourceRef: String(source), SampledAt: &s.now,
	})
	out = append(out, logFinding("log_pppoe", "Flapping sesi PPPoE", flap, "sesi putus"))
	out = append(out, logFinding("log_auth", "Kegagalan autentikasi PPPoE", authFail, "kegagalan login"))
	out = append(out, logFinding("log_link", "Link down pada log", linkDown, "link down"))
	out = append(out, logFinding("log_ip", "Bentrok alamat di log", conflict, "bentrok alamat"))
	out = append(out, logFinding("log_firewall", "Aksi firewall di log", firewallDrop, "aksi firewall"))
	return out
}

type logLine struct {
	At      time.Time
	Topics  string
	Message string
}

func logFinding(metric, label string, count int, word string) Finding {
	st := StatusOK
	detail := "Tidak ada " + word + " pada log."
	if count > 0 {
		st = StatusWarn
		detail = fmt.Sprintf("%d %s pada log.", count, word)
	}
	return Finding{
		Layer: LayerLog, Metric: metric, Label: label,
		Value: String(fmt.Sprintf("%d", count)), Threshold: String("0"), Comparator: String("="),
		Status: st, Detail: detail, SourceRef: String("syslog_events"), SampledAt: timePtr(time.Now()),
	}
}

func timePtr(t time.Time) *time.Time { return &t }

// ---------- util angka/RTT ----------

func pingStats(rows []map[string]any) (loss, avgMs float64, ok bool) {
	for _, row := range rows {
		if v, found := mNum(row, "packet-loss"); found {
			loss = v
			ok = true
		}
		if v := mStr(row, "avg-rtt"); v != "" {
			if d, err := time.ParseDuration(v); err == nil {
				avgMs = float64(d.Microseconds()) / 1000
			}
		}
	}
	return
}

func parseRateMbps(v string) float64 {
	v = strings.ToLower(strings.TrimSpace(v))
	mult := 1.0
	switch {
	case strings.HasSuffix(v, "gbps"):
		mult, v = 1000, strings.TrimSuffix(v, "gbps")
	case strings.HasSuffix(v, "mbps"):
		v = strings.TrimSuffix(v, "mbps")
	case strings.HasSuffix(v, "kbps"):
		mult, v = 0.001, strings.TrimSuffix(v, "kbps")
	default:
		return 0
	}
	f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
	return f * mult
}

func sortFindings(fs []Finding) {
	sort.SliceStable(fs, func(i, j int) bool { return compareFindings(fs[i], fs[j]) })
}

func netParseIP(s string) net.IP { return net.ParseIP(strings.TrimSpace(s)) }

func netParseCIDR(s string) (net.IP, *net.IPNet, error) { return net.ParseCIDR(strings.TrimSpace(s)) }

func bytesCompare(a, b []byte) int { return bytes.Compare(a, b) }

var _ = context.Background
