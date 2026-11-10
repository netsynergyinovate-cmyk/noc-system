package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/store"
)
// AuthAPI menangani autentikasi berbasis JWT di backend Go.
type AuthAPI struct {
	users   *store.UserStore
	limiter *loginRateLimiter
}

type loginAttempt struct {
	count     int
	resetTime time.Time
}

type loginRateLimiter struct {
	mu       sync.Mutex
	attempts map[string]*loginAttempt
}

func newLoginRateLimiter() *loginRateLimiter {
	return &loginRateLimiter{attempts: make(map[string]*loginAttempt)}
}

func (l *loginRateLimiter) checkAndRecord(key string, limit int, window time.Duration) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	att, exists := l.attempts[key]
	if !exists || now.After(att.resetTime) {
		l.attempts[key] = &loginAttempt{count: 1, resetTime: now.Add(window)}
		return true, 0
	}
	if att.count >= limit {
		remaining := int(time.Until(att.resetTime).Seconds())
		if remaining < 1 {
			remaining = 1
		}
		return false, remaining
	}
	att.count++
	return true, 0
}

func (l *loginRateLimiter) reset(keys ...string) {
	l.mu.Lock()
	for _, k := range keys {
		delete(l.attempts, k)
	}
	l.mu.Unlock()
}

// NewAuthAPI membuat instance handler AuthAPI baru.
func NewAuthAPI(users *store.UserStore) *AuthAPI {
	return &AuthAPI{
		users:   users,
		limiter: newLoginRateLimiter(),
	}
}
// Register mendaftarkan route autentikasi ke mux.
func (a *AuthAPI) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/login", a.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/logout", a.handleLogout)
	mux.HandleFunc("GET /api/v1/auth/me", a.handleMe)
	mux.HandleFunc("POST /api/v1/auth/register", a.handleRegister)
	mux.HandleFunc("POST /api/v1/auth/change-password", a.handleChangePassword)
	mux.HandleFunc("POST /api/v1/auth/admin/set-user-password", a.handleAdminSetUserPassword)
	mux.HandleFunc("POST /api/v1/auth/admin/create-user", a.handleAdminCreateUser)
	mux.HandleFunc("GET /api/v1/auth/github", a.handleGithubLogin)
	mux.HandleFunc("GET /api/v1/auth/github/callback", a.handleGithubCallback)
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

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	clientIP := host
	if err != nil || clientIP == "" {
		clientIP = r.RemoteAddr
	}
	ipKey := "ip:" + clientIP
	userKey := "user:" + strings.ToLower(req.Username)
	if ok, waitSec := a.limiter.checkAndRecord(ipKey, 5, 60*time.Second); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(waitSec))
		w.Header().Set("X-Retry-After", strconv.Itoa(waitSec))
		writeJSON(w, http.StatusTooManyRequests, errorResponse{Error: "too_many_requests", Message: fmt.Sprintf("Terlalu banyak percobaan masuk. Tunggu %d detik.", waitSec)})
		return
	}
	if ok, waitSec := a.limiter.checkAndRecord(userKey, 5, 60*time.Second); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(waitSec))
		w.Header().Set("X-Retry-After", strconv.Itoa(waitSec))
		writeJSON(w, http.StatusTooManyRequests, errorResponse{Error: "too_many_requests", Message: fmt.Sprintf("Terlalu banyak percobaan masuk. Tunggu %d detik.", waitSec)})
		return
	}

	if a.users == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: "database_unavailable", Message: "Layanan database pengguna belum siap"})
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
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error", Message: "Gagal memproses token autentikasi"})
		return
	}

	a.limiter.reset(ipKey, userKey)

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

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (a *AuthAPI) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	if a.users == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: "database_unavailable", Message: "Layanan database belum siap"})
		return
	}
	userID, ok := a.getUserIDFromReq(r)
	if !ok || userID == "" {
		unauthorized(w)
		return
	}
	var req changePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.NewPassword) < 8 {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "Kata sandi baru minimal 8 karakter"})
		return
	}
	u, err := a.users.GetUserByID(r.Context(), userID)
	if err != nil {
		unauthorized(w)
		return
	}
	if err := auth.ComparePassword(u.Password, req.CurrentPassword); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_current_password", Message: "Kata sandi saat ini salah"})
		return
	}
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error", Message: "Gagal memproses kata sandi"})
		return
	}
	if err := a.users.SetPassword(r.Context(), userID, newHash); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error", Message: "Gagal menyimpan kata sandi"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Kata sandi berhasil diperbarui"})
}

type adminSetPasswordRequest struct {
	UserID      string `json:"userId"`
	NewPassword string `json:"newPassword"`
}

func (a *AuthAPI) handleAdminSetUserPassword(w http.ResponseWriter, r *http.Request) {
	if a.users == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: "database_unavailable", Message: "Layanan database belum siap"})
		return
	}
	_, role, ok := a.getUserAndRoleFromReq(r)
	if !ok || (role != "superadmin" && role != "admin") {
		forbidden(w)
		return
	}
	var req adminSetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" || len(req.NewPassword) < 8 {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "ID user dan kata sandi baru (min 8 karakter) wajib diisi"})
		return
	}
	targetUser, err := a.users.GetUserByID(r.Context(), req.UserID)
	if err != nil {
		if errors.Is(err, store.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, errorResponse{Error: "not_found", Message: "Pengguna tidak ditemukan"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "database_error", Message: "Gagal memeriksa pengguna"})
		return
	}
	callerIsSuper := strings.Contains(role, "superadmin")
	targetIsSuper := strings.Contains(targetUser.Role, "superadmin")
	if targetIsSuper && !callerIsSuper {
		writeJSON(w, http.StatusForbidden, errorResponse{Error: "forbidden", Message: "Hanya Super Admin yang dapat mengubah sandi Super Admin"})
		return
	}
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error", Message: "Gagal memproses kata sandi"})
		return
	}
	if err := a.users.SetPassword(r.Context(), req.UserID, newHash); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error", Message: "Gagal menyimpan kata sandi"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Kata sandi user berhasil diubah"})
}

type adminCreateUserRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (a *AuthAPI) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	if a.users == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: "database_unavailable", Message: "Layanan database belum siap"})
		return
	}
	_, role, ok := a.getUserAndRoleFromReq(r)
	if !ok || (role != "superadmin" && role != "admin") {
		forbidden(w)
		return
	}
	var req adminCreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" || len(req.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "Email dan kata sandi (min 8 karakter) wajib diisi"})
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error", Message: "Gagal memproses kata sandi"})
		return
	}
	callerIsSuper := strings.Contains(role, "superadmin")
	if req.Role == "" {
		req.Role = "user"
	}
	if req.Role != "user" && !callerIsSuper {
		writeJSON(w, http.StatusForbidden, errorResponse{Error: "forbidden", Message: "Hanya Super Admin yang dapat menentukan peran selain Petugas"})
		return
	}
	u := &store.User{
		Username: req.Name,
		Email:    req.Email,
		Password: hash,
		Role:     req.Role,
	}
	if err := a.users.CreateUser(r.Context(), u); err != nil {
		if errors.Is(err, store.ErrEmailExists) {
			writeJSON(w, http.StatusConflict, errorResponse{Error: "email_exists", Message: "Email sudah terdaftar"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error", Message: "Gagal membuat akun"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

type registerRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (a *AuthAPI) handleRegister(w http.ResponseWriter, r *http.Request) {
	if strings.ToLower(strings.TrimSpace(os.Getenv("ALLOW_SIGN_UP"))) != "true" {
		writeJSON(w, http.StatusForbidden, errorResponse{Error: "registration_disabled", Message: "Pendaftaran akun publik dimatikan"})
		return
	}
	if a.users == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: "database_unavailable", Message: "Layanan database belum siap"})
		return
	}
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" || len(req.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid_request", Message: "Email dan kata sandi minimal 8 karakter wajib diisi"})
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error", Message: "Gagal memproses kata sandi"})
		return
	}
	u := &store.User{
		Username: req.Name,
		Email:    req.Email,
		Password: hash,
		Role:     "user",
	}
	if err := a.users.CreateUser(r.Context(), u); err != nil {
		if errors.Is(err, store.ErrEmailExists) {
			writeJSON(w, http.StatusConflict, errorResponse{Error: "email_exists", Message: "Email sudah terdaftar, gunakan email lain"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal_error", Message: "Gagal mendaftar"})
		return
	}
	token, _ := auth.GenerateJWT(u.ID, u.Role)
	writeJSON(w, http.StatusOK, loginResponse{Token: token, User: userInfoDTO{ID: u.ID, Username: u.Username, Email: u.Email, Role: u.Role}})
}

func (a *AuthAPI) getUserIDFromReq(r *http.Request) (string, bool) {
	id, _, ok := a.getUserAndRoleFromReq(r)
	return id, ok
}

func (a *AuthAPI) getUserAndRoleFromReq(r *http.Request) (string, string, bool) {
	if id, ok := auth.UserIDFromContext(r.Context()); ok {
		role, _ := auth.RoleFromContext(r.Context())
		return id, role, true
	}
	authHeader := r.Header.Get("Authorization")
	scheme, token, found := strings.Cut(authHeader, " ")
	if found && strings.EqualFold(scheme, "Bearer") && strings.TrimSpace(token) != "" {
		if claims, err := auth.ParseJWT(strings.TrimSpace(token)); err == nil {
			return claims.UserID, claims.Role, true
		}
	}
	return "", "", false
}

type oauthState struct {
	Timestamp int64  `json:"ts"`
	Frontend  string `json:"frontend"`
}

func (a *AuthAPI) getFrontendURL(r *http.Request) string {
	for _, envKey := range []string{"APP_URL", "NEXT_PUBLIC_APP_URL", "BETTER_AUTH_URL"} {
		if val := strings.TrimSpace(os.Getenv(envKey)); val != "" {
			return strings.TrimRight(val, "/")
		}
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	if host := r.Header.Get("X-Forwarded-Host"); host != "" {
		return fmt.Sprintf("%s://%s", scheme, host)
	}
	if r.Host != "" {
		return fmt.Sprintf("%s://%s", scheme, r.Host)
	}
	return "http://localhost:3001"
}

func (a *AuthAPI) getBackendURL(r *http.Request) string {
	if val := strings.TrimSpace(os.Getenv("BACKEND_URL")); val != "" {
		return strings.TrimRight(val, "/")
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := r.Host
	if fHost := r.Header.Get("X-Forwarded-Host"); fHost != "" {
		host = fHost
	}
	return fmt.Sprintf("%s://%s", scheme, host)
}

func (a *AuthAPI) handleGithubLogin(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID"))
	frontendURL := a.getFrontendURL(r)
	if clientID == "" {
		http.Redirect(w, r, frontendURL+"/sign-in?error=github_not_configured", http.StatusTemporaryRedirect)
		return
	}

	redirectURI := strings.TrimSpace(os.Getenv("GITHUB_REDIRECT_URI"))
	if redirectURI == "" {
		redirectURI = a.getBackendURL(r) + "/api/v1/auth/github/callback"
	}
	stateData, _ := json.Marshal(oauthState{
		Timestamp: time.Now().Unix(),
		Frontend:  frontendURL,
	})
	secret := os.Getenv("JWT_SECRET")
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(stateData)
	sig := hex.EncodeToString(mac.Sum(nil))
	state := hex.EncodeToString(stateData) + "." + sig

	u, _ := url.Parse("https://github.com/login/oauth/authorize")
	q := u.Query()
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", "read:user,user:email")
	q.Set("state", state)
	u.RawQuery = q.Encode()

	http.Redirect(w, r, u.String(), http.StatusTemporaryRedirect)
}

func (a *AuthAPI) handleGithubCallback(w http.ResponseWriter, r *http.Request) {
	fallbackURL := a.getFrontendURL(r)
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")

	if code == "" || state == "" {
		http.Redirect(w, r, fallbackURL+"/sign-in?error=github_cancelled", http.StatusTemporaryRedirect)
		return
	}

	parts := strings.Split(state, ".")
	if len(parts) != 2 {
		http.Redirect(w, r, fallbackURL+"/sign-in?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}

	dataBytes, err := hex.DecodeString(parts[0])
	if err != nil {
		http.Redirect(w, r, fallbackURL+"/sign-in?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}

	secret := os.Getenv("JWT_SECRET")
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(dataBytes)
	expectedSig := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(parts[1]), []byte(expectedSig)) {
		http.Redirect(w, r, fallbackURL+"/sign-in?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}

	var st oauthState
	if err := json.Unmarshal(dataBytes, &st); err != nil {
		http.Redirect(w, r, fallbackURL+"/sign-in?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}
	frontendURL := st.Frontend
	if frontendURL == "" {
		frontendURL = fallbackURL
	}

	if time.Since(time.Unix(st.Timestamp, 0)) > 10*time.Minute {
		http.Redirect(w, r, frontendURL+"/sign-in?error=state_expired", http.StatusTemporaryRedirect)
		return
	}

	clientID := strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("GITHUB_CLIENT_SECRET"))
	redirectURI := strings.TrimSpace(os.Getenv("GITHUB_REDIRECT_URI"))
	if redirectURI == "" {
		redirectURI = a.getBackendURL(r) + "/api/v1/auth/github/callback"
	}

	tokenForm := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(tokenForm.Encode()))
	if err != nil {
		http.Redirect(w, r, frontendURL+"/sign-in?error=github_exchange_failed", http.StatusTemporaryRedirect)
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		http.Redirect(w, r, frontendURL+"/sign-in?error=github_exchange_failed", http.StatusTemporaryRedirect)
		return
	}
	defer resp.Body.Close()

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil || tokenResp.AccessToken == "" {
		http.Redirect(w, r, frontendURL+"/sign-in?error=github_token_empty", http.StatusTemporaryRedirect)
		return
	}

	userReq, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		http.Redirect(w, r, frontendURL+"/sign-in?error=github_user_failed", http.StatusTemporaryRedirect)
		return
	}
	userReq.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)
	userReq.Header.Set("User-Agent", "NOC-System")

	userResp, err := client.Do(userReq)
	if err != nil || userResp.StatusCode != http.StatusOK {
		http.Redirect(w, r, frontendURL+"/sign-in?error=github_user_failed", http.StatusTemporaryRedirect)
		return
	}
	defer userResp.Body.Close()

	var ghUser struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := json.NewDecoder(userResp.Body).Decode(&ghUser); err != nil || ghUser.ID == 0 {
		http.Redirect(w, r, frontendURL+"/sign-in?error=github_profile_invalid", http.StatusTemporaryRedirect)
		return
	}

	email := strings.TrimSpace(ghUser.Email)
	emailVerified := false

	emailsReq, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://api.github.com/user/emails", nil)
	if err == nil {
		emailsReq.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)
		emailsReq.Header.Set("User-Agent", "NOC-System")
		if emailsResp, err := client.Do(emailsReq); err == nil && emailsResp.StatusCode == http.StatusOK {
			defer emailsResp.Body.Close()
			var emails []struct {
				Email    string `json:"email"`
				Primary  bool   `json:"primary"`
				Verified bool   `json:"verified"`
			}
			if err := json.NewDecoder(emailsResp.Body).Decode(&emails); err == nil {
				for _, e := range emails {
					if e.Verified && (e.Primary || email == "") {
						email = strings.TrimSpace(e.Email)
						emailVerified = true
						if e.Primary {
							break
						}
					}
				}
			}
		}
	}

	name := strings.TrimSpace(ghUser.Name)
	if name == "" {
		name = ghUser.Login
	}

	if a.users == nil {
		http.Redirect(w, r, frontendURL+"/sign-in?error=database_unavailable", http.StatusTemporaryRedirect)
		return
	}

	u, err := a.users.FindOrCreateOAuthUser(r.Context(), "github", strconv.FormatInt(ghUser.ID, 10), email, name, emailVerified)
	if err != nil {
		http.Redirect(w, r, frontendURL+"/sign-in?error="+url.QueryEscape(err.Error()), http.StatusTemporaryRedirect)
		return
	}

	if u.IsBanned() {
		http.Redirect(w, r, frontendURL+"/sign-in?error=user_banned", http.StatusTemporaryRedirect)
		return
	}

	token, err := auth.GenerateJWT(u.ID, u.Role)
	if err != nil {
		http.Redirect(w, r, frontendURL+"/sign-in?error=internal_error", http.StatusTemporaryRedirect)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "noc_token",
		Value:    token,
		Path:     "/",
		MaxAge:   604800,
		SameSite: http.SameSiteLaxMode,
	})

	http.Redirect(w, r, frontendURL+"/auth/callback", http.StatusTemporaryRedirect)
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
