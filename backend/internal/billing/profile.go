package billing

import (
	"fmt"
	"net/url"
	"reflect"
	"sort"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/andybalholm/cascadia"
)

// Profile adalah cara membaca satu situs billing tertentu. Semua kolomnya bisa
// diubah; mulai dari DefaultProfile() lalu sesuaikan. Selektor memakai sintaks
// CSS (goquery/cascadia) dan diperiksa saat Scraper dibuat, jadi selektor yang
// salah ketik gagal di awal, bukan diam-diam menemukan nol baris.
//
// Semua path relatif terhadap Config.BaseURL dan harus diawali "/".
type Profile struct {
	// LoginPath adalah halaman yang memuat form login (GET). Dipakai juga untuk
	// mengenali bahwa sesi berakhir: halaman tagihan yang berujung di path ini
	// berarti sesi hilang.
	LoginPath string
	// LoginPostPath adalah tujuan POST kredensial. Kosong berarti LoginPath.
	// Tujuan ini selalu ditulis di profil, tidak pernah dibaca dari atribut
	// action form, karena halaman yang dikendalikan pihak lain bisa menunjuknya
	// ke host mana pun.
	LoginPostPath string
	// CSRFSelector memilih elemen pembawa token di halaman login, mis.
	// `input[name="_token"]` (dibaca dari atribut value) atau
	// `meta[name="csrf-token"]` (atribut content). Elemen pertama yang nilainya
	// tidak kosong dipakai.
	CSRFSelector string
	// CSRFAttr adalah atribut yang dibaca dari elemen itu: "value" atau "content".
	CSRFAttr string
	// CSRFField adalah nama kolom form tempat token dikirim kembali.
	CSRFField string
	// UsernameField dan PasswordField adalah nama kolom form untuk kredensial.
	UsernameField string
	PasswordField string
	// LoginExtraFields adalah kolom tetap tambahan pada POST login (mis.
	// {"remember": "1"}). Tidak boleh bertabrakan dengan kolom di atas.
	LoginExtraFields map[string]string
	// LoginSuccess menentukan cara memastikan login berhasil.
	LoginSuccess LoginSuccess

	// InvoicesPath adalah halaman daftar tagihan (boleh dengan query). Ada dua
	// cara berpaginasi:
	//
	//   - NextSelector kosong: bila InvoicesPath memuat "%d" (tepat satu, mis.
	//     "/invoices?page=%d"), halaman dibaca bernomor 1, 2, 3, ... sampai
	//     ketemu halaman tanpa baris (halaman penutup). Tanpa "%d", hanya satu
	//     halaman yang dibaca.
	//   - NextSelector diisi: InvoicesPath adalah halaman pertama (tanpa "%d")
	//     dan halaman berikutnya diikuti lewat tautan itu sampai tidak ada lagi.
	//     Lebih aman, karena halaman rusak di tengah tidak dikira akhir data.
	InvoicesPath string
	// NextSelector memilih tautan "berikutnya"; href-nya diikuti bila sama asal.
	// href kosong atau "#" berarti sudah halaman terakhir.
	NextSelector string
	// EmptySelector (opsional) memilih penanda "tidak ada data" yang sah pada
	// halaman tanpa tagihan (mis. ".empty-state"). Tanpa itu, halaman PERTAMA yang
	// tidak punya satu pun baris dianggap struktur yang berubah (ErrUnexpectedPage).
	EmptySelector string
	// RowSelector memilih baris tagihan. Baris yang tidak punya sel td (baris
	// judul, ganda atau tidak) diabaikan.
	RowSelector string
	// NameSelector, StatusSelector, dan RefSelector dicari DI DALAM baris dan
	// elemen pertama yang cocok dipakai. RefSelector boleh kosong (Ref kosong).
	// Baris tanpa nama (sel tidak ada atau kosong) dilewati dan dihitung.
	NameSelector   string
	StatusSelector string
	RefSelector    string
	// StatusMap memetakan teks sel status ke Status. Teks dan kuncinya
	// dibandingkan tanpa membedakan huruf besar-kecil dan dengan spasi dirapatkan
	// ("Belum   LUNAS" = "belum lunas"). Teks yang tidak ada di peta bukan tagihan
	// yang boleh ditebak: Invoices mengembalikan ErrUnknownStatus.
	StatusMap map[string]Status
}

// LoginSuccess menentukan kapan login dianggap berhasil. Pemeriksaan dibuat
// pada halaman AKHIR setelah semua pengalihan. Status 401, 403, 419, dan 422
// selalu berarti ditolak; status lain di luar 2xx adalah galat HTTP; dan halaman
// akhir di LoginPath selalu berarti ditolak.
type LoginSuccess struct {
	// LandingPath (opsional): path halaman akhir harus persis ini (mis.
	// "/dashboard").
	LandingPath string
	// SuccessSelector (opsional): selektor yang HARUS ada di halaman akhir (mis.
	// `a[href$="/logout"]`).
	SuccessSelector string
	// FailureSelector (opsional): selektor yang bila ada berarti login ditolak
	// (mis. ".alert-danger").
	FailureSelector string
}

// DefaultStatusMap mengembalikan peta status bawaan. Hanya teks yang jelas
// artinya; teks lain (mis. "aktif", "paid") sengaja tidak ditebak dan harus
// ditambahkan di profil bila memang dipakai situsnya.
func DefaultStatusMap() map[string]Status {
	return map[string]Status{
		"lunas":       StatusLunas,
		"belum lunas": StatusIsolir,
		"isolir":      StatusIsolir,
		"terisolir":   StatusIsolir,
		"menunggak":   StatusIsolir,
	}
}

// DefaultProfile adalah profil bawaan: situs bergaya Laravel dengan form login
// di /login yang membawa input tersembunyi _token, dan daftar tagihan di
// /invoices?page=N berupa <table class="invoices"> dengan sel td.ref, td.pppoe,
// dan td.status. Ini sengaja generik; situs billing yang nyata hampir pasti
// butuh selektor sendiri. Tiap pemanggilan mengembalikan salinan baru.
func DefaultProfile() Profile {
	return Profile{
		LoginPath:      "/login",
		CSRFSelector:   `input[name="_token"]`,
		CSRFAttr:       "value",
		CSRFField:      "_token",
		UsernameField:  "username",
		PasswordField:  "password",
		InvoicesPath:   "/invoices?page=%d",
		RowSelector:    "table.invoices tbody tr",
		NameSelector:   "td.pppoe",
		StatusSelector: "td.status",
		RefSelector:    "td.ref",
		StatusMap:      DefaultStatusMap(),
	}
}

func isZeroProfile(p Profile) bool {
	return reflect.DeepEqual(p, Profile{})
}

// pageToken adalah penanda nomor halaman pada InvoicesPath.
const pageToken = "%d"

// compiledProfile adalah Profile yang sudah diperiksa, dengan selektor yang
// sudah dikompilasi dan peta status yang sudah dirapatkan. Ia memegang salinan
// sendiri, jadi mengubah Profile asli sesudahnya tidak berpengaruh.
type compiledProfile struct {
	Profile

	csrf, next, empty, row, name, status, ref goquery.Matcher
	success, failure                          goquery.Matcher
	passwordInput                             goquery.Matcher

	statuses map[string]Status
	// paged benar bila InvoicesPath memuat "%d".
	paged bool
}

func (p Profile) compile() (compiledProfile, error) {
	bad := func(format string, args ...any) error {
		return fmt.Errorf("%w: profil: %s", ErrInvalidConfig, fmt.Sprintf(format, args...))
	}

	required := []struct{ name, value string }{
		{"LoginPath", p.LoginPath},
		{"CSRFSelector", p.CSRFSelector},
		{"CSRFAttr", p.CSRFAttr},
		{"CSRFField", p.CSRFField},
		{"UsernameField", p.UsernameField},
		{"PasswordField", p.PasswordField},
		{"InvoicesPath", p.InvoicesPath},
		{"RowSelector", p.RowSelector},
		{"NameSelector", p.NameSelector},
		{"StatusSelector", p.StatusSelector},
	}
	for _, f := range required {
		if strings.TrimSpace(f.value) == "" {
			return compiledProfile{}, bad("%s kosong (mulai dari DefaultProfile() lalu ubah kolomnya)", f.name)
		}
	}
	if len(p.StatusMap) == 0 {
		return compiledProfile{}, bad("StatusMap kosong")
	}

	c := compiledProfile{Profile: p}

	// Path: harus path murni di bawah BaseURL.
	for _, f := range []struct{ name, value string }{
		{"LoginPath", p.LoginPath},
		{"LoginPostPath", p.LoginPostPath},
		{"LoginSuccess.LandingPath", p.LoginSuccess.LandingPath},
	} {
		if f.value == "" {
			continue
		}
		if err := checkPath(f.value); err != nil {
			return compiledProfile{}, bad("%s %v", f.name, err)
		}
	}

	switch n := strings.Count(p.InvoicesPath, pageToken); {
	case n > 1:
		return compiledProfile{}, bad("InvoicesPath hanya boleh memuat %q satu kali", pageToken)
	case n == 1 && p.NextSelector != "":
		return compiledProfile{}, bad("InvoicesPath tidak boleh memuat %q bila NextSelector diisi", pageToken)
	case n == 1:
		c.paged = true
	}
	if err := checkPath(strings.Replace(p.InvoicesPath, pageToken, "1", 1)); err != nil {
		return compiledProfile{}, bad("InvoicesPath %v", err)
	}

	// Kolom form tidak boleh saling menimpa.
	fields := map[string]string{
		p.UsernameField: "UsernameField",
		p.PasswordField: "PasswordField",
		p.CSRFField:     "CSRFField",
	}
	if len(fields) != 3 {
		return compiledProfile{}, bad("UsernameField, PasswordField, dan CSRFField harus berbeda")
	}
	for key := range p.LoginExtraFields {
		if key == "" {
			return compiledProfile{}, bad("LoginExtraFields memuat nama kosong")
		}
		if owner, clash := fields[key]; clash {
			return compiledProfile{}, bad("LoginExtraFields[%q] bertabrakan dengan %s", key, owner)
		}
	}
	// Salin supaya perubahan peta pemanggil sesudah ini tidak ikut berlaku.
	c.LoginExtraFields = make(map[string]string, len(p.LoginExtraFields))
	for k, v := range p.LoginExtraFields {
		c.LoginExtraFields[k] = v
	}

	selectors := []struct {
		name     string
		value    string
		optional bool
		dst      *goquery.Matcher
	}{
		{"CSRFSelector", p.CSRFSelector, false, &c.csrf},
		{"NextSelector", p.NextSelector, true, &c.next},
		{"EmptySelector", p.EmptySelector, true, &c.empty},
		{"RowSelector", p.RowSelector, false, &c.row},
		{"NameSelector", p.NameSelector, false, &c.name},
		{"StatusSelector", p.StatusSelector, false, &c.status},
		{"RefSelector", p.RefSelector, true, &c.ref},
		{"LoginSuccess.SuccessSelector", p.LoginSuccess.SuccessSelector, true, &c.success},
		{"LoginSuccess.FailureSelector", p.LoginSuccess.FailureSelector, true, &c.failure},
	}
	for _, s := range selectors {
		if s.value == "" && s.optional {
			continue
		}
		m, err := cascadia.Compile(s.value)
		if err != nil {
			return compiledProfile{}, bad("%s %q bukan selektor CSS yang sah: %v", s.name, s.value, err)
		}
		*s.dst = m
	}
	// Selektor yang dipakai untuk "ambil elemen pertama" tidak perlu membangun
	// daftar lengkap.
	c.name = goquery.SingleMatcher(c.name)
	c.status = goquery.SingleMatcher(c.status)
	if c.ref != nil {
		c.ref = goquery.SingleMatcher(c.ref)
	}
	if c.next != nil {
		c.next = goquery.SingleMatcher(c.next)
	}
	// Kotak kata sandi di halaman: tanda bahwa itu halaman login.
	c.passwordInput = cascadia.MustCompile(`input[type="password" i]`)

	statuses, err := normalizeStatusMap(p.StatusMap)
	if err != nil {
		return compiledProfile{}, bad("%v", err)
	}
	c.statuses = statuses
	// Peta asli tidak dipegang lagi.
	c.StatusMap = nil
	return c, nil
}

// normalizeStatusMap merapatkan kunci peta dan menolak nilai yang bukan Status
// dikenal atau dua kunci yang menjadi sama tetapi artinya beda.
func normalizeStatusMap(in map[string]Status) (map[string]Status, error) {
	keys := make([]string, 0, len(in))
	for k := range in {
		keys = append(keys, k)
	}
	sort.Strings(keys) // urutan tetap, supaya pesan galat deterministik
	out := make(map[string]Status, len(in))
	for _, k := range keys {
		v := in[k]
		nk := normalizeStatus(k)
		if nk == "" {
			return nil, fmt.Errorf("StatusMap memuat kunci kosong")
		}
		if !v.Valid() {
			return nil, fmt.Errorf("StatusMap[%q] bernilai %q; harus %q atau %q", k, string(v), StatusLunas, StatusIsolir)
		}
		if prev, dup := out[nk]; dup && prev != v {
			return nil, fmt.Errorf("StatusMap memuat dua kunci yang sama setelah dirapatkan (%q) dengan arti berbeda", nk)
		}
		out[nk] = v
	}
	return out, nil
}

// normalizeStatus mengubah teks status menjadi bentuk pembanding: huruf kecil,
// semua rentetan spasi (termasuk &nbsp;) menjadi satu spasi, tanpa spasi ujung.
func normalizeStatus(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// checkPath memastikan p path murni yang diawali "/" (bukan "//host", bukan URL
// penuh, tanpa fragmen).
func checkPath(p string) error {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") {
		return fmt.Errorf("harus diawali satu \"/\" (path di bawah BaseURL)")
	}
	u, err := url.Parse(p)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil || u.Fragment != "" {
		return fmt.Errorf("harus berupa path (dengan query bila perlu), bukan URL penuh atau fragmen")
	}
	return nil
}
