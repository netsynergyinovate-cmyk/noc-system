package collector

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"sync"
)

// ClientPool menyimpan satu Client per router untuk seluruh proses backend.
// Tujuannya: setelah router terdaftar dan pertama kali dihubungi, semua fitur
// (poller, impor, diagnosa, API baca) memakai sesi yang sama. Login ke router
// hanya terjadi saat client pertama dibuat; selama koneksinya sehat tidak ada
// login baru untuk setiap aksi.
type ClientPool struct {
	mu      sync.Mutex
	clients map[string]pooledClient
}

type pooledClient struct {
	client      *Client
	fingerprint string
}

func NewClientPool() *ClientPool {
	return &ClientPool{clients: make(map[string]pooledClient)}
}

// Get mengembalikan client yang sudah ada untuk router t, atau membuat satu
// client baru bila belum ada / konfigurasi target berubah.
func (p *ClientPool) Get(t Target, httpClient *http.Client) (*Client, error) {
	fingerprint := targetFingerprint(t)

	p.mu.Lock()
	if existing, ok := p.clients[t.RouterID]; ok && existing.fingerprint == fingerprint {
		p.mu.Unlock()
		return existing.client, nil
	}
	p.mu.Unlock()

	client, err := NewClient(t, httpClient)
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	// Bisa balapan dengan goroutine lain; pakai yang lebih dulu tersimpan agar
	// semua pemanggil berbagi objek dan koneksi yang sama.
	if existing, ok := p.clients[t.RouterID]; ok && existing.fingerprint == fingerprint {
		return existing.client, nil
	}
	p.clients[t.RouterID] = pooledClient{client: client, fingerprint: fingerprint}
	return client, nil
}

// Drop membuang client router, mis. setelah kredensial ditolak. Pemanggilan
// berikutnya akan membuat client (dan login) baru dengan target terbaru.
func (p *ClientPool) Drop(routerID string) {
	p.mu.Lock()
	delete(p.clients, routerID)
	p.mu.Unlock()
}

func targetFingerprint(t Target) string {
	// Password ikut di-hash agar perubahan kredensial tidak memakai sesi lama,
	// tetapi kata sandi tidak disimpan sebagai kunci teks di memori.
	sum := sha256.Sum256([]byte(t.BaseURL + "\x00" + t.Protocol + "\x00" + t.Username + "\x00" + t.Password))
	return hex.EncodeToString(sum[:])
}
