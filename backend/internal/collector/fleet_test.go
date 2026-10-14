package collector

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"noc-isp/backend/internal/state"
)

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

// Data dihasilkan Node (src/lib/encryption-core.ts), bukan oleh kode Go ini:
// format dan penurunan kunci harus cocok dengan sisi aplikasi.
const (
	nodeKey32      = "noc-device-secret-key-32chars-ok" // tepat 32 byte: dipakai apa adanya
	nodeCipher32   = "sgTmBAVQ/xv/AlBa:zhualod6HBstsPr5aFZc2g==:lNZb8KoEYHkVfqffj1hirzJz"
	nodeKeyShort   = "kunci-pendek" // bukan 32 byte: diturunkan lewat SHA-256
	nodeCipherShrt = "ZA8zebgGRyv7C9e0:cD3Wrn+4ZfPwBo7IvL+Xbg==:Xw4t3fY="
)

func TestDecryptCredentialMatchesNodeFormat(t *testing.T) {
	if got, err := DecryptCredential(nodeCipher32, nodeKey32); err != nil || got != "sandi-Monitor-123!" {
		t.Fatalf("kunci 32 byte: got %q, err %v", got, err)
	}
	if got, err := DecryptCredential(nodeCipherShrt, nodeKeyShort); err != nil || got != "pw-é" {
		t.Fatalf("kunci diturunkan SHA-256: got %q, err %v", got, err)
	}
}

func TestDecryptCredentialRejectsBadInputWithoutLeaking(t *testing.T) {
	cases := map[string]struct{ data, key string }{
		"kunci salah":       {nodeCipher32, "kunci-lain"},
		"format rusak":      {"bukan-format", nodeKey32},
		"base64 rusak":      {"@@:@@:@@", nodeKey32},
		"tag dipalsukan":    {strings.Replace(nodeCipher32, "zhualod6", "AAAAAAAA", 1), nodeKey32},
		"kunci kosong":      {nodeCipher32, "  "},
		"ciphertext kosong": {"", nodeKey32},
	}
	for name, c := range cases {
		got, err := DecryptCredential(c.data, c.key)
		if err == nil || got != "" {
			t.Errorf("%s: harus gagal, got %q err %v", name, got, err)
			continue
		}
		if strings.Contains(err.Error(), "sandi-Monitor") || strings.Contains(err.Error(), nodeKey32) {
			t.Errorf("%s: pesan galat membocorkan rahasia: %v", name, err)
		}
	}
}

func TestBaseURLFromHost(t *testing.T) {
	ok := map[string]string{
		"10.0.0.1":               "http://10.0.0.1",
		"10.0.0.1:2024":          "http://10.0.0.1:2024",
		"10.0.0.1:443":           "https://10.0.0.1:443",
		"10.0.0.1:8443":          "https://10.0.0.1:8443",
		"https://10.0.0.1:2024":  "https://10.0.0.1:2024",
		"https://r.example.com":  "https://r.example.com",
		"http://10.0.0.1:80/":    "http://10.0.0.1:80",
		"  router.example.com  ": "http://router.example.com",
	}
	for in, want := range ok {
		if got, err := BaseURLFromHost(in); err != nil || got != want {
			t.Errorf("%q: got %q err %v, want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "  ", "ftp://10.0.0.1", "10.0.0.1/rest", "user@10.0.0.1", "10.0.0.1?x=1", "a b"} {
		if got, err := BaseURLFromHost(in); err == nil {
			t.Errorf("%q harus ditolak, got %q", in, got)
		}
	}
	if !isAPIProtocolPort("http://10.0.0.1:8728") || !isAPIProtocolPort("https://x:8729") || isAPIProtocolPort("http://10.0.0.1:80") || isAPIProtocolPort("http://10.0.0.1") {
		t.Error("isAPIProtocolPort salah")
	}
}

// targetQuerier mengembalikan baris routers (id, name, host, username, password_enc).
type targetQuerier struct{ rows [][]any }

func (q targetQuerier) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return &fakeRows{data: q.rows}, nil
}

func TestLoadTargetsSkipsBadRoutersButKeepsTheRest(t *testing.T) {
	q := targetQuerier{rows: [][]any{
		{"r1", "Core", "10.0.0.1:2024", "Monitor", nodeCipher32},
		{"r2", "API", "10.0.0.2:8728", "u", nodeCipher32},   // port API biner
		{"r3", "Rusak", "10.0.0.3", "u", "bukan-format"},    // kata sandi tidak terbuka
		{"r4", "Host", "ftp://10.0.0.4", "u", nodeCipher32}, // host tidak valid
		{"r5", "TLS", "10.0.0.5:443", "noc", nodeCipher32},
	}}
	got, err := LoadTargets(context.Background(), q, nodeKey32, discard)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("harus 2 target, got %+v", got)
	}
	if got[0].RouterID != "r1" || got[0].BaseURL != "http://10.0.0.1:2024" || got[0].Username != "Monitor" || got[0].Password != "sandi-Monitor-123!" {
		t.Errorf("target r1 salah: %+v", got[0])
	}
	if got[1].RouterID != "r5" || got[1].BaseURL != "https://10.0.0.5:443" {
		t.Errorf("target r5 salah: %+v", got[1])
	}
}

type fakePoller struct {
	mu      sync.Mutex
	started []string
	stopped []string
	failFor map[string]bool
}

func (p *fakePoller) Start(_ context.Context, t Target) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.failFor[t.RouterID] {
		return errors.New("gagal")
	}
	p.started = append(p.started, t.RouterID+"@"+t.BaseURL)
	return nil
}
func (p *fakePoller) Stop(id string) { p.mu.Lock(); p.stopped = append(p.stopped, id); p.mu.Unlock() }

func TestFleetReconcile(t *testing.T) {
	cur := []Target{{RouterID: "a", BaseURL: "http://1", Username: "u", Password: "p"}, {RouterID: "b", BaseURL: "http://2", Username: "u", Password: "p"}}
	fp := &fakePoller{}
	f := NewFleet(fp, func(context.Context) ([]Target, error) { return cur, nil }, discard)
	ctx := context.Background()

	must := func() {
		t.Helper()
		if err := f.Reconcile(ctx); err != nil {
			t.Fatal(err)
		}
	}
	must()
	if len(fp.started) != 2 || f.Running() != 2 {
		t.Fatalf("awal: started=%v running=%d", fp.started, f.Running())
	}
	must() // tidak ada perubahan: tidak ada start/stop baru
	if len(fp.started) != 2 || len(fp.stopped) != 0 {
		t.Fatalf("idempoten: started=%v stopped=%v", fp.started, fp.stopped)
	}

	cur = []Target{{RouterID: "a", BaseURL: "http://1", Username: "u", Password: "BARU"}} // a ganti sandi, b hilang
	must()
	if len(fp.started) != 3 || fp.started[2] != "a@http://1" {
		t.Fatalf("a harus dipoll ulang: %v", fp.started)
	}
	if len(fp.stopped) != 2 { // stop a (ubah) + stop b (hilang)
		t.Fatalf("stopped=%v", fp.stopped)
	}
	if f.Running() != 1 {
		t.Fatalf("running=%d", f.Running())
	}

	// Start gagal tidak dianggap berjalan dan dicoba lagi putaran berikutnya.
	cur = []Target{{RouterID: "c", BaseURL: "http://3", Username: "u", Password: "p"}}
	fp.failFor = map[string]bool{"c": true}
	must()
	if f.Running() != 0 {
		t.Fatalf("c gagal start, running harus 0, got %d", f.Running())
	}
	fp.failFor = nil
	must()
	if f.Running() != 1 {
		t.Fatalf("c harus dicoba lagi, running=%d", f.Running())
	}

	loadErr := NewFleet(fp, func(context.Context) ([]Target, error) { return nil, errors.New("db mati") }, discard)
	if err := loadErr.Reconcile(ctx); err == nil {
		t.Fatal("galat pemuat harus dikembalikan")
	}
}

type fakeSource struct {
	secrets []PPPSecret
	active  []PPPSession
	err     error
	aerr    error
}

func (s fakeSource) PPPSecrets(context.Context) ([]PPPSecret, error) { return s.secrets, s.err }
func (s fakeSource) PPPActive(context.Context) ([]PPPSession, error) { return s.active, s.aerr }

type fakeDB struct {
	calls [][]any
	have  map[string]bool // username yang sudah ada: ON CONFLICT DO NOTHING
	err   error
}

func (d *fakeDB) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	if d.err != nil {
		return pgconn.CommandTag{}, d.err
	}
	d.calls = append(d.calls, args)
	user := args[1].(string)
	if d.have[user] {
		return pgconn.NewCommandTag("INSERT 0 0"), nil
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func TestImporterAddsOnlyEnabledNewCustomers(t *testing.T) {
	src := fakeSource{
		secrets: []PPPSecret{
			{Name: "budi", Comment: "Budi Santoso"},
			{Name: "siti"},                      // tanpa komentar: nama = username
			{Name: "mati", Disabled: true},      // dinonaktifkan: dilewati
			{Name: "ada", Comment: "Sudah ada"}, // sudah di database: tidak ditimpa
			{Name: "bad\nuser"},                 // karakter kontrol: ditolak
		},
		active: []PPPSession{
			{Name: "budi", Service: "pppoe"},
			{Name: "radius1", Service: "pppoe"}, // tanpa akun lokal (RADIUS): tetap diimpor, online
			{Name: "vpn1", Service: "l2tp"},     // sesi VPN: bukan pelanggan
		},
	}
	db := &fakeDB{have: map[string]bool{"ada": true}}
	imp := NewImporter(func(context.Context) ([]Target, error) {
		return []Target{{RouterID: "11111111-1111-1111-1111-111111111111"}}, nil
	}, db, nil, discard)
	imp.newSource = func(Target) (pppSource, error) { return src, nil }

	res, err := imp.Once(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Routers != 1 || res.Failed != 0 || res.Seen != 4 || res.Imported != 3 {
		t.Fatalf("hasil salah: %+v", res)
	}
	if len(db.calls) != 4 {
		t.Fatalf("harus 4 INSERT (budi, siti, ada, radius1), got %d", len(db.calls))
	}
	if last := db.calls[3]; last[0] != "radius1" || last[1] != "radius1" || last[3] != true {
		t.Errorf("radius1: %v", last)
	}
	if db.calls[0][0] != "Budi Santoso" || db.calls[0][1] != "budi" || db.calls[0][3] != true {
		t.Errorf("budi: %v", db.calls[0])
	}
	if db.calls[1][0] != "siti" || db.calls[1][3] != false {
		t.Errorf("siti: %v", db.calls[1])
	}
}

func TestImporterIsolatesRouterFailures(t *testing.T) {
	good := fakeSource{secrets: []PPPSecret{{Name: "x"}}}
	db := &fakeDB{}
	imp := NewImporter(func(context.Context) ([]Target, error) {
		return []Target{{RouterID: "bad"}, {RouterID: "good"}}, nil
	}, db, nil, discard)
	imp.newSource = func(t Target) (pppSource, error) {
		if t.RouterID == "bad" {
			return fakeSource{err: errors.New("router mati")}, nil
		}
		return good, nil
	}
	res, err := imp.Once(context.Background())
	if err != nil || res.Routers != 1 || res.Failed != 1 || res.Imported != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}

	// Daftar sesi aktif gagal dibaca: impor tetap jalan, pelanggan dianggap offline.
	db2 := &fakeDB{}
	imp2 := NewImporter(func(context.Context) ([]Target, error) { return []Target{{RouterID: "r"}}, nil }, db2, nil, discard)
	imp2.newSource = func(Target) (pppSource, error) {
		return fakeSource{secrets: []PPPSecret{{Name: "y"}}, aerr: errors.New("x")}, nil
	}
	if res, err := imp2.Once(context.Background()); err != nil || res.Imported != 1 || db2.calls[0][3] != false {
		t.Fatalf("res=%+v err=%v calls=%v", res, err, db2.calls)
	}

	// Galat tulis ke database menggagalkan router itu, bukan semuanya.
	db3 := &fakeDB{err: errors.New("db mati")}
	imp3 := NewImporter(func(context.Context) ([]Target, error) { return []Target{{RouterID: "r"}}, nil }, db3, nil, discard)
	imp3.newSource = func(Target) (pppSource, error) { return good, nil }
	if res, _ := imp3.Once(context.Background()); res.Failed != 1 || res.Imported != 0 {
		t.Fatalf("res=%+v", res)
	}
}

func TestSyncKeepsOnlineStatusFromPolling(t *testing.T) {
	mgr := state.NewManager()
	q := &fakeQuerier{
		routers:   [][]any{{"r1", "Core", "10.0.0.1", "aktif"}},
		customers: [][]any{{"c1", "Budi", "budi", "r1", nil, nil, "lunas", nil, false, nil, nil}},
	}
	if _, _, err := SyncDatabaseState(context.Background(), q, mgr, discard); err != nil {
		t.Fatal(err)
	}
	// Polling /ppp/active menandai budi online di memori.
	if _, err := mgr.SetOnline("budi", true); err != nil {
		t.Fatal(err)
	}
	// Sinkron berikutnya membaca is_online=false dari database: memori yang menang.
	if _, _, err := SyncDatabaseState(context.Background(), q, mgr, discard); err != nil {
		t.Fatal(err)
	}
	if c, ok := mgr.CustomerByPPPoE("budi"); !ok || !c.IsOnline {
		t.Fatalf("status online dari polling harus bertahan, got %+v ok=%v", c, ok)
	}
}
