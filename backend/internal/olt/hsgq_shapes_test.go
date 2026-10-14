package olt

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Bentuk yang dipakai simulator dan klien HSGQ di sisi Next.js: daftar langsung,
// camelCase, status online/offline/los, nomor seri dan MAC terpisah.
func camelServer(t *testing.T) Driver {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(hsgqPathPon, func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`[
			{"ponIndex":1,"name":"PON 1","status":"up","txPowerDbm":2.5,"rxPowerDbm":-19.0,"attenuationDb":22,"onuOnlineCount":7},
			{"ponIndex":2,"txPowerDbm":2.5,"rxPowerDbm":-19.5,"onuOnlineCount":3}]`))
	})
	mux.HandleFunc(hsgqPathOnu, func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`[
			{"ponIndex":1,"onuIndex":1,"serialNumber":"hsgq11","macAddress":"00:1a:2b:01:00:01","status":"online","rxPowerDbm":-21.5,"txPowerDbm":2.1,"distanceMeters":340},
			{"ponIndex":1,"onuIndex":7,"serialNumber":"HSGQ17","macAddress":"00:1A:2B:01:00:07","status":"los","rxPowerDbm":-31,"txPowerDbm":null},
			{"ponIndex":1,"onuIndex":8,"serialNumber":"HSGQ18","status":"offline","rxPowerDbm":null}]`))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	d, err := Get("hsgq", Config{Host: srv.URL, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestHsgqAcceptsCamelCaseArrayShape(t *testing.T) {
	d := camelServer(t)
	ports, err := d.FetchPonPorts(context.Background())
	if err != nil || len(ports) != 2 {
		t.Fatalf("ports=%v err=%v", ports, err)
	}
	if p := ports[0]; p.Index != 1 || p.OnuOnlineCount != 7 || *p.RxPowerDbm != -19 || *p.AttenuationDb != 22 {
		t.Errorf("port 1: %+v", p)
	}
	// Redaman tidak dilaporkan: dihitung dari selisih daya, bukan 0.
	if p := ports[1]; p.AttenuationDb == nil || *p.AttenuationDb != 22 {
		t.Errorf("port 2 harus menghitung redaman 2.5 - (-19.5) = 22: %+v", p)
	}
}

func TestHsgqOnuStatesSerialAndOpticalRules(t *testing.T) {
	d := camelServer(t)
	onus, err := d.FetchOnus(context.Background())
	if err != nil || len(onus) != 3 {
		t.Fatalf("onus=%v err=%v", onus, err)
	}
	on, los, off := onus[0], onus[1], onus[2]
	if on.State != "online" || !on.IsOnline || on.SerialNumber != "HSGQ11" || on.MacAddress != "00:1A:2B:01:00:01" || *on.RxPowerDbm != -21.5 {
		t.Errorf("online: %+v", on)
	}
	if los.State != "los" || los.IsOnline || los.RxPowerDbm != nil {
		t.Errorf("LOS tidak online dan tidak punya bacaan optik yang berarti: %+v", los)
	}
	if off.State != "offline" || off.MacAddress != "" || off.SerialNumber != "HSGQ18" {
		t.Errorf("offline: %+v", off)
	}
}

func TestHsgqRejectsRowsWithoutIndexAndGarbage(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc(hsgqPathPon, func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(`[{"txPowerDbm":1}]`)) })
	mux.HandleFunc(hsgqPathOnu, func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(`<html>login</html>`)) })
	srv := httptest.NewServer(mux)
	defer srv.Close()
	d, _ := Get("hsgq", Config{Host: srv.URL, Timeout: time.Second})
	defer d.Close()
	if _, err := d.FetchPonPorts(context.Background()); err == nil {
		t.Error("port tanpa nomor PON harus ditolak, bukan ditebak sebagai PON 0")
	}
	if _, err := d.FetchOnus(context.Background()); err == nil {
		t.Error("jawaban bukan JSON (halaman login) harus galat")
	}
}
