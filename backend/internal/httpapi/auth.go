package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/store"
)

// AuthAPI menangani autentikasi berbasis JWT di backend Go.
type AuthAPI struct {
	users *store.UserStore
}

// NewAuthAPI membuat instance handler AuthAPI baru.
func NewAuthAPI(users *store.UserStore) *AuthAPI {
	return &AuthAPI{users: users}
}

// Register mendaftarkan route autentikasi ke mux.
func (a *AuthAPI) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/login", a.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/logout", a.handleLogout)
	mux.HandleFunc("GET /api/v1/auth/me", a.handleMe)
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token string      `json:"token"`
	User  userInfoDTO `json:"user"`
}

type userInfoDTO struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email,omitempty"`
	Role     string `json:"role"`
}

func (a *AuthAPI) handleLogin(w http.ResponseWriter, r *http.Request) {
	if a.users == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: "database_unavailable", Message: "Layanan database pengguna belum siap"})
		return
	}

	var req loginRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "Format json request tidak valid"})
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "Username dan password wajib diisi"})
		return
	}

	u, err := a.users.GetUserByUsername(r.Context(), req.Username)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "invalid_credentials", Message: "Username atau password salah"})
		return
	}

	if err := auth.ComparePassword(u.Password, req.Password); err != nil {
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "invalid_credentials", Message: "Username atau password salah"})
		return
	}

	if u.IsBanned() {
		writeJSON(w, http.StatusForbidden, errorResponse{Error: "user_banned", Message: "Akun ini telah ditangguhkan"})
		return
	}

	token, err := auth.GenerateJWT(u.ID, u.Role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "token_generation_failed", Message: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, loginResponse{
		Token: token,
		User: userInfoDTO{
			ID:       u.ID,
			Username: u.Username,
			Email:    u.Email,
			Role:     u.Role,
		},
	})
}

func (a *AuthAPI) handleLogout(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"message": "berhasil logout",
	})
}

func (a *AuthAPI) handleMe(w http.ResponseWriter, r *http.Request) {
	// 1. Coba ambil dari context (bila lewat AuthMiddleware)
	userID, ok := auth.UserIDFromContext(r.Context())
	userRole, _ := auth.RoleFromContext(r.Context())

	// 2. Cek token langsung bila route dipanggil tanpa middleware
	if !ok {
		authHeader := r.Header.Get("Authorization")
		scheme, token, found := strings.Cut(authHeader, " ")
		token = strings.TrimSpace(token)
		if found && strings.EqualFold(scheme, "Bearer") && token != "" {
			if claims, err := auth.ParseJWT(token); err == nil {
				userID = claims.UserID
				userRole = claims.Role
				ok = true
			}
		}
	}

	if !ok || userID == "" {
		unauthorized(w)
		return
	}

	if a.users != nil {
		u, err := a.users.GetUserByID(r.Context(), userID)
		if err != nil {
			if errors.Is(err, store.ErrNoRows) {
				unauthorized(w)
				return
			}
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "database_error", Message: "Gagal mengambil data user"})
			return
		}
		if u.IsBanned() {
			writeJSON(w, http.StatusForbidden, errorResponse{Error: "user_banned", Message: "Akun ini telah ditangguhkan"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"user": userInfoDTO{
				ID:       u.ID,
				Username: u.Username,
				Email:    u.Email,
				Role:     u.Role,
			},
		})
		return
	}

	// Fallback ke data dari klaim token
	writeJSON(w, http.StatusOK, map[string]any{
		"user": userInfoDTO{
			ID:       userID,
			Username: userID,
			Role:     userRole,
		},
	})
}

// requireTicket menolak permintaan tanpa tiket login yang sah di header
// "Authorization: Bearer <tiket>". Tiket yang sama dengan untuk WebSocket;
// tiket tidak sekali pakai, berlaku sampai waktu kedaluwarsanya. Tiket yang
// sah cukup untuk MEMBACA; rute yang mengubah data memakai requirePerm.
func requireTicket(verifier auth.Verifier, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := verifyBearer(verifier, r)
		if !ok {
			unauthorized(w)
			return
		}
		next.ServeHTTP(w, r.WithContext(withIdentity(r.Context(), identity)))
	})
}

// requirePerm seperti requireTicket, tetapi tiketnya juga harus membawa izin
// perm (mis. "alert:handle"). Dipasang pada rute yang MENGUBAH data.
func requirePerm(verifier auth.Verifier, perm string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := verifyBearer(verifier, r)
		if !ok {
			unauthorized(w)
			return
		}
		if !identity.Can(perm) {
			forbidden(w)
			return
		}
		next.ServeHTTP(w, r.WithContext(withIdentity(r.Context(), identity)))
	})
}

// verifyBearer membaca "Authorization: Bearer <tiket>" dan memeriksanya.
func verifyBearer(verifier auth.Verifier, r *http.Request) (auth.Identity, bool) {
	scheme, token, found := strings.Cut(r.Header.Get("Authorization"), " ")
	token = strings.TrimSpace(token)
	if !found || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return auth.Identity{}, false
	}
	identity, err := verifier.Verify(token, time.Now())
	if err != nil {
		return auth.Identity{}, false
	}
	return identity, true
}

type identityKey struct{}

func withIdentity(ctx context.Context, identity auth.Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, identity)
}

// identityFrom mengambil pengguna yang sudah diverifikasi requireTicket atau requirePerm.
func identityFrom(ctx context.Context) (auth.Identity, bool) {
	identity, ok := ctx.Value(identityKey{}).(auth.Identity)
	return identity, ok
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
}

func forbidden(w http.ResponseWriter) {
	writeJSON(w, http.StatusForbidden, errorResponse{Error: "forbidden"})
}
