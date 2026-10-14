package collector

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// maxResponseBytes membatasi jawaban router yang dibaca. 2.000 queue sekitar
// 300 KB; batas ini jauh di atasnya tetapi mencegah router yang rusak atau
// palsu menghabiskan memori backend.
const maxResponseBytes = 16 << 20

// Target adalah satu router yang dipoll.
type Target struct {
	RouterID string
	// BaseURL berbentuk "https://10.0.0.1" atau "http://10.0.0.1:8080". HTTP polos
	// hanya untuk jaringan manajemen tepercaya karena kata sandi dikirim tanpa
	// enkripsi; karena itu harus ditulis eksplisit.
	BaseURL  string
	Username string
	Password string
}

// Client mengambil data dari satu router lewat REST API RouterOS v7. Semua
// permintaan berupa GET dengan .proplist, supaya jawaban hanya memuat kolom
// yang dibutuhkan.
type Client struct {
	base     *url.URL
	username string
	password string
	http     *http.Client
}

// NewClient memeriksa target dan menyiapkan klien. httpClient menentukan
// timeout dan kepercayaan TLS; nil berarti klien bawaan dengan verifikasi TLS
// penuh. Verifikasi TLS tidak pernah dimatikan di sini.
func NewClient(t Target, httpClient *http.Client) (*Client, error) {
	if t.RouterID == "" {
		return nil, errors.New("collector: RouterID kosong")
	}
	base, err := url.Parse(t.BaseURL)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		return nil, fmt.Errorf("collector: BaseURL router %q harus berbentuk https://host atau http://host", t.RouterID)
	}
	if base.User != nil || base.RawQuery != "" || (base.Path != "" && base.Path != "/") {
		return nil, fmt.Errorf("collector: BaseURL router %q tidak boleh memuat kredensial, path, atau query", t.RouterID)
	}
	if t.Username == "" {
		return nil, fmt.Errorf("collector: username router %q kosong", t.RouterID)
	}
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	return &Client{base: base, username: t.Username, password: t.Password, http: httpClient}, nil
}

// get meminta /rest/<segments...>?.proplist=<proplist> dan mengembalikan isi
// jawaban. Pesan error ditulis supaya bisa langsung ditampilkan ke petugas dan
// tidak memuat kata sandi, URL, atau isi jawaban error router.
func (c *Client) get(ctx context.Context, proplist string, segments ...string) ([]byte, error) {
	endpoint := c.base.JoinPath(append([]string{"rest"}, segments...)...)
	endpoint.RawQuery = url.Values{".proplist": {proplist}}.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hubungi router: %w", sanitize(err))
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Isi jawaban error tidak dibaca ke log karena bisa memuat data router.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		switch resp.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return nil, fmt.Errorf("router menolak login (HTTP %d): periksa username dan kata sandi", resp.StatusCode)
		case http.StatusNotFound:
			return nil, fmt.Errorf("router menjawab HTTP 404: layanan REST (www/www-ssl) belum aktif atau RouterOS di bawah v7.1")
		}
		return nil, fmt.Errorf("router menjawab HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("baca jawaban router: %w", sanitize(err))
	}
	if len(body) > maxResponseBytes {
		return nil, fmt.Errorf("jawaban router lebih dari %d MB", maxResponseBytes>>20)
	}
	return body, nil
}

// sanitize membuang URL dari error jaringan supaya log tidak memuat alamat
// lengkap beserta query-nya. Alamat router sudah ada di konteks pemanggil.
func sanitize(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return urlErr.Err
	}
	return err
}
