package collector

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// errBadCipher sengaja tidak memuat detail: pesan galat dekripsi tidak boleh
// membantu menebak kunci atau isi.
var errBadCipher = errors.New("kata sandi terenkripsi tidak valid atau kunci salah")

// normalizeKey meniru normalizeKey di src/lib/encryption-core.ts: kunci tepat
// 32 byte dipakai apa adanya, panjang lain diturunkan lewat SHA-256.
func normalizeKey(secret string) []byte {
	raw := []byte(secret)
	if len(raw) == 32 {
		return raw
	}
	sum := sha256.Sum256(raw)
	return sum[:]
}

// DecryptCredential membuka kata sandi router yang ditulis aplikasi Next.js:
// AES-256-GCM, base64 "iv:tag:ciphertext", kunci DEVICE_SECRET. Format ini
// dikunci oleh test dengan data yang dihasilkan Node.
func DecryptCredential(data, secret string) (string, error) {
	if strings.TrimSpace(secret) == "" {
		return "", errors.New("DEVICE_SECRET kosong: backend tidak bisa membuka kata sandi router")
	}
	parts := strings.Split(data, ":")
	if len(parts) != 3 {
		return "", errBadCipher
	}
	iv, err1 := base64.StdEncoding.DecodeString(parts[0])
	tag, err2 := base64.StdEncoding.DecodeString(parts[1])
	enc, err3 := base64.StdEncoding.DecodeString(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		return "", errBadCipher
	}
	block, err := aes.NewCipher(normalizeKey(secret))
	if err != nil {
		return "", errBadCipher
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(iv) != gcm.NonceSize() || len(tag) != gcm.Overhead() {
		return "", errBadCipher
	}
	// Go membaca ciphertext dengan tag di belakangnya.
	plain, err := gcm.Open(nil, iv, append(enc, tag...), nil)
	if err != nil {
		return "", errBadCipher
	}
	return string(plain), nil
}

// BaseURLFromHost mengubah isi kolom routers.host menjadi BaseURL klien. Aturan
// TLS sama dengan sisi Next.js (impliesTls): skema "https://" atau port 443/8443
// berarti HTTPS, selain itu HTTP. Host tidak boleh memuat path, query, atau
// kredensial.
func BaseURLFromHost(host string) (string, error) {
	h := strings.TrimSpace(host)
	scheme := ""
	if i := strings.Index(h, "://"); i >= 0 {
		scheme = strings.ToLower(h[:i])
		h = h[i+3:]
		if scheme != "http" && scheme != "https" {
			return "", fmt.Errorf("host router %q: skema harus http atau https", host)
		}
	}
	h = strings.TrimSuffix(h, "/")
	if h == "" || strings.ContainsAny(h, "/?#@ \t") {
		return "", fmt.Errorf("host router %q tidak valid", host)
	}
	if scheme == "" {
		scheme = "http"
		if _, port, err := net.SplitHostPort(h); err == nil && (port == "443" || port == "8443") {
			scheme = "https"
		}
	}
	return scheme + "://" + h, nil
}

// isAPIProtocolPort: 8728/8729 adalah API biner RouterOS, bukan REST.
func isAPIProtocolPort(baseURL string) bool {
	hostPort := baseURL[strings.Index(baseURL, "://")+3:]
	_, port, err := net.SplitHostPort(hostPort)
	return err == nil && (port == "8728" || port == "8729")
}

// normalizeProtocol: kolom routers.protocol kosong (data lama) berarti REST.
func normalizeProtocol(protocol string) string {
	if strings.EqualFold(strings.TrimSpace(protocol), "api") {
		return "api"
	}
	return "rest"
}

// APIBaseURL menormalkan BaseURL menjadi host:port API biner. Port 8729 atau
// skema https memakai TLS; tanpa port dipakai 8728 (bukan 80/443 yang milik
// layanan REST).
func APIBaseURL(baseURL string) (string, error) {
	u, err := url.Parse(baseURL)
	if err != nil || u.Hostname() == "" {
		return "", errors.New("alamat API tidak valid")
	}
	port := u.Port()
	useTLS := u.Scheme == "https"
	if port == "" {
		port = "8728"
		if useTLS {
			port = "8729"
		}
	} else if port != "8728" && port != "8729" {
		// Router lama menyimpan alamat www (80/443) bersama protokol api:
		// alihkan ke port API yang setara, jangan hubungi port REST.
		if port == "443" || port == "8443" {
			port = "8729"
		} else {
			port = "8728"
		}
	}
	if port == "8729" {
		useTLS = true
	}
	scheme := "http"
	if useTLS {
		scheme = "https"
	}
	return scheme + "://" + net.JoinHostPort(u.Hostname(), port), nil
}
