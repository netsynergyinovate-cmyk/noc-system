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
type CustomerSession struct {
	IP     string
	Uptime string
}

type SessionIndex struct {
	presence   Presence
	mu         sync.RWMutex
	byRouter   map[string]map[netip.Addr]string
	byCustomer map[string]map[string]CustomerSession
	byUser     map[string]map[string]CustomerSession
}

func NewSessionIndex(presence Presence) *SessionIndex {
	return &SessionIndex{
		presence:   presence,
		byRouter:   make(map[string]map[netip.Addr]string),
		byCustomer: make(map[string]map[string]CustomerSession),
		byUser:     make(map[string]map[string]CustomerSession),
	}
}

// Update mengganti peta satu router dari daftar sesinya.
func (x *SessionIndex) Update(routerID string, sessions []PPPSession) {
	m := make(map[netip.Addr]string, len(sessions))
	custMap := make(map[string]CustomerSession, len(sessions))
	userMap := make(map[string]CustomerSession, len(sessions))
	for _, s := range sessions {
		if s.Service != "" && !strings.EqualFold(s.Service, "pppoe") {
			continue
		}
		addr, err := netip.ParseAddr(s.Address)
		if err != nil || addr.IsUnspecified() {
			continue
		}
		sess := CustomerSession{IP: s.Address, Uptime: s.Uptime}
		normUser := strings.ToLower(strings.TrimSpace(s.Name))
		if normUser != "" {
			userMap[normUser] = sess
		}
		if c, ok := x.presence.CustomerByPPPoE(s.Name); ok && c.RouterID == routerID {
			m[addr.Unmap()] = c.ID
			custMap[c.ID] = sess
		}
	}
	x.mu.Lock()
	x.byRouter[routerID] = m
	x.byCustomer[routerID] = custMap
	x.byUser[routerID] = userMap
	x.mu.Unlock()
}

func (x *SessionIndex) LookupCustomer(customerID string) (CustomerSession, bool) {
	x.mu.RLock()
	defer x.mu.RUnlock()
	for _, m := range x.byCustomer {
		if sess, ok := m[customerID]; ok {
			return sess, true
		}
	}
	return CustomerSession{}, false
}

func (x *SessionIndex) LookupUser(username string) (CustomerSession, bool) {
	norm := strings.ToLower(strings.TrimSpace(username))
	x.mu.RLock()
	defer x.mu.RUnlock()
	for _, m := range x.byUser {
		if sess, ok := m[norm]; ok {
			return sess, true
		}
	}
	return CustomerSession{}, false
}

// Lookup memenuhi netflow.CustomerIndex.
func (x *SessionIndex) Lookup(routerID string, ip netip.Addr) (string, bool) {
	x.mu.RLock()
	defer x.mu.RUnlock()
	id, ok := x.byRouter[routerID][ip.Unmap()]
	return id, ok
}
