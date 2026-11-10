package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

type contextKey string

const (
	UserIDContextKey contextKey = "auth_user_id"
	RoleContextKey   contextKey = "auth_role"
	ClaimsContextKey contextKey = "auth_claims"
)

// AuthMiddleware memvalidasi token JWT dari header "Authorization: Bearer <token>".
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			writeUnauthorized(w, "header Authorization tidak ditemukan")
			return
		}

		scheme, token, found := strings.Cut(authHeader, " ")
		token = strings.TrimSpace(token)
		if !found || !strings.EqualFold(scheme, "Bearer") || token == "" {
			writeUnauthorized(w, "format token Bearer tidak valid")
			return
		}

		claims, err := ParseJWT(token)
		if err != nil {
			writeUnauthorized(w, "token tidak valid atau kedaluwarsa")
			return
		}

		ctx := context.WithValue(r.Context(), UserIDContextKey, claims.UserID)
		ctx = context.WithValue(ctx, RoleContextKey, claims.Role)
		ctx = context.WithValue(ctx, ClaimsContextKey, claims)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// UserIDFromContext mengambil UserID dari context request.
func UserIDFromContext(ctx context.Context) (string, bool) {
	val, ok := ctx.Value(UserIDContextKey).(string)
	return val, ok && val != ""
}

// RoleFromContext mengambil Role pengguna dari context request.
func RoleFromContext(ctx context.Context) (string, bool) {
	val, ok := ctx.Value(RoleContextKey).(string)
	return val, ok
}

// ClaimsFromContext mengambil JWTClaims lengkap dari context request.
func ClaimsFromContext(ctx context.Context) (*JWTClaims, bool) {
	val, ok := ctx.Value(ClaimsContextKey).(*JWTClaims)
	return val, ok && val != nil
}

func writeUnauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("WWW-Authenticate", "Bearer")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error":   "unauthorized",
		"message": message,
	})
}
