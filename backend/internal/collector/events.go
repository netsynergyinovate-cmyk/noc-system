package collector

import (
	"unicode"
	"unicode/utf8"

	"noc-isp/backend/internal/state"
)

// maxUserLength membatasi username PPPoE yang diterima dari jalur event.
const maxUserLength = 128

// Presence adalah bagian state.Manager yang dipakai jalur event (webhook dan
// syslog) untuk mengubah status online pelanggan.
type Presence interface {
	CustomerByPPPoE(pppoeUsername string) (state.Customer, bool)
	SetOnline(pppoeUsername string, online bool) (state.Change, error)
	Routers() []state.Router
	Customers() []state.Customer
}

// PPPEvent adalah satu kejadian sesi PPP: pelanggan tersambung (Online) atau
// terputus.
type PPPEvent struct {
	User   string
	Online bool
}

type applyResult int

const (
	resultApplied applyResult = iota
	resultUnknownCustomer
	resultRouterMismatch
)

// validUser menolak username kosong, terlalu panjang, bukan UTF-8, atau memuat
// karakter kontrol (yang bisa memalsukan baris log).
func validUser(user string) bool {
	if user == "" || len(user) > maxUserLength || !utf8.ValidString(user) {
		return false
	}
	for _, r := range user {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// applyPPPEvent menerapkan kejadian ke state. routerID menyebut router yang
// melaporkan; bila tidak kosong, pelanggan harus milik router itu supaya satu
// router tidak bisa mengubah status pelanggan router lain. notify dipanggil
// hanya bila status benar-benar berubah, dan boleh nil.
func applyPPPEvent(p Presence, notify func(state.Change), ev PPPEvent, routerID string) (state.Change, applyResult) {
	customer, ok := p.CustomerByPPPoE(ev.User)
	if !ok {
		return state.Change{}, resultUnknownCustomer
	}
	if routerID != "" && customer.RouterID != routerID {
		return state.Change{}, resultRouterMismatch
	}
	change, err := p.SetOnline(ev.User, ev.Online)
	if err != nil {
		// Pelanggan dihapus di antara dua pemanggilan di atas.
		return state.Change{}, resultUnknownCustomer
	}
	if change.Changed() && notify != nil {
		notify(change)
	}
	return change, resultApplied
}
