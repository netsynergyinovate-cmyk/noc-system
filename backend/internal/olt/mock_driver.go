package olt

import (
	"context"
	"errors"
	"fmt"
)

const (
	mockPonCount   = 4
	mockOnuPerPon  = 8
	mockOfflineMod = 7 // setiap ONU ke-7 offline
)

type mockDriver struct {
	name   string
	cfg    Config
	closed bool
}

func init() {
	// ponytail: "stub" alias "mock"; hapus bila driver HSGQ nyata sudah menggantikan.
	for _, n := range []string{"mock", "stub"} {
		name := n
		Register(name, func(cfg Config) (Driver, error) {
			return &mockDriver{name: name, cfg: cfg}, nil
		})
	}
}

func f64(v float64) *float64 { return &v }

func (m *mockDriver) Name() string { return m.name }

func (m *mockDriver) check(ctx context.Context) error {
	if m.closed {
		return errors.New("olt: driver sudah ditutup")
	}
	return ctx.Err()
}

func (m *mockDriver) FetchPonPorts(ctx context.Context) ([]PonPortStats, error) {
	if err := m.check(ctx); err != nil {
		return nil, err
	}
	out := make([]PonPortStats, 0, mockPonCount)
	for p := 1; p <= mockPonCount; p++ {
		online := 0
		for o := 1; o <= mockOnuPerPon; o++ {
			if mockOnline(p, o) {
				online++
			}
		}
		out = append(out, PonPortStats{
			Index:          p,
			RxPowerDbm:     f64(-18.0 - float64(p)*0.5),
			TxPowerDbm:     f64(3.5),
			AttenuationDb:  f64(21.5 + float64(p)*0.5),
			OnuOnlineCount: online,
		})
	}
	return out, nil
}

func (m *mockDriver) FetchOnus(ctx context.Context) ([]OnuStats, error) {
	if err := m.check(ctx); err != nil {
		return nil, err
	}
	out := make([]OnuStats, 0, mockPonCount*mockOnuPerPon)
	for p := 1; p <= mockPonCount; p++ {
		for o := 1; o <= mockOnuPerPon; o++ {
			s := OnuStats{
				PonIndex:   p,
				OnuIndex:   o,
				MacAddress: fmt.Sprintf("AA:BB:CC:%02X:%02X:01", p, o),
				IsOnline:   mockOnline(p, o),
			}
			if s.IsOnline { // ONU offline tidak punya pembacaan optik
				rx := -19.0 - float64((p*o)%10)*0.8
				s.RxPowerDbm = f64(rx)
				s.TxPowerDbm = f64(2.0)
				s.AttenuationDb = f64(3.5 - rx) // tx OLT 3.5 dBm dikurangi rx
			}
			out = append(out, s)
		}
	}
	return out, nil
}

func (m *mockDriver) TestConnection(ctx context.Context) error { return m.check(ctx) }

func (m *mockDriver) Close() error {
	m.closed = true
	return nil
}

func mockOnline(p, o int) bool { return (p*mockOnuPerPon+o)%mockOfflineMod != 0 }
