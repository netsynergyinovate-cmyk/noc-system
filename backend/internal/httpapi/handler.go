// Package httpapi berisi router HTTP backend: endpoint kesehatan sekarang,
// REST dan WebSocket pada task berikutnya.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"noc-isp/backend/internal/auth"
)

// Options mengatur handler. Logger wajib diisi.
type Options struct {
	Logger  *slog.Logger
	Version string
	// WebSocket melayani /ws bila diisi; kosong berarti endpoint itu tidak ada.
	WebSocket http.Handler

	// PPPWebhook melayani /hooks/ppp bila diisi. Ia memeriksa tokennya sendiri
	// (token router, bukan tiket login dashboard).
	PPPWebhook http.Handler

	// Data dan Verifier mengaktifkan endpoint REST /api/v1/. Keduanya wajib diisi:
	// tanpa pemeriksaan tiket, data jaringan tidak boleh dilayani. AllowedOrigins
	// adalah origin browser yang boleh memanggil API ini.
	Data           DashboardData
	Verifier       auth.Verifier
	AllowedOrigins []string

	// History menjawab /api/v1/traffic/history dari arsip. Bila kosong (belum ada
	// database), endpoint itu menjawab 503 history_unavailable.
	History HistorySource

	// Billing dan BillingNextRun mengaktifkan /api/v1/billing dan
	// /api/v1/billing/sync. Keduanya diisi bersama hanya bila sinkron billing
	// benar-benar berjalan di proses ini: BillingNextRun adalah
	// Scheduler.NextRunAt, jadwal yang sama dengan yang dijalankan. Bila salah
	// satunya kosong, kedua endpoint menjawab 503 billing_disabled (lihat
	// billing.go).
	Billing        BillingSource
	BillingNextRun func(now time.Time) time.Time
	// BillingTrigger melayani POST /api/v1/billing/sync (sinkron manual).
	// Bila kosong, POST itu menjawab 503 billing_disabled. *billing.Scheduler
	// memenuhinya.
	BillingTrigger BillingTrigger

	// OltBind melayani POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/tr069-bind.
	// Kosong (tanpa DATABASE_URL) berarti rute itu tidak terdaftar sama sekali,
	// bukan menjawab error: 404 generik dari mux dashboard di belakangnya.
	OltBind *OltBindAPI

	// OntWeb melayani POST /api/v1/ont-web/tr069 (pasang GenieACS lewat halaman
	// web admin modem). Kosong (ONT_ACS_URL tidak diisi) berarti rute tidak
	// terdaftar: 404 generik.
	OntWeb *OntWebAPI

	// Now adalah jam untuk jawaban yang memuat waktu (nextRunAt pada endpoint
	// billing). Bawaannya time.Now; tes mengisinya agar jawabannya tetap. Pemeriksaan
	// tiket tetap memakai jam sistem.
	Now func() time.Time
}

type healthResponse struct {
	Status        string `json:"status"`
	Version       string `json:"version"`
	UptimeSeconds int64  `json:"uptimeSeconds"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

// NewHandler membangun router lengkap dengan middleware.
func NewHandler(opts Options) http.Handler {
	started := time.Now()
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method_not_allowed"})
			return
		}
		writeJSON(w, http.StatusOK, healthResponse{
			Status:        "ok",
			Version:       opts.Version,
			UptimeSeconds: int64(time.Since(started).Seconds()),
		})
	})

	if opts.WebSocket != nil {
		mux.Handle("/ws", opts.WebSocket)
	}

	if opts.PPPWebhook != nil {
		mux.Handle("/hooks/ppp", opts.PPPWebhook)
	}

	if opts.Data != nil && opts.Verifier != nil {
		// Rute billing didaftarkan lebih dulu pada mux induk; sisanya (dan semua
		// 404 di bawah /api/v1/) dilayani mux dashboard.
		api := http.NewServeMux()
		billingAPI := newBillingAPI(opts.Billing, opts.BillingNextRun, opts.Logger)
		billingAPI.trigger = opts.BillingTrigger
		if opts.Now != nil {
			billingAPI.now = opts.Now
		}
		billingAPI.register(api)
		if opts.OltBind != nil {
			opts.OltBind.register(api)
		}
		if opts.OntWeb != nil {
			opts.OntWeb.register(api)
		}
		api.Handle("/", newDashboardMux(opts.Data, newHistoryAPI(opts.History, opts.Logger)))
		// CORS paling luar agar preflight (yang tidak membawa tiket) bisa lewat.
		mux.Handle("/api/v1/", withCORS(opts.AllowedOrigins, requireTicket(opts.Verifier, api)))
	}

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "not_found"})
	})

	return logRequests(opts.Logger, secureHeaders(mux))
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	// Error saat menulis berarti klien sudah pergi; tidak ada yang bisa diperbaiki.
	_ = json.NewEncoder(w).Encode(body)
}
