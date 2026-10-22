package config

import (
	"log/slog"
	"strings"
	"testing"
)

func envFrom(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(envFrom(nil))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPAddr != "127.0.0.1:8080" {
		t.Errorf("HTTPAddr = %q, want loopback default", cfg.HTTPAddr)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Errorf("LogLevel = %v, want info", cfg.LogLevel)
	}
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := Load(envFrom(map[string]string{
		"BACKEND_ADDR": " 0.0.0.0:9000 ",
		"LOG_LEVEL":    "debug",
	}))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPAddr != "0.0.0.0:9000" {
		t.Errorf("HTTPAddr = %q, want trimmed override", cfg.HTTPAddr)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Errorf("LogLevel = %v, want debug", cfg.LogLevel)
	}
}

func TestLoadRejectsInvalidLogLevel(t *testing.T) {
	_, err := Load(envFrom(map[string]string{"LOG_LEVEL": "berisik"}))
	if err == nil {
		t.Fatal("Load() error = nil, want error for invalid LOG_LEVEL")
	}
	if !strings.Contains(err.Error(), "LOG_LEVEL") {
		t.Errorf("error %q should name LOG_LEVEL", err)
	}
}

func TestLoadRealtimeDefaultsToDisabledWithDevOrigin(t *testing.T) {
	cfg, err := Load(envFrom(nil))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.RealtimeSecret != "" {
		t.Errorf("RealtimeSecret = %q, want kosong (WebSocket mati bila tidak dikonfigurasi)", cfg.RealtimeSecret)
	}
	if len(cfg.AllowedOrigins) != 1 || cfg.AllowedOrigins[0] != "http://localhost:3000" {
		t.Errorf("AllowedOrigins = %v, want [http://localhost:3000]", cfg.AllowedOrigins)
	}
}

func TestLoadRealtimeSecret(t *testing.T) {
	secret := "0123456789abcdef0123456789abcdef"
	cfg, err := Load(envFrom(map[string]string{"REALTIME_TOKEN_SECRET": " " + secret + " "}))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.RealtimeSecret != secret {
		t.Errorf("RealtimeSecret tidak dipangkas dengan benar")
	}

	_, err = Load(envFrom(map[string]string{"REALTIME_TOKEN_SECRET": "terlalu-pendek"}))
	if err == nil {
		t.Fatal("rahasia pendek harus ditolak")
	}
	if strings.Contains(err.Error(), "terlalu-pendek") {
		t.Errorf("pesan error membocorkan nilai rahasia: %q", err)
	}
}

func TestLoadAllowedOrigins(t *testing.T) {
	cfg, err := Load(envFrom(map[string]string{
		"ALLOWED_ORIGINS": "http://localhost:3000, https://noc.contoh.id/ ,",
	}))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	want := []string{"http://localhost:3000", "https://noc.contoh.id"}
	if len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != want[0] || cfg.AllowedOrigins[1] != want[1] {
		t.Errorf("AllowedOrigins = %v, want %v", cfg.AllowedOrigins, want)
	}
}

func TestLoadRejectsUnsafeOrigins(t *testing.T) {
	for _, bad := range []string{
		"*",
		"localhost:3000",
		"ftp://noc.contoh.id",
		"http://noc.contoh.id/dashboard",
		"http://user:pass@noc.contoh.id",
		"http://noc.contoh.id?x=1",
		" , ",
	} {
		if _, err := Load(envFrom(map[string]string{"ALLOWED_ORIGINS": bad})); err == nil {
			t.Errorf("ALLOWED_ORIGINS=%q seharusnya ditolak", bad)
		}
	}
}

func TestLoadEventPathsDefaultToDisabled(t *testing.T) {
	cfg, err := Load(envFrom(nil))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.PPPWebhookToken != "" || cfg.SyslogAddr != "" {
		t.Errorf("webhook dan syslog harus mati secara bawaan: %+v", cfg)
	}
}

func TestLoadPPPWebhookToken(t *testing.T) {
	token := "0123456789abcdef0123456789abcdef"
	cfg, err := Load(envFrom(map[string]string{"PPP_WEBHOOK_TOKEN": token}))
	if err != nil || cfg.PPPWebhookToken != token {
		t.Fatalf("Load() = %q, %v; want token terbaca", cfg.PPPWebhookToken, err)
	}
	_, err = Load(envFrom(map[string]string{"PPP_WEBHOOK_TOKEN": "pendek-sekali"}))
	if err == nil {
		t.Fatal("token pendek harus ditolak")
	}
	if strings.Contains(err.Error(), "pendek-sekali") {
		t.Errorf("pesan error membocorkan token: %q", err)
	}
}

func TestLoadDatabaseURLDefaultsToDisabled(t *testing.T) {
	cfg, err := Load(envFrom(nil))
	if err != nil || cfg.DatabaseURL != "" {
		t.Errorf("Load() = %q, %v; arsip harus mati secara bawaan", cfg.DatabaseURL, err)
	}
}

func TestLoadDatabaseURL(t *testing.T) {
	for _, ok := range []string{
		"postgres://noc:sandi@localhost:5432/noc",
		"postgresql://noc:sandi@db.internal/noc?sslmode=require",
		"  postgres://noc@10.0.0.5:5432/noc  ",
	} {
		cfg, err := Load(envFrom(map[string]string{"DATABASE_URL": ok}))
		if err != nil || cfg.DatabaseURL != strings.TrimSpace(ok) {
			t.Errorf("DATABASE_URL=%q: %q, %v; want diterima apa adanya (tanpa spasi)", ok, cfg.DatabaseURL, err)
		}
	}
	for _, bad := range []string{
		"localhost:5432/noc",
		"mysql://noc:rahasia-sekali@localhost/noc",
		"http://noc:rahasia-sekali@localhost/noc",
		"postgres://",
		"postgres:///noc",
		"postgres://noc:rahasia-sekali@local host/noc",
	} {
		_, err := Load(envFrom(map[string]string{"DATABASE_URL": bad}))
		if err == nil {
			t.Errorf("DATABASE_URL=%q seharusnya ditolak", bad)
			continue
		}
		if strings.Contains(err.Error(), "rahasia-sekali") {
			t.Errorf("pesan error membocorkan kata sandi: %q", err)
		}
	}
}

func TestLoadSyslogAddr(t *testing.T) {
	for _, ok := range []string{"0.0.0.0:514", ":5514", "127.0.0.1:5514", "[::]:514"} {
		cfg, err := Load(envFrom(map[string]string{"SYSLOG_ADDR": ok}))
		if err != nil || cfg.SyslogAddr != ok {
			t.Errorf("SYSLOG_ADDR=%q: %q, %v; want diterima", ok, cfg.SyslogAddr, err)
		}
	}
	for _, bad := range []string{"514", "localhost", "0.0.0.0:", "0.0.0.0:0", "0.0.0.0:70000", "0.0.0.0:abc", "0.0.0.0:-1"} {
		if _, err := Load(envFrom(map[string]string{"SYSLOG_ADDR": bad})); err == nil {
			t.Errorf("SYSLOG_ADDR=%q seharusnya ditolak", bad)
		}
	}
}

func TestLoadSyslogSourceMapAndRetention(t *testing.T) {
	cfg, err := Load(envFrom(map[string]string{
		"SYSLOG_SOURCE_MAP":     "10.20.30.1=6F1B2C3D-0000-4000-8000-000000000001, ",
		"SYSLOG_RETENTION_DAYS": "7",
	}))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(cfg.SyslogSources) != 1 {
		t.Fatalf("SyslogSources = %v", cfg.SyslogSources)
	}
	for addr, id := range cfg.SyslogSources {
		if addr.String() != "10.20.30.1" || id != "6f1b2c3d-0000-4000-8000-000000000001" {
			t.Errorf("peta = %s=%s", addr, id)
		}
	}
	if cfg.SyslogRetention.Hours() != 7*24 {
		t.Errorf("SyslogRetention = %v", cfg.SyslogRetention)
	}
	for _, bad := range []string{"10.20.30.1", "x=6f1b2c3d-0000-4000-8000-000000000001", "10.20.30.1=bukan-uuid"} {
		if _, err := Load(envFrom(map[string]string{"SYSLOG_SOURCE_MAP": bad})); err == nil {
			t.Errorf("SYSLOG_SOURCE_MAP %q diterima", bad)
		}
	}
	if _, err := Load(envFrom(map[string]string{"SYSLOG_RETENTION_DAYS": "0"})); err == nil {
		t.Error("SYSLOG_RETENTION_DAYS 0 diterima")
	}
}
