package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
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
// (tombol "Daftarkan ke GenieACS" di aplikasi). Ini SATU-SATUNYA endpoint REST
// yang menulis ke OLT; semua endpoint lain di bawah /api/v1/ hanya membaca.
type OltBindAPI struct {
	db           collector.Querier
	deviceSecret string
	// profileID: id profil TR-069 yang sudah dibuat operator di OLT (lihat
	// OLT_TR069_PROFILE_ID). Backend tidak pernah membuat profil sendiri.
	profileID int
	store     olt.BindStore
	logger    *slog.Logger
}

// NewOltBindAPI membuat handler. db dipakai HANYA untuk membaca kredensial OLT
// (host/username/password_enc); deviceSecret membukanya, sama dengan polling.
func NewOltBindAPI(db collector.Querier, deviceSecret string, profileID int, store olt.BindStore, logger *slog.Logger) *OltBindAPI {
	return &OltBindAPI{db: db, deviceSecret: deviceSecret, profileID: profileID, store: store, logger: logger}
}

func (a *OltBindAPI) register(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/tr069-bind", http.HandlerFunc(a.bind))
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
