package archive

import "math"

// validRouterID memeriksa bentuk UUID (8-4-4-4-12 heksadesimal). Tabel arsip
// memakai kolom uuid; satu ID yang bukan UUID akan menggagalkan seluruh batch
// INSERT, jadi ditolak sejak masuk.
func validRouterID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !('0' <= c && c <= '9' || 'a' <= c && c <= 'f' || 'A' <= c && c <= 'F') {
				return false
			}
		}
	}
	return true
}

// validRate menolak nilai yang akan ditolak database atau merusak grafik:
// negatif, NaN, dan tak hingga.
func validRate(v float64) bool {
	return v >= 0 && !math.IsNaN(v) && !math.IsInf(v, 0)
}
