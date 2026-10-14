package billing

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestExtractErrorMetaAndCategory(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		path     string
		code     int
		category string
	}{
		{"auth login", ErrLoginFailed, "", 0, "Auth"},
		{"auth 401", fmt.Errorf("x: %w", &StatusError{Method: "GET", Path: "/invoices", Code: 401}), "/invoices", 401, "Auth"},
		{"network 503", &StatusError{Method: "GET", Path: "/invoices", Code: 503}, "/invoices", 503, "Network"},
		{"network", fmt.Errorf("dial: %w", ErrNetwork), "", 0, "Network"},
		{"parsing 404", &StatusError{Method: "GET", Path: "/gone", Code: 404}, "/gone", 404, "Parsing"},
		{"parsing unknown status", &UnknownStatusError{Value: "??", Page: 1, Row: 2}, "", 0, "Parsing"},
		{"parsing empty", ErrEmptyInvoiceSource, "", 0, "Parsing"},
		{"drop", &InvoiceDropError{Previous: 100, Current: 1}, "", 0, "DropAnomaly"},
		{"internal", errors.New("boom"), "", 0, "Internal"},
		{"panic", &PanicError{Detail: "x"}, "", 0, "Internal"},
	}
	for _, c := range cases {
		path, code, cat := extractErrorMeta(c.err)
		if path != c.path || code != c.code || cat != c.category {
			t.Errorf("%s: got (%q, %d, %q), want (%q, %d, %q)", c.name, path, code, cat, c.path, c.code, c.category)
		}
	}
}

func TestFailureCategoryMapping(t *testing.T) {
	want := map[FailureKind]string{
		FailureCredentials: "Auth", FailureNetwork: "Network", FailureTimeout: "Network", FailureServerError: "Network",
		FailureSourceChanged: "Parsing", FailureUnknownStatus: "Parsing", FailureEmptySource: "Parsing",
		FailureAnomalousDrop: "DropAnomaly", FailureCanceled: "Internal", FailureInternal: "Internal",
	}
	for kind, cat := range want {
		if got := (Failure{Kind: kind}).Category(); got != cat {
			t.Errorf("%s: Category = %q, want %q", kind, got, cat)
		}
	}
}

func TestFailedScrapeNeverTouchesCustomers(t *testing.T) {
	errs := []error{
		ErrLoginFailed,
		&StatusError{Method: "GET", Path: "/invoices", Code: 500},
		&UnknownStatusError{Value: "aneh", Page: 1, Row: 1},
		ErrEmptyInvoiceSource,
	}
	for _, e := range errs {
		r := newSyncerRig(t, func(r *syncerRig, o *SyncerOptions) { o.MaxReadAttempts = 1 })
		before := append([]Customer(nil), r.store.customers...)
		r.source.err = e
		out, err := r.run(context.Background())
		if err == nil || out.Status != RunFailed {
			t.Fatalf("%v: RunOnce = %+v, %v; want gagal", e, out, err)
		}
		if len(r.store.applied) != 0 {
			t.Errorf("%v: ApplySuccess dipanggil pada sinkron gagal", e)
		}
		if len(r.store.failed) != 1 {
			t.Errorf("%v: FailRun = %d kali, want 1", e, len(r.store.failed))
		}
		if !reflect.DeepEqual(before, r.store.customers) {
			t.Errorf("%v: data pelanggan berubah: %+v -> %+v", e, before, r.store.customers)
		}
		if r.log.count("LoadCustomers") != 0 {
			t.Errorf("%v: pelanggan dibaca walau pembacaan tagihan gagal", e)
		}
	}
}

func TestErrorLogsAndRecordsNeverLeakSecrets(t *testing.T) {
	const pw, tok = "hunter2-rahasia", "tok-abc123xyz"
	leaky := []error{
		fmt.Errorf("gagal: password=%s", pw),
		fmt.Errorf("gagal: token=%s", tok),
		fmt.Errorf("%w: Bearer %s", ErrLoginFailed, tok),
		fmt.Errorf("dial https://admin:%s@billing.local/login: %w", pw, ErrNetwork),
	}
	for _, e := range leaky {
		r := newSyncerRig(t, func(r *syncerRig, o *SyncerOptions) { o.MaxReadAttempts = 1 })
		r.source.err = e
		if _, err := r.run(context.Background()); err == nil {
			t.Fatalf("%v: seharusnya gagal", e)
		}
		logs := r.logs.String()
		for _, secret := range []string{pw, tok} {
			if strings.Contains(logs, secret) {
				t.Errorf("%v: log membocorkan %q:\n%s", e, secret, logs)
			}
			for _, f := range r.store.failed {
				if strings.Contains(f.message, secret) {
					t.Errorf("%v: catatan database membocorkan %q: %s", e, secret, f.message)
				}
			}
		}
		for _, want := range []string{"stage=baca_tagihan", "attempt=1", "category=", "error_type="} {
			if !strings.Contains(logs, want) {
				t.Errorf("%v: log tidak memuat %q:\n%s", e, want, logs)
			}
		}
	}

	// failureMessage (jalur ke database) membersihkan galat mentah juga.
	for _, e := range leaky {
		msg := failureMessage(e)
		if strings.Contains(msg, pw) || strings.Contains(msg, tok) {
			t.Errorf("failureMessage(%v) membocorkan rahasia: %s", e, msg)
		}
	}
}

func TestRetryWarnLogsStructuredAttributes(t *testing.T) {
	r := newRetryRig(t, []sourceStep{
		failStep(&StatusError{Method: "GET", Path: "/invoices", Code: 503}),
		okStep(sampleInvoices()),
	}, nil)
	if _, err := r.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	logs := r.logs.String()
	for _, want := range []string{
		"stage=baca_tagihan", "attempt=1", "category=Network", "path=/invoices", "code=503", "error_type=*billing.StatusError",
	} {
		if !strings.Contains(logs, want) {
			t.Errorf("log retry tidak memuat %q:\n%s", want, logs)
		}
	}
}
