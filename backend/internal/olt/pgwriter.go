package olt

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Execer adalah bagian pgxpool.Pool yang menulis; di tes diganti tiruan.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Keadaan terbaru saja (di-upsert), bukan riwayat: tabel olt_pon_ports dan
// olt_onus menyimpan satu baris per port dan per ONU.
const upsertPonSQL = `INSERT INTO olt_pon_ports (olt_id, pon_index, rx_power, tx_power, attenuation, onu_online_count, captured_at)
VALUES ($1::uuid, $2, $3::numeric, $4::numeric, $5::numeric, $6, now())
ON CONFLICT (olt_id, pon_index) DO UPDATE SET
  rx_power = EXCLUDED.rx_power, tx_power = EXCLUDED.tx_power, attenuation = EXCLUDED.attenuation,
  onu_online_count = EXCLUDED.onu_online_count, captured_at = now()`

// description dan model adalah data OLT (nama dan jenis ONU) dan ikut diperbarui;
// yang tidak pernah ditimpa polling hanya customer_id (pemetaan oleh petugas).
// Nama kosong tidak menghapus nama yang sudah ada.
const upsertOnuSQL = `INSERT INTO olt_onus (olt_id, pon_index, onu_index, serial_number, description, model, rx_power, tx_power, attenuation, status, captured_at)
VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9::numeric, $10, now())
ON CONFLICT (olt_id, pon_index, onu_index) DO UPDATE SET
  serial_number = EXCLUDED.serial_number,
  description = COALESCE(EXCLUDED.description, olt_onus.description),
  model = COALESCE(EXCLUDED.model, olt_onus.model),
  rx_power = EXCLUDED.rx_power, tx_power = EXCLUDED.tx_power,
  attenuation = EXCLUDED.attenuation, status = EXCLUDED.status, captured_at = now()`

// Daya optik ONU yang sudah dipetakan ke pelanggan disalin ke customers.optical_power,
// yang dibaca rule engine (aturan sinyal optik) dan dasbor. ONU offline tidak punya
// pembacaan, jadi nilai terakhir pelanggan dipertahankan (tidak ditimpa NULL).
const customerOpticalSQL = `UPDATE customers c SET optical_power = $4::numeric, last_updated_at = now()
FROM olt_onus o
WHERE o.olt_id = $1::uuid AND o.pon_index = $2 AND o.onu_index = $3
  AND o.customer_id = c.id AND $4::numeric IS NOT NULL`

const touchOltSQL = `UPDATE olts SET last_seen_at = $2 WHERE id = $1::uuid`

// PGWriter menulis hasil polling OLT ke PostgreSQL. Memenuhi PonPortWriter dan OnuWriter.
type PGWriter struct{ db Execer }

// NewPGWriter membuat penulis. db tidak boleh nil.
func NewPGWriter(db Execer) *PGWriter { return &PGWriter{db: db} }

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (w *PGWriter) UpsertPonPort(ctx context.Context, oltID string, s PonPortStats) error {
	_, err := w.db.Exec(ctx, upsertPonSQL, oltID, s.Index, s.RxPowerDbm, s.TxPowerDbm, s.AttenuationDb, s.OnuOnlineCount)
	if err != nil {
		return fmt.Errorf("simpan PON port: %w", err)
	}
	return nil
}

func (w *PGWriter) UpsertOnu(ctx context.Context, oltID string, s OnuStats) error {
	status := s.State
	if status == "" {
		status = "offline"
		if s.IsOnline {
			status = "online"
		}
	}
	// Penanda ONU di UI: nomor seri bila ada, kalau tidak MAC.
	var serial any
	switch {
	case s.SerialNumber != "":
		serial = s.SerialNumber
	case s.MacAddress != "":
		serial = s.MacAddress
	}
	if _, err := w.db.Exec(ctx, upsertOnuSQL, oltID, s.PonIndex, s.OnuIndex, serial,
		nullable(s.Name), nullable(s.Model), s.RxPowerDbm, s.TxPowerDbm, s.AttenuationDb, status); err != nil {
		return fmt.Errorf("simpan ONU: %w", err)
	}
	if s.RxPowerDbm != nil {
		if _, err := w.db.Exec(ctx, customerOpticalSQL, oltID, s.PonIndex, s.OnuIndex, s.RxPowerDbm); err != nil {
			return fmt.Errorf("salin daya optik ke pelanggan: %w", err)
		}
	}
	return nil
}

func (w *PGWriter) TouchOlt(ctx context.Context, oltID string, at time.Time) error {
	_, err := w.db.Exec(ctx, touchOltSQL, oltID, at.UTC())
	if err != nil {
		return fmt.Errorf("perbarui last_seen_at OLT: %w", err)
	}
	return nil
}
