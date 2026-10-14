package httpapi

import (
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/wire"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
	maxOffset       = 1_000_000
	maxQueryLength  = 100
)

// DashboardData adalah sumber data endpoint dashboard; *state.Manager
// memenuhinya. Semua method mengembalikan salinan.
type DashboardData interface {
	Counts() state.Counts
	Routers() []state.Router
	Customers() []state.Customer
	TrafficSeries() []state.TrafficPoint
	BillingServiceMismatches() []state.BillingServiceMismatch
}

type dashboardAPI struct {
	data DashboardData
}

// newDashboardMux membangun rute /api/v1/ untuk data dashboard. Semua rute
// hanya menerima GET dan HEAD.
func newDashboardMux(data DashboardData, history *historyAPI) http.Handler {
	api := &dashboardAPI{data: data}
	mux := http.NewServeMux()
	mux.Handle("/api/v1/summary", readOnly(api.summary))
	mux.Handle("/api/v1/routers", readOnly(api.routers))
	mux.Handle("/api/v1/customers", readOnly(api.customers))
	mux.Handle("/api/v1/traffic", readOnly(api.traffic))
	mux.Handle("/api/v1/billing/service-mismatches", readOnly(api.billingServiceMismatches))
	mux.Handle("/api/v1/traffic/history", readOnly(history.history))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "not_found"})
	})
	return mux
}

func readOnly(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method_not_allowed"})
			return
		}
		next(w, r)
	})
}

type dataResponse[T any] struct {
	Data T `json:"data"`
}

type pageMeta struct {
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	Total   int  `json:"total"`
	HasMore bool `json:"hasMore"`
}

type pageResponse[T any] struct {
	Data []T      `json:"data"`
	Meta pageMeta `json:"meta"`
}

type summaryData struct {
	Counts      wire.Counts `json:"counts"`
	GeneratedAt int64       `json:"generatedAt"`
}

func (a *dashboardAPI) summary(w http.ResponseWriter, r *http.Request) {
	if _, err := parseQuery(r); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dataResponse[summaryData]{Data: summaryData{
		Counts:      wire.NewCounts(a.data.Counts()),
		GeneratedAt: time.Now().Unix(),
	}})
}

func (a *dashboardAPI) routers(w http.ResponseWriter, r *http.Request) {
	if _, err := parseQuery(r); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dataResponse[[]wire.Router]{Data: wire.NewRouters(a.data.Routers())})
}

// customers mendukung saringan yang sama dengan tabel di dashboard: status,
// router, dan pencarian teks (nama, username PPPoE, atau alamat).
func (a *dashboardAPI) customers(w http.ResponseWriter, r *http.Request) {
	params, err := parseQuery(r, "status", "router", "q", "limit", "offset")
	if err != nil {
		badRequest(w, err)
		return
	}
	status, ok := state.ParseStatusFilter(params.Get("status"))
	if !ok {
		badRequest(w, fmt.Errorf("status harus salah satu dari all, online, offline, weak"))
		return
	}
	query := strings.TrimSpace(params.Get("q"))
	if utf8.RuneCountInString(query) > maxQueryLength {
		badRequest(w, fmt.Errorf("q paling panjang %d karakter", maxQueryLength))
		return
	}
	limit, err := intParam(params, "limit", defaultPageSize, 1, maxPageSize)
	if err != nil {
		badRequest(w, err)
		return
	}
	offset, err := intParam(params, "offset", 0, 0, maxOffset)
	if err != nil {
		badRequest(w, err)
		return
	}

	matched := state.FilterCustomers(a.data.Customers(), state.CustomerFilter{
		Query:    query,
		Status:   status,
		RouterID: params.Get("router"),
	})
	total := len(matched)
	start := min(offset, total)
	end := min(start+limit, total)
	writeJSON(w, http.StatusOK, pageResponse[wire.Customer]{
		Data: wire.NewCustomers(matched[start:end]),
		Meta: pageMeta{Limit: limit, Offset: offset, Total: total, HasMore: end < total},
	})
}

// traffic mengembalikan total traffic semua router per detik. `seconds` memilih
// berapa detik terakhir yang diambil (default dan maksimum seluruh jendela).
func (a *dashboardAPI) traffic(w http.ResponseWriter, r *http.Request) {
	params, err := parseQuery(r, "seconds")
	if err != nil {
		badRequest(w, err)
		return
	}
	seconds, err := intParam(params, "seconds", state.TrafficWindow, 1, state.TrafficWindow)
	if err != nil {
		badRequest(w, err)
		return
	}
	points := a.data.TrafficSeries()
	if len(points) > 0 {
		cutoff := points[len(points)-1].Time - int64(seconds)
		first := slices.IndexFunc(points, func(p state.TrafficPoint) bool { return p.Time > cutoff })
		points = points[first:]
	}
	writeJSON(w, http.StatusOK, dataResponse[wire.TrafficSeries]{Data: wire.NewTrafficSeries(points)})
}

// parseQuery menolak parameter yang tidak dikenal atau diulang, supaya salah
// ketik (mis. "stats=offline") tidak diam-diam menghasilkan data tanpa saringan.
func parseQuery(r *http.Request, allowed ...string) (url.Values, error) {
	values := r.URL.Query()
	for key, list := range values {
		if !slices.Contains(allowed, key) {
			return nil, fmt.Errorf("parameter %q tidak dikenal", key)
		}
		if len(list) > 1 {
			return nil, fmt.Errorf("parameter %q diulang", key)
		}
	}
	return values, nil
}

func intParam(values url.Values, key string, fallback, lowest, highest int) (int, error) {
	raw := values.Get(key)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < lowest || n > highest {
		return 0, fmt.Errorf("%s harus bilangan bulat %d sampai %d", key, lowest, highest)
	}
	return n, nil
}

func badRequest(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: err.Error()})
}
