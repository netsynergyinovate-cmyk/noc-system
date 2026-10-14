package billing

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

// Teks pesan galat sinkron harus lolos check database (paling banyak 500 KARAKTER,
// minimal satu karakter yang terlihat, UTF-8 sah, tanpa NUL) tanpa berubah bila
// sudah sah.
func TestFailureMessage(t *testing.T) {
	long := strings.Repeat("界", 700)
	emoji := strings.Repeat("😀", 700)
	exact := strings.Repeat("a", 500)
	cases := []struct {
		name  string
		cause error
		want  string
	}{
		{"nil", nil, FallbackFailureMessage},
		{"kosong", errors.New(""), FallbackFailureMessage},
		{"spasi", errors.New("  \t\n "), FallbackFailureMessage},
		{"spasi unicode", errors.New(string(rune(0xA0)) + string(rune(0x3000)) + string(rune(0x2003))), FallbackFailureMessage},
		{"hanya NUL", errors.New("\x00\x00"), FallbackFailureMessage},
		{"biasa", ErrLoginFailed, ErrLoginFailed.Error()},
		{"dibungkus", fmt.Errorf("sinkron: %w", ErrNetwork), "sinkron: " + ErrNetwork.Error()},
		{"tepat 500", errors.New(exact), exact},
		{"501 dipangkas", errors.New(exact + "b"), exact},
		{"multibyte dipangkas per karakter", errors.New(long), strings.Repeat("界", 500)},
		{"4 byte dipangkas per karakter", errors.New(emoji), strings.Repeat("😀", 500)},
		{"UTF-8 rusak diganti", errors.New("abc\xffdef"), "abc" + string(utf8.RuneError) + "def"},
		{"NUL dibuang", errors.New("ab\x00cd"), "abcd"},
		{"spasi di depan dipertahankan", errors.New("  gagal"), "  gagal"},
		{"500 spasi lalu teks", errors.New(strings.Repeat(" ", 500) + "x"), FallbackFailureMessage},
	}
	for _, c := range cases {
		got := failureMessage(c.cause)
		if got != c.want {
			t.Errorf("%s: failureMessage = %q, want %q", c.name, truncateForLog(got), truncateForLog(c.want))
		}
		if n := utf8.RuneCountInString(got); n > MaxErrorLength || n == 0 {
			t.Errorf("%s: %d karakter", c.name, n)
		}
		if !utf8.ValidString(got) || strings.ContainsRune(got, 0) {
			t.Errorf("%s: pesan tidak sah", c.name)
		}
	}
}

func truncateForLog(s string) string {
	if r := []rune(s); len(r) > 40 {
		return string(r[:40]) + fmt.Sprintf("... (%d karakter)", len(r))
	}
	return s
}

func TestCountsOfMatchesWhatMatchInvoicesReports(t *testing.T) {
	for seed := uint64(1); seed <= 50; seed++ {
		invoices, customers := randomScenario(seed)
		r := MatchInvoices(invoices, customers)
		if r.Counts != countsOf(r) {
			t.Fatalf("seed %d: %+v != %+v", seed, r.Counts, countsOf(r))
		}
	}
}
