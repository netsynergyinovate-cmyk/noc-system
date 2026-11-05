package collector

import (
	"context"
	"log/slog"
	"time"

	"noc-isp/backend/internal/state"
)

const (
	onlineQueueSize           = 8192
	connectionEventRetention  = 400 * 24 * time.Hour
	connectionEventPurgeEvery = 24 * time.Hour

	onlineUpdateSQL          = `UPDATE customers SET is_online = $2, last_updated_at = now() WHERE id = $1::uuid`
	connectionEventInsertSQL = `INSERT INTO customer_connection_events (customer_id, kind, occurred_at, source) ` +
		`SELECT $1::uuid, $2, $3, 'live' ` +
		`WHERE coalesce((SELECT kind FROM customer_connection_events WHERE customer_id = $1::uuid ORDER BY occurred_at DESC, id DESC LIMIT 1), '') <> $2`
	connectionEventPurgeSQL = `DELETE FROM customer_connection_events WHERE occurred_at < $1`
)

// OnlineWriter menulis perubahan status online pelanggan ke kolom
// customers.is_online. Status "hidup" ada di memori Manager (dari polling,
// webhook, syslog); tanpa ini database tertinggal dan semua yang membacanya
// (ekspor, metrik, restart backend) melihat status basi.
type OnlineWriter struct {
	db     Execer
	logger *slog.Logger
	ch     chan state.Change
	now    func() time.Time
}

// NewOnlineWriter membuat penulis. db tidak boleh nil.
func NewOnlineWriter(db Execer, logger *slog.Logger) *OnlineWriter {
	return &OnlineWriter{
		db:     db,
		logger: logger,
		ch:     make(chan state.Change, onlineQueueSize),
		now:    time.Now,
	}
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

// Run menulis perubahan satu per satu sampai ctx selesai dan membersihkan event lama.
func (w *OnlineWriter) Run(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	w.purge(ctx)

	purgeTicker := time.NewTicker(connectionEventPurgeEvery)
	defer purgeTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-purgeTicker.C:
			w.purge(ctx)
		case c := <-w.ch:
			w.writeChange(ctx, c)
		}
	}
}

func (w *OnlineWriter) writeChange(ctx context.Context, c state.Change) {
	if _, err := w.db.Exec(ctx, onlineUpdateSQL, c.After.ID, c.After.IsOnline); err != nil && ctx.Err() == nil {
		w.logger.Warn("status online pelanggan gagal disimpan", "pelanggan", c.After.ID, "error", err)
	}

	kind := "down"
	if c.After.IsOnline {
		kind = "up"
	}
	now := w.now
	if now == nil {
		now = time.Now
	}
	occurredAt := now().UTC()

	if _, err := w.db.Exec(ctx, connectionEventInsertSQL, c.After.ID, kind, occurredAt); err != nil && ctx.Err() == nil {
		w.logger.Warn("event koneksi pelanggan gagal disimpan", "pelanggan", c.After.ID, "error", err)
	}
}

func (w *OnlineWriter) purge(ctx context.Context) {
	now := w.now
	if now == nil {
		now = time.Now
	}
	cutoff := now().UTC().Add(-connectionEventRetention)
	tag, err := w.db.Exec(ctx, connectionEventPurgeSQL, cutoff)
	if err != nil {
		if ctx.Err() == nil {
			w.logger.Warn("pembersihan riwayat koneksi pelanggan lama gagal", "error", err)
		}
		return
	}
	if tag.RowsAffected() > 0 {
		w.logger.Info("riwayat koneksi pelanggan lama dibersihkan", "baris", tag.RowsAffected())
	}
}
