package main

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/billing"
	"noc-isp/backend/internal/httpapi"
	"noc-isp/backend/internal/state"
)

// Tes pemasangan endpoint /api/v1/billing ke backend (attachBillingAPI): kapan
// aktif, dari mana jadwalnya, dan bahwa yang terpasang di handler sungguhan
// menjawab sesuai kontrak ketika database tidak bisa dihubungi.

const billingAPISecret = "0123456789abcdef0123456789abcdef"

// startedScheduler menjalankan startBilling dengan konfigurasi lengkap dan
// mengembalikan Scheduler yang dilaporkannya (nil bila tidak ada). Database dan
// sistem billing sengaja tidak tersedia.
func startedScheduler(t *testing.T, minute string, withDB bool) (*billing.Scheduler, billing.ReadDB) {
	t.Helper()
	settings, err := loadBillingSettings(envFrom(fullBillingEnv(map[string]string{
		"BILLING_URL": "http://127.0.0.1:1", "BILLING_SYNC_MINUTE": minute,
	})))
	if err != nil {
		t.Fatal(err)
	}
	var (
		db     billing.DB
		readDB billing.ReadDB
	)
	if withDB {
		pool, err := openArchivePool(context.Background(), "postgres://noc:rahasia-sekali@127.0.0.1:1/noc?connect_timeout=1")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(pool.Close)
		db, readDB = pool, pool
	}
	logger, _ := testLogger()
	ctx, cancel := context.WithCancel(context.Background())
	var scheduler *billing.Scheduler
	wait, err := startBilling(ctx, logger, settings, db, func(s *billing.Scheduler) { scheduler = s })
	if err != nil {
		cancel()
		t.Fatalf("startBilling: %v", err)
	}
	t.Cleanup(func() {
		cancel()
		wait()
	})
	return scheduler, readDB
}

func TestStartBillingReportsItsSchedulerOnlyWhenItRuns(t *testing.T) {
	logger, _ := testLogger()
	called := 0
	observe := func(*billing.Scheduler) { called++ }

	// Billing tidak dikonfigurasi: tidak ada penjadwal.
	wait, err := startBilling(context.Background(), logger, billingSettings{}, nil, observe)
	if err != nil {
		t.Fatal(err)
	}
	wait()
	// Dikonfigurasi tanpa database: tidak ada penjadwal.
	wait, err = startBilling(context.Background(), logger, billingSettings{Enabled: true}, nil, observe)
	if err != nil {
		t.Fatal(err)
	}
	wait()
	if called != 0 {
		t.Errorf("pengamat dipanggil %d kali tanpa penjadwal yang berjalan", called)
	}

	scheduler, _ := startedScheduler(t, "17", true)
	if scheduler == nil {
		t.Fatal("penjadwal tidak dilaporkan padahal billing berjalan")
	}
	// Jadwal yang dilaporkan adalah jadwal menit yang dikonfigurasi.
	for _, now := range []time.Time{
		time.Date(2026, 5, 1, 10, 16, 59, 0, time.UTC),
		time.Date(2026, 5, 1, 10, 17, 0, 0, time.UTC),
		time.Date(2026, 5, 1, 23, 59, 59, 0, time.UTC),
	} {
		if got, want := scheduler.NextRunAt(now), billing.NextRun(now, 17); !got.Equal(want) {
			t.Errorf("NextRunAt(%s) = %s, want %s", now, got, want)
		}
	}
}

func TestAttachBillingAPIOnlyWhenTheSchedulerAndDatabaseExist(t *testing.T) {
	scheduler, readDB := startedScheduler(t, "5", true)
	if scheduler == nil || readDB == nil {
		t.Fatal("penjadwal dan pool seharusnya ada")
	}

	cases := map[string]struct {
		db        billing.ReadDB
		scheduler *billing.Scheduler
		attached  bool
	}{
		"keduanya ada":      {readDB, scheduler, true},
		"tanpa penjadwal":   {readDB, nil, false},
		"tanpa database":    {nil, scheduler, false},
		"tidak ada satupun": {nil, nil, false},
	}
	for name, tc := range cases {
		var opts httpapi.Options
		attachBillingAPI(&opts, tc.db, tc.scheduler)
		if attached := opts.Billing != nil && opts.BillingNextRun != nil; attached != tc.attached {
			t.Errorf("%s: terpasang = %v, want %v", name, attached, tc.attached)
		}
		if !tc.attached && (opts.Billing != nil || opts.BillingNextRun != nil) {
			t.Errorf("%s: sebagian terpasang: %+v", name, opts)
		}
	}

	var opts httpapi.Options
	attachBillingAPI(&opts, readDB, scheduler)
	now := time.Date(2026, 5, 1, 10, 5, 3, 0, time.UTC)
	if got, want := opts.BillingNextRun(now), time.Date(2026, 5, 1, 11, 5, 0, 0, time.UTC); !got.Equal(want) {
		t.Errorf("jadwal yang dipasang = %s, want %s (Scheduler.NextRunAt)", got, want)
	}
}

// Handler lengkap seperti yang disusun main: bila penjadwal berjalan, endpoint
// aktif dan galat database menjadi 500 polos; bila tidak, 503 billing_disabled.
func TestWiredBillingEndpointsAnswerAccordingToTheirState(t *testing.T) {
	tokens, err := auth.NewTokens(billingAPISecret)
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := tokens.Issue("viewer", time.Now(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	build := func(attach bool) (http.Handler, *bytes.Buffer) {
		logs := &bytes.Buffer{}
		opts := httpapi.Options{
			Logger:   slog.New(slog.NewTextHandler(logs, nil)),
			Data:     state.NewManager(),
			Verifier: tokens,
		}
		if attach {
			scheduler, readDB := startedScheduler(t, "5", true)
			attachBillingAPI(&opts, readDB, scheduler)
		}
		return httpapi.NewHandler(opts), logs
	}
	get := func(h http.Handler, path, ticket string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if ticket != "" {
			req.Header.Set("Authorization", "Bearer "+ticket)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	live, logs := build(true)
	for _, path := range []string{"/api/v1/billing", "/api/v1/billing/sync"} {
		if rec := get(live, path, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s tanpa tiket: status = %d, want 401", path, rec.Code)
		}
		// Database tidak bisa dihubungi: 500 polos tanpa alamat atau kata sandinya.
		rec := get(live, path, ticket)
		if rec.Code != http.StatusInternalServerError || rec.Body.String() != "{\"error\":\"internal\"}\n" {
			t.Errorf("%s: status %d body %q, want 500 internal", path, rec.Code, rec.Body)
		}
		for _, leak := range []string{"rahasia-sekali", "127.0.0.1", "noc"} {
			if strings.Contains(rec.Body.String(), leak) {
				t.Errorf("%s membocorkan %q: %s", path, leak, rec.Body)
			}
		}
	}
	if strings.Contains(logs.String(), "rahasia-sekali") {
		t.Errorf("log membocorkan kata sandi database:\n%s", logs)
	}

	off, _ := build(false)
	for _, path := range []string{"/api/v1/billing", "/api/v1/billing/sync"} {
		rec := get(off, path, ticket)
		if rec.Code != http.StatusServiceUnavailable || strings.TrimSpace(rec.Body.String()) != `{"error":"billing_disabled"}` {
			t.Errorf("%s tanpa penjadwal: status %d body %q, want 503 billing_disabled", path, rec.Code, rec.Body)
		}
	}
}
