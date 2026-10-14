package olt

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type execCall struct {
	sql  string
	args []any
}

type recExec struct {
	calls []execCall
	err   error
}

func (r *recExec) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	r.calls = append(r.calls, execCall{sql, args})
	return pgconn.NewCommandTag("INSERT 0 1"), r.err
}

func f(v float64) *float64 { return &v }

func TestUpsertPonPortWritesLatestStateOnly(t *testing.T) {
	db := &recExec{}
	err := NewPGWriter(db).UpsertPonPort(context.Background(), "olt-1",
		PonPortStats{Index: 3, RxPowerDbm: f(-20.5), TxPowerDbm: f(3), AttenuationDb: f(23.5), OnuOnlineCount: 17})
	if err != nil || len(db.calls) != 1 {
		t.Fatalf("err=%v calls=%d", err, len(db.calls))
	}
	c := db.calls[0]
	if !strings.Contains(c.sql, "ON CONFLICT (olt_id, pon_index) DO UPDATE") {
		t.Errorf("harus upsert per port: %s", c.sql)
	}
	if c.args[0] != "olt-1" || c.args[1] != 3 || c.args[5] != 17 {
		t.Errorf("argumen salah: %v", c.args)
	}
}

func TestUpsertOnuKeepsOperatorMappingAndCopiesOpticalToCustomer(t *testing.T) {
	db := &recExec{}
	w := NewPGWriter(db)
	err := w.UpsertOnu(context.Background(), "olt-1", OnuStats{PonIndex: 1, OnuIndex: 5, MacAddress: "AA:BB", RxPowerDbm: f(-22), IsOnline: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.calls) != 2 {
		t.Fatalf("upsert ONU lalu salin ke pelanggan, got %d panggilan", len(db.calls))
	}
	upsert := db.calls[0].sql
	if strings.Contains(upsert[strings.Index(upsert, "DO UPDATE"):], "customer_id") {
		t.Error("pemetaan petugas (customer_id) tidak boleh ditimpa polling")
	}
	if db.calls[0].args[3] != "AA:BB" || db.calls[0].args[9] != "online" {
		t.Errorf("argumen ONU salah: %v", db.calls[0].args)
	}
	if !strings.Contains(db.calls[1].sql, "UPDATE customers") {
		t.Errorf("langkah kedua harus menyalin ke customers: %s", db.calls[1].sql)
	}
}

func TestOfflineOnuWithoutReadingDoesNotOverwriteCustomerOptical(t *testing.T) {
	db := &recExec{}
	err := NewPGWriter(db).UpsertOnu(context.Background(), "olt-1", OnuStats{PonIndex: 1, OnuIndex: 6, IsOnline: false})
	if err != nil || len(db.calls) != 1 {
		t.Fatalf("ONU offline tanpa bacaan: hanya upsert, tanpa menyentuh pelanggan; err=%v calls=%d", err, len(db.calls))
	}
	if db.calls[0].args[3] != nil || db.calls[0].args[4] != nil || db.calls[0].args[9] != "offline" {
		t.Errorf("serial kosong harus NULL dan status offline: %v", db.calls[0].args)
	}
}

func TestWriterErrorsAreWrappedAndTouchUsesUTC(t *testing.T) {
	db := &recExec{err: errors.New("db mati")}
	w := NewPGWriter(db)
	if err := w.UpsertPonPort(context.Background(), "o", PonPortStats{}); err == nil || !strings.Contains(err.Error(), "db mati") {
		t.Errorf("err=%v", err)
	}
	if err := w.UpsertOnu(context.Background(), "o", OnuStats{}); err == nil {
		t.Error("galat tulis ONU harus dikembalikan")
	}
	ok := &recExec{}
	at := time.Date(2026, 10, 14, 12, 0, 0, 0, time.FixedZone("WIB", 7*3600))
	if err := NewPGWriter(ok).TouchOlt(context.Background(), "o", at); err != nil {
		t.Fatal(err)
	}
	if got := ok.calls[0].args[1].(time.Time); got.Location() != time.UTC || got.Hour() != 5 {
		t.Errorf("waktu harus UTC: %v", got)
	}
}
