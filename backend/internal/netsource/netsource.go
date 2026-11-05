// Package netsource menentukan alamat sumber yang dipakai backend saat menuju
// router. Untuk router di jaringan lokal dipakai alamat interface lokal; untuk
// router publik (atau hostname) dipakai alamat publik keluar, karena itulah
// yang dilihat router di balik NAT.
package netsource

import (
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	cacheTTL    = 10 * time.Minute
	retryTTL    = time.Minute
	lookupLimit = 2 * time.Second
)

var (
	cacheMu    sync.Mutex
	cached     string
	nextLookup time.Time
)

// PublicIP mengembalikan alamat publik backend. Sumbernya PUBLIC_IP_URL
// (bawaan https://api.ipify.org); set "off" untuk mematikan dan memakai alamat
// lokal saja. Hasil di-cache 10 menit (gagal: coba lagi 1 menit) supaya
// telemetri tidak memanggil layanan luar tiap detik.
func PublicIP() string {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if time.Now().Before(nextLookup) {
		return cached
	}
	url := strings.TrimSpace(os.Getenv("PUBLIC_IP_URL"))
	if strings.EqualFold(url, "off") {
		cached, nextLookup = "", time.Now().Add(cacheTTL)
		return ""
	}
	if url == "" {
		url = "https://api.ipify.org"
	}
	client := &http.Client{Timeout: lookupLimit}
	resp, err := client.Get(url)
	if err != nil {
		nextLookup = time.Now().Add(retryTTL)
		return cached
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
	ip := strings.TrimSpace(string(body))
	if resp.StatusCode == http.StatusOK && net.ParseIP(ip) != nil {
		cached = ip
		nextLookup = time.Now().Add(cacheTTL)
	} else {
		nextLookup = time.Now().Add(retryTTL)
	}
	return cached
}

// SourceIP mengembalikan alamat yang dipakai untuk menuju host. host boleh
// berbentuk "10.0.0.1", "10.0.0.1:8728", atau "https://host:port".
func SourceIP(host string) string {
	h, port := splitHost(host)
	ip := net.ParseIP(h)
	if ip == nil || !isLocal(ip) {
		if pub := PublicIP(); pub != "" {
			return pub
		}
	}
	return LocalIP(h, port)
}

// LocalSourceIP mengembalikan alamat interface lokal menuju host (tanpa paket).
// Dipakai bersama IP publik: router di jaringan yang sama bisa melihat alamat
// LAN server, bukan IP publik hasil NAT.
func LocalSourceIP(host string) string {
	h, port := splitHost(host)
	return LocalIP(h, port)
}

// LocalIP mencari alamat interface lokal menuju host tanpa mengirim paket.
func LocalIP(host, port string) string {
	if net.ParseIP(host) == nil {
		return ""
	}
	if port == "" {
		port = "80"
	}
	conn, err := net.DialTimeout("udp", net.JoinHostPort(host, port), 200*time.Millisecond)
	if err != nil {
		return ""
	}
	defer conn.Close()
	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return addr.IP.String()
	}
	return ""
}

func isLocal(ip net.IP) bool {
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

func splitHost(host string) (string, string) {
	h := strings.TrimSpace(host)
	if i := strings.Index(h, "://"); i >= 0 {
		h = h[i+3:]
	}
	h = strings.TrimSuffix(h, "/")
	port := ""
	if hostOnly, p, err := net.SplitHostPort(h); err == nil {
		h, port = hostOnly, p
	}
	return strings.Trim(h, "[]"), port
}
