package diagnostics

import (
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const conntrackWarnPct = 75.0
const conntrackFailPct = 90.0
const customerConnWarn = 3000

var privateNets = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"}

var blockActions = map[string]bool{"drop": true, "reject": true, "tarpit": true}

var fateActions = map[string]bool{
	"drop": true, "reject": true, "tarpit": true, "fasttrack-connection": true,
	"notrack": true, "masquerade": true, "src-nat": true, "dst-nat": true,
	"redirect": true, "netmap": true, "mark-connection": true, "mark-packet": true,
	"mark-routing": true,
}

var opaqueSelectors = []string{
	"in-interface-list", "out-interface-list", "src-mac-address", "connection-mark",
	"packet-mark", "routing-mark", "layer7-protocol", "content", "hotspot",
	"ipsec-policy", "in-bridge-port", "out-bridge-port", "src-address-type",
	"dst-address-type", "per-connection-classifier", "tls-host",
}

var summaryKeys = []string{
	"src-address", "src-address-list", "in-interface", "dst-address",
	"dst-address-list", "out-interface", "protocol", "dst-port", "src-port",
	"connection-state", "in-interface-list", "out-interface-list", "src-mac-address",
	"connection-mark", "packet-mark", "routing-mark", "layer7-protocol", "content",
	"hotspot", "ipsec-policy", "in-bridge-port", "out-bridge-port",
	"src-address-type", "dst-address-type", "per-connection-classifier", "tls-host",
	"to-addresses", "to-ports", "new-connection-mark", "new-packet-mark",
}

var blockedListPattern = regexp.MustCompile(`(?i)(isolir|block|blokir|drop|deny|reject|banned)`)

type firewallTarget struct {
	ip      string
	iface   string
	lists   []string
	listSet map[string]bool
}

func (s *runState) layerFirewall() []Finding {
	source := "Router " + s.target.RouterName
	out := []Finding{}

	ip := ""
	if s.session != nil {
		ip = strings.TrimSpace(mStr(s.session, "address"))
	}

	// 1. Keanggotaan address-list pelanggan.
	addressRows, aErr := s.read("/rest/ip/firewall/address-list", nil)
	lists := []string{}
	if aErr == nil {
		seen := map[string]bool{}
		for _, row := range addressRows {
			if mStr(row, "disabled") == "true" || !addressContains(mStr(row, "address"), ip) {
				continue
			}
			name := mStr(row, "list")
			if name != "" && !seen[name] {
				seen[name] = true
				lists = append(lists, name)
			}
		}
	}
	if ip == "" {
		out = append(out, unchecked(LayerFirewall, "address_list", "Address-list yang memuat IP pelanggan",
			"Sesi PPPoE tidak aktif: IP pelanggan tidak diketahui.", String(source)))
	} else if aErr != nil {
		out = append(out, unchecked(LayerFirewall, "address_list", "Address-list yang memuat IP pelanggan",
			"Gagal membaca address-list: "+aErr.Error(), String(source+" · /ip/firewall/address-list")))
	} else {
		out = append(out, firewallAddressListFinding(ip, lists, source, s.now))
	}

	// 2. Connection tracking router.
	trackingRows, tErr := s.read("/rest/ip/firewall/connection/tracking", nil)
	var tracking map[string]any
	if tErr == nil && len(trackingRows) > 0 {
		tracking = trackingRows[0]
		out = append(out, firewallConntrackFinding(tracking, source, s.now))
	} else {
		out = append(out, unchecked(LayerFirewall, "conntrack", "Tabel connection tracking",
			"Gagal membaca connection tracking.", String(source+" · /ip/firewall/connection/tracking")))
	}

	if ip == "" {
		out = append(out, unchecked(LayerFirewall, "audit", "Audit rule firewall & NAT",
			"Sesi PPPoE tidak aktif: IP pelanggan tidak diketahui, rule tidak bisa dicocokkan.", String(source)))
		return out
	}

	// 3. Semua tabel firewall + koneksi pelanggan.
	tables := map[string][]map[string]any{}
	tableErr := ""
	for _, table := range []string{"raw", "filter", "mangle", "nat"} {
		var rows []map[string]any
		var err error
		if table == "filter" {
			rows, err = s.loadFilterRules()
		} else {
			rows, err = s.read("/rest/ip/firewall/"+table, nil)
		}
		if err != nil {
			tableErr = table + ": " + err.Error()
			continue
		}
		tables[table] = rows
	}
	connOut, oErr := s.read("/rest/ip/firewall/connection", url.Values{
		"src-address": []string{ip},
		".proplist":   []string{"fasttrack,connection-mark,protocol"},
	})
	connIn, iErr := s.read("/rest/ip/firewall/connection", url.Values{
		"dst-address": []string{ip},
		".proplist":   []string{"fasttrack,connection-mark,protocol"},
	})
	connections := append(connOut, connIn...)
	if len(tables) == 0 || oErr != nil || iErr != nil {
		reason := tableErr
		if oErr != nil || iErr != nil {
			reason = "Gagal membaca koneksi pelanggan di connection tracking."
		}
		out = append(out, unchecked(LayerFirewall, "audit", "Audit rule firewall & NAT",
			reason, String(source+" · /ip/firewall/{filter,raw,nat,mangle}")))
		return out
	}

	target := firewallTarget{ip: ip, iface: "<pppoe-" + mStr(s.session, "name") + ">", lists: lists, listSet: map[string]bool{}}
	if strings.TrimSpace(mStr(s.session, "name")) == "" {
		target.iface = "<pppoe-" + s.target.PPPoE + ">"
	}
	for _, l := range lists {
		target.listSet[l] = true
	}

	hits := auditFirewallRules(tables, target)
	fasttrack := firewallFasttrackFinding(hits, connections, source, s.now)
	filterBlock := firewallFilterBlockFinding(hits, source, s.now)
	raw := firewallRawFinding(hits, source, s.now)
	natSrc := firewallSrcNatFinding(hits, ip, source, s.now)
	natDst := firewallPortForwardFinding(hits, tables["nat"], ip, source, s.now)
	mangle := firewallMangleFinding(hits, s.queue, connections, source, s.now)
	customerConns := firewallCustomerConnectionsFinding(connOut, connIn, tracking, source, s.now)
	stale := firewallStaleFinding(hits, source, s.now)

	out = append(out, fasttrack, filterBlock, raw, natSrc, natDst, mangle, customerConns, stale)

	// Simpan potret agar tabel rule di UI terisi dan bisa dibandingkan.
	rawDrop := false
	for _, h := range hits {
		if h.Table == "raw" && !h.Disabled && (h.Action == "drop" || h.Action == "reject") {
			rawDrop = true
			break
		}
	}
	var total, maxEntries *int
	if tracking != nil {
		if v, ok := mNum(tracking, "total-entries"); ok {
			n := int(v)
			total = &n
		}
		if v, ok := mNum(tracking, "max-entries"); ok {
			n := int(v)
			maxEntries = &n
		}
	}
	snapshot := FirewallSnapshotInput{
		RunID: s.runID, RouterID: s.target.RouterID, CustomerID: s.target.CustomerID,
		CustomerIP: ip, TakenAt: s.now, Fasttrack: fasttrack.Status == StatusFail,
		ConntrackCount: len(connections), ConntrackTotal: total, ConntrackMax: maxEntries,
		RawDrop: rawDrop, AddressLists: lists, Hits: hits,
	}
	if err := s.runner.store.SaveFirewallSnapshot(s.ctx, snapshot); err != nil && s.runner.logger != nil {
		s.runner.logger.Warn("diagnosa: simpan potret firewall gagal", "run", s.runID, "error", err)
	}
	return out
}

func firewallAddressListFinding(ip string, lists []string, source string, now time.Time) Finding {
	blocked := []string{}
	for _, l := range lists {
		if blockedListPattern.MatchString(l) {
			blocked = append(blocked, l)
		}
	}
	status := StatusOK
	detail := fmt.Sprintf("IP %s tidak masuk daftar isolir/blokir.", ip)
	if len(blocked) > 0 {
		status = StatusFail
		detail = fmt.Sprintf("IP %s masuk %s: trafik pelanggan dibatasi firewall walau sesi tampak online.", ip, strings.Join(blocked, ", "))
	}
	value := "tidak ada"
	if len(lists) > 0 {
		value = strings.Join(lists, ", ")
	}
	return Finding{
		Layer: LayerFirewall, Metric: "address_list", Label: "Address-list yang memuat IP pelanggan",
		Value: String(value), Threshold: String("bukan daftar isolir/blokir"), Comparator: String("="),
		Status: status, Detail: detail, SourceRef: String(source + " · /ip/firewall/address-list"), SampledAt: &now,
	}
}

func firewallConntrackFinding(t map[string]any, source string, now time.Time) Finding {
	total, _ := mNum(t, "total-entries")
	maxEntries, _ := mNum(t, "max-entries")
	if maxEntries <= 0 {
		return unchecked(LayerFirewall, "conntrack", "Tabel connection tracking",
			"Router tidak melaporkan max-entries.", String(source+" · /ip/firewall/connection/tracking"))
	}
	used := total / maxEntries * 100
	status := StatusOK
	detail := "Tabel masih longgar."
	if used >= conntrackFailPct {
		status = StatusFail
		detail = "Tabel hampir penuh: koneksi baru bisa gagal acak."
	} else if used >= conntrackWarnPct {
		status = StatusWarn
		detail = "Tabel hampir penuh: koneksi baru bisa gagal acak (kadang jalan, kadang tidak)."
	}
	return Finding{
		Layer: LayerFirewall, Metric: "conntrack", Label: "Tabel connection tracking",
		Value:     String(fmt.Sprintf("%.0f dari %.0f (%.0f%%)", total, maxEntries, used)),
		Threshold: String(fmt.Sprintf("%.0f%%", conntrackWarnPct)), Comparator: String("<"),
		Status: status, Detail: detail, SourceRef: String(source + " · /ip/firewall/connection/tracking"), SampledAt: &now,
	}
}

func auditFirewallRules(tables map[string][]map[string]any, t firewallTarget) []FirewallRuleHit {
	var out []FirewallRuleHit
	for _, table := range []string{"raw", "filter", "mangle", "nat"} {
		for index, rule := range tables[table] {
			if mStr(rule, "dynamic") == "true" {
				continue
			}
			scope := firewallRuleScope(rule, t)
			if scope == "" {
				continue
			}
			action := mStr(rule, "action")
			if scope != "khusus" && !fateActions[action] {
				continue
			}
			packets, _ := strconv.ParseInt(strings.TrimSpace(mStr(rule, "packets")), 10, 64)
			bytesValue, _ := strconv.ParseInt(strings.TrimSpace(mStr(rule, "bytes")), 10, 64)
			var parts []string
			for _, k := range summaryKeys {
				if v := mStr(rule, k); v != "" {
					parts = append(parts, k+"="+v)
				}
			}
			ruleID := mStr(rule, ".id")
			if ruleID == "" {
				ruleID = mStr(rule, "id")
			}
			disabled := mStr(rule, "disabled") == "true"
			out = append(out, FirewallRuleHit{
				Table: table, Chain: mStr(rule, "chain"), RuleID: ruleID, Action: action,
				Scope: scope, Index: index, Disabled: disabled, Packets: packets,
				Bytes: bytesValue, Comment: mStr(rule, "comment"), Summary: strings.Join(parts, " "),
				Stale: !disabled && scope == "khusus" && packets == 0,
			})
		}
	}
	return out
}

func firewallRuleScope(rule map[string]any, t firewallTarget) string {
	action := mStr(rule, "action")
	if (action == "dst-nat" || action == "netmap") && addressContains(mStr(rule, "to-addresses"), t.ip) {
		return "khusus"
	}
	chain := mStr(rule, "chain")
	sides := []string{"src", "dst"}
	switch chain {
	case "input", "srcnat", "dstnat":
		sides = []string{"src"}
	case "output":
		sides = []string{"dst"}
	}
	results := make([]string, 0, len(sides))
	for _, side := range sides {
		result := firewallSideMatch(rule, side, t)
		peer := mStr(rule, "dst-address")
		if side == "dst" {
			peer = mStr(rule, "src-address")
		}
		if result == "neutral" && peer != "" && !strings.HasPrefix(peer, "!") && firewallPrivatePeer(peer) {
			result = "excl"
		}
		results = append(results, result)
	}
	for _, r := range results {
		if r == "spec" {
			return "khusus"
		}
	}
	for _, r := range results {
		if r == "neutral" {
			for _, k := range opaqueSelectors {
				if mStr(rule, k) != "" {
					return "mungkin"
				}
			}
			return "umum"
		}
	}
	return ""
}

func firewallSideMatch(rule map[string]any, side string, t firewallTarget) string {
	spec := false
	type check struct {
		key  string
		test func(string) bool
	}
	checks := []check{
		{side + "-address", func(v string) bool { return addressContains(v, t.ip) }},
		{side + "-address-list", func(v string) bool { return t.listSet[v] }},
	}
	if side == "src" {
		checks = append(checks, check{"in-interface", func(v string) bool { return v == t.iface }})
	} else {
		checks = append(checks, check{"out-interface", func(v string) bool { return v == t.iface }})
	}
	for _, c := range checks {
		raw := mStr(rule, c.key)
		if raw == "" {
			continue
		}
		neg := strings.HasPrefix(raw, "!")
		value := strings.TrimPrefix(raw, "!")
		if c.test(value) == neg {
			return "excl"
		}
		if !neg {
			spec = true
		}
	}
	if spec {
		return "spec"
	}
	return "neutral"
}

func firewallPrivatePeer(peer string) bool {
	ip := strings.Split(peer, "/")[0]
	for _, n := range privateNets {
		if addressContains(n, ip) {
			return true
		}
	}
	return false
}

func firewallFilterBlockFinding(hits []FirewallRuleHit, source string, now time.Time) Finding {
	var own, firing, general, shadowed []FirewallRuleHit
	for _, h := range hits {
		if h.Table != "filter" || h.Disabled || !blockActions[h.Action] {
			continue
		}
		if h.Scope == "khusus" {
			own = append(own, h)
			if h.Packets > 0 {
				firing = append(firing, h)
			}
			for _, a := range hits {
				if a.Table == "filter" && !a.Disabled && a.Scope == "khusus" && a.Action == "accept" && a.Chain == h.Chain && a.Index < h.Index {
					shadowed = append(shadowed, h)
					break
				}
			}
		} else {
			general = append(general, h)
		}
	}
	status := StatusOK
	if len(firing) > 0 {
		status = StatusFail
	} else if len(own) > 0 {
		status = StatusWarn
	}
	parts := []string{}
	if len(firing) > 0 {
		parts = append(parts, "Memblokir dan sedang kena: "+firewallRuleNames(firing)+".")
	}
	var standby []FirewallRuleHit
	for _, h := range own {
		if h.Packets == 0 {
			standby = append(standby, h)
		}
	}
	if len(standby) > 0 {
		parts = append(parts, "Siaga (belum pernah kena): "+firewallRuleNames(standby)+".")
	}
	if len(shadowed) > 0 {
		parts = append(parts, "Tertutup accept di atasnya: "+firewallRuleNames(shadowed)+".")
	}
	if len(general) > 0 {
		parts = append(parts, "Kebijakan umum yang juga berlaku: "+firewallRuleNames(general)+".")
	}
	detail := strings.Join(parts, " ")
	if detail == "" {
		detail = "Tidak ada rule filter drop/reject yang mengenai pelanggan."
	}
	return Finding{
		Layer: LayerFirewall, Metric: "filter_block", Label: "Rule filter yang memblokir pelanggan",
		Value:     String(fmt.Sprintf("%d khusus (%d sedang kena), %d umum", len(own), len(firing), len(general))),
		Threshold: String("0 rule khusus yang kena"), Comparator: String("="),
		Status: status, Detail: detail, SourceRef: String(source + " · /ip/firewall/filter"), SampledAt: &now,
	}
}

func firewallRawFinding(hits []FirewallRuleHit, source string, now time.Time) Finding {
	var drops, notrack []FirewallRuleHit
	for _, h := range hits {
		if h.Table != "raw" || h.Disabled {
			continue
		}
		if blockActions[h.Action] && h.Scope == "khusus" {
			drops = append(drops, h)
		}
		if h.Action == "notrack" {
			notrack = append(notrack, h)
		}
	}
	status := StatusOK
	if firewallAnyPackets(drops) {
		status = StatusFail
	} else if len(drops) > 0 || len(notrack) > 0 {
		status = StatusWarn
	}
	detail := "Tidak ada rule raw yang mengenai pelanggan."
	if len(drops) > 0 || len(notrack) > 0 {
		var parts []string
		if len(drops) > 0 {
			parts = append(parts, "Raw drop (sebelum connection tracking, tidak tampak di monitoring): "+firewallRuleNames(drops)+".")
		}
		if len(notrack) > 0 {
			parts = append(parts, "Notrack: koneksi tidak dilacak sehingga NAT tidak berlaku: "+firewallRuleNames(notrack)+".")
		}
		detail = strings.Join(parts, " ")
	}
	return Finding{
		Layer: LayerFirewall, Metric: "raw", Label: "Rule raw (drop & notrack)",
		Value:     String(fmt.Sprintf("%d drop, %d notrack", len(drops), len(notrack))),
		Threshold: String("0"), Comparator: String("="), Status: status, Detail: detail,
		SourceRef: String(source + " · /ip/firewall/raw"), SampledAt: &now,
	}
}

func firewallSrcNatFinding(hits []FirewallRuleHit, ip, source string, now time.Time) Finding {
	var nat []FirewallRuleHit
	for _, h := range hits {
		if h.Table == "nat" && h.Chain == "srcnat" && !h.Disabled && (h.Action == "masquerade" || h.Action == "src-nat") {
			nat = append(nat, h)
		}
	}
	private := firewallPrivatePeer(ip)
	status := StatusOK
	detail := fmt.Sprintf("IP %s publik; tidak perlu NAT.", ip)
	value := "tidak ada"
	if len(nat) > 0 {
		value = firewallRuleNames(nat[:1]) + fmt.Sprintf(", hit %d", nat[0].Packets)
		detail = fmt.Sprintf("%d rule NAT keluar mengenai pelanggan; yang pertama cocok yang berlaku.", len(nat))
	} else if private {
		status = StatusFail
		detail = fmt.Sprintf("IP %s privat tetapi tidak ada masquerade/src-nat yang mengenainya: trafik ke internet tidak di-NAT.", ip)
	}
	return Finding{
		Layer: LayerFirewall, Metric: "nat_src", Label: "NAT keluar (masquerade/src-nat)",
		Value: String(value), Threshold: String("ada untuk IP privat"), Comparator: String("="),
		Status: status, Detail: detail, SourceRef: String(source + " · /ip/firewall/nat"), SampledAt: &now,
	}
}

func firewallPortForwardFinding(hits []FirewallRuleHit, natRules []map[string]any, ip, source string, now time.Time) Finding {
	var forwards, redirects []FirewallRuleHit
	for _, h := range hits {
		if h.Table != "nat" || h.Chain != "dstnat" || h.Disabled {
			continue
		}
		if (h.Action == "dst-nat" || h.Action == "netmap") && h.Scope == "khusus" {
			forwards = append(forwards, h)
		}
		if h.Action == "redirect" && h.Scope == "khusus" {
			redirects = append(redirects, h)
		}
	}
	clashes := []string{}
	for _, f := range forwards {
		if f.Index >= len(natRules) {
			continue
		}
		mine := natRules[f.Index]
		for i, other := range natRules {
			if i == f.Index || mStr(other, "disabled") == "true" || mStr(other, "chain") != "dstnat" {
				continue
			}
			action := mStr(other, "action")
			if action != "dst-nat" && action != "netmap" && action != "redirect" {
				continue
			}
			if firewallPortsOverlap(mStr(other, "dst-port"), mStr(mine, "dst-port")) &&
				mStr(other, "protocol") == mStr(mine, "protocol") &&
				(mStr(other, "dst-address") == mStr(mine, "dst-address") ||
					mStr(other, "dst-address") == "" || mStr(mine, "dst-address") == "") {
				lo, hi := i, f.Index
				if lo > hi {
					lo, hi = hi, lo
				}
				clashes = append(clashes, fmt.Sprintf("#%d menutupi #%d (port %s)", lo, hi, orDash(mStr(mine, "dst-port"))))
			}
		}
	}
	status := StatusOK
	if len(clashes) > 0 {
		status = StatusWarn
	}
	detail := fmt.Sprintf("Tidak ada port forward ke %s.", ip)
	if len(forwards) > 0 {
		detail = fmt.Sprintf("Port forward ke %s: %s.", ip, firewallRuleNames(forwards))
	}
	if len(clashes) > 0 {
		detail += " Tabrakan port forward: " + strings.Join(clashes, ", ") + "; hanya rule teratas yang berlaku."
	}
	if len(redirects) > 0 {
		detail += " Redirect yang mengenai pelanggan: " + firewallRuleNames(redirects) + "."
	}
	return Finding{
		Layer: LayerFirewall, Metric: "nat_dst", Label: "Port forward & redirect ke pelanggan",
		Value:     String(fmt.Sprintf("%d port forward, %d redirect", len(forwards), len(redirects))),
		Threshold: String("tanpa tabrakan"), Comparator: String("="), Status: status, Detail: detail,
		SourceRef: String(source + " · /ip/firewall/nat"), SampledAt: &now,
	}
}

func firewallFasttrackFinding(hits []FirewallRuleHit, connections []map[string]any, source string, now time.Time) Finding {
	var rules []FirewallRuleHit
	for _, h := range hits {
		if h.Table == "filter" && !h.Disabled && h.Action == "fasttrack-connection" {
			rules = append(rules, h)
		}
	}
	fast := 0
	for _, c := range connections {
		if mStr(c, "fasttrack") == "true" {
			fast++
		}
	}
	on := len(rules) > 0 || fast > 0
	status := StatusOK
	detail := "Tidak ada fasttrack; simple queue berlaku untuk semua koneksi pelanggan."
	if on {
		status = StatusFail
		detail = "Koneksi yang di-fasttrack melewati simple queue, jadi batas kecepatan paket tidak dieksekusi walau terpasang."
		if len(rules) > 0 {
			detail += " Rule: " + firewallRuleNames(rules) + "."
		}
	}
	return Finding{
		Layer: LayerFirewall, Metric: "fasttrack", Label: "Fasttrack (melewati simple queue)",
		Value:     String(fmt.Sprintf("%d rule, %d dari %d koneksi di-fasttrack", len(rules), fast, len(connections))),
		Threshold: String("0"), Comparator: String("="), Status: status, Detail: detail,
		SourceRef: String(source + " · /ip/firewall/filter, /ip/firewall/connection"), SampledAt: &now,
	}
}

func firewallCustomerConnectionsFinding(outbound, inbound []map[string]any, tracking map[string]any, source string, now time.Time) Finding {
	if tracking != nil && strings.EqualFold(mStr(tracking, "enabled"), "no") {
		return Finding{
			Layer: LayerFirewall, Metric: "conntrack_customer", Label: "Koneksi pelanggan di connection tracking",
			Value: String("tracking mati"), Threshold: String("aktif"), Comparator: String("="),
			Status: StatusFail, Detail: "Connection tracking dimatikan: NAT dan rule berbasis state tidak berjalan.",
			SourceRef: String(source + " · /ip/firewall/connection"), SampledAt: &now,
		}
	}
	total := len(outbound) + len(inbound)
	status := StatusOK
	detail := "Jumlah koneksi wajar."
	if total >= customerConnWarn {
		status = StatusWarn
		detail = "Koneksi sangat banyak: P2P/torrent, perangkat terinfeksi, atau aplikasi bocor; bisa menghabiskan kecepatan paket dan tabel router."
	}
	return Finding{
		Layer: LayerFirewall, Metric: "conntrack_customer", Label: "Koneksi pelanggan di connection tracking",
		Value:     String(fmt.Sprintf("%d koneksi (%d keluar, %d masuk)", total, len(outbound), len(inbound))),
		Threshold: String(strconv.Itoa(customerConnWarn)), Comparator: String("<"),
		Status: status, Detail: detail, SourceRef: String(source + " · /ip/firewall/connection"), SampledAt: &now,
	}
}

func firewallMangleFinding(hits []FirewallRuleHit, queue map[string]any, connections []map[string]any, source string, now time.Time) Finding {
	var marks []FirewallRuleHit
	for _, h := range hits {
		if h.Table == "mangle" && !h.Disabled && strings.HasPrefix(h.Action, "mark-") {
			marks = append(marks, h)
		}
	}
	var needed []string
	if queue != nil {
		for _, m := range strings.Split(mStr(queue, "packet-marks"), ",") {
			if m = strings.TrimSpace(m); m != "" {
				needed = append(needed, m)
			}
		}
	}
	produced := map[string]bool{}
	for _, h := range marks {
		for _, part := range strings.Fields(h.Summary) {
			if strings.HasPrefix(part, "new-packet-mark=") {
				produced[strings.TrimPrefix(part, "new-packet-mark=")] = true
			}
		}
	}
	var missing []string
	for _, m := range needed {
		if !produced[m] {
			missing = append(missing, m)
		}
	}
	status := StatusOK
	detail := "Queue tidak bergantung pada mark."
	if len(missing) > 0 {
		status = StatusFail
		detail = fmt.Sprintf("Queue pelanggan hanya mengenai paket bertanda %s, tetapi tidak ada mangle aktif yang memasang tanda itu untuk pelanggan ini: batas kecepatan tidak mengenai trafiknya.", strings.Join(missing, ", "))
	} else if len(needed) > 0 {
		detail = "Mark yang dipakai queue dipasang mangle."
	}
	if len(marks) > 0 {
		detail += " Rule mark: " + firewallRuleNames(marks) + "."
	}
	var connMarks []string
	seen := map[string]bool{}
	for _, c := range connections {
		if m := mStr(c, "connection-mark"); m != "" && !seen[m] {
			seen[m] = true
			connMarks = append(connMarks, m)
		}
	}
	if len(connMarks) > 0 {
		detail += " Connection-mark pada koneksi pelanggan: " + strings.Join(connMarks, ", ") + "."
	}
	value := fmt.Sprintf("%d rule mark; queue memakai %s", len(marks), "semua paket (tanpa mark)")
	if len(needed) > 0 {
		value = fmt.Sprintf("%d rule mark; queue memakai %s", len(marks), strings.Join(needed, ", "))
	}
	return Finding{
		Layer: LayerFirewall, Metric: "mangle", Label: "Mangle & mark untuk queue",
		Value: String(value), Threshold: String("mark queue dipasang mangle"), Comparator: String("="),
		Status: status, Detail: detail, SourceRef: String(source + " · /ip/firewall/mangle"), SampledAt: &now,
	}
}

func firewallStaleFinding(hits []FirewallRuleHit, source string, now time.Time) Finding {
	var stale []FirewallRuleHit
	for _, h := range hits {
		if h.Stale {
			stale = append(stale, h)
		}
	}
	detail := "Semua rule khusus yang aktif pernah kena."
	if len(stale) > 0 {
		detail = fmt.Sprintf("Menyebut pelanggan ini tetapi hit-count nol (syarat tidak pernah terpenuhi atau salah tulis): %s.", firewallRuleNames(stale))
	}
	return Finding{
		Layer: LayerFirewall, Metric: "rule_stale", Label: "Rule khusus yang tidak pernah kena",
		Value: String(fmt.Sprintf("%d rule", len(stale))), Status: StatusOK, Detail: detail,
		SourceRef: String(source + " · /ip/firewall/{filter,raw,nat,mangle}"), SampledAt: &now,
	}
}

func firewallAnyPackets(hits []FirewallRuleHit) bool {
	for _, h := range hits {
		if h.Packets > 0 {
			return true
		}
	}
	return false
}

func firewallRuleNames(hits []FirewallRuleHit) string {
	names := make([]string, 0, len(hits))
	for _, h := range hits {
		comment := ""
		if h.Comment != "" {
			comment = fmt.Sprintf(" \"%s\"", h.Comment)
		}
		summary := ""
		if h.Summary != "" {
			summary = fmt.Sprintf(" (%s)", h.Summary)
		}
		names = append(names, fmt.Sprintf("%s %s #%d %s%s%s hit %d", h.Table, h.Chain, h.Index, h.Action, comment, summary, h.Packets))
	}
	return strings.Join(names, "; ")
}

func firewallPortsOverlap(a, b string) bool {
	as := firewallPortSet(a)
	bs := firewallPortSet(b)
	for p := range as {
		if bs[p] {
			return true
		}
	}
	return false
}

func firewallPortSet(v string) map[string]bool {
	set := map[string]bool{}
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			set[p] = true
		}
	}
	return set
}
