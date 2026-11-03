package collector

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestMatchIsolirSessions(t *testing.T) {
	tests := []struct {
		name     string
		sessions []PPPSession
		entries  []AddressListEntry
		want     map[string]bool
	}{
		{
			name: "no isolir entries returns nil",
			sessions: []PPPSession{
				{Name: "user1", Address: "10.0.0.1"},
			},
			entries: []AddressListEntry{
				{List: "whitelist", Address: "10.0.0.1", Disabled: false},
				{List: "ISOLIR", Address: "10.0.0.1", Disabled: true}, // disabled
			},
			want: nil,
		},
		{
			name: "single IP match and non-match",
			sessions: []PPPSession{
				{Name: "user1", Address: "192.168.1.50"},
				{Name: "user2", Address: "192.168.1.51"},
			},
			entries: []AddressListEntry{
				{List: "ISOLIR-LIST", Address: "192.168.1.50", Disabled: false},
			},
			want: map[string]bool{
				"user1": true,
				"user2": false,
			},
		},
		{
			name: "CIDR subnet match",
			sessions: []PPPSession{
				{Name: "user1", Address: "172.16.20.10"},
				{Name: "user2", Address: "172.16.21.10"},
			},
			entries: []AddressListEntry{
				{List: "pool-bras-runsnet-isolir", Address: "172.16.20.0/24", Disabled: false},
			},
			want: map[string]bool{
				"user1": true,
				"user2": false,
			},
		},
		{
			name: "range a-b match boundary and middle",
			sessions: []PPPSession{
				{Name: "user1", Address: "10.10.10.20"}, // start boundary
				{Name: "user2", Address: "10.10.10.25"}, // middle
				{Name: "user3", Address: "10.10.10.30"}, // end boundary
				{Name: "user4", Address: "10.10.10.31"}, // outside
				{Name: "user5", Address: "10.10.10.19"}, // outside
			},
			entries: []AddressListEntry{
				{List: "ISOLIR", Address: "10.10.10.20-10.10.10.30", Disabled: false},
			},
			want: map[string]bool{
				"user1": true,
				"user2": true,
				"user3": true,
				"user4": false,
				"user5": false,
			},
		},
		{
			name: "case-insensitive username and trimming",
			sessions: []PPPSession{
				{Name: "  17060001797@RunsNet.ID  ", Address: "172.16.20.5"},
			},
			entries: []AddressListEntry{
				{List: "ISOLIR_PELANGGAN", Address: "172.16.20.0/24", Disabled: false},
			},
			want: map[string]bool{
				"17060001797@runsnet.id": true,
			},
		},
		{
			name: "unparsable entry ignored without error",
			sessions: []PPPSession{
				{Name: "user1", Address: "172.16.20.5"},
				{Name: "user2", Address: "invalid-ip"},
			},
			entries: []AddressListEntry{
				{List: "isolir", Address: "not-an-ip-or-cidr", Disabled: false},
				{List: "isolir", Address: "172.16.20.0/24", Disabled: false},
			},
			want: map[string]bool{
				"user1": true,
				"user2": false,
			},
		},
		{
			name: "non-pppoe session ignored",
			sessions: []PPPSession{
				{Name: "user-vpn", Service: "l2tp", Address: "172.16.20.5"},
				{Name: "user-pppoe", Service: "pppoe", Address: "172.16.20.5"},
			},
			entries: []AddressListEntry{
				{List: "isolir", Address: "172.16.20.0/24", Disabled: false},
			},
			want: map[string]bool{
				"user-pppoe": true,
			},
		},
		{
			name: "duplicate sessions with same username true wins",
			sessions: []PPPSession{
				{Name: "user1", Address: "192.168.1.1"},
				{Name: "user1", Address: "172.16.20.5"},
			},
			entries: []AddressListEntry{
				{List: "isolir", Address: "172.16.20.0/24", Disabled: false},
			},
			want: map[string]bool{
				"user1": true,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := MatchIsolirSessions(tc.sessions, tc.entries)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("MatchIsolirSessions() = %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestClientAddressList(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/ip/firewall/address-list" {
			t.Errorf("path salah: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get(".proplist") != addressListProplist {
			t.Errorf("proplist salah: %s", r.URL.Query().Get(".proplist"))
		}
		w.Header().Set("Content-Type", "application/json")
		// Menguji percampuran boolean sebagai teks dan boolean asli
		w.Write([]byte(`[
			{"list": "POOL-ISOLIR", "address": "172.16.20.0/24", "disabled": "false"},
			{"list": "BLOKIR", "address": "10.0.0.1", "disabled": true},
			{"list": "ISOLIR-MANUAL", "address": "10.1.1.5", "disabled": "true"}
		]`))
	}))
	defer srv.Close()

	client, err := NewClient(Target{
		RouterID: "r1",
		BaseURL:  srv.URL,
		Username: "admin",
		Password: "secret",
	}, http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}

	entries, err := client.AddressList(context.Background())
	if err != nil {
		t.Fatalf("AddressList() error: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("panjang entri = %d, want 3", len(entries))
	}
	if entries[0].List != "POOL-ISOLIR" || entries[0].Disabled != false {
		t.Errorf("entri 0 salah: %+v", entries[0])
	}
	if entries[1].List != "BLOKIR" || entries[1].Disabled != true {
		t.Errorf("entri 1 salah: %+v", entries[1])
	}
	if entries[2].List != "ISOLIR-MANUAL" || entries[2].Disabled != true {
		t.Errorf("entri 2 salah: %+v", entries[2])
	}
}
