package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/olt"
)

// --- driver "fake-reboot": merekam ONU yang di-reboot; hasilnya diatur per tes. ---

var (
	fakeRebootOnce sync.Once
	fakeRebootMu   sync.Mutex
	fakeRebootErr  error
	fakeRebooted   []olt.OnuRef
)

func setFakeRebootResult(t *testing.T, err error) {
	t.Helper()
	fakeRebootOnce.Do(func() {
		olt.Register("fake-reboot", func(cfg olt.Config) (olt.Driver, error) { return fakeRebootDriver{}, nil })
	})
	fakeRebootMu.Lock()
	fakeRebootErr = err
	fakeRebooted = nil
	fakeRebootMu.Unlock()
}

func rebootedList() []olt.OnuRef {
	fakeRebootMu.Lock()
	defer fakeRebootMu.Unlock()
	return append([]olt.OnuRef(nil), fakeRebooted...)
}

type fakeRebootDriver struct{}

func (fakeRebootDriver) Name() string                                              { return "fake-reboot" }
func (fakeRebootDriver) Close() error                                              { return nil }
func (fakeRebootDriver) TestConnection(context.Context) error                      { return nil }
func (fakeRebootDriver) FetchPonPorts(context.Context) ([]olt.PonPortStats, error) { return nil, nil }
func (fakeRebootDriver) FetchOnus(context.Context) ([]olt.OnuStats, error)         { return nil, nil }
func (fakeRebootDriver) RebootOnu(_ context.Context, ref olt.OnuRef) error {
	fakeRebootMu.Lock()
	defer fakeRebootMu.Unlock()
	if fakeRebootErr != nil {
		return fakeRebootErr
	}
	fakeRebooted = append(fakeRebooted, ref)
	return nil
}

const rebootPath = "/api/v1/olts/olt-1/onus/2/7/reboot"

func rebootQuerier(t *testing.T) *fakeOltQuerier {
	return &fakeOltQuerier{row: []string{"127.0.0.1:0", "fake-reboot", "NOCApp", mustEncryptForTest(t, "rahasia-olt", testDeviceSecret)}}
}

func TestOltRebootRequiresCpeManagePerm(t *testing.T) {
	setFakeRebootResult(t, nil)
	h := newOltBindHarness(t, rebootQuerier(t), &fakeBindStoreOlt{}, 1)
	other, _ := h.tokens.IssueWithPerms("u", []string{"alert:handle"}, time.Now(), time.Minute)

	if rec := h.do(http.MethodPost, rebootPath, "", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonim: status = %d, want 401", rec.Code)
	}
	for name, tk := range map[string]string{"hanya-lihat": h.ticket(), "izin lain": other} {
		if rec := h.do(http.MethodPost, rebootPath, tk, nil); rec.Code != http.StatusForbidden {
			t.Errorf("%s: status = %d, want 403", name, rec.Code)
		}
	}
	if len(rebootedList()) != 0 {
		t.Fatalf("tidak boleh me-reboot tanpa izin: %v", rebootedList())
	}
}

func TestOltRebootSuccessSendsExactOnu(t *testing.T) {
	setFakeRebootResult(t, nil)
	h := newOltBindHarness(t, rebootQuerier(t), &fakeBindStoreOlt{}, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	rec := h.do(http.MethodPost, rebootPath, tk, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if got := rebootedList(); len(got) != 1 || got[0] != (olt.OnuRef{Pon: 2, Onu: 7}) {
		t.Fatalf("rebooted = %v", got)
	}
}

func TestOltRebootBadNumbersAndUnknownOlt(t *testing.T) {
	setFakeRebootResult(t, nil)
	h := newOltBindHarness(t, rebootQuerier(t), &fakeBindStoreOlt{}, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	for _, p := range []string{"/api/v1/olts/olt-1/onus/0/7/reboot", "/api/v1/olts/olt-1/onus/2/abc/reboot", "/api/v1/olts/olt-1/onus/2/-1/reboot"} {
		if rec := h.do(http.MethodPost, p, tk, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", p, rec.Code)
		}
	}
	if rec := h.do(http.MethodPost, "/api/v1/olts/olt-9/onus/2/7/reboot", tk, nil); rec.Code != http.StatusNotFound {
		t.Errorf("OLT tak dikenal: status = %d, want 404", rec.Code)
	}
	if len(rebootedList()) != 0 {
		t.Fatalf("tidak boleh me-reboot untuk input tak sah: %v", rebootedList())
	}
}

func TestOltRebootMapsOltErrors(t *testing.T) {
	h := newOltBindHarness(t, rebootQuerier(t), &fakeBindStoreOlt{}, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	setFakeRebootResult(t, olt.ErrRebootRejected)
	if rec := h.do(http.MethodPost, rebootPath, tk, nil); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "reboot_rejected") {
		t.Errorf("ditolak OLT: status = %d, body = %s", rec.Code, rec.Body)
	}
	setFakeRebootResult(t, errors.New("koneksi putus"))
	rec := h.do(http.MethodPost, rebootPath, tk, nil)
	if rec.Code != http.StatusBadGateway || strings.Contains(rec.Body.String(), "koneksi putus") {
		t.Errorf("gagal umum: status = %d, body = %s (rincian galat tidak boleh bocor)", rec.Code, rec.Body)
	}
}

func TestOltRebootCooldownBlocksDoubleClickButAllowsRetryAfterFailure(t *testing.T) {
	h := newOltBindHarness(t, rebootQuerier(t), &fakeBindStoreOlt{}, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	// Gagal ditolak OLT: tidak mengunci, operator boleh mencoba lagi.
	setFakeRebootResult(t, olt.ErrRebootRejected)
	if rec := h.do(http.MethodPost, rebootPath, tk, nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("percobaan gagal: status = %d", rec.Code)
	}
	setFakeRebootResult(t, nil)
	if rec := h.do(http.MethodPost, rebootPath, tk, nil); rec.Code != http.StatusOK {
		t.Fatalf("ulang setelah gagal: status = %d, body = %s", rec.Code, rec.Body)
	}
	// Berhasil: klik kedua dalam semenit ditolak dan tidak sampai ke OLT.
	rec := h.do(http.MethodPost, rebootPath, tk, nil)
	if rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), "reboot_cooldown") {
		t.Fatalf("klik ganda: status = %d, body = %s", rec.Code, rec.Body)
	}
	if got := rebootedList(); len(got) != 1 {
		t.Fatalf("OLT harus menerima tepat satu reboot, menerima %v", got)
	}
	// ONU lain tidak ikut terkunci.
	if rec := h.do(http.MethodPost, "/api/v1/olts/olt-1/onus/2/8/reboot", tk, nil); rec.Code != http.StatusOK {
		t.Fatalf("ONU lain: status = %d", rec.Code)
	}
}
