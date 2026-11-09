package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"testing"
	"time"

	"noc-isp/backend/internal/archive"
	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/engine"
	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/wire"
)

// Skenario: satu jam jaringan disimulasikan dengan jam palsu. Pada menit ke-20
// sampai ke-30 router A kehilangan pelanggannya (traffic jatuh dari 100 ke 10
// Mbps) dan router C tidak bisa dipoll sama sekali. Rule engine mengeluarkan
// gangguan "offline"; lalu, setelah jendela 5 menit di memori jauh terlewat,
// traffic pada jam gangguan itu dibaca lewat REST dari arsip PostgreSQL.
//
// Seluruh jalur dipakai apa adanya: Recorder -> Writer -> PGStore -> PostgreSQL
// -> History -> HTTP dengan tiket.
func TestIncidentTrafficIsReadableFromTheArchiveAfterTheLiveWindowMovedOn(t *testing.T) {
	pool := pgTestPool(t)
	routerA := insertRouter(t, pool, "RTR-A padam")
	routerB := insertRouter(t, pool, "RTR-B normal")
	routerC := insertRouter(t, pool, "RTR-C tak terpoll")

	var clock time.Time
	mgr := state.NewManager(state.WithClock(func() time.Time { return clock }))
	// 6 jam lalu di jam bulat: di dalam 24 jam terakhir, jadi pembersihan test
	// paket lain yang berbagi database ini tidak menyentuhnya, dan setelah
	// satu jam simulasi waktunya masih di masa lalu.
	t0 := time.Now().UTC().Add(-6 * time.Hour).Truncate(time.Hour)
	clock = t0
	for i, id := range []string{routerA, routerB, routerC} {
		if err := mgr.UpsertRouter(state.Router{ID: id, Name: fmt.Sprintf("RTR-%d", i), Host: fmt.Sprintf("10.9.0.%d", i+1), Active: true}); err != nil {
			t.Fatal(err)
		}
	}
	usernames := []string{"budi.001", "siti.002", "agus.003"}
	for i, username := range usernames {
		if err := mgr.UpsertCustomer(state.Customer{
			ID: fmt.Sprintf("cust-%d", i), Name: username, PPPoEUsername: username, RouterID: routerA, IsOnline: true,
		}); err != nil {
			t.Fatal(err)
		}
	}

	quiet := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	alerts, err := engine.New(engine.Options{
		Logger: quiet, Source: mgr, Rules: []engine.Rule{engine.OfflineRule{After: engine.DefaultOfflineAfter}},
	})
	if err != nil {
		t.Fatal(err)
	}
	store := archive.NewPGStore(pool)
	writer := archive.NewWriter(store, archive.Options{Logger: quiet, FlushInterval: time.Hour})
	runCtx, stopWriter := context.WithCancel(context.Background())
	writerDone := make(chan struct{})
	go func() {
		writer.Run(runCtx)
		close(writerDone)
	}()
	recorder := archive.Recorder{Next: mgr, Writer: writer}

	const (
		outageStart = 20 * 60
		outageEnd   = 30 * 60
		total       = 60 * 60
	)
	var events []engine.Event
	for second := 0; second < total; second++ {
		clock = t0.Add(time.Duration(second) * time.Second)
		down := second >= outageStart && second < outageEnd
		switch second {
		case outageStart:
			for _, username := range usernames {
				if _, err := mgr.SetOnline(username, false); err != nil {
					t.Fatal(err)
				}
			}
		case outageEnd:
			for _, username := range usernames {
				if _, err := mgr.SetOnline(username, true); err != nil {
					t.Fatal(err)
				}
			}
		}
		rxA := 100.0
		if down {
			rxA = 10
		}
		at := clock.Unix()
		for _, sample := range []struct {
			router string
			rx, tx float64
			skip   bool
		}{
			{routerA, rxA, rxA / 10, false},
			{routerB, 50, 5, false},
			{routerC, 30, 3, down}, // tidak terpoll selama gangguan: tidak ada sampel
		} {
			if sample.skip {
				continue
			}
			if accepted, err := recorder.RecordTraffic(sample.router, state.TrafficPoint{Time: at, RxMbps: sample.rx, TxMbps: sample.tx}); err != nil || !accepted {
				t.Fatalf("detik %d: sampel ditolak (%v, %v)", second, accepted, err)
			}
		}
		events = append(events, alerts.Evaluate(clock)...)
	}
	stopWriter()
	select {
	case <-writerDone:
	case <-time.After(30 * time.Second):
		t.Fatal("writer tidak berhenti")
	}
	wantSamples := uint64(3*total - (outageEnd - outageStart))
	if s := writer.Stats(); s.Written != wantSamples || s.Dropped != 0 || s.Skipped != 0 {
		t.Fatalf("Stats = %+v, want %d tersimpan tanpa yang dibuang", s, wantSamples)
	}

	// Gangguan menurut rule engine: awal dan akhirnya menjadi jendela yang dibaca.
	var starts, ends []engine.Event
	for _, e := range events {
		if e.Kind != "offline" || e.RouterID != routerA {
			continue
		}
		if e.Active {
			starts = append(starts, e)
		} else {
			ends = append(ends, e)
		}
	}
	if len(starts) != len(usernames) || len(ends) != len(usernames) {
		t.Fatalf("event offline router A: %d mulai dan %d selesai, want %d dan %d", len(starts), len(ends), len(usernames), len(usernames))
	}
	incidentStart, incidentEnd := starts[0].StartedAt, ends[0].Time
	if !incidentStart.Equal(t0.Add(outageStart*time.Second)) || !incidentEnd.Equal(t0.Add(outageEnd*time.Second)) {
		t.Fatalf("gangguan = %s .. %s, want menit ke-20 sampai ke-30", incidentStart, incidentEnd)
	}

	tokens, err := auth.NewTokens(apiSecret)
	if err != nil {
		t.Fatal(err)
	}
	h := &apiHarness{t: t, tokens: tokens, mgr: mgr, handler: NewHandler(Options{
		Logger: quiet, Data: mgr, Verifier: tokens, AllowedOrigins: []string{apiOrigin}, History: store,
	})}

	// Jendela langsung (memori) sudah jauh melewati gangguan: itulah sebabnya arsip dibutuhkan.
	live := decode[dataResponse[wire.TrafficSeries]](t, h.get("/api/v1/traffic")).Data
	if len(live.Times) == 0 || live.Times[0] <= incidentEnd.Unix() {
		t.Fatalf("jendela langsung mulai %v; seharusnya sudah setelah gangguan berakhir (%d)", live.Times, incidentEnd.Unix())
	}

	// Baca dari 5 menit sebelum sampai 5 menit sesudah gangguan, per menit.
	window := func(router string, extra string) historyBody {
		t.Helper()
		query := fmt.Sprintf("/api/v1/traffic/history?router=%s&from=%d&to=%d%s",
			router, incidentStart.Add(-5*time.Minute).Unix(), incidentEnd.Add(5*time.Minute).Unix(), extra)
		rec := h.get(query)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d; body %s", query, rec.Code, rec.Body)
		}
		return decode[historyBody](t, rec)
	}
	closeTo := func(got, want float64) bool { return math.Abs(got-want) < 1e-9 }

	// Router A: turun saat gangguan lalu pulih. 5 menit normal, 10 menit turun, 5 menit normal.
	a := window(routerA, "&step=60")
	if len(a.Data.Times) != 20 {
		t.Fatalf("router A: %d titik, want 20 (%+v)", len(a.Data.Times), a.Data)
	}
	for i, at := range a.Data.Times {
		wantRx := 100.0
		if i >= 5 && i < 15 {
			wantRx = 10
		}
		if want := incidentStart.Add(-5*time.Minute).Unix() + int64(i)*60; at != want {
			t.Errorf("router A titik %d: waktu %d, want %d", i, at, want)
		}
		if !closeTo(a.Data.Rx[i], wantRx) || !closeTo(a.Data.Tx[i], wantRx/10) {
			t.Errorf("router A menit %d: rx/tx = %v/%v, want %v/%v", i, a.Data.Rx[i], a.Data.Tx[i], wantRx, wantRx/10)
		}
	}

	// Router B tidak ikut terpengaruh.
	b := window(routerB, "&step=60")
	if len(b.Data.Times) != 20 {
		t.Fatalf("router B: %d titik, want 20", len(b.Data.Times))
	}
	for i, rx := range b.Data.Rx {
		if !closeTo(rx, 50) {
			t.Errorf("router B menit %d: rx = %v, want 50 (tidak terpengaruh)", i, rx)
		}
	}

	// Router C tidak terpoll: arsip tidak mengarang nol, celahnya terlihat.
	c := window(routerC, "&step=60")
	if len(c.Data.Times) != 10 {
		t.Fatalf("router C: %d titik, want 10 (sepuluh menit tanpa sampel tidak boleh muncul): %+v", len(c.Data.Times), c.Data)
	}
	for i, at := range c.Data.Times {
		if at >= incidentStart.Unix() && at < incidentEnd.Unix() {
			t.Errorf("router C titik %d (%d) jatuh di dalam gangguan padahal tidak ada sampel", i, at)
		}
		if !closeTo(c.Data.Rx[i], 30) {
			t.Errorf("router C titik %d: rx = %v, want 30", i, c.Data.Rx[i])
		}
	}
	if gap := c.Data.Times[5] - c.Data.Times[4]; gap != 60*11 {
		t.Errorf("celah router C = %d detik, want %d (sepuluh menit hilang)", gap, 60*11)
	}

	// Tepat jendela gangguan, tanpa step: langkah otomatis 2 detik (300 titik),
	// batas akhir tidak ikut, dan semuanya bernilai saat gangguan.
	exact := fmt.Sprintf("/api/v1/traffic/history?router=%s&from=%d&to=%d", routerA, incidentStart.Unix(), incidentEnd.Unix())
	rec := h.get(exact)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body %s", rec.Code, rec.Body)
	}
	during := decode[historyBody](t, rec).Data
	if during.Step != 2 || len(during.Times) != 300 ||
		during.Times[0] != incidentStart.Unix() || during.Times[len(during.Times)-1] != incidentEnd.Unix()-2 {
		t.Fatalf("jendela gangguan: step %d, %d titik, %d..%d; want 2 dtk, 300 titik, %d..%d",
			during.Step, len(during.Times), during.Times[0], during.Times[len(during.Times)-1], incidentStart.Unix(), incidentEnd.Unix()-2)
	}
	for i, rx := range during.Rx {
		if !closeTo(rx, 10) {
			t.Fatalf("titik %d: rx = %v, want 10 selama gangguan (data di luar gangguan ikut terbaca)", i, rx)
		}
	}
}
