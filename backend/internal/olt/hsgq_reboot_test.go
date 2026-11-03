package olt

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func rebootDriver(t *testing.T, replies map[string]string) (*fakeOlt, OnuRebooter) {
	t.Helper()
	f := startFakeOlt(t, "NOCApp", "pw", replies)
	d := newTestDriver(t, f, "pw")
	r, ok := d.(OnuRebooter)
	if !ok {
		t.Fatalf("driver %q tidak mengimplementasikan OnuRebooter", d.Name())
	}
	return f, r
}

func TestRebootOnuSendsOnlyTheFixedTemplate(t *testing.T) {
	f, r := rebootDriver(t, map[string]string{"interface epon 3": "", "onu-reboot onu-id 5": ""})
	if err := r.RebootOnu(context.Background(), OnuRef{Pon: 3, Onu: 5}); err != nil {
		t.Fatalf("reboot: %v", err)
	}
	want := []string{"enable", "configure", "interface epon 3", "onu-reboot onu-id 5", "end", "configure", "end"}
	if got := f.commands(); !reflect.DeepEqual(got, want) {
		t.Fatalf("perintah = %v, want %v", got, want)
	}
	for _, c := range f.commands() {
		if c == "reboot" || strings.HasPrefix(c, "reboot ") {
			t.Fatalf("perintah reboot OLT utuh tidak boleh pernah dikirim: %q", c)
		}
	}
}

func TestRebootOnuRejectsOutOfRangeBeforeTouchingTheOlt(t *testing.T) {
	f, r := rebootDriver(t, nil)
	for _, ref := range []OnuRef{{0, 1}, {1, 0}, {9, 1}, {1, 65}, {-1, 5}, {1, -5}} {
		if err := r.RebootOnu(context.Background(), ref); err == nil {
			t.Fatalf("ref %+v harus ditolak", ref)
		}
	}
	if n := len(f.commands()); n != 0 {
		t.Fatalf("OLT tidak boleh disentuh untuk nomor tak sah, tapi menerima %v", f.commands())
	}
}

func TestRebootOnuMapsCliRejection(t *testing.T) {
	_, r := rebootDriver(t, map[string]string{
		"interface epon 1":    "",
		"onu-reboot onu-id 2": "  Error, ONU does not exist\r\n",
	})
	err := r.RebootOnu(context.Background(), OnuRef{Pon: 1, Onu: 2})
	if !errors.Is(err, ErrRebootRejected) {
		t.Fatalf("err = %v, want ErrRebootRejected", err)
	}
}
