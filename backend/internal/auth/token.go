// Package auth memverifikasi tiket singkat yang membuktikan pemegangnya sudah
// login di aplikasi Next.js. Next.js (yang memegang sesi Better Auth) menerbitkan
// tiket; backend Go hanya memeriksanya, jadi keduanya cukup berbagi satu rahasia.
//
// Format tiket: base64url(payload) + "." + base64url(HMAC-SHA256(rahasia, payload)),
// dengan payload JSON {"sub":"<id pengguna>","exp":<detik unix>,"perms":["alert:handle"]}.
//
// "perms" (opsional, daftar "resource:aksi") adalah izin MENGUBAH data yang
// dimiliki pemegang tiket. Ia ikut ditandatangani, jadi tidak bisa ditambah
// klien. Tiket tanpa "perms" tetap sah dan hanya boleh membaca. Next.js
// menghitungnya dari peran asli akun saat tiket diterbitkan dan tiket berlaku
// 60 detik, sehingga pencabutan peran paling lama baru terasa di sini 60 detik
// kemudian.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

// MinSecretLength adalah panjang minimum rahasia. 32 karakter setara 256 bit
// bila dibuat acak, sama dengan ukuran kunci HMAC-SHA256.
const MinSecretLength = 32

// MaxTokenLifetime membatasi umur tiket yang masih diterima. Tiket hanya dipakai
// sekali saat membuka koneksi, jadi umurnya harus pendek.
const MaxTokenLifetime = 5 * time.Minute

var (
	// ErrInvalidToken berarti tiket rusak, bukan buatan kita, atau sudah diubah.
	ErrInvalidToken = errors.New("auth: tiket tidak valid")
	// ErrExpiredToken berarti tiket sudah lewat masa berlakunya.
	ErrExpiredToken = errors.New("auth: tiket kedaluwarsa")
)

type claims struct {
	Subject string   `json:"sub"`
	Expires int64    `json:"exp"`
	Perms   []string `json:"perms,omitempty"`
}

// Identity adalah pengguna yang terbukti login.
type Identity struct {
	UserID string
	// Perms adalah izin mengubah data dari tiket ("alert:handle", ...). Kosong
	// berarti hanya boleh membaca. Jangan diubah oleh pemanggil.
	Perms []string
}

// Can melaporkan apakah tiket ini membawa izin perm. Izin kosong tidak pernah
// diberikan.
func (i Identity) Can(perm string) bool {
	return perm != "" && slices.Contains(i.Perms, perm)
}

// Verifier memeriksa tiket pada waktu tertentu. *Tokens memenuhinya; dipakai
// WebSocket hub dan endpoint REST.
type Verifier interface {
	Verify(token string, now time.Time) (Identity, error)
}

// Tokens menerbitkan dan memeriksa tiket dengan satu rahasia bersama.
type Tokens struct {
	secret []byte
}

// NewTokens membuat Tokens. Rahasia yang terlalu pendek ditolak supaya tidak ada
// konfigurasi yang diam-diam lemah.
func NewTokens(secret string) (*Tokens, error) {
	if len(secret) < MinSecretLength {
		return nil, fmt.Errorf("rahasia tiket minimal %d karakter", MinSecretLength)
	}
	return &Tokens{secret: []byte(secret)}, nil
}

func (t *Tokens) sign(payload []byte) []byte {
	mac := hmac.New(sha256.New, t.secret)
	mac.Write(payload)
	return mac.Sum(nil)
}

var encoding = base64.RawURLEncoding

// Issue menerbitkan tiket hanya-baca (tanpa izin) untuk userID yang berlaku
// sampai now+ttl. Backend sendiri tidak menerbitkan tiket di produksi; fungsi
// ini ada untuk test dan sebagai acuan format bagi penerbit di sisi Next.js.
func (t *Tokens) Issue(userID string, now time.Time, ttl time.Duration) (string, error) {
	return t.IssueWithPerms(userID, nil, now, ttl)
}

// IssueWithPerms seperti Issue, dengan izin mengubah data. Izin diurutkan dan
// dibuat unik supaya himpunan yang sama selalu menghasilkan payload yang sama
// (sama dengan src/lib/realtime-ticket.ts); daftar kosong menghilangkan
// "perms" dari payload.
func (t *Tokens) IssueWithPerms(userID string, perms []string, now time.Time, ttl time.Duration) (string, error) {
	if userID == "" {
		return "", errors.New("auth: userID kosong")
	}
	if ttl <= 0 || ttl > MaxTokenLifetime {
		return "", fmt.Errorf("auth: umur tiket harus lebih dari 0 dan paling lama %s", MaxTokenLifetime)
	}
	for _, perm := range perms {
		if perm == "" {
			return "", errors.New("auth: izin kosong")
		}
	}
	sorted := slices.Clone(perms)
	slices.Sort(sorted)
	sorted = slices.Compact(sorted)
	payload, err := json.Marshal(claims{Subject: userID, Expires: now.Add(ttl).Unix(), Perms: sorted})
	if err != nil {
		return "", err
	}
	return encoding.EncodeToString(payload) + "." + encoding.EncodeToString(t.sign(payload)), nil
}

// Verify memeriksa tanda tangan dan masa berlaku tiket pada waktu now.
func (t *Tokens) Verify(token string, now time.Time) (Identity, error) {
	encodedPayload, encodedSig, ok := strings.Cut(token, ".")
	if !ok || encodedPayload == "" || encodedSig == "" {
		return Identity{}, ErrInvalidToken
	}
	payload, err := encoding.DecodeString(encodedPayload)
	if err != nil {
		return Identity{}, ErrInvalidToken
	}
	sig, err := encoding.DecodeString(encodedSig)
	if err != nil {
		return Identity{}, ErrInvalidToken
	}
	// hmac.Equal membandingkan dalam waktu tetap.
	if !hmac.Equal(sig, t.sign(payload)) {
		return Identity{}, ErrInvalidToken
	}

	var c claims
	if err := json.Unmarshal(payload, &c); err != nil || c.Subject == "" || c.Expires == 0 {
		return Identity{}, ErrInvalidToken
	}
	expires := time.Unix(c.Expires, 0)
	if !now.Before(expires) {
		return Identity{}, ErrExpiredToken
	}
	// Tolak tiket dengan masa berlaku terlalu panjang meski tanda tangannya
	// benar, agar penerbit yang salah konfigurasi tidak menghasilkan tiket abadi.
	if expires.Sub(now) > MaxTokenLifetime {
		return Identity{}, ErrInvalidToken
	}
	return Identity{UserID: c.Subject, Perms: c.Perms}, nil
}
