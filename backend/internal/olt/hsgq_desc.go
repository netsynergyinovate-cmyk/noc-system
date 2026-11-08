package olt

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// ErrDescriptionRejected: OLT menolak perintah penamaan/deskripsi ONU.
var ErrDescriptionRejected = errors.New("OLT menolak perintah deskripsi ONU")

// OnuDescriber diimplementasikan driver yang bisa menamai/memberi deskripsi satu ONU lewat OLT.
type OnuDescriber interface {
	SetOnuDescription(ctx context.Context, ref OnuRef, desc string) (string, error)
}

var descCleanRE = regexp.MustCompile(`[^a-zA-Z0-9_\-\. ]`)

// SanitizeDescription membersihkan karakter berbahaya dan membatasi panjang (maks 32 karakter).
func SanitizeDescription(desc string) string {
	s := strings.TrimSpace(desc)
	s = descCleanRE.ReplaceAllString(s, "")
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 32 {
		s = s[:32]
	}
	return strings.TrimSpace(s)
}

// descriptionCommands merakit perintah konfigurasi deskripsi/nama ONU di HSGQ CLI.
// Diverifikasi langsung pada perangkat fisik HSGQ-XE08:
//
//	interface epon <pon>
//	onu description <onu-id> "<desc>"
func descriptionCommands(ref OnuRef, desc string) (string, []string, error) {
	if !validRef(ref) {
		return "", nil, fmt.Errorf("nomor PON/ONU %d/%d di luar rentang OLT", ref.Pon, ref.Onu)
	}
	clean := SanitizeDescription(desc)
	if clean == "" {
		return "", nil, errors.New("deskripsi/nama ONU tidak boleh kosong")
	}
	return clean, []string{
		fmt.Sprintf("interface epon %d", ref.Pon),
		fmt.Sprintf("onu description %d %q", ref.Onu, clean),
	}, nil
}

func (d *hsgqTelnetDriver) SetOnuDescription(ctx context.Context, ref OnuRef, desc string) (string, error) {
	clean, cmds, err := descriptionCommands(ref, desc)
	if err != nil {
		return "", err
	}
	if d.isClosed() {
		return "", errors.New("olt/hsgq-telnet: driver sudah ditutup")
	}
	c, err := d.open(ctx)
	if err != nil {
		return "", err
	}
	defer closeSession(ctx, c)

	var failed error
	for _, cmd := range cmds {
		out, err := c.run(ctx, cmd)
		if err != nil {
			return "", fmt.Errorf("perintah %q: %w", cmd, err)
		}
		if cliRejected(out) {
			failed = fmt.Errorf("%w: %q -> %s", ErrDescriptionRejected, cmd, strings.TrimSpace(out))
			break
		}
	}
	for _, cmd := range []string{"end", "configure"} {
		if _, err := c.run(ctx, cmd); err != nil && failed == nil {
			failed = fmt.Errorf("perintah %q: %w", cmd, err)
		}
	}
	if failed != nil {
		return "", failed
	}
	return clean, nil
}

// DescribeOne menamai satu ONU lewat driver. ErrNotSupported bila driver tidak bisa.
func DescribeOne(ctx context.Context, drv Driver, ref OnuRef, desc string) (string, error) {
	describer, ok := drv.(OnuDescriber)
	if !ok {
		return "", fmt.Errorf("driver %q: %w", drv.Name(), ErrNotSupported)
	}
	return describer.SetOnuDescription(ctx, ref, desc)
}
