package ontweb

import (
	"context"
	"os"
	"testing"
	"time"
)

// Uji BACA-SAJA terhadap modem GM220-S XPON nyata. Dilewati kecuali ONT_LIVE_GGCLINK_URL diisi:
//
//	ONT_LIVE_GGCLINK_URL=http://172.16.15.201 ONT_LIVE_GGCLINK_USER=... ONT_LIVE_GGCLINK_PASS=... \
//	  go test ./internal/ontweb -run TestLiveGGCLinkReadOnly -v
//
// Login, membaca halaman TR-069 dan status lapor, menyusun rencana, lalu logout. TIDAK ADA POST
// selain login dan logout: tidak mengubah pengaturan apa pun.
func TestLiveGGCLinkReadOnly(t *testing.T) {
	base := os.Getenv("ONT_LIVE_GGCLINK_URL")
	user := os.Getenv("ONT_LIVE_GGCLINK_USER")
	pass := os.Getenv("ONT_LIVE_GGCLINK_PASS")
	if base == "" || user == "" || pass == "" {
		t.Skip("ONT_LIVE_GGCLINK_URL/USER/PASS tidak diisi")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	d, kind, err := Detect(ctx, base, 15*time.Second)
	if err != nil || kind != KindGGCLink {
		t.Fatalf("Detect: kind=%q err=%v", kind, err)
	}
	c := d.(*GGCLinkClient)
	if err := c.login(ctx, user, pass); err != nil {
		t.Fatalf("login: %v", err)
	}
	defer c.logout()

	body, err := c.page(ctx, "net_tr069_basic_t.gch")
	if err != nil {
		t.Fatalf("halaman TR-069: %v", err)
	}
	cur, err := parseGGCTR069(body)
	if err != nil {
		t.Fatalf("parse TR-069 (susunan formulir tidak sesuai yang terverifikasi?): %v", err)
	}
	t.Logf("TR-069 sekarang: URL=%q pengguna=%q inform=%s interval=%s", cur.Data["URL"], cur.Data["UserName"], cur.Data["PeriodicInformEnable"], cur.Data["PeriodicInformInterval"])

	rows, changed, err := planGGCTR069(cur, Settings{ACSURL: "http://172.16.0.1:7547", ACSUsername: "admin", ACSPassword: "admin", InformInterval: 300}, ggcCR{})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("rencana TR-069: %d field, berubah: %v", len(rows), changed)

	text, reported := c.informStatus(ctx)
	t.Logf("status lapor di modem: %q (berhasil=%v)", text, reported)
	if text == "" {
		t.Error("status lapor tidak terbaca")
	}
}
