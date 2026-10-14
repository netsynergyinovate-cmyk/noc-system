package collector

import (
	"log/slog"
	"regexp"
	"sync"

	"noc-isp/backend/internal/state"
)

// DefaultUnreachableThreshold adalah jumlah kegagalan berturut-turut sebelum
// sebuah router ditandai tidak terjangkau. Satu-dua kegagalan dianggap gangguan
// sesaat (anti-flapping).
const DefaultUnreachableThreshold = 3

type sourceFailure struct {
	failures int
	lastErr  string
	lastAt   int64
}

// SourceFailureTracker mencatat kegagalan sumber data per router dan hanya
// mengubah state.Manager saat ambang terlewati atau saat pulih. Aman dipakai
// dari banyak goroutine.
type SourceFailureTracker struct {
	mu     sync.Mutex
	routes map[string]*sourceFailure
}

// NewSourceFailureTracker membuat tracker kosong.
func NewSourceFailureTracker() *SourceFailureTracker {
	return &SourceFailureTracker{routes: make(map[string]*sourceFailure)}
}

// Failures mengembalikan hitungan gagal berturut-turut dan galat terakhir.
func (t *SourceFailureTracker) Failures(routerID string) (failures int, lastErr string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if s, ok := t.routes[routerID]; ok {
		return s.failures, s.lastErr
	}
	return 0, ""
}

// RecordFailure mencatat satu kegagalan pada waktu at (detik unix). Mengembalikan
// true tepat saat router baru saja menjadi tidak terjangkau.
func (t *SourceFailureTracker) RecordFailure(routerID string, err error, at int64, mgr *state.Manager, logger *slog.Logger) (becameUnreachable bool) {
	cleanErr := SanitizeError(err)

	t.mu.Lock()
	s, ok := t.routes[routerID]
	if !ok {
		s = &sourceFailure{}
		t.routes[routerID] = s
	}
	s.failures++
	s.lastErr, s.lastAt = cleanErr, at
	failures := s.failures
	t.mu.Unlock()

	switch {
	case failures == DefaultUnreachableThreshold:
		mgr.SetRouterReachability(routerID, false, cleanErr, at)
		if logger != nil {
			logger.Warn("sumber data router tidak terjangkau",
				"router", routerID, "gagal_berturut", failures, "galat", cleanErr)
		}
		return true
	case failures > DefaultUnreachableThreshold:
		mgr.SetRouterReachability(routerID, false, cleanErr, at)
	}
	return false
}

// RecordSuccess mencatat satu keberhasilan. Mengembalikan true tepat saat router
// yang tadinya tidak terjangkau pulih.
func (t *SourceFailureTracker) RecordSuccess(routerID string, at int64, mgr *state.Manager, logger *slog.Logger) (recovered bool) {
	t.mu.Lock()
	s, ok := t.routes[routerID]
	wasDown := ok && s.failures >= DefaultUnreachableThreshold
	delete(t.routes, routerID)
	t.mu.Unlock()

	if !wasDown {
		return false
	}
	mgr.SetRouterReachability(routerID, true, "", at)
	if logger != nil {
		logger.Info("sumber data router pulih", "router", routerID)
	}
	return true
}

var (
	// http://user:pass@host -> http://user:[REDACTED]@host
	urlCredsRe = regexp.MustCompile(`(?i)([a-z][a-z0-9+.-]*://[^/\s:@]*):[^@\s]*@`)
	// token=..., password: ..., api_key=... dan sejenisnya.
	secretKVRe = regexp.MustCompile(`(?i)\b(token|access_token|password|passwd|pwd|secret|api[_-]?key|auth)\s*[=:]\s*[^\s&,;"']+`)
	bearerRe   = regexp.MustCompile(`(?i)\bbearer\s+[^\s"']+`)
	queryRe    = regexp.MustCompile(`\?[^\s"']+`)
)

// SanitizeError mengubah galat menjadi teks aman untuk log dan dashboard:
// kata sandi di URL, pasangan token/password, bearer, dan query string dibuang.
func SanitizeError(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	s = urlCredsRe.ReplaceAllString(s, "$1:[REDACTED]@")
	s = secretKVRe.ReplaceAllString(s, "$1=[REDACTED]")
	s = bearerRe.ReplaceAllString(s, "Bearer [REDACTED]")
	s = queryRe.ReplaceAllString(s, "?[REDACTED]")
	return s
}
