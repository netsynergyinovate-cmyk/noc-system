package ontweb

import "testing"

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestPolicyFromEnv(t *testing.T) {
	nets, err := PolicyFromEnv(env(nil))
	if err != nil || len(nets) != len(defaultNets) {
		t.Fatalf("bawaan: %v %v", nets, err)
	}
	if _, err := PolicyFromEnv(env(map[string]string{"ONT_WEB_ALLOWED_CIDRS": "bukan-cidr"})); err == nil {
		t.Error("CIDR salah harus galat")
	}
	if _, err := PolicyFromEnv(env(map[string]string{"ONT_WEB_ALLOWED_CIDRS": "10.0.0.0/8,xx"})); err == nil {
		t.Error("satu CIDR salah di daftar harus galat")
	}
}

func TestValidateACSURL(t *testing.T) {
	for _, ok := range []string{"http://172.16.0.1:7547", "https://acs.example.net", "http://a:7547/"} {
		if err := ValidateACSURL(ok); err != nil {
			t.Errorf("%q: %v", ok, err)
		}
	}
	long := "http://a/" + string(make([]byte, 300))
	for _, bad := range []string{"", "ftp://x:7547", "http://u:p@x:7547", "x:7547", "http://", "javascript:alert(1)", long} {
		if ValidateACSURL(bad) == nil {
			t.Errorf("%q harus ditolak", bad)
		}
	}
}

func TestParseTarget(t *testing.T) {
	nets, _ := PolicyFromEnv(env(nil))
	cfg := Config{AllowedNets: nets}
	ok := map[string]string{"172.16.15.248": "172.16.15.248", " 192.168.1.1 ": "192.168.1.1", "10.1.2.3": "10.1.2.3", "100.64.0.9": "100.64.0.9"}
	for in, want := range ok {
		got, err := cfg.ParseTarget(in)
		if err != nil || got != want {
			t.Errorf("%q: got %q err %v", in, got, err)
		}
	}
	for _, in := range []string{
		"", "modem.local", "127.0.0.1", "0.0.0.0", "169.254.169.254", "224.0.0.1",
		"8.8.8.8", "::1", "fe80::1", "::ffff:8.8.8.8", "172.32.0.1", "172.16.15.248:80", "172.16.15.248/x", "http://172.16.15.248",
	} {
		if got, err := cfg.ParseTarget(in); err == nil {
			t.Errorf("%q harus ditolak, dapat %q", in, got)
		}
	}
	custom, _ := PolicyFromEnv(env(map[string]string{"ONT_WEB_ALLOWED_CIDRS": "172.16.15.0/24"}))
	c2 := Config{AllowedNets: custom}
	if _, err := c2.ParseTarget("172.16.16.1"); err == nil {
		t.Error("di luar CIDR khusus harus ditolak")
	}
	if _, err := c2.ParseTarget("172.16.15.7"); err != nil {
		t.Error(err)
	}
	if _, err := (Config{}).ParseTarget("172.16.15.7"); err == nil {
		t.Error("tanpa jaringan diizinkan, semua ditolak")
	}
}
