package state

import (
	"slices"
	"strings"
)

// StatusFilter memilih pelanggan berdasarkan status. Nilainya sama dengan
// StatusFilter di frontend (src/lib/dashboard/filter.ts).
type StatusFilter string

const (
	StatusAll     StatusFilter = "all"
	StatusOnline  StatusFilter = "online"  // semua yang online, termasuk sinyal lemah
	StatusOffline StatusFilter = "offline" // offline
	StatusWeak    StatusFilter = "weak"    // online dengan sinyal optik lemah
)

// ParseStatusFilter mengubah teks menjadi StatusFilter; teks kosong berarti all.
func ParseStatusFilter(s string) (StatusFilter, bool) {
	switch f := StatusFilter(s); f {
	case "", StatusAll:
		return StatusAll, true
	case StatusOnline, StatusOffline, StatusWeak:
		return f, true
	}
	return "", false
}

// CustomerFilter menyaring daftar pelanggan. Nilai kosong berarti tidak
// menyaring pada bagian itu.
type CustomerFilter struct {
	// Query dicocokkan tanpa memedulikan huruf besar/kecil terhadap nama,
	// username PPPoE, dan alamat.
	Query    string
	Status   StatusFilter
	RouterID string
}

// Matches menyatakan apakah pelanggan lolos semua saringan.
func (f CustomerFilter) Matches(c Customer) bool {
	if f.RouterID != "" && c.RouterID != f.RouterID {
		return false
	}
	switch f.Status {
	case StatusOnline:
		if !c.IsOnline {
			return false
		}
	case StatusOffline:
		if c.IsOnline {
			return false
		}
	case StatusWeak:
		if c.Health() != HealthWarning {
			return false
		}
	}
	query := strings.ToLower(strings.TrimSpace(f.Query))
	if query == "" {
		return true
	}
	return strings.Contains(strings.ToLower(c.Name), query) ||
		strings.Contains(strings.ToLower(c.PPPoEUsername), query) ||
		strings.Contains(strings.ToLower(c.Address), query)
}

// FilterCustomers mengembalikan pelanggan yang lolos saringan sebagai slice
// baru, urut nama (tanpa memedulikan huruf besar/kecil) lalu ID, sehingga
// urutannya tetap sama untuk paginasi.
func FilterCustomers(customers []Customer, f CustomerFilter) []Customer {
	out := make([]Customer, 0, len(customers))
	for _, c := range customers {
		if f.Matches(c) {
			out = append(out, c)
		}
	}
	slices.SortFunc(out, func(a, b Customer) int {
		if byName := strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)); byName != 0 {
			return byName
		}
		return strings.Compare(a.ID, b.ID)
	})
	return out
}
