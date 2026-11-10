package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORS_AllowsLocalhost3001(t *testing.T) {
	handler := withCORS([]string{"http://localhost:3000"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// OPTIONS preflight from http://localhost:3001
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/customers", nil)
	req.Header.Set("Origin", "http://localhost:3001")
	req.Header.Set("Access-Control-Request-Method", "GET")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected status 204, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3001" {
		t.Errorf("expected allow origin http://localhost:3001, got %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); got != "Authorization, Content-Type" {
		t.Errorf("expected allow headers 'Authorization, Content-Type', got %q", got)
	}

	// Normal request from http://localhost:3001
	req = httptest.NewRequest(http.MethodGet, "/api/v1/customers", nil)
	req.Header.Set("Origin", "http://localhost:3001")
	rec = httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3001" {
		t.Errorf("expected allow origin http://localhost:3001, got %q", got)
	}
}
