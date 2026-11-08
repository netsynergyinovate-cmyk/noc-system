package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/cpe"
)

func TestCpeAPI_Endpoints(t *testing.T) {
	muxNBI := http.NewServeMux()
	muxNBI.HandleFunc("/devices", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{"_id": "TEST-ONT-01"},
		})
	})
	muxNBI.HandleFunc("/devices/TEST-ONT-01/tasks", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"_id":"task-ok-1"}`))
	})
	srvNBI := httptest.NewServer(muxNBI)
	defer srvNBI.Close()

	client := cpe.NewClient(cpe.Config{BaseURL: srvNBI.URL, Timeout: 2 * time.Second})
	svc := cpe.NewService(client, slog.Default())
	api := NewCpeAPI(svc, nil, nil, slog.Default())
	mux := http.NewServeMux()
	api.register(mux)

	// Uji list devices
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cpe/devices", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Uji get device
	req = httptest.NewRequest(http.MethodGet, "/api/v1/cpe/devices/TEST-ONT-01", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Uji reboot tanpa izin -> 401
	req = httptest.NewRequest(http.MethodPost, "/api/v1/cpe/devices/TEST-ONT-01/reboot", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 unauthorized, got %d", w.Code)
	}

	// Uji reboot dengan izin cpe:manage
	req = httptest.NewRequest(http.MethodPost, "/api/v1/cpe/devices/TEST-ONT-01/reboot", nil)
	ident := auth.Identity{
		UserID: "test-user",
		Perms:  []string{cpeManagePerm},
	}
	req = req.WithContext(withIdentity(req.Context(), ident))
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Uji wifi dengan izin cpe:manage
	body := strings.NewReader(`{"index":1,"ssid":"NewSSID","password":"newpassword123"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/cpe/devices/TEST-ONT-01/wifi", body)
	req = req.WithContext(withIdentity(req.Context(), ident))
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Uji guide
	req = httptest.NewRequest(http.MethodGet, "/api/v1/cpe/guide", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for guide, got %d", w.Code)
	}
}
