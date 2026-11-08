package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"noc-isp/backend/internal/cpe"
)

// CpeAPI melayani rute CPE TR-069 via GenieACS dari backend Go.
type CpeAPI struct {
	svc    *cpe.Service
	logger *slog.Logger
}

func NewCpeAPI(svc *cpe.Service, logger *slog.Logger) *CpeAPI {
	return &CpeAPI{
		svc:    svc,
		logger: logger,
	}
}

func (a *CpeAPI) register(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/cpe/devices", http.HandlerFunc(a.list))
	mux.Handle("GET /api/v1/cpe/devices/{id}", http.HandlerFunc(a.get))
	mux.Handle("POST /api/v1/cpe/devices/{id}/refresh", http.HandlerFunc(a.refresh))
	mux.Handle("POST /api/v1/cpe/devices/{id}/reboot", http.HandlerFunc(a.reboot))
	mux.Handle("POST /api/v1/cpe/devices/{id}/wifi", http.HandlerFunc(a.wifi))
}

func (a *CpeAPI) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("query")
	devices, err := a.svc.ListRawDevices(r.Context(), q)
	if err != nil {
		a.logger.Warn("cpe list failed", "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "cpe_list_failed", Message: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, dataResponse[[]map[string]any]{Data: devices})
}

func (a *CpeAPI) get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "id wajib diisi"})
		return
	}
	dev, err := a.svc.GetRawDevice(r.Context(), id)
	if errors.Is(err, cpe.ErrDeviceNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "not_found", Message: "perangkat tidak ditemukan"})
		return
	}
	if err != nil {
		a.logger.Warn("cpe get failed", "id", id, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "cpe_get_failed", Message: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, dataResponse[map[string]any]{Data: dev})
}

func (a *CpeAPI) refresh(w http.ResponseWriter, r *http.Request) {
	identity, ok := identityFrom(r.Context())
	if !ok {
		unauthorized(w)
		return
	}
	if !identity.Can(cpeManagePerm) {
		forbidden(w)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "id wajib diisi"})
		return
	}

	res, err := a.svc.RefreshRealtime(r.Context(), id)
	if errors.Is(err, cpe.ErrDeviceNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "not_found", Message: "perangkat tidak ditemukan"})
		return
	}
	if err != nil {
		a.logger.Warn("cpe refresh failed", "id", id, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "cpe_refresh_failed", Message: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, res)
}

func (a *CpeAPI) reboot(w http.ResponseWriter, r *http.Request) {
	identity, ok := identityFrom(r.Context())
	if !ok {
		unauthorized(w)
		return
	}
	if !identity.Can(cpeManagePerm) {
		forbidden(w)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "id wajib diisi"})
		return
	}

	res, err := a.svc.Reboot(r.Context(), id)
	if errors.Is(err, cpe.ErrRebootCooldown) {
		writeJSON(w, http.StatusTooManyRequests, errorResponse{Error: "reboot_cooldown", Message: err.Error()})
		return
	}
	if errors.Is(err, cpe.ErrDeviceNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "not_found", Message: "perangkat tidak ditemukan"})
		return
	}
	if err != nil {
		a.logger.Warn("cpe reboot failed", "id", id, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "cpe_reboot_failed", Message: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, res)
}

func (a *CpeAPI) wifi(w http.ResponseWriter, r *http.Request) {
	identity, ok := identityFrom(r.Context())
	if !ok {
		unauthorized(w)
		return
	}
	if !identity.Can(cpeManagePerm) {
		forbidden(w)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "id wajib diisi"})
		return
	}

	var in cpe.WifiChangeInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "payload tidak valid"})
		return
	}

	res, err := a.svc.ChangeWifi(r.Context(), id, in)
	if errors.Is(err, cpe.ErrInvalidInput) {
		writeJSON(w, http.StatusUnprocessableEntity, errorResponse{Error: "invalid_input", Message: err.Error()})
		return
	}
	if errors.Is(err, cpe.ErrDeviceNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "not_found", Message: "perangkat tidak ditemukan"})
		return
	}
	if err != nil {
		a.logger.Warn("cpe wifi failed", "id", id, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "cpe_wifi_failed", Message: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, res)
}
