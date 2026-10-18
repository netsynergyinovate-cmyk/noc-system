package ontweb

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// Config: apa yang dipakai satu permintaan "Pasang GenieACS lewat web ONT".
// ACS dan kredensial datang dari tabel ont_web_settings (diisi petugas di
// aplikasi, kata sandi terenkripsi); hanya AllowedNets yang dari lingkungan
// karena itu batas keamanan jaringan, bukan data operasional.
type Config struct {
	// ACSURL: alamat CWMP GenieACS yang dapat dijangkau MODEM, mis.
	// http://172.16.0.1:7547. Kosong = belum diatur.
	ACSURL         string
	ACSUsername    string
	ACSPassword    string
	InformInterval int // detik, 30..86400

	// Admin web modem bawaan untuk semua modem sejenis. Boleh kosong bila
	// petugas selalu mengetiknya.
	Username string
	Password string

	// Admin web ZIMLINK ZL-2113X (dilaporkan OLT sebagai "HWTC H113"): akun berbeda.
	ZimlinkUsername string
	ZimlinkPassword string

	// Admin web GGCLink GM220-S XPON (dilaporkan OLT sebagai "ZICG GM22").
	GGCLinkUsername string
	GGCLinkPassword string

	// Admin web ZTE F609 versi MediaTek (dilaporkan OLT sebagai "MTKc F609").
	F609Username string
	F609Password string

	// AllowedNets: modem hanya boleh dijangkau di jaringan ini. Mencegah
	// endpoint ini dipakai membuka alamat internal lain (SSRF).
	AllowedNets []*net.IPNet
}

// Enabled: pengaturan lengkap hanya bila ACS URL diisi.
func (c Config) Enabled() bool { return c.ACSURL != "" }

// defaultNets: alamat pribadi umum (RFC 1918) dan CGNAT. Loopback, link-local
// (termasuk metadata cloud 169.254.169.254) dan alamat publik sengaja tidak ada.
var defaultNets = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"}

// PolicyFromEnv membaca ONT_WEB_ALLOWED_CIDRS (pisah koma; bawaan alamat
// pribadi). Nilai yang salah mengembalikan galat supaya fitur dimatikan dengan
// pesan jelas, bukan membuka jaringan yang tidak dimaksud.
func PolicyFromEnv(getenv func(string) string) ([]*net.IPNet, error) {
	list := defaultNets
	if v := strings.TrimSpace(getenv("ONT_WEB_ALLOWED_CIDRS")); v != "" {
		list = strings.Split(v, ",")
	}
	var nets []*net.IPNet
	for _, s := range list {
		_, n, err := net.ParseCIDR(strings.TrimSpace(s))
		if err != nil {
			return nil, fmt.Errorf("ONT_WEB_ALLOWED_CIDRS: %q bukan CIDR", strings.TrimSpace(s))
		}
		nets = append(nets, n)
	}
	return nets, nil
}

// ValidateACSURL: http(s)://host[:port] tanpa nama pengguna, paling panjang 256
// karakter (batas kolom di modem).
func ValidateACSURL(raw string) error {
	if len(raw) > 256 {
		return fmt.Errorf("ACS URL terlalu panjang (modem membatasi 256 karakter)")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return fmt.Errorf("ACS URL harus http(s)://host:port tanpa nama pengguna")
	}
	return nil
}

// ParseTarget memeriksa alamat modem dari operator: HARUS IPv4 literal (tanpa
// nama host, jadi tak ada DNS rebinding) dan berada di salah satu jaringan yang
// diizinkan. Mengembalikan alamat kanonik.
func (c Config) ParseTarget(host string) (string, error) {
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil || ip.To4() == nil {
		return "", fmt.Errorf("alamat modem harus IPv4 seperti 172.16.15.248")
	}
	ip = ip.To4()
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() {
		return "", fmt.Errorf("alamat modem tidak diizinkan")
	}
	for _, n := range c.AllowedNets {
		if n.Contains(ip) {
			return ip.String(), nil
		}
	}
	return "", fmt.Errorf("alamat modem di luar jaringan yang diizinkan (ONT_WEB_ALLOWED_CIDRS)")
}
