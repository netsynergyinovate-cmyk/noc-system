package cpe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrDeviceNotFound = errors.New("perangkat tidak ditemukan di GenieACS")
	ErrTaskConflict   = errors.New("konflik antrean task di GenieACS")
	ErrDeviceOffline  = errors.New("perangkat tidak merespons connection request (kemungkinan offline)")
	ErrUnauthorized   = errors.New("kredensial NBI ditolak")
)

type Config struct {
	BaseURL  string
	Username string
	Password string
	Timeout  time.Duration
}

type Client struct {
	cfg        Config
	httpClient *http.Client
}

func NewClient(cfg Config) *Client {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:7557"
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &Client{
		cfg: Config{
			BaseURL:  baseURL,
			Username: cfg.Username,
			Password: cfg.Password,
			Timeout:  timeout,
		},
		httpClient: &http.Client{Timeout: timeout},
	}
}

func (c *Client) req(ctx context.Context, method, path string, body any) (*http.Response, error) {
	targetURL := c.cfg.BaseURL + path
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request body: %w", err)
		}
		reader = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, targetURL, reader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.cfg.Username != "" || c.cfg.Password != "" {
		req.SetBasicAuth(c.cfg.Username, c.cfg.Password)
	}

	res, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http execute %s %s: %w", method, targetURL, err)
	}
	return res, nil
}

// ListDevices mengambil daftar perangkat mentah dari GenieACS NBI.
func (c *Client) ListDevices(ctx context.Context, queryJSON string) ([]map[string]any, error) {
	p := "/devices"
	if queryJSON != "" {
		p += "?query=" + url.QueryEscape(queryJSON)
	}
	res, err := c.req(ctx, http.MethodGet, p, nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nbi list devices status %d", res.StatusCode)
	}

	var devices []map[string]any
	if err := json.NewDecoder(res.Body).Decode(&devices); err != nil {
		return nil, fmt.Errorf("decode devices: %w", err)
	}
	return devices, nil
}

// GetDevice mengambil satu dokumen perangkat lengkap dari GenieACS NBI.
func (c *Client) GetDevice(ctx context.Context, deviceID string) (map[string]any, error) {
	q := fmt.Sprintf(`{"_id":"%s"}`, deviceID)
	devices, err := c.ListDevices(ctx, q)
	if err != nil {
		return nil, err
	}
	if len(devices) == 0 {
		return nil, ErrDeviceNotFound
	}
	return devices[0], nil
}

// PostTask mengirim task RPC TR-069 ke satu perangkat di GenieACS NBI.
func (c *Client) PostTask(ctx context.Context, deviceID string, task map[string]any, connectionRequest bool, waitMs int) (statusCode int, taskID string, err error) {
	escapedID := url.PathEscape(deviceID)
	path := fmt.Sprintf("/devices/%s/tasks", escapedID)
	if connectionRequest {
		if waitMs > 0 {
			path += fmt.Sprintf("?connection_request&timeout=%d", waitMs)
		} else {
			path += "?connection_request"
		}
	}

	res, err := c.req(ctx, http.MethodPost, path, task)
	if err != nil {
		return 0, "", err
	}
	defer res.Body.Close()

	statusCode = res.StatusCode
	var resBody map[string]any
	_ = json.NewDecoder(res.Body).Decode(&resBody)
	if tid, ok := resBody["_id"].(string); ok {
		taskID = tid
	}

	switch statusCode {
	case http.StatusOK, http.StatusAccepted:
		return statusCode, taskID, nil
	case http.StatusNotFound:
		return statusCode, taskID, ErrDeviceNotFound
	case http.StatusConflict:
		return statusCode, taskID, ErrTaskConflict
	case http.StatusGatewayTimeout:
		return statusCode, taskID, ErrDeviceOffline
	case http.StatusUnauthorized, http.StatusForbidden:
		return statusCode, taskID, ErrUnauthorized
	default:
		return statusCode, taskID, fmt.Errorf("nbi task failed with status %d", statusCode)
	}
}

// DeleteTask menghapus task antrean dari GenieACS NBI.
func (c *Client) DeleteTask(ctx context.Context, taskID string) error {
	escapedID := url.PathEscape(taskID)
	res, err := c.req(ctx, http.MethodDelete, fmt.Sprintf("/tasks/%s", escapedID), nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK || res.StatusCode == http.StatusNotFound {
		return nil
	}
	return fmt.Errorf("delete task status %d", res.StatusCode)
}
