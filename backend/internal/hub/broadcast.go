package hub

import (
	"errors"
	"fmt"
	"time"
)

var errHubClosed = errors.New("hub: sudah berhenti")

// PublishCustomerStatus mengantrekan status terbaru satu pelanggan untuk
// disiarkan. Perubahan berulang pada pelanggan yang sama digabung menjadi
// keadaan terakhir; bila Options.StatusFlush > 0 pesan "status" dikirim setelah
// jeda itu, bila tidak ia ikut delta detik berikutnya.
func (h *Hub) PublishCustomerStatus(customerID string, isOnline bool, opticalDbm *float64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.pending[customerID] = statusChange{
		CustomerID:      customerID,
		IsOnline:        isOnline,
		Status:          statusLabel(isOnline),
		OpticalPowerDbm: opticalDbm,
	}
	if h.opts.StatusFlush > 0 && h.flushTimer == nil {
		h.flushTimer = time.AfterFunc(h.opts.StatusFlush, h.flushStatus)
	}
}

// ClientCount adalah jumlah klien yang sedang tersambung.
func (h *Hub) ClientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// BroadcastRaw menyiarkan satu pesan JSON bebas ke semua klien aktif. Klien yang
// antreannya penuh diputus (ClosePolicyViolation); hub tidak pernah menunggu.
func (h *Hub) BroadcastRaw(msg any) error {
	prepared, err := prepare(msg)
	if err != nil {
		return fmt.Errorf("hub: pesan tidak bisa diserialisasi: %w", err)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return errHubClosed
	}
	for c := range h.clients {
		h.sendLocked(c, prepared)
	}
	return nil
}
