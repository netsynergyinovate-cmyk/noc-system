package httpapi

import (
	"net/http"
	"testing"

	"noc-isp/backend/internal/state"
)

func TestBillingServiceMismatchesEndpoint(t *testing.T) {
	h := newAPIHarness(t)
	h.mgr.SetBillingStatuses([]state.BillingChange{{CustomerID: "c1", Status: "isolir"}}) // c1 online
	rec := h.get("/api/v1/billing/service-mismatches")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	body := decode[struct {
		Data  []state.BillingServiceMismatch `json:"data"`
		Count int                            `json:"count"`
	}](t, rec)
	if body.Count != 1 || len(body.Data) != 1 || body.Data[0].CustomerID != "c1" || body.Data[0].Type != "isolir_online" {
		t.Errorf("body = %+v", body)
	}
	if h.do(http.MethodGet, "/api/v1/billing/service-mismatches", "", nil).Code != http.StatusUnauthorized {
		t.Error("tanpa tiket harus 401")
	}
}
