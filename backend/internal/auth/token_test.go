package auth

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"
)

const testSecret = "0123456789abcdef0123456789abcdef"

var epoch = time.Unix(1_700_000_000, 0)

func newTokens(t *testing.T, secret string) *Tokens {
	t.Helper()
	tokens, err := NewTokens(secret)
	if err != nil {
		t.Fatalf("NewTokens: %v", err)
	}
	return tokens
}

func TestIssueAndVerifyRoundTrip(t *testing.T) {
	tokens := newTokens(t, testSecret)
	token, err := tokens.Issue("user-1", epoch, time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	id, err := tokens.Verify(token, epoch.Add(30*time.Second))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if id.UserID != "user-1" {
		t.Errorf("UserID = %q, want user-1", id.UserID)
	}
}

func TestVerifyRejectsExpiredToken(t *testing.T) {
	tokens := newTokens(t, testSecret)
	token, _ := tokens.Issue("user-1", epoch, time.Minute)

	if _, err := tokens.Verify(token, epoch.Add(time.Minute-time.Second)); err != nil {
		t.Errorf("tiket yang belum habis ditolak: %v", err)
	}
	// Tepat di batas sudah dianggap habis.
	if _, err := tokens.Verify(token, epoch.Add(time.Minute)); !errors.Is(err, ErrExpiredToken) {
		t.Errorf("tepat di batas: err = %v, want ErrExpiredToken", err)
	}
	if _, err := tokens.Verify(token, epoch.Add(time.Hour)); !errors.Is(err, ErrExpiredToken) {
		t.Errorf("lewat batas: err = %v, want ErrExpiredToken", err)
	}
}

func TestVerifyRejectsTokenFromAnotherSecret(t *testing.T) {
	token, _ := newTokens(t, testSecret).Issue("user-1", epoch, time.Minute)
	other := newTokens(t, "ffffffffffffffffffffffffffffffff")
	if _, err := other.Verify(token, epoch); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("err = %v, want ErrInvalidToken", err)
	}
}

func TestVerifyRejectsTamperedAndMalformedTokens(t *testing.T) {
	tokens := newTokens(t, testSecret)
	good, _ := tokens.Issue("user-1", epoch, time.Minute)
	other, _ := tokens.Issue("admin", epoch, time.Minute)
	payloadOfOther, _, _ := strings.Cut(other, ".")
	_, sigOfGood, _ := strings.Cut(good, ".")

	tests := map[string]string{
		"kosong":                    "",
		"tanpa titik":               "abcdef",
		"tanpa tanda tangan":        "abc.",
		"tanpa payload":             ".abc",
		"bukan base64":              "###.###",
		"payload ditukar":           payloadOfOther + "." + sigOfGood,
		"tanda tangan dipotong":     good[:len(good)-4],
		"payload bukan JSON":        "e30.e30",
		"tiga bagian":               good + ".x",
		"karakter acak di belakang": good + "!!",
	}
	for name, token := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := tokens.Verify(token, epoch); err == nil {
				t.Errorf("Verify(%q) menerima tiket yang rusak", token)
			}
		})
	}
}

func TestVerifyRejectsOverlongLifetimeEvenWithValidSignature(t *testing.T) {
	tokens := newTokens(t, testSecret)
	// Menerbitkan lewat Issue sudah dibatasi, jadi buat payload sendiri.
	payload := []byte(`{"sub":"user-1","exp":` + "4102444800" + `}`) // tahun 2100
	token := encoding.EncodeToString(payload) + "." + encoding.EncodeToString(tokens.sign(payload))
	if _, err := tokens.Verify(token, epoch); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("err = %v, want ErrInvalidToken untuk tiket berumur terlalu panjang", err)
	}
}

func TestIssueValidatesArguments(t *testing.T) {
	tokens := newTokens(t, testSecret)
	if _, err := tokens.Issue("", epoch, time.Minute); err == nil {
		t.Error("Issue dengan userID kosong harus gagal")
	}
	if _, err := tokens.Issue("u", epoch, 0); err == nil {
		t.Error("Issue dengan ttl 0 harus gagal")
	}
	if _, err := tokens.Issue("u", epoch, MaxTokenLifetime+time.Second); err == nil {
		t.Error("Issue dengan ttl melebihi batas harus gagal")
	}
}

func TestNewTokensRejectsShortSecret(t *testing.T) {
	if _, err := NewTokens("pendek"); err == nil {
		t.Error("rahasia pendek harus ditolak")
	}
	if _, err := NewTokens(""); err == nil {
		t.Error("rahasia kosong harus ditolak")
	}
}

// Tiket ini dibuat di luar Go, dengan algoritma yang sama dengan
// src/lib/realtime-ticket.ts di sisi Next.js:
//
//	secret = "0123456789abcdef0123456789abcdef", sub = "user-1", exp = 1700000060
//
// Bila format di salah satu sisi berubah, test ini gagal sebelum login rusak.
const nextJSTicket = "eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwNjB9.jMkVWtPotDtVCgI3ANolKu7G5aKr0qTpD77cf7kig5c"

func TestVerifyAcceptsATicketIssuedByTheNextJSSide(t *testing.T) {
	tokens := newTokens(t, testSecret)
	id, err := tokens.Verify(nextJSTicket, time.Unix(1_700_000_030, 0))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if id.UserID != "user-1" {
		t.Errorf("UserID = %q, want user-1", id.UserID)
	}
	if _, err := tokens.Verify(nextJSTicket, time.Unix(1_700_000_060, 0)); !errors.Is(err, ErrExpiredToken) {
		t.Errorf("tepat di exp: err = %v, want ErrExpiredToken", err)
	}
	// Rahasia lain tidak boleh menerima tiket ini.
	other := newTokens(t, "ffffffffffffffffffffffffffffffff")
	if _, err := other.Verify(nextJSTicket, time.Unix(1_700_000_030, 0)); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("rahasia lain: err = %v, want ErrInvalidToken", err)
	}
}

// Tiket dengan izin, dibuat di luar Go dengan algoritma src/lib/realtime-ticket.ts
// (rahasia, sub, exp seperti di atas, perms = ["alert:handle"]). Vektor yang sama
// diperiksa dari sisi Next.js di e2e/permissions-write.spec.ts; keduanya harus
// tetap menghasilkan byte yang sama.
const nextJSTicketWithPerms = "eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwNjAsInBlcm1zIjpbImFsZXJ0OmhhbmRsZSJdfQ.2NkYiFVPpm4m5kNile72qG6GGZe0EO6YzO5ij0PLtQE"

// Dua izin (alert:handle dan router:manage), terurut di payload.
const nextJSTicketWithTwoPerms = "eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwNjAsInBlcm1zIjpbImFsZXJ0OmhhbmRsZSIsInJvdXRlcjptYW5hZ2UiXX0.4yOo1jyQtX5iUiAUvE-1KsRhTFaG2O5cLrWaX67c1ds"

func TestVerifyAcceptsAPermissionTicketIssuedByTheNextJSSide(t *testing.T) {
	tokens := newTokens(t, testSecret)
	id, err := tokens.Verify(nextJSTicketWithPerms, time.Unix(1_700_000_030, 0))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if id.UserID != "user-1" || !slices.Equal(id.Perms, []string{"alert:handle"}) {
		t.Errorf("Identity = %+v, want user-1 dengan alert:handle", id)
	}
	if !id.Can("alert:handle") {
		t.Error("Can(alert:handle) = false, want true")
	}
	// Masa berlaku tetap diperiksa untuk tiket berizin.
	if _, err := tokens.Verify(nextJSTicketWithPerms, time.Unix(1_700_000_060, 0)); !errors.Is(err, ErrExpiredToken) {
		t.Errorf("tepat di exp: err = %v, want ErrExpiredToken", err)
	}

	two, err := tokens.Verify(nextJSTicketWithTwoPerms, time.Unix(1_700_000_030, 0))
	if err != nil || !slices.Equal(two.Perms, []string{"alert:handle", "router:manage"}) {
		t.Errorf("dua izin: Identity = %+v, err = %v", two, err)
	}
}

// Go menerbitkan byte yang sama dengan Next.js untuk masukan yang sama, apa pun
// urutan dan kembaran izin yang diberikan.
func TestIssueWithPermsMatchesTheNextJSVector(t *testing.T) {
	tokens := newTokens(t, testSecret)
	issue := func(perms []string) string {
		t.Helper()
		token, err := tokens.IssueWithPerms("user-1", perms, epoch, time.Minute)
		if err != nil {
			t.Fatalf("IssueWithPerms(%v): %v", perms, err)
		}
		return token
	}
	if got := issue([]string{"alert:handle"}); got != nextJSTicketWithPerms {
		t.Errorf("satu izin: %s, want %s", got, nextJSTicketWithPerms)
	}
	for _, perms := range [][]string{
		{"alert:handle", "router:manage"},
		{"router:manage", "alert:handle"},
		{"router:manage", "alert:handle", "router:manage", "alert:handle"},
	} {
		if got := issue(perms); got != nextJSTicketWithTwoPerms {
			t.Errorf("izin %v: %s, want %s", perms, got, nextJSTicketWithTwoPerms)
		}
	}
	// Tanpa izin: persis tiket lama, tanpa kunci "perms".
	for _, perms := range [][]string{nil, {}} {
		if got := issue(perms); got != nextJSTicket {
			t.Errorf("izin %v: %s, want tiket tanpa perms %s", perms, got, nextJSTicket)
		}
	}
	if got, _ := tokens.Issue("user-1", epoch, time.Minute); got != nextJSTicket {
		t.Errorf("Issue = %s, want %s", got, nextJSTicket)
	}
}

func TestTicketWithoutPermsIsReadOnly(t *testing.T) {
	tokens := newTokens(t, testSecret)

	// Tiket yang dibuat Next.js sebelum ada izin tetap sah, hanya-lihat.
	old, err := tokens.Verify(nextJSTicket, time.Unix(1_700_000_030, 0))
	if err != nil {
		t.Fatalf("tiket lama ditolak: %v", err)
	}
	if len(old.Perms) != 0 || old.Can("alert:handle") || old.Can("") {
		t.Errorf("tiket lama: Identity = %+v, want tanpa izin", old)
	}

	token, _ := tokens.Issue("user-1", epoch, time.Minute)
	id, err := tokens.Verify(token, epoch)
	if err != nil || id.Can("alert:handle") {
		t.Errorf("Issue tanpa izin: Identity = %+v, err = %v", id, err)
	}

	// "perms" kosong atau null di payload yang ditandatangani juga hanya-lihat.
	for _, raw := range []string{`"perms":[]`, `"perms":null`} {
		payload := []byte(`{"sub":"user-1","exp":1700000060,` + raw + `}`)
		signed := encoding.EncodeToString(payload) + "." + encoding.EncodeToString(tokens.sign(payload))
		id, err := tokens.Verify(signed, time.Unix(1_700_000_030, 0))
		if err != nil || id.Can("alert:handle") {
			t.Errorf("%s: Identity = %+v, err = %v; want sah dan hanya-lihat", raw, id, err)
		}
	}
}

func TestIdentityCan(t *testing.T) {
	id := Identity{UserID: "u", Perms: []string{"alert:handle", "router:manage"}}
	tests := map[string]bool{
		"alert:handle":  true,
		"router:manage": true,
		"alert:Handle":  false, // huruf besar-kecil dibaca persis
		"alert:":        false,
		"alert":         false,
		"alert:handle ": false,
		"handle":        false,
		"":              false,
	}
	for perm, want := range tests {
		if got := id.Can(perm); got != want {
			t.Errorf("Can(%q) = %v, want %v", perm, got, want)
		}
	}
	if (Identity{UserID: "u"}).Can("alert:handle") {
		t.Error("Identity tanpa Perms tidak boleh punya izin")
	}
	// Daftar yang memuat string kosong tidak memberi izin kosong.
	if (Identity{Perms: []string{""}}).Can("") {
		t.Error("Can(\"\") harus selalu false")
	}
}

// Izin ikut tanda tangan: mengubahnya tanpa menandatangani ulang membuat tiket
// ditolak, baik menambah izin ke tiket hanya-lihat maupun menukar payload.
func TestPermsAreCoveredBySignature(t *testing.T) {
	tokens := newTokens(t, testSecret)
	readOnly, _ := tokens.Issue("user-1", epoch, time.Minute)
	withPerm, _ := tokens.IssueWithPerms("user-1", []string{"alert:handle"}, epoch, time.Minute)
	otherPerm, _ := tokens.IssueWithPerms("user-1", []string{"router:manage"}, epoch, time.Minute)

	payloadOf := func(token string) string { p, _, _ := strings.Cut(token, "."); return p }
	sigOf := func(token string) string { _, s, _ := strings.Cut(token, "."); return s }

	forged := map[string]string{
		"izin ditambahkan ke tiket hanya-lihat": payloadOf(withPerm) + "." + sigOf(readOnly),
		"izin dibuang dari tiket berizin":       payloadOf(readOnly) + "." + sigOf(withPerm),
		"izin ditukar dengan izin lain":         payloadOf(otherPerm) + "." + sigOf(withPerm),
	}
	// Payload buatan sendiri yang memuat izin, dengan tanda tangan tiket lain.
	custom := []byte(`{"sub":"user-1","exp":1700000060,"perms":["alert:handle"]}`)
	forged["payload buatan sendiri, tanda tangan tiket lain"] = encoding.EncodeToString(custom) + "." + sigOf(readOnly)

	for name, token := range forged {
		t.Run(name, func(t *testing.T) {
			id, err := tokens.Verify(token, epoch)
			if !errors.Is(err, ErrInvalidToken) {
				t.Errorf("err = %v, want ErrInvalidToken", err)
			}
			if id.Can("alert:handle") || id.Can("router:manage") {
				t.Errorf("tiket palsu memberi izin: %+v", id)
			}
		})
	}

	// Rahasia lain tidak bisa menerbitkan tiket berizin yang diterima di sini.
	other := newTokens(t, "ffffffffffffffffffffffffffffffff")
	foreign, _ := other.IssueWithPerms("user-1", []string{"alert:handle"}, epoch, time.Minute)
	if _, err := tokens.Verify(foreign, epoch); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("tiket berizin dari rahasia lain: err = %v, want ErrInvalidToken", err)
	}
}

// Bentuk "perms" yang salah ditolak walau tanda tangannya benar: penerbit yang
// salah tulis tidak boleh menghasilkan tiket yang diam-diam dibaca lain.
func TestVerifyRejectsMalformedPermsEvenWithValidSignature(t *testing.T) {
	tokens := newTokens(t, testSecret)
	for name, raw := range map[string]string{
		"perms berupa teks":  `"perms":"alert:handle"`,
		"perms berupa angka": `"perms":1`,
		"perms berisi angka": `"perms":[1]`,
		"perms berupa objek": `"perms":{"alert:handle":true}`,
		"perms berisi objek": `"perms":[{"a":1}]`,
	} {
		t.Run(name, func(t *testing.T) {
			payload := []byte(`{"sub":"user-1","exp":1700000060,` + raw + `}`)
			token := encoding.EncodeToString(payload) + "." + encoding.EncodeToString(tokens.sign(payload))
			if _, err := tokens.Verify(token, time.Unix(1_700_000_030, 0)); !errors.Is(err, ErrInvalidToken) {
				t.Errorf("err = %v, want ErrInvalidToken", err)
			}
		})
	}
}

// Izin tidak melonggarkan batas umur: tiket berizin yang berlaku terlalu lama
// tetap ditolak, Issue menolak argumen yang salah, dan tiket kedaluwarsa tidak
// memberi izin.
func TestPermsDoNotRelaxLifetimeLimits(t *testing.T) {
	tokens := newTokens(t, testSecret)
	payload := []byte(`{"sub":"user-1","exp":4102444800,"perms":["alert:handle"]}`)
	token := encoding.EncodeToString(payload) + "." + encoding.EncodeToString(tokens.sign(payload))
	if _, err := tokens.Verify(token, epoch); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("umur terlalu panjang dengan izin: err = %v, want ErrInvalidToken", err)
	}

	perms := []string{"alert:handle"}
	good, err := tokens.IssueWithPerms("user-1", perms, epoch, MaxTokenLifetime)
	if err != nil {
		t.Fatalf("umur maksimum: %v", err)
	}
	if _, err := tokens.Verify(good, epoch); err != nil {
		t.Errorf("umur tepat 5 menit ditolak: %v", err)
	}
	if _, err := tokens.IssueWithPerms("user-1", perms, epoch, MaxTokenLifetime+time.Second); err == nil {
		t.Error("ttl melebihi batas harus gagal juga dengan izin")
	}
	if _, err := tokens.IssueWithPerms("user-1", perms, epoch, 0); err == nil {
		t.Error("ttl 0 harus gagal juga dengan izin")
	}
	if _, err := tokens.IssueWithPerms("", perms, epoch, time.Minute); err == nil {
		t.Error("userID kosong harus gagal juga dengan izin")
	}
	if _, err := tokens.IssueWithPerms("user-1", []string{""}, epoch, time.Minute); err == nil {
		t.Error("izin kosong harus ditolak saat menerbitkan")
	}

	short, _ := tokens.IssueWithPerms("user-1", perms, epoch, time.Minute)
	id, err := tokens.Verify(short, epoch.Add(time.Minute))
	if !errors.Is(err, ErrExpiredToken) || id.Can("alert:handle") {
		t.Errorf("tiket kedaluwarsa: Identity = %+v, err = %v", id, err)
	}
}
