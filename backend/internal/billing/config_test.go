package billing

import (
	"bytes"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func envOf(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestConfigFromEnvComplete(t *testing.T) {
	cfg, err := ConfigFromEnv(envOf(map[string]string{
		"BILLING_URL":      "  https://billing.example.com/ ",
		"BILLING_USERNAME": " operator ",
		"BILLING_PASSWORD": " sandi dengan spasi ",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BaseURL != "https://billing.example.com/" || cfg.Username != "operator" {
		t.Errorf("URL/username harus dibuang spasi ujungnya: %+v", cfg)
	}
	if cfg.Password != " sandi dengan spasi " {
		t.Errorf("kata sandi harus apa adanya, dapat %q", cfg.Password)
	}
	if isZeroProfile(cfg.Profile) {
		t.Error("ConfigFromEnv harus mengisi DefaultProfile()")
	}
	if _, err := New(cfg); err != nil {
		t.Errorf("hasil ConfigFromEnv harus bisa dipakai New: %v", err)
	}
}

func TestConfigFromEnvEmptyIsNotConfigured(t *testing.T) {
	for name, env := range map[string]map[string]string{
		"semua tidak ada": {},
		"semua kosong":    {"BILLING_URL": "", "BILLING_USERNAME": "", "BILLING_PASSWORD": ""},
		"hanya spasi":     {"BILLING_URL": "  ", "BILLING_USERNAME": "\t"},
	} {
		_, err := ConfigFromEnv(envOf(env))
		if !errors.Is(err, ErrNotConfigured) {
			t.Errorf("%s: err = %v, want ErrNotConfigured", name, err)
		}
		if errors.Is(err, ErrInvalidConfig) {
			t.Errorf("%s: tidak dikonfigurasi bukan konfigurasi yang salah", name)
		}
	}
}

func TestConfigFromEnvPartialIsInvalidAndNamesMissingVariable(t *testing.T) {
	full := map[string]string{
		"BILLING_URL":      "https://billing.example.com",
		"BILLING_USERNAME": "operator",
		"BILLING_PASSWORD": "rahasia-sekali",
	}
	for _, missing := range []string{"BILLING_URL", "BILLING_USERNAME", "BILLING_PASSWORD"} {
		env := map[string]string{}
		for k, v := range full {
			if k != missing {
				env[k] = v
			}
		}
		_, err := ConfigFromEnv(envOf(env))
		if !errors.Is(err, ErrInvalidConfig) || errors.Is(err, ErrNotConfigured) {
			t.Errorf("tanpa %s: err = %v, want ErrInvalidConfig (bukan ErrNotConfigured)", missing, err)
			continue
		}
		if !strings.Contains(err.Error(), missing) {
			t.Errorf("tanpa %s: pesan harus menyebut variabelnya: %v", missing, err)
		}
		if strings.Contains(err.Error(), "rahasia-sekali") {
			t.Errorf("pesan membocorkan kata sandi: %v", err)
		}
	}
}

func TestConfigFromEnvRejectsBadURL(t *testing.T) {
	for _, bad := range []string{
		"billing.example.com",           // tanpa skema
		"ftp://billing.example.com",     // skema salah
		"file:///etc/passwd",            // skema salah
		"//billing.example.com",         // skema relatif
		"https://",                      // tanpa host
		"https://:8443",                 // tanpa host
		"https://u:sandi-url@host.test", // kredensial di URL
		"https://host.test/?token=abc",  // query
		"https://host.test/#frag",       // fragmen
		"https://host.test/?",           // query kosong
		"http://exa mple.com",           // host tidak sah
		"::::",
	} {
		_, err := ConfigFromEnv(envOf(map[string]string{
			"BILLING_URL": bad, "BILLING_USERNAME": "operator", "BILLING_PASSWORD": "sandi",
		}))
		if !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("URL %q: err = %v, want ErrInvalidConfig", bad, err)
			continue
		}
		// Pesan tidak boleh menyalin URL: bisa membawa kata sandi. (Petunjuk bentuk
		// yang benar memang memuat "https://", jadi potongan itu tidak dihitung.)
		const hint = "BILLING_URL harus berbentuk https://host atau http://host"
		for _, leak := range []string{"sandi-url", "token=abc", bad} {
			if strings.Contains(hint, leak) {
				continue
			}
			if strings.Contains(err.Error(), leak) {
				t.Errorf("URL %q: pesan %q memuat %q", bad, err.Error(), leak)
			}
		}
	}
}

func TestConfigFromEnvAcceptsHTTPAndPathPrefix(t *testing.T) {
	for _, ok := range []string{"http://10.0.0.5", "http://10.0.0.5:8080", "https://billing.example.com/app", "https://billing.example.com/app/"} {
		if _, err := ConfigFromEnv(envOf(map[string]string{
			"BILLING_URL": ok, "BILLING_USERNAME": "operator", "BILLING_PASSWORD": "sandi",
		})); err != nil {
			t.Errorf("URL %q: %v", ok, err)
		}
	}
}

func TestConfigValidate(t *testing.T) {
	base := Config{BaseURL: "https://billing.example.com", Username: "u", Password: "p"}
	if err := base.Validate(); err != nil {
		t.Fatalf("konfigurasi minimal harus sah (profil nol berarti bawaan): %v", err)
	}
	if err := (Config{}).Validate(); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("Config{} err = %v, want ErrNotConfigured", err)
	}

	negatives := map[string]func(*Config){
		"Timeout":      func(c *Config) { c.Timeout = -time.Second },
		"MaxBodyBytes": func(c *Config) { c.MaxBodyBytes = -1 },
		"MaxRedirects": func(c *Config) { c.MaxRedirects = -1 },
		"MaxPages":     func(c *Config) { c.MaxPages = -1 },
		"MaxRows":      func(c *Config) { c.MaxRows = -1 },
	}
	for name, mutate := range negatives {
		c := base
		mutate(&c)
		err := c.Validate()
		if !errors.Is(err, ErrInvalidConfig) || !strings.Contains(err.Error(), name) {
			t.Errorf("%s negatif: err = %v", name, err)
		}
	}

	// Profil setengah terisi: pesannya menunjuk kolom yang kosong.
	c := base
	c.Profile = Profile{LoginPath: "/login"}
	if err := c.Validate(); !errors.Is(err, ErrInvalidConfig) {
		t.Errorf("profil sebagian: err = %v", err)
	}

	// Nilai nol batas berarti bawaan.
	eff := base.withDefaults()
	if eff.Timeout != DefaultTimeout || eff.MaxBodyBytes != DefaultMaxBodyBytes || eff.MaxRedirects != DefaultMaxRedirects ||
		eff.MaxPages != DefaultMaxPages || eff.MaxRows != DefaultMaxRows {
		t.Errorf("bawaan tidak terisi: %+v", eff)
	}
	if DefaultMaxBodyBytes != 5<<20 {
		t.Errorf("batas ukuran bawaan harus 5 MB, dapat %d", DefaultMaxBodyBytes)
	}
}

func TestNewReturnsNotConfigured(t *testing.T) {
	if _, err := New(Config{}); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("New(Config{}) err = %v", err)
	}
}

func TestConfigNeverPrintsPassword(t *testing.T) {
	const pw = "SANDI-RAHASIA-123"
	cfg := Config{BaseURL: "https://operator:" + pw + "@billing.example.com", Username: "operator", Password: pw}

	renderings := map[string]string{
		"%v":  fmt.Sprintf("%v", cfg),
		"%+v": fmt.Sprintf("%+v", cfg),
		"%#v": fmt.Sprintf("%#v", cfg),
		"%s":  fmt.Sprintf("%s", cfg),
		"ptr": fmt.Sprintf("%+v", &cfg),
		"err": fmt.Sprint(cfg.Validate()),
	}
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	logger.Info("config", "cfg", cfg)
	logger.Info("config", slog.Any("cfg", &cfg))
	renderings["slog"] = buf.String()
	buf.Reset()
	slog.New(slog.NewTextHandler(&buf, nil)).Info("config", "cfg", cfg)
	renderings["slog-text"] = buf.String()

	for how, out := range renderings {
		if strings.Contains(out, pw) {
			t.Errorf("%s membocorkan kata sandi: %s", how, out)
		}
	}
	if !strings.Contains(renderings["%+v"], "operator") {
		t.Errorf("username boleh tampil: %s", renderings["%+v"])
	}
}

func TestScraperNeverPrintsPassword(t *testing.T) {
	const pw = "SANDI-RAHASIA-456"
	s, err := New(Config{BaseURL: "https://billing.example.com", Username: "operator", Password: pw})
	if err != nil {
		t.Fatal(err)
	}
	for how, out := range map[string]string{
		"%v":    fmt.Sprintf("%v", s),
		"%+v":   fmt.Sprintf("%+v", s),
		"%#v":   fmt.Sprintf("%#v", s),
		"%s":    fmt.Sprintf("%s", s),
		"cfg":   fmt.Sprintf("%+v", s.cfg),
		"creds": fmt.Sprintf("%+v %#v", s.creds, s.creds),
	} {
		if strings.Contains(out, pw) {
			t.Errorf("%s membocorkan kata sandi: %s", how, out)
		}
	}
}

// Verifikasi TLS tidak boleh dimatikan di mana pun di paket ini, termasuk di tes.
func TestNoTLSVerificationBypassAnywhere(t *testing.T) {
	needle := "Insecure" + "SkipVerify" // dipecah supaya berkas ini sendiri lolos
	files, err := filepath.Glob("*.go")
	if err != nil || len(files) == 0 {
		t.Fatalf("glob: %v (%d berkas)", err, len(files))
	}
	for _, name := range files {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), needle) {
			t.Errorf("%s memuat %s: verifikasi TLS tidak boleh dimatikan", name, needle)
		}
	}
}
