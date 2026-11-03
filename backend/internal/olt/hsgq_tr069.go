package olt

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Pengikatan profil TR-069 ke ONU. Salah satu dari dua operasi tulis ke OLT (yang lain: reboot ONU, hsgq_reboot.go) dan
// sengaja dipisah dari Driver (yang baca-saja): polling tidak pernah memanggilnya,
// hanya AutoBinder yang dinyalakan eksplisit lewat OLT_TR069_AUTOBIND.

var (
	// ErrTR069ProfileMissing: profil dengan id itu belum dibuat di OLT. Backend tidak
	// membuat profil sendiri (alamat ACS adalah keputusan operator).
	ErrTR069ProfileMissing = errors.New("profil TR-069 belum ada di OLT")
	// ErrBindRejected: OLT menolak perintah ikat.
	ErrBindRejected = errors.New("OLT menolak perintah ikat TR-069")
)

// Batas nomor di OLT seri XE08: 8 port PON, 64 ONU per port, 32 profil TR-069.
const (
	maxTR069Pon     = 8
	maxTR069Onu     = 64
	maxTR069Profile = 32
)

// OnuRef menunjuk satu ONU: nomor PON dan nomor ONU di PON itu.
type OnuRef struct{ Pon, Onu int }

// BindResult adalah hasil pengikatan satu ONU; Err nil berarti OLT menerima.
type BindResult struct {
	Ref OnuRef
	Err error
}

// TR069Binder diimplementasikan driver yang bisa mengikat profil TR-069.
type TR069Binder interface {
	// BindTR069 mengikat profil profileID ke tiap ONU dalam SATU sesi. Bila profil
	// belum ada di OLT, tidak ada yang dikirim dan hasilnya ErrTR069ProfileMissing.
	BindTR069(ctx context.Context, profileID int, onus []OnuRef) ([]BindResult, error)
}

// profileRowRE: baris tabel "show onu-tr069-profile all", mis. "1   NOC   3".
var profileRowRE = regexp.MustCompile(`(?m)^\s*(\d+)\s+(\S+)\s+(\d+)\s*$`)

// profileExists membaca keluaran "show onu-tr069-profile all".
func profileExists(out string, id int) bool {
	for _, m := range profileRowRE.FindAllStringSubmatch(out, -1) {
		if n, err := strconv.Atoi(m[1]); err == nil && n == id {
			return true
		}
	}
	return false
}

// cliRejected mengenali penolakan CLI HSGQ ("vty% ...", "Error, ...").
func cliRejected(out string) bool {
	l := strings.ToLower(out)
	for _, bad := range []string{"vty%", "error", "unknown command", "no matched command", "invalid", "incomplete", "fail"} {
		if strings.Contains(l, bad) {
			return true
		}
	}
	return false
}

func validRef(r OnuRef) bool {
	return r.Pon >= 1 && r.Pon <= maxTR069Pon && r.Onu >= 1 && r.Onu <= maxTR069Onu
}

func (d *hsgqTelnetDriver) BindTR069(ctx context.Context, profileID int, onus []OnuRef) ([]BindResult, error) {
	if profileID < 1 || profileID > maxTR069Profile {
		return nil, fmt.Errorf("olt/hsgq-telnet: id profil TR-069 %d di luar 1-%d", profileID, maxTR069Profile)
	}
	if d.isClosed() {
		return nil, errors.New("olt/hsgq-telnet: driver sudah ditutup")
	}
	if len(onus) == 0 {
		return nil, nil
	}
	c, err := d.open(ctx)
	if err != nil {
		return nil, err
	}
	defer closeSession(ctx, c)

	list, err := c.run(ctx, "show onu-tr069-profile all")
	if err != nil {
		return nil, fmt.Errorf("olt/hsgq-telnet: show onu-tr069-profile all: %w", err)
	}
	if !profileExists(list, profileID) {
		return nil, ErrTR069ProfileMissing
	}

	results := make([]BindResult, 0, len(onus))
	for _, ref := range onus {
		res := BindResult{Ref: ref}
		if !validRef(ref) {
			// Angka dari luar tidak pernah masuk ke perintah tanpa dicek rentangnya.
			res.Err = fmt.Errorf("nomor PON/ONU %d/%d di luar rentang OLT", ref.Pon, ref.Onu)
			results = append(results, res)
			continue
		}
		res.Err = d.bindOne(ctx, c, ref, profileID)
		results = append(results, res)
		if ctx.Err() != nil {
			break
		}
	}
	return results, nil
}

// bindOne: masuk ke port PON, ikat, lalu kembali ke mode konfigurasi awal.
func (d *hsgqTelnetDriver) bindOne(ctx context.Context, c cliConn, ref OnuRef, profileID int) error {
	cmds := []string{
		fmt.Sprintf("interface epon %d", ref.Pon),
		fmt.Sprintf("onu-tr069 %d profile-id %d", ref.Onu, profileID),
	}
	var failed error
	for _, cmd := range cmds {
		out, err := c.run(ctx, cmd)
		if err != nil {
			return fmt.Errorf("perintah %q: %w", cmd, err)
		}
		if cliRejected(out) {
			failed = fmt.Errorf("%w: %q -> %s", ErrBindRejected, cmd, strings.TrimSpace(out))
			break
		}
	}
	// Kembali ke mode config supaya ONU berikutnya mulai dari keadaan yang sama.
	for _, cmd := range []string{"end", "configure"} {
		if _, err := c.run(ctx, cmd); err != nil && failed == nil {
			failed = fmt.Errorf("perintah %q: %w", cmd, err)
		}
	}
	return failed
}
