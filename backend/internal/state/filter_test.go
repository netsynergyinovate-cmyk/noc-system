package state

import "testing"

func ids(customers []Customer) string {
	out := ""
	for _, c := range customers {
		out += c.ID + " "
	}
	return out
}

func filterFixture() []Customer {
	return []Customer{
		{ID: "c1", Name: "budi Santoso", PPPoEUsername: "budi.santoso001", Address: "Jl. Mawar No. 1", RouterID: "r1", IsOnline: true, HasOptical: true, OpticalPowerDbm: -20},
		{ID: "c2", Name: "Siti Wati", PPPoEUsername: "siti.wati002", Address: "Jl. Melati No. 9", RouterID: "r2", IsOnline: true, HasOptical: true, OpticalPowerDbm: -27},
		{ID: "c3", Name: "Agus Hidayat", PPPoEUsername: "agus.hidayat003", Address: "Jl. Mawar No. 7", RouterID: "r1", IsOnline: false, HasOptical: true, OpticalPowerDbm: -30},
		{ID: "c4", Name: "Andi", PPPoEUsername: "andi004", RouterID: "r2", IsOnline: true},
	}
}

func TestParseStatusFilter(t *testing.T) {
	for in, want := range map[string]StatusFilter{"": StatusAll, "all": StatusAll, "online": StatusOnline, "offline": StatusOffline, "weak": StatusWeak} {
		got, ok := ParseStatusFilter(in)
		if !ok || got != want {
			t.Errorf("ParseStatusFilter(%q) = %q, %v; want %q, true", in, got, ok, want)
		}
	}
	for _, bad := range []string{"ONLINE", "mati", "weak ", "1"} {
		if _, ok := ParseStatusFilter(bad); ok {
			t.Errorf("ParseStatusFilter(%q) seharusnya ditolak", bad)
		}
	}
}

func TestFilterByStatusMatchesFrontendSemantics(t *testing.T) {
	customers := filterFixture()
	// Urutan hasil: nama tanpa memedulikan huruf besar/kecil, yaitu Agus, Andi,
	// budi, Siti.
	tests := []struct {
		status StatusFilter
		want   string
	}{
		{StatusAll, "c3 c4 c1 c2 "},
		{StatusOnline, "c4 c1 c2 "}, // online termasuk yang sinyalnya lemah
		{StatusOffline, "c3 "},
		{StatusWeak, "c2 "}, // c3 sinyalnya lemah tetapi offline, jadi tidak dihitung
	}
	for _, tt := range tests {
		got := ids(FilterCustomers(customers, CustomerFilter{Status: tt.status}))
		if got != tt.want {
			t.Errorf("status %q = %q, want %q", tt.status, got, tt.want)
		}
	}
}

func TestFilterByRouter(t *testing.T) {
	got := ids(FilterCustomers(filterFixture(), CustomerFilter{RouterID: "r1"}))
	if got != "c3 c1 " {
		t.Errorf("router r1 = %q, want %q", got, "c3 c1 ")
	}
	if got := FilterCustomers(filterFixture(), CustomerFilter{RouterID: "tidak-ada"}); len(got) != 0 {
		t.Errorf("router tak dikenal = %v, want kosong", got)
	}
}

func TestFilterQueryIsCaseInsensitiveAcrossNameUsernameAndAddress(t *testing.T) {
	customers := filterFixture()
	tests := map[string]string{
		"BUDI":      "c1 ", // nama, huruf besar
		"wati002":   "c2 ", // username
		"  mawar  ": "c3 c1 ",
		"andi004":   "c4 ",
		"no. 9":     "c2 ", // alamat
		"tidak-ada": "",
		"":          "c3 c4 c1 c2 ",
	}
	for query, want := range tests {
		if got := ids(FilterCustomers(customers, CustomerFilter{Query: query})); got != want {
			t.Errorf("query %q = %q, want %q", query, got, want)
		}
	}
}

func TestFilterCombinesAllConditions(t *testing.T) {
	got := ids(FilterCustomers(filterFixture(), CustomerFilter{Query: "mawar", Status: StatusOnline, RouterID: "r1"}))
	if got != "c1 " {
		t.Errorf("gabungan = %q, want %q", got, "c1 ")
	}
}

func TestFilterDoesNotModifyInputAndOrdersByNameThenID(t *testing.T) {
	input := []Customer{
		{ID: "b", Name: "Sama"},
		{ID: "a", Name: "sama"},
		{ID: "c", Name: "Awal"},
	}
	got := ids(FilterCustomers(input, CustomerFilter{}))
	if got != "c a b " {
		t.Errorf("urutan = %q, want %q (nama, lalu ID)", got, "c a b ")
	}
	if input[0].ID != "b" || input[2].ID != "c" {
		t.Errorf("input diubah: %v", input)
	}
}
