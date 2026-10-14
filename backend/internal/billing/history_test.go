package billing

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestScrubSensitive(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"url kredensial", "gagal http://admin:rahasia123@billing.local/login", "gagal http://admin:[REDACTED]@billing.local/login"},
		{"https", "https://u:p%40ss@host:8443/x", "https://u:[REDACTED]@host:8443/x"},
		{"token", "request token=abc123XYZ gagal", "request token=[REDACTED] gagal"},
		{"password", "Password: hunter2 salah", "Password: [REDACTED] salah"},
		{"api_key", "api_key=sk-12345&x=1", "api_key=[REDACTED]&x=1"},
		{"bearer", "Authorization: Bearer eyJhbGciOi.abc-def_ghi", "Authorization: Bearer [REDACTED]"},
		{"tanpa rahasia", "Sistem billing tidak dapat dihubungi.", "Sistem billing tidak dapat dihubungi."},
		{"url tanpa sandi", "http://host:8080/path", "http://host:8080/path"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := scrubSensitive(c.in); got != c.want {
				t.Errorf("scrubSensitive(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestFailureMessageScrubsAndTruncates(t *testing.T) {
	msg := failureMessage(errors.New("login http://admin:s3cret@billing.local gagal, token=TOPSECRET"))
	for _, leak := range []string{"s3cret", "TOPSECRET"} {
		if strings.Contains(msg, leak) {
			t.Errorf("pesan membocorkan %q: %s", leak, msg)
		}
	}

	long := failureMessage(errors.New("password=hunter2 " + strings.Repeat("é", 2*MaxErrorLength)))
	if strings.Contains(long, "hunter2") {
		t.Errorf("pesan panjang membocorkan sandi")
	}
	if n := utf8.RuneCountInString(long); n > MaxErrorLength {
		t.Errorf("panjang %d melebihi %d karakter", n, MaxErrorLength)
	}

	if got := failureMessage(nil); got != FallbackFailureMessage {
		t.Errorf("nil: %q", got)
	}
}
