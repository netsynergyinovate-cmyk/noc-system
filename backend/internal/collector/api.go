package collector

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Klien API biner RouterOS (port 8728, atau 8729 dengan TLS), dipakai protokol
// "api". Satu soket TCP dipertahankan untuk semua perintah baca: berbeda dengan
// REST yang membuka koneksi + login baru tiap permintaan, biaya handshake tidak
// dibayar ulang tiap detik. Soket yang terputus dibuka ulang otomatis.
//
// Format kalimat mengikuti protokol API RouterOS: setiap kata diawali panjang
// (1-4 byte, bit tinggi penanda jumlah byte) lalu isinya; panjang 0 menutup
// kalimat. Jawaban diawali !re (baris data), diakhiri !done, dan !trap berisi
// alasan penolakan.

const (
	apiDefaultTimeout = 10 * time.Second
	// apiConnectTimeout sengaja 5 detik: PRD membatasi pre-flight ke 5 detik.
	apiConnectTimeout = 5 * time.Second
	// apiMaxSentence membatasi satu kalimat agar router rusak tidak menghabiskan memori.
	apiMaxSentence = 16 << 20
)

var errAPIProtocol = errors.New("jawaban API RouterOS tidak dikenali")

// apiConn adalah satu soket API biner. Amat digunakan bersama oleh semua job.
type apiConn struct {
	conn   net.Conn
	reader *bufio.Reader

	mu      sync.Mutex
	tag     int
	closed  bool
	created time.Time
}

// dialAPI menghubungi router dan login. host tanpa port; port 8728 atau 8729.
func dialAPI(ctx context.Context, host string, port int, useTLS bool, username, password string) (*apiConn, error) {
	if host == "" {
		return nil, errors.New("alamat router kosong")
	}
	if port == 0 {
		if useTLS {
			port = 8729
		} else {
			port = 8728
		}
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	dialer := &net.Dialer{Timeout: apiConnectTimeout, KeepAlive: 30 * time.Second}
	var conn net.Conn
	var err error
	if useTLS {
		// Sertifikat API RouterOS hampir selalu self-signed dan tidak dipakai
		// untuk identitas pengguna (kredensial tetap dikirim di dalam terowongan).
		td := &tls.Dialer{
			NetDialer: dialer,
			Config:    &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12},
		}
		conn, err = td.DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return nil, mapAPIDialError(err)
	}
	a := &apiConn{conn: conn, reader: bufio.NewReaderSize(conn, 64<<10), created: time.Now()}
	loginCtx, cancel := context.WithTimeout(ctx, apiDefaultTimeout)
	defer cancel()
	if _, err := a.exec(loginCtx, []string{"/login", "=name=" + username, "=password=" + password}); err != nil {
		a.close()
		if isAPIAuthError(err) {
			return nil, errors.New("router menolak login API: periksa username, kata sandi, dan policy akun")
		}
		return nil, err
	}
	return a, nil
}

func mapAPIDialError(err error) error {
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return errors.New("router tidak menjawab dalam 5 detik (alamat/port salah, firewall, atau API nonaktif)")
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "connection refused"):
		return errors.New("router menolak koneksi API: pastikan /ip service api (8728) atau api-ssl (8729) aktif")
	case strings.Contains(msg, "no such host"):
		return errors.New("alamat router tidak ditemukan")
	}
	return fmt.Errorf("hubungi API router: %w", err)
}

func isAPIAuthError(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "invalid user") || strings.Contains(msg, "password") || strings.Contains(msg, "login")
}

func (a *apiConn) close() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return
	}
	a.closed = true
	_ = a.conn.Close()
}

func (a *apiConn) isClosed() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.closed
}

// exec menjalankan satu perintah sampai !done. Hasil !re dikembalikan sebagai
// baris atribut. Kalimat milik perintah lain (tag berbeda) diabaikan. Setiap
// perintah biasa dibatasi agar router yang macet tidak menahan job selamanya;
// aliran panjang (torch/monitor-traffic) memakai stream dengan konteksnya
// sendiri.
func (a *apiConn) exec(ctx context.Context, words []string) ([]map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, apiDefaultTimeout)
	defer cancel()
	var rows []map[string]string
	err := a.stream(ctx, words, func(row map[string]string) bool {
		rows = append(rows, row)
		return true
	})
	return rows, err
}

// stream menjalankan satu perintah dan memanggil onReply untuk setiap !re.
// onReply mengembalikan false untuk berhenti lebih awal (mis. torch/monitor).
func (a *apiConn) stream(ctx context.Context, words []string, onReply func(map[string]string) bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return errors.New("koneksi API router sudah ditutup")
	}

	a.tag++
	tag := strconv.Itoa(a.tag)
	sentence := make([]string, 0, len(words)+1)
	sentence = append(sentence, words...)
	sentence = append(sentence, ".tag="+tag)

	deadline, ok := ctx.Deadline()
	if ok {
		_ = a.conn.SetDeadline(deadline)
	} else {
		// Aliran panjang (monitor-traffic): tidak ada batas bawaan; pembatalan
		// lewat konteks atau penutupan koneksi.
		_ = a.conn.SetDeadline(time.Time{})
	}
	stop := context.AfterFunc(ctx, func() { _ = a.conn.SetDeadline(time.Now()) })
	defer stop()

	if err := writeSentence(a.conn, sentence); err != nil {
		a.closed = true
		_ = a.conn.Close()
		return fmt.Errorf("kirim perintah API router: %w", err)
	}

	var trap string
	for {
		reply, err := readSentence(a.reader)
		if err != nil {
			if errors.Is(err, io.EOF) {
				a.closed = true
				_ = a.conn.Close()
				if trap != "" {
					return fmt.Errorf("router menolak perintah: %s", trap)
				}
				return errors.New("router menutup koneksi API")
			}
			if ctx.Err() != nil {
				a.closed = true
				_ = a.conn.Close()
				return ctx.Err()
			}
			a.closed = true
			_ = a.conn.Close()
			return fmt.Errorf("baca jawaban API router: %w", err)
		}
		if len(reply) == 0 {
			continue
		}
		// Kalimat dari perintah lain tidak boleh tercampur.
		if t := attr(reply, "tag"); t != "" && t != tag {
			continue
		}
		switch reply[0] {
		case "!re":
			if onReply != nil && !onReply(attrs(reply)) {
				return nil
			}
		case "!empty":
			// RouterOS mengirim !empty untuk hasil kosong (mis. /ppp/secret
			// tanpa akun). Bukan galat; tunggu !done berikutnya.
			continue
		case "!trap", "!fatal":
			trap = attrs(reply)["message"]
			if reply[0] == "!fatal" {
				a.closed = true
				_ = a.conn.Close()
			}
		case "!done":
			if trap != "" {
				return fmt.Errorf("router menolak perintah: %s", trap)
			}
			return nil
		default:
			return fmt.Errorf("%w: %s", errAPIProtocol, reply[0])
		}
	}
}

func attrs(sentence []string) map[string]string {
	out := make(map[string]string, len(sentence))
	for _, w := range sentence[1:] {
		if strings.HasPrefix(w, "=") {
			if k, v, ok := strings.Cut(w[1:], "="); ok {
				out[k] = v
			}
		}
	}
	return out
}

func attr(sentence []string, key string) string {
	for _, w := range sentence[1:] {
		if strings.HasPrefix(w, "=") {
			if k, v, ok := strings.Cut(w[1:], "="); ok && k == key {
				return v
			}
		}
	}
	return ""
}

func writeSentence(w io.Writer, words []string) error {
	var buf bytes.Buffer
	for _, word := range words {
		if word == "" {
			// Kata kosong akan dibaca sebagai akhir kalimat.
			continue
		}
		writeLength(&buf, len(word))
		buf.WriteString(word)
	}
	buf.WriteByte(0)
	_, err := w.Write(buf.Bytes())
	return err
}

func writeLength(buf *bytes.Buffer, n int) {
	switch {
	case n < 0x80:
		buf.WriteByte(byte(n))
	case n < 0x4000:
		buf.WriteByte(byte(n>>8) | 0x80)
		buf.WriteByte(byte(n))
	case n < 0x200000:
		buf.WriteByte(byte(n>>16) | 0xC0)
		buf.WriteByte(byte(n >> 8))
		buf.WriteByte(byte(n))
	default:
		buf.WriteByte(byte(n>>24) | 0xE0)
		buf.WriteByte(byte(n >> 16))
		buf.WriteByte(byte(n >> 8))
		buf.WriteByte(byte(n))
	}
}

func readSentence(r *bufio.Reader) ([]string, error) {
	var words []string
	for {
		n, err := readLength(r)
		if err != nil {
			return nil, err
		}
		if n == 0 {
			return words, nil
		}
		if n < 0 || n > apiMaxSentence {
			return nil, errAPIProtocol
		}
		buf := make([]byte, n)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, err
		}
		words = append(words, string(buf))
	}
}

func readLength(r *bufio.Reader) (int, error) {
	b0, err := r.ReadByte()
	if err != nil {
		return 0, err
	}
	if b0&0x80 == 0 {
		return int(b0), nil
	}
	if b0&0xC0 == 0x80 {
		b1, err := r.ReadByte()
		if err != nil {
			return 0, err
		}
		return int(b0&0x3F)<<8 | int(b1), nil
	}
	if b0&0xE0 == 0xC0 {
		var b [2]byte
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return 0, err
		}
		return int(b0&0x1F)<<16 | int(b[0])<<8 | int(b[1]), nil
	}
	if b0&0xF0 == 0xE0 {
		var b [3]byte
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return 0, err
		}
		return int(b0&0x0F)<<24 | int(b[0])<<16 | int(b[1])<<8 | int(b[2]), nil
	}
	return 0, errAPIProtocol
}

// ---- integrasi ke Client ---------------------------------------------------

// ensureAPI mengembalikan soket API yang siap, membukanya bila belum ada atau
// sudah tertutup.
func (c *Client) ensureAPI(ctx context.Context) (*apiConn, error) {
	c.apiMu.Lock()
	defer c.apiMu.Unlock()
	if c.api != nil && !c.api.isClosed() {
		return c.api, nil
	}
	if c.api != nil {
		c.api.close()
	}
	conn, err := dialAPI(ctx, c.apiHost, c.apiPort, c.apiTLS, c.username, c.password)
	if err != nil {
		return nil, err
	}
	c.api = conn
	return conn, nil
}

// apiGet menjalankan perintah print untuk path REST yang sama. Hasilnya
// dijadikan JSON dengan bentuk yang sama seperti jawaban REST, sehingga semua
// parser yang ada dipakai tanpa perubahan.
func (c *Client) apiGet(ctx context.Context, proplist string, filter map[string][]string, segments []string) ([]byte, error) {
	conn, err := c.ensureAPI(ctx)
	if err != nil {
		return nil, err
	}
	command := "/" + strings.Join(segments, "/") + "/print"
	words := []string{command}
	if proplist != "" {
		words = append(words, "=.proplist="+proplist)
	}
	for key, values := range filter {
		for _, v := range values {
			words = append(words, "?"+key+"="+v)
		}
	}
	rows, err := conn.exec(ctx, words)
	if err != nil {
		return nil, err
	}
	// /system/resource adalah satu objek di REST, bukan daftar.
	if isSingletonPath(segments) {
		if len(rows) == 0 {
			return []byte("{}"), nil
		}
		return json.Marshal(rows[0])
	}
	return json.Marshal(rows)
}

func isSingletonPath(segments []string) bool {
	return len(segments) == 2 && segments[0] == "system" && (segments[1] == "resource" || segments[1] == "identity")
}

// MonitorTraffic menjalankan /interface/monitor-traffic secara streaming pada
// soket khusus. RouterOS mengirim satu baris per detik berisi rx-bps/tx-bps,
// jadi tidak perlu membaca counter dua kali dan menghitung selisih.
func (c *Client) MonitorTraffic(ctx context.Context, iface string, onSample func(rxMbps, txMbps float64)) error {
	if c.apiHost == "" {
		return errors.New("monitor-traffic hanya tersedia lewat API biner")
	}
	conn, err := dialAPI(ctx, c.apiHost, c.apiPort, c.apiTLS, c.username, c.password)
	if err != nil {
		return err
	}
	defer conn.close()
	return conn.stream(ctx, []string{
		"/interface/monitor-traffic",
		"=interface=" + iface,
		"=once=",
	}, func(row map[string]string) bool {
		rx, errRx := strconv.ParseFloat(row["rx-bps"], 64)
		tx, errTx := strconv.ParseFloat(row["tx-bps"], 64)
		if errRx != nil || errTx != nil {
			return true // baris tanpa laju dilewati, bukan dianggap nol
		}
		onSample(rx/1e6, tx/1e6)
		return true
	})
}

// apiTorch menjalankan /tool/torch lewat API biner. Torch adalah perintah
// streaming: dikumpulkan sampai durasi habis, lalu koneksi khusus ditutup yang
// sekaligus menghentikan torch di router.
func (c *Client) apiTorch(ctx context.Context, iface string, duration time.Duration) ([]TorchEntry, error) {
	conn, err := dialAPI(ctx, c.apiHost, c.apiPort, c.apiTLS, c.username, c.password)
	if err != nil {
		return nil, err
	}
	defer conn.close()

	torchCtx, cancel := context.WithTimeout(ctx, duration)
	defer cancel()
	var entries []TorchEntry
	err = conn.stream(torchCtx, []string{
		"/tool/torch",
		"=interface=" + iface,
		"=src-address=0.0.0.0/0",
		"=dst-address=0.0.0.0/0",
		"=port=any",
		"=ip-protocol=any",
	}, func(row map[string]string) bool {
		entry := TorchEntry{
			SrcAddress: row["src-address"],
			DstAddress: row["dst-address"],
			Protocol:   firstNonEmpty(row["ip-protocol"], row["protocol"]),
			SrcPort:    atoiSafe(row["src-port"]),
			DstPort:    atoiSafe(row["dst-port"]),
			Port:       atoiSafe(row["port"]),
			Tx:         uint64(max(atoiSafe(row["tx"]), 0)),
			Rx:         uint64(max(atoiSafe(row["rx"]), 0)),
			TxPackets:  uint64(max(atoiSafe(row["tx-packets"]), 0)),
			RxPackets:  uint64(max(atoiSafe(row["rx-packets"]), 0)),
		}
		if entry.DstPort == 0 && entry.Port > 0 {
			entry.DstPort = entry.Port
		}
		entries = append(entries, entry)
		return true
	})
	if err != nil && !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
		return nil, err
	}
	return entries, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func atoiSafe(s string) (n int) {
	n, _ = strconv.Atoi(s)
	return n
}
