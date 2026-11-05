package routerproxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/netsource"
)

// PreflightTimeout: PRD membatasi uji koneksi ke 5 detik.
const PreflightTimeout = 5 * time.Second

// REST_GROUP_REQUIRED sama dengan src/lib/mikrotik/provision-plan.ts.
var requiredPolicies = []string{"read", "write", "api", "rest-api"}

type PreflightInput struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
	UseSsl   bool   `json:"useSsl"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type GroupCheck struct {
	Group   string   `json:"group"`
	Policy  string   `json:"policy"`
	Missing []string `json:"missing"`
	Fix     *string  `json:"fix"`
}

type PreflightResult struct {
	OK            bool        `json:"ok"`
	Code          string      `json:"code"`
	Message       string      `json:"message"`
	LatencyMs     int64       `json:"latencyMs"`
	Port          int         `json:"port"`
	TLS           bool        `json:"tls"`
	Endpoint      string      `json:"endpointTested"`
	Version       string      `json:"version,omitempty"`
	CPULoad       int         `json:"cpuLoad,omitempty"`
	Uptime        string      `json:"uptime,omitempty"`
	BoardName     string      `json:"boardName,omitempty"`
	FreeMemory    uint64      `json:"freeMemory,omitempty"`
	TotalMemory   uint64      `json:"totalMemory,omitempty"`
	GroupCheck    *GroupCheck `json:"groupCheck"`
	SourceIP      string      `json:"sourceIp"`
	LocalSourceIP string      `json:"localSourceIp"`
}

// Preflighter menjalankan uji koneksi fisik dari backend Go, sehingga Next.js
// tidak perlu membuka koneksi router sendiri.
type Preflighter struct {
	logger *slog.Logger
}

func NewPreflighter(logger *slog.Logger) *Preflighter { return &Preflighter{logger: logger} }

func (p *Preflighter) Preflight(ctx context.Context, in PreflightInput) PreflightResult {
	started := time.Now()
	fail := func(code, message string, port int, tls bool, endpoint string) PreflightResult {
		return PreflightResult{OK: false, Code: code, Message: message, LatencyMs: max(1, time.Since(started).Milliseconds()), Port: port, TLS: tls, Endpoint: endpoint}
	}

	host := strings.TrimSpace(in.Host)
	if host == "" || strings.ContainsAny(host, " \t?#@") {
		return fail("INVALID_HOST", "Alamat router tidak valid.", in.Port, in.UseSsl, "API")
	}
	if strings.HasPrefix(host, "169.254.") || strings.Contains(strings.ToLower(host), "metadata.google.internal") {
		return fail("INVALID_HOST", "Alamat link-local/metadata cloud tidak diizinkan.", in.Port, in.UseSsl, "API")
	}
	base, err := collector.BaseURLFromHost(host)
	if err != nil {
		return fail("INVALID_HOST", err.Error(), in.Port, in.UseSsl, "API")
	}
	base = withPort(base, in.Port, in.UseSsl)
	proto := "rest"
	if strings.EqualFold(strings.TrimSpace(in.Protocol), "api") {
		proto = "api"
	}
	if proto == "api" {
		base, err = collector.APIBaseURL(base)
		if err != nil {
			return fail("INVALID_HOST", err.Error(), in.Port, in.UseSsl, "API")
		}
	}
	u, _ := url.Parse(base)
	if u == nil || u.Hostname() == "" {
		return fail("INVALID_HOST", "Alamat router tidak valid.", in.Port, in.UseSsl, "API")
	}
	if strings.HasPrefix(u.Hostname(), "169.254.") || strings.EqualFold(u.Hostname(), "metadata.google.internal") {
		return fail("INVALID_HOST", "Alamat link-local/metadata cloud tidak diizinkan.", in.Port, in.UseSsl, "API")
	}
	port := 80
	if u.Port() != "" {
		port, _ = strconv.Atoi(u.Port())
	} else if u.Scheme == "https" {
		port = 443
	}
	tls := u.Scheme == "https" || port == 8729
	endpoint := fmt.Sprintf("%s://%s:%d", u.Scheme, u.Hostname(), port)
	if proto == "api" {
		endpoint = fmt.Sprintf("API %s:%d", u.Hostname(), port)
	}

	target := collector.Target{
		RouterID: "preflight",
		BaseURL:  base,
		Protocol: proto,
		Username: in.Username,
		Password: in.Password,
	}
	client, err := collector.NewClient(target, collector.DefaultHTTPClient())
	if err != nil {
		return fail("INVALID_HOST", err.Error(), port, tls, endpoint)
	}
	reqCtx, cancel := context.WithTimeout(ctx, PreflightTimeout)
	defer cancel()
	resource, err := client.Resource(reqCtx)
	if err != nil {
		code, message := mapPreflightError(err, proto)
		if p.logger != nil {
			p.logger.Warn("pre-flight router gagal", "endpoint", endpoint, "error", err)
		}
		return fail(code, message, port, tls, endpoint)
	}

	result := PreflightResult{
		OK:            true,
		Code:          "OK",
		Message:       "Sukses: handshake router berhasil.",
		LatencyMs:     max(1, time.Since(started).Milliseconds()),
		Port:          port,
		TLS:           tls,
		Endpoint:      endpoint,
		Version:       resource.Version,
		CPULoad:       resource.CPULoad,
		Uptime:        formatUptime(resource.Uptime),
		BoardName:     resource.Board,
		FreeMemory:    resource.FreeMemory,
		TotalMemory:   resource.TotalMemory,
		SourceIP:      netsource.SourceIP(in.Host),
		LocalSourceIP: netsource.LocalSourceIP(in.Host),
	}
	result.GroupCheck = readGroupCheck(reqCtx, client, in.Username)
	return result
}

func withPort(base string, port int, useSsl bool) string {
	u, err := url.Parse(base)
	if err != nil {
		return base
	}
	if useSsl {
		u.Scheme = "https"
	}
	if port > 0 && u.Port() == "" {
		u.Host = net.JoinHostPort(u.Hostname(), strconv.Itoa(port))
	}
	return u.String()
}

func mapPreflightError(err error, protocol string) (string, string) {
	msg := strings.ToLower(err.Error())
	switch {
	case errors.Is(err, context.DeadlineExceeded), strings.Contains(msg, "tidak menjawab"), strings.Contains(msg, "i/o timeout"), strings.Contains(msg, "did not properly respond"), strings.Contains(msg, "wsatimedout"):
		return "TIMEOUT", "Router tidak menjawab dalam 5 detik. Periksa alamat, port, dan firewall."
	case strings.Contains(msg, "menolak login"), strings.Contains(msg, "auth"):
		return "AUTH_FAILED", "Router menolak login: periksa username, kata sandi, dan policy akun."
	case strings.Contains(msg, "eof"), strings.Contains(msg, "menutup koneksi"), strings.Contains(msg, "connection reset"), strings.Contains(msg, "forcibly closed"), strings.Contains(msg, "wsarecv"), strings.Contains(msg, "wsasend"):
		return "CONNECTION_CLOSED", "Router menerima sambungan lalu menutupnya: alamat server ini belum diizinkan di kolom address= layanan router."
	case strings.Contains(msg, "menolak koneksi"), strings.Contains(msg, "connection refused"), strings.Contains(msg, "wsaeconnrefused"), strings.Contains(msg, "actively refused"):
		if protocol == "api" {
			return "CONNECTION_REFUSED", "Router menolak koneksi API. Aktifkan /ip service api (8728) atau api-ssl (8729)."
		}
		return "CONNECTION_REFUSED", "Router menolak koneksi REST. Pastikan layanan www/www-ssl aktif di port itu."
	case strings.Contains(msg, "404"):
		return "NOT_FOUND", "REST menjawab 404: layanan www/www-ssl belum aktif atau RouterOS di bawah v7.1."
	case strings.Contains(msg, "alamat router tidak ditemukan"), strings.Contains(msg, "no such host"), strings.Contains(msg, "getaddrinfo"), strings.Contains(msg, "wsahostnotfound"):
		return "DNS_ERROR", "Nama host router tidak ditemukan."
	}
	return "CONNECTION_FAILED", "Gagal menghubungi router: " + err.Error()
}

func readGroupCheck(ctx context.Context, client *collector.Client, username string) *GroupCheck {
	body, err := client.GetQuery(ctx, "group", url.Values{"name": {username}}, "user")
	if err != nil {
		return nil
	}
	var users []struct {
		Group string `json:"group"`
	}
	if json.Unmarshal(body, &users) != nil || len(users) == 0 || users[0].Group == "" {
		return nil
	}
	group := users[0].Group
	body, err = client.GetQuery(ctx, "policy", url.Values{"name": {group}}, "user", "group")
	if err != nil {
		return nil
	}
	var groups []struct {
		Policy string `json:"policy"`
	}
	if json.Unmarshal(body, &groups) != nil || len(groups) == 0 {
		return nil
	}
	policy := groups[0].Policy
	have := map[string]bool{}
	for _, p := range strings.Split(policy, ",") {
		p = strings.TrimSpace(p)
		if p != "" && !strings.HasPrefix(p, "!") {
			have[p] = true
		}
	}
	var missing []string
	for _, p := range requiredPolicies {
		if !have[p] {
			missing = append(missing, p)
		}
	}
	var fix *string
	if len(missing) > 0 {
		merged := append([]string{}, missing...)
		for p := range have {
			merged = append(merged, p)
		}
		s := "/user group set [find name=" + group + "] policy=" + strings.Join(merged, ",")
		fix = &s
	}
	return &GroupCheck{Group: group, Policy: policy, Missing: missing, Fix: fix}
}

// formatUptime mengubah durasi RouterOS ("1w2d3h") menjadi bentuk yang ringkas;
// nilai yang tidak dikenali dikembalikan apa adanya.
func formatUptime(d time.Duration) string {
	if d <= 0 {
		return ""
	}
	return d.Round(time.Second).String()
}
