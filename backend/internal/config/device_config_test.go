package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestDashboardModeDefaultAndLive(t *testing.T) {
	cfg, err := Load(env(nil))
	if err != nil || cfg.DashboardMode != "demo" {
		t.Fatalf("default: mode=%q err=%v", cfg.DashboardMode, err)
	}
	if cfg.Mikrotik != nil || cfg.OLT != nil {
		t.Fatal("perangkat harus nil bila env kosong")
	}
	cfg, err = Load(env(map[string]string{"DASHBOARD_DATA": " LIVE "}))
	if err != nil || cfg.DashboardMode != "live" {
		t.Fatalf("live: mode=%q err=%v", cfg.DashboardMode, err)
	}
	if _, err = Load(env(map[string]string{"DASHBOARD_DATA": "prod"})); err == nil {
		t.Fatal("nilai tidak valid harus ditolak")
	}
}

func TestDeviceConfigFullValid(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"MIKROTIK_REST_HOST": "10.0.0.1", "MIKROTIK_REST_PORT": "8443",
		"MIKROTIK_REST_USER": "mon", "MIKROTIK_REST_PASSWORD": "rahasia-1",
		"MIKROTIK_REST_USE_TLS": "false",
		"OLT_HSGQ_HOST":         "10.0.1.1", "OLT_HSGQ_USER": "admin", "OLT_HSGQ_PASSWORD": "rahasia-2",
	}))
	if err != nil {
		t.Fatal(err)
	}
	want := DeviceConfig{Host: "10.0.0.1", Port: 8443, User: "mon", Password: "rahasia-1", UseTLS: false}
	if cfg.Mikrotik == nil || *cfg.Mikrotik != want {
		t.Fatalf("mikrotik = %+v", cfg.Mikrotik)
	}
	wantOLT := DeviceConfig{Host: "10.0.1.1", Port: 80, User: "admin", Password: "rahasia-2", UseTLS: false}
	if cfg.OLT == nil || *cfg.OLT != wantOLT {
		t.Fatalf("olt = %+v", cfg.OLT)
	}
	// Default mikrotik: port 443, TLS menyala.
	d, err := parseDeviceConfig(env(map[string]string{
		"MIKROTIK_REST_HOST": "h", "MIKROTIK_REST_USER": "u", "MIKROTIK_REST_PASSWORD": "p",
	}), "MIKROTIK_REST", 443, true)
	if err != nil || d.Port != 443 || !d.UseTLS {
		t.Fatalf("default = %+v err=%v", d, err)
	}
}

func TestDeviceConfigPartialMissingCredentials(t *testing.T) {
	cases := map[string]map[string]string{
		"user kosong":     {"OLT_HSGQ_HOST": "h", "OLT_HSGQ_PASSWORD": "p"},
		"password kosong": {"OLT_HSGQ_HOST": "h", "OLT_HSGQ_USER": "u"},
		"host kosong":     {"OLT_HSGQ_USER": "u", "OLT_HSGQ_PASSWORD": "p"},
	}
	for name, m := range cases {
		if _, err := Load(env(m)); err == nil || !strings.Contains(err.Error(), "OLT_HSGQ_") {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestDeviceConfigInvalidPort(t *testing.T) {
	for _, port := range []string{"abc", "0", "65536", "-1", "80.5"} {
		_, err := Load(env(map[string]string{
			"MIKROTIK_REST_HOST": "h", "MIKROTIK_REST_USER": "u", "MIKROTIK_REST_PASSWORD": "p",
			"MIKROTIK_REST_PORT": port,
		}))
		if err == nil {
			t.Errorf("port %q harus ditolak", port)
		}
	}
	_, err := Load(env(map[string]string{
		"MIKROTIK_REST_HOST": "h", "MIKROTIK_REST_USER": "u", "MIKROTIK_REST_PASSWORD": "p",
		"MIKROTIK_REST_USE_TLS": "maybe",
	}))
	if err == nil {
		t.Error("USE_TLS tidak valid harus ditolak")
	}
}

func TestDeviceConfigRedactedSecrets(t *testing.T) {
	const secret = "S3cr3t-Pa55word"
	bad := []map[string]string{
		{"MIKROTIK_REST_HOST": "h", "MIKROTIK_REST_PASSWORD": secret},
		{"MIKROTIK_REST_PASSWORD": secret},
		{"MIKROTIK_REST_HOST": "h", "MIKROTIK_REST_USER": "u", "MIKROTIK_REST_PASSWORD": secret, "MIKROTIK_REST_PORT": "x"},
		{"MIKROTIK_REST_HOST": "h", "MIKROTIK_REST_USER": "u", "MIKROTIK_REST_PASSWORD": secret, "MIKROTIK_REST_USE_TLS": "x"},
	}
	for i, m := range bad {
		_, err := Load(env(m))
		if err == nil {
			t.Fatalf("kasus %d: harus error", i)
		}
		if strings.Contains(err.Error(), secret) {
			t.Errorf("kasus %d: error membocorkan password: %v", i, err)
		}
	}
}
