package cpe

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

var (
	ErrInvalidInput = errors.New("input tidak valid")
	ErrRebootCooldown = errors.New("perangkat baru saja di-reboot, tunggu beberapa saat")
)

type Service struct {
	client *Client
	logger *slog.Logger

	rebootMu    sync.Mutex
	rebootUntil map[string]time.Time
}

func NewService(client *Client, logger *slog.Logger) *Service {
	return &Service{
		client:      client,
		logger:      logger,
		rebootUntil: make(map[string]time.Time),
	}
}

func (s *Service) claimReboot(id string) bool {
	s.rebootMu.Lock()
	defer s.rebootMu.Unlock()
	now := time.Now()
	if until, ok := s.rebootUntil[id]; ok && now.Before(until) {
		return false
	}
	// Bersihkan entri lama
	for k, until := range s.rebootUntil {
		if now.After(until) {
			delete(s.rebootUntil, k)
		}
	}
	s.rebootUntil[id] = now.Add(time.Minute)
	return true
}

type RefreshResult struct {
	OK        bool     `json:"ok"`
	Refreshed bool     `json:"refreshed"`
	Status    int      `json:"status"`
	TasksSent []string `json:"tasksSent"`
}

// RefreshRealtime memicu refresh on-demand TR-069 via connection request seketika
func (s *Service) RefreshRealtime(ctx context.Context, deviceID string) (*RefreshResult, error) {
	raw, err := s.client.GetDevice(ctx, deviceID)
	if err != nil {
		return nil, err
	}

	// Tentukan parameter yang benar-benar ada di dokumen
	var objectsToRefresh []string
	if _, ok := raw["InternetGatewayDevice"]; ok {
		objectsToRefresh = append(objectsToRefresh, "InternetGatewayDevice.LANDevice.1.Hosts.Host")
	} else if _, ok := raw["Device"]; ok {
		objectsToRefresh = append(objectsToRefresh, "Device.Hosts.Host")
	}

	var postedTaskIDs []string
	var tasksSent []string
	lastStatus := http.StatusOK
	anyApplied := false

	for i, obj := range objectsToRefresh {
		isLast := i == len(objectsToRefresh)-1
		desc := "refreshObject:" + obj
		tasksSent = append(tasksSent, desc)

		waitMs := 0
		if isLast {
			waitMs = 5000
		}

		task := map[string]any{
			"name":       "refreshObject",
			"objectName": obj,
		}

		status, taskID, postErr := s.client.PostTask(ctx, deviceID, task, isLast, waitMs)
		if taskID != "" {
			postedTaskIDs = append(postedTaskIDs, taskID)
		}

		if isLast {
			lastStatus = status
			if postErr == nil && status == http.StatusOK {
				anyApplied = true
			}
		}
	}

	// Jika tidak selesai 200 (misal 202/timeout/offline), bersihkan task agar tidak menumpuk di queue ONT
	if !anyApplied {
		for _, tid := range postedTaskIDs {
			_ = s.client.DeleteTask(ctx, tid)
		}
	}

	return &RefreshResult{
		OK:        anyApplied,
		Refreshed: anyApplied,
		Status:    lastStatus,
		TasksSent: tasksSent,
	}, nil
}

type RebootResult struct {
	OK      bool   `json:"ok"`
	Status  int    `json:"status"`
	Message string `json:"message"`
}

// Reboot memicu reboot remote ONT via TR-069 RPC seketika
func (s *Service) Reboot(ctx context.Context, deviceID string) (*RebootResult, error) {
	if !s.claimReboot(deviceID) {
		return nil, ErrRebootCooldown
	}

	task := map[string]any{
		"name": "reboot",
	}

	status, _, err := s.client.PostTask(ctx, deviceID, task, true, 5000)
	if err != nil {
		return nil, err
	}

	msg := "Perintah reboot berhasil dieksekusi seketika ke perangkat"
	if status == http.StatusAccepted {
		msg = "Perintah reboot diantrekan di GenieACS (menunggu inform perangkat berikutnya)"
	}

	return &RebootResult{
		OK:      status == http.StatusOK || status == http.StatusAccepted,
		Status:  status,
		Message: msg,
	}, nil
}

type WifiChangeInput struct {
	Index    int    `json:"index"`
	SSID     string `json:"ssid"`
	Password string `json:"password,omitempty"`
}

type WifiChangeResult struct {
	OK      bool   `json:"ok"`
	Status  int    `json:"status"`
	Message string `json:"message"`
}

// ChangeWifi mengubah nama dan password Wi-Fi seketika
func (s *Service) ChangeWifi(ctx context.Context, deviceID string, in WifiChangeInput) (*WifiChangeResult, error) {
	if in.SSID == "" && in.Password == "" {
		return nil, fmt.Errorf("%w: SSID atau kata sandi harus diisi", ErrInvalidInput)
	}
	if in.Password != "" && len(in.Password) < 8 {
		return nil, fmt.Errorf("%w: kata sandi minimal 8 karakter", ErrInvalidInput)
	}

	idx := in.Index
	if idx <= 0 {
		idx = 1
	}

	var paramValues [][]string
	if in.SSID != "" {
		paramValues = append(paramValues, []string{
			fmt.Sprintf("InternetGatewayDevice.LANDevice.1.WLANConfiguration.%d.SSID", idx),
			in.SSID,
			"xsd:string",
		})
	}
	if in.Password != "" {
		paramValues = append(paramValues, []string{
			fmt.Sprintf("InternetGatewayDevice.LANDevice.1.WLANConfiguration.%d.KeyPassphrase", idx),
			in.Password,
			"xsd:string",
		})
	}

	task := map[string]any{
		"name":            "setParameterValues",
		"parameterValues": paramValues,
	}

	status, _, err := s.client.PostTask(ctx, deviceID, task, true, 20000)
	if err != nil {
		return nil, err
	}

	msg := "Wi-Fi berhasil diubah seketika di modem"
	if status == http.StatusAccepted {
		msg = "Perintah ganti Wi-Fi diantrekan di GenieACS (menunggu inform modem)"
	}

	return &WifiChangeResult{
		OK:      status == http.StatusOK || status == http.StatusAccepted,
		Status:  status,
		Message: msg,
	}, nil
}

// GetRawDevice mengambil dokumen mentah perangkat
func (s *Service) GetRawDevice(ctx context.Context, deviceID string) (map[string]any, error) {
	return s.client.GetDevice(ctx, deviceID)
}

// ListRawDevices mengambil daftar dokumen mentah perangkat
func (s *Service) ListRawDevices(ctx context.Context, query string) ([]map[string]any, error) {
	return s.client.ListDevices(ctx, query)
}
