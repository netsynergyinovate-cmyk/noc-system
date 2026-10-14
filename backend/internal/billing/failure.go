package billing

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode"
)

// FailureKind menggolongkan penyebab sebuah sinkron gagal. Penggolongan inilah
// yang menentukan apa yang boleh dilakukan sesudahnya: diulang sekarang, menunggu
// jam berikutnya, atau menunggu manusia.
type FailureKind string

const (
	// FailureCredentials: sistem billing menolak login atau akses akun. TIDAK
	// pernah diulang dalam satu sinkron, dan beruntun-beruntun menahan jadwal
	// (lihat Scheduler): login yang ditolak berulang bisa mengunci akun billing.
	FailureCredentials FailureKind = "credentials"
	// FailureSourceChanged: sistem billing menjawab, tetapi bukan seperti yang
	// profil harapkan (halaman berubah, terlalu besar, pengalihan aneh, sesi
	// hilang terus, kode HTTP 4xx). Menunggu manusia menyesuaikan profil.
	FailureSourceChanged FailureKind = "source_changed"
	// FailureUnknownStatus: ada teks status tagihan yang tidak ada di
	// Profile.StatusMap. Tidak ditebak; menunggu manusia.
	FailureUnknownStatus FailureKind = "unknown_status"
	// FailureNetwork: sistem billing tidak dapat dihubungi. Sementara.
	FailureNetwork FailureKind = "network"
	// FailureTimeout: sistem billing atau sinkron kehabisan waktu. Sementara.
	FailureTimeout FailureKind = "timeout"
	// FailureServerError: sistem billing menjawab 5xx. Sementara.
	FailureServerError FailureKind = "server_error"
	// FailureEmptySource: sumber tidak mengembalikan satu pun tagihan.
	FailureEmptySource FailureKind = "empty_source"
	// FailureAnomalousDrop: jumlah tagihan turun drastis dibanding sinkron
	// berhasil terakhir.
	FailureAnomalousDrop FailureKind = "anomalous_drop"
	// FailureCanceled: backend berhenti di tengah sinkron.
	FailureCanceled FailureKind = "canceled"
	// FailureInternal: galat yang tidak dikenal, termasuk database dan panic.
	// Rinciannya hanya ada di log server.
	FailureInternal FailureKind = "internal"
)

// Failure adalah penggolongan satu galat sinkron.
type Failure struct {
	Kind FailureKind
	// Message adalah kalimat Indonesia untuk petugas. Inilah yang disimpan di
	// billing_sync_runs.error_message dan tampil di dashboard. Paling banyak
	// MaxErrorLength karakter, dan hanya disusun dari kalimat tetap, bilangan, dan
	// (untuk status yang tidak dikenal) teks status yang sudah dibersihkan dan
	// dipotong: tidak pernah teks mentah dari galat, jadi tidak ada alamat IP,
	// port, host, URL, query, kata sandi, atau token di dalamnya.
	Message string
	// Transient benar bila mengulang sebentar lagi masuk akal berhasil, dan
	// mengulang tidak berbahaya: hanya network, timeout, dan server_error.
	Transient bool
}

// Pesan tetap. Kalimat yang sama dipakai di Classify dan di pembacaan ulang log
// (isCredentialsMessage), jadi mengubahnya berarti menyentuh kedua tempat itu;
// tes memastikan keduanya searah.
const (
	keepOldStatuses = " Status lama dipertahankan."

	msgLoginRejected = "Login ke sistem billing ditolak. Periksa BILLING_USERNAME dan BILLING_PASSWORD." + keepOldStatuses
	msgLoginNoCSRF   = "Login ke sistem billing tidak dapat dilakukan: halaman login tidak memuat token CSRF yang dikenali. " +
		"Periksa tampilan halaman login serta BILLING_USERNAME dan BILLING_PASSWORD." + keepOldStatuses
	msgAccessDenied = "Sistem billing menolak akses akun (HTTP %d). Periksa BILLING_USERNAME, BILLING_PASSWORD, dan hak akses akun billing." +
		keepOldStatuses

	msgSourceChanged   = "Tampilan sistem billing berubah; selektor profil perlu disesuaikan." + keepOldStatuses
	msgSessionLost     = "Sesi sistem billing berakhir berulang kali walau login diterima; periksa hak akses akun billing dan profil login." + keepOldStatuses
	msgUnexpectedHTTP  = "Sistem billing menjawab dengan status HTTP %d yang tidak diharapkan; periksa alamat dan profil billing." + keepOldStatuses
	msgUnexpectedBlank = "Sistem billing menjawab dengan status HTTP yang tidak diharapkan; periksa alamat dan profil billing." + keepOldStatuses

	msgUnknownStatus      = "Status tagihan tidak dikenal: \"%s\"%s. Tambahkan ke StatusMap profil bila sah." + keepOldStatuses
	msgUnknownStatusBlank = "Status tagihan tidak dikenal. Tambahkan ke StatusMap profil bila sah." + keepOldStatuses

	msgNetworkTimeout = "Sistem billing tidak menjawab dalam batas waktu." + keepOldStatuses
	msgNetworkTLS     = "Sertifikat TLS sistem billing tidak dapat diverifikasi." + keepOldStatuses
	msgNetworkDown    = "Sistem billing tidak dapat dihubungi (jaringan terputus atau layanan mati)." + keepOldStatuses
	msgServerError    = "Sistem billing mengalami gangguan (HTTP %d)." + keepOldStatuses

	// Menyebut cara mengatasi bila penurunannya memang benar. Nama variabelnya diambil
	// dari konstanta konfigurasi supaya pesan tidak pernah menyimpang darinya.
	msgAnomalousDrop = "Jumlah tagihan turun drastis (dari %d ke %d). Periksa tampilan sistem billing. " +
		"Bila penurunan ini memang benar, atur " + EnvDropPercent + "." + keepOldStatuses

	// Tiga pesan berikut sengaja sama persis dengan teks galat bakunya (ErrSyncCanceled,
	// ErrSyncTimeout, ErrSyncPanic): dashboard dan tes lama sudah mengandalkannya.
	msgCanceled = "Sinkron dibatalkan karena backend berhenti."
	msgTimeout  = "Sinkron melewati batas waktu."
	msgInternal = "Sinkron berhenti karena kesalahan internal."

	// maxStatusValueRunes membatasi teks status yang dikutip di pesan.
	maxStatusValueRunes = 40
)

// credentialsMessages adalah semua pesan berjenis credentials. Hanya pesan
// tersimpan di log yang tersisa sesudah backend dimulai ulang, dan hanya
// pesannya yang bisa dipakai mengenali kegagalan login dari log.
var credentialsMessages = []string{msgLoginRejected, msgLoginNoCSRF}

// isCredentialsMessage menjawab apakah pesan log sebuah sinkron gagal berasal dari
// kegagalan login (jenis credentials). Pesan akses ditolak (HTTP 401/403/419) berisi
// kode status, jadi dikenali dari awal kalimatnya.
func isCredentialsMessage(msg string) bool {
	if slices.Contains(credentialsMessages, msg) {
		return true
	}
	prefix, suffix, _ := strings.Cut(msgAccessDenied, "%d")
	return strings.HasPrefix(msg, prefix) && strings.HasSuffix(msg, suffix)
}

// Classify menggolongkan err menjadi jenis, pesan untuk petugas, dan sifat
// sementara/permanen. Murni: hanya membaca err lewat errors.Is dan errors.As,
// jadi pembungkus berlapis (fmt.Errorf("...: %w"), errors.Join, reasonError) tidak
// mengubah hasilnya, dan teks galat tidak pernah dibaca sama sekali, kecuali nilai
// dan lokasi di *UnknownStatusError, yang memang bagian dari pesannya.
//
// Bila beberapa jenis berlaku sekaligus, yang lebih khusus menang: panic, henti,
// batas waktu sinkron, sumber kosong, dan lonjakan turun lebih dulu daripada
// penyebab di bawahnya. Galat nil menghasilkan Failure kosong.
func Classify(err error) Failure {
	if err == nil {
		return Failure{}
	}
	var (
		unknown *UnknownStatusError
		status  *StatusError
		drop    *InvoiceDropError
	)
	switch {
	case errors.Is(err, ErrSyncPanic):
		return permanent(FailureInternal, msgInternal)
	case errors.Is(err, ErrSyncCanceled):
		return permanent(FailureCanceled, msgCanceled)
	case errors.Is(err, ErrSyncTimeout):
		return Failure{Kind: FailureTimeout, Message: msgTimeout, Transient: true}
	case errors.Is(err, ErrEmptyInvoiceSource):
		return permanent(FailureEmptySource, ErrEmptyInvoiceSource.Error())
	case errors.As(err, &drop):
		return permanent(FailureAnomalousDrop,
			fmt.Sprintf(msgAnomalousDrop, drop.Previous, drop.Current))

	case errors.Is(err, ErrLoginFailed):
		return permanent(FailureCredentials, msgLoginRejected)
	case errors.Is(err, ErrCSRFNotFound):
		return permanent(FailureCredentials, msgLoginNoCSRF)

	case errors.As(err, &unknown):
		return permanent(FailureUnknownStatus, unknownStatusMessage(unknown))
	case errors.Is(err, ErrUnknownStatus):
		return permanent(FailureUnknownStatus, msgUnknownStatusBlank)

	// Sesi hilang SESUDAH login diterima dua kali: akunnya sah, jadi bukan
	// credentials (tidak boleh ikut menahan jadwal login); yang berubah adalah
	// cara situs memperlakukan sesi atau hak akses halaman tagihan.
	case errors.Is(err, ErrSessionLost):
		return permanent(FailureSourceChanged, msgSessionLost)
	case errors.Is(err, ErrUnexpectedPage), errors.Is(err, ErrTooLarge),
		errors.Is(err, ErrTooManyRedirects), errors.Is(err, ErrCrossHostRedirect):
		return permanent(FailureSourceChanged, msgSourceChanged)

	case errors.As(err, &status):
		return classifyHTTP(status.Code)
	case errors.Is(err, ErrHTTPStatus):
		return permanent(FailureSourceChanged, msgUnexpectedBlank)

	case errors.Is(err, ErrNetwork):
		switch causeOf(err) {
		case causeTimeout:
			return Failure{Kind: FailureTimeout, Message: msgNetworkTimeout, Transient: true}
		case causeTLS:
			return Failure{Kind: FailureNetwork, Message: msgNetworkTLS, Transient: true}
		}
		return Failure{Kind: FailureNetwork, Message: msgNetworkDown, Transient: true}

	case errors.Is(err, context.Canceled):
		return permanent(FailureCanceled, msgCanceled)
	case errors.Is(err, context.DeadlineExceeded):
		return Failure{Kind: FailureTimeout, Message: msgTimeout, Transient: true}
	}
	return permanent(FailureInternal, msgInternal)
}

// Kategori galat untuk log terstruktur (lebih kasar daripada FailureKind).
const (
	CategoryNetwork     = "Network"
	CategoryAuth        = "Auth"
	CategoryParsing     = "Parsing"
	CategoryDropAnomaly = "DropAnomaly"
	CategoryInternal    = "Internal"
)

// Category memetakan Kind ke kategori log: Auth, Network, Parsing, DropAnomaly,
// atau Internal (sisanya, termasuk canceled).
func (f Failure) Category() string {
	switch f.Kind {
	case FailureCredentials:
		return CategoryAuth
	case FailureNetwork, FailureTimeout, FailureServerError:
		return CategoryNetwork
	case FailureSourceChanged, FailureUnknownStatus, FailureEmptySource:
		return CategoryParsing
	case FailureAnomalousDrop:
		return CategoryDropAnomaly
	}
	return CategoryInternal
}

func permanent(kind FailureKind, msg string) Failure {
	return Failure{Kind: kind, Message: msg}
}

// classifyHTTP menggolongkan status HTTP yang tidak diharapkan. 401, 403, dan 419
// (Page Expired milik Laravel) berarti akun ditolak; 5xx gangguan di sisi billing
// dan boleh diulang; sisanya (4xx lain, 3xx yang tidak diikuti, dsb.) berarti
// permintaan kita tidak lagi sesuai dengan situsnya.
func classifyHTTP(code int) Failure {
	switch {
	case code == 401 || code == 403 || code == 419:
		return permanent(FailureCredentials, fmt.Sprintf(msgAccessDenied, code))
	case code >= 500 && code <= 599:
		return Failure{Kind: FailureServerError, Message: fmt.Sprintf(msgServerError, code), Transient: true}
	}
	return permanent(FailureSourceChanged, fmt.Sprintf(msgUnexpectedHTTP, code))
}

// unknownStatusMessage menyebut teks status dan lokasinya, tidak lebih: bukan nama
// pelanggan, kode tagihan, atau isi baris lain. Teks status berasal dari halaman
// yang tidak kita kendalikan, jadi dibersihkan (karakter kendali dibuang, spasi
// dirapatkan, tanda kutip diganti) dan dipotong pendek.
func unknownStatusMessage(e *UnknownStatusError) string {
	value := cleanStatusValue(e.Value)
	if value == "" {
		return msgUnknownStatusBlank
	}
	where := ""
	if e.Page > 0 && e.Row > 0 {
		where = fmt.Sprintf(" (halaman %d, baris %d)", e.Page, e.Row)
	}
	return fmt.Sprintf(msgUnknownStatus, value, where)
}

func cleanStatusValue(v string) string {
	var b strings.Builder
	for _, r := range v {
		switch {
		case r == '"':
			b.WriteRune('\'')
		case unicode.IsSpace(r):
			b.WriteRune(' ')
		case unicode.IsPrint(r):
			b.WriteRune(r)
		}
	}
	return truncate(strings.Join(strings.Fields(b.String()), " "), maxStatusValueRunes)
}

// recordedFailure adalah galat yang diserahkan ke Store.FailRun: teksnya pesan
// untuk petugas (itulah yang disimpan), sedangkan penyebab aslinya tetap bisa
// diperiksa dengan errors.Is dan errors.As.
type recordedFailure struct {
	failure Failure
	cause   error
}

func (e *recordedFailure) Error() string { return e.failure.Message }
func (e *recordedFailure) Unwrap() error { return e.cause }
