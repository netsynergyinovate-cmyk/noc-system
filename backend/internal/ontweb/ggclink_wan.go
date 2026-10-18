package ontweb

// Penambahan WAN TR-069 (mode DHCP, tanpa VLAN) di GGCLink GM220-S XPON. Modem ini mengunci "Service List"
// WAN PPPoE yang sudah ada, tetapi mengizinkan WAN BARU. WAN pelanggan tidak disentuh. Isi POST dibuktikan
// sama byte demi byte dengan yang dikirim halaman asli (peramban asli, permintaan dibatalkan) di dua modem
// nyata (fixture testdata/gm22/wan-*): hanya IF_ERRORTYPE, nama WAN, identitas WAN dan token yang berbeda.

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ggcWANFormFields: susunan field formulir halaman WAN yang sudah diperiksa.
var ggcWANFormFields = []string{
	"IF_ACTION", "IF_ERRORSTR", "IF_ERRORPARAM", "IF_ERRORTYPE", "IF_INSTNUM", "IF_INDEX",
	"IF_WANNAME0", "IF_WANIDENTITY0", "Enable1", "WANCName1", "ConnType1", "LANDViewName1",
	"StrServList1", "ServList1", "IsNAT1", "IsDefGW1", "IsForward1", "VLANID1",
	"Priority1", "WBDMode1", "IPAddress1", "SubnetMask1", "GateWay1", "DNS11",
	"DNS21", "DNS31", "WorkIFMac1", "UpTime1", "ConnStatus1", "UserName1",
	"Password1", "PPPoEACName1", "PPPoEServiceName1", "MRU1", "MTU1", "ConnTrigger1",
	"TransType1", "AuthType1", "IdleTime1", "ConnError1", "DestAddress1", "ATMLinkType1",
	"ATMEncapsulation1", "ATMQoS1", "ATMPeakCellRate1", "ATMMaxBurstSize1", "ATMMinCellRate1", "ATMSCR1",
	"ATMCDV1", "RxPackets1", "TxPackets1", "RxBytes1", "TxBytes1", "EnableProxy1",
	"MaxUser1", "DSCP1", "EnablePassThrough1", "ValidWANRx1", "ValidLANTx1", "bitBind1",
	"dhcpEnable1", "HostTrigger1", "IPMode1", "GUASrc1", "DNSv6Src1", "Gatewayv6Src1",
	"MTUv6Src1", "GUA11", "IsOutPreferredLft11", "GUA21", "IsOutPreferredLft21", "GUA31",
	"IsOutPreferredLft31", "Gatewayv61", "DNS1v61", "DNS2v61", "DNS3v61", "MTUv61",
	"MCVlANID1", "GuaNum1", "PdNum1", "IPv6CPExt1", "PrefixSrc1", "Prefix11",
	"Prefix1Len1", "PrefixNum1", "IsADSL1", "IF_STATUS", "IF_PPPNUM", "IF_CONNSTATUS0",
	"IF_CONNNAME0", "IPMode0", "IF_MULTIDISPLAY", "IF_TYPE", "IF_PROTOCOL", "IF_NAME",
	"IF_MODE", "IF_IDLE",
}

// ggcWANCreateRows: isi POST "Create WAN" (TR069, DHCP, tanpa VLAN) menurut urutan halaman asli. "@" =
// nilai yang diambil dari halaman (IF_ERRORTYPE, IF_INSTNUM, IF_INDEX, IF_WANNAME0, IF_WANIDENTITY0).
var ggcWANCreateRows = [][2]string{
	{"IF_ACTION", "new"},
	{"IF_ERRORSTR", "SUCC"},
	{"IF_ERRORPARAM", "SUCC"},
	{"IF_ERRORTYPE", "@"},
	{"IF_INSTNUM", "@"},
	{"IF_INDEX", "@"},
	{"IF_WANNAME0", "@"},
	{"IF_WANIDENTITY0", "@"},
	{"Enable1", "1"},
	{"WANCName1", "NULL"},
	{"ConnType1", "NULL"},
	{"LANDViewName1", "NULL"},
	{"StrServList1", "TR069"},
	{"ServList1", "NULL"},
	{"IsNAT1", "0"},
	{"IsDefGW1", "NULL"},
	{"IsForward1", "NULL"},
	{"VLANID1", "0"},
	{"Priority1", "0"},
	{"WBDMode1", "0"},
	{"IPAddress1", "NULL"},
	{"SubnetMask1", "NULL"},
	{"GateWay1", "NULL"},
	{"DNS11", "NULL"},
	{"DNS21", "NULL"},
	{"DNS31", "NULL"},
	{"WorkIFMac1", "NULL"},
	{"UpTime1", "NULL"},
	{"RemainLeaseTime1", "NULL"},
	{"ConnStatus1", "NULL"},
	{"Addressingtype1", "DHCP"},
	{"DestAddress1", "NULL"},
	{"ATMLinkType1", "EoA"},
	{"ATMEncapsulation1", "NULL"},
	{"ATMQoS1", "NULL"},
	{"ATMPeakCellRate1", "NULL"},
	{"ATMMaxBurstSize1", "NULL"},
	{"ATMMinCellRate1", "NULL"},
	{"ATMSCR1", "NULL"},
	{"ATMCDV1", "NULL"},
	{"RxPackets1", "NULL"},
	{"TxPackets1", "NULL"},
	{"RxBytes1", "NULL"},
	{"TxBytes1", "NULL"},
	{"DSCP1", "-1"},
	{"bitBind1", "NULL"},
	{"dhcpEnable1", "0"},
	{"MTU1", "1500"},
	{"IPMode1", "1"},
	{"GUASrc1", "NULL"},
	{"DNSv6Src1", "NULL"},
	{"Gatewayv6Src1", "NULL"},
	{"MTUv6Src1", "NULL"},
	{"GUA11", "NULL"},
	{"IsOutPreferredLft11", "NULL"},
	{"GUA21", "NULL"},
	{"IsOutPreferredLft21", "NULL"},
	{"GUA31", "NULL"},
	{"IsOutPreferredLft31", "NULL"},
	{"Gatewayv61", "NULL"},
	{"DNS1v61", "NULL"},
	{"DNS2v61", "NULL"},
	{"DNS3v61", "NULL"},
	{"MTUv61", "NULL"},
	{"MCVlANID1", "-1"},
	{"GuaNum1", "NULL"},
	{"PdNum1", "NULL"},
	{"PrefixSrc1", "NULL"},
	{"Prefix11", "NULL"},
	{"Prefix1Len1", "NULL"},
	{"PrefixNum1", "NULL"},
	{"IsADSL1", "0"},
	{"IF_STATUS", "1"},
	{"IPMode0", "ipv4"},
	{"IF_MULTIDISPLAY", "0"},
	{"IF_TYPE", "DHCP"},
	{"IF_PROTOCOL", "IPv4"},
	{"IF_NAME", ""},
	{"IF_MODE", ""},
	{"IF_IDLE", "edit"},
}

var (
	ggcWANName     = regexp.MustCompile(`^\d+_INTERNET_R_VID_$`)
	ggcWANIdentity = regexp.MustCompile(`^IGD\.WD1\.WCD\d+\.WCPPP1$`)
	ggcNumber      = regexp.MustCompile(`^-?\d{1,12}$`)
)

// ggcWANPage: daftar WAN dan token dari halaman net_ethwan_conf_t.gch.
type ggcWANPage struct {
	Data  map[string]string
	Token string
	Names []string
}

func parseGGCWAN(page []byte) (*ggcWANPage, error) {
	text := string(page)
	form := ggcForm.FindString(text)
	if form == "" {
		return nil, fmt.Errorf("%w: formulir fSubmit tidak ditemukan", ErrUnexpected)
	}
	var order []string
	for _, m := range ggcHidden.FindAllStringSubmatch(form, -1) {
		order = append(order, m[1])
	}
	if strings.Join(order, ",") != strings.Join(ggcWANFormFields, ",") {
		return nil, fmt.Errorf("%w: susunan formulir WAN berbeda dari yang terverifikasi", ErrNotSupportedConfig)
	}
	if !strings.Contains(text, `setValue("IF_ACTION","new")`) {
		return nil, fmt.Errorf("%w: halaman WAN tidak mengirim IF_ACTION=new seperti yang terverifikasi", ErrNotSupportedConfig)
	}
	tok := ggcSessionToken.FindStringSubmatch(text)
	if tok == nil {
		return nil, fmt.Errorf("%w: halaman tanpa token sesi", ErrUnexpected)
	}
	data := map[string]string{}
	for _, m := range ggcMeaning.FindAllStringSubmatch(form, -1) {
		data[m[1]] = ggcUnescape(m[2])
	}
	n, err := strconv.Atoi(data["IF_INSTNUM"])
	if err != nil || n < 0 || n > 8 {
		return nil, fmt.Errorf("%w: jumlah WAN tidak terbaca", ErrUnexpected)
	}
	p := &ggcWANPage{Data: data, Token: tok[1]}
	for i := 0; i < n; i++ {
		p.Names = append(p.Names, data["IF_WANNAME"+strconv.Itoa(i)])
	}
	return p, nil
}

func (p *ggcWANPage) hasTR069() bool {
	for _, n := range p.Names {
		if strings.Contains(n, "TR069") {
			return true
		}
	}
	return false
}

// planGGCWAN menyusun isi POST. rows=nil dengan note bila WAN TR-069 sudah ada. Hanya bentuk yang
// teramati (tepat satu WAN PPPoE INTERNET) yang dikerjakan; selebihnya ErrNotSupportedConfig.
func planGGCWAN(p *ggcWANPage) (rows [][2]string, note string, err error) {
	if p.hasTR069() {
		return nil, "modem sudah punya WAN TR-069", nil
	}
	d := p.Data
	if len(p.Names) != 1 {
		return nil, "", fmt.Errorf("%w: modem punya %d WAN; hanya modem dengan satu WAN PPPoE yang terverifikasi, tambahkan WAN TR-069 manual", ErrNotSupportedConfig, len(p.Names))
	}
	if !ggcWANName.MatchString(d["IF_WANNAME0"]) || !ggcWANIdentity.MatchString(d["IF_WANIDENTITY0"]) {
		return nil, "", fmt.Errorf("%w: WAN yang ada bukan PPPoE INTERNET seperti yang terverifikasi, tambahkan WAN TR-069 manual", ErrNotSupportedConfig)
	}
	if d["IF_ERRORSTR"] != "SUCC" || d["IF_ERRORPARAM"] != "SUCC" || !ggcNumber.MatchString(d["IF_ERRORTYPE"]) {
		return nil, "", fmt.Errorf("%w: halaman WAN melaporkan galat", ErrUnexpected)
	}
	dyn := map[string]string{
		"IF_ERRORTYPE": d["IF_ERRORTYPE"], "IF_INSTNUM": d["IF_INSTNUM"], "IF_INDEX": d["IF_INSTNUM"],
		"IF_WANNAME0": d["IF_WANNAME0"], "IF_WANIDENTITY0": d["IF_WANIDENTITY0"],
	}
	for _, r := range ggcWANCreateRows {
		v := r[1]
		if v == "@" {
			v = dyn[r[0]]
		}
		rows = append(rows, [2]string{r[0], v})
	}
	rows = append(rows, [2]string{"_SESSION_TOKEN", p.Token})
	return rows, "", nil
}

// ggcWANRechecks/ggcWANRecheckGap: modem butuh beberapa detik menyimpan WAN baru.
var (
	ggcWANRechecks   = 4
	ggcWANRecheckGap = 3 * time.Second
)

// ensureTR069WAN menambahkan WAN TR-069 (DHCP) bila belum ada. changed=true bila WAN baru dibuat.
// note dikembalikan untuk petugas (tidak pernah memuat kata sandi).
func (c *GGCLinkClient) ensureTR069WAN(ctx context.Context) (changed bool, note string) {
	body, err := c.page(ctx, "net_ethwan_conf_t.gch")
	if err != nil {
		return false, "WAN TR-069 tidak diperiksa: " + err.Error()
	}
	p, err := parseGGCWAN(body)
	if err != nil {
		return false, "WAN TR-069 tidak ditambahkan: " + err.Error()
	}
	rows, _, err := planGGCWAN(p)
	if err != nil {
		return false, "WAN TR-069 tidak ditambahkan: " + err.Error()
	}
	if rows == nil {
		return false, "" // sudah ada WAN TR-069: tidak ada yang perlu dilakukan atau diperingatkan
	}
	_, _, _, postErr := c.postForm(ctx, "/getpage.gch?pid=1002&nextpage=net_ethwan_conf_t.gch", c.lastURL, rows)
	if postErr != nil && !errors.Is(postErr, ErrUnreachable) {
		return false, "WAN TR-069 ditolak modem: " + postErr.Error()
	}
	// Terputus sesudah mengirim bukan penolakan: pastikan dengan membaca ulang.
	for i := 0; i < ggcWANRechecks; i++ {
		if i > 0 {
			select {
			case <-ctx.Done():
				return false, "WAN TR-069: pemeriksaan dihentikan sebelum selesai"
			case <-time.After(ggcWANRecheckGap):
			}
		}
		after, err := c.page(ctx, "net_ethwan_conf_t.gch")
		if err != nil {
			continue
		}
		ap, err := parseGGCWAN(after)
		if err != nil {
			continue
		}
		if ap.hasTR069() {
			return true, "WAN TR-069 (DHCP, tanpa VLAN) ditambahkan; WAN pelanggan tidak diubah. Modem mendapat IP manajemen dari router lalu melapor ke GenieACS."
		}
	}
	return false, "WAN TR-069 dikirim tetapi belum terlihat di modem; cek halaman WAN modem"
}
