package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/scrypt"
	"golang.org/x/text/unicode/norm"
)

// JWTClaims merepresentasikan payload klaim dari JSON Web Token.
type JWTClaims struct {
	UserID string `json:"user_id"`
	Sub    string `json:"sub"`
	Role   string `json:"role"`
	Exp    int64  `json:"exp"`
	Iat    int64  `json:"iat"`
}

// jwtSecret mengembalikan secret untuk penandatanganan JWT. Fail-closed jika JWT_SECRET tidak diisi.
func jwtSecret() ([]byte, error) {
	s := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if s == "" {
		return nil, errors.New("JWT_SECRET tidak diset")
	}
	return []byte(s), nil
}

// GenerateJWT menghasilkan token JWT berbasis HMAC SHA-256 (HS256) untuk userID dan role.
func GenerateJWT(userID, role string) (string, error) {
	if strings.TrimSpace(userID) == "" {
		return "", errors.New("userID tidak boleh kosong")
	}

	secret, err := jwtSecret()
	if err != nil {
		return "", err
	}

	header := map[string]string{
		"alg": "HS256",
		"typ": "JWT",
	}
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", fmt.Errorf("marshal jwt header: %w", err)
	}

	now := time.Now()
	claims := JWTClaims{
		UserID: userID,
		Sub:    userID,
		Role:   role,
		Iat:    now.Unix(),
		Exp:    now.Add(7 * 24 * time.Hour).Unix(), // 7 hari
	}
	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("marshal jwt claims: %w", err)
	}

	headerB64 := base64.RawURLEncoding.EncodeToString(headerJSON)
	claimsB64 := base64.RawURLEncoding.EncodeToString(claimsJSON)
	signingInput := headerB64 + "." + claimsB64

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingInput))
	sigB64 := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return signingInput + "." + sigB64, nil
}

// ParseJWT memvalidasi tanda tangan dan masa berlaku token JWT.
func ParseJWT(tokenString string) (*JWTClaims, error) {
	secret, err := jwtSecret()
	if err != nil {
		return nil, err
	}

	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return nil, errors.New("format token jwt tidak valid")
	}

	signingInput := parts[0] + "." + parts[1]
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("signature jwt tidak valid")
	}

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingInput))
	expectedSig := mac.Sum(nil)
	if subtle.ConstantTimeCompare(sig, expectedSig) != 1 {
		return nil, errors.New("signature jwt tidak cocok")
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("payload jwt tidak valid")
	}

	var claims JWTClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return nil, fmt.Errorf("unmarshal claims: %w", err)
	}

	if claims.Exp > 0 && time.Now().Unix() > claims.Exp {
		return nil, errors.New("token jwt sudah kedaluwarsa")
	}

	if claims.UserID == "" && claims.Sub != "" {
		claims.UserID = claims.Sub
	}

	return &claims, nil
}

// HashPassword membuat bcrypt hash dari kata sandi polos.
func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ComparePassword memverifikasi kecocokan hash password.
// Mendukung bcrypt standar ($2a$, $2b$) dan backward-compatibility hash scrypt Better Auth (salt:key).
func ComparePassword(hash, plain string) error {
	if hash == "" || plain == "" {
		return errors.New("hash atau password kosong")
	}

	// 1. Coba verifikasi bcrypt standar
	if strings.HasPrefix(hash, "$2") {
		return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain))
	}

	// 2. Coba format scrypt Better Auth (saltHex:keyHex)
	// Better Auth: salt adalah string hex 32 karakter (dipakai langsung sebagai slice byte salt),
	// password di-NFKC normalize, parameter: N=16384, r=16, p=1, keyLen=64
	parts := strings.Split(hash, ":")
	if len(parts) == 2 && len(parts[0]) == 32 && len(parts[1]) == 128 {
		salt := []byte(parts[0])
		expectedKey, errKey := hex.DecodeString(parts[1])
		if errKey == nil && len(expectedKey) == 64 {
			normalizedPlain := norm.NFKC.String(plain)
			derivedKey, err := scrypt.Key([]byte(normalizedPlain), salt, 16384, 16, 1, 64)
			if err == nil && subtle.ConstantTimeCompare(derivedKey, expectedKey) == 1 {
				return nil
			}
		}
	}

	// 3. Fallback jika ada hash bcrypt tanpa prefix standar
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err == nil {
		return nil
	}

	return errors.New("password tidak cocok")
}
