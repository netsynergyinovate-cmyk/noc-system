package olt

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestMockRegistered(t *testing.T) {
	have := map[string]bool{}
	for _, n := range Drivers() {
		have[n] = true
	}
	if !have["mock"] || !have["stub"] {
		t.Fatalf("mock/stub tidak terdaftar: %v", Drivers())
	}
}

func TestGetMock(t *testing.T) {
	d, err := Get("mock", Config{Host: "1.2.3.4", Timeout: time.Second})
	if err != nil || d == nil {
		t.Fatalf("Get mock: %v", err)
	}
	defer d.Close()
	if d.Name() != "mock" {
		t.Errorf("Name = %q", d.Name())
	}
	if err := d.TestConnection(context.Background()); err != nil {
		t.Errorf("TestConnection: %v", err)
	}
}

func TestMockFetch(t *testing.T) {
	d, _ := Get("stub", Config{})
	defer d.Close()
	ctx := context.Background()

	pons, err := d.FetchPonPorts(ctx)
	if err != nil || len(pons) == 0 {
		t.Fatalf("FetchPonPorts: %v, n=%d", err, len(pons))
	}
	for _, p := range pons {
		if p.Index < 1 || p.RxPowerDbm == nil || p.OnuOnlineCount < 0 {
			t.Errorf("PON tidak valid: %+v", p)
		}
	}

	onus, err := d.FetchOnus(ctx)
	if err != nil || len(onus) == 0 {
		t.Fatalf("FetchOnus: %v, n=%d", err, len(onus))
	}
	online := map[int]int{}
	for _, o := range onus {
		if o.MacAddress == "" {
			t.Errorf("MAC kosong: %+v", o)
		}
		if o.IsOnline {
			online[o.PonIndex]++
			if o.RxPowerDbm == nil {
				t.Errorf("ONU online tanpa rx: %+v", o)
			}
		} else if o.RxPowerDbm != nil {
			t.Errorf("ONU offline punya rx: %+v", o)
		}
	}
	for _, p := range pons {
		if online[p.Index] != p.OnuOnlineCount {
			t.Errorf("PON %d: online %d != %d", p.Index, online[p.Index], p.OnuOnlineCount)
		}
	}
}

func TestMockClosedAndCancelled(t *testing.T) {
	d, _ := Get("mock", Config{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := d.FetchOnus(ctx); err == nil {
		t.Error("harus error saat ctx batal")
	}
	d.Close()
	if err := d.TestConnection(context.Background()); err == nil {
		t.Error("harus error setelah Close")
	}
}

func TestGetUnknown(t *testing.T) {
	d, err := Get("tidak-ada", Config{})
	if err == nil || d != nil {
		t.Fatal("harus error")
	}
	if !strings.Contains(err.Error(), "tidak-ada") || !strings.Contains(err.Error(), "tidak terdaftar") {
		t.Errorf("pesan kurang jelas: %v", err)
	}
}

func TestRegisterDuplicatePanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("harus panic untuk nama dobel")
		}
	}()
	Register("mock", func(Config) (Driver, error) { return nil, nil })
}
