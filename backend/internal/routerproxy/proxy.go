// Package routerproxy adalah satu-satunya gerbang Next.js ke perangkat
// MikroTik untuk pembacaan monitoring. Next.js tidak lagi menghubungi router
// secara langsung: ia memanggil endpoint baca-saja di sini, dan backend Go yang
// memilih transport REST atau API biner serta membuka kata sandi terenkripsi.
package routerproxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"noc-isp/backend/internal/collector"
)

const requestTimeout = 10 * time.Second

// Source memenuhi kontrak baca router untuk httpapi.Options.Routers.
type Source struct {
	db     *pgxpool.Pool
	secret string
	logger *slog.Logger
}

func New(db *pgxpool.Pool, deviceSecret string, logger *slog.Logger) *Source {
	if db == nil || deviceSecret == "" {
		return nil
	}
	return &Source{db: db, secret: deviceSecret, logger: logger}
}

const targetSQL = `SELECT id::text, name, host, username, password_enc, protocol
	FROM routers WHERE id = $1::uuid AND status = 'aktif'`

func (s *Source) target(ctx context.Context, routerID string) (collector.Target, error) {
	var id, name, host, username, passwordEnc, protocol string
	err := s.db.QueryRow(ctx, targetSQL, routerID).Scan(&id, &name, &host, &username, &passwordEnc, &protocol)
	if err != nil {
		return collector.Target{}, fmt.Errorf("router aktif tidak ditemukan: %w", err)
	}
	base, err := collector.BaseURLFromHost(host)
	if err != nil {
		return collector.Target{}, err
	}
	password, err := collector.DecryptCredential(passwordEnc, s.secret)
	if err != nil {
		return collector.Target{}, err
	}
	return collector.Target{
		RouterID: routerID,
		BaseURL:  base,
		Protocol: protocol,
		Username: username,
		Password: password,
	}, nil
}

func (s *Source) client(ctx context.Context, routerID string) (*collector.Client, error) {
	t, err := s.target(ctx, routerID)
	if err != nil {
		return nil, err
	}
	return collector.NewClient(t, collector.DefaultHTTPClient())
}

// Read menjalankan GET baca-saja pada path /rest/... dan mengembalikan JSON
// mentah router (bentuk sama dengan REST, termasuk saat transport-nya API biner).
func (s *Source) Read(ctx context.Context, routerID, restPath string, query url.Values) ([]byte, error) {
	segments, err := restSegments(restPath)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	client, err := s.client(ctx, routerID)
	if err != nil {
		return nil, err
	}
	proplist := query.Get(".proplist")
	filter := make(url.Values, len(query))
	for k, v := range query {
		if k == ".proplist" || k == "path" {
			continue
		}
		filter[k] = v
	}
	return client.GetQuery(ctx, proplist, filter, segments...)
}

// Measure menjalankan perintah ukur baca-saja (ping/traceroute/ethernet monitor).
func (s *Source) Measure(ctx context.Context, routerID, restPath string, body map[string]any) ([]byte, error) {
	if err := validateMeasure(restPath); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	client, err := s.client(ctx, routerID)
	if err != nil {
		return nil, err
	}
	return client.PostRaw(ctx, restPath, body)
}

func restSegments(restPath string) ([]string, error) {
	p := "/" + strings.TrimPrefix(strings.TrimSpace(restPath), "/")
	if !strings.HasPrefix(p, "/rest/") || strings.Contains(p, "..") {
		return nil, errors.New("path harus di bawah /rest/")
	}
	parts := strings.Split(strings.TrimPrefix(p, "/rest/"), "/")
	for _, part := range parts {
		if part == "" || strings.ContainsAny(part, " \t?#") {
			return nil, errors.New("path router tidak valid")
		}
	}
	return parts, nil
}

func validateMeasure(restPath string) error {
	p := "/" + strings.TrimPrefix(strings.TrimSpace(restPath), "/")
	switch p {
	case "/rest/tool/ping", "/rest/tool/traceroute", "/rest/interface/ethernet/monitor":
		return nil
	}
	return fmt.Errorf("perintah ukur %q tidak diizinkan", restPath)
}

// ServiceAddress membaca kolom address= layanan RouterOS (mis. www/api).
// Dipakai untuk menyusun perintah allow-list yang MENAMBAHKAN IP baru tanpa
// menghapus entri lama.
func (s *Source) ServiceAddress(ctx context.Context, routerID, service string) (string, error) {
	if service != "www" && service != "api" {
		return "", errors.New("layanan harus www atau api")
	}
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	client, err := s.client(ctx, routerID)
	if err != nil {
		return "", err
	}
	body, err := client.GetQuery(ctx, "name,address,disabled,port", url.Values{"name": {service}}, "ip", "service")
	if err != nil {
		return "", err
	}
	var rows []struct {
		Address string `json:"address"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return "", fmt.Errorf("jawaban /ip/service tidak valid: %w", err)
	}
	if len(rows) == 0 {
		return "", nil
	}
	return rows[0].Address, nil
}
