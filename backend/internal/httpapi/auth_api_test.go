package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"noc-isp/backend/internal/auth"
	"noc-isp/backend/internal/store"
)

// mockUserStore implements minimum store interface behavior for tests.
type mockUserStore struct {
	users map[string]*store.User
}

func (m *mockUserStore) GetUserByUsername(_ context.Context, username string) (*store.User, error) {
	u, ok := m.users[username]
	if !ok {
		return nil, store.ErrNoRows // or error
	}
	return u, nil
}

func TestAuthAPILoginLogoutMe(t *testing.T) {
	os.Setenv("JWT_SECRET", "super_secret_jwt_key_for_noc_system_auth_api_test_123")
	defer os.Unsetenv("JWT_SECRET")

	hash, err := auth.HashPassword("TestPass123!")
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}

	mockUser := &store.User{
		ID:       "user-001",
		Username: "admin-utama@noc.local",
		Email:    "admin-utama@noc.local",
		Password: hash,
		Role:     "admin",
	}

	authAPI := NewAuthAPI(nil)
	mux := http.NewServeMux()
	authAPI.Register(mux)

	// 1. Database unavailable when store is nil
	loginBody, _ := json.Marshal(map[string]string{
		"username": "admin-utama@noc.local",
		"password": "TestPass123!",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginBody))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when store is nil, got %d", rec.Code)
	}

	// 2. Test with real UserStore struct or mock via HTTP endpoints
	// Let's test Logout
	reqLogout := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	recLogout := httptest.NewRecorder()
	mux.ServeHTTP(recLogout, reqLogout)
	if recLogout.Code != http.StatusOK {
		t.Fatalf("expected 200 on logout, got %d", recLogout.Code)
	}

	// 3. Test Me with valid JWT
	validToken, err := auth.GenerateJWT(mockUser.ID, mockUser.Role)
	if err != nil {
		t.Fatalf("GenerateJWT failed: %v", err)
	}

	reqMe := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	reqMe.Header.Set("Authorization", "Bearer "+validToken)
	recMe := httptest.NewRecorder()
	mux.ServeHTTP(recMe, reqMe)
	if recMe.Code != http.StatusOK {
		t.Fatalf("expected 200 on /me with valid token, got %d: %s", recMe.Code, recMe.Body.String())
	}

	var meResp struct {
		User userInfoDTO `json:"user"`
	}
	if err := json.Unmarshal(recMe.Body.Bytes(), &meResp); err != nil {
		t.Fatalf("unmarshal me response: %v", err)
	}
	if meResp.User.ID != mockUser.ID {
		t.Errorf("expected user ID %s, got %s", mockUser.ID, meResp.User.ID)
	}
	if meResp.User.Role != mockUser.Role {
		t.Errorf("expected role %s, got %s", mockUser.Role, meResp.User.Role)
	}

	// 4. Test Me with invalid or missing token
	reqMeBad := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	recMeBad := httptest.NewRecorder()
	mux.ServeHTTP(recMeBad, reqMeBad)
	if recMeBad.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on /me without token, got %d", recMeBad.Code)
	}
}

func TestAuthAPIRateLimiter(t *testing.T) {
	os.Setenv("JWT_SECRET", "test_jwt_secret_for_rate_limiter_123456")
	defer os.Unsetenv("JWT_SECRET")

	authAPI := NewAuthAPI(nil)
	mux := http.NewServeMux()
	authAPI.Register(mux)

	for range 5 {
		body, _ := json.Marshal(map[string]string{"username": "spam@noc.local", "password": "wrong"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
		req.RemoteAddr = "192.168.1.100:1234"
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
	}

	// 6th attempt should be blocked by rate limiter
	body, _ := json.Marshal(map[string]string{"username": "spam@noc.local", "password": "wrong"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.RemoteAddr = "192.168.1.100:1234"
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Errorf("expected Retry-After header to be set")
	}
}
