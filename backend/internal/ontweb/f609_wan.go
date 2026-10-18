package ontweb

// Penambahan WAN TR-069 (mode DHCP, tanpa VLAN) di ZTE F609 MediaTek. Halaman net-wanset.asp (formulir ConfigForm,
// 126 kontrol) dipakai persis seperti petugas memakainya: "New WAN connection", layanan TR069, tipe IP, DHCP,
// lalu Save; isi POST (95 field) dan cookie EBOOVALUE DIBUKTIKAN sama byte demi byte dengan peramban asli di dua modem
// nyata (fixture testdata/f609/wan-*). WAN pelanggan tidak disentuh. Satu-satunya nilai yang dihitung dari halaman
// adalah WanCurrIFIdx (getMaxIFIdx(): nomor bebas pertama sesudah IFIdxStore).

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// f609WANFormFields: susunan kontrol formulir WAN yang sudah diperiksa.
var f609WANFormFields = []string{
	"curSetIndex", "WanActive", "WanCurrIFIdx", "wanId", "Wan_Flag", "EnCAPFlag",
	"PPPGetIpFlag", "ConnectionFlag", "Enable_Flag", "Disable_Flag", "afterdeleteFlag", "OperatorStyle",
	"dhcpv6pdflag", "pppManualStatus_Flag", "wanMode", "cb_enblService", "enblService", "serviceList",
	"cb_bindflag", "bindflag", "cb_bindlan1", "bindlan1", "cb_bindlan2", "bindlan2",
	"cb_bindlan3", "bindlan3", "cb_bindlan4", "bindlan4", "cb_bindwireless1", "bindwireless1",
	"cb_bindwireless2", "bindwireless2", "cb_bindwireless3", "bindwireless3", "cb_bindwireless4", "bindwireless4",
	"cb_bindwirelessac1", "bindwirelessac1", "cb_bindwirelessac2", "bindwirelessac2", "cb_bindwirelessac3", "bindwirelessac3",
	"cb_bindwirelessac4", "bindwirelessac4", "cb_enabledhcp", "enable_dhcp", "linkMode", "IpVersion",
	"IpVersion", "IpVersion", "IPVersionValue", "ISPTypeValue", "IpMode", "IpMode",
	"IpMode", "IpMode", "IpMode", "bridgeMode", "cb_dhcprelay", "dhcprelay",
	"multMode", "VLANMode", "vlan", "vlanId", "vlanUNTAG", "vlanTRANSPARENT",
	"cb_8021P", "v8021PClick", "v8021P", "vlanPri", "vlanPriNone", "MulticastVID",
	"MulVIDUsed", "MTU", "cb_nat", "nat", "cb_enblIgmp", "enblIgmp",
	"wanIpAddress", "wanSubnetMask", "defaultGateway", "dnsPrimary", "dnsSecondary", "pppUserName",
	"pppPassword", "cb_enablshowpsw", "pppServerName", "ppp_DialMethod", "DialMethod", "pppDialButton",
	"pppondemand_idletime", "pppTimeOut", "pppv6Mode", "cb_enable_pppbi", "enablepppbi", "pppbiUsed",
	"pppbiDisabled", "IdIpv6AddrType", "IdIpv6Addr", "IdIpv6PrefixLen", "IdIpv6Gateway", "IdIpv6Dns1",
	"IdIpv6Dns2", "cb_enabledpd", "enablepd", "PDUsed", "PDDisabled", "pdmode",
	"pdmode", "pdmodeUsed", "pdmodeDisabled", "pdmodeAuto", "pdmodeStatic", "pdmodeNone",
	"pdprefix", "pdprefixptime", "pdprefixvtime", "cb_enabledslite", "enabledslite", "dsliteUsed",
	"dsliteDisabled", "dslitemode", "dslitemode", "dsliteaddress", "pppIdleTimeout", "xponstate",
}

// f609WANCreateRows: isi POST "New WAN" (TR069, Route, DHCP, UNTAG, NAT mati). "@" = nilai dari halaman.
var f609WANCreateRows = [][2]string{
	{"curSetIndex", "0"},
	{"WanActive", "Yes"},
	{"WanCurrIFIdx", "@"},
	{"wanId", "-1"},
	{"Wan_Flag", "1"},
	{"EnCAPFlag", "1483 Bridged IP LLC"},
	{"PPPGetIpFlag", "Dynamic"},
	{"ConnectionFlag", "Connect_Keep_Alive"},
	{"Enable_Flag", "Yes"},
	{"Disable_Flag", "No"},
	{"afterdeleteFlag", "0"},
	{"OperatorStyle", "Add"},
	{"dhcpv6pdflag", "No"},
	{"pppManualStatus_Flag", "N/A"},
	{"wanMode", "Route"},
	{"cb_enblService", "on"},
	{"enblService", ""},
	{"serviceList", "TR069"},
	{"bindflag", "N/A"},
	{"bindlan1", "No"},
	{"bindlan2", "No"},
	{"bindlan3", "No"},
	{"bindlan4", "No"},
	{"bindwireless1", "No"},
	{"bindwireless2", "No"},
	{"bindwireless3", "No"},
	{"bindwireless4", "No"},
	{"bindwirelessac1", "0"},
	{"bindwirelessac2", "0"},
	{"bindwirelessac3", "0"},
	{"bindwirelessac4", "0"},
	{"enable_dhcp", "0"},
	{"linkMode", "linkIP"},
	{"IpVersion", "IPv4"},
	{"IPVersionValue", "IPv4"},
	{"ISPTypeValue", "0"},
	{"IpMode", "DHCP"},
	{"bridgeMode", "PPPoE_Bridged"},
	{"dhcprelay", "No"},
	{"multMode", "0"},
	{"VLANMode", "UNTAG"},
	{"vlan", ""},
	{"vlanId", "No"},
	{"vlanUNTAG", "4096"},
	{"vlanTRANSPARENT", "4097"},
	{"cb_8021P", "on"},
	{"v8021PClick", "Yes"},
	{"v8021P", ""},
	{"vlanPri", "No"},
	{"vlanPriNone", "0"},
	{"MulticastVID", ""},
	{"MulVIDUsed", "No"},
	{"MTU", "1500"},
	{"nat", "Disabled"},
	{"enblIgmp", "No"},
	{"wanIpAddress", ""},
	{"wanSubnetMask", ""},
	{"defaultGateway", ""},
	{"dnsPrimary", ""},
	{"dnsSecondary", ""},
	{"pppUserName", ""},
	{"pppPassword", ""},
	{"pppServerName", ""},
	{"ppp_DialMethod", "Connect_Keep_Alive"},
	{"pppondemand_idletime", "1800"},
	{"pppTimeOut", "30"},
	{"pppv6Mode", "N/A"},
	{"enablepppbi", ""},
	{"pppbiUsed", "No"},
	{"pppbiDisabled", "No"},
	{"IdIpv6AddrType", "Static"},
	{"IdIpv6Addr", ""},
	{"IdIpv6PrefixLen", ""},
	{"IdIpv6Gateway", ""},
	{"IdIpv6Dns1", ""},
	{"IdIpv6Dns2", ""},
	{"enablepd", ""},
	{"PDUsed", "No"},
	{"PDDisabled", "No"},
	{"pdmode", "Yes"},
	{"pdmodeUsed", "No"},
	{"pdmodeDisabled", "No"},
	{"pdmodeAuto", "PrefixDelegation"},
	{"pdmodeStatic", "Static"},
	{"pdmodeNone", "None"},
	{"pdprefix", ""},
	{"pdprefixptime", ""},
	{"pdprefixvtime", ""},
	{"enabledslite", ""},
	{"dsliteUsed", "No"},
	{"dsliteDisabled", "No"},
	{"dslitemode", "0"},
	{"dsliteaddress", ""},
	{"pppIdleTimeout", "0"},
	{"xponstate", "Yes"},
}

var (
	f609WANForm    = regexp.MustCompile(`(?is)<form\b[^>]*name\s*=\s*"?ConfigForm"?.*?</form>`)
	f609WANControl = regexp.MustCompile(`(?is)<(?:input|select)\b[^>]*?\bname\s*=\s*["']?([A-Za-z0-9_]+)`)
	// Daftar WAN ada di data skrip halaman (bagian "num 0"); <select name=wanId> diisi JS dan kosong di HTML mentah.
	f609WANList    = regexp.MustCompile(`(?s)var\s+nEntryNum\s*=\s*"(\d+)"\s*;\s*//\s*num 0\s*var\s+vArrayStr\s*=\s*"([^"]*)"`)
	f609CycleV     = regexp.MustCompile(`(?s)//\s*num 20\s*var\s+CycleV\s*=\s*"([^"]*)"`)
	f609IFIdxStore = regexp.MustCompile(`var\s+IFIdxStore\s*=\s*"(\d+)"`)
	f609WANName    = regexp.MustCompile(`^\d+_INTERNET_R_VID_$`)
)

// f609WANPage: daftar WAN dan nomor interface dari halaman net-wanset.asp.
type f609WANPage struct {
	Names   []string
	IFIdxes []int
	Store   int
}

func parseF609WAN(page []byte) (*f609WANPage, error) {
	text := string(page)
	form := f609WANForm.FindString(text)
	if form == "" {
		return nil, fmt.Errorf("%w: formulir WAN tidak ditemukan", ErrUnexpected)
	}
	var got []string
	for _, m := range f609WANControl.FindAllStringSubmatch(form, -1) {
		got = append(got, m[1])
	}
	if strings.Join(got, ",") != strings.Join(f609WANFormFields, ",") {
		return nil, fmt.Errorf("%w: susunan formulir WAN berbeda dari yang terverifikasi", ErrNotSupportedConfig)
	}
	p := &f609WANPage{}
	list := f609WANList.FindStringSubmatch(text)
	if list == nil {
		return nil, fmt.Errorf("%w: daftar WAN tidak ditemukan", ErrUnexpected)
	}
	for _, n := range strings.Split(list[2], ",") {
		if n = strings.TrimSpace(n); n != "" {
			p.Names = append(p.Names, n)
		}
	}
	if want, err := strconv.Atoi(list[1]); err != nil || want != len(p.Names) {
		return nil, fmt.Errorf("%w: jumlah WAN tidak cocok dengan daftarnya", ErrUnexpected)
	}
	cyc := f609CycleV.FindStringSubmatch(text)
	st := f609IFIdxStore.FindStringSubmatch(text)
	if cyc == nil || st == nil {
		return nil, fmt.Errorf("%w: nomor interface WAN tidak terbaca", ErrUnexpected)
	}
	p.Store, _ = strconv.Atoi(st[1])
	for _, s := range strings.Split(cyc[1], ",") {
		if s = strings.TrimSpace(s); s != "" {
			n, err := strconv.Atoi(s)
			if err != nil {
				return nil, fmt.Errorf("%w: nomor interface WAN tidak terbaca", ErrUnexpected)
			}
			p.IFIdxes = append(p.IFIdxes, n)
		}
	}
	return p, nil
}

func (p *f609WANPage) hasTR069() bool {
	for _, n := range p.Names {
		if strings.Contains(n, "TR069") {
			return true
		}
	}
	return false
}

// maxIFIdx meniru getMaxIFIdx() halaman: nomor bebas pertama mulai IFIdxStore+1 sampai 99, lalu dari 1.
func (p *f609WANPage) maxIFIdx() (int, bool) {
	used := map[int]bool{}
	for _, n := range p.IFIdxes {
		used[n] = true
	}
	for i := p.Store + 1; i <= 99; i++ {
		if !used[i] {
			return i, true
		}
	}
	for i := 1; i < p.Store+1; i++ {
		if !used[i] {
			return i, true
		}
	}
	return 0, false
}

// planF609WAN menyusun isi POST. rows=nil bila WAN TR-069 sudah ada. Hanya bentuk yang teramati (tepat satu WAN
// PPPoE INTERNET) yang dikerjakan; selebihnya ErrNotSupportedConfig.
func planF609WAN(p *f609WANPage) (rows [][2]string, err error) {
	if p.hasTR069() {
		return nil, nil
	}
	if len(p.Names) != 1 || !f609WANName.MatchString(p.Names[0]) {
		return nil, fmt.Errorf("%w: hanya modem dengan satu WAN PPPoE INTERNET yang terverifikasi (WAN sekarang: %d), tambahkan WAN TR-069 manual", ErrNotSupportedConfig, len(p.Names))
	}
	idx, ok := p.maxIFIdx()
	if !ok {
		return nil, fmt.Errorf("%w: tidak ada nomor interface WAN yang bebas", ErrNotSupportedConfig)
	}
	for _, r := range f609WANCreateRows {
		v := r[1]
		if v == "@" {
			v = strconv.Itoa(idx)
		}
		rows = append(rows, [2]string{r[0], v})
	}
	return rows, nil
}

func (c *F609Client) postWAN(ctx context.Context, rows [][2]string) error {
	return c.postCookieForm(ctx, "/cgi-bin/net-wanset.asp", rows)
}

var (
	f609WANRechecks   = 4
	f609WANRecheckGap = 3 * time.Second
)

// ensureTR069WAN menambahkan WAN TR-069 (DHCP, tanpa VLAN) bila belum ada. changed=true bila WAN baru dibuat.
func (c *F609Client) ensureTR069WAN(ctx context.Context) (changed bool, note string) {
	body, err := c.get(ctx, "/cgi-bin/net-wanset.asp", "/cgi-bin/content.asp")
	if err != nil {
		return false, "WAN TR-069 tidak diperiksa: " + err.Error()
	}
	p, err := parseF609WAN(body)
	if err != nil {
		return false, "WAN TR-069 tidak ditambahkan: " + err.Error()
	}
	rows, err := planF609WAN(p)
	if err != nil {
		return false, "WAN TR-069 tidak ditambahkan: " + err.Error()
	}
	if rows == nil {
		return false, "" // sudah ada WAN TR-069
	}
	postErr := c.postWAN(ctx, rows)
	if postErr != nil && !errors.Is(postErr, ErrUnreachable) {
		return false, "WAN TR-069 ditolak modem: " + postErr.Error()
	}
	// Terputus sesudah mengirim bukan penolakan: pastikan dengan membaca ulang.
	for i := 0; i < f609WANRechecks; i++ {
		if i > 0 {
			select {
			case <-ctx.Done():
				return false, "WAN TR-069: pemeriksaan dihentikan sebelum selesai"
			case <-time.After(f609WANRecheckGap):
			}
		}
		after, err := c.get(ctx, "/cgi-bin/net-wanset.asp", "/cgi-bin/content.asp")
		if err != nil {
			continue
		}
		ap, err := parseF609WAN(after)
		if err != nil {
			continue
		}
		if ap.hasTR069() {
			return true, "WAN TR-069 (DHCP, tanpa VLAN) ditambahkan; WAN pelanggan tidak diubah. Modem mendapat IP manajemen dari router lalu melapor ke GenieACS."
		}
	}
	return false, "WAN TR-069 dikirim tetapi belum terlihat di modem; cek halaman WAN modem"
}
