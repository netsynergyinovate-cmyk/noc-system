package collector

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func pppClient(t *testing.T, body string) *Client {
	t.Helper()
	return pppClientProp(t, body, "name,address")
}

func pppClientProp(t *testing.T, body, proplist string) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/ppp/active" || r.URL.Query().Get(".proplist") != proplist {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	c, err := NewClient(Target{RouterID: "r1", BaseURL: srv.URL, Username: "u", Password: "p"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestPPPActiveAddress(t *testing.T) {
	const rows = `[{"name":"17060001092@runsnet.id","address":"172.16.15.248"},
		{"name":"Budi","address":"10.0.0.5"},{"name":"BUDI","address":"10.0.0.6"},
		{"name":"Sari","address":"10.0.0.7"},{"name":"tanpa-ip","address":""}]`
	c := pppClient(t, rows)
	cases := []struct {
		name string
		addr string
		ok   bool
	}{
		{"17060001092@runsnet.id", "172.16.15.248", true},
		{"Budi", "10.0.0.5", true}, // persis menang
		{"budi", "", false},        // dua yang cocok tanpa huruf besar/kecil: tidak menebak
		{"SARI", "10.0.0.7", true}, // satu yang cocok: boleh
		{"tanpa-ip", "", false},    // sesi tanpa alamat tidak dihitung
		{"tidak-ada", "", false},
	}
	for _, tc := range cases {
		addr, ok, err := c.PPPActiveAddress(context.Background(), tc.name)
		if err != nil || addr != tc.addr || ok != tc.ok {
			t.Errorf("%q: addr=%q ok=%v err=%v", tc.name, addr, ok, err)
		}
	}
}

func TestPPPActiveAddressBadJSON(t *testing.T) {
	if _, _, err := pppClient(t, `<html>`).PPPActiveAddress(context.Background(), "x"); err == nil {
		t.Fatal("harus galat")
	}
}

func TestPPPActiveByMAC(t *testing.T) {
	const rows = `[
		{"name":"a","address":"172.16.15.248","caller-id":"D0:5F:AF:D3:7C:1F"},
		{"name":"b","address":"172.16.15.239","caller-id":"D0:5F:AF:D3:C7:1F"},
		{"name":"c","address":"10.9.9.9","caller-id":"AA:BB:CC:DD:EE:01"},
		{"name":"d","address":"10.9.9.10","caller-id":"AA:BB:CC:DD:EE:02"},
		{"name":"e","address":"10.1.1.1","caller-id":"D0:5F:AF:D4:00:1F"},
		{"name":"f","address":"","caller-id":"11:22:33:44:55:66"},
		{"name":"g","address":"10.2.2.2","caller-id":"bukan-mac"}]`
	c := pppClientProp(t, rows, "name,address,caller-id")
	cases := []struct {
		mac  string
		addr string
		ok   bool
	}{
		{"D0:5F:AF:D3:C7:1D", "172.16.15.239", true}, // WAN = ONU + 2
		{"d0-5f-af-d3-7c-1d", "172.16.15.248", true}, // huruf kecil dan tanda hubung
		{"D0:5F:AF:D3:C7:1F", "", false},             // sama persis: selisih 0 bukan modem berbeda blok
		{"D0:5F:AF:D3:C7:1A", "", false},             // selisih 5 > 3
		{"D0:5F:AF:D3:C7:20", "", false},             // caller-id lebih KECIL dari MAC ONU
		{"AA:BB:CC:DD:EE:00", "", false},             // dua kandidat (01 dan 02): tidak menebak
		{"D0:5F:AF:D4:00:1D", "10.1.1.1", true},      // lintas nilai tetapi lima oktet pertama sama
		{"D0:5F:AF:D3:C7", "", false},                // bukan MAC
		{"", "", false},
	}
	for _, tc := range cases {
		addr, ok, err := c.PPPActiveByMAC(context.Background(), tc.mac, 3)
		if err != nil || addr != tc.addr || ok != tc.ok {
			t.Errorf("%q: addr=%q ok=%v err=%v", tc.mac, addr, ok, err)
		}
	}
}
