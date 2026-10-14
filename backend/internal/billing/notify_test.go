package billing

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// Tes pendengar perubahan status (SyncerOptions.OnStatusChanges) dengan sumber dan
// penyimpanan palsu dari syncer_test.go.

// notifyRig memasang pendengar yang mencatat panggilannya di callLog sumber/
// penyimpanan, supaya urutan terhadap ApplySuccess bisa diperiksa.
type notifyRig struct {
	*syncerRig
	calls    [][]StatusChange
	appliedN []int // jumlah ApplySuccess yang sudah selesai saat tiap panggilan terjadi
	listen   func(changes []StatusChange) error
}

func newNotifyRig(t *testing.T, tweak func(*notifyRig)) *notifyRig {
	t.Helper()
	n := &notifyRig{}
	n.syncerRig = newSyncerRig(t, func(r *syncerRig, o *SyncerOptions) {
		n.syncerRig = r
		o.OnStatusChanges = func(changes []StatusChange) error {
			r.log.add("Notify")
			r.store.mu.Lock()
			n.appliedN = append(n.appliedN, len(r.store.applied))
			r.store.mu.Unlock()
			n.calls = append(n.calls, changes)
			if n.listen != nil {
				return n.listen(changes)
			}
			return nil
		}
		if tweak != nil {
			tweak(n)
		}
	})
	return n
}

func TestNotifierIsCalledExactlyOnceAfterApplySuccessWithTheResultChanges(t *testing.T) {
	r := newNotifyRig(t, nil)
	out, err := r.run(context.Background())
	if err != nil || out.Status != RunSuccess || out.NotifyErr != nil {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if want := []string{"BeginRun", "Invoices", "LoadCustomers", "ApplySuccess", "Notify", "PruneRuns"}; !reflect.DeepEqual(r.log.names(), want) {
		t.Errorf("urutan = %v, want %v (pendengar hanya sesudah ApplySuccess selesai)", r.log.names(), want)
	}
	if len(r.calls) != 1 {
		t.Fatalf("pendengar dipanggil %d kali, want 1", len(r.calls))
	}
	if r.appliedN[0] != 1 {
		t.Errorf("saat pendengar berjalan ApplySuccess selesai %d kali, want 1", r.appliedN[0])
	}
	want := []StatusChange{{"c1", StatusIsolir, StatusLunas}, {"c2", StatusLunas, StatusIsolir}}
	if !reflect.DeepEqual(r.calls[0], want) || !reflect.DeepEqual(r.calls[0], r.store.applied[0].Changes) {
		t.Errorf("changes = %+v, want %+v (Result.Changes)", r.calls[0], want)
	}
}

func TestNotifierGetsACopyOfTheChanges(t *testing.T) {
	r := newNotifyRig(t, func(n *notifyRig) {
		n.listen = func(changes []StatusChange) error {
			changes[0] = StatusChange{CustomerID: "dirusak"}
			return nil
		}
	})
	if _, err := r.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := r.store.applied[0].Changes[0].CustomerID; got != "c1" {
		t.Errorf("pendengar mengubah Result.Changes: %q", got)
	}
}

func TestNotifierIsCalledOncePerSuccessEvenWithoutChanges(t *testing.T) {
	r := newNotifyRig(t, func(n *notifyRig) {
		n.syncerRig.store.customers = []Customer{{ID: "c1", PPPoE: "budi01", Status: StatusLunas}, {ID: "c2", PPPoE: "dewi02", Status: StatusIsolir}}
	})
	for i := 1; i <= 2; i++ {
		if out, err := r.run(context.Background()); err != nil || out.Status != RunSuccess {
			t.Fatalf("sinkron %d = %+v, %v", i, out, err)
		}
		if len(r.calls) != i {
			t.Fatalf("setelah sinkron %d: %d panggilan, want %d", i, len(r.calls), i)
		}
		if len(r.calls[i-1]) != 0 {
			t.Fatalf("sinkron %d: changes = %+v, want kosong", i, r.calls[i-1])
		}
	}
}

// Pada semua jalur yang tidak berakhir sukses, status tidak berubah dan pendengar
// tidak dipanggil.
func TestNotifierIsNeverCalledWhenTheRunDoesNotSucceed(t *testing.T) {
	sentinel := errors.New("gangguan buatan")
	cases := []struct {
		name   string
		setup  func(r *notifyRig)
		status RunStatus
	}{
		{"galat sumber", func(r *notifyRig) { r.source.err = sentinel }, RunFailed},
		{"sumber kosong", func(r *notifyRig) { r.source.invoices = nil }, RunFailed},
		{"penjaga penurunan drastis", func(r *notifyRig) {
			r.store.lastSuccess, r.store.hasLastSuccess = SuccessRun{Invoices: 100}, true
		}, RunFailed},
		{"galat baca pelanggan", func(r *notifyRig) { r.store.loadErr = sentinel }, RunFailed},
		{"ApplySuccess gagal", func(r *notifyRig) { r.store.applyErr = sentinel }, RunFailed},
		{"ApplySuccess panik", func(r *notifyRig) { r.store.panicIn, r.store.panicVal = "apply", "kacau" }, RunFailed},
		{"BeginRun gagal", func(r *notifyRig) { r.store.beginErr = sentinel }, RunFailed},
		{"dilewati: sudah ada sinkron berjalan", func(r *notifyRig) { r.store.beginErr = ErrRunInProgress }, RunSkipped},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newNotifyRig(t, nil)
			tc.setup(r)
			out, _ := r.run(context.Background())
			if out.Status != tc.status {
				t.Fatalf("Status = %q, want %q (%+v)", out.Status, tc.status, out.Err)
			}
			if len(r.calls) != 0 || r.log.count("Notify") != 0 {
				t.Errorf("pendengar dipanggil %d kali pada sinkron yang tidak sukses", len(r.calls))
			}
		})
	}
}

func TestNotifierIsNotCalledWhenTheRunIsCanceled(t *testing.T) {
	r := newNotifyRig(t, nil)
	ctx, cancel := context.WithCancel(context.Background())
	r.source.onCall = func(ctx context.Context) error {
		cancel()
		<-ctx.Done()
		return ctx.Err()
	}
	out, err := r.run(ctx)
	if !errors.Is(err, ErrSyncCanceled) || out.Status != RunFailed {
		t.Fatalf("RunOnce = %+v, %v; want ErrSyncCanceled", out, err)
	}
	if len(r.calls) != 0 {
		t.Errorf("pendengar dipanggil %d kali pada sinkron yang dibatalkan", len(r.calls))
	}
}

func TestListenerErrorDoesNotFailASavedSync(t *testing.T) {
	sentinel := errors.New("dashboard tidak terjangkau")
	r := newNotifyRig(t, func(n *notifyRig) { n.listen = func([]StatusChange) error { return sentinel } })
	out, err := r.run(context.Background())
	if err != nil || out.Status != RunSuccess || out.Err != nil {
		t.Fatalf("RunOnce = %+v, %v; sinkron yang sudah tersimpan tidak boleh gagal", out, err)
	}
	if !errors.Is(out.NotifyErr, sentinel) {
		t.Errorf("NotifyErr = %v, want %v", out.NotifyErr, sentinel)
	}
	if len(r.store.failed) != 0 || len(r.store.applied) != 1 {
		t.Errorf("FailRun %+v, ApplySuccess %d kali", r.store.failed, len(r.store.applied))
	}
	if r.log.count("PruneRuns") != 1 {
		t.Error("pemangkasan sesudahnya tidak berjalan")
	}
	if logs := r.logs.String(); !strings.Contains(logs, "level=ERROR") || !strings.Contains(logs, "dashboard tidak terjangkau") {
		t.Errorf("galat pendengar harus dicatat:\n%s", logs)
	}
}

func TestListenerPanicDoesNotFailASavedSyncAndLeaksNothing(t *testing.T) {
	const secret = "kata-sandi-rahasia-999"
	r := newNotifyRig(t, func(n *notifyRig) { n.listen = func([]StatusChange) error { panic(secret) } })
	out, err := r.run(context.Background()) // run melaporkan panic yang lolos sebagai kegagalan tes
	if err != nil || out.Status != RunSuccess || out.Err != nil {
		t.Fatalf("RunOnce = %+v, %v; panic pendengar tidak boleh menggagalkan sinkron", out, err)
	}
	var pe *PanicError
	if !errors.As(out.NotifyErr, &pe) || !errors.Is(out.NotifyErr, ErrSyncPanic) {
		t.Fatalf("NotifyErr = %v, want *PanicError", out.NotifyErr)
	}
	if len(r.store.failed) != 0 || len(r.store.applied) != 1 || r.log.count("PruneRuns") != 1 {
		t.Errorf("FailRun %+v, ApplySuccess %d, PruneRuns %d", r.store.failed, len(r.store.applied), r.log.count("PruneRuns"))
	}
	if logs := r.logs.String(); strings.Contains(logs, secret) || !strings.Contains(logs, "panik") {
		t.Errorf("log harus mencatat panic tanpa nilainya:\n%s", logs)
	}
	// Sinkron berikutnya tetap berjalan normal.
	r.listen = nil
	if out, err := r.run(context.Background()); err != nil || out.Status != RunSuccess || out.NotifyErr != nil {
		t.Errorf("sinkron berikutnya = %+v, %v", out, err)
	}
}

func TestSyncWithoutAListenerBehavesAsBefore(t *testing.T) {
	r := newSyncerRig(t, nil)
	out, err := r.run(context.Background())
	if err != nil || out.Status != RunSuccess || out.NotifyErr != nil {
		t.Fatalf("RunOnce = %+v, %v", out, err)
	}
	if want := []string{"BeginRun", "Invoices", "LoadCustomers", "ApplySuccess", "PruneRuns"}; !reflect.DeepEqual(r.log.names(), want) {
		t.Errorf("urutan = %v, want %v", r.log.names(), want)
	}
}
