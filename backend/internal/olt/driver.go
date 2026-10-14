package olt

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

var (
	// ErrNotSupported: driver tidak mendukung operasi (bungkus dengan %w).
	ErrNotSupported = errors.New("operasi tidak didukung oleh driver OLT ini")
	// ErrDriverNotFound: nama driver tidak terdaftar.
	ErrDriverNotFound = errors.New("driver OLT tidak terdaftar")
)

// PonPortStats adalah data optik agregat satu PON port.
// Nilai optik nil berarti tidak terbaca (bukan 0).
type PonPortStats struct {
	Index          int
	RxPowerDbm     *float64
	TxPowerDbm     *float64
	AttenuationDb  *float64
	OnuOnlineCount int
}

// OnuStats adalah data optik satu ONU.
type OnuStats struct {
	PonIndex   int
	OnuIndex   int
	MacAddress string
	// SerialNumber kosong bila OLT hanya melaporkan MAC.
	SerialNumber  string
	RxPowerDbm    *float64
	TxPowerDbm    *float64
	AttenuationDb *float64
	IsOnline      bool
	// State: "online", "offline", atau "los" (kabel putus / tidak ada sinyal).
	// Kosong dibaca dari IsOnline (driver lama).
	State string
}

// Config adalah parameter koneksi ke satu OLT.
type Config struct {
	Host     string
	Username string
	Password string
	Timeout  time.Duration
}

// Driver adalah antarmuka yang diimplementasikan tiap merek OLT.
type Driver interface {
	Name() string
	FetchPonPorts(ctx context.Context) ([]PonPortStats, error)
	FetchOnus(ctx context.Context) ([]OnuStats, error)
	TestConnection(ctx context.Context) error
	Close() error
}

// Factory membuat Driver dari Config.
type Factory func(cfg Config) (Driver, error)

var (
	mu        sync.RWMutex
	factories = make(map[string]Factory)
)

// Register mendaftarkan driver. Panic bila nama kosong, factory nil, atau nama dobel
// (kesalahan pemrograman yang harus terlihat saat start).
func Register(name string, f Factory) {
	if name == "" || f == nil {
		panic("olt: Register dengan nama kosong atau factory nil")
	}
	mu.Lock()
	defer mu.Unlock()
	if _, dup := factories[name]; dup {
		panic("olt: driver sudah terdaftar: " + name)
	}
	factories[name] = f
}

// Get membuat instance driver terdaftar.
func Get(name string, cfg Config) (Driver, error) {
	mu.RLock()
	f, ok := factories[name]
	mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("olt: driver %q: %w (tersedia: %v)", name, ErrDriverNotFound, Drivers())
	}
	return f(cfg)
}

// Drivers mengembalikan nama driver terdaftar, terurut.
func Drivers() []string {
	mu.RLock()
	defer mu.RUnlock()
	names := make([]string, 0, len(factories))
	for n := range factories {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
