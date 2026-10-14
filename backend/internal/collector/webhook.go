package collector

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/state"
)

const maxWebhookBody = 4096

// WebhookOptions mengatur handler webhook PPP.
type WebhookOptions struct {
	// Token adalah rahasia yang dikirim router di header. Minimal
	// auth.MinSecretLength karakter.
	Token    string
	Presence Presence
	// Notify dipanggil saat status pelanggan berubah (mis. Hub.NotifyChange).
	Notify func(state.Change)
	Logger *slog.Logger
}

type webhookHandler struct {
	tokenHash [sha256.Size]byte
	presence  Presence
	notify    func(state.Change)
	logger    *slog.Logger
}

// NewWebhookHandler membuat handler untuk script PPP on-up/on-down di router,
// misalnya:
//
//	/tool fetch url="http://<backend>/hooks/ppp" http-method=post \
//	  http-header-field="X-Webhook-Token: <token>" \
//	  http-data="event=up&user=$user" keep-result=no
//
// Parameter: event ("up" atau "down"), user (username PPPoE), dan router
// (opsional; id router, diperiksa terhadap router pemilik pelanggan). Boleh
// dikirim sebagai query (GET), form (POST), atau JSON.
//
// Token hanya diterima lewat header, tidak lewat query, agar tidak masuk log
// akses proxy. Satu token dipakai bersama semua router, jadi router yang
// bocor tokennya bisa memalsukan status pelanggan mana pun; kolom router bukan
// pengamanan karena diisi pengirim.
func NewWebhookHandler(opts WebhookOptions) (http.Handler, error) {
	if len(opts.Token) < auth.MinSecretLength {
		return nil, fmt.Errorf("collector: token webhook minimal %d karakter", auth.MinSecretLength)
	}
	if opts.Presence == nil || opts.Logger == nil {
		return nil, errors.New("collector: Presence dan Logger wajib diisi")
	}
	return &webhookHandler{
		tokenHash: sha256.Sum256([]byte(opts.Token)),
		presence:  opts.Presence,
		notify:    opts.Notify,
		logger:    opts.Logger,
	}, nil
}

type webhookRequest struct {
	Event  string `json:"event"`
	User   string `json:"user"`
	Router string `json:"router"`
}

func (h *webhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "")
		return
	}
	if !h.authorized(r) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		writeError(w, http.StatusUnauthorized, "unauthorized", "")
		return
	}

	req, err := parseWebhook(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	change, result := applyPPPEvent(h.presence, h.notify, PPPEvent{User: req.User, Online: req.Event == "up"}, req.Router)
	switch result {
	case resultUnknownCustomer:
		// Tidak ada pelanggan dengan username ini; router tidak perlu mencoba ulang.
		writeError(w, http.StatusNotFound, "unknown_customer", "")
	case resultRouterMismatch:
		writeError(w, http.StatusConflict, "router_mismatch", "pelanggan ini bukan milik router yang disebut")
	default:
		if change.Changed() {
			h.logger.Info("status pelanggan berubah lewat webhook", "user", req.User, "online", req.Event == "up")
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "changed": change.Changed()})
	}
}

// authorized membandingkan hash token dalam waktu tetap, sehingga panjang dan
// isi token tidak bisa ditebak dari lamanya jawaban.
func (h *webhookHandler) authorized(r *http.Request) bool {
	presented := r.Header.Get("X-Webhook-Token")
	if presented == "" {
		if scheme, token, found := strings.Cut(r.Header.Get("Authorization"), " "); found && strings.EqualFold(scheme, "Bearer") {
			presented = strings.TrimSpace(token)
		}
	}
	if presented == "" {
		return false
	}
	hash := sha256.Sum256([]byte(presented))
	return subtle.ConstantTimeCompare(hash[:], h.tokenHash[:]) == 1
}

func parseWebhook(w http.ResponseWriter, r *http.Request) (webhookRequest, error) {
	var req webhookRequest
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxWebhookBody))
	if err != nil {
		return req, errors.New("isi permintaan terlalu besar atau tidak terbaca")
	}

	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			return req, errors.New("isi JSON tidak valid")
		}
	} else {
		// Query dan isi POST dibaca sebagai urlencoded apa pun Content-Type-nya,
		// karena script di router tidak selalu mengirim header itu.
		values := r.URL.Query()
		bodyValues, err := url.ParseQuery(string(body))
		if err != nil {
			return req, errors.New("isi form tidak valid")
		}
		for key, list := range bodyValues {
			values[key] = append(values[key], list...)
		}
		for key, list := range values {
			if key != "event" && key != "user" && key != "router" {
				return req, fmt.Errorf("parameter %q tidak dikenal", key)
			}
			if len(list) > 1 {
				return req, fmt.Errorf("parameter %q diulang", key)
			}
		}
		req = webhookRequest{Event: values.Get("event"), User: values.Get("user"), Router: values.Get("router")}
	}

	if req.Event != "up" && req.Event != "down" {
		return req, errors.New(`event harus "up" atau "down"`)
	}
	if !validUser(req.User) {
		return req, errors.New("user kosong, terlalu panjang, atau memuat karakter yang tidak diizinkan")
	}
	if req.Router != "" && !validUser(req.Router) {
		return req, errors.New("router memuat karakter yang tidak diizinkan")
	}
	return req, nil
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	body := map[string]string{"error": code}
	if message != "" {
		body["message"] = message
	}
	_ = json.NewEncoder(w).Encode(body)
}
