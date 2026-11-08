package cpe

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClient_ListAndGetDevice(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/devices", func(w http.ResponseWriter, r *http.Request) {
		devices := []map[string]any{
			{"_id": "DEV-01", "InternetGatewayDevice": map[string]any{}},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(devices)
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := NewClient(Config{BaseURL: srv.URL, Timeout: 2 * time.Second})
	ctx := context.Background()

	devices, err := client.ListDevices(ctx, "")
	if err != nil {
		t.Fatalf("ListDevices error: %v", err)
	}
	if len(devices) != 1 || devices[0]["_id"] != "DEV-01" {
		t.Fatalf("unexpected devices: %v", devices)
	}

	dev, err := client.GetDevice(ctx, "DEV-01")
	if err != nil {
		t.Fatalf("GetDevice error: %v", err)
	}
	if dev["_id"] != "DEV-01" {
		t.Fatalf("unexpected device: %v", dev)
	}
}

func TestService_RebootAndCooldown(t *testing.T) {
	var taskReceived map[string]any
	mux := http.NewServeMux()
	mux.HandleFunc("/devices/DEV-01/tasks", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &taskReceived)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"_id":"task-123"}`))
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := NewClient(Config{BaseURL: srv.URL, Timeout: 2 * time.Second})
	svc := NewService(client, slog.Default())
	ctx := context.Background()

	res, err := svc.Reboot(ctx, "DEV-01")
	if err != nil {
		t.Fatalf("Reboot error: %v", err)
	}
	if !res.OK || res.Status != http.StatusOK {
		t.Fatalf("unexpected reboot res: %+v", res)
	}
	if taskReceived["name"] != "reboot" {
		t.Fatalf("unexpected task received: %v", taskReceived)
	}

	// Reboot kedua langsung terbentur cooldown
	_, err = svc.Reboot(ctx, "DEV-01")
	if err != ErrRebootCooldown {
		t.Fatalf("expected ErrRebootCooldown, got: %v", err)
	}
}

func TestService_ChangeWifiValidation(t *testing.T) {
	client := NewClient(Config{BaseURL: "http://127.0.0.1:9999", Timeout: time.Second})
	svc := NewService(client, slog.Default())
	ctx := context.Background()

	// Password < 8 karakter ditolak sebelum memanggil network
	_, err := svc.ChangeWifi(ctx, "DEV-01", WifiChangeInput{
		SSID:     "MyWifi",
		Password: "123",
	})
	if err == nil {
		t.Fatalf("expected error for short password, got nil")
	}

	// SSID & password kosong ditolak
	_, err = svc.ChangeWifi(ctx, "DEV-01", WifiChangeInput{})
	if err == nil {
		t.Fatalf("expected error for empty wifi, got nil")
	}
}

func TestService_SanitizeSecrets(t *testing.T) {
	input := map[string]any{
		"_id": "DEV-01",
		"InternetGatewayDevice": map[string]any{
			"ManagementServer": map[string]any{
				"ConnectionRequestUsername": "admin",
				"ConnectionRequestPassword": "super-secret-password",
			},
			"LANDevice": map[string]any{
				"1": map[string]any{
					"WLANConfiguration": map[string]any{
						"1": map[string]any{
							"SSID":          "MyHomeWifi",
							"KeyPassphrase": "my-wifi-password",
							"PreSharedKey": map[string]any{
								"1": map[string]any{
									"KeyPassphrase": "another-secret",
								},
							},
						},
					},
				},
			},
		},
	}

	cleaned, ok := SanitizeSecrets(input).(map[string]any)
	if !ok {
		t.Fatalf("expected map[string]any, got %T", cleaned)
	}

	rawJSON, _ := json.Marshal(cleaned)
	str := string(rawJSON)

	if strings.Contains(str, "super-secret-password") ||
		strings.Contains(str, "my-wifi-password") ||
		strings.Contains(str, "another-secret") ||
		strings.Contains(str, "ConnectionRequestPassword") ||
		strings.Contains(str, "KeyPassphrase") {
		t.Fatalf("secrets leaked in sanitized document: %s", str)
	}

	if !strings.Contains(str, "MyHomeWifi") || !strings.Contains(str, "DEV-01") {
		t.Fatalf("safe data missing: %s", str)
	}
}
