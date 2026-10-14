package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"noc-isp/backend/internal/auth"
)

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
// perm (mis. "alert:handle"). Dipasang pada rute yang MENGUBAH data:
//
//   - tiket tidak ada, rusak, atau kedaluwarsa: 401 (pesan sama untuk semuanya);
//   - tiket sah tanpa izin itu (peran hanya-lihat, atau tiket lama tanpa
//     "perms"): 403, sebelum handler dan sebelum isi permintaan dibaca;
//   - selain itu permintaan diteruskan.
//
// Izin datang dari tiket, jadi pencabutan peran di Next.js baru berlaku di sini
// setelah tiket yang sudah terbit habis (paling lama 60 detik).
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

// identityFrom mengambil pengguna yang sudah diverifikasi requireTicket atau
// requirePerm. ok false bila handler dipanggil tanpa melewati keduanya.
func identityFrom(ctx context.Context) (auth.Identity, bool) {
	identity, ok := ctx.Value(identityKey{}).(auth.Identity)
	return identity, ok
}

// unauthorized sengaja memakai pesan yang sama untuk semua penyebab (tiket
// tidak ada, rusak, atau kedaluwarsa) agar tidak membantu penebak.
func unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
}

// forbidden menjawab tiket yang sah tetapi tanpa izin untuk aksi ini.
func forbidden(w http.ResponseWriter) {
	writeJSON(w, http.StatusForbidden, errorResponse{Error: "forbidden"})
}
