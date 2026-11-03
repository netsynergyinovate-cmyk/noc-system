package collector

import (
	"testing"
	"time"
)

func TestParseVlansKeepsOnlyPonVlans(t *testing.T) {
	rows, err := parseVlans([]byte(`[
		{"name":"vlan1101","rx-byte":"1","tx-byte":"2","running":"true","disabled":"false"},
		{"name":"vlan10","rx-byte":"1","tx-byte":"2"},
		{"name":"vlan1106","rx-byte":"1","tx-byte":"2"}]`))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].Name != "vlan1101" || rows[1].Name != "vlan1106" {
		t.Fatalf("rows = %+v", rows)
	}
}

func TestVlanRatesTxIsDownloadAndFirstReadingHasNoRate(t *testing.T) {
	prev := map[string]ifSample{}
	t0 := time.Unix(1000, 0)
	row := func(rx, tx string) []rawVlan {
		return []rawVlan{{Name: "vlan1101", RxByte: rx, TxByte: tx, Running: "true"}}
	}

	first := vlanRates(prev, row("0", "0"), t0)
	if first[0].RateOK || !first[0].Running {
		t.Fatalf("pembacaan pertama tidak punya laju: %+v", first[0])
	}

	// 1 detik kemudian: Rx +125000 B = 1 Mbps (upload), Tx +1250000 B = 10 Mbps (download).
	second := vlanRates(prev, row("125000", "1250000"), t0.Add(time.Second))
	if !second[0].RateOK || second[0].DownMbps != 10 || second[0].UpMbps != 1 {
		t.Fatalf("laju salah: %+v", second[0])
	}

	// Counter turun (router restart): tidak ada laju, bukan angka negatif.
	reset := vlanRates(prev, row("10", "10"), t0.Add(2*time.Second))
	if reset[0].RateOK {
		t.Fatalf("counter turun harus tanpa laju: %+v", reset[0])
	}
}
