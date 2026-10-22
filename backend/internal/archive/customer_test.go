package archive

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"
)

type fakeCustomerStore struct {
	rows []CustomerRow
	fail bool
}

func (f *fakeCustomerStore) InsertCustomer(_ context.Context, rows []CustomerRow) error {
	if f.fail {
		return errors.New("db mati")
	}
	f.rows = append(f.rows, rows...)
	return nil
}

func (f *fakeCustomerStore) PurgeCustomer(context.Context, time.Time) (int64, error) { return 0, nil }

func TestCustomerUsername(t *testing.T) {
	for name, want := range map[string]string{
		"<pppoe-17060001092@runsnet.id>": "17060001092@runsnet.id",
		"<pppoe-budi>":                   "budi",
		"anak":                           "",
		"<pppoe->":                       "",
		"<hotspot-budi>":                 "",
	} {
		got, ok := CustomerUsername(name)
		if got != want || ok != (want != "") {
			t.Errorf("CustomerUsername(%q) = %q,%v; mau %q", name, got, ok, want)
		}
	}
}

func TestCustomerTrafficBuckets(t *testing.T) {
	store := &fakeCustomerStore{}
	c := NewCustomerTraffic(store, time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)))
	t0 := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	now := t0
	c.now = func() time.Time { return now }

	c.Add(t0, []CustomerRate{{Username: "budi", DownBps: 8_000_000, UpBps: 1_000_000}})
	c.Add(t0.Add(time.Second), []CustomerRate{{Username: "budi", DownBps: 4_000_000, UpBps: 3_000_000}})
	// Bucket masih berjalan: belum ditulis.
	c.flush(context.Background(), false)
	if len(store.rows) != 0 {
		t.Fatalf("bucket berjalan ikut ditulis: %+v", store.rows)
	}

	// Sampel di bucket berikutnya menutup bucket lama.
	c.Add(t0.Add(5*time.Minute), []CustomerRate{{Username: "budi", DownBps: 1_000_000}})
	now = t0.Add(5*time.Minute + time.Second)
	c.flush(context.Background(), false)
	if len(store.rows) != 1 {
		t.Fatalf("mau 1 bucket selesai, dapat %d", len(store.rows))
	}
	r := store.rows[0]
	if !r.Start.Equal(t0) || r.Samples != 2 || r.DownMax != 8_000_000 || r.UpMax != 3_000_000 {
		t.Fatalf("bucket salah: %+v", r)
	}
	if got := r.avgMbps(r.DownSum); got != 6 {
		t.Errorf("rata-rata download = %v Mbps, mau 6", got)
	}
	// (8+4) Mbit selama 1 detik masing-masing = 12 Mbit = 1,5 MB.
	if got := r.bytes(r.DownSum); got != 1_500_000 {
		t.Errorf("byte download = %d, mau 1500000", got)
	}

	// Pelanggan yang berhenti mengirim sampel tetap ditutup saat bucketnya lewat.
	now = t0.Add(10 * time.Minute)
	c.flush(context.Background(), false)
	if len(store.rows) != 2 || !store.rows[1].Start.Equal(t0.Add(5*time.Minute)) {
		t.Fatalf("bucket pelanggan yang diam tidak ditutup: %+v", store.rows)
	}
}

func TestCustomerTrafficRetriesOnFailure(t *testing.T) {
	store := &fakeCustomerStore{fail: true}
	c := NewCustomerTraffic(store, time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)))
	t0 := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return t0.Add(time.Hour) }
	c.Add(t0, []CustomerRate{{Username: "budi", DownBps: 1}})
	c.flush(context.Background(), false)
	store.fail = false
	c.flush(context.Background(), false)
	if len(store.rows) != 1 || store.rows[0].Samples != 1 {
		t.Fatalf("batch gagal tidak dicoba ulang: %+v", store.rows)
	}
}

func TestMergeCustomerRows(t *testing.T) {
	t0 := time.Unix(1_700_000_100, 0)
	got := mergeCustomerRows([]CustomerRow{
		{Username: "a", Start: t0, Samples: 2, DownSum: 10, DownMax: 7},
		{Username: "b", Start: t0, Samples: 1},
		{Username: "a", Start: t0, Samples: 3, DownSum: 5, DownMax: 9},
	})
	if len(got) != 2 || got[0].Samples != 5 || got[0].DownSum != 15 || got[0].DownMax != 9 {
		t.Fatalf("gabung salah: %+v", got)
	}
}
