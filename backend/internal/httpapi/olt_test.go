package httpapi

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/olt"
)

// testDeviceSecret: TEPAT 32 byte supaya DecryptCredential (normalizeKey)
// memakainya apa adanya, tanpa SHA-256 (lebih sederhana untuk tes). Bukan
// rahasia sungguhan, hanya dipakai di proses tes.
var testDeviceSecret = strings.Repeat("k", 32)

// mustEncryptForTest membuat password_enc yang bisa dibuka DecryptCredential,
// format sama (AES-256-GCM, base64 "iv:tag:ciphertext").
func mustEncryptForTest(t *testing.T, plain, secret string) string {
	t.Helper()
	key := []byte(secret)
	if len(key) != 32 {
		t.Fatalf("secret tes harus 32 byte, got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		t.Fatal(err)
	}
	sealed := gcm.Seal(nil, iv, []byte(plain), nil) // ciphertext diikuti tag
	tagLen := gcm.Overhead()
	enc, tag := sealed[:len(sealed)-tagLen], sealed[len(sealed)-tagLen:]
	return base64.StdEncoding.EncodeToString(iv) + ":" +
		base64.StdEncoding.EncodeToString(tag) + ":" +
		base64.StdEncoding.EncodeToString(enc)
}

// --- fakeOltRows/fakeOltQuerier: satu baris "olts" (atau kosong = 404) ---

type fakeOltRows struct {
	row []string // nil = tidak ada baris
	i   int
}

func (r *fakeOltRows) Close()                                       {}
func (r *fakeOltRows) Err() error                                   { return nil }
func (r *fakeOltRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeOltRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeOltRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeOltRows) RawValues() [][]byte                          { return nil }
func (r *fakeOltRows) Conn() *pgx.Conn                              { return nil }
func (r *fakeOltRows) TypeMap() *pgtype.Map                         { return nil }
func (r *fakeOltRows) Next() bool {
	if r.row == nil || r.i > 0 {
		return false
	}
	r.i++
	return true
}
func (r *fakeOltRows) Scan(dest ...any) error {
	if len(dest) != len(r.row) {
		return errors.New("jumlah kolom tidak cocok")
	}
	for i, d := range dest {
		*(d.(*string)) = r.row[i]
	}
	return nil
}

type fakeOltQuerier struct {
	row      []string // baris untuk id "olt-1"; nil = tidak ditemukan
	queryErr error
}

func (q *fakeOltQuerier) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	if q.queryErr != nil {
		return nil, q.queryErr
	}
	if !strings.Contains(sql, "FROM olts") {
		return nil, errors.New("query tak terduga: " + sql)
	}
	id, _ := args[0].(string)
	if id != "olt-1" {
		return &fakeOltRows{row: nil}, nil
	}
	return &fakeOltRows{row: q.row}, nil
}

// --- driver "fake-bind": didaftarkan sekali, hasilnya diatur per tes lewat
// fakeBindFn (tes di paket ini tidak paralel, jadi variabel bersama aman). ---

var (
	fakeBindOnce sync.Once
	fakeBindMu   sync.Mutex
	fakeBindFn   func(pon, onuN int) error
)

func setFakeBindResult(t *testing.T, fn func(pon, onuN int) error) {
	t.Helper()
	fakeBindOnce.Do(func() {
		olt.Register("fake-bind", func(cfg olt.Config) (olt.Driver, error) {
			return fakeBindDriver{cfg: cfg}, nil
		})
	})
	fakeBindMu.Lock()
	fakeBindFn = fn
	fakeBindMu.Unlock()
}

type fakeBindDriver struct{ cfg olt.Config }

func (d fakeBindDriver) Name() string                                              { return "fake-bind" }
func (d fakeBindDriver) Close() error                                              { return nil }
func (d fakeBindDriver) TestConnection(context.Context) error                      { return nil }
func (d fakeBindDriver) FetchPonPorts(context.Context) ([]olt.PonPortStats, error) { return nil, nil }
func (d fakeBindDriver) FetchOnus(context.Context) ([]olt.OnuStats, error)         { return nil, nil }
func (d fakeBindDriver) BindTR069(_ context.Context, _ int, onus []olt.OnuRef) ([]olt.BindResult, error) {
	fakeBindMu.Lock()
	fn := fakeBindFn
	fakeBindMu.Unlock()
	out := make([]olt.BindResult, len(onus))
	for i, o := range onus {
		out[i] = olt.BindResult{Ref: o}
		if fn != nil {
			out[i].Err = fn(o.Pon, o.Onu)
		}
	}
	return out, nil
}

type fakeBindStoreOlt struct {
	mu    sync.Mutex
	bound []olt.OnuRef
}

func (s *fakeBindStoreOlt) EnsureSince(context.Context, string) error { return nil }
func (s *fakeBindStoreOlt) Candidates(context.Context, string, olt.AutoBindMode, int) ([]olt.OnuRef, error) {
	return nil, nil
}
func (s *fakeBindStoreOlt) MarkBound(_ context.Context, _ string, ref olt.OnuRef) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bound = append(s.bound, ref)
	return nil
}
func (s *fakeBindStoreOlt) boundList() []olt.OnuRef {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]olt.OnuRef(nil), s.bound...)
}

func newOltBindHarness(t *testing.T, q collector.Querier, store olt.BindStore, profileID int) *apiHarness {
	t.Helper()
	h := newAPIHarness(t)
	h.handler = NewHandler(Options{
		Logger:         slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
		Data:           h.mgr,
		Verifier:       h.tokens,
		AllowedOrigins: []string{apiOrigin},
		OltBind:        NewOltBindAPI(q, testDeviceSecret, profileID, store, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))),
	})
	return h
}

const bindPath = "/api/v1/olts/olt-1/onus/1/22/tr069-bind"

func validOltQuerier(t *testing.T) *fakeOltQuerier {
	return &fakeOltQuerier{row: []string{"127.0.0.1:0", "fake-bind", "NOCApp", mustEncryptForTest(t, "rahasia-olt", testDeviceSecret)}}
}

func TestOltBindRequiresCpeManagePerm(t *testing.T) {
	setFakeBindResult(t, nil)
	store := &fakeBindStoreOlt{}
	h := newOltBindHarness(t, validOltQuerier(t), store, 1)
	issue := func(perms ...string) string {
		tk, err := h.tokens.IssueWithPerms("u", perms, time.Now(), time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		return tk
	}

	if rec := h.do(http.MethodPost, bindPath, "", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonim: status = %d, want 401", rec.Code)
	}
	for name, tk := range map[string]string{"hanya-lihat": h.ticket(), "izin lain": issue("alert:handle")} {
		if rec := h.do(http.MethodPost, bindPath, tk, nil); rec.Code != http.StatusForbidden {
			t.Errorf("%s: status = %d, want 403", name, rec.Code)
		}
	}
	if len(store.boundList()) != 0 {
		t.Fatalf("tidak boleh terikat tanpa izin: %v", store.boundList())
	}
}

func TestOltBindSuccess(t *testing.T) {
	setFakeBindResult(t, nil)
	store := &fakeBindStoreOlt{}
	h := newOltBindHarness(t, validOltQuerier(t), store, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	rec := h.do(http.MethodPost, bindPath, tk, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Errorf("body = %s", rec.Body)
	}
	bound := store.boundList()
	if len(bound) != 1 || bound[0] != (olt.OnuRef{Pon: 1, Onu: 22}) {
		t.Errorf("bound = %v", bound)
	}
}

func TestOltBindOltNotFound(t *testing.T) {
	setFakeBindResult(t, nil)
	h := newOltBindHarness(t, &fakeOltQuerier{row: nil}, &fakeBindStoreOlt{}, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	rec := h.do(http.MethodPost, bindPath, tk, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
}

func TestOltBindProfileMissing(t *testing.T) {
	// Driver khusus kasus ini (bukan fakeBindDriver): BindTR069-nya langsung
	// menjawab ErrTR069ProfileMissing, seperti OLT asli yang profilnya belum dibuat.
	// Didaftarkan dengan nama unik supaya aman dipanggil sekali per proses tes.
	olt.Register("fake-bind-missing", func(cfg olt.Config) (olt.Driver, error) {
		return missingProfileDriver{}, nil
	})
	q := &fakeOltQuerier{row: []string{"127.0.0.1:0", "fake-bind-missing", "NOCApp", mustEncryptForTest(t, "rahasia-olt", testDeviceSecret)}}
	h := newOltBindHarness(t, q, &fakeBindStoreOlt{}, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	rec := h.do(http.MethodPost, bindPath, tk, nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
}

type missingProfileDriver struct{}

func (missingProfileDriver) Name() string                         { return "fake-bind-missing" }
func (missingProfileDriver) Close() error                         { return nil }
func (missingProfileDriver) TestConnection(context.Context) error { return nil }
func (missingProfileDriver) FetchPonPorts(context.Context) ([]olt.PonPortStats, error) {
	return nil, nil
}
func (missingProfileDriver) FetchOnus(context.Context) ([]olt.OnuStats, error) { return nil, nil }
func (missingProfileDriver) BindTR069(context.Context, int, []olt.OnuRef) ([]olt.BindResult, error) {
	return nil, olt.ErrTR069ProfileMissing
}

func TestOltBindRejectedByOlt(t *testing.T) {
	setFakeBindResult(t, func(int, int) error { return olt.ErrBindRejected })
	store := &fakeBindStoreOlt{}
	h := newOltBindHarness(t, validOltQuerier(t), store, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	rec := h.do(http.MethodPost, bindPath, tk, nil)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if len(store.boundList()) != 0 {
		t.Errorf("ditolak tidak boleh tercatat: %v", store.boundList())
	}
}

func TestOltBindInvalidPath(t *testing.T) {
	setFakeBindResult(t, nil)
	h := newOltBindHarness(t, validOltQuerier(t), &fakeBindStoreOlt{}, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	for _, path := range []string{
		"/api/v1/olts/olt-1/onus/x/22/tr069-bind",
		"/api/v1/olts/olt-1/onus/1/x/tr069-bind",
		"/api/v1/olts/olt-1/onus/0/22/tr069-bind",
	} {
		if rec := h.do(http.MethodPost, path, tk, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", path, rec.Code)
		}
	}
}

func TestOltBindWrongDeviceSecretGivesInternalNotLeak(t *testing.T) {
	setFakeBindResult(t, nil)
	// password_enc dibuat dengan kunci LAIN: DecryptCredential harus gagal.
	q := &fakeOltQuerier{row: []string{"127.0.0.1:0", "fake-bind", "NOCApp", mustEncryptForTest(t, "rahasia-olt", strings.Repeat("x", 32))}}
	h := newOltBindHarness(t, q, &fakeBindStoreOlt{}, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	rec := h.do(http.MethodPost, bindPath, tk, nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "rahasia-olt") {
		t.Errorf("tidak boleh bocor: %s", rec.Body)
	}
}

func TestOltBindOnlyPost(t *testing.T) {
	setFakeBindResult(t, nil)
	h := newOltBindHarness(t, validOltQuerier(t), &fakeBindStoreOlt{}, 1)
	tk, _ := h.tokens.IssueWithPerms("u", []string{"cpe:manage"}, time.Now(), time.Minute)

	rec := h.do(http.MethodGet, bindPath, tk, nil)
	if rec.Code != http.StatusMethodNotAllowed && rec.Code != http.StatusNotFound {
		t.Errorf("GET: status = %d, want 404/405", rec.Code)
	}
}
