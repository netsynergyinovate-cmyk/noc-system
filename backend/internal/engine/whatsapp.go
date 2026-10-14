package engine

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// WhatsappSender mengirim satu pesan ke satu target (nomor atau ID grup).
type WhatsappSender interface {
	Send(ctx context.Context, target string, message string) error
}

// WhatsappNotifier meneruskan event gangguan BARU (Active) ke penerima aktif.
// Pengiriman berjalan di goroutine sendiri agar Sink tidak terblokir.
type WhatsappNotifier struct {
	Sender      WhatsappSender
	Recipients  func() []string // target aktif, dibaca tiap event
	Template    string
	MinSeverity string
	Logger      *slog.Logger
	Timeout     time.Duration // per pesan; 0 = 15 detik

	wg         sync.WaitGroup
	mu         sync.Mutex
	activeKeys map[string]time.Time // gangguan yang sudah dikirim, belum pulih
}

// RecoveryTemplate adalah pesan pemulihan.
const RecoveryTemplate = "\u2705 *NOC RECOVERY*\nGangguan: {kind}\nPerangkat: {subject}\nRouter: {router}\nWaktu Pulih: {time}\nStatus: Sudah Normal Kembali"

// track mencatat key aktif; false bila sudah tercatat (duplikat).
func (n *WhatsappNotifier) track(key string, at time.Time) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if _, ok := n.activeKeys[key]; ok {
		return false
	}
	if n.activeKeys == nil {
		n.activeKeys = map[string]time.Time{}
	}
	n.activeKeys[key] = at
	return true
}

// untrack menghapus key; true bila key memang tercatat.
func (n *WhatsappNotifier) untrack(key string) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	_, ok := n.activeKeys[key]
	delete(n.activeKeys, key)
	return ok
}

// Sink cocok dengan engine.Sink. Gangguan aktif dikirim sekali per Key;
// pemulihan hanya dikirim untuk gangguan yang sebelumnya dikirim.
func (n *WhatsappNotifier) Sink(events []Event) {
	var targets []string
	for _, e := range events {
		var msg string
		if e.Active {
			if !ShouldSendAlert(e.Severity, n.MinSeverity) || !n.track(e.Key, e.Time) {
				continue
			}
			msg = FormatAlertMessage(n.Template, e)
		} else {
			if !n.untrack(e.Key) {
				continue
			}
			msg = FormatAlertMessage(RecoveryTemplate, e)
		}
		if targets == nil && n.Recipients != nil {
			targets = n.Recipients()
		}
		for _, t := range targets {
			n.wg.Add(1)
			go n.send(t, msg)
		}
	}
}

// Wait menunggu semua pengiriman yang berjalan (untuk shutdown dan tes).
func (n *WhatsappNotifier) Wait() { n.wg.Wait() }

func (n *WhatsappNotifier) send(target, msg string) {
	defer n.wg.Done()
	d := n.Timeout
	if d <= 0 {
		d = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	if err := n.Sender.Send(ctx, target, msg); err != nil && n.Logger != nil {
		n.Logger.Warn("whatsapp: gagal kirim", "target", target, "error", err)
	}
}

// ShouldSendAlert: minSeverity "critical" hanya meneruskan critical;
// "warning" meneruskan critical dan warning. info tidak pernah dikirim.
func ShouldSendAlert(severity, minSeverity string) bool {
	switch severity {
	case "critical":
		return true
	case "warning":
		return minSeverity == "warning"
	}
	return false
}

func severityLabel(s string) string {
	switch s {
	case "critical":
		return "\U0001F6A8 KRITIS"
	case "warning":
		return "\u26A0\uFE0F PERINGATAN"
	case "info":
		return "\u2139\uFE0F INFO"
	}
	return s
}

// FormatAlertMessage mengisi {severity} {kind} {subject} {router} {time}
// {message}. Satu lintasan; variabel tak dikenal dibiarkan apa adanya.
func FormatAlertMessage(template string, e Event) string {
	msg := ""
	if v, ok := e.Detail["message"]; ok {
		msg = fmt.Sprint(v)
	}
	subject := e.CustomerID
	if subject == "" {
		subject = e.RouterID
	}
	vals := map[string]string{
		"severity": severityLabel(e.Severity),
		"kind":     e.Kind,
		"subject":  subject,
		"router":   e.RouterID,
		"time":     e.Time.Format("2006-01-02 15:04:05"),
		"message":  msg,
	}
	var b strings.Builder
	for i := 0; i < len(template); {
		if template[i] == '{' {
			if j := strings.IndexByte(template[i:], '}'); j > 0 {
				if v, ok := vals[template[i+1:i+j]]; ok {
					b.WriteString(v)
					i += j + 1
					continue
				}
			}
		}
		b.WriteByte(template[i])
		i++
	}
	return b.String()
}
