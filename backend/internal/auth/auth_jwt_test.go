package auth

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestJWTGenerationAndParsing(t *testing.T) {
	// 1. Fail closed when JWT_SECRET unset
	os.Unsetenv("JWT_SECRET")
	if _, err := GenerateJWT("user-1", "admin"); err == nil {
		t.Fatal("GenerateJWT should fail when JWT_SECRET is unset")
	}

	// 2. Success with secret
	os.Setenv("JWT_SECRET", "super_secret_jwt_key_for_noc_system_testing_123")
	defer os.Unsetenv("JWT_SECRET")

	token, err := GenerateJWT("user-123", "superadmin")
	if err != nil {
		t.Fatalf("GenerateJWT failed: %v", err)
	}
	if token == "" {
		t.Fatal("token is empty")
	}

	claims, err := ParseJWT(token)
	if err != nil {
		t.Fatalf("ParseJWT failed: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Errorf("expected userID 'user-123', got '%s'", claims.UserID)
	}
	if claims.Role != "superadmin" {
		t.Errorf("expected role 'superadmin', got '%s'", claims.Role)
	}
}

func TestComparePasswordBcryptAndScrypt(t *testing.T) {
	// 1. Bcrypt test
	plain := "SecretPass123!"
	bcryptHash, err := HashPassword(plain)
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}
	if err := ComparePassword(bcryptHash, plain); err != nil {
		t.Fatalf("ComparePassword failed on bcrypt: %v", err)
	}
	if err := ComparePassword(bcryptHash, "WrongPassword"); err == nil {
		t.Fatal("ComparePassword should fail on wrong bcrypt password")
	}

	// 2. Better Auth scrypt fixture test (Admin1234!)
	scryptFixture := "e659a2d826465b2f1968cbc2ed4b557a:22ae2af696b35aff28b085e26e8df7d2a73c676214d23afb07b80248fc85e2bc6631ddc0d29b7dae318abf8de6bd4a075a4958b1c03ef01ea42564a8e8341bee"
	if err := ComparePassword(scryptFixture, "Admin1234!"); err != nil {
		t.Fatalf("ComparePassword failed on Better Auth scrypt fixture: %v", err)
	}
	if err := ComparePassword(scryptFixture, "WrongPass!"); err == nil {
		t.Fatal("ComparePassword should fail on wrong password for scrypt fixture")
	}
}

func TestAuthMiddleware(t *testing.T) {
	os.Setenv("JWT_SECRET", "super_secret_jwt_key_for_noc_system_testing_123")
	defer os.Unsetenv("JWT_SECRET")

	token, err := GenerateJWT("user-abc", "operator")
	if err != nil {
		t.Fatalf("GenerateJWT: %v", err)
	}

	var capturedUserID, capturedRole string
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID, _ = UserIDFromContext(r.Context())
		capturedRole, _ = RoleFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	mw := AuthMiddleware(dummyHandler)

	// Missing header -> 401
	req1 := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec1 := httptest.NewRecorder()
	mw.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for missing header, got %d", rec1.Code)
	}

	// Valid token -> 200 and context populated
	req2 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req2.Header.Set("Authorization", "Bearer "+token)
	rec2 := httptest.NewRecorder()
	mw.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Errorf("expected 200 for valid token, got %d", rec2.Code)
	}
	if capturedUserID != "user-abc" || capturedRole != "operator" {
		t.Errorf("unexpected context: userID=%s, role=%s", capturedUserID, capturedRole)
	}
}
