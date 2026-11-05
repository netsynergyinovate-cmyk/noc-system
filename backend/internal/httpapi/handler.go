// Package httpapi berisi router HTTP backend: endpoint kesehatan sekarang,
// REST dan WebSocket pada task berikutnya.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/netflow"
	"noc-isp/backend/internal/routerproxy"
	"noc-isp/backend/internal/wire"
)

// NetflowStatusSource adalah status kesehatan penerima NetFlow.
type NetflowStatusSource interface {
	Health() netflow.ReceiverHealth
	Exporters() []netflow.ExporterStatus
}

// NetflowQuerySource menyediakan agregasi dan data sesi NetFlow dari database.
type NetflowQuerySource interface {
	Summary(ctx context.Context, rangeStr string, routerID string) (*netflow.SummaryData, error)
	TopTalkers(ctx context.Context, rangeStr string, routerID string, limit int) ([]netflow.TopTalkerRecord, error)
	CustomerUsage(ctx context.Context, rangeStr string, limit int) ([]netflow.CustomerUsageRecord, error)
	Sessions(ctx context.Context, filter netflow.SessionFilter) ([]netflow.SessionRecord, error)
}

// TorchSource menjalankan perekaman torch RouterOS secara aman.
type TorchSource interface {
	RunCapture(ctx context.Context, in netflow.TorchCaptureInput) (*netflow.TorchCaptureResult, error)
}

// RouterReader adalah gerbang baca-saja Next.js ke router MikroTik. Semua
// pembacaan monitoring lewat sini; Next.js tidak membuka koneksi sendiri.
type RouterReader interface {
	Read(ctx context.Context, routerID, restPath string, query url.Values) ([]byte, error)
	Measure(ctx context.Context, routerID, restPath string, body map[string]any) ([]byte, error)
	ServiceAddress(ctx context.Context, routerID, service string) (string, error)
}

// RouterPreflight menguji koneksi fisik router sebelum disimpan.
type RouterPreflight interface {
	Preflight(ctx context.Context, in routerproxy.PreflightInput) routerproxy.PreflightResult
}

// TelemetrySource adalah telemetri terakhir yang dihitung backend; *telemetry.Service memenuhinya.
type TelemetrySource interface {
	Latest() wire.Telemetry
	VlanHistory() []wire.VlanHistory
}

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

	// Telemetry melayani GET /api/v1/dashboard/telemetry (isi yang sama dengan pesan
	// WebSocket "telemetry"). Kosong berarti rute itu tidak terdaftar.
	Telemetry TelemetrySource

	// Netflow melayani GET /api/v1/netflow/status dan /healthz/netflow bila diisi.
	Netflow NetflowStatusSource
	// NetflowQuery melayani agregasi dan data sesi NetFlow dari database bila diisi.
	NetflowQuery NetflowQuerySource
	// Torch menjalankan perekaman torch langsung bila diisi.
	Torch TorchSource
	// Routers melayani baca-saja ke MikroTik untuk Next.js (satu gateway).
	// Kosong berarti rute /api/v1/routers/{id}/... tidak terdaftar.
	Routers RouterReader
	// RouterPreflight menguji koneksi router sebelum disimpan.
	RouterPreflight RouterPreflight
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

	if opts.Netflow != nil {
		mux.HandleFunc("/healthz/netflow", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method_not_allowed"})
				return
			}
			writeJSON(w, http.StatusOK, opts.Netflow.Health())
		})
	}

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
		if opts.Telemetry != nil {
			api.Handle("/api/v1/dashboard/vlans/history", readOnly(func(w http.ResponseWriter, r *http.Request) {
				if _, err := parseQuery(r); err != nil {
					badRequest(w, err)
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[[]wire.VlanHistory]{Data: opts.Telemetry.VlanHistory()})
			}))
			api.Handle("/api/v1/dashboard/telemetry", readOnly(func(w http.ResponseWriter, r *http.Request) {
				if _, err := parseQuery(r); err != nil {
					badRequest(w, err)
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[wire.Telemetry]{Data: opts.Telemetry.Latest()})
			}))
		}
		if opts.NetflowQuery != nil {
			api.Handle("/api/v1/netflow/summary", readOnly(func(w http.ResponseWriter, r *http.Request) {
				q, err := parseQuery(r, "range", "router_id")
				if err != nil {
					badRequest(w, err)
					return
				}
				rangeStr := q.Get("range")
				routerID := q.Get("router_id")
				res, err := opts.NetflowQuery.Summary(r.Context(), rangeStr, routerID)
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error"})
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[*netflow.SummaryData]{Data: res})
			}))
			api.Handle("/api/v1/netflow/top-talkers", readOnly(func(w http.ResponseWriter, r *http.Request) {
				q, err := parseQuery(r, "range", "router_id", "limit")
				if err != nil {
					badRequest(w, err)
					return
				}
				rangeStr := q.Get("range")
				routerID := q.Get("router_id")
				limit, err := intParam(q, "limit", 10, 1, 100)
				if err != nil {
					badRequest(w, err)
					return
				}
				res, err := opts.NetflowQuery.TopTalkers(r.Context(), rangeStr, routerID, limit)
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error"})
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[[]netflow.TopTalkerRecord]{Data: res})
			}))
			api.Handle("/api/v1/netflow/customers/usage", readOnly(func(w http.ResponseWriter, r *http.Request) {
				q, err := parseQuery(r, "range", "limit")
				if err != nil {
					badRequest(w, err)
					return
				}
				rangeStr := q.Get("range")
				limit, err := intParam(q, "limit", 50, 1, 500)
				if err != nil {
					badRequest(w, err)
					return
				}
				res, err := opts.NetflowQuery.CustomerUsage(r.Context(), rangeStr, limit)
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error"})
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[[]netflow.CustomerUsageRecord]{Data: res})
			}))
			api.Handle("/api/v1/netflow/sessions", readOnly(func(w http.ResponseWriter, r *http.Request) {
				q, err := parseQuery(r, "range", "router_id", "customer_id", "pon_port", "protocol", "q", "limit", "offset")
				if err != nil {
					badRequest(w, err)
					return
				}
				limit, err := intParam(q, "limit", 50, 1, 500)
				if err != nil {
					badRequest(w, err)
					return
				}
				offset, err := intParam(q, "offset", 0, 0, 1000000)
				if err != nil {
					badRequest(w, err)
					return
				}
				filter := netflow.SessionFilter{
					RangeStr:   q.Get("range"),
					RouterID:   q.Get("router_id"),
					CustomerID: q.Get("customer_id"),
					PonPort:    q.Get("pon_port"),
					Protocol:   q.Get("protocol"),
					Query:      q.Get("q"),
					Limit:      limit,
					Offset:     offset,
				}
				res, err := opts.NetflowQuery.Sessions(r.Context(), filter)
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error"})
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[[]netflow.SessionRecord]{Data: res})
			}))
		}
		if opts.Netflow != nil {
			api.Handle("/api/v1/netflow/status", readOnly(func(w http.ResponseWriter, r *http.Request) {
				if _, err := parseQuery(r); err != nil {
					badRequest(w, err)
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[netflow.ReceiverHealth]{Data: opts.Netflow.Health()})
			}))
			api.Handle("/api/v1/netflow/exporters", readOnly(func(w http.ResponseWriter, r *http.Request) {
				if _, err := parseQuery(r); err != nil {
					badRequest(w, err)
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[[]netflow.ExporterStatus]{Data: opts.Netflow.Exporters()})
			}))
		}
		if opts.Torch != nil && opts.Verifier != nil {
			api.Handle("/api/v1/netflow/torch", requirePerm(opts.Verifier, "capture:run", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method_not_allowed"})
					return
				}
				identity, _ := identityFrom(r.Context())
				var req struct {
					CustomerID      string `json:"customerId"`
					DurationSeconds int    `json:"durationSeconds"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					badRequest(w, err)
					return
				}
				if req.CustomerID == "" {
					badRequest(w, errors.New("customerId wajib"))
					return
				}
				if req.DurationSeconds != 15 && req.DurationSeconds != 30 && req.DurationSeconds != 60 {
					badRequest(w, errors.New("durationSeconds harus 15, 30, atau 60"))
					return
				}
				res, err := opts.Torch.RunCapture(r.Context(), netflow.TorchCaptureInput{
					CustomerID:      req.CustomerID,
					DurationSeconds: req.DurationSeconds,
					UserID:          identity.UserID,
					RecordedBy:      identity.UserID,
				})
				if err != nil {
					opts.Logger.Error("torch run capture gagal", "error", err)
					if errors.Is(err, netflow.ErrCustomerOffline) {
						writeJSON(w, http.StatusConflict, errorResponse{Error: "customer_offline", Message: "Pelanggan sedang offline (sesi PPPoE tidak aktif)"})
						return
					}
					if strings.Contains(err.Error(), "not enough permissions") {
						writeJSON(w, http.StatusBadGateway, errorResponse{Error: "router_permission_denied", Message: "RouterOS menolak izin (not enough permissions). Pastikan grup user API memiliki izin: read,write,test,sniff,api,rest-api."})
						return
					}
					writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error"})
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[*netflow.TorchCaptureResult]{Data: res})
			})))
		}
		if opts.RouterPreflight != nil {
			api.Handle("POST /api/v1/routers/preflight", requirePerm(opts.Verifier, "router:manage", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var in routerproxy.PreflightInput
				dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
				dec.DisallowUnknownFields()
				if err := dec.Decode(&in); err != nil || strings.TrimSpace(in.Host) == "" || strings.TrimSpace(in.Username) == "" {
					writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "host dan username wajib"})
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[routerproxy.PreflightResult]{Data: opts.RouterPreflight.Preflight(r.Context(), in)})
			})))
		}
		if opts.Routers != nil {
			// Gerbang baca-saja: Next.js mengirim path /rest/... dan filter query.
			api.HandleFunc("GET /api/v1/routers/{id}/service", func(w http.ResponseWriter, r *http.Request) {
				routerID := r.PathValue("id")
				service := r.URL.Query().Get("name")
				if routerID == "" || (service != "www" && service != "api") {
					writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "id router dan name (www/api) wajib"})
					return
				}
				address, err := opts.Routers.ServiceAddress(r.Context(), routerID, service)
				if err != nil {
					writeJSON(w, http.StatusBadGateway, errorResponse{Error: "router_service_failed", Message: err.Error()})
					return
				}
				writeJSON(w, http.StatusOK, dataResponse[struct {
					Address string `json:"address"`
				}]{Data: struct {
					Address string `json:"address"`
				}{Address: address}})
			})
			api.HandleFunc("GET /api/v1/routers/{id}/read", func(w http.ResponseWriter, r *http.Request) {
				routerID := r.PathValue("id")
				restPath := r.URL.Query().Get("path")
				if routerID == "" || !strings.HasPrefix("/"+strings.TrimPrefix(restPath, "/"), "/rest/") {
					writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "id router dan path /rest/ wajib"})
					return
				}
				data, err := opts.Routers.Read(r.Context(), routerID, restPath, r.URL.Query())
				if err != nil {
					writeJSON(w, http.StatusBadGateway, errorResponse{Error: "router_read_failed", Message: err.Error()})
					return
				}
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.Header().Set("Cache-Control", "no-store")
				_, _ = w.Write(data)
			})
			api.HandleFunc("POST /api/v1/routers/{id}/measure", func(w http.ResponseWriter, r *http.Request) {
				routerID := r.PathValue("id")
				var req struct {
					Path string         `json:"path"`
					Body map[string]any `json:"body"`
				}
				dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
				dec.DisallowUnknownFields()
				if err := dec.Decode(&req); err != nil || routerID == "" || req.Path == "" {
					writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "id router dan path wajib"})
					return
				}
				data, err := opts.Routers.Measure(r.Context(), routerID, req.Path, req.Body)
				if err != nil {
					writeJSON(w, http.StatusBadGateway, errorResponse{Error: "router_measure_failed", Message: err.Error()})
					return
				}
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.Header().Set("Cache-Control", "no-store")
				_, _ = w.Write(data)
			})
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
