package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/diagnostics"
)

// registerDiagnostics memasang API diagnosa Go. Semua rute berada di bawah
// requireTicket (lihat handler.go), jadi hanya tiket login sah yang diterima.
func registerDiagnostics(api *http.ServeMux, svc DiagnosticsService, verifier auth.Verifier) {
	if svc == nil {
		return
	}

	api.HandleFunc("POST /api/v1/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			CustomerID  string `json:"customerId"`
			ComplaintAt string `json:"complaintAt"`
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || req.CustomerID == "" {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "customerId wajib"})
			return
		}
		var complaintAt *time.Time
		if req.ComplaintAt != "" {
			if t, err := time.Parse(time.RFC3339, req.ComplaintAt); err == nil {
				complaintAt = &t
			}
		}
		identity, _ := identityFrom(r.Context())
		name := identity.UserID
		if name == "" {
			name = "Operator"
		}
		run, reused, err := svc.StartManual(r.Context(), req.CustomerID, identity.UserID, name, complaintAt)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "diagnostic_failed", Message: err.Error()})
			return
		}
		status := http.StatusAccepted
		if reused {
			status = http.StatusOK
		}
		writeJSON(w, status, map[string]any{"data": map[string]any{"run": run, "reused": reused}})
	})

	api.HandleFunc("GET /api/v1/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		runs, err := svc.List(r.Context(), r.URL.Query().Get("customerId"), limit)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "diagnostic_failed", Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": runs})
	})

	// Tiket keluhan memicu diagnosa otomatis di Go (bukan di Next).
	api.HandleFunc("POST /api/v1/diagnostics/auto", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			AlertID string `json:"alertId"`
			Reason  string `json:"reason"`
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || req.AlertID == "" {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "alertId wajib"})
			return
		}
		if req.Reason == "" {
			req.Reason = "ticket"
		}
		run, merged, err := svc.StartAutoForAlert(r.Context(), req.AlertID, req.Reason)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "diagnostic_failed", Message: err.Error()})
			return
		}
		status := http.StatusAccepted
		if merged {
			status = http.StatusOK
		}
		writeJSON(w, status, map[string]any{"data": map[string]any{"run": run, "merged": merged}})
	})

	api.HandleFunc("GET /api/v1/diagnostics/policy", func(w http.ResponseWriter, r *http.Request) {
		p, err := svc.Policy(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "diagnostic_failed", Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": p})
	})

	api.Handle("PUT /api/v1/diagnostics/policy", requirePerm(verifier, "threshold:manage", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p diagnostics.Policy
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&p); err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "badan policy tidak valid"})
			return
		}
		identity, _ := identityFrom(r.Context())
		saved, err := svc.UpdatePolicy(r.Context(), p, identity.UserID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": saved})
	})))

	api.HandleFunc("GET /api/v1/diagnostics/{id}", func(w http.ResponseWriter, r *http.Request) {
		run, findings, err := svc.Get(r.Context(), r.PathValue("id"))
		if err != nil {
			writeJSON(w, http.StatusNotFound, errorResponse{Error: "not_found", Message: "diagnosa tidak ditemukan"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"run": run, "findings": findings}})
	})

	api.Handle("POST /api/v1/diagnostics/{id}/attach", requirePerm(verifier, "alert:handle", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			AlertID string `json:"alertId"`
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || req.AlertID == "" {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "alertId wajib"})
			return
		}
		identity, _ := identityFrom(r.Context())
		notes, err := svc.Attach(r.Context(), r.PathValue("id"), req.AlertID, identity.UserID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "attach_failed", Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"ticketNotes": notes}, "ticketNotes": notes})
	})))
}
