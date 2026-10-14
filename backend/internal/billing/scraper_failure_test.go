package billing

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// Galat NYATA dari Scraper (server billing tiruan, tanpa database) dan
// penggolongannya. Tes ini memastikan Classify cocok dengan galat yang benar-benar
// dihasilkan scraper, bukan hanya dengan galat buatan tangan.

// timeoutTransport meniru batas waktu permintaan tanpa menunggu: setiap permintaan
// langsung gagal dengan net.Error yang melaporkan timeout.
type timeoutTransport struct{}

func (timeoutTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, timeoutNetErr{}
}

type scraperFailureCase struct {
	name string
	// setup menyiapkan server dan mengembalikan perubahan konfigurasi serta opsi scraper.
	setup     func(f *fakeBilling) (func(*Config), []Option)
	tls       bool
	ctx       func(context.Context) (context.Context, context.CancelFunc)
	kind      FailureKind
	transient bool
	// message adalah pesan persis; kosong berarti hanya jenisnya yang diperiksa.
	message string
}

func scraperFailureCases() []scraperFailureCase {
	rows500 := func(w http.ResponseWriter, code int) { http.Error(w, "gangguan", code) }
	return []scraperFailureCase{
		{name: "kata sandi salah (dialihkan ke login)", setup: func(f *fakeBilling) (func(*Config), []Option) {
			return func(c *Config) { c.Password = "salah-" + fakePass }, nil
		}, kind: FailureCredentials, message: msgLoginRejected},
		{name: "kata sandi salah (halaman login dirender ulang)", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.loginFail = "rerender"
			return func(c *Config) { c.Password = "salah-" + fakePass }, nil
		}, kind: FailureCredentials, message: msgLoginRejected},
		{name: "kata sandi salah (HTTP 422)", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.loginFail = "422"
			return func(c *Config) { c.Password = "salah-" + fakePass }, nil
		}, kind: FailureCredentials, message: msgLoginRejected},
		{name: "token CSRF basi (HTTP 419)", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.breakToken = true
			return nil, nil
		}, kind: FailureCredentials, message: msgLoginRejected},
		{name: "token CSRF tidak ada", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.csrf = "none"
			return nil, nil
		}, kind: FailureCredentials, message: msgLoginNoCSRF},
		{name: "token CSRF kosong", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.csrf = "empty"
			return nil, nil
		}, kind: FailureCredentials, message: msgLoginNoCSRF},
		{name: "halaman tagihan melarang akses (HTTP 403)", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.override = func(w http.ResponseWriter, r *http.Request) { rows500(w, 403) }
			return nil, nil
		}, kind: FailureCredentials, message: fmt.Sprintf(msgAccessDenied, 403)},

		{name: "halaman tagihan tidak ada (HTTP 404)", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.override = func(w http.ResponseWriter, r *http.Request) { rows500(w, 404) }
			return nil, nil
		}, kind: FailureSourceChanged, message: fmt.Sprintf(msgUnexpectedHTTP, 404)},
		{name: "tabel tagihan hilang", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.override = func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprint(w, "<html><body><p>Sedang dalam perbaikan</p></body></html>")
			}
			return nil, nil
		}, kind: FailureSourceChanged, message: msgSourceChanged},
		{name: "tautan halaman berikutnya ke host lain", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.nextHost = "http://host-lain.invalid"
			return func(c *Config) {
				c.Profile = DefaultProfile()
				c.Profile.InvoicesPath = "/invoices"
				c.Profile.NextSelector = `a[rel="next"]`
			}, nil
		}, kind: FailureSourceChanged, message: msgSourceChanged},
		{name: "pengalihan berputar", setup: func(f *fakeBilling) (func(*Config), []Option) {
			return func(c *Config) {
				c.Profile = DefaultProfile()
				c.Profile.InvoicesPath = "/loop/a"
			}, nil
		}, kind: FailureSourceChanged, message: msgSourceChanged},
		{name: "jawaban terlalu besar", setup: func(f *fakeBilling) (func(*Config), []Option) {
			return func(c *Config) { c.MaxBodyBytes = 100 }, nil
		}, kind: FailureSourceChanged, message: msgSourceChanged},
		{name: "terlalu banyak halaman", setup: func(f *fakeBilling) (func(*Config), []Option) {
			return func(c *Config) { c.MaxPages = 1 }, nil
		}, kind: FailureSourceChanged, message: msgSourceChanged},
		{name: "sesi hilang terus walau login diterima", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.denyInvoices = true
			f.loginCap = 20
			return nil, nil
		}, kind: FailureSourceChanged, message: msgSessionLost},

		{name: "status tagihan tidak dikenal", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.rows[1].Status = "Aneh Sekali"
			return nil, nil
		}, kind: FailureUnknownStatus,
			message: `Status tagihan tidak dikenal: "Aneh Sekali" (halaman 1, baris 2). Tambahkan ke StatusMap profil bila sah. Status lama dipertahankan.`},

		{name: "sistem billing mati", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.srv.Close()
			return nil, nil
		}, kind: FailureNetwork, transient: true, message: msgNetworkDown},
		{name: "permintaan melewati batas waktu", setup: func(f *fakeBilling) (func(*Config), []Option) {
			return nil, []Option{WithTransport(timeoutTransport{})}
		}, kind: FailureTimeout, transient: true, message: msgNetworkTimeout},
		{name: "sertifikat TLS tidak dipercaya", tls: true, setup: func(f *fakeBilling) (func(*Config), []Option) {
			return nil, nil
		}, kind: FailureNetwork, transient: true, message: msgNetworkTLS},
		{name: "gangguan server (HTTP 503)", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.override = func(w http.ResponseWriter, r *http.Request) { rows500(w, 503) }
			return nil, nil
		}, kind: FailureServerError, transient: true, message: fmt.Sprintf(msgServerError, 503)},
		{name: "gangguan server (HTTP 500 dengan rahasia di tubuh)", setup: func(f *fakeBilling) (func(*Config), []Option) {
			f.override = func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(500)
				fmt.Fprint(w, "password="+fakePass+" cookie sid=abc token=def")
			}
			return nil, nil
		}, kind: FailureServerError, transient: true, message: fmt.Sprintf(msgServerError, 500)},

		{name: "konteks dibatalkan", setup: func(f *fakeBilling) (func(*Config), []Option) { return nil, nil },
			ctx: func(c context.Context) (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(c)
				cancel()
				return ctx, cancel
			}, kind: FailureCanceled, message: msgCanceled},
		{name: "konteks melewati batas waktu", setup: func(f *fakeBilling) (func(*Config), []Option) { return nil, nil },
			ctx: func(c context.Context) (context.Context, context.CancelFunc) {
				return context.WithDeadline(c, time.Unix(1, 0))
			}, kind: FailureTimeout, transient: true, message: msgTimeout},
	}
}

func TestRealScraperFailuresAreClassifiedAndSafe(t *testing.T) {
	for _, c := range scraperFailureCases() {
		t.Run(c.name, func(t *testing.T) {
			f := newFakeWith(t, sampleRows(), c.tls)
			mutate, opts := c.setup(f)
			s := newTestScraper(t, f, mutate, opts...)
			ctx := testCtx(t)
			if c.ctx != nil {
				var cancel context.CancelFunc
				ctx, cancel = c.ctx(ctx)
				defer cancel()
			}

			list, _, err := s.Invoices(ctx)
			if err == nil || list != nil {
				t.Fatalf("Invoices = %v, %v; want galat dan tanpa daftar", list, err)
			}
			got := Classify(err)
			if got.Kind != c.kind || got.Transient != c.transient {
				t.Fatalf("Classify(%v) = %+v; want jenis %s, sementara %v", err, got, c.kind, c.transient)
			}
			if c.message != "" && got.Message != c.message {
				t.Errorf("pesan = %q, want %q", got.Message, c.message)
			}

			// Tidak ada alamat server tiruan, nama pelanggan, atau rahasia di pesan.
			u, _ := url.Parse(f.srv.URL)
			banned := append(f.secrets(), u.Host, u.Port(), "127.0.0.1", "salah-"+fakePass, "token=def", "sid=abc", "host-lain.invalid", "/invoices")
			for _, row := range sampleRows() {
				banned = append(banned, row.Name, row.Ref)
			}
			for _, secret := range banned {
				if secret != "" && strings.Contains(got.Message, secret) {
					t.Errorf("pesan memuat %q: %s", secret, got.Message)
				}
			}
		})
	}
}

// Pembacaan yang gagal membuang sesinya: pemanggilan berikutnya (ulangan dalam
// sinkron yang sama) login dari awal dengan sesi dan token baru. Pembacaan yang
// berhasil meninggalkan sesinya untuk dipakai ulang (TestSessionIsReusedAcrossCalls).
func TestScraperFailedReadStartsTheNextReadWithAFreshLogin(t *testing.T) {
	for name, fail := range map[string]func(w http.ResponseWriter){
		"HTTP 503 di halaman pertama": func(w http.ResponseWriter) { http.Error(w, "gangguan", 503) },
		"tabel hilang":                func(w http.ResponseWriter) { fmt.Fprint(w, "<html><body>kosong</body></html>") },
	} {
		f := newFake(t, sampleRows())
		failures := 1
		f.override = func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			left := failures
			if left > 0 {
				failures--
			}
			body := f.invoicesHTML(r)
			f.mu.Unlock()
			if left > 0 {
				fail(w)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, body)
		}
		s := newTestScraper(t, f, nil)
		ctx := testCtx(t)

		if _, _, err := s.Invoices(ctx); err == nil {
			t.Fatalf("%s: pembacaan pertama seharusnya gagal", name)
		}
		firstIssued := f.snapshot().issued
		got, _, err := s.Invoices(ctx)
		if err != nil || len(got) != len(sampleRows()) {
			t.Fatalf("%s: pembacaan kedua = %d tagihan, %v", name, len(got), err)
		}
		c := f.snapshot()
		if c.loginPosts != 2 || c.loginGets != 2 {
			t.Errorf("%s: login POST %d, GET %d; want 2 dan 2 (ulangan harus login dari awal)", name, c.loginPosts, c.loginGets)
		}
		if c.issued <= firstIssued {
			t.Errorf("%s: sesi dan token baru tidak diterbitkan untuk ulangan", name)
		}

		// Sesudah berhasil, sesi dipakai ulang lagi.
		if _, _, err := s.Invoices(ctx); err != nil {
			t.Fatalf("%s: pembacaan ketiga: %v", name, err)
		}
		if c := f.snapshot(); c.loginPosts != 2 {
			t.Errorf("%s: login %d kali; sesi yang berhasil harus dipakai ulang", name, c.loginPosts)
		}
	}
}

// Login yang ditolak tidak pernah diulang oleh scraper sendiri: satu POST per panggilan.
func TestScraperRejectedLoginIsOnePostPerCall(t *testing.T) {
	f := newFake(t, sampleRows())
	s := newTestScraper(t, f, func(c *Config) { c.Password = "salah-" + fakePass })
	for i := 1; i <= 3; i++ {
		if _, _, err := s.Invoices(testCtx(t)); err == nil {
			t.Fatal("seharusnya gagal")
		}
		if got := f.snapshot().loginPosts; got != i {
			t.Errorf("setelah %d panggilan: %d POST login, want %d", i, got, i)
		}
	}
}
