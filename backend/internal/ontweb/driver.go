package ontweb

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Jenis modem yang dikenal paket ini.
const (
	KindFD511GW = "fd511gw"
	KindZimlink = "zimlink"
	KindGGCLink = "ggclink"
	KindF609    = "f609"
)

// Driver: satu modem yang bisa diisi TR-069-nya lewat halaman webnya.
type Driver interface {
	ApplyTR069(ctx context.Context, username, password string, want Settings) (Result, error)
}

// Detect mengenali jenis modem di baseURL TANPA kredensial: pemeriksaan terbuka (public_info
// FD511GW, halaman login ZIMLINK, halaman login GGCLink). Perangkat lain = ErrWrongDevice, jadi tidak pernah ada
// kredensial yang dikirim ke perangkat yang tidak dikenal.
func Detect(ctx context.Context, baseURL string, timeout time.Duration) (Driver, string, error) {
	fd := NewClient(baseURL, timeout)
	err := fd.checkModel(ctx)
	if err == nil {
		return fd, KindFD511GW, nil
	}
	if errors.Is(err, ErrUnreachable) {
		return nil, "", err
	}
	zl := NewZimlinkClient(baseURL, timeout)
	zerr := zl.checkModel(ctx)
	if zerr == nil {
		return zl, KindZimlink, nil
	}
	if errors.Is(zerr, ErrUnreachable) {
		return nil, "", zerr
	}
	gg := NewGGCLinkClient(baseURL, timeout)
	gerr := gg.checkModel(ctx)
	if gerr == nil {
		return gg, KindGGCLink, nil
	}
	if errors.Is(gerr, ErrUnreachable) {
		return nil, "", gerr
	}
	f6 := NewF609Client(baseURL, timeout)
	ferr := f6.checkModel(ctx)
	if ferr == nil {
		return f6, KindF609, nil
	}
	if errors.Is(ferr, ErrUnreachable) {
		return nil, "", ferr
	}
	return nil, "", fmt.Errorf("%w: bukan FD511GW, ZIMLINK ZL-2113X, GGCLink GM220-S maupun ZTE F609", ErrWrongDevice)
}

// KindLabel: nama untuk petugas.
func KindLabel(kind string) string {
	switch kind {
	case KindFD511GW:
		return "C-Data FD511GW"
	case KindZimlink:
		return "ZIMLINK ZL-2113X"
	case KindGGCLink:
		return "GGCLink GM220-S XPON"
	case KindF609:
		return "ZTE F609 (MTKc)"
	}
	return kind
}
