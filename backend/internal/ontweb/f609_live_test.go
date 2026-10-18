package ontweb

import (
	"context"
	"os"
	"testing"
	"time"
)

// Uji BACA-SAJA terhadap modem ZTE F609 (MediaTek) nyata. Dilewati kecuali ONT_LIVE_F609_URL diisi:
//
//	ONT_LIVE_F609_URL=http://172.16.15.205 ONT_LIVE_F609_USER=... ONT_LIVE_F609_PASS=... \
//	  go test -count=1 ./internal/ontweb -run TestLiveF609ReadOnly -v
//
// Login, membaca halaman TR-069 dan status ACS, menyusun rencana, lalu logout. TIDAK ADA POST selain login.
func TestLiveF609ReadOnly(t *testing.T) {
	base, user, pass := os.Getenv("ONT_LIVE_F609_URL"), os.Getenv("ONT_LIVE_F609_USER"), os.Getenv("ONT_LIVE_F609_PASS")
	if base == "" || user == "" || pass == "" {
		t.Skip("ONT_LIVE_F609_URL/USER/PASS tidak diisi")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	d, kind, err := Detect(ctx, base, 15*time.Second)
	if err != nil || kind != KindF609 {
		t.Fatalf("Detect: kind=%q err=%v", kind, err)
	}
	c := d.(*F609Client)
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
	if err := checkF609Fields(fields); err != nil {
		t.Fatalf("susunan formulir: %v", err)
	}
	url, _ := effective(fields, "URL")
	interval, _ := effective(fields, "PeriodicInformInterval")
	t.Logf("TR-069 sekarang: URL=%q interval=%s", url, interval)
	rows, changed, err := planTR069(fields, Settings{ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("rencana: %d field, berubah: %v, EBOOVALUE akan %s", len(rows), changed, ebooValue(rows))
	code, text := c.acsStatus(ctx)
	t.Logf("status ACS: kode %q = %s", code, text)
	if code == "" {
		t.Error("status ACS tidak terbaca")
	}
}
