package olt

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func descDriver(t *testing.T, replies map[string]string) (*fakeOlt, OnuDescriber) {
	t.Helper()
	f := startFakeOlt(t, "NOCApp", "pw", replies)
	d := newTestDriver(t, f, "pw")
	r, ok := d.(OnuDescriber)
	if !ok {
		t.Fatalf("driver %q tidak mengimplementasikan OnuDescriber", d.Name())
	}
	return f, r
}

func TestSanitizeDescription(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{`BUDI" ` + "\r\nreboot", "BUDI reboot"},
		{`a\b`, "ab"},
		{"Ctrl\x00\x1fChars", "CtrlChars"},
		{"   Multiple    Spaces   ", "Multiple Spaces"},
		{"Valid-Name_01.Ok", "Valid-Name_01.Ok"},
		{"ThisNameIsWayTooLongAndExceedsThirtyTwoCharsLimit", "ThisNameIsWayTooLongAndExceedsTh"},
		{"!@#$%^&*()", ""},
	}
	for _, tt := range tests {
		got := SanitizeDescription(tt.input)
		if got != tt.want {
			t.Errorf("SanitizeDescription(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestSetOnuDescriptionSendsOnlyFixedTemplate(t *testing.T) {
	f, r := descDriver(t, map[string]string{
		"interface epon 1":                    "",
		`onu description 3 "1396-BUDI SANTOSO"`: "",
	})
	clean, err := r.SetOnuDescription(context.Background(), OnuRef{Pon: 1, Onu: 3}, `1396-BUDI" SANTOSO`)
	if err != nil {
		t.Fatalf("set desc: %v", err)
	}
	if clean != "1396-BUDI SANTOSO" {
		t.Errorf("clean = %q, want '1396-BUDI SANTOSO'", clean)
	}
	want := []string{"enable", "configure", "interface epon 1", `onu description 3 "1396-BUDI SANTOSO"`, "end", "configure", "end"}
	if got := f.commands(); !reflect.DeepEqual(got, want) {
		t.Fatalf("perintah = %v, want %v", got, want)
	}
	// Pastikan hanya satu baris dan satu pasang tanda kutip
	for _, c := range f.commands() {
		if strings.Contains(c, "\n") || strings.Contains(c, "\r") {
			t.Fatalf("perintah memuat newline: %q", c)
		}
		if strings.HasPrefix(c, "onu description") {
			if strings.Count(c, `"`) != 2 {
				t.Fatalf("perintah harus punya persis 2 tanda kutip: %q", c)
			}
		}
	}
}

func TestSetOnuDescriptionRejectsOutOfRangeAndEmpty(t *testing.T) {
	f, r := descDriver(t, nil)
	for _, ref := range []OnuRef{{0, 1}, {1, 0}, {9, 1}, {1, 65}, {-1, 5}} {
		if _, err := r.SetOnuDescription(context.Background(), ref, "BUDI"); err == nil {
			t.Fatalf("ref %+v harus ditolak", ref)
		}
	}
	// Nama yang hanya simbol berbahaya dan menjadi kosong setelah sanitasi harus ditolak sebelum menyentuh OLT
	if _, err := r.SetOnuDescription(context.Background(), OnuRef{Pon: 1, Onu: 1}, "!@#$%^"); err == nil {
		t.Fatal("nama simbolik kosong harus ditolak")
	}
	if n := len(f.commands()); n != 0 {
		t.Fatalf("OLT tidak boleh disentuh untuk nomor tak sah, tapi menerima %v", f.commands())
	}
}

func TestSetOnuDescriptionMapsCliRejection(t *testing.T) {
	_, r := descDriver(t, map[string]string{
		"interface epon 1":             "",
		`onu description 2 "TEST-ONU"`: "  Error, ONU does not exist\r\n",
	})
	_, err := r.SetOnuDescription(context.Background(), OnuRef{Pon: 1, Onu: 2}, "TEST-ONU")
	if !errors.Is(err, ErrDescriptionRejected) {
		t.Fatalf("err = %v, want ErrDescriptionRejected", err)
	}
}
