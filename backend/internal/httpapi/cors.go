package httpapi

import (
	"net/http"
	"slices"
)

// withCORS mengizinkan browser dari origin yang terdaftar memanggil API dari
// halaman dashboard (alamat berbeda dari backend). Permintaan tanpa header
// Origin (curl, server ke server) lewat apa adanya; browser dari origin lain
// ditolak, termasuk preflight-nya, sehingga permintaan sungguhannya tidak
// pernah dikirim.
func withCORS(allowedOrigins []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}
		if !slices.Contains(allowedOrigins, origin) {
			writeJSON(w, http.StatusForbidden, errorResponse{Error: "origin_not_allowed"})
			return
		}

		header := w.Header()
		header.Set("Access-Control-Allow-Origin", origin)
		header.Add("Vary", "Origin")
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			header.Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
			header.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			header.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
