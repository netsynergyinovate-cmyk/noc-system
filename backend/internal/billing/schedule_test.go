package billing

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"testing"
	"time"
)

func utc(y int, mo time.Month, d, h, mi, s, ns int) time.Time {
	return time.Date(y, mo, d, h, mi, s, ns, time.UTC)
}

func TestNextRunAndPreviousRunTable(t *testing.T) {
	plus7 := time.FixedZone("WIB", 7*3600)
	minus5 := time.FixedZone("EST", -5*3600)
	ist := time.FixedZone("IST", 5*3600+1800)
	nepal := time.FixedZone("NPT", 5*3600+2700)

	cases := []struct {
		name     string
		after    time.Time
		minute   int
		wantNext time.Time
		wantPrev time.Time // slot terakhir <= after
	}{
		{"sebelum slot di jam yang sama", utc(2026, 5, 1, 10, 0, 0, 0), 5, utc(2026, 5, 1, 10, 5, 0, 0), utc(2026, 5, 1, 9, 5, 0, 0)},
		{"satu nanodetik sebelum slot", utc(2026, 5, 1, 10, 4, 59, 999_999_999), 5, utc(2026, 5, 1, 10, 5, 0, 0), utc(2026, 5, 1, 9, 5, 0, 0)},
		{"tepat di slot: yang berikutnya, bukan yang sama", utc(2026, 5, 1, 10, 5, 0, 0), 5, utc(2026, 5, 1, 11, 5, 0, 0), utc(2026, 5, 1, 10, 5, 0, 0)},
		{"satu nanodetik sesudah slot", utc(2026, 5, 1, 10, 5, 0, 1), 5, utc(2026, 5, 1, 11, 5, 0, 0), utc(2026, 5, 1, 10, 5, 0, 0)},
		{"akhir jam", utc(2026, 5, 1, 10, 59, 59, 999_999_999), 5, utc(2026, 5, 1, 11, 5, 0, 0), utc(2026, 5, 1, 10, 5, 0, 0)},
		{"awal jam", utc(2026, 5, 1, 11, 0, 0, 0), 5, utc(2026, 5, 1, 11, 5, 0, 0), utc(2026, 5, 1, 10, 5, 0, 0)},

		{"batas hari", utc(2026, 5, 1, 23, 30, 0, 0), 5, utc(2026, 5, 2, 0, 5, 0, 0), utc(2026, 5, 1, 23, 5, 0, 0)},
		{"batas hari tepat di tengah malam", utc(2026, 5, 2, 0, 0, 0, 0), 5, utc(2026, 5, 2, 0, 5, 0, 0), utc(2026, 5, 1, 23, 5, 0, 0)},
		{"batas bulan", utc(2026, 4, 30, 23, 59, 59, 0), 5, utc(2026, 5, 1, 0, 5, 0, 0), utc(2026, 4, 30, 23, 5, 0, 0)},
		{"batas tahun", utc(2026, 12, 31, 23, 59, 59, 999_999_999), 5, utc(2027, 1, 1, 0, 5, 0, 0), utc(2026, 12, 31, 23, 5, 0, 0)},
		{"tepat tahun baru", utc(2027, 1, 1, 0, 0, 0, 0), 5, utc(2027, 1, 1, 0, 5, 0, 0), utc(2026, 12, 31, 23, 5, 0, 0)},
		{"slot terakhir tahun lalu tepat", utc(2026, 12, 31, 23, 5, 0, 0), 5, utc(2027, 1, 1, 0, 5, 0, 0), utc(2026, 12, 31, 23, 5, 0, 0)},

		{"28 Februari bukan kabisat", utc(2027, 2, 28, 23, 30, 0, 0), 5, utc(2027, 3, 1, 0, 5, 0, 0), utc(2027, 2, 28, 23, 5, 0, 0)},
		{"28 Februari kabisat", utc(2028, 2, 28, 23, 30, 0, 0), 5, utc(2028, 2, 29, 0, 5, 0, 0), utc(2028, 2, 28, 23, 5, 0, 0)},
		{"29 Februari kabisat", utc(2028, 2, 29, 23, 30, 0, 0), 5, utc(2028, 3, 1, 0, 5, 0, 0), utc(2028, 2, 29, 23, 5, 0, 0)},
		{"tahun 2100 bukan kabisat", utc(2100, 2, 28, 23, 59, 0, 0), 5, utc(2100, 3, 1, 0, 5, 0, 0), utc(2100, 2, 28, 23, 5, 0, 0)},
		{"tahun 2000 kabisat", utc(2000, 2, 28, 23, 59, 0, 0), 5, utc(2000, 2, 29, 0, 5, 0, 0), utc(2000, 2, 28, 23, 5, 0, 0)},

		{"menit 0 sebelum slot", utc(2026, 5, 1, 9, 59, 59, 900_000_000), 0, utc(2026, 5, 1, 10, 0, 0, 0), utc(2026, 5, 1, 9, 0, 0, 0)},
		{"menit 0 tepat di slot", utc(2026, 5, 1, 10, 0, 0, 0), 0, utc(2026, 5, 1, 11, 0, 0, 0), utc(2026, 5, 1, 10, 0, 0, 0)},
		{"menit 0 batas tahun", utc(2026, 12, 31, 23, 0, 0, 0), 0, utc(2027, 1, 1, 0, 0, 0, 0), utc(2026, 12, 31, 23, 0, 0, 0)},
		{"menit 59 sebelum slot", utc(2026, 5, 1, 10, 58, 59, 0), 59, utc(2026, 5, 1, 10, 59, 0, 0), utc(2026, 5, 1, 9, 59, 0, 0)},
		{"menit 59 tepat di slot", utc(2026, 5, 1, 10, 59, 0, 0), 59, utc(2026, 5, 1, 11, 59, 0, 0), utc(2026, 5, 1, 10, 59, 0, 0)},
		{"menit 59 batas hari", utc(2026, 5, 1, 23, 59, 30, 0), 59, utc(2026, 5, 2, 0, 59, 0, 0), utc(2026, 5, 1, 23, 59, 0, 0)},

		// Masukan berzona lain: jamnya dihitung dalam UTC, hasilnya selalu UTC.
		{"WIB 17:30 = 10:30 UTC", time.Date(2026, 5, 1, 17, 30, 0, 0, plus7), 5, utc(2026, 5, 1, 11, 5, 0, 0), utc(2026, 5, 1, 10, 5, 0, 0)},
		{"WIB lewat tengah malam lokal, hari UTC masih kemarin", time.Date(2026, 5, 2, 1, 0, 0, 0, plus7), 5, utc(2026, 5, 1, 18, 5, 0, 0), utc(2026, 5, 1, 17, 5, 0, 0)},
		{"WIB tepat di slot UTC", time.Date(2026, 5, 1, 17, 5, 0, 0, plus7), 5, utc(2026, 5, 1, 11, 5, 0, 0), utc(2026, 5, 1, 10, 5, 0, 0)},
		{"UTC-5 melewati batas hari UTC", time.Date(2026, 5, 1, 19, 30, 0, 0, minus5), 5, utc(2026, 5, 2, 1, 5, 0, 0), utc(2026, 5, 2, 0, 5, 0, 0)},
		{"UTC-5 melewati batas tahun UTC", time.Date(2026, 12, 31, 19, 30, 0, 0, minus5), 5, utc(2027, 1, 1, 1, 5, 0, 0), utc(2027, 1, 1, 0, 5, 0, 0)},
		{"zona setengah jam (+05:30), menit 45", time.Date(2026, 5, 1, 10, 0, 0, 0, ist), 45, utc(2026, 5, 1, 4, 45, 0, 0), utc(2026, 5, 1, 3, 45, 0, 0)},
		{"zona seperempat jam (+05:45), menit 30", time.Date(2026, 5, 1, 10, 0, 0, 0, nepal), 30, utc(2026, 5, 1, 4, 30, 0, 0), utc(2026, 5, 1, 3, 30, 0, 0)},
	}
	for _, c := range cases {
		got := NextRun(c.after, c.minute)
		if !got.Equal(c.wantNext) || got.Location() != time.UTC {
			t.Errorf("%s: NextRun(%s, %d) = %s (%s), want %s UTC", c.name, c.after, c.minute, got, got.Location(), c.wantNext)
		}
		prev := PreviousRun(c.after, c.minute)
		if !prev.Equal(c.wantPrev) || prev.Location() != time.UTC {
			t.Errorf("%s: PreviousRun(%s, %d) = %s (%s), want %s UTC", c.name, c.after, c.minute, prev, prev.Location(), c.wantPrev)
		}
	}
}

// Setiap menit 0-59 pada setiap waktu uji: NextRun jatuh pada menit itu, detik 0,
// dan tidak pernah sama dengan masukannya.
func TestNextRunEveryMinuteAtSlotBoundaries(t *testing.T) {
	base := utc(2026, 5, 1, 10, 0, 0, 0)
	for minute := MinSyncMinute; minute <= MaxSyncMinute; minute++ {
		slot := base.Add(time.Duration(minute) * time.Minute)
		for _, c := range []struct {
			after time.Time
			want  time.Time
		}{
			{slot.Add(-time.Nanosecond), slot},
			{slot, slot.Add(time.Hour)},
			{slot.Add(time.Nanosecond), slot.Add(time.Hour)},
		} {
			if got := NextRun(c.after, minute); !got.Equal(c.want) {
				t.Errorf("menit %d: NextRun(%s) = %s, want %s", minute, c.after, got, c.want)
			}
		}
		if got := PreviousRun(slot, minute); !got.Equal(slot) {
			t.Errorf("menit %d: PreviousRun tepat di slot = %s, want %s", minute, got, slot)
		}
		if got := PreviousRun(slot.Add(-time.Nanosecond), minute); !got.Equal(slot.Add(-time.Hour)) {
			t.Errorf("menit %d: PreviousRun sebelum slot = %s, want %s", minute, got, slot.Add(-time.Hour))
		}
	}
}

// Sifat yang harus berlaku untuk waktu apa pun, diuji pada waktu acak berbenih
// (1990-2100, nanodetik acak, zona acak) dan pada tiap detik di sekitar 200 slot
// acak.
func TestNextRunProperties(t *testing.T) {
	zones := []*time.Location{
		time.UTC,
		time.FixedZone("a", 7*3600),
		time.FixedZone("b", -11*3600),
		time.FixedZone("c", 5*3600+1800),
		time.FixedZone("d", 12*3600+2700),
		time.FixedZone("e", -3*3600-1800),
	}
	for seed := uint64(1); seed <= 20; seed++ {
		rng := rand.New(rand.NewPCG(seed, seed*7919))
		for i := 0; i < 2000; i++ {
			minute := rng.IntN(60)
			sec := rng.Int64N(int64(110*365*24*3600)) + utc(1990, 1, 1, 0, 0, 0, 0).Unix()
			after := time.Unix(sec, rng.Int64N(1_000_000_000)).In(zones[rng.IntN(len(zones))])
			checkScheduleProperties(t, after, minute, fmt.Sprintf("seed %d #%d", seed, i))
		}
	}
	rng := rand.New(rand.NewPCG(99, 100))
	for i := 0; i < 200; i++ {
		minute := rng.IntN(60)
		slot := NextRun(time.Unix(rng.Int64N(4_000_000_000), 0), minute)
		for offset := -3; offset <= 3; offset++ {
			checkScheduleProperties(t, slot.Add(time.Duration(offset)*time.Second), minute, fmt.Sprintf("sekitar slot %s %+ds", slot, offset))
		}
		for _, ns := range []time.Duration{-time.Nanosecond, 0, time.Nanosecond} {
			checkScheduleProperties(t, slot.Add(ns), minute, fmt.Sprintf("sekitar slot %s %+dns", slot, ns))
		}
	}
}

func checkScheduleProperties(t *testing.T, after time.Time, minute int, label string) {
	t.Helper()
	next := NextRun(after, minute)
	prev := PreviousRun(after, minute)
	switch {
	case !next.After(after):
		t.Fatalf("%s: NextRun(%s, %d) = %s, tidak sesudah masukan", label, after, minute, next)
	case next.Sub(after) > time.Hour:
		t.Fatalf("%s: NextRun(%s, %d) = %s, lebih dari satu jam dari masukan", label, after, minute, next)
	case next.Minute() != minute || next.Second() != 0 || next.Nanosecond() != 0:
		t.Fatalf("%s: NextRun = %s bukan menit %d detik 0", label, next, minute)
	case next.Location() != time.UTC:
		t.Fatalf("%s: NextRun berzona %s, want UTC", label, next.Location())
	}
	if again := NextRun(next, minute); again.Sub(next) != time.Hour {
		t.Fatalf("%s: NextRun(NextRun) - NextRun = %s, want 1h", label, again.Sub(next))
	}
	switch {
	case prev.After(after):
		t.Fatalf("%s: PreviousRun(%s, %d) = %s, sesudah masukan", label, after, minute, prev)
	case after.Sub(prev) >= time.Hour:
		t.Fatalf("%s: PreviousRun(%s, %d) = %s, satu jam atau lebih sebelum masukan", label, after, minute, prev)
	case prev.Minute() != minute || prev.Second() != 0 || prev.Nanosecond() != 0 || prev.Location() != time.UTC:
		t.Fatalf("%s: PreviousRun = %s bukan menit %d detik 0 UTC", label, prev, minute)
	case next.Sub(prev) != time.Hour:
		t.Fatalf("%s: NextRun - PreviousRun = %s, want 1h", label, next.Sub(prev))
	}
	if got := PreviousRun(next, minute); !got.Equal(next) {
		t.Fatalf("%s: PreviousRun(NextRun) = %s, want %s", label, got, next)
	}
}

func TestNextRunRejectsMinutesOutsideTheHour(t *testing.T) {
	for _, minute := range []int{-1, 60, 61, 100, -60} {
		for name, fn := range map[string]func(){
			"NextRun":     func() { NextRun(utc(2026, 5, 1, 10, 0, 0, 0), minute) },
			"PreviousRun": func() { PreviousRun(utc(2026, 5, 1, 10, 0, 0, 0), minute) },
		} {
			func() {
				defer func() {
					if recover() == nil {
						t.Errorf("%s(menit %d) seharusnya panik: menit di luar 0-59 adalah galat pemrograman", name, minute)
					}
				}()
				fn()
			}()
		}
	}
}

func TestValidSyncMinute(t *testing.T) {
	for minute := -5; minute <= 70; minute++ {
		want := minute >= 0 && minute <= 59
		if got := ValidSyncMinute(minute); got != want {
			t.Errorf("ValidSyncMinute(%d) = %v, want %v", minute, got, want)
		}
	}
	if DefaultSyncMinute != 5 {
		t.Errorf("DefaultSyncMinute = %d; frontend (SYNC_OFFSET_SECONDS = 300) memakai menit 5", DefaultSyncMinute)
	}
}

func TestSyncMinuteFromEnv(t *testing.T) {
	valid := map[string]int{
		"": DefaultSyncMinute, "   ": DefaultSyncMinute, "\t": DefaultSyncMinute,
		"0": 0, "00": 0, "5": 5, "05": 5, "30": 30, "59": 59, " 7 ": 7, "007": 7,
	}
	for raw, want := range valid {
		got, err := SyncMinuteFromEnv(envOf(map[string]string{EnvSyncMinute: raw}))
		if err != nil || got != want {
			t.Errorf("BILLING_SYNC_MINUTE=%q: got %d, %v; want %d", raw, got, err, want)
		}
	}
	if got, err := SyncMinuteFromEnv(envOf(nil)); err != nil || got != DefaultSyncMinute {
		t.Errorf("tanpa variabel: got %d, %v; want bawaan %d", got, err, DefaultSyncMinute)
	}

	for _, raw := range []string{"60", "61", "99", "100", "-1", "-0", "+5", "5.0", "5.5", "abc", "1e1", "0x10", "5 5", "lima", "٣", "9999999999999999999999", "--5"} {
		got, err := SyncMinuteFromEnv(envOf(map[string]string{EnvSyncMinute: raw}))
		if err == nil {
			t.Errorf("BILLING_SYNC_MINUTE=%q diterima sebagai %d; harus ditolak", raw, got)
			continue
		}
		if !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("BILLING_SYNC_MINUTE=%q: err = %v, want membungkus ErrInvalidConfig", raw, err)
		}
		if !strings.Contains(err.Error(), EnvSyncMinute) {
			t.Errorf("BILLING_SYNC_MINUTE=%q: pesan %q tidak menyebut nama variabelnya", raw, err)
		}
	}
}

// BILLING_SYNC_MINUTE tidak ikut menentukan apakah billing dikonfigurasi.
func TestSyncMinuteDoesNotChangeNotConfigured(t *testing.T) {
	for _, minute := range []string{"", "7", "oops"} {
		_, err := ConfigFromEnv(envOf(map[string]string{EnvSyncMinute: minute}))
		if !errors.Is(err, ErrNotConfigured) {
			t.Errorf("BILLING_SYNC_MINUTE=%q saja: err = %v, want ErrNotConfigured", minute, err)
		}
	}
	cfg, err := ConfigFromEnv(envOf(map[string]string{
		"BILLING_URL": "https://billing.example.com", "BILLING_USERNAME": "u", "BILLING_PASSWORD": "p", EnvSyncMinute: "oops",
	}))
	if err != nil || cfg.Username != "u" {
		t.Errorf("ConfigFromEnv tidak boleh membaca BILLING_SYNC_MINUTE: %+v, %v", cfg, err)
	}
}
