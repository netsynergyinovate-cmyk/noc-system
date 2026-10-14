package billing

import (
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"
)

// Nama environment variable. Fitur billing opsional: bila ketiganya kosong
// ConfigFromEnv mengembalikan ErrNotConfigured dan backend berjalan tanpanya.
const (
	EnvURL      = "BILLING_URL"
	EnvUsername = "BILLING_USERNAME"
	EnvPassword = "BILLING_PASSWORD"
)

// Batas bawaan. Nol pada Config berarti nilai ini.
const (
	// DefaultTimeout adalah batas waktu TOTAL satu permintaan (termasuk pengalihan
	// dan pembacaan tubuh).
	DefaultTimeout = 30 * time.Second
	// DefaultMaxBodyBytes membatasi tubuh satu halaman SETELAH dekompresi. 5 MB
	// jauh di atas halaman tagihan biasa (ratusan baris, puluhan KB) tetapi
	// menghentikan jawaban palsu atau rusak.
	DefaultMaxBodyBytes int64 = 5 << 20
	// DefaultMaxRedirects adalah rantai pengalihan terpanjang yang diikuti.
	DefaultMaxRedirects = 5
	// DefaultMaxPages adalah jumlah halaman tagihan terbanyak yang dibaca
	// (halaman penutup yang kosong ikut dihitung).
	DefaultMaxPages = 200
	// DefaultMaxRows adalah jumlah baris data terbanyak dari semua halaman.
	DefaultMaxRows = 50_000
)

// Config adalah pengaturan satu sistem billing. Kredensial datang dari
// konfigurasi (ConfigFromEnv), tidak pernah dari kode.
type Config struct {
	// BaseURL berbentuk "https://billing.example.com" atau dengan awalan path
	// ("https://host/billing"). Hanya http atau https; tanpa kredensial, query,
	// atau fragmen. Path di Profile ditafsirkan relatif terhadapnya. HTTP polos
	// mengirim kata sandi tanpa enkripsi, hanya untuk jaringan manajemen tepercaya.
	BaseURL  string
	Username string
	// Password dikirim apa adanya (tanpa dirapikan) dan tidak pernah dicatat.
	Password string

	// Profile menentukan cara membaca situs. Nilai nol berarti DefaultProfile().
	// Untuk menyesuaikan, mulai dari DefaultProfile() lalu ubah kolomnya.
	Profile Profile

	// Timeout, MaxBodyBytes, MaxRedirects, MaxPages, dan MaxRows: nol berarti
	// bawaan (Default*), negatif tidak valid.
	Timeout      time.Duration
	MaxBodyBytes int64
	MaxRedirects int
	MaxPages     int
	MaxRows      int
}

// ConfigFromEnv membaca BILLING_URL, BILLING_USERNAME, dan BILLING_PASSWORD
// lewat getenv (os.Getenv di program, fungsi palsu di test).
//
//   - Ketiganya kosong: ErrNotConfigured (fitur tidak dipakai).
//   - Sebagian terisi atau URL tidak sah: galat yang membungkus ErrInvalidConfig
//     dan menyebut nama variabelnya, tidak pernah nilainya.
//
// URL dan username dibuang spasi di ujungnya; kata sandi dipakai apa adanya
// supaya kata sandi yang memang berspasi di ujung tetap bisa dipakai.
func ConfigFromEnv(getenv func(string) string) (Config, error) {
	cfg := Config{
		BaseURL:  strings.TrimSpace(getenv(EnvURL)),
		Username: strings.TrimSpace(getenv(EnvUsername)),
		Password: getenv(EnvPassword),
		Profile:  DefaultProfile(),
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Validate memeriksa konfigurasi tanpa menghubungi jaringan. Semua kegagalannya
// membungkus ErrInvalidConfig, kecuali konfigurasi yang kosong sama sekali
// (ErrNotConfigured).
func (c Config) Validate() error {
	_, err := c.prepare()
	return err
}

// withDefaults mengisi nilai bawaan pada kolom yang nol.
func (c Config) withDefaults() Config {
	if isZeroProfile(c.Profile) {
		c.Profile = DefaultProfile()
	}
	if c.Timeout == 0 {
		c.Timeout = DefaultTimeout
	}
	if c.MaxBodyBytes == 0 {
		c.MaxBodyBytes = DefaultMaxBodyBytes
	}
	if c.MaxRedirects == 0 {
		c.MaxRedirects = DefaultMaxRedirects
	}
	if c.MaxPages == 0 {
		c.MaxPages = DefaultMaxPages
	}
	if c.MaxRows == 0 {
		c.MaxRows = DefaultMaxRows
	}
	return c
}

// prepared adalah konfigurasi yang sudah diperiksa beserta turunannya.
type prepared struct {
	cfg    Config
	base   *url.URL
	prefix string // awalan path BaseURL tanpa garis miring di ujung; boleh kosong
	prof   compiledProfile
}

func (c Config) prepare() (prepared, error) {
	if c.BaseURL == "" && c.Username == "" && c.Password == "" {
		return prepared{}, ErrNotConfigured
	}
	cfg := c.withDefaults()

	var missing []string
	if cfg.BaseURL == "" {
		missing = append(missing, EnvURL)
	}
	if cfg.Username == "" {
		missing = append(missing, EnvUsername)
	}
	if cfg.Password == "" {
		missing = append(missing, EnvPassword)
	}
	if len(missing) > 0 {
		return prepared{}, fmt.Errorf("%w: %s kosong (ketiganya harus diisi bila billing dipakai)",
			ErrInvalidConfig, strings.Join(missing, ", "))
	}

	// Pesan sengaja tidak memuat nilai URL: bila salah ketik, URL bisa membawa
	// kata sandi (https://pengguna:sandi@host).
	base, err := url.Parse(cfg.BaseURL)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Hostname() == "" {
		return prepared{}, fmt.Errorf("%w: %s harus berbentuk https://host atau http://host", ErrInvalidConfig, EnvURL)
	}
	if base.User != nil || base.RawQuery != "" || base.ForceQuery || base.Fragment != "" {
		return prepared{}, fmt.Errorf("%w: %s tidak boleh memuat kredensial, query, atau fragmen", ErrInvalidConfig, EnvURL)
	}

	switch {
	case cfg.Timeout < 0:
		return prepared{}, fmt.Errorf("%w: Timeout tidak boleh negatif", ErrInvalidConfig)
	case cfg.MaxBodyBytes < 0:
		return prepared{}, fmt.Errorf("%w: MaxBodyBytes tidak boleh negatif", ErrInvalidConfig)
	case cfg.MaxRedirects < 0:
		return prepared{}, fmt.Errorf("%w: MaxRedirects tidak boleh negatif", ErrInvalidConfig)
	case cfg.MaxPages < 0:
		return prepared{}, fmt.Errorf("%w: MaxPages tidak boleh negatif", ErrInvalidConfig)
	case cfg.MaxRows < 0:
		return prepared{}, fmt.Errorf("%w: MaxRows tidak boleh negatif", ErrInvalidConfig)
	}

	prof, err := cfg.Profile.compile()
	if err != nil {
		return prepared{}, err
	}
	return prepared{
		cfg:    cfg,
		base:   base,
		prefix: strings.TrimRight(base.EscapedPath(), "/"),
		prof:   prof,
	}, nil
}

const redacted = "[disembunyikan]"

// safeBaseURL membuang kredensial dari URL sebelum dicetak.
func safeBaseURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "(tidak valid)"
	}
	u.User = nil
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

// String mencetak konfigurasi tanpa kata sandi, supaya %v, %+v, dan %s di log
// aman. GoString melakukan hal yang sama untuk %#v.
func (c Config) String() string {
	password := "(kosong)"
	if c.Password != "" {
		password = redacted
	}
	return fmt.Sprintf("billing.Config{BaseURL: %s, Username: %s, Password: %s, Timeout: %s}",
		safeBaseURL(c.BaseURL), c.Username, password, c.Timeout)
}

// GoString lihat String.
func (c Config) GoString() string { return c.String() }

// LogValue membuat slog mencetak konfigurasi tanpa kata sandi.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("base_url", safeBaseURL(c.BaseURL)),
		slog.String("username", c.Username),
		slog.Duration("timeout", c.Timeout),
	)
}
