package olt

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func profileTable(rows ...string) string {
	return "-----\r\nProfile ID  Profile Name  BindTimes\r\n-----\r\n" + strings.Join(rows, "\r\n") + "\r\n-----\r\n"
}

func bindReplies(profiles string) map[string]string {
	return map[string]string{
		"show onu-tr069-profile all": profiles,
		"interface epon 1":           "",
		"interface epon 2":           "",
		"onu-tr069 1 profile-id 1":   "",
		"onu-tr069 2 profile-id 1":   "vty% Command incomplete.\r\n",
		"onu-tr069 3 profile-id 1":   "  Error, ONU does not exist\r\n",
	}
}

func binderOf(t *testing.T, d Driver) TR069Binder {
	t.Helper()
	b, ok := d.(TR069Binder)
	if !ok {
		t.Fatal("driver hsgq-telnet harus mengimplementasikan TR069Binder")
	}
	return b
}

func TestBindTR069SendsOnlyBindCommands(t *testing.T) {
	f := startFakeOlt(t, "NOCApp", "rahasia", bindReplies(profileTable("1           NOC           0")))
	d := newTestDriver(t, f, "rahasia")
	res, err := binderOf(t, d).BindTR069(context.Background(), 1, []OnuRef{{Pon: 1, Onu: 1}})
	if err != nil || len(res) != 1 || res[0].Err != nil {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	want := []string{"enable", "configure", "show onu-tr069-profile all", "interface epon 1", "onu-tr069 1 profile-id 1", "end", "configure", "end"}
	got := f.commands()
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("perintah ke OLT\n got=%v\nwant=%v", got, want)
	}
}

func TestBindTR069ProfileMissingSendsNothing(t *testing.T) {
	for name, table := range map[string]string{
		"kosong":     "  Error, There's no tr069profile exist\r\n",
		"id lain":    profileTable("2           NOC           0"),
		"nama angka": profileTable("10          7             0"),
	} {
		t.Run(name, func(t *testing.T) {
			f := startFakeOlt(t, "NOCApp", "rahasia", bindReplies(table))
			d := newTestDriver(t, f, "rahasia")
			_, err := binderOf(t, d).BindTR069(context.Background(), 1, []OnuRef{{Pon: 1, Onu: 1}})
			if !errors.Is(err, ErrTR069ProfileMissing) {
				t.Fatalf("err=%v", err)
			}
			for _, c := range f.commands() {
				if strings.HasPrefix(c, "interface") || strings.HasPrefix(c, "onu-tr069 ") {
					t.Errorf("tidak boleh mengirim perintah tulis tanpa profil: %q", c)
				}
			}
		})
	}
}

func TestBindTR069RejectionsAreReportedPerOnu(t *testing.T) {
	f := startFakeOlt(t, "NOCApp", "rahasia", bindReplies(profileTable("1           NOC           0")))
	d := newTestDriver(t, f, "rahasia")
	res, err := binderOf(t, d).BindTR069(context.Background(), 1, []OnuRef{{1, 2}, {1, 3}, {1, 1}})
	if err != nil || len(res) != 3 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if !errors.Is(res[0].Err, ErrBindRejected) || !errors.Is(res[1].Err, ErrBindRejected) {
		t.Errorf("dua pertama harus ditolak: %+v", res)
	}
	if res[2].Err != nil {
		t.Errorf("ONU ketiga harus berhasil walau dua sebelumnya ditolak: %v", res[2].Err)
	}
}

func TestBindTR069RejectsOutOfRangeBeforeSending(t *testing.T) {
	f := startFakeOlt(t, "NOCApp", "rahasia", bindReplies(profileTable("1           NOC           0")))
	d := newTestDriver(t, f, "rahasia")
	res, err := binderOf(t, d).BindTR069(context.Background(), 1, []OnuRef{{0, 1}, {9, 1}, {1, 0}, {1, 65}, {-1, 5}})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range res {
		if r.Err == nil {
			t.Errorf("harus ditolak: %+v", r.Ref)
		}
	}
	for _, c := range f.commands() {
		if strings.HasPrefix(c, "interface") || strings.HasPrefix(c, "onu-tr069 ") {
			t.Errorf("rentang tidak sah tidak boleh sampai ke OLT: %q", c)
		}
	}
	if _, err := binderOf(t, d).BindTR069(context.Background(), 33, []OnuRef{{1, 1}}); err == nil {
		t.Error("profil 33 harus ditolak")
	}
	if _, err := binderOf(t, d).BindTR069(context.Background(), 0, []OnuRef{{1, 1}}); err == nil {
		t.Error("profil 0 harus ditolak")
	}
}

// --- AutoBinder ---

type fakeBindStore struct {
	since     int
	cands     []OnuRef
	bound     []OnuRef
	candCalls int
	lastMode  AutoBindMode
	lastLimit int
}

func (s *fakeBindStore) EnsureSince(context.Context, string) error { s.since++; return nil }
func (s *fakeBindStore) Candidates(_ context.Context, _ string, m AutoBindMode, limit int) ([]OnuRef, error) {
	s.candCalls++
	s.lastMode, s.lastLimit = m, limit
	return s.cands, nil
}
func (s *fakeBindStore) MarkBound(_ context.Context, _ string, r OnuRef) error {
	s.bound = append(s.bound, r)
	return nil
}

type fakeBinderDriver struct {
	Driver
	calls   int
	results func([]OnuRef) ([]BindResult, error)
	asked   [][]OnuRef
}

func (d *fakeBinderDriver) Name() string { return "fake" }
func (d *fakeBinderDriver) BindTR069(_ context.Context, _ int, onus []OnuRef) ([]BindResult, error) {
	d.calls++
	d.asked = append(d.asked, onus)
	return d.results(onus)
}

type plainDriver struct{ Driver }

func (plainDriver) Name() string { return "plain" }

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func okAll(onus []OnuRef) ([]BindResult, error) {
	out := make([]BindResult, len(onus))
	for i, o := range onus {
		out[i] = BindResult{Ref: o}
	}
	return out, nil
}

func TestAutoBinderOffDoesNothing(t *testing.T) {
	st := &fakeBindStore{cands: []OnuRef{{1, 1}}}
	d := &fakeBinderDriver{results: okAll}
	b := NewAutoBinder(AutoBindConfig{Mode: AutoBindOff, ProfileID: 1, MaxPerRound: 5}, st, quiet())
	if err := b.Run(context.Background(), "olt", d); err != nil {
		t.Fatal(err)
	}
	if d.calls != 0 || st.candCalls != 0 || st.since != 0 {
		t.Errorf("mode off tidak boleh menyentuh store atau OLT: %+v calls=%d", st, d.calls)
	}
}

func TestAutoBinderNewBindsAndMarks(t *testing.T) {
	st := &fakeBindStore{cands: []OnuRef{{1, 4}, {2, 1}}}
	d := &fakeBinderDriver{results: okAll}
	b := NewAutoBinder(AutoBindConfig{Mode: AutoBindNew, ProfileID: 1, MaxPerRound: 5}, st, quiet())
	if err := b.Run(context.Background(), "olt", d); err != nil {
		t.Fatal(err)
	}
	if st.since != 1 || st.lastMode != AutoBindNew {
		t.Errorf("mode new harus menandai awal: %+v", st)
	}
	if len(st.bound) != 2 || d.calls != 1 {
		t.Errorf("bound=%v calls=%d", st.bound, d.calls)
	}
}

func TestAutoBinderNoCandidatesOpensNoSession(t *testing.T) {
	st := &fakeBindStore{}
	d := &fakeBinderDriver{results: okAll}
	b := NewAutoBinder(AutoBindConfig{Mode: AutoBindNew, ProfileID: 1, MaxPerRound: 5}, st, quiet())
	if err := b.Run(context.Background(), "olt", d); err != nil || d.calls != 0 {
		t.Fatalf("err=%v calls=%d", err, d.calls)
	}
}

func TestAutoBinderCapsPerRound(t *testing.T) {
	var cands []OnuRef
	for i := 1; i <= 12; i++ {
		cands = append(cands, OnuRef{1, i})
	}
	st := &fakeBindStore{cands: cands}
	d := &fakeBinderDriver{results: okAll}
	b := NewAutoBinder(AutoBindConfig{Mode: AutoBindAll, ProfileID: 1, MaxPerRound: 3}, st, quiet())
	if err := b.Run(context.Background(), "olt", d); err != nil {
		t.Fatal(err)
	}
	if len(d.asked) != 1 || len(d.asked[0]) != 3 || len(st.bound) != 3 {
		t.Errorf("harus 3 per putaran: asked=%v bound=%v", d.asked, st.bound)
	}
	if st.since != 0 {
		t.Error("mode all tidak memakai penanda awal")
	}
}

func TestAutoBinderRejectedOnuRetriesOnlyAfterBackoff(t *testing.T) {
	st := &fakeBindStore{cands: []OnuRef{{1, 3}, {1, 4}}}
	d := &fakeBinderDriver{results: func(onus []OnuRef) ([]BindResult, error) {
		out, _ := okAll(onus)
		for i := range out {
			if out[i].Ref == (OnuRef{1, 3}) {
				out[i].Err = ErrBindRejected
			}
		}
		return out, nil
	}}
	b := NewAutoBinder(AutoBindConfig{Mode: AutoBindAll, ProfileID: 1, MaxPerRound: 5}, st, quiet())
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	b.now = func() time.Time { return now }
	if err := b.Run(context.Background(), "olt", d); err != nil {
		t.Fatal(err)
	}
	if len(st.bound) != 1 || st.bound[0] != (OnuRef{1, 4}) {
		t.Fatalf("hanya ONU yang diterima yang dicatat: %v", st.bound)
	}
	// Putaran berikut (30 dtk): ONU 1/3 masih ditahan; 1/4 sebenarnya sudah terikat di DB
	// (fake store tidak menyaring), jadi dia ikut diminta lagi; yang diuji hanya 1/3.
	now = now.Add(30 * time.Second)
	d.asked = nil
	_ = b.Run(context.Background(), "olt", d)
	for _, batch := range d.asked {
		for _, o := range batch {
			if o == (OnuRef{1, 3}) {
				t.Error("ONU yang ditolak tidak boleh dicoba lagi sebelum jeda habis")
			}
		}
	}
	now = now.Add(bindRetryAfter)
	d.asked = nil
	_ = b.Run(context.Background(), "olt", d)
	found := false
	for _, batch := range d.asked {
		for _, o := range batch {
			found = found || o == (OnuRef{1, 3})
		}
	}
	if !found {
		t.Error("sesudah jeda ONU 1/3 harus dicoba lagi")
	}
}

func TestAutoBinderMissingProfileMarksNothing(t *testing.T) {
	st := &fakeBindStore{cands: []OnuRef{{1, 1}}}
	d := &fakeBinderDriver{results: func([]OnuRef) ([]BindResult, error) { return nil, ErrTR069ProfileMissing }}
	b := NewAutoBinder(AutoBindConfig{Mode: AutoBindNew, ProfileID: 1, MaxPerRound: 5}, st, quiet())
	if err := b.Run(context.Background(), "olt", d); err != nil {
		t.Fatalf("profil belum ada bukan error polling: %v", err)
	}
	if len(st.bound) != 0 {
		t.Errorf("tidak boleh mencatat terikat: %v", st.bound)
	}
}

func TestAutoBinderUnsupportedDriver(t *testing.T) {
	st := &fakeBindStore{cands: []OnuRef{{1, 1}}}
	b := NewAutoBinder(AutoBindConfig{Mode: AutoBindNew, ProfileID: 1, MaxPerRound: 5}, st, quiet())
	err := b.Run(context.Background(), "olt", plainDriver{})
	if !errors.Is(err, ErrNotSupported) {
		t.Fatalf("err=%v", err)
	}
}

func TestAutoBindConfigFromEnv(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	cfg, err := AutoBindConfigFromEnv(env(nil))
	if err != nil || cfg.Mode != AutoBindOff || cfg.ProfileID != 1 || cfg.MaxPerRound != 5 {
		t.Errorf("bawaan harus off: %+v %v", cfg, err)
	}
	cfg, err = AutoBindConfigFromEnv(env(map[string]string{"OLT_TR069_AUTOBIND": " NEW ", "OLT_TR069_PROFILE_ID": "7", "OLT_TR069_MAX_PER_ROUND": "2"}))
	if err != nil || cfg.Mode != AutoBindNew || cfg.ProfileID != 7 || cfg.MaxPerRound != 2 {
		t.Errorf("%+v %v", cfg, err)
	}
	for name, m := range map[string]map[string]string{
		"mode salah":   {"OLT_TR069_AUTOBIND": "yes"},
		"profil 0":     {"OLT_TR069_AUTOBIND": "new", "OLT_TR069_PROFILE_ID": "0"},
		"profil 33":    {"OLT_TR069_AUTOBIND": "new", "OLT_TR069_PROFILE_ID": "33"},
		"profil huruf": {"OLT_TR069_AUTOBIND": "new", "OLT_TR069_PROFILE_ID": "x"},
		"maks 21":      {"OLT_TR069_AUTOBIND": "all", "OLT_TR069_MAX_PER_ROUND": "21"},
	} {
		cfg, err := AutoBindConfigFromEnv(env(m))
		if err == nil || cfg.Mode != AutoBindOff {
			t.Errorf("%s: harus error dan mati, got %+v err=%v", name, cfg, err)
		}
	}
}

func TestProfileExistsParsing(t *testing.T) {
	out := profileTable("1           NOC                                  3", "12          Lain                                 0")
	if !profileExists(out, 1) || !profileExists(out, 12) || profileExists(out, 2) {
		t.Error("urai tabel profil")
	}
	if profileExists("  Error, There's no tr069profile exist", 1) {
		t.Error("pesan galat bukan profil")
	}
}
