package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/cpe"
)

// CpeAPI melayani rute CPE TR-069 via GenieACS dari backend Go.
type CpeAPI struct {
	svc     *cpe.Service
	routers RouterReader
	db      collector.Querier
	logger  *slog.Logger
}

func NewCpeAPI(svc *cpe.Service, routers RouterReader, db collector.Querier, logger *slog.Logger) *CpeAPI {
	return &CpeAPI{
		svc:     svc,
		routers: routers,
		db:      db,
		logger:  logger,
	}
}

func (a *CpeAPI) register(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/cpe/devices", http.HandlerFunc(a.list))
	mux.Handle("GET /api/v1/cpe/devices/{id}", http.HandlerFunc(a.get))
	mux.Handle("POST /api/v1/cpe/devices/{id}/refresh", http.HandlerFunc(a.refresh))
	mux.Handle("POST /api/v1/cpe/devices/{id}/reboot", http.HandlerFunc(a.reboot))
	mux.Handle("POST /api/v1/cpe/devices/{id}/wifi", http.HandlerFunc(a.wifi))
	mux.Handle("GET /api/v1/cpe/guide", http.HandlerFunc(a.guide))
}

func (a *CpeAPI) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("query")
	devices, err := a.svc.ListSanitizedDevices(r.Context(), q)
	if err != nil {
		a.logger.Warn("cpe list failed", "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "cpe_list_failed", Message: "Gagal mengambil daftar perangkat dari GenieACS"})
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
	dev, err := a.svc.GetSanitizedDevice(r.Context(), id)
	if errors.Is(err, cpe.ErrDeviceNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "not_found", Message: "perangkat tidak ditemukan"})
		return
	}
	if err != nil {
		a.logger.Warn("cpe get failed", "id", id, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "cpe_get_failed", Message: "Gagal mengambil detail perangkat dari GenieACS"})
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

type ConnReqGuideResponse struct {
	AcsServerIP            string `json:"acsServerIp"`
	OntSubnet              string `json:"ontSubnet"`
	Port                   int    `json:"port"`
	IsForwardRuleInstalled bool   `json:"isForwardRuleInstalled"`
	PacketsForwarded       string `json:"packetsForwarded"`
	RecommendedCommand     string `json:"recommendedCommand"`
	DiagnosticStatus       string `json:"diagnosticStatus"`
}

// guide membaca konfigurasi aktual router MikroTik dan menyusun panduan Connection Request otomatis
func (a *CpeAPI) guide(w http.ResponseWriter, r *http.Request) {
	resp := ConnReqGuideResponse{
		AcsServerIP:            "<IP_SERVER_GENIEACS>",
		OntSubnet:              "172.16.15.0/24",
		Port:                   7547,
		IsForwardRuleInstalled: false,
		PacketsForwarded:       "0",
		DiagnosticStatus:       "Konfigurasi router belum dibaca",
	}

	if a.routers == nil || a.db == nil {
		resp.RecommendedCommand = fmt.Sprintf(
			"/ip firewall filter add chain=forward action=accept protocol=tcp src-address=%s dst-address=%s dst-port=%d comment=\"GenieACS Server ke ONT\" place-before=0",
			resp.AcsServerIP, resp.OntSubnet, resp.Port,
		)
		writeJSON(w, http.StatusOK, dataResponse[ConnReqGuideResponse]{Data: resp})
		return
	}

	// Cari router aktif pertama
	var routerID string
	rows, err := a.db.Query(r.Context(), "SELECT id::text FROM routers WHERE status = 'aktif' LIMIT 1")
	if err != nil {
		resp.DiagnosticStatus = "Gagal membaca database router"
		resp.RecommendedCommand = fmt.Sprintf(
			"/ip firewall filter add chain=forward action=accept protocol=tcp src-address=%s dst-address=%s dst-port=%d comment=\"GenieACS Server ke ONT\" place-before=0",
			resp.AcsServerIP, resp.OntSubnet, resp.Port,
		)
		writeJSON(w, http.StatusOK, dataResponse[ConnReqGuideResponse]{Data: resp})
		return
	}
	defer rows.Close()
	if rows.Next() {
		_ = rows.Scan(&routerID)
	}
	if routerID == "" {
		resp.DiagnosticStatus = "Tidak ada router aktif di database"
		resp.RecommendedCommand = fmt.Sprintf(
			"/ip firewall filter add chain=forward action=accept protocol=tcp src-address=%s dst-address=%s dst-port=%d comment=\"GenieACS Server ke ONT\" place-before=0",
			resp.AcsServerIP, resp.OntSubnet, resp.Port,
		)
		writeJSON(w, http.StatusOK, dataResponse[ConnReqGuideResponse]{Data: resp})
		return
	}

	// 1. Baca NAT router untuk mendeteksi to-addresses noc-acs (IP server ACS sebenarnya)
	natData, err := a.routers.Read(r.Context(), routerID, "/rest/ip/firewall/nat", url.Values{})
	if err == nil {
		var nats []map[string]any
		_ = json.Unmarshal(natData, &nats)
		for _, n := range nats {
			comment, _ := n["comment"].(string)
			toAddr, _ := n["to-addresses"].(string)
			if (strings.Contains(strings.ToLower(comment), "acs") || strings.Contains(strings.ToLower(comment), "tr069")) && toAddr != "" {
				resp.AcsServerIP = toAddr
				break
			}
		}
	}

	// 2. Baca Filter router untuk cek rule forward GenieACS
	filterData, err := a.routers.Read(r.Context(), routerID, "/rest/ip/firewall/filter", url.Values{})
	if err == nil {
		var filters []map[string]any
		_ = json.Unmarshal(filterData, &filters)
		for _, f := range filters {
			comment, _ := f["comment"].(string)
			chain, _ := f["chain"].(string)
			if chain == "forward" && (strings.Contains(strings.ToLower(comment), "genieacs") || strings.Contains(strings.ToLower(comment), "tr069") || strings.Contains(strings.ToLower(comment), "acs")) {
				resp.IsForwardRuleInstalled = true
				if pkts, ok := f["packets"].(string); ok {
					resp.PacketsForwarded = pkts
				}
				break
			}
		}
	}

	// 3. Susun rekomendasi perintah dan diagnosa status
	resp.RecommendedCommand = fmt.Sprintf(
		"/ip firewall filter add chain=forward action=accept protocol=tcp src-address=%s dst-address=%s dst-port=%d comment=\"GenieACS Server ke ONT\" place-before=0",
		resp.AcsServerIP, resp.OntSubnet, resp.Port,
	)

	if !resp.IsForwardRuleInstalled {
		resp.DiagnosticStatus = "Rule forward port 7547 belum terpasang di MikroTik. Jalankan perintah rekomendasi."
	} else if resp.PacketsForwarded == "0" {
		resp.DiagnosticStatus = "Rule forward terpasang di MikroTik, namun paket wake-up dari server belum sampai ke router (packets: 0)."
	} else {
		resp.DiagnosticStatus = "Rule forward aktif dan paket connection request berhasil diteruskan oleh MikroTik."
	}

	writeJSON(w, http.StatusOK, dataResponse[ConnReqGuideResponse]{Data: resp})
}
