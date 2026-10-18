package ontweb

// WAN ZL-2113X. Modem hanya melapor ke ACS lewat WAN yang layanannya memuat TR069; tanpa itu
// halaman status menjawab "Unreported (No remote management WAN connection)". Mengubah layanan
// WAN berarti mengirim SELURUH formulir WAN (±115 field, banyak penanda status), dan satu salah
// isi bisa memutus internet pelanggan. Karena itu:
//
//   - isi formulir dibentuk dari data JSON modem persis seperti yang dilakukan halaman asli, dan
//     dibuktikan sama byte demi byte dengan isi yang DIKIRIM halaman asli untuk 12 modem nyata
//     (testdata/zl2113x/wan-*.json; permintaan asli dibatalkan, tidak pernah sampai ke modem);
//   - gerbang di planZLWAN menolak bentuk apa pun yang belum pernah teramati (WAN lebih dari
//     satu, bukan PPPoE/Route/IPv4, VLAN bertag, kunci JSON tak dikenal, dst.): lebih baik minta
//     petugas mengubah manual daripada menebak.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type zlWAN map[string]string

const zlWANJSONPath = "/cgi-bin/get_node_foreach_info.json?param1=waninfo_wanif&param2=NULL"

func parseZLWAN(raw []byte) (zlWAN, error) {
	var any map[string]any
	if err := json.Unmarshal(raw, &any); err != nil {
		return nil, fmt.Errorf("%w: data WAN bukan JSON", ErrUnexpected)
	}
	out := zlWAN{}
	for k, v := range any {
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("%w: data WAN memuat nilai bukan teks (%s)", ErrNotSupportedConfig, k)
		}
		out[k] = s
	}
	return out, nil
}

// zlKnown: setiap kunci JSON yang pernah teramati; nilai-nilainya (kalau ada) yang diizinkan.
// nil = nilai bebas (tetapi dipakai/diperiksa terpisah). Kunci di luar tabel ini = ditolak.
var zlKnown = map[string][]string{
	"Active": {"Yes"}, "BandActive": {"N/A"}, "BindStatus": nil, "BridgeInterface": {"No"},
	"BridgeMode": {"IP_Bridged"}, "CONNECTION": {"", "Connect_Keep_Alive"}, "DHCPEnable": {"1"},
	"DHCPRealy": {"Yes"}, "DHCPv6": {"No"}, "DsliteAddr": {""}, "DsliteEnable": {"No"}, "DsliteMode": {"1"},
	"EntryName": {"1_INTERNET_R_VID_,"}, "EntryNum": {"1"}, "IFIdxArray": {"1,"}, "IFIdxStore": {"1"},
	"IGMPproxy": {"No"}, "IPVERSION": {"IPv4"}, "ISP": {"2"}, "LAN1": {"Yes", "No"}, "LAN2": {"Yes", "No"},
	"LAN3": {"Yes", "No"}, "LAN4": {"Yes", "No"}, "LinkMode": {"linkPPP"}, "MTU": {"1492"},
	"ManualDnsMode": {"No"}, "MulticastVID": {""}, "NATENABLE": {"Enable"},
	"Option60Enable1": {""}, "Option60Enable2": {""}, "Option60Enable3": {""}, "Option60Enable4": {""},
	"Option60Type1": {""}, "Option60Type2": {""}, "Option60Type3": {""}, "Option60Type4": {""},
	"Option60Value1": {""}, "Option60Value2": {""}, "Option60Value3": {""}, "Option60Value4": {""},
	"Option60ValueMode1": {""}, "Option60ValueMode2": {""}, "Option60ValueMode3": {""}, "Option60ValueMode4": {""},
	"PASSWORD": nil, "PDEnable": {"No"}, "PDOrigin": {"None"}, "PPPBiArray": {"No,"},
	"PPPManualStatus": {"disconnect"}, "SRVNAME": {""}, "SSID1": {"Yes", "No"}, "SSID2": {"No"},
	"SSID3": {"No"}, "SSID4": {"No"}, "ServiceList": nil, "USERNAME": nil,
	"VLANMode": {"UNTAG", "TRANSPARENT"}, "ValidIFIndex": nil, "WanMode": {"Route"},
}

// zlRequired: kunci yang harus ada agar isi formulir bisa dibentuk dengan pasti.
var zlRequired = []string{
	"Active", "CONNECTION", "DHCPEnable", "EntryNum", "IFIdxArray", "ISP", "LAN1", "LAN2", "LAN3", "LAN4",
	"LinkMode", "MTU", "NATENABLE", "PASSWORD", "PPPManualStatus", "SSID1", "SSID2", "SSID3", "SSID4",
	"ServiceList", "USERNAME", "VLANMode", "ValidIFIndex", "WanMode",
}

var zlIdx = regexp.MustCompile(`^\d{1,3},$`)

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// zlServiceWithTR069 memetakan layanan sekarang ke padanan yang membawa TR-069. Hanya INTERNET
// (satu-satunya yang teramati).
func zlServiceWithTR069(current string) (string, bool) {
	if current == "INTERNET" {
		return "TR069_INTERNET", true
	}
	return "", false
}

// planZLWAN mengembalikan isi formulir WAN untuk mengganti layanan WAN ke yang membawa TR-069.
// (nil, "", nil) = tidak ada yang perlu diubah (sudah ada TR069).
func planZLWAN(j zlWAN) (rows [][2]string, service string, err error) {
	if strings.Contains(j["ServiceList"], "TR069") {
		return nil, "", nil
	}
	for k, v := range j {
		allowed, known := zlKnown[k]
		if !known {
			return nil, "", fmt.Errorf("%w: data WAN memuat kunci tak dikenal (%s)", ErrNotSupportedConfig, k)
		}
		if allowed != nil && !contains(allowed, v) {
			return nil, "", fmt.Errorf("%w: %s=%q belum pernah terverifikasi", ErrNotSupportedConfig, k, v)
		}
	}
	for _, k := range zlRequired {
		if _, ok := j[k]; !ok {
			return nil, "", fmt.Errorf("%w: data WAN tanpa %s", ErrNotSupportedConfig, k)
		}
	}
	svc, ok := zlServiceWithTR069(j["ServiceList"])
	if !ok {
		return nil, "", fmt.Errorf("%w: layanan WAN %q belum didukung", ErrNotSupportedConfig, j["ServiceList"])
	}
	if !zlIdx.MatchString(j["ValidIFIndex"]) || !zlIdx.MatchString(j["IFIdxArray"]) {
		return nil, "", fmt.Errorf("%w: indeks WAN tidak dikenali", ErrNotSupportedConfig)
	}
	if j["USERNAME"] == "" || j["USERNAME"] == "N/A" || j["PASSWORD"] == "" || j["PASSWORD"] == "N/A" {
		// Kata sandi PPPoE harus dikirim ulang; tanpa itu WAN akan rusak.
		return nil, "", fmt.Errorf("%w: akun PPPoE tidak terbaca dari modem", ErrNotSupportedConfig)
	}
	idx := strings.TrimSuffix(j["ValidIFIndex"], ",")
	ifIdx := strings.TrimSuffix(j["IFIdxArray"], ",")

	add := func(k, v string) { rows = append(rows, [2]string{k, v}) }
	yes := func(k string) bool { return j[k] == "Yes" }

	add("curSetIndex", idx)
	add("WanActive", j["Active"])
	add("WanCurrIFIdx", ifIdx)
	add("wanId", idx)
	add("Wan_Flag", "1")
	add("EnCAPFlag", "PPPoE LLC")
	add("PPPGetIpFlag", "Dynamic")
	add("ConnectionFlag", j["CONNECTION"])
	add("Enable_Flag", "Yes")
	add("Disable_Flag", "No")
	add("afterdeleteFlag", "0")
	add("OperatorStyle", "Modify")
	add("dhcpv6pdflag", "Yes")
	add("WanNode", "Wan")
	add("pppManualStatus_Flag", j["PPPManualStatus"])
	add("cb_enblService", "on")
	add("enblService", "")
	add("wanMode", j["WanMode"])
	add("serviceList", svc)
	add("bindflag", "N/A")
	for _, n := range []string{"1", "2", "3", "4"} {
		if yes("LAN" + n) {
			add("cb_bindlan"+n, "on")
		}
		add("bindlan"+n, j["LAN"+n])
	}
	for _, n := range []string{"1", "2", "3", "4"} {
		if yes("SSID" + n) {
			add("cb_bindwireless"+n, "on")
		}
		add("bindwireless"+n, j["SSID"+n])
	}
	for _, n := range []string{"1", "2", "3", "4"} {
		add("bindwirelessac"+n, "0")
	}
	add("cb_enabledhcp", "on")
	add("enable_dhcp", "1")
	add("linkMode", j["LinkMode"])
	add("IpVersion", "IPv4")
	add("IPVersionValue", "IPv4")
	add("ISPTypeValue", j["ISP"])
	add("IpMode", "PPPoE")
	bridge := "PPPoE_Bridged"
	if b, ok := j["BridgeMode"]; ok {
		bridge = b
	}
	add("bridgeMode", bridge)
	add("dhcprelay", "No")
	add("multMode", "0")
	add("VLANMode", j["VLANMode"])
	add("vlan", "")
	add("vlanId", "No")
	add("vlanUNTAG", "4096")
	add("vlanTRANSPARENT", "4097")
	add("v8021P", "")
	add("vlanPri", "No")
	add("vlanPriNone", "0")
	add("MulticastVID", "")
	add("MulVIDUsed", "Yes")
	add("MTU", j["MTU"])
	add("cb_nat", "on")
	add("nat", "Enable")
	add("enblIgmp", "No")
	add("ManualDnsMode", "No")
	add("dnsMode", "0")
	add("wanIpAddress", "")
	add("wanSubnetMask", "")
	add("defaultGateway", "")
	add("dnsPrimary", "")
	add("dnsSecondary", "")
	add("pppUserName", j["USERNAME"])
	add("pppPassword", j["PASSWORD"])
	add("pppServiceName", "")
	add("pppTimeOut", "")
	if j["DHCPv6"] == "No" {
		add("pppv6Mode", "No")
	} else {
		add("pppv6Mode", "N/A")
	}
	add("enablepppbi", "No")
	add("pppbiUsed", "Yes")
	add("pppbiDisabled", "No")
	if j["DHCPv6"] == "No" {
		add("IdIpv6AddrType", "SLAAC")
	} else {
		add("IdIpv6AddrType", "Static")
	}
	for _, k := range []string{"IdIpv6Addr", "IdIpv6PrefixLen", "IdIpv6Gateway", "IdIpv6Dns1", "IdIpv6Dns2", "enablepd"} {
		add(k, "")
	}
	add("PDUsed", "No")
	add("PDDisabled", "No")
	add("pdmode", "Yes")
	add("pdmodeUsed", "No")
	add("pdmodeDisabled", "No")
	add("pdmodeAuto", "PrefixDelegation")
	add("pdmodeStatic", "Static")
	add("pdmodeNone", "None")
	for _, k := range []string{"pdprefix", "pdprefixptime", "pdprefixvtime", "enabledslite"} {
		add(k, "")
	}
	add("dsliteUsed", "No")
	add("dsliteDisabled", "No")
	add("dslitemode", "1")
	add("dsliteaddress", "")
	add("pppIdleTimeout", "0")
	add("xponstate", "Yes")
	for _, k := range []string{"Option60Enable", "Option60Type", "Option60ValueMode", "Option60Value"} {
		for _, n := range []string{"1", "2", "3", "4"} {
			add(k+n, "")
		}
	}
	return rows, svc, nil
}

func (c *ZimlinkClient) readWAN(ctx context.Context) (zlWAN, error) {
	raw, err := c.get(ctx, zlWANJSONPath, "/cgi-bin/net-wanset.asp")
	if err != nil {
		return nil, err
	}
	return parseZLWAN(raw)
}

// wanPostTimeout dan wanRecheckDelay dipakai bersama klien FD511GW (fd511gw.go).

// ensureTR069WAN mengembalikan (diubah, catatan). Sama seperti FD511GW: modem menyambung ulang
// PPPoE begitu menerima perubahan ini, jadi putus/timeout sesudah mengirim bukan penolakan.
func (c *ZimlinkClient) ensureTR069WAN(ctx context.Context) (bool, string) {
	j, err := c.readWAN(ctx)
	if err != nil {
		return false, "Gagal membaca WAN modem: " + err.Error()
	}
	rows, _, err := planZLWAN(j)
	if err != nil {
		if errors.Is(err, ErrNotSupportedConfig) {
			return false, "WAN modem ini di luar yang bisa diubah otomatis (" + strings.TrimPrefix(err.Error(), ErrNotSupportedConfig.Error()+": ") + "). Ubah layanan WAN jadi TR069_INTERNET lewat halaman web modem."
		}
		return false, "Gagal menyiapkan perubahan WAN: " + err.Error()
	}
	if rows == nil {
		return false, "" // sudah ada WAN pembawa TR-069
	}
	postCtx, cancel := context.WithTimeout(ctx, wanPostTimeout)
	_, perr := c.postForm(postCtx, "/cgi-bin/net-wanset.asp", "/cgi-bin/net-wanset.asp", rows)
	cancel()
	if perr != nil && !errors.Is(perr, ErrUnreachable) {
		return false, "Modem menolak perubahan WAN: " + perr.Error()
	}
	for try := 0; try < wanRechecks; try++ {
		select {
		case <-ctx.Done():
			return true, wanUnconfirmedNote
		case <-time.After(wanRecheckDelay):
		}
		getCtx, cancelGet := context.WithTimeout(ctx, wanPostTimeout)
		after, gerr := c.readWAN(getCtx)
		cancelGet()
		if gerr != nil {
			continue
		}
		if strings.Contains(after["ServiceList"], "TR069") {
			return true, ""
		}
	}
	if perr != nil {
		return false, wanUnconfirmedNote
	}
	return true, wanReconnectNote
}
