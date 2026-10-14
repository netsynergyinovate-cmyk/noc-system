package httpapi

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// secureHeaders mencegah browser menebak tipe konten dan menyimpan respons API.
func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// statusRecorder mencatat kode status yang ditulis handler.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// Hijack meneruskan pengambilalihan koneksi (upgrade WebSocket). gorilla/websocket
// memeriksa http.Hijacker langsung pada ResponseWriter, bukan lewat Unwrap.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, rw, err := http.NewResponseController(r.ResponseWriter).Hijack()
	if err == nil {
		r.status = http.StatusSwitchingProtocols
	}
	return conn, rw, err
}

// Unwrap membuat http.ResponseController bisa menjangkau ResponseWriter aslinya.
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// logRequests mencatat satu baris per permintaan. Query string sengaja tidak
// dicatat karena bisa memuat token.
func logRequests(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"duration", time.Since(started).String(),
		)
	})
}
