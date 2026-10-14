package olt

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Pembaca keluaran CLI OLT HSGQ (seri XE, EPON). Murni: hanya teks masuk, data
// keluar, supaya bisa diuji dengan keluaran nyata tanpa perangkat. Format tabel
// ditentukan dari perangkat HSGQ-XE08ID (firmware V3.4.3ID); baris yang tidak
// dikenali dilewati, bukan ditebak.

const macPattern = `[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}`

var (
	// " 1/1     28:23:f5:74:40:80 Online    TRUE  TRUE  2026/10/14 17:35:27      1396-MOHAMMA NO-DESCRIPTI"
	reOnuInfo = regexp.MustCompile(`^\s*(\d+)/(\d+)\s+(` + macPattern + `)\s+(\S+)\s+(TRUE|FALSE)\s+(TRUE|FALSE)\b`)
	// "    1/1 1396-MOHAMMAD TOHID 28:23:f5:74:40:80 MTKc   245H   HGU     1ge3fe   V3.0   NO-DESCRIPTION"
	// Nama boleh memuat spasi, jadi diambil lazy sampai MAC.
	reOnuVersion = regexp.MustCompile(`^\s*(\d+)/(\d+)\s+(.*?)\s*(` + macPattern + `)\s*(.*)$`)
	// "    1/1 NAMA 28:23:f5:74:40:80  49 °C      3.29 V        11 mA       1.9645 dBm   -15.9688 dBm"
	// Tanda derajat bisa terbaca rusak (Â°); jadi \S{1,3} sebelum "C".
	reOpticalDiag = regexp.MustCompile(`^\s*(\d+)/(\d+)\s+(.*?)\s*(` + macPattern + `)\s+(-?\d+(?:\.\d+)?)\s*\S{0,3}C\s+(-?\d+(?:\.\d+)?)\s*V\s+(-?\d+(?:\.\d+)?)\s*mA\s+(\S+)\s*dBm\s+(\S+)\s*dBm\s*$`)
	// " PON01   Up         20/23"
	rePonInfo = regexp.MustCompile(`^\s*PON(\d+)\s+(Up|Down)\s+(\d+)/(\d+)\b`)
)

// cliOnu adalah satu ONU dari tabel CLI (gabungan beberapa perintah).
type cliOnu struct {
	Pon, Onu int
	MAC      string
	Status   string // "online", "offline"; "Initial" (terdaftar, belum dikonfigurasi) dibaca offline
	Name     string
	Model    string
	RxDbm    *float64
	TxDbm    *float64
}

func atoiOr(s string, def int) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

// dbm membaca angka dBm; "-inf", "N/A", atau kosong berarti tidak terbaca (nil).
func dbm(s string) *float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	// ParseFloat menerima "inf" dan "nan" sebagai angka sah; keduanya bukan bacaan.
	if err != nil || math.IsInf(v, 0) || math.IsNaN(v) {
		return nil
	}
	return &v
}

func normalizeMAC(s string) string { return strings.ToUpper(strings.TrimSpace(s)) }

// cliStatus memetakan kolom Status ke online atau offline. Hanya "Online" yang
// online: "Offline" dan "Initial" (ONU terdaftar tetapi belum aktif) tidak
// membawa trafik pelanggan.
func cliStatus(s string) string {
	if strings.EqualFold(strings.TrimSpace(s), "online") {
		return "online"
	}
	return "offline"
}

func key(pon, onu int) [2]int { return [2]int{pon, onu} }

// parseOnuInfo membaca "show onu-info all".
func parseOnuInfo(out string) []cliOnu {
	var rows []cliOnu
	for _, line := range strings.Split(out, "\n") {
		m := reOnuInfo.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		rows = append(rows, cliOnu{
			Pon: atoiOr(m[1], 0), Onu: atoiOr(m[2], 0),
			MAC: normalizeMAC(m[3]), Status: cliStatus(m[4]),
		})
	}
	return rows
}

// onuVersion adalah nama dan model dari "show onu-version all".
type onuVersion struct {
	MAC, Name, Model string
}

// parseOnuVersion membaca "show onu-version all". Kolom vendor dan serial kosong
// pada ONU yang belum pernah online (baris SFU tanpa vendor), jadi model dibaca
// dari token sebelum tipe perangkat (HGU/SFU/...).
func parseOnuVersion(out string) map[[2]int]onuVersion {
	res := map[[2]int]onuVersion{}
	for _, line := range strings.Split(out, "\n") {
		m := reOnuVersion.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		tail := strings.Fields(m[5])
		model := ""
		for i, tok := range tail {
			if isDevType(tok) {
				if i >= 2 {
					model = tail[i-2] + " " + tail[i-1]
				}
				break
			}
		}
		res[key(atoiOr(m[1], 0), atoiOr(m[2], 0))] = onuVersion{
			MAC:   normalizeMAC(m[4]),
			Name:  strings.Join(strings.Fields(m[3]), " "),
			Model: model,
		}
	}
	return res
}

func isDevType(s string) bool {
	switch strings.ToUpper(s) {
	case "HGU", "SFU", "SBU", "MDU", "HGU-V", "CATV":
		return true
	}
	return false
}

// opticalReading adalah satu baris "show optical-diag <pon>".
type opticalReading struct {
	MAC   string
	RxDbm *float64
	TxDbm *float64
	TempC *float64
	Name  string
}

// parseOpticalDiag membaca "show optical-diag <pon>". Rx adalah daya yang
// DITERIMA ONU dari OLT (dBm), Tx daya pancar ONU.
func parseOpticalDiag(out string) map[[2]int]opticalReading {
	res := map[[2]int]opticalReading{}
	for _, line := range strings.Split(out, "\n") {
		m := reOpticalDiag.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		res[key(atoiOr(m[1], 0), atoiOr(m[2], 0))] = opticalReading{
			MAC:   normalizeMAC(m[4]),
			Name:  strings.Join(strings.Fields(m[3]), " "),
			TempC: dbm(m[5]),
			TxDbm: dbm(m[8]),
			RxDbm: dbm(m[9]),
		}
	}
	return res
}

// cliPon adalah satu baris tabel port dari "show pon-info".
type cliPon struct {
	Index         int
	Up            bool
	Online, Total int
}

func parsePonInfo(out string) []cliPon {
	var ports []cliPon
	for _, line := range strings.Split(out, "\n") {
		m := rePonInfo.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		ports = append(ports, cliPon{
			Index: atoiOr(m[1], 0), Up: strings.EqualFold(m[2], "up"),
			Online: atoiOr(m[3], 0), Total: atoiOr(m[4], 0),
		})
	}
	return ports
}
