package olt

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func hsgqServer(t *testing.T, status int) (Driver, *httptest.Server) {
	t.Helper()
	mux := http.NewServeMux()
	guard := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if status != http.StatusOK {
				w.WriteHeader(status)
				return
			}
			if u, p, ok := r.BasicAuth(); !ok || u != "admin" || p != "pw" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc(hsgqPathSystem, guard(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(`{}`)) }))
	mux.HandleFunc(hsgqPathPon, guard(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"ports":[{"id":1,"rx_power":-18.5,"tx_power":3.5,"online_onu":12},{"id":2,"online_onu":0}]}`))
	}))
	mux.HandleFunc(hsgqPathOnu, guard(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"onus":[
			{"pon":1,"id":1,"mac":"aa:bb:cc:00:00:01","status":"online","rx_power":-21.4,"tx_power":2.1,"attenuation":24.9},
			{"pon":1,"id":2,"mac":"aa:bb:cc:00:00:02","status":"offline","rx_power":-40}]}`))
	}))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	d, err := Get("hsgq", Config{Host: srv.URL, Username: "admin", Password: "pw", Timeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d, srv
}

func TestHsgqTestConnection(t *testing.T) {
	d, _ := hsgqServer(t, http.StatusOK)
	if d.Name() != "hsgq" {
		t.Fatalf("name = %q", d.Name())
	}
	if err := d.TestConnection(context.Background()); err != nil {
		t.Fatalf("200 harus sukses: %v", err)
	}
	for _, code := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		d, _ := hsgqServer(t, code)
		if err := d.TestConnection(context.Background()); err == nil {
			t.Fatalf("%d harus gagal", code)
		}
	}
}

func TestHsgqBadCredentials(t *testing.T) {
	_, srv := hsgqServer(t, http.StatusOK)
	d, _ := Get("hsgq", Config{Host: srv.URL, Username: "admin", Password: "salah"})
	if err := d.TestConnection(context.Background()); err == nil {
		t.Fatal("password salah harus gagal")
	}
}

func TestHsgqFetchPonPorts(t *testing.T) {
	d, _ := hsgqServer(t, http.StatusOK)
	ports, err := d.FetchPonPorts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(ports) != 2 {
		t.Fatalf("len = %d", len(ports))
	}
	p := ports[0]
	if p.Index != 1 || p.OnuOnlineCount != 12 || p.RxPowerDbm == nil || *p.RxPowerDbm != -18.5 ||
		p.TxPowerDbm == nil || *p.TxPowerDbm != 3.5 || p.AttenuationDb == nil || *p.AttenuationDb != 22 {
		t.Fatalf("port 1 salah: %+v", p)
	}
	if q := ports[1]; q.RxPowerDbm != nil || q.AttenuationDb != nil {
		t.Fatalf("optik hilang harus nil: %+v", q)
	}
}

func TestHsgqFetchOnus(t *testing.T) {
	d, _ := hsgqServer(t, http.StatusOK)
	onus, err := d.FetchOnus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(onus) != 2 {
		t.Fatalf("len = %d", len(onus))
	}
	a := onus[0]
	if !a.IsOnline || a.MacAddress != "AA:BB:CC:00:00:01" || a.PonIndex != 1 || a.OnuIndex != 1 ||
		a.RxPowerDbm == nil || *a.RxPowerDbm != -21.4 || a.TxPowerDbm == nil || *a.TxPowerDbm != 2.1 {
		t.Fatalf("onu online salah: %+v", a)
	}
	if b := onus[1]; b.IsOnline || b.RxPowerDbm != nil {
		t.Fatalf("onu offline tidak boleh punya optik: %+v", b)
	}
}

func TestHsgqClosed(t *testing.T) {
	d, _ := hsgqServer(t, http.StatusOK)
	d.Close()
	if err := d.TestConnection(context.Background()); err == nil {
		t.Fatal("setelah Close harus gagal")
	}
}
