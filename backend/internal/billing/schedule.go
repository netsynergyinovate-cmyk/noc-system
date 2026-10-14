package billing

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Jadwal sinkron: satu kali tiap jam, pada menit tertentu detik ke-0 menurut UTC.
// Aturannya sama dengan mockBillingSync di src/lib/dashboard/billing.ts (menit
// ke-5 tiap jam UTC), supaya tampilan dashboard dan jadwal sungguhan searah.
// Fungsi di berkas ini murni: tidak membaca jam dan tidak tidur.

const (
	// EnvSyncMinute adalah nama variabel yang menyetel menit sinkron tiap jam.
	EnvSyncMinute = "BILLING_SYNC_MINUTE"
	// DefaultSyncMinute adalah menit bawaan (jam 10:05, 11:05, ... UTC).
	DefaultSyncMinute = 5
	// MinSyncMinute dan MaxSyncMinute membatasi menit yang sah.
	MinSyncMinute = 0
	MaxSyncMinute = 59
	// SyncInterval adalah jarak antar slot sinkron. Tetap satu jam; menit di dalam
	// jam yang bisa disetel, jaraknya tidak.
	SyncInterval = time.Hour
)

// ValidSyncMinute melaporkan apakah minute berada di 0-59.
func ValidSyncMinute(minute int) bool {
	return minute >= MinSyncMinute && minute <= MaxSyncMinute
}

// mustValidMinute menghentikan program bila minute di luar 0-59. Menit selalu
// diperiksa lebih dulu oleh SyncMinuteFromEnv dan NewScheduler, jadi panik di sini
// hanya berarti galat pemrograman; menormalkannya diam-diam akan menjalankan sinkron
// pada menit yang tidak pernah diminta siapa pun.
func mustValidMinute(minute int) {
	if !ValidSyncMinute(minute) {
		panic(fmt.Sprintf("billing: menit sinkron %d di luar %d-%d", minute, MinSyncMinute, MaxSyncMinute))
	}
}

// NextRun memberi saat sinkron berikutnya: detik ke-0 pada menit `minute` dari
// suatu jam UTC, dan SELALU lebih akhir dari `after` (tepat di slot tidak dihitung,
// jadi memanggilnya dengan hasil sebelumnya memberi slot sesudahnya, bukan slot
// yang sama). Hasilnya UTC walau `after` berzona lain. `minute` harus 0-59.
func NextRun(after time.Time, minute int) time.Time {
	mustValidMinute(minute)
	t := after.UTC()
	slot := time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), minute, 0, 0, time.UTC)
	if !slot.After(t) {
		slot = slot.Add(SyncInterval)
	}
	return slot
}

// PreviousRun memberi slot terakhir yang sudah lewat: yang terbesar dan tidak
// lebih akhir dari `now` (tepat di slot dihitung). Hasilnya UTC. Untuk setiap
// `now`, PreviousRun(now) <= now < NextRun(now) dan selisih keduanya satu jam.
func PreviousRun(now time.Time, minute int) time.Time {
	mustValidMinute(minute)
	t := now.UTC()
	slot := time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), minute, 0, 0, time.UTC)
	if slot.After(t) {
		slot = slot.Add(-SyncInterval)
	}
	return slot
}

// SyncMinuteFromEnv membaca BILLING_SYNC_MINUTE lewat getenv. Kosong (atau hanya
// spasi) berarti DefaultSyncMinute. Selain itu harus bilangan bulat tanpa tanda
// 0-59; yang lain mengembalikan galat yang membungkus ErrInvalidConfig dan
// menyebut nama variabelnya. Fungsi ini tidak ikut menentukan apakah billing
// dikonfigurasi (itu ConfigFromEnv), jadi ErrNotConfigured tidak berubah.
func SyncMinuteFromEnv(getenv func(string) string) (int, error) {
	raw := strings.TrimSpace(getenv(EnvSyncMinute))
	if raw == "" {
		return DefaultSyncMinute, nil
	}
	invalid := fmt.Errorf("%w: %s harus bilangan bulat %d sampai %d (menit dalam jam UTC)",
		ErrInvalidConfig, EnvSyncMinute, MinSyncMinute, MaxSyncMinute)
	for _, r := range raw {
		if r < '0' || r > '9' {
			return 0, invalid
		}
	}
	minute, err := strconv.Atoi(raw)
	if err != nil || !ValidSyncMinute(minute) {
		return 0, invalid
	}
	return minute, nil
}
