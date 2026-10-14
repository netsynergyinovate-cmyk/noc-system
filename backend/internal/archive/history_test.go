package archive

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"
)

// Tiap test PostgreSQL memakai tanggal sendiri yang jauh dari tanggal test
// lain: query "semua router" menjumlahkan semua baris pada jendelanya, jadi
// sampel sisa dari test lain akan mengubah hasil.
func historyBase(day int) time.Time {
	return time.Date(2031, 3, day, 10, 0, 0, 0, time.UTC)
}

func insertSeconds(t *testing.T, store *PGStore, router string, start time.Time, seconds int, rx func(i int) float64, tx float64) {
	t.Helper()
	samples := make([]Sample, 0, seconds)
	for i := 0; i < seconds; i++ {
		samples = append(samples, Sample{RouterID: router, At: start.Add(time.Duration(i) * time.Second), RxMbps: rx(i), TxMbps: tx})
	}
	if _, err := store.Insert(context.Background(), samples); err != nil {
		t.Fatalf("isi sampel: %v", err)
	}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestHistorySumsRoutersPerSecondThenAveragesPerBucket(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	a, b := newRouter(t, pool), newRouter(t, pool)
	start := historyBase(1)

	// Router A tetap 10/1 Mbps. Router B naik 0..19 Mbps dan 2 Mbps unggah.
	insertSeconds(t, store, a, start, 20, func(int) float64 { return 10 }, 1)
	insertSeconds(t, store, b, start, 20, func(i int) float64 { return float64(i) }, 2)

	points, err := store.History(context.Background(), HistoryQuery{From: start, To: start.Add(20 * time.Second), Step: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 2 {
		t.Fatalf("titik = %d, want 2: %+v", len(points), points)
	}
	// Total per detik = 10 + i, jadi rata-rata bucket pertama 10 + 4,5 dan kedua
	// 10 + 14,5. Merata-ratakan baris per router akan memberi 7,25 dan 12,25.
	want := []HistoryPoint{
		{At: start, RxMbps: 14.5, TxMbps: 3},
		{At: start.Add(10 * time.Second), RxMbps: 24.5, TxMbps: 3},
	}
	for i, p := range points {
		if !p.At.Equal(want[i].At) || !near(p.RxMbps, want[i].RxMbps) || !near(p.TxMbps, want[i].TxMbps) {
			t.Errorf("titik %d = %+v, want %+v", i, p, want[i])
		}
	}
}

func TestHistoryAlignsTheWindowDownAndExcludesTheEnd(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	router := newRouter(t, pool)
	start := historyBase(2)
	insertSeconds(t, store, router, start, 40, func(i int) float64 { return float64(i) }, 1)

	// From jatuh di tengah bucket (detik ke-3): bucket itu tetap utuh, bukan
	// setengah terisi. To (detik ke-20) tidak ikut, jadi bucket 20..29 tidak ada.
	points, err := store.History(context.Background(), HistoryQuery{
		From: start.Add(3 * time.Second), To: start.Add(20 * time.Second), Step: 10 * time.Second, RouterID: router,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 2 {
		t.Fatalf("titik = %+v, want 2 bucket (0..9 dan 10..19)", points)
	}
	if !points[0].At.Equal(start) || !near(points[0].RxMbps, 4.5) {
		t.Errorf("bucket pertama = %+v, want mulai %s rata-rata 4,5 (detik 0..9 utuh)", points[0], start)
	}
	if !points[1].At.Equal(start.Add(10*time.Second)) || !near(points[1].RxMbps, 14.5) {
		t.Errorf("bucket kedua = %+v, want rata-rata 14,5", points[1])
	}
}

func TestHistoryBucketsAreMultiplesOfTheStepSinceEpoch(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	router := newRouter(t, pool)
	// 10:00:07 bukan kelipatan 60 detik; bucket harus jatuh di menit penuh.
	start := historyBase(3).Add(7 * time.Second)
	insertSeconds(t, store, router, start, 130, func(int) float64 { return 5 }, 1)

	points, err := store.History(context.Background(), HistoryQuery{From: start, To: start.Add(130 * time.Second), Step: time.Minute, RouterID: router})
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 3 {
		t.Fatalf("titik = %+v, want 3 menit", points)
	}
	for _, p := range points {
		if p.At.Unix()%60 != 0 {
			t.Errorf("bucket %s bukan kelipatan 60 detik", p.At)
		}
		if !near(p.RxMbps, 5) {
			t.Errorf("rata-rata %v, want 5 (tidak bergantung pada jumlah detik yang terisi)", p.RxMbps)
		}
	}
}

func TestHistoryLeavesGapsEmptyInsteadOfZero(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	router := newRouter(t, pool)
	start := historyBase(4)
	insertSeconds(t, store, router, start, 1, func(int) float64 { return 50 }, 5)
	insertSeconds(t, store, router, start.Add(30*time.Second), 1, func(int) float64 { return 70 }, 7)

	points, err := store.History(context.Background(), HistoryQuery{From: start, To: start.Add(40 * time.Second), Step: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 2 || !points[0].At.Equal(start) || !points[1].At.Equal(start.Add(30*time.Second)) {
		t.Errorf("titik = %+v, want hanya bucket 0 dan 30 (celah tidak diisi nol)", points)
	}
}

func TestHistoryCanFilterOneRouter(t *testing.T) {
	pool := testPool(t)
	store := NewPGStore(pool)
	a, b, empty := newRouter(t, pool), newRouter(t, pool), newRouter(t, pool)
	start := historyBase(5)
	insertSeconds(t, store, a, start, 10, func(int) float64 { return 10 }, 1)
	insertSeconds(t, store, b, start, 10, func(int) float64 { return 100 }, 1)
	window := HistoryQuery{From: start, To: start.Add(10 * time.Second), Step: 10 * time.Second}

	window.RouterID = a
	points, err := store.History(context.Background(), window)
	if err != nil || len(points) != 1 || !near(points[0].RxMbps, 10) {
		t.Errorf("router A = %+v, %v; want satu titik 10 Mbps", points, err)
	}
	window.RouterID = ""
	points, err = store.History(context.Background(), window)
	if err != nil || len(points) != 1 || !near(points[0].RxMbps, 110) {
		t.Errorf("semua router = %+v, %v; want satu titik 110 Mbps", points, err)
	}

	window.RouterID = empty
	points, err = store.History(context.Background(), window)
	if err != nil || points == nil || len(points) != 0 {
		t.Errorf("router tanpa sampel = %#v, %v; want slice kosong (bukan nil)", points, err)
	}
}

func TestHistoryHonorsContextCancellation(t *testing.T) {
	store := NewPGStore(testPool(t))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := historyBase(6)
	if _, err := store.History(ctx, HistoryQuery{From: start, To: start.Add(time.Minute), Step: time.Second}); err == nil {
		t.Error("context yang sudah dibatalkan seharusnya menghasilkan error")
	}
}

func TestHistoryQueryValidation(t *testing.T) {
	start := historyBase(7)
	good := HistoryQuery{From: start, To: start.Add(time.Hour), Step: 10 * time.Second}
	cases := []struct {
		name   string
		mutate func(*HistoryQuery)
		valid  bool
	}{
		{"query yang benar", func(*HistoryQuery) {}, true},
		{"From sama dengan To", func(q *HistoryQuery) { q.To = q.From }, false},
		{"From setelah To", func(q *HistoryQuery) { q.From = q.To.Add(time.Second) }, false},
		{"jendela tepat batas", func(q *HistoryQuery) { q.To = q.From.Add(MaxHistoryRange); q.Step = time.Hour }, true},
		{"jendela melewati batas", func(q *HistoryQuery) { q.To = q.From.Add(MaxHistoryRange + time.Second); q.Step = time.Hour }, false},
		{"Step nol", func(q *HistoryQuery) { q.Step = 0 }, false},
		{"Step negatif", func(q *HistoryQuery) { q.Step = -time.Second }, false},
		{"Step di bawah satu detik", func(q *HistoryQuery) { q.Step = 500 * time.Millisecond }, false},
		{"Step bukan detik penuh", func(q *HistoryQuery) { q.Step = 1500 * time.Millisecond }, false},
		{"titik tepat batas", func(q *HistoryQuery) { q.To = q.From.Add(MaxHistoryPoints * time.Second); q.Step = time.Second }, true},
		{"titik satu lewat batas", func(q *HistoryQuery) { q.To = q.From.Add((MaxHistoryPoints + 1) * time.Second); q.Step = time.Second }, false},
		{"router UUID", func(q *HistoryQuery) { q.RouterID = "11111111-2222-4333-8444-555555555555" }, true},
		{"router bukan UUID", func(q *HistoryQuery) { q.RouterID = "r1" }, false},
		{"router berisi SQL", func(q *HistoryQuery) { q.RouterID = "'; DROP TABLE traffic_samples; --" }, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := good
			tc.mutate(&q)
			err := q.Validate()
			if tc.valid && err != nil {
				t.Errorf("Validate = %v, want nil", err)
			}
			if !tc.valid && !errors.Is(err, ErrInvalidHistoryQuery) {
				t.Errorf("Validate = %v, want ErrInvalidHistoryQuery", err)
			}
		})
	}
}

// Bucket dihitung dari jendela yang dibulatkan ke bawah, jadi From yang jatuh
// di tengah bucket menambah satu titik; batas harus memperhitungkannya.
func TestHistoryPointLimitCountsTheAlignedFirstBucket(t *testing.T) {
	aligned := time.Date(2031, 3, 8, 10, 0, 0, 0, time.UTC)
	q := HistoryQuery{From: aligned, To: aligned.Add(MaxHistoryPoints * 10 * time.Second), Step: 10 * time.Second}
	if err := q.Validate(); err != nil {
		t.Fatalf("tepat batas seharusnya sah: %v", err)
	}
	q.From = aligned.Add(5 * time.Second) // bucket pertama mulai 5 detik lebih awal
	q.To = aligned.Add((MaxHistoryPoints*10 + 5) * time.Second)
	if err := q.Validate(); !errors.Is(err, ErrInvalidHistoryQuery) {
		t.Errorf("Validate = %v; want ditolak karena menjadi %d+1 titik", err, MaxHistoryPoints)
	}
}

func TestHistoryRejectsInvalidQueriesBeforeTouchingTheDatabase(t *testing.T) {
	// Pool nil: kalau validasi terlewat, panggilan ini panic, bukan sekadar error.
	store := NewPGStore(nil)
	start := historyBase(9)
	_, err := store.History(context.Background(), HistoryQuery{From: start, To: start, Step: time.Second})
	if !errors.Is(err, ErrInvalidHistoryQuery) {
		t.Errorf("err = %v, want ErrInvalidHistoryQuery", err)
	}
}
