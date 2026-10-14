package olt

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"regexp"
	"strings"
	"time"
)

// Sesi telnet minimal untuk CLI OLT: negosiasi opsi ditolak semua (CLI hanya
// butuh teks), login, lalu satu perintah per panggilan sampai prompt muncul.
// Tidak ada perintah yang mengubah konfigurasi di paket ini: hanya "show".

const (
	iac  = 255
	dont = 254
	do   = 253
	wont = 252
	will = 251
	sb   = 250
	se   = 240

	// maxCommandOutput membatasi keluaran satu perintah supaya perangkat yang
	// rusak atau palsu tidak menghabiskan memori.
	maxCommandOutput = 4 << 20
)

var (
	ansiRE        = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]`)
	userPromptRE  = regexp.MustCompile(`(?i)(user ?name|login)\s*:\s*$`)
	passPromptRE  = regexp.MustCompile(`(?i)pass(word)?\s*:\s*$`)
	cliPromptRE   = regexp.MustCompile(`(?:^|\n)[^\s<>#]+(?:\([a-z0-9-]+\))?[>#][ ]?\n?$`)
	pagerRE       = regexp.MustCompile(`(?i)(--+\s*more\s*--+|<-+\s*more\s*-+>|press any key)\s*$`)
	errUserPrompt = errors.New("olt/telnet: kredensial ditolak (prompt login muncul lagi)")
)

type telnetSession struct {
	conn    net.Conn
	pending bytes.Buffer // teks sudah dibersihkan, belum dikonsumsi
	timeout time.Duration
}

// dialTelnet membuka koneksi TCP. Alamat "host" atau "host:port" (bawaan 23).
func dialTelnet(ctx context.Context, addr string, timeout time.Duration) (*telnetSession, error) {
	if _, _, err := net.SplitHostPort(addr); err != nil {
		addr = net.JoinHostPort(addr, "23")
	}
	d := net.Dialer{Timeout: timeout}
	c, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("olt/telnet: hubungi %s: %w", addr, err)
	}
	return &telnetSession{conn: c, timeout: timeout}, nil
}

func (s *telnetSession) Close() error {
	if s.conn == nil {
		return nil
	}
	err := s.conn.Close()
	s.conn = nil
	return err
}

// fill membaca sepotong data dan memprosesnya: opsi telnet dijawab, ANSI dan
// CR dibuang. Mengembalikan false bila tidak ada data baru sebelum batas waktu.
func (s *telnetSession) fill(deadline time.Time) (bool, error) {
	if s.conn == nil {
		return false, errors.New("olt/telnet: sesi sudah ditutup")
	}
	step := time.Now().Add(250 * time.Millisecond)
	if step.After(deadline) {
		step = deadline
	}
	_ = s.conn.SetReadDeadline(step)
	buf := make([]byte, 4096)
	n, err := s.conn.Read(buf)
	if n > 0 {
		s.consume(buf[:n])
	}
	if err != nil {
		var ne net.Error
		if errors.As(err, &ne) && ne.Timeout() {
			return n > 0, nil
		}
		return n > 0, fmt.Errorf("olt/telnet: baca: %w", err)
	}
	return n > 0, nil
}

func (s *telnetSession) consume(raw []byte) {
	var reply []byte
	var text bytes.Buffer
	for i := 0; i < len(raw); i++ {
		b := raw[i]
		if b != iac {
			text.WriteByte(b)
			continue
		}
		if i+1 >= len(raw) {
			break
		}
		switch cmd := raw[i+1]; {
		case cmd >= will && cmd <= dont && i+2 < len(raw):
			// Tolak semua opsi: DO -> WONT, WILL -> DONT.
			resp := byte(dont)
			if cmd == do || cmd == dont {
				resp = wont
			}
			reply = append(reply, iac, resp, raw[i+2])
			i += 2
		case cmd == sb:
			for i+1 < len(raw) && !(raw[i] == iac && raw[i+1] == se) {
				i++
			}
			i++
		case cmd == iac:
			text.WriteByte(iac)
			i++
		default:
			i++
		}
	}
	if len(reply) > 0 && s.conn != nil {
		_, _ = s.conn.Write(reply)
	}
	clean := ansiRE.ReplaceAllString(text.String(), "")
	clean = strings.ReplaceAll(clean, "\r", "")
	s.pending.WriteString(clean)
}

// waitFor membaca sampai ekor teks cocok dengan re. Mengembalikan seluruh teks
// yang terkumpul (dan mengosongkan penampung). Penanda pager dijawab dengan spasi.
func (s *telnetSession) waitFor(ctx context.Context, re *regexp.Regexp, limit time.Duration) (string, error) {
	deadline := time.Now().Add(limit)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	var collected strings.Builder
	for {
		if err := ctx.Err(); err != nil {
			return collected.String(), err
		}
		if s.pending.Len() > 0 {
			collected.WriteString(s.pending.String())
			s.pending.Reset()
		}
		text := collected.String()
		if collected.Len() > maxCommandOutput {
			return text, errors.New("olt/telnet: keluaran perintah terlalu besar")
		}
		if loc := pagerRE.FindStringIndex(text); loc != nil && loc[1] == len(text) {
			collected.Reset()
			collected.WriteString(text[:loc[0]])
			if _, err := s.conn.Write([]byte(" ")); err != nil {
				return text, fmt.Errorf("olt/telnet: tulis: %w", err)
			}
			continue
		}
		if re.MatchString(text) {
			return text, nil
		}
		if time.Now().After(deadline) {
			return text, fmt.Errorf("olt/telnet: waktu habis menunggu %q", re.String())
		}
		if _, err := s.fill(deadline); err != nil {
			return text, err
		}
	}
}

func (s *telnetSession) writeLine(line string) error {
	if s.conn == nil {
		return errors.New("olt/telnet: sesi sudah ditutup")
	}
	_ = s.conn.SetWriteDeadline(time.Now().Add(s.timeout))
	_, err := s.conn.Write([]byte(line + "\r\n"))
	if err != nil {
		return fmt.Errorf("olt/telnet: tulis: %w", err)
	}
	return nil
}

// login masuk dengan username dan kata sandi sampai prompt CLI muncul. Kata
// sandi tidak pernah masuk pesan galat.
func (s *telnetSession) login(ctx context.Context, user, pass string) error {
	if _, err := s.waitFor(ctx, userPromptRE, s.timeout); err != nil {
		return fmt.Errorf("olt/telnet: menunggu prompt username: %w", err)
	}
	if err := s.writeLine(user); err != nil {
		return err
	}
	if _, err := s.waitFor(ctx, passPromptRE, s.timeout); err != nil {
		return fmt.Errorf("olt/telnet: menunggu prompt kata sandi: %w", err)
	}
	if err := s.writeLine(pass); err != nil {
		return err
	}
	// Keberhasilan = prompt CLI; kegagalan = prompt username muncul lagi. Banner
	// sesudah login memuat tabel "fail login", jadi kata "fail" tidak dipakai.
	both := regexp.MustCompile(cliPromptRE.String() + "|" + userPromptRE.String())
	out, err := s.waitFor(ctx, both, s.timeout)
	if err != nil {
		return fmt.Errorf("olt/telnet: menunggu prompt sesudah login: %w", err)
	}
	if userPromptRE.MatchString(out) && !cliPromptRE.MatchString(out) {
		return errUserPrompt
	}
	return nil
}

// run mengirim satu perintah dan mengembalikan keluarannya tanpa gema perintah
// dan tanpa baris prompt.
func (s *telnetSession) run(ctx context.Context, cmd string) (string, error) {
	s.pending.Reset()
	if err := s.writeLine(cmd); err != nil {
		return "", err
	}
	out, err := s.waitFor(ctx, cliPromptRE, s.timeout)
	if err != nil {
		return out, err
	}
	lines := strings.Split(out, "\n")
	if len(lines) > 0 && strings.Contains(lines[0], strings.Fields(cmd + " x")[0]) {
		lines = lines[1:] // gema perintah
	}
	if n := len(lines); n > 0 && cliPromptRE.MatchString("\n"+lines[n-1]) {
		lines = lines[:n-1] // prompt
	}
	return strings.Join(lines, "\n"), nil
}
