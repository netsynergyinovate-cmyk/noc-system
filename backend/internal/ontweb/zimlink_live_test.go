package ontweb

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// Uji BACA-SAJA terhadap modem ZL-2113X nyata. Dilewati kecuali ONT_LIVE_ZIMLINK_URL diisi:
//
//	ONT_LIVE_ZIMLINK_URL=http://172.16.15.246 ONT_LIVE_ZIMLINK_USER=... ONT_LIVE_ZIMLINK_PASS=... \
//	  go test ./internal/ontweb -run TestLiveZimlinkReadOnly -v
//
// Login, membaca halaman TR-069, status ACS dan data WAN, menyusun rencana, lalu logout. TIDAK ADA
// POST ke modem: tidak mengubah apa pun.
func TestLiveZimlinkReadOnly(t *testing.T) {
	base := os.Getenv("ONT_LIVE_ZIMLINK_URL")
	user := os.Getenv("ONT_LIVE_ZIMLINK_USER")
	pass := os.Getenv("ONT_LIVE_ZIMLINK_PASS")
	if base == "" || user == "" || pass == "" {
		t.Skip("ONT_LIVE_ZIMLINK_URL/USER/PASS tidak diisi")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	d, kind, err := Detect(ctx, base, 15*time.Second)
	if err != nil || kind != KindZimlink {
		t.Fatalf("Detect: kind=%q err=%v", kind, err)
	}
	c := d.(*ZimlinkClient)
	if err := c.login(ctx, user, pass); err != nil {
		t.Fatalf("login: %v", err)
	}
	defer c.logout()

	page, err := c.get(ctx, "/cgi-bin/net-tr069.asp", "/cgi-bin/content.asp")
	if err != nil {
		t.Fatalf("halaman TR-069: %v", err)
	}
	fields, err := parseFormFields(page)
	if err != nil {
		t.Fatal(err)
	}
	url, _ := effective(fields, "URL")
	interval, _ := effective(fields, "PeriodicInformInterval")
	t.Logf("TR-069 sekarang: URL=%s interval=%s (%d field formulir)", url, interval, len(fields))

	rows, changed, err := planTR069(fields, Settings{ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("rencana TR-069: %d field, berubah: %v", len(rows), changed)
	if rows != nil && len(rows) != 16 && len(rows) != len(fields)-3 && len(rows) < 10 {
		t.Errorf("jumlah field mengejutkan: %d", len(rows))
	}

	code, text := c.acsStatus(ctx)
	t.Logf("status ACS di modem: kode %q = %s", code, text)
	if code == "" {
		t.Error("status ACS tidak terbaca")
	}

	j, err := c.readWAN(ctx)
	if err != nil {
		t.Fatalf("data WAN: %v", err)
	}
	wanRows, svc, perr := planZLWAN(j)
	switch {
	case perr == nil && wanRows == nil:
		t.Logf("WAN: sudah ada layanan TR069 (%s)", j["ServiceList"])
	case perr == nil:
		t.Logf("WAN: layanan %s -> %s dengan %d field", j["ServiceList"], svc, len(wanRows))
	case errors.Is(perr, ErrNotSupportedConfig):
		t.Logf("WAN: di luar yang terverifikasi, tidak akan disentuh: %v", strings.TrimSpace(perr.Error()))
	default:
		t.Fatalf("WAN: %v", perr)
	}
}
