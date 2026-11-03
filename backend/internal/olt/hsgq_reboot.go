package olt

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// Reboot satu ONU lewat CLI OLT HSGQ. Operasi tulis kedua (setelah ikat TR-069), dipicu HANYA oleh operator lewat
// POST /api/v1/olts/{oltId}/onus/{pon}/{onu}/reboot; polling tidak pernah memanggilnya.
//
// Sintaks (diverifikasi lewat bantuan "?" di HSGQ-XE08, mode "interface epon <pon>"):
//
//	onu-reboot onu-id <1-64>
//
// Perintah dirakit HANYA dari dua bilangan bulat yang sudah dicek rentangnya, tidak pernah dari teks luar, dan tidak
// pernah menjadi "reboot" polos (itu me-reboot seluruh OLT).

// ErrRebootRejected: OLT menolak perintah reboot ONU.
var ErrRebootRejected = errors.New("OLT menolak perintah reboot ONU")

// OnuRebooter diimplementasikan driver yang bisa me-reboot satu ONU lewat OLT.
type OnuRebooter interface {
	RebootOnu(ctx context.Context, ref OnuRef) error
}

// rebootCommands adalah satu-satunya tempat perintah reboot dirakit.
func rebootCommands(ref OnuRef) ([]string, error) {
	if !validRef(ref) {
		return nil, fmt.Errorf("nomor PON/ONU %d/%d di luar rentang OLT", ref.Pon, ref.Onu)
	}
	return []string{
		fmt.Sprintf("interface epon %d", ref.Pon),
		fmt.Sprintf("onu-reboot onu-id %d", ref.Onu),
	}, nil
}

func (d *hsgqTelnetDriver) RebootOnu(ctx context.Context, ref OnuRef) error {
	cmds, err := rebootCommands(ref)
	if err != nil {
		return err
	}
	if d.isClosed() {
		return errors.New("olt/hsgq-telnet: driver sudah ditutup")
	}
	c, err := d.open(ctx)
	if err != nil {
		return err
	}
	defer closeSession(ctx, c)

	var failed error
	for _, cmd := range cmds {
		out, err := c.run(ctx, cmd)
		if err != nil {
			return fmt.Errorf("perintah %q: %w", cmd, err)
		}
		if cliRejected(out) {
			failed = fmt.Errorf("%w: %q -> %s", ErrRebootRejected, cmd, strings.TrimSpace(out))
			break
		}
	}
	// Kembali ke mode config supaya sesi berakhir dalam keadaan yang sama seperti saat mulai.
	for _, cmd := range []string{"end", "configure"} {
		if _, err := c.run(ctx, cmd); err != nil && failed == nil {
			failed = fmt.Errorf("perintah %q: %w", cmd, err)
		}
	}
	return failed
}

// RebootOne me-reboot SATU ONU lewat driver. ErrNotSupported bila driver tidak bisa (mis. driver web API).
func RebootOne(ctx context.Context, drv Driver, ref OnuRef) error {
	r, ok := drv.(OnuRebooter)
	if !ok {
		return fmt.Errorf("driver %q: %w", drv.Name(), ErrNotSupported)
	}
	return r.RebootOnu(ctx, ref)
}
