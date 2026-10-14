package billing

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"testing"
)

// Tes konfigurasi dan perilaku penjaga hasil yang menyusut (DropGuard).

func envMap(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestDropGuardFromEnvValues(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
		want DropGuard
	}{
		{"tidak ada apa-apa memakai bawaan", nil, DropGuard{MinInvoices: 10, Percent: 50}},
		{"kosong memakai bawaan", map[string]string{EnvDropPercent: "", EnvDropMinInvoices: ""}, DropGuard{MinInvoices: 10, Percent: 50}},
		{"hanya spasi memakai bawaan", map[string]string{EnvDropPercent: "  ", EnvDropMinInvoices: "\t"}, DropGuard{MinInvoices: 10, Percent: 50}},
		{"persen 0 mematikan penjaga", map[string]string{EnvDropPercent: "0"}, DropGuard{MinInvoices: 10, Percent: 0}},
		{"persen 1", map[string]string{EnvDropPercent: "1"}, DropGuard{MinInvoices: 10, Percent: 1}},
		{"persen 50", map[string]string{EnvDropPercent: "50"}, DropGuard{MinInvoices: 10, Percent: 50}},
		{"persen 99", map[string]string{EnvDropPercent: "99"}, DropGuard{MinInvoices: 10, Percent: 99}},
		{"persen 100", map[string]string{EnvDropPercent: "100"}, DropGuard{MinInvoices: 10, Percent: 100}},
		{"persen dengan spasi", map[string]string{EnvDropPercent: " 75 "}, DropGuard{MinInvoices: 10, Percent: 75}},
		{"persen dengan nol di depan", map[string]string{EnvDropPercent: "075"}, DropGuard{MinInvoices: 10, Percent: 75}},
		{"minimum 1", map[string]string{EnvDropMinInvoices: "1"}, DropGuard{MinInvoices: 1, Percent: 50}},
		{"minimum 10", map[string]string{EnvDropMinInvoices: "10"}, DropGuard{MinInvoices: 10, Percent: 50}},
		{"minimum 1000", map[string]string{EnvDropMinInvoices: "1000"}, DropGuard{MinInvoices: 1000, Percent: 50}},
		{"minimum dengan spasi", map[string]string{EnvDropMinInvoices: " 25 "}, DropGuard{MinInvoices: 25, Percent: 50}},
		{"keduanya", map[string]string{EnvDropPercent: "80", EnvDropMinInvoices: "3"}, DropGuard{MinInvoices: 3, Percent: 80}},
		{"persen 0 dengan minimum", map[string]string{EnvDropPercent: "0", EnvDropMinInvoices: "7"}, DropGuard{MinInvoices: 7, Percent: 0}},
	}
	for _, c := range cases {
		got, err := DropGuardFromEnv(envMap(c.env))
		if err != nil || got != c.want {
			t.Errorf("%s: DropGuardFromEnv = %+v, %v; want %+v", c.name, got, err, c.want)
		}
		if err == nil {
			if verr := got.Validate(); verr != nil {
				t.Errorf("%s: hasil env tidak lolos Validate: %v", c.name, verr)
			}
		}
	}
	if def := DefaultDropGuard(); def != (DropGuard{MinInvoices: 10, Percent: 50}) || !def.Enabled() {
		t.Errorf("DefaultDropGuard = %+v", def)
	}
	if (DropGuard{MinInvoices: 10, Percent: 0}).Enabled() {
		t.Error("Percent 0 harus mematikan penjaga")
	}
}

func TestDropGuardFromEnvRejectsBadValues(t *testing.T) {
	const secretish = "rahasia-xyz"
	bad := []struct {
		name, variable, value string
	}{
		{"persen 101", EnvDropPercent, "101"},
		{"persen 1000", EnvDropPercent, "1000"},
		{"persen negatif", EnvDropPercent, "-1"},
		{"persen negatif nol", EnvDropPercent, "-0"},
		{"persen plus", EnvDropPercent, "+5"},
		{"persen pecahan", EnvDropPercent, "50.5"},
		{"persen pecahan koma", EnvDropPercent, "50,5"},
		{"persen notasi ilmiah", EnvDropPercent, "5e1"},
		{"persen heksa", EnvDropPercent, "0x32"},
		{"persen dengan tanda persen", EnvDropPercent, "50%"},
		{"persen teks", EnvDropPercent, "lima puluh"},
		{"persen teks mirip rahasia", EnvDropPercent, secretish},
		{"persen angka Unicode", EnvDropPercent, "５０"},
		{"persen dua angka dipisah spasi", EnvDropPercent, "5 0"},
		{"persen melimpah", EnvDropPercent, "99999999999999999999999999"},
		{"minimum 0", EnvDropMinInvoices, "0"},
		{"minimum negatif", EnvDropMinInvoices, "-3"},
		{"minimum pecahan", EnvDropMinInvoices, "2.5"},
		{"minimum teks", EnvDropMinInvoices, "banyak"},
		{"minimum teks mirip rahasia", EnvDropMinInvoices, secretish},
		{"minimum melimpah", EnvDropMinInvoices, "99999999999999999999999999"},
	}
	for _, c := range bad {
		got, err := DropGuardFromEnv(envMap(map[string]string{c.variable: c.value}))
		if err == nil {
			t.Errorf("%s: diterima sebagai %+v; seharusnya ditolak", c.name, got)
			continue
		}
		if !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("%s: err = %v, want membungkus ErrInvalidConfig", c.name, err)
		}
		if !strings.Contains(err.Error(), c.variable) {
			t.Errorf("%s: pesan %q tidak menyebut %s", c.name, err, c.variable)
		}
		if c.value != "" && strings.Contains(err.Error(), c.value) {
			t.Errorf("%s: pesan mengulang nilainya: %q", c.name, err)
		}
		if got != (DropGuard{}) {
			t.Errorf("%s: hasil %+v harus kosong bila galat", c.name, got)
		}
	}
	// Salah satu rusak sudah cukup, walau yang lain sah.
	if _, err := DropGuardFromEnv(envMap(map[string]string{EnvDropPercent: "50", EnvDropMinInvoices: "0"})); err == nil {
		t.Error("minimum rusak dengan persen sah seharusnya ditolak")
	}
	if _, err := DropGuardFromEnv(envMap(map[string]string{EnvDropPercent: "101", EnvDropMinInvoices: "5"})); err == nil {
		t.Error("persen rusak dengan minimum sah seharusnya ditolak")
	}
}

// Variabel penjaga tidak ikut menentukan apakah billing dikonfigurasi.
func TestDropGuardEnvDoesNotChangeNotConfigured(t *testing.T) {
	onlyDrop := envMap(map[string]string{EnvDropPercent: "0", EnvDropMinInvoices: "5"})
	if _, err := ConfigFromEnv(onlyDrop); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("ConfigFromEnv hanya dengan variabel penjaga = %v, want ErrNotConfigured", err)
	}
	// Dan billing yang lengkap tidak berubah oleh variabel penjaga yang rusak: itu urusan
	// DropGuardFromEnv, supaya pemanggil yang memutuskan.
	full := map[string]string{EnvURL: "https://billing.example.com", EnvUsername: "u", EnvPassword: "p", EnvDropPercent: "banyak"}
	if _, err := ConfigFromEnv(envMap(full)); err != nil {
		t.Errorf("ConfigFromEnv = %v; variabel penjaga tidak boleh memengaruhinya", err)
	}
	if EnvDropPercent != "BILLING_DROP_PERCENT" || EnvDropMinInvoices != "BILLING_DROP_MIN_INVOICES" {
		t.Errorf("nama variabel = %s, %s", EnvDropPercent, EnvDropMinInvoices)
	}
}

func TestDropGuardValidate(t *testing.T) {
	for g, ok := range map[DropGuard]bool{
		{MinInvoices: 1, Percent: 0}:       true,
		{MinInvoices: 1, Percent: 100}:     true,
		{MinInvoices: 10, Percent: 50}:     true,
		{MinInvoices: 0, Percent: 50}:      false,
		{MinInvoices: -1, Percent: 50}:     false,
		{MinInvoices: 10, Percent: -1}:     false,
		{MinInvoices: 10, Percent: 101}:    false,
		{MinInvoices: 0, Percent: 0}:       false,
		{MinInvoices: 5, Percent: 1 << 20}: false,
	} {
		err := g.Validate()
		if (err == nil) != ok || (err != nil && !errors.Is(err, ErrInvalidConfig)) {
			t.Errorf("Validate(%+v) = %v, want ok=%v", g, err, ok)
		}
	}
}

// drasticDrop dibandingkan dengan hitungan pecahan eksak (big.Rat) di setiap batas
// untuk beberapa persentase, supaya rumus bilangan bulat tidak salah di titik yang
// tepat.
func TestDrasticDropMatchesExactRationalArithmetic(t *testing.T) {
	for _, percent := range []int{0, 1, 10, 25, 33, 50, 51, 66, 75, 80, 90, 99, 100} {
		for _, minPrev := range []int{1, 3, 10} {
			for previous := 0; previous <= 45; previous++ {
				for current := 0; current <= previous+2; current++ {
					threshold := new(big.Rat).Mul(big.NewRat(int64(previous), 1), big.NewRat(int64(percent), 100))
					want := previous >= minPrev && big.NewRat(int64(current), 1).Cmp(threshold) < 0
					if got := drasticDrop(previous, current, minPrev, percent); got != want {
						t.Fatalf("drasticDrop(%d -> %d, min %d, %d%%) = %v, want %v", previous, current, minPrev, percent, got, want)
					}
				}
			}
		}
	}
}

// Persentase yang berbeda menggeser batas tepat; diuji lewat Syncer di tiap batas.
func TestRunOnceDropGuardPercentMovesTheExactBoundary(t *testing.T) {
	cases := []struct {
		name     string
		guard    *DropGuard
		previous int
		current  int
		rejected bool
	}{
		{"80%: 8 dari 10 (tepat) lolos", &DropGuard{MinInvoices: 5, Percent: 80}, 10, 8, false},
		{"80%: 7 dari 10 ditolak", &DropGuard{MinInvoices: 5, Percent: 80}, 10, 7, true},
		{"80%: 16 dari 20 (tepat) lolos", &DropGuard{MinInvoices: 5, Percent: 80}, 20, 16, false},
		{"80%: 15 dari 20 ditolak", &DropGuard{MinInvoices: 5, Percent: 80}, 20, 15, true},
		{"80%: 4 dari 4 di bawah minimum tidak dijaga", &DropGuard{MinInvoices: 5, Percent: 80}, 4, 1, false},
		{"80%: minimum tepat 5 dijaga", &DropGuard{MinInvoices: 5, Percent: 80}, 5, 3, true},
		{"80%: 4 dari 5 (tepat) lolos", &DropGuard{MinInvoices: 5, Percent: 80}, 5, 4, false},
		{"25%: 3 dari 12 (tepat) lolos", &DropGuard{MinInvoices: 1, Percent: 25}, 12, 3, false},
		{"25%: 2 dari 12 ditolak", &DropGuard{MinInvoices: 1, Percent: 25}, 12, 2, true},
		{"1%: 2 dari 200 (tepat) lolos", &DropGuard{MinInvoices: 1, Percent: 1}, 200, 2, false},
		{"1%: 1 dari 200 ditolak", &DropGuard{MinInvoices: 1, Percent: 1}, 200, 1, true},
		{"100%: sama lolos", &DropGuard{MinInvoices: 1, Percent: 100}, 20, 20, false},
		{"100%: lebih banyak lolos", &DropGuard{MinInvoices: 1, Percent: 100}, 20, 25, false},
		{"100%: kurang satu ditolak", &DropGuard{MinInvoices: 1, Percent: 100}, 20, 19, true},
		{"100%: minimum 1 menjaga 2 dari 3", &DropGuard{MinInvoices: 1, Percent: 100}, 3, 2, true},
		{"bawaan (nil): 5 dari 10 lolos", nil, 10, 5, false},
		{"bawaan (nil): 4 dari 10 ditolak", nil, 10, 4, true},
	}
	for _, c := range cases {
		list := make([]Invoice, c.current)
		for i := range list {
			list[i] = Invoice{Name: fmt.Sprintf("p%d", i), Ref: fmt.Sprintf("INV-%d", i), Status: StatusLunas}
		}
		r := newRetryRig(t, []sourceStep{okStep(list)}, func(o *SyncerOptions) { o.DropGuard = c.guard })
		r.store.lastSuccess, r.store.hasLastSuccess = SuccessRun{Invoices: c.previous, FinishedAt: r.clock.Now()}, true
		out, err := r.run(context.Background())
		if c.rejected {
			var drop *InvoiceDropError
			if !errors.Is(err, ErrAnomalousDrop) || !errors.As(err, &drop) || drop.Previous != c.previous || drop.Current != c.current ||
				out.Status != RunFailed || len(r.store.applied) != 0 {
				t.Errorf("%s: RunOnce = %+v, %v; want ditolak", c.name, out, err)
			}
			continue
		}
		if err != nil || out.Status != RunSuccess || len(r.store.applied) != 1 {
			t.Errorf("%s: RunOnce = %+v, %v; want lolos", c.name, out, err)
		}
	}
}

// Persentase 0 mematikan penjaga: penurunan sebesar apa pun lolos, dan pembanding
// tidak dibaca sama sekali (jadi galat membacanya pun tidak menghalangi).
func TestRunOnceDropGuardPercentZeroDisablesTheGuard(t *testing.T) {
	for _, c := range []struct {
		name              string
		previous, current int
	}{
		{"turun jauh", 1000, 1},
		{"turun satu", 10, 9},
		{"turun ke 1 dari minimum", 10, 1},
		{"tetap", 10, 10},
		{"naik", 10, 30},
	} {
		list := make([]Invoice, c.current)
		for i := range list {
			list[i] = Invoice{Name: fmt.Sprintf("p%d", i), Ref: fmt.Sprintf("INV-%d", i), Status: StatusLunas}
		}
		r := newRetryRig(t, []sourceStep{okStep(list)}, func(o *SyncerOptions) { o.DropGuard = &DropGuard{MinInvoices: 10, Percent: 0} })
		r.store.lastSuccess, r.store.hasLastSuccess = SuccessRun{Invoices: c.previous, FinishedAt: r.clock.Now()}, true
		out, err := r.run(context.Background())
		if err != nil || out.Status != RunSuccess || len(r.store.applied) != 1 {
			t.Errorf("%s: RunOnce = %+v, %v; penjaga mati, harus lolos", c.name, out, err)
		}
		if r.store.lastSuccessCalls != 0 {
			t.Errorf("%s: pembanding dibaca %d kali padahal penjaga mati", c.name, r.store.lastSuccessCalls)
		}
	}

	// Pembanding yang rusak tidak menghalangi saat penjaga mati, tetapi menghalangi saat hidup.
	off := newRetryRig(t, []sourceStep{okStep(sampleInvoices())}, func(o *SyncerOptions) { o.DropGuard = &DropGuard{MinInvoices: 10, Percent: 0} })
	off.store.lastSuccessErr = errors.New("database mati")
	if out, err := off.run(context.Background()); err != nil || out.Status != RunSuccess {
		t.Errorf("penjaga mati: RunOnce = %+v, %v", out, err)
	}
	on := newRetryRig(t, []sourceStep{okStep(sampleInvoices())}, func(o *SyncerOptions) { o.DropGuard = &DropGuard{MinInvoices: 10, Percent: 1} })
	on.store.lastSuccessErr = errors.New("database mati")
	if out, err := on.run(context.Background()); err == nil || out.Status != RunFailed {
		t.Errorf("penjaga hidup: RunOnce = %+v, %v; pembanding rusak harus menggagalkan", out, err)
	}
}

// Nilai yang diberikan tidak mengubah salinan pemanggil, dan nil memakai bawaan.
func TestNewSyncerDropGuardOption(t *testing.T) {
	log := &callLog{}
	src, st := &fakeSource{log: log}, &fakeRunStore{log: log}
	s, err := NewSyncer(src, st, SyncerOptions{})
	if err != nil || s.drop != DefaultDropGuard() {
		t.Fatalf("nil: %+v, %v", s, err)
	}
	g := DropGuard{MinInvoices: 3, Percent: 0}
	s, err = NewSyncer(src, st, SyncerOptions{DropGuard: &g})
	if err != nil || s.drop != g {
		t.Fatalf("persen 0: %+v, %v; nol tidak boleh diganti bawaan", s, err)
	}
	g.Percent = 90
	if s.drop.Percent != 0 {
		t.Error("Syncer berbagi memori dengan opsi pemanggil")
	}
	if _, err := NewSyncer(src, st, SyncerOptions{DropGuard: &DropGuard{}}); !errors.Is(err, ErrInvalidConfig) {
		t.Errorf("DropGuard kosong (minimum 0): err = %v, want ErrInvalidConfig", err)
	}
}
