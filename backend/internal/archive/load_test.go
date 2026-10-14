package archive

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"noc-isp/backend/internal/state"
)

// Uji beban memakai PostgreSQL sungguhan (lihat testPool). Angka batasnya
// sengaja longgar, puluhan kali di atas hasil ukur biasa, supaya test tidak
// goyah di mesin yang lambat; yang dijaga adalah bentuknya: jalur per detik
// tidak menunggu database, antrean tidak menumpuk, retensi tidak menghambat
// penulisan, dan query histori tetap cepat pada data sebesar itu.
const loadRouters = 200 // 200 router, masing-masing 1 sampel per detik

// newRouters mendaftarkan n router uji sekaligus dan menghapusnya (beserta
// arsipnya) di akhir.
func newRouters(t *testing.T, pool *pgxpool.Pool, n int) []string {
	t.Helper()
	ctx := context.Background()
	rows, err := pool.Query(ctx, `
		INSERT INTO routers (name, host, username, password_enc)
		SELECT 'Beban ' || g, format('beban-%s-%s', $1::text, g), 'api', 'enc'
		FROM generate_series(1, $2) g
		RETURNING id::text`, fmt.Sprint(time.Now().UnixNano()), n)
	if err != nil {
		t.Fatalf("buat router uji: %v", err)
	}
	ids, err := collectStrings(rows)
	if err != nil || len(ids) != n {
		t.Fatalf("router terbuat = %d, %v; want %d", len(ids), err, n)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM routers WHERE id = ANY($1::uuid[])`, ids) })
	return ids
}

func collectStrings(rows interface {
	Next() bool
	Scan(...any) error
	Err() error
	Close()
}) ([]string, error) {
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func countFor(t *testing.T, pool *pgxpool.Pool, routers []string, where string, args ...any) int {
	t.Helper()
	var n int
	query := `SELECT count(*) FROM traffic_samples WHERE router_id = ANY($1::uuid[]) ` + where
	if err := pool.QueryRow(context.Background(), query, append([]any{routers}, args...)...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// testWriter meneruskan log Writer ke t.Log, supaya penyebab kegagalan ikut
// tampil bila test gagal (atau dengan -v).
type testWriter struct{ t *testing.T }

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Helper()
	w.t.Log(strings.TrimRight(string(p), "\n"))
	return len(p), nil
}

func testLogger(t *testing.T) *slog.Logger {
	return slog.New(slog.NewTextHandler(testWriter{t}, &slog.HandlerOptions{Level: slog.LevelWarn}))
}

// startWriter menjalankan Writer sungguhan dan mengembalikan fungsi berhenti
// yang menunggu penyimpanan akhir selesai.
func startWriter(t *testing.T, store Store, opts Options) (*Writer, func()) {
	t.Helper()
	opts.Logger = testLogger(t)
	w := NewWriter(store, opts)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		w.Run(ctx)
		close(done)
	}()
	stopped := false
	stop := func() {
		if stopped {
			return
		}
		stopped = true
		cancel()
		select {
		case <-done:
		case <-time.After(30 * time.Second):
			t.Error("writer tidak berhenti dalam 30 detik")
		}
	}
	t.Cleanup(stop)
	return w, stop
}

// Satu menit penuh traffic 200 router, dimasukkan secepat mungkin (60 kali
// lebih cepat dari kenyataan): semuanya harus tersimpan, tanpa yang dibuang,
// dan memasukkan sampel tidak pernah menunggu database.
func TestLoadAMinuteOfTwoHundredRoutersIsStoredCompletely(t *testing.T) {
	pool := testPool(t)
	routers := newRouters(t, pool, loadRouters)
	w, stop := startWriter(t, NewPGStore(pool), Options{FlushInterval: 100 * time.Millisecond})

	start := time.Date(2031, 4, 1, 10, 0, 0, 0, time.UTC)
	const seconds = 60
	var slowest time.Duration
	began := time.Now()
	for s := 0; s < seconds; s++ {
		at := start.Add(time.Duration(s) * time.Second)
		for i, router := range routers {
			enqueued := time.Now()
			if !w.Enqueue(router, at, float64(100+i), float64(s)) {
				t.Fatalf("detik %d router %d: sampel dibuang", s, i)
			}
			slowest = max(slowest, time.Since(enqueued))
		}
	}
	enqueueTotal := time.Since(began)
	stop()
	total := time.Since(began)

	want := uint64(seconds * loadRouters)
	if s := w.Stats(); s.Written != want || s.Dropped != 0 || s.Failures != 0 || s.Skipped != 0 || s.Pending != 0 {
		t.Fatalf("Stats = %+v, want %d tersimpan, tidak ada yang dibuang atau tertunda", s, want)
	}
	if n := countFor(t, pool, routers, ""); n != int(want) {
		t.Errorf("baris di database = %d, want %d", n, want)
	}
	t.Logf("%d sampel: dimasukkan dalam %s (paling lambat satu Enqueue %s), tersimpan semua dalam %s",
		want, enqueueTotal.Round(time.Millisecond), slowest, total.Round(time.Millisecond))
	if slowest > 200*time.Millisecond {
		t.Errorf("satu Enqueue memakan %s; jalur polling tidak boleh menunggu database", slowest)
	}
	if total > 30*time.Second {
		t.Errorf("menyimpan %d sampel memakan %s; penulis tidak mengejar", want, total)
	}
}

// Beban sebenarnya: tiap detik 200 router melapor lewat jalur yang dipakai
// polling (Recorder -> state.Manager -> Writer). Satu putaran harus selesai
// jauh di dalam satu detik, dan antrean arsip tidak boleh menumpuk dari satu
// detik ke detik berikutnya.
func TestLoadPerSecondMonitoringStaysCurrent(t *testing.T) {
	pool := testPool(t)
	routers := newRouters(t, pool, loadRouters)
	mgr := state.NewManager()
	for i, id := range routers {
		if err := mgr.UpsertRouter(state.Router{ID: id, Name: fmt.Sprintf("RTR-%03d", i), Host: fmt.Sprintf("10.201.0.%d", i), Active: true}); err != nil {
			t.Fatal(err)
		}
	}
	w, stop := startWriter(t, NewPGStore(pool), Options{FlushInterval: 250 * time.Millisecond})
	recorder := Recorder{Next: mgr, Writer: w}

	const ticks = 4
	var worstTick time.Duration
	var worstPending int
	started := time.Now()
	for tick := 0; tick < ticks; tick++ {
		<-time.After(time.Until(started.Add(time.Duration(tick) * time.Second)))
		if pending := w.Stats().Pending; pending > worstPending && tick > 0 {
			worstPending = pending
		}
		now := time.Now().UTC().Truncate(time.Second)
		begin := time.Now()
		for i, router := range routers {
			if accepted, err := recorder.RecordTraffic(router, state.TrafficPoint{Time: now.Unix(), RxMbps: float64(50 + i%40), TxMbps: 5}); err != nil || !accepted {
				t.Fatalf("putaran %d router %d ditolak: %v, %v", tick, i, accepted, err)
			}
		}
		worstTick = max(worstTick, time.Since(begin))
	}
	stop()

	want := uint64(ticks * loadRouters)
	if s := w.Stats(); s.Written != want || s.Dropped != 0 || s.Failures != 0 || s.Pending != 0 {
		t.Fatalf("Stats = %+v, want %d tersimpan", s, want)
	}
	if n := countFor(t, pool, routers, ""); n != int(want) {
		t.Errorf("baris di database = %d, want %d", n, want)
	}
	t.Logf("putaran terlama (200 router, Manager + antrean arsip): %s; antrean tertinggi sebelum putaran berikutnya: %d sampel", worstTick, worstPending)
	if worstTick > 100*time.Millisecond {
		t.Errorf("satu putaran memakan %s dari jatah 1 detik", worstTick)
	}
	// Penyimpanan tiap 250 ms: sebelum putaran berikutnya paling banyak sisa
	// satu putaran. Lebih dari dua berarti penulis tertinggal.
	if worstPending > 2*loadRouters {
		t.Errorf("antrean arsip menumpuk sampai %d sampel (batas %d)", worstPending, 2*loadRouters)
	}
}

// Penegakan retensi berjalan saat sampel baru terus masuk: data lama habis,
// data yang masih dalam masa simpan utuh, dan penulisan tidak tersendat oleh
// penghapusan bertahap.
func TestLoadRetentionPurgesWhileLiveSamplesKeepArriving(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	const routerCount = 50
	routers := newRouters(t, pool, routerCount)
	ctx := context.Background()
	// Pembersihan memakai kebijakan Timescale bila ada; kembalikan seperti semula.
	t.Cleanup(func() { _, _ = store.ApplyRetention(ctx, 30*24*time.Hour, true) })

	now := time.Now().UTC().Truncate(time.Second)
	var seed []Sample
	for _, router := range routers {
		for s := 0; s < 400; s++ { // 3 hari lalu: jauh melewati masa simpan 24 jam
			seed = append(seed, Sample{RouterID: router, At: now.Add(-72*time.Hour + time.Duration(s)*time.Second), RxMbps: 1, TxMbps: 1})
		}
		// 23 jam lalu: masih dalam masa simpan, harus selamat.
		seed = append(seed, Sample{RouterID: router, At: now.Add(-23 * time.Hour), RxMbps: 2, TxMbps: 2})
	}
	for chunk := range slices.Chunk(seed, 2000) {
		if _, err := store.Insert(ctx, chunk); err != nil {
			t.Fatal(err)
		}
	}
	old := routerCount * 400
	if n := countFor(t, pool, routers, ""); n != len(seed) {
		t.Fatalf("data awal = %d baris, want %d", n, len(seed))
	}

	// Batch kecil dan putaran cepat memaksa banyak penghapusan kecil yang
	// berselang-seling dengan penyimpanan.
	w, stop := startWriter(t, store, Options{
		Retention:     MinRetention,
		PurgeBatch:    500,
		PurgeEvery:    100 * time.Millisecond,
		FlushInterval: 100 * time.Millisecond,
	})

	const ticks = 10
	var slowest time.Duration
	for tick := 0; tick < ticks; tick++ {
		at := now.Add(time.Duration(tick) * time.Second)
		for _, router := range routers {
			enqueued := time.Now()
			if !w.Enqueue(router, at, 10, 1) {
				t.Fatalf("putaran %d: sampel dibuang saat pembersihan berjalan", tick)
			}
			slowest = max(slowest, time.Since(enqueued))
		}
		time.Sleep(100 * time.Millisecond)
	}
	waitFor(t, "data lama terhapus", func() bool { return w.Stats().Purged >= uint64(old) })
	stop()

	s := w.Stats()
	if s.Purged < uint64(old) || s.Failures != 0 || s.Dropped != 0 || s.LastPurge.IsZero() {
		t.Fatalf("Stats = %+v, want %d terhapus tanpa kegagalan", s, old)
	}
	if n := countFor(t, pool, routers, "AND sampled_at < $2", now.Add(-24*time.Hour)); n != 0 {
		t.Errorf("%d baris yang lebih tua dari masa simpan masih ada", n)
	}
	if n := countFor(t, pool, routers, "AND sampled_at = $2", now.Add(-23*time.Hour)); n != routerCount {
		t.Errorf("baris 23 jam lalu = %d, want %d (masih dalam masa simpan)", n, routerCount)
	}
	if n := countFor(t, pool, routers, "AND sampled_at >= $2", now); n != ticks*routerCount {
		t.Errorf("sampel baru = %d, want %d (semua yang masuk selama pembersihan harus tersimpan)", n, ticks*routerCount)
	}
	t.Logf("%d baris lama dihapus bertahap sambil %d sampel baru masuk; Enqueue paling lambat %s", old, ticks*routerCount, slowest)
	if slowest > 200*time.Millisecond {
		t.Errorf("satu Enqueue memakan %s saat pembersihan berjalan", slowest)
	}
}

// Satu jam traffic 100 router (360.000 baris) dibaca sebagai grafik: harus
// cepat, karena dashboard memanggilnya setiap pengguna berpindah rentang.
func TestLoadHistoryOverAnHourOfHundredRoutersIsFast(t *testing.T) {
	pool := testPool(t)
	routers := newRouters(t, pool, 100)
	start := time.Date(2031, 4, 2, 10, 0, 0, 0, time.UTC)
	tag, err := pool.Exec(context.Background(), `
		INSERT INTO traffic_samples (router_id, sampled_at, rx_mbps, tx_mbps)
		SELECT r, $2::timestamptz + g * interval '1 second', 100, 10
		FROM unnest($1::uuid[]) r, generate_series(0, 3599) g`, routers, start)
	if err != nil || tag.RowsAffected() != 360000 {
		t.Fatalf("isi data = %d, %v; want 360000", tag.RowsAffected(), err)
	}
	if _, err := pool.Exec(context.Background(), `ANALYZE traffic_samples`); err != nil {
		t.Fatal(err)
	}
	store := NewPGStore(pool)

	measure := func(name string, q HistoryQuery, wantPoints int, wantRx float64) time.Duration {
		t.Helper()
		began := time.Now()
		points, err := store.History(context.Background(), q)
		elapsed := time.Since(began)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(points) != wantPoints {
			t.Fatalf("%s: %d titik, want %d", name, len(points), wantPoints)
		}
		for _, p := range points {
			if !near(p.RxMbps, wantRx) {
				t.Fatalf("%s: rx %v di %s, want %v", name, p.RxMbps, p.At, wantRx)
			}
		}
		t.Logf("%s: %d titik dalam %s", name, len(points), elapsed.Round(time.Millisecond))
		return elapsed
	}
	hour := HistoryQuery{From: start, To: start.Add(time.Hour), Step: 10 * time.Second}
	all := measure("1 jam, semua router, per 10 detik", hour, 360, 100*100)
	hour.RouterID = routers[0]
	one := measure("1 jam, satu router, per 10 detik", hour, 360, 100)
	if all > 5*time.Second || one > 2*time.Second {
		t.Errorf("histori terlalu lambat: semua router %s, satu router %s", all, one)
	}
}
