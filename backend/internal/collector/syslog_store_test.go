package collector

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"testing"
	"time"

	"noc-isp/backend/internal/state"
)

func TestParseSyslogLine(t *testing.T) {
	cases := []struct {
		raw, topics, message string
		facility, severity   int
	}{
		// RouterOS dengan header BSD.
		{"<134>Oct  7 16:55:12 MikroTik ppp,info,account budi logged in, 10.0.0.2 from AA:BB", "ppp,info,account", "budi logged in, 10.0.0.2 from AA:BB", 16, 6},
		// Tanpa header: PRI lalu topik.
		{"<30>pppoe,ppp,info <pppoe-1706@runsnet.id>: disconnected", "pppoe,ppp,info", "<pppoe-1706@runsnet.id>: disconnected", 3, 6},
		// Topik satu tingkat.
		{"<27>error something broke", "error", "something broke", 3, 3},
		// Topik diakhiri titik dua dan header RFC 5424 (format lain RouterOS).
		{"<134>Oct  7 16:55:12 MikroTik ppp,info,account: siti logged in, 10.0.0.3", "ppp,info,account", "siti logged in, 10.0.0.3", 16, 6},
		{"<134>1 2026-10-07T16:55:12+07:00 MikroTik - - - ppp,info,account budi logged in, 10.0.0.2", "ppp,info,account", "budi logged in, 10.0.0.2", 16, 6},
		// Tanpa PRI dan tanpa topik: pesan utuh disimpan.
		{"ether4-lan1 link down", "", "ether4-lan1 link down", -1, -1},
	}
	for _, c := range cases {
		f, s, topics, msg := ParseSyslogLine(c.raw)
		if f != c.facility || s != c.severity || topics != c.topics || msg != c.message {
			t.Errorf("ParseSyslogLine(%q) = %d %d %q %q", c.raw, f, s, topics, msg)
		}
	}
}

type syslogPresence struct{ routers []state.Router }

func (p syslogPresence) CustomerByPPPoE(string) (state.Customer, bool) {
	return state.Customer{}, false
}
func (p syslogPresence) SetOnline(string, bool) (state.Change, error) { return state.Change{}, nil }
func (p syslogPresence) Routers() []state.Router                      { return p.routers }
func (p syslogPresence) Customers() []state.Customer                  { return nil }

// Router terdaftar dengan IP publik tetapi mengirim log dari alamat WireGuard:
// baris disimpan hanya bila alamat itu dipetakan.
func TestSyslogListenerStoresMappedSource(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	presence := syslogPresence{routers: []state.Router{{ID: "r-public", Host: "103.167.70.136"}}}
	l, err := ListenSyslog("127.0.0.1:0", presence, nil, logger)
	if err != nil {
		t.Fatal(err)
	}
	got := make(chan SyslogLine, 4)
	l.SetStore(func(line SyslogLine) { got <- line })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = l.Serve(ctx) }()

	send := func() {
		conn, err := net.Dial("udp", l.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		if _, err := conn.Write([]byte("<30>interface,info ether4-lan1 link down")); err != nil {
			t.Fatal(err)
		}
	}

	send()
	select {
	case line := <-got:
		t.Fatalf("baris dari alamat tak dikenal tersimpan: %+v", line)
	case <-time.After(200 * time.Millisecond):
	}
	if l.Stats().UnknownSource == 0 {
		t.Fatal("paket dari alamat tak dikenal tidak dihitung")
	}

	l.SetSources(map[netip.Addr]string{netip.MustParseAddr("127.0.0.1"): "r-public"})
	send()
	select {
	case line := <-got:
		if line.RouterID != "r-public" || line.Topics != "interface,info" || line.Message != "ether4-lan1 link down" {
			t.Fatalf("baris tersimpan salah: %+v", line)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("baris dari alamat terpeta tidak tersimpan")
	}
}

func TestSyslogWriterBatchAndPurge(t *testing.T) {
	db := &recExec{}
	w := NewSyslogWriter(db, 14*24*time.Hour, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()
	w.Add(SyslogLine{RouterID: "r", ReceivedAt: time.Now(), Facility: -1, Severity: -1, Message: "a"})
	w.Add(SyslogLine{RouterID: "r", ReceivedAt: time.Now(), Facility: 3, Severity: 6, Topics: "x,info", Message: "b"})
	deadline := time.Now().Add(3 * time.Second)
	for db.count() < 2 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	<-done
	// Panggilan pertama = hapus retensi saat start, kedua = satu batch dua baris.
	if db.count() != 2 {
		t.Fatalf("Exec dipanggil %d kali, mau 2", db.count())
	}
	msgs := db.calls[1][5].([]string)
	if len(msgs) != 2 || msgs[0] != "a" || msgs[1] != "b" {
		t.Fatalf("batch salah: %v", msgs)
	}
}
