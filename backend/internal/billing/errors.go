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
)

// Galat paket ini dibedakan dengan errors.Is. Pesannya berbahasa Indonesia dan
// tidak pernah memuat kata sandi, token CSRF, nilai cookie, isi form, atau isi
// halaman; hanya metode, path (tanpa query), dan kode status.
var (
	// ErrNotConfigured berarti fitur billing tidak dipakai: BILLING_URL,
	// BILLING_USERNAME, dan BILLING_PASSWORD semuanya kosong. Bukan kegagalan;
	// backend tetap jalan tanpa billing.
	ErrNotConfigured = errors.New("billing: tidak dikonfigurasi")
	// ErrInvalidConfig berarti konfigurasi ada tetapi salah atau tidak lengkap.
	ErrInvalidConfig = errors.New("billing: konfigurasi tidak valid")

	// ErrLoginFailed berarti sistem billing menolak login: kredensial salah,
	// token CSRF ditolak, atau halaman setelah login bukan halaman yang berhasil.
	// Tidak pernah diulang otomatis.
	ErrLoginFailed = errors.New("billing: login ditolak")
	// ErrCSRFNotFound berarti halaman login tidak memuat token CSRF yang cocok
	// dengan Profile.CSRFSelector (atau nilainya kosong).
	ErrCSRFNotFound = errors.New("billing: token CSRF tidak ditemukan di halaman login")
	// ErrSessionLost berarti sesi berakhir lagi setelah login ulang.
	ErrSessionLost = errors.New("billing: sesi berakhir berulang kali")

	// ErrUnexpectedPage berarti HTML tidak sesuai profil: selektor baris atau
	// kolom tidak menemukan apa-apa, atau halaman berulang.
	ErrUnexpectedPage = errors.New("billing: struktur halaman tidak sesuai profil")
	// ErrUnknownStatus berarti teks status tidak ada di Profile.StatusMap. Nilai
	// dan nomor barisnya ada di *UnknownStatusError. Tidak pernah ditebak.
	ErrUnknownStatus = errors.New("billing: status tagihan tidak dikenal")

	// ErrTooLarge berarti jawaban melewati batas: ukuran tubuh, jumlah halaman,
	// atau jumlah baris.
	ErrTooLarge = errors.New("billing: jawaban melebihi batas")
	// ErrTooManyRedirects berarti rantai pengalihan melewati Config.MaxRedirects.
	ErrTooManyRedirects = errors.New("billing: terlalu banyak pengalihan")
	// ErrCrossHostRedirect berarti pengalihan atau tautan menuju asal (skema,
	// host, atau port) yang bukan BaseURL. Ditolak sebelum permintaan dikirim.
	ErrCrossHostRedirect = errors.New("billing: pengalihan ke asal lain ditolak")

	// ErrHTTPStatus berarti sistem billing menjawab dengan status HTTP yang tidak
	// diharapkan. Detailnya ada di *StatusError.
	ErrHTTPStatus = errors.New("billing: jawaban HTTP tidak terduga")
	// ErrNetwork berarti permintaan gagal di jaringan: tidak tersambung, timeout,
	// sertifikat TLS tidak dipercaya, atau jawaban terputus. Penyebab aslinya
	// ikut dibungkus (errors.Is(err, context.DeadlineExceeded), errors.As ke
	// *tls.CertificateVerificationError, dst.) tetapi TIDAK ikut dalam teks galat,
	// karena teks aslinya memuat alamat IP dan port sistem billing.
	ErrNetwork = errors.New("billing: gagal menghubungi sistem billing")
)

// UnknownStatusError menyebut teks status yang tidak dikenal. errors.Is(err,
// ErrUnknownStatus) benar untuknya.
type UnknownStatusError struct {
	// Value adalah teks sel status seperti terbaca (spasi dirapatkan, dipotong
	// bila sangat panjang). Status bukan rahasia.
	Value string
	// Page adalah nomor halaman (mulai 1) dan Row nomor baris data di halaman itu
	// (mulai 1; baris judul tidak dihitung).
	Page, Row int
}

func (e *UnknownStatusError) Error() string {
	return fmt.Sprintf("%s: %q (halaman %d, baris %d); tambahkan ke Profile.StatusMap bila sah",
		ErrUnknownStatus.Error(), e.Value, e.Page, e.Row)
}

func (e *UnknownStatusError) Unwrap() error { return ErrUnknownStatus }

// StatusError menyebut status HTTP yang tidak diharapkan. errors.Is(err,
// ErrHTTPStatus) benar untuknya.
type StatusError struct {
	Method string
	// Path adalah path permintaan tanpa query.
	Path string
	Code int
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("%s: HTTP %d untuk %s %s", ErrHTTPStatus.Error(), e.Code, e.Method, e.Path)
}

func (e *StatusError) Unwrap() error { return ErrHTTPStatus }

// networkError membungkus galat transport. Teksnya hanya kategori; penyebab asli
// tersedia lewat Unwrap.
type networkError struct {
	method, path string
	cause        error
}

func (e *networkError) Error() string {
	return fmt.Sprintf("%s (%s %s): %s", ErrNetwork.Error(), e.method, e.path, describeCause(e.cause))
}

func (e *networkError) Unwrap() []error { return []error{ErrNetwork, e.cause} }

// networkCause menggolongkan penyebab galat jaringan. Satu-satunya tempat yang
// memutuskan "ini timeout" dan "ini sertifikat", dipakai describeCause (teks galat)
// dan Classify (jenis kegagalan), supaya keduanya tidak pernah berselisih.
type networkCause int

const (
	causeOther networkCause = iota
	causeTimeout
	causeTLS
)

// causeOf menggolongkan err. Urutan pemeriksaannya menentukan hasil bila beberapa
// berlaku sekaligus: batas waktu konteks lebih dulu, lalu sertifikat, lalu timeout
// yang dilaporkan lapisan jaringan.
func causeOf(err error) networkCause {
	var (
		netErr  net.Error
		certErr *tls.CertificateVerificationError
		unknown x509.UnknownAuthorityError
		hostErr x509.HostnameError
		invalid x509.CertificateInvalidError
	)
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return causeTimeout
	case errors.As(err, &certErr), errors.As(err, &unknown), errors.As(err, &hostErr), errors.As(err, &invalid):
		return causeTLS
	case errors.As(err, &netErr) && netErr.Timeout():
		return causeTimeout
	}
	return causeOther
}

// describeCause menjelaskan penyebab dalam satu frasa tanpa alamat atau
// sertifikat apa pun.
func describeCause(err error) string {
	var (
		dnsErr   *net.DNSError
		opErr    *net.OpError
		urlError *url.Error
	)
	switch causeOf(err) {
	case causeTimeout:
		return "batas waktu habis"
	case causeTLS:
		return "sertifikat TLS tidak dapat diverifikasi"
	}
	switch {
	case errors.As(err, &dnsErr):
		return "nama host tidak ditemukan"
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "koneksi terputus sebelum jawaban lengkap"
	case errors.As(err, &opErr):
		return "koneksi gagal"
	case errors.As(err, &urlError):
		return "permintaan gagal"
	}
	return "kegagalan jaringan"
}

// truncate memotong s menjadi paling banyak n rune.
func truncate(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return strings.TrimSpace(string(runes[:n])) + "…"
}
