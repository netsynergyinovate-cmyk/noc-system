// Package config membaca pengaturan backend dari environment variable.
package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"

	"noc-isp/backend/internal/auth"
)

const (
	// defaultHTTPAddr hanya mendengarkan di loopback. Di Docker atau server,
	// ubah lewat BACKEND_ADDR (mis. 0.0.0.0:8080) secara sadar.
	defaultHTTPAddr = "127.0.0.1:8080"
	defaultLogLevel = "info"
	// defaultAllowedOrigin adalah alamat dashboard Next.js saat pengembangan.
	defaultAllowedOrigin = "http://localhost:3000"
)

// Config berisi pengaturan yang sudah divalidasi.
type Config struct {
	HTTPAddr string
	LogLevel slog.Level

	// RealtimeSecret adalah rahasia bersama dengan Next.js untuk memeriksa tiket
	// login WebSocket. Kosong berarti endpoint /ws dimatikan.
	RealtimeSecret string
	// AllowedOrigins adalah origin browser yang boleh membuka WebSocket.
	AllowedOrigins []string

	// PPPWebhookToken adalah token yang dikirim script PPP di router ke
	// /hooks/ppp. Kosong berarti webhook dimatikan.
	PPPWebhookToken string
	// SyslogAddr adalah alamat UDP untuk syslog dari router, mis. 0.0.0.0:514.
	// Kosong berarti listener syslog dimatikan.
	SyslogAddr string

	// DatabaseURL adalah alamat PostgreSQL untuk arsip traffic (histori). Kosong
	// berarti arsip dimatikan; pemantauan real-time tidak membutuhkannya.
	DatabaseURL string

	// NetflowEnabled menyalakan kolektor NetFlow v5 (goroutine terpisah).
	// Dibaca dari NETFLOW_ENABLED; bila kosong, menyala jika NETFLOW_PORT terisi.
	NetflowEnabled bool
	// NetflowAddr adalah alamat UDP kolektor, bawaan ":2055".
	NetflowAddr string

	// DeviceSecret adalah kunci yang sama dengan DEVICE_SECRET aplikasi Next.js
	// (cadangan: ROUTER_SECRET_KEY), untuk membuka kata sandi router di database.
	// Kosong berarti polling router dari database dimatikan.
	DeviceSecret string

	// DashboardMode dibaca dari DASHBOARD_DATA: "demo" (bawaan) atau "live".
	DashboardMode string
	// Mikrotik dan OLT nil bila variabel perangkatnya tidak disetel sama sekali.
	Mikrotik *DeviceConfig // MIKROTIK_REST_*
	OLT      *DeviceConfig // OLT_HSGQ_*
}

// DeviceConfig adalah alamat dan kredensial satu perangkat jaringan.
type DeviceConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	UseTLS   bool
}

// parseDeviceConfig membaca <prefix>_HOST/_PORT/_USER/_PASSWORD/_USE_TLS.
// Semua kosong -> nil (perangkat tidak dipakai). Pesan error tidak pernah
// memuat kata sandi.
func parseDeviceConfig(getenv func(string) string, prefix string, defaultPort int, defaultTLS bool) (*DeviceConfig, error) {
	host := strings.TrimSpace(getenv(prefix + "_HOST"))
	user := strings.TrimSpace(getenv(prefix + "_USER"))
	password := getenv(prefix + "_PASSWORD") // tidak di-trim: spasi bisa bagian dari sandi
	if host == "" && user == "" && password == "" {
		return nil, nil
	}
	if host == "" {
		return nil, fmt.Errorf("%s_HOST wajib diisi jika %s_USER atau %s_PASSWORD disetel", prefix, prefix, prefix)
	}
	if user == "" {
		return nil, fmt.Errorf("%s_USER wajib diisi jika %s_HOST disetel", prefix, prefix)
	}
	if password == "" {
		return nil, fmt.Errorf("%s_PASSWORD wajib diisi jika %s_HOST disetel", prefix, prefix)
	}

	port := defaultPort
	if raw := strings.TrimSpace(getenv(prefix + "_PORT")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 65535 {
			return nil, fmt.Errorf("%s_PORT %q tidak valid (angka 1-65535)", prefix, raw)
		}
		port = n
	}

	useTLS := defaultTLS
	if raw := strings.TrimSpace(getenv(prefix + "_USE_TLS")); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			return nil, fmt.Errorf("%s_USE_TLS %q tidak valid (pakai true atau false)", prefix, raw)
		}
		useTLS = v
	}

	return &DeviceConfig{Host: host, Port: port, User: user, Password: password, UseTLS: useTLS}, nil
}

// Load membaca konfigurasi lewat getenv (os.Getenv di program, fungsi palsu
// di test). Nilai kosong memakai default; nilai tidak valid mengembalikan error.
func Load(getenv func(string) string) (Config, error) {
	addr := strings.TrimSpace(getenv("BACKEND_ADDR"))
	if addr == "" {
		addr = defaultHTTPAddr
	}

	levelText := strings.TrimSpace(getenv("LOG_LEVEL"))
	if levelText == "" {
		levelText = defaultLogLevel
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(levelText)); err != nil {
		return Config{}, fmt.Errorf("LOG_LEVEL %q tidak valid (pakai debug, info, warn, atau error)", levelText)
	}

	secret := strings.TrimSpace(getenv("REALTIME_TOKEN_SECRET"))
	if secret != "" && len(secret) < auth.MinSecretLength {
		// Pesan sengaja tidak memuat nilai rahasianya.
		return Config{}, fmt.Errorf("REALTIME_TOKEN_SECRET minimal %d karakter", auth.MinSecretLength)
	}

	origins, err := parseOrigins(getenv("ALLOWED_ORIGINS"))
	if err != nil {
		return Config{}, err
	}

	webhookToken := strings.TrimSpace(getenv("PPP_WEBHOOK_TOKEN"))
	if webhookToken != "" && len(webhookToken) < auth.MinSecretLength {
		return Config{}, fmt.Errorf("PPP_WEBHOOK_TOKEN minimal %d karakter", auth.MinSecretLength)
	}

	syslogAddr := strings.TrimSpace(getenv("SYSLOG_ADDR"))
	if syslogAddr != "" {
		_, port, err := net.SplitHostPort(syslogAddr)
		if n, convErr := strconv.Atoi(port); err != nil || convErr != nil || n < 1 || n > 65535 {
			return Config{}, fmt.Errorf("SYSLOG_ADDR %q tidak valid (contoh: 0.0.0.0:514 atau :5514)", syslogAddr)
		}
	}

	databaseURL, err := parseDatabaseURL(getenv("DATABASE_URL"))
	if err != nil {
		return Config{}, err
	}

	netflowPort := strings.TrimSpace(getenv("NETFLOW_PORT"))
	netflowAddr := strings.TrimSpace(getenv("NETFLOW_ADDR"))
	if netflowAddr == "" {
		netflowAddr = ":2055"
		if netflowPort != "" {
			netflowAddr = ":" + netflowPort
		}
	}
	netflowEnabled := netflowPort != ""
	if raw := strings.TrimSpace(getenv("NETFLOW_ENABLED")); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			return Config{}, fmt.Errorf("NETFLOW_ENABLED %q tidak valid (pakai true atau false)", raw)
		}
		netflowEnabled = v
	}
	if netflowEnabled {
		_, port, err := net.SplitHostPort(netflowAddr)
		if n, convErr := strconv.Atoi(port); err != nil || convErr != nil || n < 1 || n > 65535 {
			return Config{}, fmt.Errorf("NETFLOW_ADDR %q tidak valid (contoh: :2055)", netflowAddr)
		}
	}

	mode := strings.ToLower(strings.TrimSpace(getenv("DASHBOARD_DATA")))
	switch mode {
	case "":
		mode = "demo"
	case "demo", "live":
	default:
		return Config{}, fmt.Errorf("DASHBOARD_DATA %q tidak valid (pakai demo atau live)", mode)
	}

	mikrotik, err := parseDeviceConfig(getenv, "MIKROTIK_REST", 443, true)
	if err != nil {
		return Config{}, err
	}
	olt, err := parseDeviceConfig(getenv, "OLT_HSGQ", 80, false)
	if err != nil {
		return Config{}, err
	}

	deviceSecret := strings.TrimSpace(getenv("DEVICE_SECRET"))
	if deviceSecret == "" {
		deviceSecret = strings.TrimSpace(getenv("ROUTER_SECRET_KEY"))
	}

	return Config{
		DeviceSecret:    deviceSecret,
		DashboardMode:   mode,
		Mikrotik:        mikrotik,
		OLT:             olt,
		NetflowEnabled:  netflowEnabled,
		NetflowAddr:     netflowAddr,
		HTTPAddr:        addr,
		LogLevel:        level,
		RealtimeSecret:  secret,
		AllowedOrigins:  origins,
		PPPWebhookToken: webhookToken,
		SyslogAddr:      syslogAddr,
		DatabaseURL:     databaseURL,
	}, nil
}

// parseDatabaseURL menerima kosong (arsip mati) atau URL postgres:// atau
// postgresql://. Pesan error sengaja tidak memuat nilainya karena URL itu
// membawa kata sandi.
func parseDatabaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" {
		return "", fmt.Errorf("DATABASE_URL tidak valid (contoh: postgres://pengguna:sandi@localhost:5432/noc)")
	}
	return raw, nil
}

// parseOrigins membaca daftar origin dipisah koma. Tiap origin harus berbentuk
// skema://host[:port] tanpa path; "*" ditolak karena akan mengizinkan situs mana
// pun membuka koneksi dari browser pengguna.
func parseOrigins(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{defaultAllowedOrigin}, nil
	}
	var origins []string
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		u, err := url.Parse(item)
		valid := err == nil && (u.Scheme == "http" || u.Scheme == "https") &&
			u.Host != "" && (u.Path == "" || u.Path == "/") &&
			u.RawQuery == "" && u.Fragment == "" && u.User == nil
		if !valid {
			return nil, fmt.Errorf("ALLOWED_ORIGINS: %q bukan origin yang valid (contoh: http://localhost:3000)", item)
		}
		origins = append(origins, u.Scheme+"://"+u.Host)
	}
	if len(origins) == 0 {
		return nil, fmt.Errorf("ALLOWED_ORIGINS tidak berisi origin")
	}
	return origins, nil
}
