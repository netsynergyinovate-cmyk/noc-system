package olt

import (
	"context"
	"errors"
	"reflect"
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

func TestSetOnuDescriptionSendsOnlyFixedTemplate(t *testing.T) {
	f, r := descDriver(t, map[string]string{
		"interface epon 1":                    "",
		`onu description 3 "1396-BUDI SANTOSO"`: "",
	})
	if err := r.SetOnuDescription(context.Background(), OnuRef{Pon: 1, Onu: 3}, "1396-BUDI SANTOSO"); err != nil {
		t.Fatalf("set desc: %v", err)
	}
	want := []string{"enable", "configure", "interface epon 1", `onu description 3 "1396-BUDI SANTOSO"`, "end", "configure", "end"}
	if got := f.commands(); !reflect.DeepEqual(got, want) {
		t.Fatalf("perintah = %v, want %v", got, want)
	}
}

func TestSetOnuDescriptionRejectsOutOfRange(t *testing.T) {
	f, r := descDriver(t, nil)
	for _, ref := range []OnuRef{{0, 1}, {1, 0}, {9, 1}, {1, 65}, {-1, 5}} {
		if err := r.SetOnuDescription(context.Background(), ref, "BUDI"); err == nil {
			t.Fatalf("ref %+v harus ditolak", ref)
		}
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
	err := r.SetOnuDescription(context.Background(), OnuRef{Pon: 1, Onu: 2}, "TEST-ONU")
	if !errors.Is(err, ErrDescriptionRejected) {
		t.Fatalf("err = %v, want ErrDescriptionRejected", err)
	}
}
