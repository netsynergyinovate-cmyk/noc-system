package olt

import "testing"

// Keluaran dengan bentuk persis seperti HSGQ-XE08ID (nama pelanggan diganti
// nama rekaan; kolom, spasi, dan tanda derajat rusak dipertahankan).
const fixtureOnuInfo = `
----------------------------------------------------------------------------------------------------
 PON/ONU     Mac-Address    Status   Auth  Cfg     Reg-time            ONU-Name     ONU-Desc
----------------------------------------------------------------------------------------------------
 1/1     28:23:f5:74:40:80 Online    TRUE  TRUE  2026/10/14 17:35:27      1396-BUDI SA NO-DESCRIPTI
 1/2     98:c7:a4:5c:52:f8 Initial   TRUE  FALSE  -                        1773-SITI    NO-DESCRIPTI
 3/1     98:c7:a4:5b:8e:38 Offline   TRUE  TRUE  2026/10/10 17:21:32      1774-PPPoE C NO-DESCRIPTI
 2/17    c4:cd:50:7c:fd:84 Online    TRUE  TRUE  2026/10/14 17:35:01      ONU02/17     NO-DESCRIPTI
----------------------------------------------------------------------------------------------------
  Total: 4  Online:2  Offline:2
----------------------------------------------------------------------------------------------------
`

const fixtureOnuVersion = `
PON/ONU ONU-Name     Mac-Address       Vendor Serial DevType Type     Version          ONU-DESC
----------------------------------------------------------------------------------------------------
    1/1 1396-BUDI SANTOSO 28:23:f5:74:40:80 MTKc   245H   HGU     1ge3fe   V3.0             NO-DESCRIPTION
    1/2 1773-SITI  98:c7:a4:5c:52:f8               SFU     1ge3fe                    NO-DESCRIPTION
    3/1 1774-PPPoE Cust 17060001774 98:c7:a4:5b:8e:38 HSGQ   130W   HGU     1ge3fe   R130S_4714       NO-DESCRIPTION
    2/17 ONU02/17     c4:cd:50:7c:fd:84 CDTC   15CR   HGU     1ge      V4.3.18          NO-DESCRIPTION
`

const fixtureDiag = "PON/ONU ONU-Name     Mac-address       Temperature  Voltage      Bias         Tx power     Rx power    \n" +
	"----------------------------------------------------------------------------------------------------\n" +
	"    1/1 1396-BUDI SANTOSO 28:23:f5:74:40:80  49 Â°C      3.29 V        11 mA       1.9645 dBm   -15.9688 dBm\n" +
	"    1/19 1557-SUYONO  c4:cd:50:0e:9a:66  38 °C      3.24 V        15 mA       1.9468 dBm   -29.2082 dBm\n" +
	"    2/17 ONU02/17     c4:cd:50:7c:fd:84  39 C      3.28 V        12 mA       1.9181 dBm   -inf dBm\n" +
	"----------------------------------------------------------------------------------------------------\n"

const fixturePonInfo = `
 PON Device 1 :
 Device MAC    : 00:13:25:00:00:00
 Device Status : UP
 Port    Status     Online/Total ONUs
 ---------------------------------------------------------------------------------------------------
 PON01   Up         20/23
 PON05   Up         17/17
 PON06   Down       0/0
`

func TestParseOnuInfoReadsStatusAndTreatsInitialAsOffline(t *testing.T) {
	rows := parseOnuInfo(fixtureOnuInfo)
	if len(rows) != 4 {
		t.Fatalf("harus 4 baris (judul, garis, dan Total dilewati), got %d: %+v", len(rows), rows)
	}
	want := []struct {
		pon, onu int
		mac, st  string
	}{
		{1, 1, "28:23:F5:74:40:80", "online"},
		{1, 2, "98:C7:A4:5C:52:F8", "offline"}, // Initial
		{3, 1, "98:C7:A4:5B:8E:38", "offline"},
		{2, 17, "C4:CD:50:7C:FD:84", "online"},
	}
	for i, w := range want {
		r := rows[i]
		if r.Pon != w.pon || r.Onu != w.onu || r.MAC != w.mac || r.Status != w.st {
			t.Errorf("baris %d: %+v, want %+v", i, r, w)
		}
	}
}

func TestParseOnuVersionKeepsFullNamesAndModels(t *testing.T) {
	v := parseOnuVersion(fixtureOnuVersion)
	if len(v) != 4 {
		t.Fatalf("len=%d %+v", len(v), v)
	}
	if g := v[key(1, 1)]; g.Name != "1396-BUDI SANTOSO" || g.Model != "MTKc 245H" || g.MAC != "28:23:F5:74:40:80" {
		t.Errorf("1/1: %+v", g)
	}
	if g := v[key(1, 2)]; g.Name != "1773-SITI" || g.Model != "" {
		t.Errorf("ONU tanpa vendor tidak boleh diberi model karangan: %+v", g)
	}
	if g := v[key(3, 1)]; g.Name != "1774-PPPoE Cust 17060001774" || g.Model != "HSGQ 130W" {
		t.Errorf("3/1: %+v", g)
	}
	if g := v[key(2, 17)]; g.Name != "ONU02/17" || g.Model != "CDTC 15CR" {
		t.Errorf("2/17: %+v", g)
	}
}

func TestParseOpticalDiagHandlesMojibakeAndNoReading(t *testing.T) {
	d := parseOpticalDiag(fixtureDiag)
	if len(d) != 3 {
		t.Fatalf("len=%d %+v", len(d), d)
	}
	a := d[key(1, 1)]
	if a.Name != "1396-BUDI SANTOSO" || a.RxDbm == nil || *a.RxDbm != -15.9688 || a.TxDbm == nil || *a.TxDbm != 1.9645 || a.TempC == nil || *a.TempC != 49 {
		t.Errorf("1/1: %+v", a)
	}
	if b := d[key(1, 19)]; b.RxDbm == nil || *b.RxDbm != -29.2082 {
		t.Errorf("tanda derajat normal: %+v", b)
	}
	if c := d[key(2, 17)]; c.RxDbm != nil || c.TxDbm == nil {
		t.Errorf("'-inf' berarti tidak terbaca (nil), bukan angka: %+v", c)
	}
}

func TestParsePonInfo(t *testing.T) {
	p := parsePonInfo(fixturePonInfo)
	if len(p) != 3 {
		t.Fatalf("len=%d %+v", len(p), p)
	}
	if p[0] != (cliPon{Index: 1, Up: true, Online: 20, Total: 23}) || p[2] != (cliPon{Index: 6, Up: false}) {
		t.Errorf("%+v", p)
	}
}

func TestParsersIgnoreGarbageAndEmpty(t *testing.T) {
	junk := "vty% Command incomplete.\n\nOLT-X(config)#\n<html>login</html>\n"
	if len(parseOnuInfo(junk)) != 0 || len(parseOnuVersion(junk)) != 0 || len(parseOpticalDiag(junk)) != 0 || len(parsePonInfo(junk)) != 0 {
		t.Error("keluaran sampah tidak boleh menghasilkan baris")
	}
	if len(parseOnuInfo("")) != 0 {
		t.Error("kosong tidak menghasilkan baris")
	}
}
