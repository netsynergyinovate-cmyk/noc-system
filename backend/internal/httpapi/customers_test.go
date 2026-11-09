package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"noc-isp/backend/internal/customers"
)

type mockCustomerLiveSource struct {
	data map[string]customers.CustomerLiveStatus
	err  error
}

func (m *mockCustomerLiveSource) GetLiveStatus(ctx context.Context) (map[string]customers.CustomerLiveStatus, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.data, nil
}

func f(v float64) *float64 { return &v }
func s(v string) *string   { return &v }

func TestCustomersAPI_LiveStatus(t *testing.T) {
	src := &mockCustomerLiveSource{
		data: map[string]customers.CustomerLiveStatus{
			"c-1": {
				IP:       s("172.16.15.227"),
				Uptime:   s("4d 12h"),
				RxDbm:    f(-18.5),
				RxSource: s("genieacs"),
				OnuLos:   false,
			},
			"c-2": {
				OnuLos:   true,
				RxSource: s("olt"),
			},
		},
	}

	api := NewCustomersAPI(src)
	mux := http.NewServeMux()
	api.register(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/customers/live-status", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var res struct {
		Data map[string]customers.CustomerLiveStatus `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	c1, ok := res.Data["c-1"]
	if !ok || c1.IP == nil || *c1.IP != "172.16.15.227" || c1.OnuLos {
		t.Errorf("c-1 invalid: %+v", c1)
	}

	c2, ok := res.Data["c-2"]
	if !ok || !c2.OnuLos {
		t.Errorf("c-2 OnuLos should be true: %+v", c2)
	}
}
