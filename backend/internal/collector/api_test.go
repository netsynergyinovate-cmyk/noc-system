package collector

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fakeAPI adalah server RouterOS API biner sederhana: cukup untuk menguji
// login, print, dan monitor-traffic tanpa router sungguhan.
type fakeAPI struct {
	t        *testing.T
	listener net.Listener
	password string
	// handler menerima perintah (kata pertama) dan mengembalikan balasan.
	handler func(command string, words []string, send func([]string))
}

func startFakeAPI(t *testing.T, h func(command string, words []string, send func([]string))) (*fakeAPI, int) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeAPI{t: t, listener: ln, handler: h}
	go f.serve()
	t.Cleanup(func() { _ = ln.Close() })
	return f, ln.Addr().(*net.TCPAddr).Port
}

func (f *fakeAPI) serve() {
	for {
		conn, err := f.listener.Accept()
		if err != nil {
			return
		}
		go func() {
			defer conn.Close()
			reader := bufio.NewReader(conn)
			for {
				words, err := readSentence(reader)
				if err != nil {
					return
				}
				if len(words) == 0 {
					continue
				}
				tag := attr(words, "tag")
				send := func(sentence []string) {
					if tag != "" {
						sentence = append(sentence, ".tag="+tag)
					}
					_ = writeSentence(conn, sentence)
				}
				f.handler(words[0], words, send)
				// print/login ditutup dengan !done; handler yang mengirim !done sendiri.
			}
		}()
	}
}

func apiReplySend(rows [][]string) func(command string, words []string, send func([]string)) {
	return func(_ string, _ []string, send func([]string)) {
		for _, row := range rows {
			send(append([]string{"!re"}, row...))
		}
		send([]string{"!done"})
	}
}

func TestBinaryAPIClientReadsLikeREST(t *testing.T) {
	_, port := startFakeAPI(t, func(command string, words []string, send func([]string)) {
		switch command {
		case "/login":
			if attr(words, "name") != "noc" || attr(words, "password") != "secret" {
				send([]string{"!trap", "=message=invalid user name or password"})
				send([]string{"!done"})
				return
			}
			send([]string{"!done"})
		case "/system/resource/print":
			if !strings.Contains(strings.Join(words, " "), "=.proplist=cpu-load") {
				send([]string{"!trap", "=message=proplist hilang"})
				return
			}
			send([]string{"!re", "=cpu-load=7", "=free-memory=500", "=total-memory=1000", "=uptime=1d", "=version=7.14", "=board-name=RB5009"})
			send([]string{"!done"})
		case "/queue/simple/print":
			send([]string{"!re", "=name=pppoe-budi", "=rate=1000000/9000000", "=max-limit=1000000/10000000", "=parent=none", "=disabled=false"})
			send([]string{"!done"})
		default:
			send([]string{"!trap", "=message=perintah tidak dikenal"})
		}
	})

	c, err := NewClient(Target{
		RouterID: "r1",
		BaseURL:  "http://127.0.0.1:" + strconv.Itoa(port),
		Protocol: "api",
		Username: "noc",
		Password: "secret",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !c.usesBinaryAPI() {
		t.Fatal("klien harus memakai API biner")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res, err := c.Resource(ctx)
	if err != nil {
		t.Fatalf("Resource: %v", err)
	}
	if res.CPULoad != 7 || res.TotalMemory != 1000 || res.Version != "7.14" {
		t.Errorf("resource salah: %+v", res)
	}

	queues, err := c.Queues(ctx)
	if err != nil {
		t.Fatalf("Queues: %v", err)
	}
	if len(queues) != 1 || queues[0].Name != "pppoe-budi" || queues[0].DownBps != 9_000_000 {
		t.Errorf("queue salah: %+v", queues)
	}

	// Dua permintaan berurutan memakai soket yang sama (tidak ada login ulang).
	if got := c.api.created; got.IsZero() {
		t.Error("soket API harus tetap terbuka setelah permintaan")
	}
}

func TestBinaryAPIClientMapsAuthFailure(t *testing.T) {
	_, port := startFakeAPI(t, func(command string, _ []string, send func([]string)) {
		if command == "/login" {
			send([]string{"!trap", "=message=invalid user name or password"})
			send([]string{"!done"})
			return
		}
		send([]string{"!done"})
	})
	// NewClient tidak menghubungi router; panggilan pertama yang melakukannya.
	c, err := NewClient(Target{RouterID: "r1", BaseURL: "http://127.0.0.1:" + strconv.Itoa(port), Protocol: "api", Username: "noc", Password: "salah"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := c.Queues(ctx); err == nil || !strings.Contains(strings.ToLower(err.Error()), "login") {
		t.Fatalf("galat login harus jelas, got %v", err)
	}
}

func TestMonitorTrafficStreamsRouterRates(t *testing.T) {
	_, port := startFakeAPI(t, func(command string, words []string, send func([]string)) {
		switch command {
		case "/login":
			send([]string{"!done"})
		case "/interface/monitor-traffic":
			if attr(words, "interface") != "ether2-lan0" {
				send([]string{"!trap", "=message=interface salah"})
				return
			}
			// Tanpa once: stream harus tetap terbuka, bukan satu sampel lalu
			// reconnect (yang membuat login/logout berulang di router).
			if attr(words, "once") != "" {
				t.Error("monitor-traffic tidak boleh memakai =once=")
			}
			send([]string{"!re", "=rx-bps=200000000", "=tx-bps=12000000"})
			send([]string{"!re", "=rx-bps=250000000", "=tx-bps=15000000"})
			send([]string{"!done"})
		}
	})
	c, err := NewClient(Target{RouterID: "r1", BaseURL: "http://127.0.0.1:" + strconv.Itoa(port), Protocol: "api", Username: "noc", Password: "secret"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var got [][2]float64
	err = c.MonitorTraffic(context.Background(), "ether2-lan0", func(rx, tx float64) {
		got = append(got, [2]float64{rx, tx})
	})
	if err != nil {
		t.Fatalf("MonitorTraffic: %v", err)
	}
	if len(got) != 2 || got[0][0] != 200 || got[0][1] != 12 || got[1][0] != 250 {
		t.Fatalf("sampel salah: %v", got)
	}
}

func TestBinaryAPIHandlesEmptyReply(t *testing.T) {
	_, port := startFakeAPI(t, func(command string, _ []string, send func([]string)) {
		if command == "/login" {
			send([]string{"!done"})
			return
		}
		// RouterOS mengirim !empty untuk tabel kosong, lalu !done.
		send([]string{"!empty"})
		send([]string{"!done"})
	})
	c, err := NewClient(Target{RouterID: "r1", BaseURL: "http://127.0.0.1:" + strconv.Itoa(port), Protocol: "api", Username: "noc", Password: "secret"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	queues, err := c.Queues(ctx)
	if err != nil {
		t.Fatalf("!empty tidak boleh menjadi galat: %v", err)
	}
	if len(queues) != 0 {
		t.Fatalf("harus kosong, got %+v", queues)
	}
}

func TestCalculateRateSafeRejectsCounterReset(t *testing.T) {
	if got := CalculateRateSafe(1000, 900, 1); got != 800 {
		t.Errorf("laju normal = %d, want 800 bit/detik", got)
	}
	if got := CalculateRateSafe(100, 900, 1); got != 0 {
		t.Errorf("counter turun harus 0, got %d", got)
	}
	if got := CalculateRateSafe(1000, 900, 0); got != 0 {
		t.Errorf("selang 0 harus 0, got %d", got)
	}
	if got := CalculateRateSafe(1000, 900, -1); got != 0 {
		t.Errorf("selang negatif harus 0, got %d", got)
	}
}

// bukti JSON dari API biner tetap bisa dibaca parser REST yang sama.
func TestBinaryAPIRowsMarshalAsJSONStrings(t *testing.T) {
	rows := []map[string]string{{"name": "ether1", "rx-byte": "10", "tx-byte": "0"}}
	body, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseIfCounters(body)
	if err != nil || len(parsed) != 1 || parsed[0].RxBytes != 10 {
		t.Fatalf("parse: %+v %v", parsed, err)
	}
}
