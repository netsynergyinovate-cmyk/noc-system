package collector

import (
	"net/netip"
	"strings"
	"sync"
)

// SessionIndex memetakan IP sesi PPPoE ke id pelanggan per router, dari
// polling /ppp/active. Dipakai NetFlow untuk menandai aliran milik pelanggan;
// IP pelanggan berubah tiap sesi, jadi peta lama diganti utuh tiap polling.
// shortcut: sesi baru baru terpetakan pada polling berikutnya (≤30 detik).
type SessionIndex struct {
	presence Presence
	mu       sync.RWMutex
	byRouter map[string]map[netip.Addr]string
}

func NewSessionIndex(presence Presence) *SessionIndex {
	return &SessionIndex{presence: presence, byRouter: map[string]map[netip.Addr]string{}}
}

// Update mengganti peta satu router dari daftar sesinya.
func (x *SessionIndex) Update(routerID string, sessions []PPPSession) {
	m := make(map[netip.Addr]string, len(sessions))
	for _, s := range sessions {
		if s.Service != "" && !strings.EqualFold(s.Service, "pppoe") {
			continue
		}
		addr, err := netip.ParseAddr(s.Address)
		if err != nil || addr.IsUnspecified() {
			continue
		}
		if c, ok := x.presence.CustomerByPPPoE(s.Name); ok && c.RouterID == routerID {
			m[addr.Unmap()] = c.ID
		}
	}
	x.mu.Lock()
	x.byRouter[routerID] = m
	x.mu.Unlock()
}

// Lookup memenuhi netflow.CustomerIndex.
func (x *SessionIndex) Lookup(routerID string, ip netip.Addr) (string, bool) {
	x.mu.RLock()
	defer x.mu.RUnlock()
	id, ok := x.byRouter[routerID][ip.Unmap()]
	return id, ok
}
