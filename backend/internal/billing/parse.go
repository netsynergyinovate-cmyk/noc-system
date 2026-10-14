package billing

import (
	"fmt"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// trimMarkup membuang spasi HTML (spasi, tab, baris baru, form feed, CR) di
// ujung teks. Sengaja bukan strings.TrimSpace: itu juga membuang &nbsp; dan
// spasi Unicode lain, yang terlihat di browser dan karena itu mungkin data.
func trimMarkup(s string) string {
	return strings.Trim(s, " \t\n\f\r")
}

// csrfToken membaca token dari halaman login. Elemen pertama yang atributnya
// tidak kosong menang. Nilainya tidak pernah ikut dalam galat.
func (c *compiledProfile) csrfToken(doc *goquery.Document) (string, error) {
	var token string
	doc.FindMatcher(c.csrf).EachWithBreak(func(_ int, el *goquery.Selection) bool {
		if v, ok := el.Attr(c.CSRFAttr); ok {
			if v = trimMarkup(v); v != "" {
				token = v
				return false
			}
		}
		return true
	})
	if token == "" {
		return "", ErrCSRFNotFound
	}
	return token, nil
}

// pageResult adalah hasil membaca satu halaman tagihan.
type pageResult struct {
	invoices []Invoice
	// dataRows adalah baris yang punya sel td; skipped di antaranya yang dilewati.
	dataRows int
	skipped  int
	// empty benar bila tidak ada satu pun baris yang punya kolom nama: tidak ada
	// tagihan lagi di halaman ini (halaman penutup atau daftar kosong yang sah).
	empty bool
}

// parseInvoices membaca baris tagihan dari satu halaman. first benar untuk
// halaman pertama: di sana halaman tanpa satu pun baris bukan akhir data
// melainkan tanda struktur yang berubah. rowBudget adalah sisa baris yang masih
// boleh dibaca (Config.MaxRows dikurangi yang sudah terbaca).
func (c *compiledProfile) parseInvoices(doc *goquery.Document, pageNo int, first bool, rowBudget int) (pageResult, error) {
	var res pageResult
	rows := doc.FindMatcher(c.row)
	nameFound := 0

	for i := 0; i < rows.Length(); i++ {
		tr := rows.Eq(i)
		// Baris judul (hanya th), judul ganda, dan <tr> kosong tidak punya sel td.
		if tr.ChildrenFiltered("td").Length() == 0 {
			continue
		}
		res.dataRows++
		if res.dataRows > rowBudget {
			return pageResult{}, fmt.Errorf("%w: lebih dari %d baris", ErrTooLarge, rowBudget)
		}

		nameCell := tr.FindMatcher(c.name)
		if nameCell.Length() == 0 {
			// Baris pemisah atau pesan ("Tidak ada data" dengan colspan).
			res.skipped++
			continue
		}
		nameFound++
		name := trimMarkup(nameCell.Text())
		if name == "" {
			res.skipped++
			continue
		}

		statusCell := tr.FindMatcher(c.status)
		if statusCell.Length() == 0 {
			return pageResult{}, fmt.Errorf("%w: kolom status tidak ditemukan (halaman %d, baris %d)",
				ErrUnexpectedPage, pageNo, res.dataRows)
		}
		rawStatus := statusCell.Text()
		status, ok := c.statuses[normalizeStatus(rawStatus)]
		if !ok {
			return pageResult{}, &UnknownStatusError{
				Value: truncate(strings.Join(strings.Fields(rawStatus), " "), 60),
				Page:  pageNo,
				Row:   res.dataRows,
			}
		}

		inv := Invoice{Name: name, Status: status}
		if c.ref != nil {
			inv.Ref = trimMarkup(tr.FindMatcher(c.ref).Text())
		}
		res.invoices = append(res.invoices, inv)
	}

	if nameFound == 0 {
		emptyMarked := c.empty != nil && doc.FindMatcher(c.empty).Length() > 0
		if first && !emptyMarked {
			if res.dataRows == 0 {
				return pageResult{}, fmt.Errorf("%w: RowSelector tidak menemukan baris tagihan (halaman %d)", ErrUnexpectedPage, pageNo)
			}
			return pageResult{}, fmt.Errorf("%w: NameSelector tidak menemukan kolom nama di baris mana pun (halaman %d)", ErrUnexpectedPage, pageNo)
		}
		res.empty = true
	}
	return res, nil
}
