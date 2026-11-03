package collector

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
	"strings"
)

const addressListProplist = "list,address,disabled"

// AddressListEntry adalah satu entri dalam /ip/firewall/address-list di MikroTik.
type AddressListEntry struct {
	List     string `json:"list"`
	Address  string `json:"address"`
	Disabled bool   `json:"disabled"`
}

type rawAddressListEntry struct {
	List     string          `json:"list"`
	Address  string          `json:"address"`
	Disabled json.RawMessage `json:"disabled"`
}

func parseDisabled(raw json.RawMessage) bool {
	s := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	return strings.EqualFold(s, "true")
}

// AddressList membaca seluruh daftar entri /ip/firewall/address-list dari router.
func (c *Client) AddressList(ctx context.Context) ([]AddressListEntry, error) {
	body, err := c.get(ctx, addressListProplist, "ip", "firewall", "address-list")
	if err != nil {
		return nil, err
	}
	var rows []rawAddressListEntry
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("jawaban /ip/firewall/address-list bukan daftar yang valid: %w", err)
	}
	entries := make([]AddressListEntry, 0, len(rows))
	for _, r := range rows {
		entries = append(entries, AddressListEntry{
			List:     r.List,
			Address:  r.Address,
			Disabled: parseDisabled(r.Disabled),
		})
	}
	return entries, nil
}

type ipMatcher func(netip.Addr) bool

func compileAddressMatcher(entry string) ipMatcher {
	entry = strings.TrimSpace(entry)
	if entry == "" {
		return nil
	}
	if strings.Contains(entry, "-") {
		parts := strings.SplitN(entry, "-", 2)
		start, err1 := netip.ParseAddr(strings.TrimSpace(parts[0]))
		end, err2 := netip.ParseAddr(strings.TrimSpace(parts[1]))
		if err1 != nil || err2 != nil {
			return nil
		}
		if start.Is4() != end.Is4() {
			return nil
		}
		if start.Compare(end) > 0 {
			start, end = end, start
		}
		return func(target netip.Addr) bool {
			if target.Is4() != start.Is4() {
				return false
			}
			return start.Compare(target) <= 0 && target.Compare(end) <= 0
		}
	}
	if strings.Contains(entry, "/") {
		prefix, err := netip.ParsePrefix(entry)
		if err != nil {
			return nil
		}
		return func(target netip.Addr) bool {
			return prefix.Contains(target)
		}
	}
	addr, err := netip.ParseAddr(entry)
	if err != nil {
		return nil
	}
	return func(target netip.Addr) bool {
		return target == addr
	}
}

// MatchIsolirSessions mencocokkan IP sesi PPPoE aktif dengan entri address-list isolir.
// Mengembalikan peta lowercase username -> isIsolated.
// Bila router tidak memiliki entri isolir yang aktif (enabled), mengembalikan nil
// (tidak ada bukti dari router).
func MatchIsolirSessions(sessions []PPPSession, entries []AddressListEntry) map[string]bool {
	var matchers []ipMatcher
	hasEnabledIsolir := false
	for _, e := range entries {
		if e.Disabled || !strings.Contains(strings.ToLower(e.List), "isolir") {
			continue
		}
		hasEnabledIsolir = true
		if m := compileAddressMatcher(e.Address); m != nil {
			matchers = append(matchers, m)
		}
	}
	if !hasEnabledIsolir {
		return nil
	}

	result := make(map[string]bool)
	for _, s := range sessions {
		if s.Service != "" && !strings.EqualFold(s.Service, "pppoe") {
			continue
		}
		username := strings.ToLower(strings.TrimSpace(s.Name))
		if username == "" {
			continue
		}
		isIsolated := false
		if addr, err := netip.ParseAddr(strings.TrimSpace(s.Address)); err == nil {
			for _, m := range matchers {
				if m(addr) {
					isIsolated = true
					break
				}
			}
		}
		if isIsolated || !result[username] {
			result[username] = isIsolated
		}
	}
	return result
}
