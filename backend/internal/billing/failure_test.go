package billing

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"
)

// Tes klasifikasi galat. Murni: tidak ada jaringan, database, atau jam.

// timeoutNetErr adalah net.Error yang melaporkan timeout, seperti yang dikembalikan
// transport saat batas waktu permintaan habis.
type timeoutNetErr struct{}

func (timeoutNetErr) Error() string   { return "i/o timeout (10.0.0.5:8080)" }
func (timeoutNetErr) Timeout() bool   { return true }
func (timeoutNetErr) Temporary() bool { return true }

// netErr membuat galat jaringan seperti yang dibuat requestError.
func netErr(cause error) error {
	return &networkError{method: "GET", path: "/invoices", cause: cause}
}

type classifyCase struct {
	name      string
	err       error
	kind      FailureKind
	transient bool
	// message adalah pesan persis yang diharapkan.
	message string
	// keepsOld benar bila pesan harus menyebut bahwa status lama dipertahankan.
	keepsOld bool
}

func classifyCases() []classifyCase {
	unknownStatus := &UnknownStatusError{Value: "Belum Bayar", Page: 2, Row: 3}
	cases := []classifyCase{
		// credentials
		{"login ditolak", ErrLoginFailed, FailureCredentials, false, msgLoginRejected, true},
		{"login ditolak dengan rincian scraper",
			fmt.Errorf("%w: HTTP 419; periksa %s dan %s", ErrLoginFailed, EnvUsername, EnvPassword),
			FailureCredentials, false, msgLoginRejected, true},
		{"token CSRF tidak ada", ErrCSRFNotFound, FailureCredentials, false, msgLoginNoCSRF, true},
		{"HTTP 401", &StatusError{Method: "GET", Path: "/invoices", Code: 401}, FailureCredentials, false,
			fmt.Sprintf(msgAccessDenied, 401), true},
		{"HTTP 403", &StatusError{Method: "GET", Path: "/invoices", Code: 403}, FailureCredentials, false,
			fmt.Sprintf(msgAccessDenied, 403), true},
		{"HTTP 419", &StatusError{Method: "POST", Path: "/login", Code: 419}, FailureCredentials, false,
			fmt.Sprintf(msgAccessDenied, 419), true},

		// source_changed
		{"halaman tidak sesuai profil", fmt.Errorf("%w: RowSelector tidak menemukan baris", ErrUnexpectedPage), FailureSourceChanged, false, msgSourceChanged, true},
		{"jawaban terlalu besar", fmt.Errorf("%w: tubuh jawaban lebih dari 100 byte", ErrTooLarge), FailureSourceChanged, false, msgSourceChanged, true},
		{"terlalu banyak pengalihan", ErrTooManyRedirects, FailureSourceChanged, false, msgSourceChanged, true},
		{"pengalihan ke asal lain", fmt.Errorf("GET /invoices: %w", ErrCrossHostRedirect), FailureSourceChanged, false, msgSourceChanged, true},
		// Sesi hilang sesudah login diterima dua kali: akunnya sah, jadi BUKAN credentials
		// (kalau credentials, ia ikut menahan jadwal login) dan bukan sementara.
		{"sesi hilang berulang", fmt.Errorf("%w: sesi hilang lagi (/invoices)", ErrSessionLost), FailureSourceChanged, false, msgSessionLost, true},
		{"HTTP 400", &StatusError{Method: "GET", Path: "/invoices", Code: 400}, FailureSourceChanged, false, fmt.Sprintf(msgUnexpectedHTTP, 400), true},
		{"HTTP 404", &StatusError{Method: "GET", Path: "/invoices", Code: 404}, FailureSourceChanged, false, fmt.Sprintf(msgUnexpectedHTTP, 404), true},
		{"HTTP 408", &StatusError{Method: "GET", Path: "/invoices", Code: 408}, FailureSourceChanged, false, fmt.Sprintf(msgUnexpectedHTTP, 408), true},
		{"HTTP 429", &StatusError{Method: "GET", Path: "/invoices", Code: 429}, FailureSourceChanged, false, fmt.Sprintf(msgUnexpectedHTTP, 429), true},
		{"HTTP 304", &StatusError{Method: "GET", Path: "/invoices", Code: 304}, FailureSourceChanged, false, fmt.Sprintf(msgUnexpectedHTTP, 304), true},
		{"HTTP 499", &StatusError{Method: "GET", Path: "/invoices", Code: 499}, FailureSourceChanged, false, fmt.Sprintf(msgUnexpectedHTTP, 499), true},
		{"ErrHTTPStatus tanpa rincian", ErrHTTPStatus, FailureSourceChanged, false, msgUnexpectedBlank, true},

		// unknown_status
		{"status tidak dikenal", unknownStatus, FailureUnknownStatus, false,
			`Status tagihan tidak dikenal: "Belum Bayar" (halaman 2, baris 3). Tambahkan ke StatusMap profil bila sah. Status lama dipertahankan.`, true},
		{"status tidak dikenal, terbungkus", fmt.Errorf("baca tagihan: %w", unknownStatus), FailureUnknownStatus, false,
			`Status tagihan tidak dikenal: "Belum Bayar" (halaman 2, baris 3). Tambahkan ke StatusMap profil bila sah. Status lama dipertahankan.`, true},
		{"status tidak dikenal tanpa lokasi", &UnknownStatusError{Value: "Aneh"}, FailureUnknownStatus, false,
			`Status tagihan tidak dikenal: "Aneh". Tambahkan ke StatusMap profil bila sah. Status lama dipertahankan.`, true},
		{"status tidak dikenal tanpa nilai", &UnknownStatusError{Page: 1, Row: 1}, FailureUnknownStatus, false, msgUnknownStatusBlank, true},
		{"ErrUnknownStatus tanpa rincian", ErrUnknownStatus, FailureUnknownStatus, false, msgUnknownStatusBlank, true},

		// network, timeout, server_error: sementara
		{"timeout konteks", netErr(context.DeadlineExceeded), FailureTimeout, true, msgNetworkTimeout, true},
		{"timeout jaringan", netErr(&url.Error{Op: "Get", URL: "https://billing.example/internal?token=abc", Err: timeoutNetErr{}}),
			FailureTimeout, true, msgNetworkTimeout, true},
		{"koneksi ditolak", netErr(&net.OpError{Op: "dial", Net: "tcp", Err: errors.New("connection refused")}), FailureNetwork, true, msgNetworkDown, true},
		{"nama host tidak ditemukan", netErr(&net.DNSError{Err: "no such host", Name: "billing.example", IsNotFound: true}), FailureNetwork, true, msgNetworkDown, true},
		{"koneksi terputus", netErr(io.ErrUnexpectedEOF), FailureNetwork, true, msgNetworkDown, true},
		{"sebab tidak dikenal", netErr(errors.New("aneh")), FailureNetwork, true, msgNetworkDown, true},
		{"sertifikat tidak dipercaya", netErr(x509.UnknownAuthorityError{}), FailureNetwork, true, msgNetworkTLS, true},
		{"sertifikat gagal diverifikasi", netErr(&tls.CertificateVerificationError{Err: x509.CertificateInvalidError{Reason: x509.Expired}}), FailureNetwork, true, msgNetworkTLS, true},
		{"HTTP 500", &StatusError{Method: "GET", Path: "/invoices", Code: 500}, FailureServerError, true, fmt.Sprintf(msgServerError, 500), true},
		{"HTTP 502", &StatusError{Method: "GET", Path: "/invoices", Code: 502}, FailureServerError, true, fmt.Sprintf(msgServerError, 502), true},
		{"HTTP 503", &StatusError{Method: "GET", Path: "/invoices", Code: 503}, FailureServerError, true, fmt.Sprintf(msgServerError, 503), true},
		{"HTTP 599", &StatusError{Method: "GET", Path: "/invoices", Code: 599}, FailureServerError, true, fmt.Sprintf(msgServerError, 599), true},

		// sinkron
		{"sumber kosong", ErrEmptyInvoiceSource, FailureEmptySource, false,
			"Sumber billing tidak mengembalikan satu pun tagihan; status lama dipertahankan.", true},
		{"turun drastis", &InvoiceDropError{Previous: 20, Current: 5}, FailureAnomalousDrop, false,
			"Jumlah tagihan turun drastis (dari 20 ke 5). Periksa tampilan sistem billing. Bila penurunan ini memang benar, atur BILLING_DROP_PERCENT. Status lama dipertahankan.", true},
		{"batas waktu sinkron", &reasonError{reason: ErrSyncTimeout, cause: netErr(context.DeadlineExceeded)}, FailureTimeout, true,
			"Sinkron melewati batas waktu.", false},
		{"backend berhenti", &reasonError{reason: ErrSyncCanceled, cause: netErr(context.Canceled)}, FailureCanceled, false,
			"Sinkron dibatalkan karena backend berhenti.", false},
		{"konteks dibatalkan tanpa pembungkus", context.Canceled, FailureCanceled, false,
			"Sinkron dibatalkan karena backend berhenti.", false},
		{"konteks melewati batas tanpa pembungkus", context.DeadlineExceeded, FailureTimeout, true,
			"Sinkron melewati batas waktu.", false},

		// internal
		{"panic", newPanicError("meledak"), FailureInternal, false, "Sinkron berhenti karena kesalahan internal.", false},
		{"galat tidak dikenal", errors.New("pq: koneksi database mati"), FailureInternal, false, "Sinkron berhenti karena kesalahan internal.", false},
		{"galat database terbungkus", fmt.Errorf("billing: simpan status tagihan: %w", errors.New("ERROR: deadlock detected")), FailureInternal, false,
			"Sinkron berhenti karena kesalahan internal.", false},
		{"konfigurasi tidak valid", fmt.Errorf("%w: menit salah", ErrInvalidConfig), FailureInternal, false, "Sinkron berhenti karena kesalahan internal.", false},
		{"tidak dikonfigurasi", ErrNotConfigured, FailureInternal, false, "Sinkron berhenti karena kesalahan internal.", false},
		{"hasil tidak konsisten", fmt.Errorf("%w: Counts", ErrInconsistentResult), FailureInternal, false, "Sinkron berhenti karena kesalahan internal.", false},
	}
	return cases
}

func isTransientKind(k FailureKind) bool {
	return k == FailureNetwork || k == FailureTimeout || k == FailureServerError
}

func TestClassifyTable(t *testing.T) {
	for _, c := range classifyCases() {
		got := Classify(c.err)
		if got.Kind != c.kind || got.Transient != c.transient || got.Message != c.message {
			t.Errorf("%s: Classify = %+v\nwant kind %s, transient %v, pesan %q", c.name, got, c.kind, c.transient, c.message)
		}
	}
}

// Setiap jenis harus tercapai oleh minimal satu kasus, supaya jenis baru tidak
// tertinggal tanpa tes.
func TestClassifyTableCoversEveryKind(t *testing.T) {
	seen := map[FailureKind]bool{}
	for _, c := range classifyCases() {
		seen[c.kind] = true
	}
	for _, kind := range []FailureKind{
		FailureCredentials, FailureSourceChanged, FailureUnknownStatus, FailureNetwork, FailureTimeout,
		FailureServerError, FailureEmptySource, FailureAnomalousDrop, FailureCanceled, FailureInternal,
	} {
		if !seen[kind] {
			t.Errorf("tidak ada kasus untuk jenis %s", kind)
		}
	}
}

// Pembungkus berlapis, errors.Join, dan galat tidak terkait di sekitarnya tidak
// boleh mengubah hasilnya.
func TestClassifyIgnoresWrappers(t *testing.T) {
	wrappers := map[string]func(error) error{
		"fmt.Errorf satu lapis": func(e error) error { return fmt.Errorf("lapisan: %w", e) },
		"fmt.Errorf tiga lapis": func(e error) error {
			return fmt.Errorf("a: %w", fmt.Errorf("b: %w", fmt.Errorf("c: %w", e)))
		},
		"errors.Join di depan":    func(e error) error { return errors.Join(errors.New("tidak terkait"), e) },
		"errors.Join di belakang": func(e error) error { return errors.Join(e, errors.New("tidak terkait")) },
		"Join di dalam Errorf": func(e error) error {
			return fmt.Errorf("luar: %w", errors.Join(errors.New("x"), fmt.Errorf("dalam: %w", e)))
		},
		"catat gagal digabung": func(e error) error {
			return errors.Join(e, fmt.Errorf("billing: catat sinkron gagal: %w", errors.New("tulis gagal")))
		},
	}
	for _, c := range classifyCases() {
		want := Classify(c.err)
		for name, wrap := range wrappers {
			if got := Classify(wrap(c.err)); got != want {
				t.Errorf("%s dengan %s: %+v, want %+v", c.name, name, got, want)
			}
		}
	}
}

func TestClassifyNilIsEmpty(t *testing.T) {
	if got := Classify(nil); got != (Failure{}) {
		t.Errorf("Classify(nil) = %+v, want Failure kosong", got)
	}
}

// Transient benar HANYA untuk network, timeout, dan server_error.
func TestClassifyTransientOnlyForNetworkTimeoutServerError(t *testing.T) {
	for _, c := range classifyCases() {
		got := Classify(c.err)
		if got.Transient != isTransientKind(got.Kind) {
			t.Errorf("%s: jenis %s Transient = %v", c.name, got.Kind, got.Transient)
		}
	}
	// Termasuk untuk semua kode HTTP.
	for code := 100; code <= 599; code++ {
		got := Classify(&StatusError{Method: "GET", Path: "/x", Code: code})
		if got.Transient != isTransientKind(got.Kind) {
			t.Errorf("HTTP %d: jenis %s Transient = %v", code, got.Kind, got.Transient)
		}
		wantTransient := code >= 500
		if got.Transient != wantTransient {
			t.Errorf("HTTP %d: Transient = %v, want %v", code, got.Transient, wantTransient)
		}
		wantCredentials := code == 401 || code == 403 || code == 419
		if (got.Kind == FailureCredentials) != wantCredentials {
			t.Errorf("HTTP %d: jenis %s", code, got.Kind)
		}
	}
}

// Pesan: bahasa Indonesia yang rapi, muat di kolom log, dan menyebut status lama
// dipertahankan bila relevan.
func TestClassifyMessagesAreWellFormed(t *testing.T) {
	for _, c := range classifyCases() {
		m := Classify(c.err).Message
		if strings.TrimSpace(m) == "" {
			t.Errorf("%s: pesan kosong", c.name)
		}
		if n := utf8.RuneCountInString(m); n > MaxErrorLength {
			t.Errorf("%s: pesan %d karakter, melebihi %d", c.name, n, MaxErrorLength)
		}
		if !utf8.ValidString(m) || strings.ContainsFunc(m, func(r rune) bool { return unicode.IsControl(r) }) {
			t.Errorf("%s: pesan memuat karakter tidak sah: %q", c.name, m)
		}
		if m != strings.TrimSpace(m) || !strings.HasSuffix(m, ".") {
			t.Errorf("%s: pesan harus kalimat lengkap yang diakhiri titik: %q", c.name, m)
		}
		if c.keepsOld && !strings.Contains(strings.ToLower(m), "status lama dipertahankan") {
			t.Errorf("%s: pesan tidak menyebut status lama dipertahankan: %q", c.name, m)
		}
		// Pesan yang sama dibaca ulang oleh FailRun apa adanya (tidak ada yang dipangkas).
		if failureMessage(errors.New(m)) != m {
			t.Errorf("%s: failureMessage mengubah pesan %q", c.name, m)
		}
	}
}

// Pesan lama yang diandalkan dashboard dan tes lain tidak berubah.
func TestClassifyKeepsTheLegacyMessages(t *testing.T) {
	for err, want := range map[error]string{
		ErrEmptyInvoiceSource: ErrEmptyInvoiceSource.Error(),
		ErrSyncCanceled:       ErrSyncCanceled.Error(),
		ErrSyncTimeout:        ErrSyncTimeout.Error(),
		ErrSyncPanic:          ErrSyncPanic.Error(),
	} {
		if got := Classify(err).Message; got != want {
			t.Errorf("Classify(%q).Message = %q", want, got)
		}
	}
}

// Galat dibungkus dengan teks yang memuat alamat internal, URL berquery, dan kata
// sandi. Tidak satu pun boleh sampai ke Message, apa pun jenis galatnya.
func TestClassifyNeverLeaksText(t *testing.T) {
	secrets := []string{
		"10.0.0.5", "8080", "billing.example", "token=abc", "/internal", "hunter2-S3kr3t", "S3kr3t!Pass", "dial tcp", "password",
	}
	leak := "dial tcp 10.0.0.5:8080: GET https://billing.example/internal?token=abc gagal (password=hunter2-S3kr3t S3kr3t!Pass)"

	var errs []struct {
		name string
		err  error
	}
	add := func(name string, err error) {
		errs = append(errs, struct {
			name string
			err  error
		}{name, err})
	}
	// Setiap kasus tabel, dibungkus dengan teks bocoran di depan dan di belakang.
	for _, c := range classifyCases() {
		add(c.name+" (di depan)", fmt.Errorf("%s: %w", leak, c.err))
		add(c.name+" (dua lapis)", fmt.Errorf("%s: %w", leak, fmt.Errorf("%s: %w", leak, c.err)))
		add(c.name+" (join)", errors.Join(errors.New(leak), c.err, errors.New(leak)))
	}
	// Galat yang TEKS-nya sendiri memuat bocoran, termasuk tipe milik paket ini
	// yang bagian-bagiannya boleh berisi apa saja.
	add("galat tidak dikenal", errors.New(leak))
	add("ErrNetwork dengan penyebab bocor", netErr(errors.New(leak)))
	add("url.Error", netErr(&url.Error{Op: "Get", URL: "https://billing.example/internal?token=abc", Err: errors.New(leak)}))
	add("StatusError dengan path berquery", &StatusError{Method: "GET", Path: "/internal?token=abc&password=hunter2-S3kr3t", Code: 503})
	add("StatusError 403 dengan path berquery", &StatusError{Method: "GET", Path: "/internal?token=abc", Code: 403})
	add("panic", newPanicError(leak))
	add("alasan henti dengan penyebab bocor", &reasonError{reason: ErrSyncCanceled, cause: errors.New(leak)})
	add("alasan batas waktu dengan penyebab bocor", &reasonError{reason: ErrSyncTimeout, cause: errors.New(leak)})

	for _, e := range errs {
		m := Classify(e.err).Message
		for _, secret := range secrets {
			if strings.Contains(m, secret) {
				t.Errorf("%s: pesan memuat %q: %s", e.name, secret, m)
			}
		}
		// Sebagian galat milik paket ini memang berteks sama dengan pesannya (ErrSyncPanic,
		// alasan henti); yang tidak boleh adalah pesan yang membawa bocoran.
		if strings.Contains(m, leak) {
			t.Errorf("%s: pesan memuat teks mentah galat: %s", e.name, m)
		}
	}
}

// Satu-satunya teks dari halaman yang masuk ke pesan adalah teks status, dan ia
// dibersihkan serta dipotong.
func TestClassifyUnknownStatusValueIsSanitizedAndTruncated(t *testing.T) {
	long := strings.Repeat("a", 5000)
	cases := []struct {
		name  string
		value string
		want  string
	}{
		{"biasa", "Dibayar Sebagian", `"Dibayar Sebagian"`},
		{"spasi dirapatkan", "  Belum \t\n  Bayar  ", `"Belum Bayar"`},
		{"tanda kutip diganti", `Lunas"; DROP`, `"Lunas'; DROP"`},
		{"karakter kendali dibuang", "Lu\x00na\x1b[31ms\x07", `"Luna[31ms"`},
		{"huruf non-ASCII tetap", "Tertunggak – Rp 1.000", `"Tertunggak – Rp 1.000"`},
		{"tepat 40 karakter", strings.Repeat("x", 40), `"` + strings.Repeat("x", 40) + `"`},
		{"41 karakter dipotong", strings.Repeat("x", 41), `"` + strings.Repeat("x", 40) + `…"`},
		{"sangat panjang", long, `"` + strings.Repeat("a", 40) + `…"`},
	}
	for _, c := range cases {
		f := Classify(&UnknownStatusError{Value: c.value, Page: 1, Row: 2})
		if f.Kind != FailureUnknownStatus || !strings.Contains(f.Message, c.want) {
			t.Errorf("%s: pesan %q tidak memuat %s", c.name, f.Message, c.want)
		}
		if n := utf8.RuneCountInString(f.Message); n > MaxErrorLength {
			t.Errorf("%s: pesan %d karakter, melebihi %d", c.name, n, MaxErrorLength)
		}
		if strings.Contains(f.Message, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") { // 41 huruf a
			t.Errorf("%s: nilai tidak dipotong: %q", c.name, f.Message)
		}
	}
	// Hanya karakter kendali: sama dengan tanpa nilai.
	if got := Classify(&UnknownStatusError{Value: "\x00\x01 \x1b", Page: 1, Row: 1}).Message; got != msgUnknownStatusBlank {
		t.Errorf("nilai tanpa karakter tampak: %q", got)
	}
}

// Pesan kegagalan login adalah satu-satunya jejak jenis kegagalan yang tersisa di
// log sinkron. Penjadwal mengenalinya dari pesan itu, jadi pesan setiap jenis harus
// konsisten dengan isCredentialsMessage.
func TestIsCredentialsMessageAgreesWithClassify(t *testing.T) {
	for _, c := range classifyCases() {
		f := Classify(c.err)
		if got := isCredentialsMessage(f.Message); got != (f.Kind == FailureCredentials) {
			t.Errorf("%s: jenis %s, isCredentialsMessage(%q) = %v", c.name, f.Kind, f.Message, got)
		}
	}
	for code := 100; code <= 599; code++ {
		f := Classify(&StatusError{Method: "GET", Path: "/x", Code: code})
		if got := isCredentialsMessage(f.Message); got != (f.Kind == FailureCredentials) {
			t.Errorf("HTTP %d: jenis %s, isCredentialsMessage(%q) = %v", code, f.Kind, f.Message, got)
		}
	}
	for _, msg := range []string{"", " ", RecoveredRunMessage, FallbackFailureMessage, "login ditolak", "Sinkron gagal."} {
		if isCredentialsMessage(msg) {
			t.Errorf("isCredentialsMessage(%q) = true", msg)
		}
	}
}

// Penjaga kesatuan: pemeriksaan "timeout" dan "sertifikat" di teks galat jaringan
// dan di Classify memakai satu fungsi, jadi tidak pernah berselisih.
func TestNetworkErrorTextAndKindAgree(t *testing.T) {
	causes := map[string]error{
		"deadline":    context.DeadlineExceeded,
		"net timeout": timeoutNetErr{},
		"x509":        x509.UnknownAuthorityError{},
		"tls":         &tls.CertificateVerificationError{Err: x509.CertificateInvalidError{Reason: x509.Expired}},
		"refused":     &net.OpError{Op: "dial", Err: errors.New("refused")},
		"eof":         io.EOF,
		"lain":        errors.New("lain"),
	}
	for name, cause := range causes {
		err := netErr(cause)
		f := Classify(err)
		text := err.Error()
		switch f.Kind {
		case FailureTimeout:
			if !strings.Contains(text, "batas waktu habis") {
				t.Errorf("%s: jenis timeout tetapi teks galat %q", name, text)
			}
		case FailureNetwork:
			if strings.Contains(text, "batas waktu habis") {
				t.Errorf("%s: jenis network tetapi teks galat %q", name, text)
			}
			if (f.Message == msgNetworkTLS) != strings.Contains(text, "sertifikat TLS") {
				t.Errorf("%s: pesan %q dan teks galat %q tidak sepakat soal TLS", name, f.Message, text)
			}
		default:
			t.Errorf("%s: jenis %s", name, f.Kind)
		}
	}
}
