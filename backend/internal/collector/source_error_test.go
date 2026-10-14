package collector

import (
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"noc-isp/backend/internal/state"
)

func TestSourceFailureAntiFlapping(t *testing.T) {
	mgr := state.NewManager()
	if err := mgr.UpsertRouter(state.Router{ID: "r1", Name: "R1", Active: true}); err != nil {
		t.Fatal(err)
	}
	tr := NewSourceFailureTracker()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	boom := errors.New("dial tcp 10.0.0.1:443: i/o timeout")

	for i := 1; i <= 2; i++ {
		if tr.RecordFailure("r1", boom, int64(100+i), mgr, log) {
			t.Fatalf("gagal ke-%d tidak boleh menandai unreachable", i)
		}
		if ok, _, _ := mgr.RouterReachability("r1"); !ok {
			t.Fatalf("gagal ke-%d: router harus tetap reachable", i)
		}
	}
	if !tr.RecordFailure("r1", boom, 103, mgr, log) {
		t.Fatal("gagal ke-3 harus mengembalikan becameUnreachable=true")
	}
	ok, _, lastErr := mgr.RouterReachability("r1")
	if ok || lastErr == "" {
		t.Fatalf("setelah 3 gagal: reachable=%v lastErr=%q", ok, lastErr)
	}
	// Gagal ke-4 tidak memicu transisi lagi.
	if tr.RecordFailure("r1", boom, 104, mgr, log) {
		t.Fatal("gagal ke-4 tidak boleh mengembalikan true lagi")
	}

	if !tr.RecordSuccess("r1", 105, mgr, log) {
		t.Fatal("sukses setelah unreachable harus recovered=true")
	}
	ok, failures, lastErr := mgr.RouterReachability("r1")
	if !ok || failures != 0 || lastErr != "" {
		t.Fatalf("setelah pulih: reachable=%v failures=%d lastErr=%q", ok, failures, lastErr)
	}
	if n, e := tr.Failures("r1"); n != 0 || e != "" {
		t.Fatalf("tracker belum bersih: %d %q", n, e)
	}
	// Sukses biasa bukan pemulihan.
	if tr.RecordSuccess("r1", 106, mgr, log) {
		t.Fatal("sukses saat sudah sehat tidak boleh recovered=true")
	}
}

func TestSourceFailureSuccessResetsStreak(t *testing.T) {
	mgr := state.NewManager()
	_ = mgr.UpsertRouter(state.Router{ID: "r1"})
	tr := NewSourceFailureTracker()
	boom := errors.New("x")
	tr.RecordFailure("r1", boom, 1, mgr, nil)
	tr.RecordFailure("r1", boom, 2, mgr, nil)
	tr.RecordSuccess("r1", 3, mgr, nil)
	if tr.RecordFailure("r1", boom, 4, mgr, nil) {
		t.Fatal("hitungan harus mulai dari nol setelah sukses")
	}
}

func TestSourceFailureSanitization(t *testing.T) {
	cases := []struct {
		name, in, secret string
	}{
		{"kredensial URL", `Get "http://admin:rahasia123@192.168.1.1/rest/system/resource": EOF`, "rahasia123"},
		{"token", "request failed: token=secret_token_abc", "secret_token_abc"},
		{"query", "GET /rest?api_key=zzz999&x=1 gagal", "zzz999"},
		{"bearer", "Authorization: Bearer abcDEF123", "abcDEF123"},
	}
	for _, c := range cases {
		got := SanitizeError(errors.New(c.in))
		if strings.Contains(got, c.secret) {
			t.Errorf("%s: rahasia bocor: %q", c.name, got)
		}
		if !strings.Contains(got, "REDACTED") {
			t.Errorf("%s: tidak ada penanda REDACTED: %q", c.name, got)
		}
	}
	if got := SanitizeError(errors.New(`http://admin:rahasia123@192.168.1.1/rest`)); !strings.Contains(got, "http://admin:[REDACTED]@192.168.1.1") {
		t.Errorf("format URL salah: %q", got)
	}
	if SanitizeError(nil) != "" {
		t.Error("nil harus menghasilkan string kosong")
	}
}
