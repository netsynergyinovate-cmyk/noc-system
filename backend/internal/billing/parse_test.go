package billing

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
)

func docOf(t *testing.T, html string) *goquery.Document {
	t.Helper()
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		t.Fatalf("parse HTML: %v", err)
	}
	return doc
}

func compileProfile(t *testing.T, mutate func(*Profile)) compiledProfile {
	t.Helper()
	p := DefaultProfile()
	if mutate != nil {
		mutate(&p)
	}
	c, err := p.compile()
	if err != nil {
		t.Fatalf("compile profile: %v", err)
	}
	return c
}

func tableOf(rows string) string {
	return `<html><body><table class="invoices"><tbody>` + rows + `</tbody></table></body></html>`
}

func TestParseInvoicesDirtyHTML(t *testing.T) {
	html := `<!doctype html><html><body>
<table class="invoices">
<thead><tr><th>Ref</th><th>PPPoE</th><th>Status</th></tr></thead>
<tbody>
<tr><th>Ref</th><th>PPPoE</th><th>Status</th></tr>
<tr>
  <td class="ref">
     INV-1
  </td>
  <td class="extra">kolom tambahan</td>
  <td class="pppoe">
     Budi_01 &amp; Co
  </td>
  <td class="status"><span>  LUNAS </span></td>
</tr>
<tr></tr>
<tr><td colspan=3>&nbsp;</td></tr>
<tr><th>Ref</th><th>PPPoE</th><th>Status</th></tr>
<tr><td class="pppoe"> &nbsp;x </td><td class="status">Belum   Lunas</td></tr>
<tr><td class="ref">INV-3</td><td class="pppoe">   </td><td class="status">Lunas</td></tr>
<tr><td class="pppoe">dewi<td class="status">TERISOLIR<td class="ref">
<tr><td class="pppoe">Dewi</td><td class="status">menunggak</td></tr>
</tbody></table></body></html>`

	c := compileProfile(t, nil)
	res, err := c.parseInvoices(docOf(t, html), 1, true, 100)
	if err != nil {
		t.Fatalf("parseInvoices: %v", err)
	}
	want := []Invoice{
		{Name: "Budi_01 & Co", Ref: "INV-1", Status: StatusLunas},
		{Name: " x", Ref: "", Status: StatusIsolir},
		{Name: "dewi", Ref: "", Status: StatusIsolir},
		{Name: "Dewi", Ref: "", Status: StatusIsolir},
	}
	if !reflect.DeepEqual(res.invoices, want) {
		t.Errorf("invoices:\n got %#v\nwant %#v", res.invoices, want)
	}
	// Baris data: Budi, pemisah colspan, &nbsp;x, nama kosong, dewi, Dewi = 6.
	// Dilewati: pemisah (tanpa kolom nama) dan nama kosong = 2.
	if res.dataRows != 6 || res.skipped != 2 {
		t.Errorf("dataRows/skipped = %d/%d, want 6/2", res.dataRows, res.skipped)
	}
	if res.empty {
		t.Error("halaman dengan tagihan tidak boleh dianggap kosong")
	}
}

// Nama tidak dirapikan selain spasi HTML di ujung. Alasannya didokumentasikan di
// Invoice.Name: pencocokan "exact" dan "normalized" hanya bermakna bila perapian
// huruf dan spasi dilakukan di sana, bukan di sini.
func TestNameIsNotTidiedBeyondMarkupWhitespace(t *testing.T) {
	cases := []struct{ cell, want string }{
		{"BUDI01", "BUDI01"},
		{"  BUDI01 ", "BUDI01"},
		{"\n   BUDI01 \n", "BUDI01"},
		{"\tBUDI01\r\n", "BUDI01"},
		{"Budi01", "Budi01"},
		{"budi 01", "budi 01"},
		{"bu  di", "bu  di"},
		{"&nbsp;budi", " budi"},
		{"budi&nbsp;", "budi "},
		{"a&amp;b", "a&b"},
		{"caf&eacute;", "café"},
	}
	c := compileProfile(t, nil)
	for _, tc := range cases {
		html := tableOf(`<tr><td class="pppoe">` + tc.cell + `</td><td class="status">lunas</td></tr>`)
		res, err := c.parseInvoices(docOf(t, html), 1, true, 10)
		if err != nil {
			t.Errorf("%q: %v", tc.cell, err)
			continue
		}
		if len(res.invoices) != 1 || res.invoices[0].Name != tc.want {
			t.Errorf("%q: Name = %q, want %q", tc.cell, res.invoices[0].Name, tc.want)
		}
	}
}

func TestStatusMapping(t *testing.T) {
	c := compileProfile(t, nil)
	good := map[string]Status{
		"Lunas":          StatusLunas,
		"LUNAS":          StatusLunas,
		"  lunas \n":     StatusLunas,
		"Belum Lunas":    StatusIsolir, // memuat kata "lunas" tetapi artinya isolir
		"belum    LUNAS": StatusIsolir,
		"belum lunas":    StatusIsolir,
		"Isolir":         StatusIsolir,
		"TERISOLIR":      StatusIsolir,
		"Menunggak":      StatusIsolir,
	}
	for text, want := range good {
		html := tableOf(`<tr><td class="pppoe">u</td><td class="status">` + text + `</td></tr>`)
		res, err := c.parseInvoices(docOf(t, html), 1, true, 10)
		if err != nil {
			t.Errorf("%q: %v", text, err)
			continue
		}
		if res.invoices[0].Status != want {
			t.Errorf("%q -> %q, want %q", text, res.invoices[0].Status, want)
		}
	}

	// Tidak ada tebakan: yang tidak ada di peta adalah galat, bukan isolir.
	for _, text := range []string{"Aktif", "Lunas.", "lunas belum", "paid", "", "Sebagian", "Belum"} {
		html := tableOf(`<tr><td class="pppoe">u</td><td class="status">` + text + `</td></tr>`)
		res, err := c.parseInvoices(docOf(t, html), 1, true, 10)
		if !errors.Is(err, ErrUnknownStatus) {
			t.Errorf("%q: err = %v (invoices %v), want ErrUnknownStatus", text, err, res.invoices)
		}
	}
}

func TestUnknownStatusErrorCarriesValueAndPosition(t *testing.T) {
	c := compileProfile(t, nil)
	html := tableOf(`
<tr><th>x</th></tr>
<tr><td class="pppoe">a</td><td class="status">Lunas</td></tr>
<tr><td class="pppoe">b</td><td class="status">  Sedang   Diproses </td></tr>`)
	_, err := c.parseInvoices(docOf(t, html), 3, false, 10)
	var unknown *UnknownStatusError
	if !errors.As(err, &unknown) {
		t.Fatalf("err = %v, want *UnknownStatusError", err)
	}
	if unknown.Value != "Sedang Diproses" || unknown.Page != 3 || unknown.Row != 2 {
		t.Errorf("got %+v, want value %q page 3 row 2", *unknown, "Sedang Diproses")
	}
	if !errors.Is(err, ErrUnknownStatus) {
		t.Error("errors.Is(ErrUnknownStatus) harus benar")
	}
	for _, part := range []string{"Sedang Diproses", "halaman 3", "baris 2"} {
		if !strings.Contains(err.Error(), part) {
			t.Errorf("pesan %q tidak memuat %q", err.Error(), part)
		}
	}
}

func TestUnknownStatusValueIsTruncated(t *testing.T) {
	c := compileProfile(t, nil)
	long := strings.Repeat("x", 500)
	html := tableOf(`<tr><td class="pppoe">a</td><td class="status">` + long + `</td></tr>`)
	_, err := c.parseInvoices(docOf(t, html), 1, true, 10)
	var unknown *UnknownStatusError
	if !errors.As(err, &unknown) {
		t.Fatalf("err = %v", err)
	}
	if len([]rune(unknown.Value)) > 61 {
		t.Errorf("Value tidak dipotong: %d rune", len([]rune(unknown.Value)))
	}
}

func TestParseStructureErrors(t *testing.T) {
	c := compileProfile(t, nil)

	t.Run("halaman pertama tanpa baris", func(t *testing.T) {
		_, err := c.parseInvoices(docOf(t, `<html><body><h1>Pemeliharaan</h1></body></html>`), 1, true, 10)
		if !errors.Is(err, ErrUnexpectedPage) || !strings.Contains(err.Error(), "RowSelector") {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("halaman pertama hanya baris judul", func(t *testing.T) {
		_, err := c.parseInvoices(docOf(t, tableOf(`<tr><th>Ref</th><th>PPPoE</th></tr>`)), 1, true, 10)
		if !errors.Is(err, ErrUnexpectedPage) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("baris ada tetapi kolom nama tidak", func(t *testing.T) {
		_, err := c.parseInvoices(docOf(t, tableOf(`<tr><td class="x">a</td><td class="y">b</td></tr>`)), 1, true, 10)
		if !errors.Is(err, ErrUnexpectedPage) || !strings.Contains(err.Error(), "NameSelector") {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("nama ada tetapi kolom status tidak", func(t *testing.T) {
		_, err := c.parseInvoices(docOf(t, tableOf(`<tr><td class="pppoe">a</td></tr><tr><td class="pppoe">b</td></tr>`)), 2, false, 10)
		if !errors.Is(err, ErrUnexpectedPage) || !strings.Contains(err.Error(), "halaman 2, baris 1") {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("halaman berikutnya tanpa baris adalah halaman penutup", func(t *testing.T) {
		res, err := c.parseInvoices(docOf(t, tableOf(``)), 4, false, 10)
		if err != nil || !res.empty || len(res.invoices) != 0 {
			t.Errorf("res = %+v err = %v", res, err)
		}
		// Pesan "tidak ada data" yang berbentuk baris juga penutup di halaman lanjutan.
		res, err = c.parseInvoices(docOf(t, tableOf(`<tr><td colspan="3">Tidak ada data</td></tr>`)), 4, false, 10)
		if err != nil || !res.empty {
			t.Errorf("res = %+v err = %v", res, err)
		}
	})
}

func TestEmptySelectorAllowsLegitimatelyEmptyFirstPage(t *testing.T) {
	c := compileProfile(t, func(p *Profile) { p.EmptySelector = ".empty-state" })
	for name, html := range map[string]string{
		"tanpa baris":       `<html><body><table class="invoices"><tbody></tbody></table><p class="empty-state">Belum ada tagihan.</p></body></html>`,
		"baris pesan":       tableOf(`<tr><td colspan="3" class="empty-state">Belum ada tagihan.</td></tr>`),
		"penanda dan judul": `<html><body><table class="invoices"><tbody><tr><th>x</th></tr></tbody></table><div class="empty-state"></div></body></html>`,
	} {
		res, err := c.parseInvoices(docOf(t, html), 1, true, 10)
		if err != nil || !res.empty || len(res.invoices) != 0 {
			t.Errorf("%s: res = %+v err = %v", name, res, err)
		}
	}
	// Tanpa penanda, halaman yang sama tetap dianggap struktur yang berubah.
	_, err := c.parseInvoices(docOf(t, `<html><body><table class="invoices"><tbody></tbody></table></body></html>`), 1, true, 10)
	if !errors.Is(err, ErrUnexpectedPage) {
		t.Errorf("err = %v, want ErrUnexpectedPage", err)
	}
}

func TestParseKeepsOrderAndDuplicates(t *testing.T) {
	c := compileProfile(t, nil)
	html := tableOf(`
<tr><td class="ref">3</td><td class="pppoe">zed</td><td class="status">lunas</td></tr>
<tr><td class="ref">1</td><td class="pppoe">abe</td><td class="status">isolir</td></tr>
<tr><td class="ref">2</td><td class="pppoe">zed</td><td class="status">isolir</td></tr>
<tr><td class="ref">4</td><td class="pppoe">zed</td><td class="status">lunas</td></tr>`)
	res, err := c.parseInvoices(docOf(t, html), 1, true, 10)
	if err != nil {
		t.Fatal(err)
	}
	var refs []string
	for _, inv := range res.invoices {
		refs = append(refs, inv.Ref)
	}
	if strings.Join(refs, ",") != "3,1,2,4" {
		t.Errorf("urutan = %v, want 3,1,2,4 (urutan di situs, kembar tetap ada)", refs)
	}
}

func TestParseRowBudget(t *testing.T) {
	c := compileProfile(t, nil)
	var rows strings.Builder
	for i := 0; i < 6; i++ {
		rows.WriteString(`<tr><td class="pppoe">u</td><td class="status">lunas</td></tr>`)
	}
	if _, err := c.parseInvoices(docOf(t, tableOf(rows.String())), 1, true, 6); err != nil {
		t.Errorf("tepat di batas harus lolos: %v", err)
	}
	if _, err := c.parseInvoices(docOf(t, tableOf(rows.String())), 1, true, 5); !errors.Is(err, ErrTooLarge) {
		t.Errorf("err = %v, want ErrTooLarge", err)
	}
}

func TestParseWithoutRefSelector(t *testing.T) {
	c := compileProfile(t, func(p *Profile) { p.RefSelector = "" })
	res, err := c.parseInvoices(docOf(t, tableOf(`<tr><td class="ref">INV-9</td><td class="pppoe">u</td><td class="status">lunas</td></tr>`)), 1, true, 10)
	if err != nil || res.invoices[0].Ref != "" {
		t.Errorf("res = %+v err = %v, Ref harus kosong", res, err)
	}
}

func TestCSRFToken(t *testing.T) {
	c := compileProfile(t, nil)
	cases := []struct {
		name, html, want string
		err              error
	}{
		{"input", `<form><input type="hidden" name="_token" value="abc123"></form>`, "abc123", nil},
		{"spasi ujung", `<form><input name="_token" value="  abc123 "></form>`, "abc123", nil},
		{"yang pertama tidak kosong", `<input name="_token" value=""><input name="_token" value="kedua">`, "kedua", nil},
		{"hilang", `<form><input name="other" value="x"></form>`, "", ErrCSRFNotFound},
		{"kosong", `<form><input name="_token" value=""></form>`, "", ErrCSRFNotFound},
		{"tanpa atribut value", `<form><input name="_token"></form>`, "", ErrCSRFNotFound},
		{"hanya spasi", `<form><input name="_token" value="   "></form>`, "", ErrCSRFNotFound},
	}
	for _, tc := range cases {
		got, err := c.csrfToken(docOf(t, "<html><body>"+tc.html+"</body></html>"))
		if !errors.Is(err, tc.err) || got != tc.want {
			t.Errorf("%s: got %q err %v, want %q err %v", tc.name, got, err, tc.want, tc.err)
		}
	}

	meta := compileProfile(t, func(p *Profile) {
		p.CSRFSelector = `meta[name="csrf-token"]`
		p.CSRFAttr = "content"
	})
	got, err := meta.csrfToken(docOf(t, `<html><head><meta name="csrf-token" content="dari-meta"></head><body></body></html>`))
	if err != nil || got != "dari-meta" {
		t.Errorf("meta: got %q err %v", got, err)
	}
}

func TestNormalizeStatus(t *testing.T) {
	cases := map[string]string{
		"Lunas":               "lunas",
		"  BELUM \n\t LUNAS ": "belum lunas",
		"belum lunas":         "belum lunas",
		"":                    "",
		"   ":                 "",
	}
	for in, want := range cases {
		if got := normalizeStatus(in); got != want {
			t.Errorf("normalizeStatus(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTrimMarkupKeepsNonBreakingSpace(t *testing.T) {
	if got := trimMarkup(" \t\n\f\r x  \n"); got != " x " {
		t.Errorf("trimMarkup = %q", got)
	}
}

func TestProfileValidation(t *testing.T) {
	bad := map[string]func(*Profile){
		"LoginPath kosong":        func(p *Profile) { p.LoginPath = "" },
		"LoginPath bukan path":    func(p *Profile) { p.LoginPath = "login" },
		"LoginPath URL penuh":     func(p *Profile) { p.LoginPath = "https://evil.example/login" },
		"LoginPath skema relatif": func(p *Profile) { p.LoginPath = "//evil.example/login" },
		"LoginPostPath salah":     func(p *Profile) { p.LoginPostPath = "http://evil.example/post" },
		"LandingPath salah":       func(p *Profile) { p.LoginSuccess.LandingPath = "dashboard" },
		"InvoicesPath kosong":     func(p *Profile) { p.InvoicesPath = "" },
		"InvoicesPath URL penuh":  func(p *Profile) { p.InvoicesPath = "https://evil.example/invoices?page=%d" },
		"dua penanda halaman":     func(p *Profile) { p.InvoicesPath = "/invoices/%d?page=%d" },
		"penanda halaman + next":  func(p *Profile) { p.NextSelector = "a.next" },
		"selektor baris salah":    func(p *Profile) { p.RowSelector = "table[" },
		"selektor nama kosong":    func(p *Profile) { p.NameSelector = "" },
		"selektor status salah":   func(p *Profile) { p.StatusSelector = "td..status" },
		"selektor csrf salah":     func(p *Profile) { p.CSRFSelector = "input[name=" },
		"selektor ref salah":      func(p *Profile) { p.RefSelector = ":::" },
		"selektor next salah":     func(p *Profile) { p.InvoicesPath = "/invoices"; p.NextSelector = "a[" },
		"selektor sukses salah":   func(p *Profile) { p.LoginSuccess.SuccessSelector = "div[" },
		"selektor gagal salah":    func(p *Profile) { p.LoginSuccess.FailureSelector = "div[" },
		"selektor kosong-penanda": func(p *Profile) { p.EmptySelector = "((" },
		"CSRFAttr kosong":         func(p *Profile) { p.CSRFAttr = "" },
		"CSRFField kosong":        func(p *Profile) { p.CSRFField = "" },
		"kolom form sama":         func(p *Profile) { p.UsernameField = p.PasswordField },
		"extra menimpa password":  func(p *Profile) { p.LoginExtraFields = map[string]string{p.PasswordField: "x"} },
		"extra menimpa csrf":      func(p *Profile) { p.LoginExtraFields = map[string]string{p.CSRFField: "x"} },
		"extra nama kosong":       func(p *Profile) { p.LoginExtraFields = map[string]string{"": "x"} },
		"StatusMap kosong":        func(p *Profile) { p.StatusMap = map[string]Status{} },
		"StatusMap nilai salah":   func(p *Profile) { p.StatusMap = map[string]Status{"aktif": "aktif"} },
		"StatusMap kunci kosong":  func(p *Profile) { p.StatusMap = map[string]Status{"  ": StatusLunas} },
		"StatusMap kunci bentrok": func(p *Profile) {
			p.StatusMap = map[string]Status{"Belum Lunas": StatusIsolir, "belum  lunas": StatusLunas}
		},
	}
	for name, mutate := range bad {
		p := DefaultProfile()
		mutate(&p)
		if _, err := p.compile(); !errors.Is(err, ErrInvalidConfig) {
			t.Errorf("%s: err = %v, want ErrInvalidConfig", name, err)
		}
	}

	good := map[string]func(*Profile){
		"bawaan":                func(p *Profile) {},
		"tanpa penanda halaman": func(p *Profile) { p.InvoicesPath = "/invoices" },
		"mode next":             func(p *Profile) { p.InvoicesPath = "/invoices"; p.NextSelector = `a[rel="next"]` },
		"penanda di path":       func(p *Profile) { p.InvoicesPath = "/invoices/page/%d" },
		"meta":                  func(p *Profile) { p.CSRFSelector = `meta[name="csrf-token"]`; p.CSRFAttr = "content" },
		"kunci bentrok sama arti": func(p *Profile) {
			p.StatusMap = map[string]Status{"Lunas": StatusLunas, "LUNAS": StatusLunas}
		},
		"extra": func(p *Profile) { p.LoginExtraFields = map[string]string{"remember": "1"} },
		"landing": func(p *Profile) {
			p.LoginSuccess = LoginSuccess{LandingPath: "/dashboard", SuccessSelector: "a.logout", FailureSelector: ".alert"}
		},
		"post path": func(p *Profile) { p.LoginPostPath = "/session" },
		"empty":     func(p *Profile) { p.EmptySelector = ".empty" },
		"tanpa ref": func(p *Profile) { p.RefSelector = "" },
	}
	for name, mutate := range good {
		p := DefaultProfile()
		mutate(&p)
		if _, err := p.compile(); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestProfileValidationMessagesNameTheField(t *testing.T) {
	p := DefaultProfile()
	p.RowSelector = "table["
	_, err := p.compile()
	if err == nil || !strings.Contains(err.Error(), "RowSelector") {
		t.Errorf("pesan harus menyebut RowSelector: %v", err)
	}
}

func TestDefaultProfileIsIndependentCopy(t *testing.T) {
	a := DefaultProfile()
	a.StatusMap["aktif"] = StatusLunas
	a.LoginPath = "/ubah"
	b := DefaultProfile()
	if _, ok := b.StatusMap["aktif"]; ok || b.LoginPath != "/login" {
		t.Error("DefaultProfile harus mengembalikan salinan baru tiap kali")
	}
	if _, ok := DefaultStatusMap()["aktif"]; ok {
		t.Error("DefaultStatusMap harus mengembalikan peta baru tiap kali")
	}
	// Isi bawaan sesuai yang didokumentasikan.
	want := map[string]Status{"lunas": StatusLunas, "belum lunas": StatusIsolir, "isolir": StatusIsolir, "terisolir": StatusIsolir, "menunggak": StatusIsolir}
	if !reflect.DeepEqual(DefaultStatusMap(), want) {
		t.Errorf("DefaultStatusMap = %v", DefaultStatusMap())
	}
}

func TestCompiledProfileDoesNotAliasCallerMap(t *testing.T) {
	p := DefaultProfile()
	c, err := p.compile()
	if err != nil {
		t.Fatal(err)
	}
	p.StatusMap["aneh"] = StatusLunas
	html := tableOf(`<tr><td class="pppoe">u</td><td class="status">aneh</td></tr>`)
	if _, err := c.parseInvoices(docOf(t, html), 1, true, 10); !errors.Is(err, ErrUnknownStatus) {
		t.Errorf("perubahan peta pemanggil sesudah compile tidak boleh berlaku: %v", err)
	}
}

func TestCustomProfileStatusAndSelectors(t *testing.T) {
	c := compileProfile(t, func(p *Profile) {
		p.RowSelector = "#tagihan tr.row"
		p.NameSelector = ".user"
		p.StatusSelector = ".state"
		p.RefSelector = ".no"
		p.StatusMap["sudah dibayar"] = StatusLunas
		p.StatusMap["Putus"] = StatusIsolir
	})
	html := `<table id="tagihan">
<tr class="row"><td class="no">7</td><td class="user">kita</td><td class="state">Sudah Dibayar</td></tr>
<tr class="row"><td class="no">8</td><td class="user">kamu</td><td class="state">PUTUS</td></tr>
<tr class="other"><td class="user">bukan</td><td class="state">lunas</td></tr></table>`
	res, err := c.parseInvoices(docOf(t, html), 1, true, 10)
	if err != nil {
		t.Fatal(err)
	}
	want := []Invoice{{Name: "kita", Ref: "7", Status: StatusLunas}, {Name: "kamu", Ref: "8", Status: StatusIsolir}}
	if !reflect.DeepEqual(res.invoices, want) {
		t.Errorf("got %#v, want %#v", res.invoices, want)
	}
}
