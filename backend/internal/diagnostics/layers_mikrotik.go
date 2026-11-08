package diagnostics

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	queueFullPct     = 95.0
	queueDropWarnPct = 1.0
	ponCapacityMbps  = 1000.0
	ponWarnPct       = 80.0
	ponFailPct       = 95.0
)

// layerMikrotik memeriksa sisi router yang paling dekat dengan pelanggan:
// sesi PPPoE, simple queue (batas, pemakaian, drop), antarmuka PPPoE, jalur
// PON dari binding PPPoE, dan bentrok IP di ARP/DHCP.
func (s *runState) layerMikrotik() []Finding {
	source := "Router " + s.target.RouterName
	username := strings.TrimSpace(s.target.PPPoE)
	if username == "" {
		return []Finding{unchecked(LayerMikrotik, "pppoe_active", "Sesi PPPoE",
			"Data username PPPoE tidak tersedia untuk diperiksa.", String(source))}
	}

	active, err := s.read("/rest/ppp/active", nil)
	if err != nil {
		return []Finding{
			unchecked(LayerMikrotik, "pppoe_active", "Sesi PPPoE",
				"Router tidak dapat dibaca: "+err.Error(), String(source+" · /ppp/active")),
			unchecked(LayerMikrotik, "sesi_detail", "Queue, antarmuka, jalur PON, bentrok IP",
				"Router tidak terbaca.", String(source)),
		}
	}

	wanted := strings.ToLower(username)
	var session map[string]any
	for _, row := range active {
		if strings.ToLower(strings.TrimSpace(mStr(row, "name"))) == wanted {
			session = row
			break
		}
	}
	s.session = session

	out := []Finding{mikrotikPppoeFinding(s.target.RouterName, username, session, source, s.now)}
	if session == nil {
		out = append(out, unchecked(LayerMikrotik, "sesi_detail",
			"Queue, antarmuka, jalur PON, bentrok IP",
			"Sesi PPPoE tidak aktif: queue dan antarmuka dinamis pelanggan tidak ada.", String(source)))
		return out
	}

	ifaceName := strings.TrimSpace(mStr(session, "name"))
	if ifaceName == "" {
		ifaceName = username
	}
	pppIface := "<pppoe-" + ifaceName + ">"

	// Dua sampel queue: batas, pemakaian, dan persentase paket yang dibuang.
	q1, q2, qGap, qErr := s.readTwice("/rest/queue/simple",
		url.Values{"name": []string{pppIface}}, 2*time.Second)
	fasttrack := s.hasFasttrack()
	out = append(out, s.evalQueue(q1, q2, qGap, qErr, pppIface, fasttrack)...)

	// Dua sampel antarmuka PPPoE: error/drop dan waktu link terakhir naik.
	i1, i2, iGap, iErr := s.readTwice("/rest/interface",
		url.Values{"name": []string{pppIface}}, 2*time.Second)
	out = append(out, s.evalPppInterface(i1, i2, iGap, iErr, pppIface)...)

	// VLAN PON diambil dari binding PPPoE, bukan ditebak dari nama vlan1101.
	vlanName := ""
	binding, bErr := s.read("/rest/interface/pppoe-server",
		url.Values{"name": []string{pppIface}})
	if bErr == nil && len(binding) > 0 {
		vlanName = strings.TrimSpace(mStr(binding[0], "interface"))
	}
	out = append(out, s.evalPon(vlanName, source)...)

	ip := strings.TrimSpace(mStr(session, "address"))
	out = append(out, s.evalIPConflict(ip, pppIface, source)...)
	return out
}

func mikrotikPppoeFinding(routerName, username string, session map[string]any, source string, now time.Time) Finding {
	base := Finding{
		Layer: LayerMikrotik, Metric: "pppoe_active", Label: "Sesi PPPoE",
		Threshold: String("aktif"), Comparator: String("="),
		SourceRef: String(source + " · /ppp/active"), SampledAt: &now,
	}
	if session == nil {
		base.Value = String("tidak aktif")
		base.Status = StatusFail
		base.Detail = fmt.Sprintf("Tidak ada sesi %s di /ppp/active router %s.", username, routerName)
		return base
	}
	base.Value = String("aktif")
	base.Status = StatusOK
	base.Detail = fmt.Sprintf("IP %s, uptime %s, caller-id %s.",
		orDash(mStr(session, "address")), orDash(mStr(session, "uptime")), orDash(mStr(session, "caller-id")))
	return base
}

func (s *runState) evalQueue(first, second []map[string]any, gap float64, readErr error, iface string, fasttrack bool) []Finding {
	source := "Router " + s.target.RouterName + " · /queue/simple " + iface
	if readErr != nil {
		return []Finding{unchecked(LayerMikrotik, "queue_limit", "Simple queue pelanggan",
			"Gagal membaca /queue/simple: "+readErr.Error(), String(source))}
	}

	queue := findQueue(first, s.target.PPPoE)
	if queue == nil {
		return []Finding{{
			Layer: LayerMikrotik, Metric: "queue_limit", Label: "Simple queue pelanggan",
			Value: String("tidak ada"), Threshold: String("ada"), Comparator: String("="),
			Status:    StatusWarn,
			Detail:    "Tidak ada simple queue untuk sesi ini: batas kecepatan tidak terpasang di router ini.",
			SourceRef: String(source), SampledAt: &s.now,
		}}
	}
	s.queue = queue

	limUp, limDown := pairBps(mStr(queue, "max-limit"))
	disabled := mStr(queue, "disabled") == "true"
	limit := Finding{
		Layer: LayerMikrotik, Metric: "queue_limit", Label: "Batas kecepatan (unggah/unduh)",
		Value:     String(fmt.Sprintf("%.1f/%.1f Mbps", mbps(limUp), mbps(limDown))),
		Threshold: String("aktif"), Comparator: String("="),
		Status:    statusIf(!disabled, StatusOK), // disabled -> warn
		Detail:    "Queue dinamis dari profil PPP/RADIUS.",
		SourceRef: String(source), SampledAt: &s.now,
	}
	if disabled {
		limit.Status = StatusWarn
		limit.Detail = "Queue nonaktif: batas kecepatan tidak berlaku."
	} else if mStr(queue, "dynamic") != "true" {
		limit.Detail = "Queue statis."
	}

	latest := queue
	if q := findQueue(second, s.target.PPPoE); q != nil {
		latest = q
	}
	rateUp, rateDown := pairBps(mStr(latest, "rate"))

	var usage Finding
	if limUp <= 0 || limDown <= 0 {
		usage = unchecked(LayerMikrotik, "queue_usage", "Pemakaian terhadap batas",
			"max-limit 0 (tanpa batas): persentase tidak bisa dihitung.", String(source))
	} else {
		pUp := rateUp / limUp * 100
		pDown := rateDown / limDown * 100
		worst := max(pUp, pDown)
		status := StatusOK
		detail := "Masih di bawah batas paket."
		if worst >= queueFullPct {
			status = StatusWarn
			detail = "Pemakaian menyentuh batas paket: terasa lambat karena kecepatan paket habis, bukan gangguan jaringan."
		}
		if fasttrack && status == StatusOK {
			status = StatusWarn
			detail = "Fasttrack aktif: batas ini TIDAK dieksekusi untuk koneksi yang di-fasttrack. " + detail
		}
		usage = Finding{
			Layer: LayerMikrotik, Metric: "queue_usage", Label: "Pemakaian terhadap batas",
			Value: String(fmt.Sprintf("unduh %.1f Mbps (%.0f%%), unggah %.1f Mbps (%.0f%%)",
				mbps(rateDown), pDown, mbps(rateUp), pUp)),
			Threshold: String(fmt.Sprintf("%.0f%%", queueFullPct)), Comparator: String("<"),
			Status: status, Detail: detail, SourceRef: String(source), SampledAt: &s.now,
		}
	}
	if fasttrack && limit.Status == StatusOK {
		limit.Status = StatusWarn
		limit.Detail += " Fasttrack aktif: batas queue tidak berlaku untuk koneksi fasttrack."
	}

	if second == nil || len(second) == 0 {
		return []Finding{limit, usage}
	}

	dUp, dDown := pairDelta(first, second, "dropped")
	pUp, pDown := pairDelta(first, second, "packets")
	if dUp < 0 || dDown < 0 || pUp < 0 || pDown < 0 {
		return []Finding{limit, usage, unchecked(LayerMikrotik, "queue_drop", "Paket dibuang antrean",
			"Penghitung queue kembali ke nol di antara dua sampel (sesi tersambung ulang).", String(source))}
	}
	lossPct := func(drop, passed float64) float64 {
		if drop+passed <= 0 {
			return 0
		}
		return drop / (drop + passed) * 100
	}
	lUp, lDown := lossPct(dUp, pUp), lossPct(dDown, pDown)
	lossy := max(lUp, lDown) >= queueDropWarnPct
	drop := Finding{
		Layer: LayerMikrotik, Metric: "queue_drop", Label: "Paket dibuang antrean",
		Value: String(fmt.Sprintf("unduh %.0f dari %.0f (%.1f%%), unggah %.0f dari %.0f (%.1f%%) dalam %.1f dtk",
			dDown, dDown+pDown, lDown, dUp, dUp+pUp, lUp, gap)),
		Threshold: String(fmt.Sprintf("%.0f%%", queueDropWarnPct)), Comparator: String("<"),
		Status: StatusOK, Detail: "Kehilangan paket di antrean di bawah ambang.",
		SourceRef: String(source), SampledAt: &s.now,
	}
	if lossy {
		drop.Status = StatusWarn
		drop.Detail = fmt.Sprintf("Antrean membuang paket (jenis queue %s): ledakan trafik melebihi batas paket atau buffer antrean terlalu kecil; terasa sebagai lambat/putus-putus.", orDash(mStr(queue, "queue")))
	}
	return []Finding{limit, usage, drop}
}

func (s *runState) evalPppInterface(first, second []map[string]any, gap float64, readErr error, iface string) []Finding {
	source := "Router " + s.target.RouterName + " · /interface " + iface
	if readErr != nil || len(first) == 0 || len(second) == 0 || gap <= 0 {
		return []Finding{unchecked(LayerMikrotik, "iface_errors", "Error & drop antarmuka PPPoE",
			"Antarmuka <pppoe-…> tidak terbaca pada kedua sampel.", String(source))}
	}
	d := func(m map[string]any, k string) float64 { return mNum0(m, k) }
	errors := (d(second[0], "rx-error") + d(second[0], "tx-error")) - (d(first[0], "rx-error") + d(first[0], "tx-error"))
	drops := (d(second[0], "rx-drop") + d(second[0], "tx-drop")) - (d(first[0], "rx-drop") + d(first[0], "tx-drop"))
	if errors < 0 || drops < 0 {
		return []Finding{unchecked(LayerMikrotik, "iface_errors", "Error & drop antarmuka PPPoE",
			"Penghitung antarmuka kembali ke nol di antara dua sampel (sesi tersambung ulang).", String(source))}
	}
	status := StatusOK
	detail := "Bersih selama sampel."
	if errors+drops > 0 {
		status = StatusWarn
		detail = "Antarmuka sesi mencatat error/drop."
	}
	return []Finding{{
		Layer: LayerMikrotik, Metric: "iface_errors", Label: "Error & drop antarmuka PPPoE",
		Value:     String(fmt.Sprintf("error %.0f, drop %.0f dalam %.1f dtk", errors, drops, gap)),
		Threshold: String("0"), Comparator: String("="), Status: status,
		Detail:    fmt.Sprintf("%s Tersambung sejak %s.", detail, orDash(mStr(second[0], "last-link-up-time"))),
		SourceRef: String(source), SampledAt: &s.now,
	}}
}

func (s *runState) evalPon(vlanName, routerSource string) []Finding {
	label := "Laju jalur PON"
	if vlanName != "" {
		label += " " + vlanName
	}
	source := "Router " + s.target.RouterName + " · /interface " + orDash(vlanName)
	if vlanName == "" {
		return []Finding{unchecked(LayerMikrotik, "pon_vlan_rate", label,
			"Binding PPPoE server tidak menyebut antarmuka asal sesi.", String(routerSource))}
	}
	first, second, gap, err := s.readTwice("/rest/interface",
		url.Values{"name": []string{vlanName}}, 2*time.Second)
	if err != nil || len(first) == 0 || len(second) == 0 || gap <= 0 {
		return []Finding{unchecked(LayerMikrotik, "pon_vlan_rate", label,
			fmt.Sprintf("Antarmuka %s tidak terbaca pada kedua sampel.", vlanName), String(source))}
	}
	down := ((mNum0(second[0], "tx-byte") - mNum0(first[0], "tx-byte")) * 8) / gap
	up := ((mNum0(second[0], "rx-byte") - mNum0(first[0], "rx-byte")) * 8) / gap
	if down < 0 || up < 0 {
		return []Finding{unchecked(LayerMikrotik, "pon_vlan_rate", label,
			"Penghitung antarmuka kembali ke nol di antara dua sampel.", String(source))}
	}
	used := max(down, up) / (ponCapacityMbps * 1e6) * 100
	status := StatusOK
	detail := "Jalur PON bersama masih longgar."
	if used >= ponFailPct {
		status = StatusFail
		detail = "Jalur PON bersama hampir penuh: lambat bisa karena berbagi jalur."
	} else if used >= ponWarnPct {
		status = StatusWarn
		detail = "Jalur PON yang dipakai bersama pelanggan satu port hampir penuh: lambat bisa karena berbagi jalur."
	}
	return []Finding{{
		Layer: LayerMikrotik, Metric: "pon_vlan_rate", Label: label,
		Value: String(fmt.Sprintf("unduh %.1f Mbps, unggah %.1f Mbps (%.0f%% dari %.0f Mbps)",
			mbps(down), mbps(up), used, ponCapacityMbps)),
		Threshold: String(fmt.Sprintf("%.0f%%", ponWarnPct)), Comparator: String("<"),
		Status: status, Detail: detail, SourceRef: String(source), SampledAt: &s.now,
	}}
}

func (s *runState) evalIPConflict(ip, pppIface, routerSource string) []Finding {
	source := "Router " + s.target.RouterName + " · /ip/arp, /ip/dhcp-server/lease"
	if strings.TrimSpace(ip) == "" {
		return []Finding{unchecked(LayerMikrotik, "ip_conflict", "Bentrok alamat (ARP/DHCP)",
			"Sesi tidak punya alamat IP.", String(routerSource))}
	}
	arp, aErr := s.read("/rest/ip/arp", url.Values{"address": []string{ip}})
	lease, lErr := s.read("/rest/ip/dhcp-server/lease", url.Values{"address": []string{ip}})
	if aErr != nil || lErr != nil {
		return []Finding{unchecked(LayerMikrotik, "ip_conflict", "Bentrok alamat (ARP/DHCP)",
			"Gagal membaca ARP/DHCP.", String(source))}
	}

	var others []string
	for _, row := range arp {
		if mStr(row, "address") != ip {
			continue
		}
		// Entri ARP pada antarmuka PPPoE pelanggan sendiri bukan bentrok.
		if mStr(row, "interface") == pppIface || strings.Contains(mStr(row, "interface"), "pppoe") {
			continue
		}
		others = append(others, fmt.Sprintf("ARP di %s MAC %s", orDash(mStr(row, "interface")), orDash(mStr(row, "mac-address"))))
	}
	for _, row := range lease {
		if mStr(row, "address") != ip {
			continue
		}
		others = append(others, fmt.Sprintf("lease DHCP %s MAC %s", orDash(mStr(row, "server")), orDash(mStr(row, "mac-address"))))
	}

	status := StatusOK
	detail := fmt.Sprintf("Tidak ada entri ARP/DHCP lain untuk IP %s.", ip)
	value := "tidak ada"
	if len(others) > 0 {
		status = StatusWarn
		value = fmt.Sprintf("%d entri", len(others))
		detail = fmt.Sprintf("IP %s juga dipakai perangkat lain: %s.", ip, strings.Join(others, "; "))
	}
	return []Finding{{
		Layer: LayerMikrotik, Metric: "ip_conflict", Label: "Bentrok alamat (ARP/DHCP)",
		Value: String(value), Threshold: String("0 entri"), Comparator: String("="),
		Status: status, Detail: detail, SourceRef: String(source), SampledAt: &s.now,
	}}
}

func (s *runState) loadFilterRules() ([]map[string]any, error) {
	if s.filterLoaded {
		return s.filterRules, nil
	}
	rows, err := s.read("/rest/ip/firewall/filter", nil)
	if err != nil {
		return nil, err
	}
	s.filterRules = rows
	s.filterLoaded = true
	return rows, nil
}

// hasFasttrack membaca aturan filter sekali dan mengingat hasilnya untuk
// lapisan MikroTik dan Firewall.
func (s *runState) hasFasttrack() bool {
	if s.fasttrack != nil {
		return *s.fasttrack
	}
	rows, err := s.loadFilterRules()
	if err != nil {
		return false
	}
	v := false
	for _, row := range rows {
		if strings.EqualFold(mStr(row, "action"), "fasttrack-connection") && !mBool(row, "disabled") {
			v = true
			break
		}
	}
	s.fasttrack = &v
	return v
}

func findQueue(rows []map[string]any, pppoe string) map[string]any {
	want := strings.ToLower(strings.TrimSpace(pppoe))
	for _, row := range rows {
		name := strings.ToLower(strings.TrimSpace(mStr(row, "name")))
		if name == want || name == "<pppoe-"+want+">" {
			return row
		}
	}
	return nil
}

func mNum0(m map[string]any, k string) float64 {
	v, _ := mNum(m, k)
	return v
}

func pairDelta(first, second []map[string]any, key string) (up, down float64) {
	if len(first) == 0 || len(second) == 0 {
		return 0, 0
	}
	u1, d1 := pairBps(mStr(first[0], key))
	u2, d2 := pairBps(mStr(second[0], key))
	return u2 - u1, d2 - d1
}

func orDash(v string) string {
	if strings.TrimSpace(v) == "" {
		return "—"
	}
	return v
}
