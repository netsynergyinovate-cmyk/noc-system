package olt

import (
	"bufio"
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeOlt meniru CLI HSGQ: negosiasi telnet, banner yang memuat kata "fail",
// login, mode view (>), enable (#), dan config ((config)#).
type fakeOlt struct {
	ln       net.Listener
	user     string
	pass     string
	sessions atomic.Int32
	mu       sync.Mutex
	seen     []string // semua perintah yang diterima (untuk memastikan hanya baca)
	replies  map[string]string
}

const fakeBanner = "\x1b[H\x1b[J\r\n********\r\n  HSGQ-XE08ID EPON OLT Operating System\r\n********\r\n\r\n"

func startFakeOlt(t *testing.T, user, pass string, replies map[string]string) *fakeOlt {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeOlt{ln: ln, user: user, pass: pass, replies: replies}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(c)
		}
	}()
	return f
}

func (f *fakeOlt) addr() string { return f.ln.Addr().String() }

func (f *fakeOlt) commands() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.seen...)
}

func (f *fakeOlt) serve(c net.Conn) {
	defer c.Close()
	f.sessions.Add(1)
	defer f.sessions.Add(-1)
	// Negosiasi opsi telnet seperti perangkat asli (IAC WILL ECHO, DO NAWS ...).
	c.Write([]byte{255, 251, 1, 255, 251, 3, 255, 253, 31})
	c.Write([]byte(fakeBanner))
	r := bufio.NewReader(c)
	readLine := func() (string, bool) {
		var line []byte
		for {
			b, err := r.ReadByte()
			if err != nil {
				return "", false
			}
			if b == 255 { // balasan negosiasi dari klien: lewati 2 byte
				r.ReadByte()
				r.ReadByte()
				continue
			}
			if b == '\n' {
				return strings.TrimSpace(string(line)), true
			}
			if b != '\r' {
				line = append(line, b)
			}
		}
	}
	for attempt := 0; attempt < 3; attempt++ {
		c.Write([]byte("\r\nusername: "))
		u, ok := readLine()
		if !ok {
			return
		}
		c.Write([]byte("\r\npassword: "))
		p, ok := readLine()
		if !ok {
			return
		}
		if u == f.user && p == f.pass {
			// Banner sesudah login memuat tabel "fail login" (kata "fail" ada di sini).
			c.Write([]byte("\r\nAll user fail login information:\r\n Telnet 1.2.3.4  2026/10/14 16:05:58  7\r\n\r\nOLT-X>"))
			f.shell(c, readLine)
			return
		}
		c.Write([]byte("\r\nlogin incorrect\r\n"))
	}
}

func (f *fakeOlt) shell(c net.Conn, readLine func() (string, bool)) {
	mode := ">"
	for {
		line, ok := readLine()
		if !ok {
			return
		}
		f.mu.Lock()
		f.seen = append(f.seen, line)
		f.mu.Unlock()
		out := ""
		switch {
		case line == "enable":
			mode = "#"
		case line == "configure":
			mode = "(config)#"
		case line == "end":
			mode = "#"
		case line == "exit" || line == "quit":
			return
		default:
			if r, ok := f.replies[line]; ok {
				out = r
			} else {
				out = "vty% Unknown command: " + line + "\r\n"
			}
		}
		// Gema perintah, keluaran, lalu prompt (tanpa newline penutup).
		c.Write([]byte(line + " \r\n" + out + "\r\nOLT-X" + mode))
	}
}

const (
	fakeInfo = "-----\r\n PON/ONU  Mac  Status Auth Cfg Reg-time ONU-Name ONU-Desc\r\n-----\r\n" +
		" 1/1     28:23:f5:74:40:80 Online    TRUE  TRUE  2026/10/14 17:35:27      1396-BUDI SA NO-DESCRIPTI\r\n" +
		" 1/2     98:c7:a4:5c:52:f8 Initial   TRUE  FALSE  -                        1773-SITI    NO-DESCRIPTI\r\n" +
		" 2/1     00:cf:c0:bc:c5:c4 Online    TRUE  TRUE  2026/10/14 17:35:10      1100-DEWI    NO-DESCRIPTI\r\n" +
		"-----\r\n  Total: 3  Online:2  Offline:1\r\n-----\r\n"
	fakeVersion = "PON/ONU ONU-Name Mac Vendor Serial DevType Type Version ONU-DESC\r\n-----\r\n" +
		"    1/1 1396-BUDI SANTOSO 28:23:f5:74:40:80 MTKc   245H   HGU     1ge3fe   V3.0             NO-DESCRIPTION\r\n" +
		"    1/2 1773-SITI  98:c7:a4:5c:52:f8               SFU     1ge3fe                    NO-DESCRIPTION\r\n" +
		"    2/1 1100-DEWI  00:cf:c0:bc:c5:c4 ZICG   GM22   HGU     1ge3fe   V9.0.10P1T1      NO-DESCRIPTION\r\n"
	fakePon = " Port    Status     Online/Total ONUs\r\n ---\r\n PON01   Up         1/2\r\n PON02   Up         1/1\r\n PON03   Down       0/0\r\n"
)

func diag(rows ...string) string {
	return "PON/ONU ONU-Name Mac Temperature Voltage Bias Tx power Rx power\r\n-----\r\n" + strings.Join(rows, "\r\n") + "\r\n-----\r\n"
}

func fakeReplies() map[string]string {
	return map[string]string{
		"show version":         "Software Version : HSGQ-XE08ID_IR_V3.4.3ID_Rel\r\n",
		"show onu-info all":    fakeInfo,
		"show onu-version all": fakeVersion,
		"show pon-info":        fakePon,
		"show optical-diag 1":  diag("    1/1 1396-BUDI SANTOSO 28:23:f5:74:40:80  49 Â°C      3.29 V        11 mA       1.9645 dBm   -15.9688 dBm"),
		"show optical-diag 2":  diag("    2/1 1100-DEWI  00:cf:c0:bc:c5:c4  40 Â°C      3.30 V        12 mA       2.1000 dBm   -21.5000 dBm"),
	}
}

func newTestDriver(t *testing.T, f *fakeOlt, pass string) Driver {
	t.Helper()
	d, err := Get("hsgq-telnet", Config{Host: f.addr(), Username: "NOCApp", Password: pass, Timeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestHsgqTelnetFetchesPonsAndOnusFromRealisticSession(t *testing.T) {
	f := startFakeOlt(t, "NOCApp", "rahasia", fakeReplies())
	d := newTestDriver(t, f, "rahasia")
	ctx := context.Background()

	onus, err := d.FetchOnus(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(onus) != 3 {
		t.Fatalf("harus 3 ONU, got %+v", onus)
	}
	a, b, c := onus[0], onus[1], onus[2]
	if a.PonIndex != 1 || a.OnuIndex != 1 || a.MacAddress != "28:23:F5:74:40:80" || a.State != "online" || !a.IsOnline ||
		a.Name != "1396-BUDI SANTOSO" || a.Model != "MTKc 245H" || a.RxPowerDbm == nil || *a.RxPowerDbm != -15.9688 || *a.TxPowerDbm != 1.9645 {
		t.Errorf("ONU 1/1: %+v", a)
	}
	if b.State != "offline" || b.IsOnline || b.RxPowerDbm != nil || b.Name != "1773-SITI" || b.Model != "" {
		t.Errorf("ONU 1/2 (Initial) harus offline tanpa optik dan tanpa model karangan: %+v", b)
	}
	if c.PonIndex != 2 || *c.RxPowerDbm != -21.5 {
		t.Errorf("ONU 2/1: %+v", c)
	}

	ports, err := d.FetchPonPorts(ctx) // dari snapshot yang sama
	if err != nil || len(ports) != 3 {
		t.Fatalf("ports=%+v err=%v", ports, err)
	}
	if p := ports[0]; p.Index != 1 || p.OnuOnlineCount != 1 || p.RxPowerDbm == nil || *p.RxPowerDbm != -15.9688 {
		t.Errorf("PON 1 memakai rata-rata Rx ONU online: %+v", p)
	}
	if p := ports[2]; p.Index != 3 || p.OnuOnlineCount != 0 || p.RxPowerDbm != nil || p.TxPowerDbm != nil {
		t.Errorf("PON 3 (down) tanpa bacaan: %+v", p)
	}
}

func TestHsgqTelnetOnlyRunsReadCommandsAndReusesOneSession(t *testing.T) {
	f := startFakeOlt(t, "NOCApp", "rahasia", fakeReplies())
	d := newTestDriver(t, f, "rahasia")
	ctx := context.Background()
	if _, err := d.FetchOnus(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := d.FetchPonPorts(ctx); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{"enable": true, "configure": true, "end": true}
	seenShow := 0
	for _, cmd := range f.commands() {
		switch {
		case strings.HasPrefix(cmd, "show "):
			seenShow++
		case !allowed[cmd]:
			t.Errorf("perintah selain show/enable/configure/end tidak boleh dikirim: %q", cmd)
		}
	}
	// onu-info, onu-version, pon-info, optical-diag 1, optical-diag 2 = 5, sekali saja.
	if seenShow != 5 {
		t.Errorf("harus 5 perintah show dalam satu sesi (FetchPonPorts memakai snapshot), got %d: %v", seenShow, f.commands())
	}
	waitSessions(t, f, 0)
}

func waitSessions(t *testing.T, f *fakeOlt, want int32) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for f.sessions.Load() != want {
		if time.Now().After(deadline) {
			t.Fatalf("sesi terbuka=%d, want %d (slot VTY OLT harus dilepas)", f.sessions.Load(), want)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestHsgqTelnetWrongPasswordFailsWithoutLeakingIt(t *testing.T) {
	f := startFakeOlt(t, "NOCApp", "rahasia", fakeReplies())
	d := newTestDriver(t, f, "salah-banget-123")
	err := d.TestConnection(context.Background())
	if err == nil {
		t.Fatal("kata sandi salah harus gagal")
	}
	if strings.Contains(err.Error(), "salah-banget-123") || strings.Contains(err.Error(), "rahasia") {
		t.Errorf("pesan galat membocorkan kata sandi: %v", err)
	}
	if !errors.Is(err, errUserPrompt) && !strings.Contains(err.Error(), "ditolak") && !strings.Contains(err.Error(), "waktu habis") {
		t.Errorf("galat harus jelas: %v", err)
	}
}

func TestHsgqTelnetTestConnectionSucceedsAndDetectsDeadHost(t *testing.T) {
	f := startFakeOlt(t, "NOCApp", "rahasia", fakeReplies())
	d := newTestDriver(t, f, "rahasia")
	if err := d.TestConnection(context.Background()); err != nil {
		t.Fatalf("login benar harus sukses: %v", err)
	}
	waitSessions(t, f, 0)

	dead, err := Get("hsgq-telnet", Config{Host: "127.0.0.1:1", Username: "u", Password: "p", Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if err := dead.TestConnection(context.Background()); err == nil {
		t.Fatal("host mati harus gagal")
	}
}

func TestHsgqTelnetValidatesConfig(t *testing.T) {
	for name, cfg := range map[string]Config{
		"host kosong":     {Username: "u"},
		"skema":           {Host: "http://10.0.0.1", Username: "u"},
		"username kosong": {Host: "10.0.0.1"},
	} {
		if _, err := Get("hsgq-telnet", cfg); err == nil {
			t.Errorf("%s harus ditolak", name)
		}
	}
}

func TestHsgqTelnetOpticalFailureOnOnePonKeepsTheRest(t *testing.T) {
	r := fakeReplies()
	delete(r, "show optical-diag 1") // PON 1 dijawab "Unknown command": tanpa bacaan
	f := startFakeOlt(t, "NOCApp", "rahasia", r)
	d := newTestDriver(t, f, "rahasia")
	onus, err := d.FetchOnus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if onus[0].RxPowerDbm != nil || onus[2].RxPowerDbm == nil {
		t.Errorf("PON 1 tanpa optik, PON 2 tetap ada: %+v", onus)
	}
}

func TestHsgqTelnetRespectsContextCancel(t *testing.T) {
	// Server yang menerima koneksi tetapi tidak pernah mengirim prompt.
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			defer c.Close()
		}
	}()
	d, _ := Get("hsgq-telnet", Config{Host: ln.Addr().String(), Username: "u", Password: "p", Timeout: 30 * time.Second})
	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := d.TestConnection(ctx); err == nil {
		t.Fatal("harus gagal")
	}
	if time.Since(start) > 3*time.Second {
		t.Errorf("pembatalan konteks harus memotong penantian, makan %v", time.Since(start))
	}
}
