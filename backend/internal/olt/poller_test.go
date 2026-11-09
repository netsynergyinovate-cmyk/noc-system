package olt

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

const (
	testPonCount  = 4
	testOnuPerPon = 8
)

type testDriver struct{}

func (testDriver) Name() string { return "test" }
func (testDriver) Close() error { return nil }
func (testDriver) TestConnection(context.Context) error { return nil }
func (testDriver) FetchPonPorts(context.Context) ([]PonPortStats, error) {
	out := make([]PonPortStats, testPonCount)
	for i := range out {
		out[i] = PonPortStats{Index: i + 1}
	}
	return out, nil
}
func (testDriver) FetchOnus(context.Context) ([]OnuStats, error) {
	out := make([]OnuStats, 0, testPonCount*testOnuPerPon)
	for p := 1; p <= testPonCount; p++ {
		for o := 1; o <= testOnuPerPon; o++ {
			out = append(out, OnuStats{PonIndex: p, OnuIndex: o, MacAddress: "AA:BB:CC:DD:EE:FF"})
		}
	}
	return out, nil
}

type memWriter struct {
	ports   map[int]PonPortStats
	touched []time.Time
	upErr   error
}

func (w *memWriter) UpsertPonPort(_ context.Context, _ string, s PonPortStats) error {
	if w.upErr != nil {
		return w.upErr
	}
	if w.ports == nil {
		w.ports = map[int]PonPortStats{}
	}
	w.ports[s.Index] = s
	return nil
}

func (w *memWriter) TouchOlt(_ context.Context, _ string, at time.Time) error {
	w.touched = append(w.touched, at)
	return nil
}

type failDriver struct{ Driver }

func (failDriver) FetchPonPorts(context.Context) ([]PonPortStats, error) {
	return nil, errors.New("boom")
}

type memOnuWriter struct {
	onus  map[[2]int]OnuStats
	upErr error
}

func (w *memOnuWriter) UpsertOnu(_ context.Context, _ string, s OnuStats) error {
	if w.upErr != nil {
		return w.upErr
	}
	if w.onus == nil {
		w.onus = map[[2]int]OnuStats{}
	}
	w.onus[[2]int{s.PonIndex, s.OnuIndex}] = s
	return nil
}

type failOnuDriver struct{ Driver }

func (failOnuDriver) FetchOnus(context.Context) ([]OnuStats, error) {
	return nil, errors.New("boom")
}

type unsupportedOnuDriver struct{ Driver }

func (unsupportedOnuDriver) FetchOnus(context.Context) ([]OnuStats, error) {
	return nil, fmt.Errorf("hsgq: onu detail: %w", ErrNotSupported)
}

func TestPollOnceNotSupportedSkipsAndTouches(t *testing.T) {
	d := testDriver{}
	w, ow := &memWriter{}, &memOnuWriter{}
	p, _ := NewPoller(PollerOptions{Driver: unsupportedOnuDriver{d}, OltID: "olt1", Writer: w, OnuWriter: ow})
	if err := p.PollOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(w.touched) != 1 || len(w.ports) != testPonCount || len(ow.onus) != 0 {
		t.Fatalf("touched=%d ports=%d onus=%d", len(w.touched), len(w.ports), len(ow.onus))
	}
}

func TestGetUnknownDriverIsErrDriverNotFound(t *testing.T) {
	if _, err := Get("tidak-ada", Config{}); !errors.Is(err, ErrDriverNotFound) {
		t.Fatalf("err=%v", err)
	}
}

func TestPollerPollsOnus(t *testing.T) {
	newPoller := func(d Driver, w *memWriter, ow *memOnuWriter) *Poller {
		p, err := NewPoller(PollerOptions{Driver: d, OltID: "olt1", Writer: w, OnuWriter: ow})
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	d := testDriver{}

	t.Run("simpan semua ONU", func(t *testing.T) {
		w, ow := &memWriter{}, &memOnuWriter{}
		if err := newPoller(d, w, ow).PollOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
		if want := testPonCount * testOnuPerPon; len(ow.onus) != want {
			t.Fatalf("onus=%d want %d", len(ow.onus), want)
		}
		if len(w.touched) != 1 {
			t.Fatalf("touched=%d", len(w.touched))
		}
	})
	t.Run("FetchOnus gagal", func(t *testing.T) {
		w, ow := &memWriter{}, &memOnuWriter{}
		if err := newPoller(failOnuDriver{d}, w, ow).PollOnce(context.Background()); err == nil {
			t.Fatal("want error")
		}
		if len(w.touched) != 0 || len(ow.onus) != 0 {
			t.Fatal("tidak boleh touch/menulis")
		}
	})
	t.Run("UpsertOnu gagal", func(t *testing.T) {
		w, ow := &memWriter{}, &memOnuWriter{upErr: errors.New("db down")}
		if err := newPoller(d, w, ow).PollOnce(context.Background()); err == nil {
			t.Fatal("want error")
		}
		if len(w.touched) != 0 {
			t.Fatal("TouchOlt tidak boleh dipanggil")
		}
	})
	t.Run("tanpa OnuWriter FetchOnus tidak dipanggil", func(t *testing.T) {
		w := &memWriter{}
		p, _ := NewPoller(PollerOptions{Driver: failOnuDriver{d}, OltID: "olt1", Writer: w})
		if err := p.PollOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
	})
}

func TestPollOnceSavesAllAndTouches(t *testing.T) {
	d := testDriver{}
	w := &memWriter{}
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	p, err := NewPoller(PollerOptions{Driver: d, OltID: "olt1", Writer: w, Now: func() time.Time { return at }})
	if err != nil {
		t.Fatal(err)
	}
	if err := p.PollOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(w.ports) != testPonCount {
		t.Fatalf("ports=%d want %d", len(w.ports), testPonCount)
	}
	if len(w.touched) != 1 || !w.touched[0].Equal(at) {
		t.Fatalf("touched=%v", w.touched)
	}
}

func TestPollOnceDriverErrorNoTouch(t *testing.T) {
	d := testDriver{}
	w := &memWriter{}
	p, _ := NewPoller(PollerOptions{Driver: failDriver{d}, OltID: "olt1", Writer: w})
	if err := p.PollOnce(context.Background()); err == nil {
		t.Fatal("want error")
	}
	if len(w.touched) != 0 || len(w.ports) != 0 {
		t.Fatalf("tidak boleh menulis: touched=%d ports=%d", len(w.touched), len(w.ports))
	}
}

func TestPollOnceWriteErrorNoTouch(t *testing.T) {
	d := testDriver{}
	w := &memWriter{upErr: errors.New("db down")}
	p, _ := NewPoller(PollerOptions{Driver: d, OltID: "olt1", Writer: w})
	if err := p.PollOnce(context.Background()); err == nil {
		t.Fatal("want error")
	}
	if len(w.touched) != 0 {
		t.Fatal("TouchOlt tidak boleh dipanggil")
	}
}
