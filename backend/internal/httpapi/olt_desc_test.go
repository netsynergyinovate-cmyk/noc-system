package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"noc-isp/backend/internal/olt"
)

var (
	fakeDescOnce sync.Once
	fakeDescMu   sync.Mutex
	fakeDescErr  error
	fakeDescs    map[olt.OnuRef]string
)

func setFakeDescResult(t *testing.T, err error) {
	t.Helper()
	fakeDescOnce.Do(func() {
		olt.Register("fake-desc", func(cfg olt.Config) (olt.Driver, error) { return fakeDescDriver{}, nil })
	})
	fakeDescMu.Lock()
	fakeDescErr = err
	fakeDescs = make(map[olt.OnuRef]string)
	fakeDescMu.Unlock()
}

type fakeDescDriver struct{}

func (fakeDescDriver) Name() string                                              { return "fake-desc" }
func (fakeDescDriver) Close() error                                              { return nil }
func (fakeDescDriver) TestConnection(context.Context) error                      { return nil }
func (fakeDescDriver) FetchPonPorts(context.Context) ([]olt.PonPortStats, error) { return nil, nil }
func (fakeDescDriver) FetchOnus(context.Context) ([]olt.OnuStats, error)         { return nil, nil }
func (fakeDescDriver) SetOnuDescription(_ context.Context, ref olt.OnuRef, desc string) (string, error) {
	fakeDescMu.Lock()
	defer fakeDescMu.Unlock()
	if fakeDescErr != nil {
		return "", fakeDescErr
	}
	fakeDescs[ref] = desc
	return desc, nil
}

func doBody(h *apiHarness, method, path, ticket, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if ticket != "" {
		req.Header.Set("Authorization", "Bearer "+ticket)
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

func TestOltDescriptionRequiresTicketAndPermission(t *testing.T) {
	setFakeDescResult(t, nil)
	q := &fakeOltQuerier{row: []string{"127.0.0.1:0", "fake-desc", "NOCApp", mustEncryptForTest(t, "rahasia-olt", testDeviceSecret)}}
	h := newOltBindHarness(t, q, &fakeBindStoreOlt{}, 1)

	path := "/api/v1/olts/olt-1/onus/1/3/description"
	payload := `{"description":"1396-BUDI SANTOSO"}`

	// Tanpa tiket -> 401
	rec := doBody(h, http.MethodPost, path, "", payload)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("tanpa tiket: status = %d, want 401", rec.Code)
	}

	// Tiket tanpa izin cpe:manage -> 403
	tkBad, _ := h.tokens.IssueWithPerms("u", []string{"router:read"}, time.Now(), time.Minute)
	rec = doBody(h, http.MethodPost, path, tkBad, payload)
	if rec.Code != http.StatusForbidden {
		t.Errorf("tiket salah izin: status = %d, want 403", rec.Code)
	}

	// Tiket dengan cpe:manage -> 200
	tkGood, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)
	rec = doBody(h, http.MethodPost, path, tkGood, payload)
	if rec.Code != http.StatusOK {
		t.Errorf("tiket sah: status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	fakeDescMu.Lock()
	desc := fakeDescs[olt.OnuRef{Pon: 1, Onu: 3}]
	fakeDescMu.Unlock()
	if desc != "1396-BUDI SANTOSO" {
		t.Errorf("desc = %q, want '1396-BUDI SANTOSO'", desc)
	}
}

func TestOltDescriptionRejectionsAreReported(t *testing.T) {
	setFakeDescResult(t, olt.ErrDescriptionRejected)
	q := &fakeOltQuerier{row: []string{"127.0.0.1:0", "fake-desc", "NOCApp", mustEncryptForTest(t, "rahasia-olt", testDeviceSecret)}}
	h := newOltBindHarness(t, q, &fakeBindStoreOlt{}, 1)

	path := "/api/v1/olts/olt-1/onus/1/3/description"
	payload := `{"description":"TEST-FAIL"}`
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	rec := doBody(h, http.MethodPost, path, tk, payload)
	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502 (body=%s)", rec.Code, rec.Body.String())
	}
}
