package hub

import (
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait = 10 * time.Second

	// Pesan auth hanya memuat tiket; setelah itu klien tidak perlu mengirim
	// apa pun, jadi batasnya sangat kecil.
	maxAuthBytes   = 4096
	maxClientBytes = 512
)

// client adalah satu koneksi dashboard. Koneksi WebSocket hanya boleh punya satu
// pembaca dan satu penulis pada satu waktu: semua baca terjadi di readPump dan
// semua tulis di writePump.
type client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan *websocket.PreparedMessage
	userID string
	// billingSeen adalah nomor urut perubahan status tagihan terakhir yang sudah
	// termuat di snapshot klien ini (state.Snapshot.BillingSeq). Hanya dibaca dan
	// ditulis di bawah Hub.mu.
	billingSeen uint64

	closeOnce   sync.Once
	done        chan struct{}
	closeCode   int
	closeReason string
}

// close meminta koneksi ditutup dengan kode tertentu. Aman dipanggil berulang
// dan dari goroutine mana pun; hanya panggilan pertama yang berlaku.
func (c *client) close(code int, reason string) {
	c.closeOnce.Do(func() {
		c.closeCode = code
		c.closeReason = reason
		close(c.done)
	})
}

// ServeHTTP menaikkan koneksi ke WebSocket, meminta pesan auth, lalu
// menyiarkan data sampai klien pergi atau hub berhenti.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil) // sudah memeriksa Origin dan membalas error sendiri
	if err != nil {
		return
	}
	c := &client{
		hub:  h,
		conn: conn,
		send: make(chan *websocket.PreparedMessage, h.opts.SendBuffer),
		done: make(chan struct{}),
	}

	if err := c.authenticate(); err != nil {
		h.opts.Logger.Info("koneksi WebSocket ditolak", "reason", err.Error(), "remote", r.RemoteAddr)
		c.reject(websocket.ClosePolicyViolation, "unauthorized")
		return
	}
	if err := h.register(c); err != nil {
		h.opts.Logger.Warn("koneksi WebSocket ditolak", "reason", err.Error(), "user", c.userID)
		c.reject(websocket.CloseTryAgainLater, "server penuh")
		return
	}

	// Koneksi yang terlalu lama diminta memperbarui sesinya (lihat MaxConnectionAge).
	if age := h.opts.MaxConnectionAge; age > 0 {
		limit := time.AfterFunc(age, func() {
			c.close(CloseReauth, "sesi berakhir, sambung ulang dengan tiket baru")
		})
		defer limit.Stop()
	}

	writerDone := make(chan struct{})
	go c.writePump(writerDone)
	c.readPump()
	<-writerDone
}

// authenticate menunggu pesan auth pertama dan memeriksa tiketnya. Sebelum
// lolos, klien tidak menerima data apa pun.
func (c *client) authenticate() error {
	c.conn.SetReadLimit(maxAuthBytes)
	if err := c.conn.SetReadDeadline(time.Now().Add(c.hub.opts.AuthTimeout)); err != nil {
		return err
	}
	var msg authMessage
	if err := c.conn.ReadJSON(&msg); err != nil {
		return fmt.Errorf("pesan auth tidak terbaca: %w", err)
	}
	if msg.Type != typeAuth || msg.Token == "" {
		return errors.New("pesan pertama bukan auth")
	}
	identity, err := c.hub.opts.Verifier.Verify(msg.Token, c.hub.opts.Now())
	if err != nil {
		return err
	}
	c.userID = identity.UserID
	return nil
}

// reject menutup koneksi yang belum terdaftar di hub.
func (c *client) reject(code int, reason string) {
	_ = c.conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(code, reason),
		time.Now().Add(writeWait),
	)
	_ = c.conn.Close()
}

// readPump membaca sampai koneksi putus. Klien hanya boleh membalas ping;
// data apa pun dianggap pelanggaran protokol.
func (c *client) readPump() {
	defer func() {
		c.hub.unregister(c)
		c.close(websocket.CloseNormalClosure, "")
	}()
	c.conn.SetReadLimit(maxClientBytes)
	extend := func() error {
		return c.conn.SetReadDeadline(time.Now().Add(c.hub.opts.PongWait))
	}
	if err := extend(); err != nil {
		return
	}
	c.conn.SetPongHandler(func(string) error { return extend() })
	if _, _, err := c.conn.ReadMessage(); err != nil {
		return
	}
	// Sampai di sini klien mengirim data yang tidak diharapkan.
	c.close(websocket.ClosePolicyViolation, "pesan tidak diharapkan")
}

// writePump mengirim pesan dari antrean dan ping berkala, dan menulis frame
// close saat diminta.
func (c *client) writePump(writerDone chan<- struct{}) {
	ticker := time.NewTicker(c.hub.opts.PingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
		close(writerDone)
	}()
	for {
		select {
		case msg := <-c.send:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				return
			}
			if err := c.conn.WritePreparedMessage(msg); err != nil {
				return
			}
		case <-ticker.C:
			if err := c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
				return
			}
		case <-c.done:
			_ = c.conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(c.closeCode, c.closeReason),
				time.Now().Add(writeWait),
			)
			return
		}
	}
}
