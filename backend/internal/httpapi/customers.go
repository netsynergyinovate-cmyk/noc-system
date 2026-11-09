package httpapi

import (
	"context"
	"net/http"

	"noc-isp/backend/internal/customers"
)

type CustomerLiveSource interface {
	GetLiveStatus(ctx context.Context) (map[string]customers.CustomerLiveStatus, error)
}

type CustomersAPI struct {
	svc CustomerLiveSource
}

func NewCustomersAPI(svc CustomerLiveSource) *CustomersAPI {
	return &CustomersAPI{svc: svc}
}

func (a *CustomersAPI) register(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/customers/live-status", http.HandlerFunc(a.liveStatus))
}

func (a *CustomersAPI) liveStatus(w http.ResponseWriter, r *http.Request) {
	if a.svc == nil {
		writeJSON(w, http.StatusOK, dataResponse[map[string]customers.CustomerLiveStatus]{Data: map[string]customers.CustomerLiveStatus{}})
		return
	}
	data, err := a.svc.GetLiveStatus(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "customers_live_failed", Message: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, dataResponse[map[string]customers.CustomerLiveStatus]{Data: data})
}
