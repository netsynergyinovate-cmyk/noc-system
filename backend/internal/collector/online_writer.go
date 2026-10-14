package collector

import (
	"context"
	"log/slog"

	"noc-isp/backend/internal/state"
)

const (
	onlineQueueSize = 8192
	onlineUpdateSQL = `UPDATE customers SET is_online = $2, last_updated_at = now() WHERE id = $1::uuid`
)

// OnlineWriter menulis perubahan status online pelanggan ke kolom
// customers.is_online. Status "hidup" ada di memori Manager (dari polling,
// webhook, syslog); tanpa ini database tertinggal dan semua yang membacanya
// (ekspor, metrik, restart backend) melihat status basi.
type OnlineWriter struct {
	db     Execer
	logger *slog.Logger
	ch     chan state.Change
}

// NewOnlineWriter membuat penulis. db tidak boleh nil.
func NewOnlineWriter(db Execer, logger *slog.Logger) *OnlineWriter {
	return &OnlineWriter{db: db, logger: logger, ch: make(chan state.Change, onlineQueueSize)}
}

// Notify cocok dipasang sebagai state.Change callback. Tidak pernah memblokir:
// bila antrean penuh, perubahan dibuang dan dicatat (polling berikutnya yang
// mengubah status lagi akan menulis ulang).
func (w *OnlineWriter) Notify(c state.Change) {
	if !c.OnlineChanged() {
		return
	}
	select {
	case w.ch <- c:
	default:
		w.logger.Warn("antrean penulisan status online penuh, satu perubahan dibuang", "pelanggan", c.After.ID)
	}
}

// Run menulis perubahan satu per satu sampai ctx selesai.
func (w *OnlineWriter) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case c := <-w.ch:
			if _, err := w.db.Exec(ctx, onlineUpdateSQL, c.After.ID, c.After.IsOnline); err != nil && ctx.Err() == nil {
				w.logger.Warn("status online pelanggan gagal disimpan", "pelanggan", c.After.ID, "error", err)
			}
		}
	}
}
