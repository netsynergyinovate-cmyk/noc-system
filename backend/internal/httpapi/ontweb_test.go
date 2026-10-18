package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"noc-isp/backend/internal/ontweb"
)

// fakeModem: cukup untuk satu sesi sukses: login, baca tr069_config kosong,
// terima tulis, lalu mengembalikan nilai yang ditulis.
func fakeModem(t *testing.T, logins *atomic.Int32) *httptest.Server {
	t.Helper()
	cfg := map[string]any{"tr069enable": 0, "acs": map[string]any{"acsurl": "", "informenable": 0, "informinterval": 43200}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reply := func(code int, extra map[string]any) {
			out := map[string]any{"code": code}
			for k, v := range extra {
				out[k] = v
			}
			_ = json.NewEncoder(w).Encode(out)
		}
		if r.Method == http.MethodGet {
			switch r.URL.Query().Get("module") {
			case "public_info":
				reply(0, map[string]any{"model": "FD511GW"})
			case "tr069_config":
				reply(0, cfg)
			default:
				reply(0, map[string]any{"tr069Inform": 3})
			}
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch body["module"] {
		case "login":
			logins.Add(1)
			if body["username"] != "admin" {
				reply(10001, nil)
				return
			}
			reply(0, map[string]any{"token": "t"})
		case "tr069_config":
			cfg["tr069enable"] = body["tr069enable"]
			for k, v := range body["acs"].(map[string]any) {
				cfg["acs"].(map[string]any)[k] = v
			}
			reply(0, nil)
		default:
			reply(0, nil)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// ontSettings: isi tabel ont_web_settings untuk tes; nil = baris belum ada.
type ontSettings = map[string]string

func settingsToConfig(t *testing.T, env ontSettings) func(context.Context) (ontweb.Config, error) {
	nets, err := ontweb.PolicyFromEnv(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	return func(context.Context) (ontweb.Config, error) {
		if env == nil {
			return ontweb.Config{}, errOntWebNotConfigured
		}
		return ontweb.Config{
			ACSURL: env["acs"], Username: env["user"], Password: env["pass"],
			ZimlinkUsername: env["zluser"], ZimlinkPassword: env["zlpass"],
			GGCLinkUsername: env["gguser"], GGCLinkPassword: env["ggpass"],
			F609Username: env["f6user"], F609Password: env["f6pass"],
			InformInterval: 300, AllowedNets: nets,
		}, nil
	}
}

type resolverFn = func(ctx context.Context, onuID string) (string, error)

func newOntWebHarness(t *testing.T, env ontSettings, modem *httptest.Server) *apiHarness {
	t.Helper()
	return newOntWebHarnessResolver(t, env, modem, func(context.Context, string) (string, error) { return "172.16.15.248", nil })
}

func newOntWebHarnessResolver(t *testing.T, env ontSettings, modem *httptest.Server, resolve resolverFn) *apiHarness {
	t.Helper()
	api := NewOntWebAPI(nil, "", nil, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	api.load = settingsToConfig(t, env)
	api.resolveHost = resolve
	if modem != nil {
		api.newDriver = func(context.Context, string) (ontweb.Driver, string, error) {
			return ontweb.NewClient(modem.URL, 5*time.Second), ontweb.KindFD511GW, nil
		}
	}
	h := newAPIHarness(t)
	h.handler = NewHandler(Options{
		Logger:         slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
		Data:           h.mgr,
		Verifier:       h.tokens,
		AllowedOrigins: []string{apiOrigin},
		OntWeb:         api,
	})
	return h
}

func (h *apiHarness) postJSON(ticket, body string) *httptest.ResponseRecorder {
	h.t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ont-web/tr069", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if ticket != "" {
		req.Header.Set("Authorization", "Bearer "+ticket)
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

var ontEnv = ontSettings{"acs": "http://172.16.0.1:7547", "user": "admin", "pass": "pw"}

func manageTicket(h *apiHarness) string {
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)
	return tk
}

func TestOntWebRequiresCpeManage(t *testing.T) {
	var logins atomic.Int32
	h := newOntWebHarness(t, ontEnv, fakeModem(t, &logins))
	if rec := h.postJSON("", `{"host":"172.16.15.248"}`); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonim: %d", rec.Code)
	}
	if rec := h.postJSON(h.ticket(), `{"host":"172.16.15.248"}`); rec.Code != http.StatusForbidden {
		t.Errorf("hanya-lihat: %d", rec.Code)
	}
	if logins.Load() != 0 {
		t.Fatal("modem tidak boleh disentuh tanpa izin")
	}
}

func TestOntWebInstallsAndIsIdempotent(t *testing.T) {
	var logins atomic.Int32
	h := newOntWebHarness(t, ontEnv, fakeModem(t, &logins))
	rec := h.postJSON(manageTicket(h), `{"host":"172.16.15.248"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var out struct {
		OK      bool     `json:"ok"`
		Changed bool     `json:"changed"`
		Fields  []string `json:"fields"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.OK || !out.Changed || len(out.Fields) == 0 {
		t.Fatalf("out = %+v", out)
	}
	if strings.Contains(rec.Body.String(), "pw") {
		t.Fatal("jawaban tidak boleh memuat kata sandi")
	}
	rec = h.postJSON(manageTicket(h), `{"host":"172.16.15.248"}`)
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != http.StatusOK || out.Changed {
		t.Fatalf("kedua: %d %s", rec.Code, rec.Body)
	}
}

func TestOntWebRejectsBadInput(t *testing.T) {
	var logins atomic.Int32
	h := newOntWebHarness(t, ontEnv, fakeModem(t, &logins))
	for name, body := range map[string]string{
		"loopback":    `{"host":"127.0.0.1"}`,
		"metadata":    `{"host":"169.254.169.254"}`,
		"publik":      `{"host":"8.8.8.8"}`,
		"hostname":    `{"host":"modem.local"}`,
		"kosong":      `{}`,
		"bukan json":  `host=1`,
		"field asing": `{"host":"172.16.15.248","port":8080}`,
	} {
		if rec := h.postJSON(manageTicket(h), body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	if logins.Load() != 0 {
		t.Fatal("masukan buruk tidak boleh sampai ke modem")
	}
}

func TestOntWebNeedsCredentialsFromSomewhere(t *testing.T) {
	var logins atomic.Int32
	h := newOntWebHarness(t, ontSettings{"acs": "http://172.16.0.1:7547"}, fakeModem(t, &logins))
	rec := h.postJSON(manageTicket(h), `{"host":"172.16.15.248"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "credentials_required") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	rec = h.postJSON(manageTicket(h), `{"host":"172.16.15.248","username":"admin","password":"x"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("kredensial dari permintaan: %d %s", rec.Code, rec.Body)
	}
}

func TestOntWebWrongPasswordMapsTo422(t *testing.T) {
	var logins atomic.Int32
	h := newOntWebHarness(t, ontEnv, fakeModem(t, &logins))
	rec := h.postJSON(manageTicket(h), `{"host":"172.16.15.248","username":"bukan","password":"x"}`)
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "ont_login_rejected") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if logins.Load() != 1 {
		t.Fatalf("login = %d, tidak boleh diulang", logins.Load())
	}
}

func TestOntWebNotConfiguredIs503(t *testing.T) {
	h := newOntWebHarness(t, nil, nil)
	rec := h.postJSON(manageTicket(h), `{"host":"172.16.15.248"}`)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "acs_not_configured") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

// --- loadFromDB: baris ont_web_settings nyata, kata sandi terenkripsi ---

type fakeSettingsRows struct {
	fakeOltRows
	vals []any
	n    int
}

func (r *fakeSettingsRows) Next() bool { r.n++; return r.vals != nil && r.n == 1 }
func (r *fakeSettingsRows) Scan(dest ...any) error {
	for i, d := range dest {
		switch p := d.(type) {
		case *string:
			*p = r.vals[i].(string)
		case *int:
			*p = r.vals[i].(int)
		}
	}
	return nil
}

type fakeSettingsDB struct {
	vals []any
	err  error
}

func (q *fakeSettingsDB) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	if q.err != nil {
		return nil, q.err
	}
	if !strings.Contains(sql, "FROM ont_web_settings") {
		return nil, errors.New("query tak terduga")
	}
	return &fakeSettingsRows{vals: q.vals}, nil
}

func TestOntWebLoadFromDBDecryptsPasswords(t *testing.T) {
	db := &fakeSettingsDB{vals: []any{
		"http://172.16.0.1:7547", "acs", mustEncryptForTest(t, "acs-rahasia", testDeviceSecret),
		120, "admin", mustEncryptForTest(t, "web-rahasia", testDeviceSecret),
		"superadmin", mustEncryptForTest(t, "zl-rahasia", testDeviceSecret),
		"admin", mustEncryptForTest(t, "gg-rahasia", testDeviceSecret),
		"admin", mustEncryptForTest(t, "f6-rahasia", testDeviceSecret),
	}}
	cfg, err := NewOntWebAPI(db, testDeviceSecret, nil, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))).load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ACSURL != "http://172.16.0.1:7547" || cfg.ACSPassword != "acs-rahasia" || cfg.Password != "web-rahasia" ||
		cfg.InformInterval != 120 || cfg.Username != "admin" || cfg.ACSUsername != "acs" ||
		cfg.ZimlinkUsername != "superadmin" || cfg.ZimlinkPassword != "zl-rahasia" ||
		cfg.GGCLinkUsername != "admin" || cfg.GGCLinkPassword != "gg-rahasia" ||
		cfg.F609Username != "admin" || cfg.F609Password != "f6-rahasia" {
		t.Fatalf("cfg = %+v", cfg)
	}
}

func TestOntWebLoadFromDBFailures(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	if _, err := NewOntWebAPI(&fakeSettingsDB{}, testDeviceSecret, nil, log).load(context.Background()); !errors.Is(err, errOntWebNotConfigured) {
		t.Errorf("tanpa baris: %v", err)
	}
	bad := &fakeSettingsDB{vals: []any{"ftp://x", "", "", 300, "", "", "", "", "", "", "", ""}}
	if _, err := NewOntWebAPI(bad, testDeviceSecret, nil, log).load(context.Background()); err == nil {
		t.Error("acs_url tidak sah harus galat")
	}
	wrongKey := &fakeSettingsDB{vals: []any{"http://x:7547", "", "", 300, "admin", mustEncryptForTest(t, "pw", testDeviceSecret), "", "", "", "", "", ""}}
	if _, err := NewOntWebAPI(wrongKey, strings.Repeat("z", 32), nil, log).load(context.Background()); err == nil || strings.Contains(err.Error(), "pw") {
		t.Errorf("kunci salah harus galat tanpa membocorkan: %v", err)
	}
}

const someOnu = "7362598d-f593-45b3-bd4a-0f4bb7480865"

func TestOntWebFindsIPFromOnuAutomatically(t *testing.T) {
	var logins atomic.Int32
	var asked string
	h := newOntWebHarnessResolver(t, ontEnv, fakeModem(t, &logins), func(_ context.Context, id string) (string, error) {
		asked = id
		return "172.16.15.248", nil
	})
	rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`"}`)
	if rec.Code != http.StatusOK || asked != someOnu || !strings.Contains(rec.Body.String(), `"host":"172.16.15.248"`) {
		t.Fatalf("%d %s asked=%q", rec.Code, rec.Body, asked)
	}
}

func TestOntWebManualHostSkipsLookup(t *testing.T) {
	var logins atomic.Int32
	called := false
	h := newOntWebHarnessResolver(t, ontEnv, fakeModem(t, &logins), func(context.Context, string) (string, error) {
		called = true
		return "", errors.New("tidak boleh dipanggil")
	})
	rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`","host":"172.16.15.248"}`)
	if rec.Code != http.StatusOK || called {
		t.Fatalf("%d %s called=%v", rec.Code, rec.Body, called)
	}
}

func TestOntWebLookupFailuresGiveClearAnswers(t *testing.T) {
	cases := map[string]struct {
		err  error
		code int
		want string
	}{
		"belum dipetakan": {errOnuUnmapped, http.StatusConflict, "onu_unmapped"},
		"tidak terhubung": {fmt.Errorf("%w (budi)", errNotConnected), http.StatusConflict, "customer_offline"},
		"router galat":    {errors.New("hubungi router: timeout"), http.StatusBadGateway, "ip_lookup_failed"},
	}
	for name, tc := range cases {
		var logins atomic.Int32
		h := newOntWebHarnessResolver(t, ontEnv, fakeModem(t, &logins), func(context.Context, string) (string, error) { return "", tc.err })
		rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`"}`)
		if rec.Code != tc.code || !strings.Contains(rec.Body.String(), tc.want) {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
		if logins.Load() != 0 {
			t.Errorf("%s: modem tidak boleh disentuh bila IP tak diketahui", name)
		}
	}
}

func TestOntWebNeedsOnuIDOrHost(t *testing.T) {
	var logins atomic.Int32
	h := newOntWebHarness(t, ontEnv, fakeModem(t, &logins))
	for _, body := range []string{`{}`, `{"onuId":"bukan-uuid"}`, `{"onuId":"1; DROP TABLE x"}`} {
		if rec := h.postJSON(manageTicket(h), body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
}

func TestOntWebResolvedAddressStillChecked(t *testing.T) {
	var logins atomic.Int32
	for _, bad := range []string{"8.8.8.8", "127.0.0.1", "169.254.169.254", "bukan-ip"} {
		h := newOntWebHarnessResolver(t, ontEnv, fakeModem(t, &logins), func(context.Context, string) (string, error) { return bad, nil })
		if rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`"}`); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", bad, rec.Code, rec.Body)
		}
	}
	if logins.Load() != 0 {
		t.Fatal("alamat di luar jaringan yang diizinkan tidak boleh dibuka")
	}
}

// --- ZIMLINK: akun admin tersendiri, dikenali tanpa kredensial ---

type recordingDriver struct {
	user, pass string
	calls      int
}

func (d *recordingDriver) ApplyTR069(_ context.Context, username, password string, _ ontweb.Settings) (ontweb.Result, error) {
	d.calls++
	d.user, d.pass = username, password
	return ontweb.Result{Changed: true, ACSStatus: "Unreported (No remote management WAN connection)"}, nil
}

func newOntWebHarnessDriver(t *testing.T, env ontSettings, kind string, d ontweb.Driver, detectErr error) *apiHarness {
	t.Helper()
	h := newOntWebHarness(t, env, nil)
	// Ganti pengait driver pada API yang sudah terpasang di handler.
	api := NewOntWebAPI(nil, "", nil, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	api.load = settingsToConfig(t, env)
	api.resolveHost = func(context.Context, string) (string, error) { return "172.16.15.246", nil }
	api.newDriver = func(context.Context, string) (ontweb.Driver, string, error) { return d, kind, detectErr }
	h.handler = NewHandler(Options{
		Logger:         slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
		Data:           h.mgr,
		Verifier:       h.tokens,
		AllowedOrigins: []string{apiOrigin},
		OntWeb:         api,
	})
	return h
}

func TestOntWebZimlinkUsesItsOwnCredentials(t *testing.T) {
	env := ontSettings{"acs": "http://172.16.0.1:7547", "user": "admin", "pass": "pw-fd", "zluser": "superadmin", "zlpass": "superoem"}
	d := &recordingDriver{}
	h := newOntWebHarnessDriver(t, env, ontweb.KindZimlink, d, nil)
	rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`"}`)
	if rec.Code != http.StatusOK || d.user != "superadmin" || d.pass != "superoem" {
		t.Fatalf("%d %s user=%q", rec.Code, rec.Body, d.user)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"model":"ZIMLINK ZL-2113X"`) || !strings.Contains(body, "No remote management WAN connection") {
		t.Fatalf("jawaban harus menyebut model dan status ACS modem: %s", body)
	}
	if strings.Contains(body, "superoem") || strings.Contains(body, "pw-fd") {
		t.Fatal("jawaban tidak boleh memuat kata sandi")
	}

	d2 := &recordingDriver{}
	h2 := newOntWebHarnessDriver(t, env, ontweb.KindFD511GW, d2, nil)
	if rec := h2.postJSON(manageTicket(h2), `{"onuId":"`+someOnu+`"}`); rec.Code != http.StatusOK || d2.user != "admin" || d2.pass != "pw-fd" {
		t.Fatalf("FD511GW memakai akunnya sendiri: %d %s user=%q", rec.Code, rec.Body, d2.user)
	}
}

func TestOntWebGGCLinkUsesItsOwnCredentialsAndNeverTouchesTheWAN(t *testing.T) {
	env := ontSettings{"acs": "http://172.16.0.1:7547", "user": "admin", "pass": "pw-fd", "zluser": "superadmin", "zlpass": "superoem", "gguser": "admin", "ggpass": "gg-rahasia"}
	d := &recordingDriver{}
	h := newOntWebHarnessDriver(t, env, ontweb.KindGGCLink, d, nil)
	rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`"}`)
	if rec.Code != http.StatusOK || d.user != "admin" || d.pass != "gg-rahasia" {
		t.Fatalf("%d %s user=%q pass=%q", rec.Code, rec.Body, d.user, d.pass)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"model":"GGCLink GM220-S XPON"`) {
		t.Fatalf("jawaban harus menyebut model: %s", body)
	}
	for _, secret := range []string{"gg-rahasia", "pw-fd", "superoem"} {
		if strings.Contains(body, secret) {
			t.Fatalf("jawaban memuat kata sandi %q", secret)
		}
	}
}

func TestOntWebGGCLinkWithoutCredentialsNamesTheModelAndSendsNothing(t *testing.T) {
	d := &recordingDriver{}
	h := newOntWebHarnessDriver(t, ontSettings{"acs": "http://172.16.0.1:7547", "user": "admin", "pass": "x", "zluser": "a", "zlpass": "b"}, ontweb.KindGGCLink, d, nil)
	rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "GGCLink GM220-S XPON") || d.calls != 0 {
		t.Fatalf("%d %s calls=%d", rec.Code, rec.Body, d.calls)
	}
}

func TestOntWebF609UsesItsOwnCredentials(t *testing.T) {
	env := ontSettings{"acs": "http://172.16.0.1:7547", "user": "admin", "pass": "pw-fd", "gguser": "g", "ggpass": "gg", "f6user": "admin", "f6pass": "f6-rahasia"}
	d := &recordingDriver{}
	h := newOntWebHarnessDriver(t, env, ontweb.KindF609, d, nil)
	rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`"}`)
	if rec.Code != http.StatusOK || d.user != "admin" || d.pass != "f6-rahasia" {
		t.Fatalf("%d %s user=%q pass=%q", rec.Code, rec.Body, d.user, d.pass)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"model":"ZTE F609 (MTKc)"`) {
		t.Fatalf("jawaban harus menyebut model: %s", body)
	}
	for _, secret := range []string{"f6-rahasia", "gg", "pw-fd"} {
		if secret == "gg" {
			continue
		}
		if strings.Contains(body, secret) {
			t.Fatalf("jawaban memuat kata sandi %q", secret)
		}
	}
}

func TestOntWebRequestCredentialsOverrideForAnyKind(t *testing.T) {
	env := ontSettings{"acs": "http://172.16.0.1:7547"}
	d := &recordingDriver{}
	h := newOntWebHarnessDriver(t, env, ontweb.KindZimlink, d, nil)
	rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`","username":"u1","password":"p1"}`)
	if rec.Code != http.StatusOK || d.user != "u1" || d.pass != "p1" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestOntWebMissingCredentialsNamesTheModelAndSendsNothing(t *testing.T) {
	d := &recordingDriver{}
	h := newOntWebHarnessDriver(t, ontSettings{"acs": "http://172.16.0.1:7547", "user": "admin", "pass": "x"}, ontweb.KindZimlink, d, nil)
	rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "ZIMLINK ZL-2113X") || d.calls != 0 {
		t.Fatalf("%d %s calls=%d", rec.Code, rec.Body, d.calls)
	}
}

func TestOntWebUnknownDeviceNeverGetsCredentials(t *testing.T) {
	d := &recordingDriver{}
	h := newOntWebHarnessDriver(t, ontEnv, "", d, ontweb.ErrWrongDevice)
	rec := h.postJSON(manageTicket(h), `{"onuId":"`+someOnu+`"}`)
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "ont_wrong_device") || d.calls != 0 {
		t.Fatalf("%d %s calls=%d", rec.Code, rec.Body, d.calls)
	}
}

func TestMacLookupAllowedModels(t *testing.T) {
	for model, want := range map[string]bool{
		"CDTC 15CR": true, "cdtc fd511gw": true, "HWTC H113": true, " hwtc h113 ": true,
		"HWTC HG8145": false, "HSGQ 130W": false, "ZICG GM22": false, "": false,
	} {
		if got := macLookupAllowed(model); got != want {
			t.Errorf("%q: %v, harapan %v", model, got, want)
		}
	}
}
