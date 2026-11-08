package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/olt"
)

// cpeManagePerm: izin tiket yang sama dengan reboot/ubah Wi-Fi CPE di Next.js
// (resource "cpe", aksi "manage" di src/lib/permissions.ts). Satu izin untuk
// semua aksi tulis ke CPE/ONT, baik lewat GenieACS maupun lewat OLT.
const cpeManagePerm = "cpe:manage"

// oltBindTimeout membatasi satu sesi telnet ke OLT (login + show profil + ikat).
const oltBindTimeout = 20 * time.Second

const oltByIDSQL = `SELECT host, driver, username, password_enc FROM olts WHERE id = $1::uuid AND status = 'aktif'`

// OltBindAPI melayani POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/tr069-bind:
// mengikat SATU ONU ke profil TR-069 di OLT-nya lewat telnet, dipicu operator
// (tombol "Daftarkan ke GenieACS" di aplikasi), dan POST .../reboot: me-reboot SATU ONU lewat OLT. Hanya dua
// endpoint ini yang menulis ke OLT; semua endpoint lain di bawah /api/v1/ hanya membaca.
type OltBindAPI struct {
	db           collector.Querier
	deviceSecret string
	// profileID: id profil TR-069 yang sudah dibuat operator di OLT (lihat
	// OLT_TR069_PROFILE_ID). Backend tidak pernah membuat profil sendiri.
	profileID int
	store     olt.BindStore
	logger    *slog.Logger

	rebootMu    sync.Mutex
	rebootUntil map[string]time.Time // oltId/pon/onu -> boleh di-reboot lagi setelah waktu ini
}

// NewOltBindAPI membuat handler. db dipakai HANYA untuk membaca kredensial OLT
// (host/username/password_enc); deviceSecret membukanya, sama dengan polling.
func NewOltBindAPI(db collector.Querier, deviceSecret string, profileID int, store olt.BindStore, logger *slog.Logger) *OltBindAPI {
	return &OltBindAPI{db: db, deviceSecret: deviceSecret, profileID: profileID, store: store, logger: logger, rebootUntil: map[string]time.Time{}}
}

// rebootCooldown mencegah klik ganda (atau dua operator sekaligus) me-reboot pelanggan yang sama dua kali.
const rebootCooldown = time.Minute

func (a *OltBindAPI) claimReboot(key string) bool {
	a.rebootMu.Lock()
	defer a.rebootMu.Unlock()
	now := time.Now()
	if until, ok := a.rebootUntil[key]; ok && now.Before(until) {
		return false
	}
	for k, until := range a.rebootUntil { // buang entri lama supaya peta tidak tumbuh
		if now.After(until) {
			delete(a.rebootUntil, k)
		}
	}
	a.rebootUntil[key] = now.Add(rebootCooldown)
	return true
}

func (a *OltBindAPI) releaseReboot(key string) {
	a.rebootMu.Lock()
	delete(a.rebootUntil, key)
	a.rebootMu.Unlock()
}

func (a *OltBindAPI) register(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/tr069-bind", http.HandlerFunc(a.bind))
	mux.Handle("POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/reboot", http.HandlerFunc(a.reboot))
	mux.Handle("POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/description", http.HandlerFunc(a.description))
}

// bind: tiket diperiksa requireTicket di mux luar (NewHandler); di sini izin
// cpeManagePerm diperiksa SEBELUM apa pun dijalankan, seperti manualSync billing.
func (a *OltBindAPI) bind(w http.ResponseWriter, r *http.Request) {
	identity, ok := identityFrom(r.Context())
	if !ok {
		unauthorized(w)
		return
	}
	if !identity.Can(cpeManagePerm) {
		forbidden(w)
		return
	}

	oltID := r.PathValue("oltId")
	pon, errP := strconv.Atoi(r.PathValue("pon"))
	onu, errO := strconv.Atoi(r.PathValue("onu"))
	if oltID == "" || errP != nil || errO != nil || pon < 1 || onu < 1 {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "oltId/pon/onu tidak sah"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), oltBindTimeout)
	defer cancel()

	host, driverName, username, password, err := a.lookupOlt(ctx, oltID)
	if errors.Is(err, errOltNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "olt_not_found", Message: "OLT tidak ditemukan atau nonaktif"})
		return
	}
	if err != nil {
		a.logger.Error("ikat TR-069: baca kredensial OLT gagal", "olt", oltID, "error", err.Error())
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal"})
		return
	}

	drv, err := olt.Get(driverName, olt.Config{Host: host, Username: username, Password: password, Timeout: oltBindTimeout})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "driver_unsupported", Message: err.Error()})
		return
	}
	defer drv.Close()

	err = olt.BindOne(ctx, drv, a.store, oltID, olt.OnuRef{Pon: pon, Onu: onu}, a.profileID)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "message": fmt.Sprintf("ONU %d/%d diikat ke profil TR-069", pon, onu),
		})
	case errors.Is(err, olt.ErrTR069ProfileMissing):
		writeJSON(w, http.StatusConflict, errorResponse{
			Error: "profile_missing", Message: "Profil TR-069 belum dibuat di OLT",
		})
	case errors.Is(err, olt.ErrBindRejected):
		a.logger.Warn("ikat TR-069 ditolak OLT", "olt", oltID, "pon", pon, "onu", onu, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "bind_rejected", Message: "OLT menolak perintah ikat"})
	case errors.Is(err, olt.ErrNotSupported):
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "driver_unsupported", Message: err.Error()})
	default:
		if r.Context().Err() != nil {
			return // petugas sudah pergi (timeout/batal); tidak ada yang menerima jawaban
		}
		a.logger.Error("ikat TR-069 gagal", "olt", oltID, "pon", pon, "onu", onu, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "bind_failed"})
	}
}

// reboot melayani POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/reboot: me-reboot SATU ONU lewat CLI OLT
// (onu-reboot onu-id N), untuk modem yang tidak bisa dijangkau GenieACS. Izin dan tiket sama dengan bind.
func (a *OltBindAPI) reboot(w http.ResponseWriter, r *http.Request) {
	identity, ok := identityFrom(r.Context())
	if !ok {
		unauthorized(w)
		return
	}
	if !identity.Can(cpeManagePerm) {
		forbidden(w)
		return
	}

	oltID := r.PathValue("oltId")
	pon, errP := strconv.Atoi(r.PathValue("pon"))
	onu, errO := strconv.Atoi(r.PathValue("onu"))
	if oltID == "" || errP != nil || errO != nil || pon < 1 || onu < 1 {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "oltId/pon/onu tidak sah"})
		return
	}

	key := fmt.Sprintf("%s/%d/%d", oltID, pon, onu)
	if !a.claimReboot(key) {
		writeJSON(w, http.StatusTooManyRequests, errorResponse{Error: "reboot_cooldown", Message: "ONU ini baru saja di-reboot; tunggu sekitar 1 menit sebelum mengulang"})
		return
	}
	rebooted := false
	defer func() {
		if !rebooted {
			a.releaseReboot(key) // gagal sebelum perintah diterima OLT: boleh dicoba lagi
		}
	}()

	ctx, cancel := context.WithTimeout(r.Context(), oltBindTimeout)
	defer cancel()

	host, driverName, username, password, err := a.lookupOlt(ctx, oltID)
	if errors.Is(err, errOltNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "olt_not_found", Message: "OLT tidak ditemukan atau nonaktif"})
		return
	}
	if err != nil {
		a.logger.Error("reboot ONU: baca kredensial OLT gagal", "olt", oltID, "error", err.Error())
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal"})
		return
	}

	drv, err := olt.Get(driverName, olt.Config{Host: host, Username: username, Password: password, Timeout: oltBindTimeout})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "driver_unsupported", Message: err.Error()})
		return
	}
	defer drv.Close()

	err = olt.RebootOne(ctx, drv, olt.OnuRef{Pon: pon, Onu: onu})
	switch {
	case err == nil:
		rebooted = true
		a.logger.Info("ONU di-reboot lewat OLT", "olt", oltID, "pon", pon, "onu", onu, "oleh", identity.UserID)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "message": fmt.Sprintf("Perintah reboot ONU %d/%d diterima OLT", pon, onu),
		})
	case errors.Is(err, olt.ErrRebootRejected):
		a.logger.Warn("reboot ONU ditolak OLT", "olt", oltID, "pon", pon, "onu", onu, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "reboot_rejected", Message: "OLT menolak perintah reboot"})
	case errors.Is(err, olt.ErrNotSupported):
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "driver_unsupported", Message: err.Error()})
	default:
		if r.Context().Err() != nil {
			return // petugas sudah pergi (timeout/batal); tidak ada yang menerima jawaban
		}
		a.logger.Error("reboot ONU gagal", "olt", oltID, "pon", pon, "onu", onu, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "reboot_failed"})
	}
}

type descRequest struct {
	Description string `json:"description"`
}

func (a *OltBindAPI) description(w http.ResponseWriter, r *http.Request) {
	identity, ok := identityFrom(r.Context())
	if !ok {
		unauthorized(w)
		return
	}
	if !identity.Can(cpeManagePerm) {
		forbidden(w)
		return
	}

	oltID := r.PathValue("oltId")
	pon, errP := strconv.Atoi(r.PathValue("pon"))
	onu, errO := strconv.Atoi(r.PathValue("onu"))
	if oltID == "" || errP != nil || errO != nil || pon < 1 || onu < 1 {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "oltId/pon/onu tidak sah"})
		return
	}

	var req descRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Description) == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "bad_request", Message: "deskripsi/nama tidak boleh kosong"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), oltBindTimeout)
	defer cancel()

	host, driverName, username, password, err := a.lookupOlt(ctx, oltID)
	if errors.Is(err, errOltNotFound) {
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "olt_not_found", Message: "OLT tidak ditemukan atau nonaktif"})
		return
	}
	if err != nil {
		a.logger.Error("deskripsi ONU: baca kredensial OLT gagal", "olt", oltID, "error", err.Error())
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal"})
		return
	}

	drv, err := olt.Get(driverName, olt.Config{Host: host, Username: username, Password: password, Timeout: oltBindTimeout})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "driver_unsupported", Message: err.Error()})
		return
	}
	defer drv.Close()

	err = olt.DescribeOne(ctx, drv, olt.OnuRef{Pon: pon, Onu: onu}, req.Description)
	switch {
	case err == nil:
		a.logger.Info("deskripsi ONU diubah di OLT", "olt", oltID, "pon", pon, "onu", onu, "desc", req.Description, "oleh", identity.UserID)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "message": fmt.Sprintf("Deskripsi ONU %d/%d berhasil diubah di OLT", pon, onu), "description": req.Description,
		})
	case errors.Is(err, olt.ErrDescriptionRejected):
		a.logger.Warn("deskripsi ONU ditolak OLT", "olt", oltID, "pon", pon, "onu", onu, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "description_rejected", Message: "OLT menolak perintah deskripsi"})
	case errors.Is(err, olt.ErrNotSupported):
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "driver_unsupported", Message: err.Error()})
	default:
		a.logger.Warn("gagal mengubah deskripsi ONU", "olt", oltID, "pon", pon, "onu", onu, "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "description_failed", Message: err.Error()})
	}
}

var errOltNotFound = errors.New("olt tidak ditemukan atau nonaktif")

func (a *OltBindAPI) lookupOlt(ctx context.Context, oltID string) (host, driverName, username, password string, err error) {
	rows, err := a.db.Query(ctx, oltByIDSQL, oltID)
	if err != nil {
		return "", "", "", "", err
	}
	defer rows.Close()
	var passwordEnc string
	found := false
	for rows.Next() {
		found = true
		if err := rows.Scan(&host, &driverName, &username, &passwordEnc); err != nil {
			return "", "", "", "", err
		}
		break
	}
	if err := rows.Err(); err != nil {
		return "", "", "", "", err
	}
	if !found {
		return "", "", "", "", errOltNotFound
	}
	password, err = collector.DecryptCredential(passwordEnc, a.deviceSecret)
	if err != nil {
		return "", "", "", "", fmt.Errorf("buka kata sandi OLT: %w", err)
	}
	return host, driverName, username, password, nil
}
