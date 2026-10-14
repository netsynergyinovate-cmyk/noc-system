package billing

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	// EnvDropPercent adalah nama variabel persentase penjaga hasil yang menyusut.
	EnvDropPercent = "BILLING_DROP_PERCENT"
	// EnvDropMinInvoices adalah nama variabel batas minimum penjaga itu.
	EnvDropMinInvoices = "BILLING_DROP_MIN_INVOICES"

	// DefaultDropMinInvoices dan DefaultDropPercent adalah bawaan penjaga hasil yang
	// menyusut: sinkron ditolak bila sinkron berhasil terakhir punya paling sedikit
	// DefaultDropMinInvoices tagihan dan jumlah baru KURANG dari DefaultDropPercent
	// persen darinya. Tepat di batas (mis. 5 dari 10) masih lolos.
	//
	// Alasannya: halaman yang terpotong (situs menjawab 200 tetapi hanya sebagian
	// tabel, atau paginasi yang berhenti lebih awal) menghasilkan daftar yang tidak
	// kosong, jadi lolos dari penjaga sumber kosong, tetapi membuat banyak pelanggan
	// seolah tanpa tagihan, dan ApplySuccess membuang baris billing_status mereka.
	// Data yang salah lebih berbahaya daripada data yang basi.
	DefaultDropMinInvoices = 10
	DefaultDropPercent     = 50
)

// DropGuard mengatur penjaga hasil yang menyusut drastis: sinkron ditolak
// (ErrAnomalousDrop) bila sinkron berhasil terakhir punya paling sedikit
// MinInvoices tagihan dan jumlah baru KURANG dari Percent persen darinya. Tepat
// Percent persen lolos. Penurunan yang memang benar (billing dibersihkan) diatasi
// dengan menurunkan Percent lewat BILLING_DROP_PERCENT, bukan dengan mengubah kode.
type DropGuard struct {
	// MinInvoices adalah jumlah tagihan sinkron berhasil terakhir yang membuat
	// penjaga berlaku; di bawahnya penjaga diam. Paling kecil 1.
	MinInvoices int
	// Percent adalah persentase minimum jumlah tagihan baru terhadap sinkron berhasil
	// terakhir, 0 sampai 100. 0 mematikan penjaga sama sekali (pembanding pun tidak
	// dibaca); 100 menolak setiap penurunan.
	Percent int
}

// DefaultDropGuard memberi bawaan: 10 tagihan, 50 persen.
func DefaultDropGuard() DropGuard {
	return DropGuard{MinInvoices: DefaultDropMinInvoices, Percent: DefaultDropPercent}
}

// Enabled benar bila penjaga berlaku (Percent lebih dari 0).
func (g DropGuard) Enabled() bool { return g.Percent > 0 }

// Validate memeriksa batas nilainya. Galatnya membungkus ErrInvalidConfig.
func (g DropGuard) Validate() error {
	if g.MinInvoices < 1 {
		return fmt.Errorf("%w: batas minimum penjaga penyusutan harus 1 atau lebih", ErrInvalidConfig)
	}
	if g.Percent < 0 || g.Percent > 100 {
		return fmt.Errorf("%w: persentase penjaga penyusutan harus 0-100", ErrInvalidConfig)
	}
	return nil
}

// DropGuardFromEnv membaca BILLING_DROP_PERCENT dan BILLING_DROP_MIN_INVOICES
// lewat getenv, dengan gaya yang sama seperti SyncMinuteFromEnv: kosong (atau hanya
// spasi) berarti bawaan; selain itu harus bilangan bulat tanpa tanda dan tanpa
// pecahan dalam batasnya (persen 0-100, minimum 1 atau lebih), kalau tidak
// galatnya membungkus ErrInvalidConfig dan menyebut nama variabelnya, tidak pernah
// nilainya. Fungsi ini tidak ikut menentukan apakah billing dikonfigurasi (itu
// ConfigFromEnv), jadi ErrNotConfigured tidak berubah.
func DropGuardFromEnv(getenv func(string) string) (DropGuard, error) {
	percent, err := intFromEnv(getenv, EnvDropPercent, DefaultDropPercent, 0, 100,
		"bilangan bulat 0 sampai 100 (persentase minimum jumlah tagihan baru terhadap sinkron berhasil terakhir; 0 mematikan penjaga)")
	if err != nil {
		return DropGuard{}, err
	}
	minInvoices, err := intFromEnv(getenv, EnvDropMinInvoices, DefaultDropMinInvoices, 1, int(^uint(0)>>1),
		"bilangan bulat 1 atau lebih (di bawah jumlah tagihan ini penjaga tidak berlaku)")
	if err != nil {
		return DropGuard{}, err
	}
	return DropGuard{MinInvoices: minInvoices, Percent: percent}, nil
}

// intFromEnv membaca bilangan bulat tanpa tanda dari satu variabel.
func intFromEnv(getenv func(string) string, name string, def, lo, hi int, want string) (int, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return def, nil
	}
	invalid := fmt.Errorf("%w: %s harus %s", ErrInvalidConfig, name, want)
	for _, r := range raw {
		if r < '0' || r > '9' {
			return 0, invalid
		}
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < lo || n > hi {
		return 0, invalid
	}
	return n, nil
}

// drasticDrop benar bila previous >= minPrevious dan current kurang dari percent
// persen previous. Hitungannya bilangan bulat: tepat percent persen (5 dari 10 pada
// 50%) bukan penyusutan drastis. Dengan percent 0 tidak pernah benar.
func drasticDrop(previous, current, minPrevious, percent int) bool {
	return previous >= minPrevious && int64(current)*100 < int64(previous)*int64(percent)
}
