package collector

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	testUser     = "noc-api"
	testPassword = "rahasia-router-123"
)

// queueJSON meniru bentuk jawaban REST RouterOS: array objek, semua nilai string.
const queueJSON = `[
  {".id":"*1","name":"<pppoe-budi>","rate":"1000000/8000000","max-limit":"1500000/10000000","parent":"none","disabled":"false"},
  {".id":"*2","name":"<pppoe-siti>","rate":"500000/2500000","max-limit":"1000000/3000000","parent":"none","disabled":"false"},
  {".id":"*3","name":"anak","rate":"250000/1000000","max-limit":"500000/2000000","parent":"<pppoe-budi>","disabled":"false"},
  {".id":"*4","name":"mati","rate":"0/0","max-limit":"0/0","parent":"none","disabled":"true"}
]`

func fakeRouter(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}

func target(server *httptest.Server) Target {
	return Target{RouterID: "r1", BaseURL: server.URL, Username: testUser, Password: testPassword}
}

func okHandler(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}
}

func TestFetchSendsOneBulkAuthenticatedRequest(t *testing.T) {
	var gotPath, gotProplist, gotUser, gotPass, gotMethod string
	var hasAuth bool
	requests := 0
	server := fakeRouter(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		gotMethod, gotPath, gotProplist = r.Method, r.URL.Path, r.URL.Query().Get(".proplist")
		gotUser, gotPass, hasAuth = r.BasicAuth()
		okHandler(queueJSON)(w, r)
	})

	client, err := NewClient(target(server), nil)
	if err != nil {
		t.Fatal(err)
	}
	samples, err := client.Queues(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}

	if requests != 1 {
		t.Errorf("jumlah permintaan = %d, want 1 (satu permintaan massal, bukan per pelanggan)", requests)
	}
	if gotMethod != http.MethodGet || gotPath != "/rest/queue/simple" {
		t.Errorf("permintaan = %s %s, want GET /rest/queue/simple", gotMethod, gotPath)
	}
	if gotProplist != "name,rate,max-limit,parent,disabled" {
		t.Errorf(".proplist = %q, want kolom yang dibutuhkan saja", gotProplist)
	}
	if !hasAuth || gotUser != testUser || gotPass != testPassword {
		t.Errorf("Basic auth = %v %q:%q", hasAuth, gotUser, gotPass)
	}
	if len(samples) != 4 {
		t.Fatalf("jumlah sampel = %d, want 4", len(samples))
	}
	if samples[0].Name != "<pppoe-budi>" || samples[0].UpBps != 1_000_000 || samples[0].DownBps != 8_000_000 || samples[0].UpMax != 1_500_000 || samples[0].DownMax != 10_000_000 {
		t.Errorf("sampel pertama = %+v, want up 1.000.000 down 8.000.000, up max 1.500.000 down max 10.000.000", samples[0])
	}
	if !samples[0].TopLevel() || samples[2].TopLevel() || !samples[3].Disabled {
		t.Errorf("TopLevel/Disabled salah: %+v", samples)
	}
}

func TestTotalsCountOnlyEnabledTopLevelQueues(t *testing.T) {
	client, _ := NewClient(target(fakeRouter(t, okHandler(queueJSON))), nil)
	samples, err := client.Queues(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	down, up, counted := Totals(samples)
	// budi 8 + siti 2,5 = 10,5 Mbps unduh; 1 + 0,5 = 1,5 Mbps unggah.
	// Anak queue (1 Mbps) dan queue mati tidak dihitung.
	if down != 10.5 || up != 1.5 || counted != 2 {
		t.Errorf("Totals = %v down, %v up, %d queue; want 10,5 down, 1,5 up, 2 queue", down, up, counted)
	}
	if d, u, n := Totals(nil); d != 0 || u != 0 || n != 0 {
		t.Errorf("Totals(nil) = %v %v %d, want nol", d, u, n)
	}
}

func TestParseQueuesSkipsUnreadableRowsButKeepsTheRest(t *testing.T) {
	samples, err := parseQueues([]byte(`[
	  {"name":"ok","rate":"10/20","max-limit":"100/200","parent":"none","disabled":"false"},
	  {"name":"tanpa-rate","parent":"none"},
	  {"name":"bukan-angka","rate":"abc/def"},
	  {"name":"tiga-bagian","rate":"1/2/3"},
	  {"name":"negatif","rate":"-1/5"},
	  {"name":"terlalu-besar","rate":"99999999999999999999/1"},
	  {"name":"tanpa-garis-miring","rate":"100"}
	]`))
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 1 || samples[0].Name != "ok" || samples[0].UpBps != 10 || samples[0].DownBps != 20 || samples[0].UpMax != 100 || samples[0].DownMax != 200 {
		t.Errorf("samples = %+v, want hanya baris yang valid", samples)
	}
}

func TestParseQueuesRejectsNonListResponses(t *testing.T) {
	for name, body := range map[string]string{
		"bukan JSON":      "<html>login</html>",
		"objek tunggal":   `{"error":401,"message":"Unauthorized"}`,
		"kosong":          "",
		"nilai bukan str": `[{"name":"x","rate":5}]`,
	} {
		if _, err := parseQueues([]byte(body)); err == nil {
			t.Errorf("%s: parseQueues seharusnya gagal", name)
		}
	}
	if samples, err := parseQueues([]byte(`[]`)); err != nil || len(samples) != 0 {
		t.Errorf("daftar kosong: %v, %v; want kosong tanpa error", samples, err)
	}
}

func TestFetchExplainsCommonRouterErrors(t *testing.T) {
	tests := []struct {
		status int
		want   string
	}{
		{http.StatusUnauthorized, "username dan kata sandi"},
		{http.StatusForbidden, "username dan kata sandi"},
		{http.StatusNotFound, "REST"},
		{http.StatusInternalServerError, "HTTP 500"},
	}
	for _, tt := range tests {
		server := fakeRouter(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tt.status)
			_, _ = io.WriteString(w, `{"detail":"`+testPassword+`"}`) // isi error tidak boleh bocor
		})
		client, _ := NewClient(target(server), nil)
		_, err := client.Queues(context.Background())
		if err == nil || !strings.Contains(err.Error(), tt.want) {
			t.Errorf("HTTP %d: err = %v, want memuat %q", tt.status, err, tt.want)
			continue
		}
		if strings.Contains(err.Error(), testPassword) {
			t.Errorf("HTTP %d: error membocorkan isi jawaban router: %v", tt.status, err)
		}
	}
}

func TestFetchErrorsNeverLeakCredentialsOrQuery(t *testing.T) {
	server := fakeRouter(t, okHandler("[]"))
	tgt := target(server)
	server.Close() // router mati
	client, _ := NewClient(tgt, &http.Client{Timeout: time.Second})
	_, err := client.Queues(context.Background())
	if err == nil {
		t.Fatal("seharusnya gagal menghubungi router yang mati")
	}
	for _, secret := range []string{testPassword, testUser, "proplist"} {
		if strings.Contains(err.Error(), secret) {
			t.Errorf("error memuat %q: %v", secret, err)
		}
	}
}

func TestFetchRejectsOversizedResponse(t *testing.T) {
	server := fakeRouter(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "[")
		chunk := strings.Repeat(" ", 1<<20)
		for i := 0; i < 17; i++ {
			_, _ = io.WriteString(w, chunk)
		}
		_, _ = io.WriteString(w, "]")
	})
	client, _ := NewClient(target(server), nil)
	_, err := client.Queues(context.Background())
	if err == nil || !strings.Contains(err.Error(), "MB") {
		t.Errorf("err = %v, want penolakan jawaban yang terlalu besar", err)
	}
}

func TestFetchHonorsContextCancellation(t *testing.T) {
	release := make(chan struct{})
	server := fakeRouter(t, func(w http.ResponseWriter, r *http.Request) { <-release })
	defer close(release)
	client, _ := NewClient(target(server), nil)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := client.Queues(ctx); err == nil {
		t.Fatal("seharusnya gagal saat ctx habis")
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Errorf("Fetch menunggu %s padahal ctx sudah habis", elapsed)
	}
}

func TestNewClientValidatesTarget(t *testing.T) {
	good := Target{RouterID: "r1", BaseURL: "https://10.0.0.1", Username: "api", Password: "x"}
	if _, err := NewClient(good, nil); err != nil {
		t.Fatalf("target valid ditolak: %v", err)
	}
	for name, mutate := range map[string]func(*Target){
		"tanpa RouterID":    func(t *Target) { t.RouterID = "" },
		"tanpa skema":       func(t *Target) { t.BaseURL = "10.0.0.1" },
		"skema ftp":         func(t *Target) { t.BaseURL = "ftp://10.0.0.1" },
		"tanpa host":        func(t *Target) { t.BaseURL = "https://" },
		"kredensial di URL": func(t *Target) { t.BaseURL = "https://api:x@10.0.0.1" },
		"ada path":          func(t *Target) { t.BaseURL = "https://10.0.0.1/rest" },
		"ada query":         func(t *Target) { t.BaseURL = "https://10.0.0.1?a=1" },
		"tanpa username":    func(t *Target) { t.Username = "" },
		"BaseURL kosong":    func(t *Target) { t.BaseURL = "" },
	} {
		tgt := good
		mutate(&tgt)
		if _, err := NewClient(tgt, nil); err == nil {
			t.Errorf("%s: seharusnya ditolak", name)
		}
	}
}

func TestTLSIsVerifiedByDefault(t *testing.T) {
	server := httptest.NewTLSServer(okHandler(queueJSON))
	t.Cleanup(server.Close)
	tgt := Target{RouterID: "r1", BaseURL: server.URL, Username: testUser, Password: testPassword}

	// Sertifikat server uji tidak dikenal klien bawaan, dan itu harus ditolak.
	defaultClient, _ := NewClient(tgt, nil)
	if _, err := defaultClient.Queues(context.Background()); err == nil {
		t.Fatal("sertifikat tidak dikenal seharusnya ditolak oleh klien bawaan")
	}

	// Setelah CA router dipercaya, koneksi berhasil.
	trusted, _ := NewClient(tgt, server.Client())
	samples, err := trusted.Queues(context.Background())
	if err != nil || len(samples) != 4 {
		t.Errorf("dengan CA tepercaya: %v sampel, err = %v", len(samples), err)
	}
}
