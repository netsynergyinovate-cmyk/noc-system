package collector

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"noc-isp/backend/internal/state"
)

// Querier adalah bagian pgxpool.Pool yang dipakai pemuat; di tes diganti tiruan.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Tabel routers tidak punya kolom port dan driver (driver hanya ada di olts),
// jadi hanya kolom yang benar-benar ada yang dibaca.
const routersSQL = `SELECT id::text, name, host, status FROM routers WHERE status = 'aktif'`

const customersSQL = `SELECT id::text, name, pppoe_username, router_id::text, address, odp_name,
	billing_status, optical_power::float8, is_online, latitude::float8, longitude::float8
	FROM customers ORDER BY name`

// LoadRouters membaca router aktif dari database.
func LoadRouters(ctx context.Context, q Querier) ([]state.Router, error) {
	rows, err := q.Query(ctx, routersSQL)
	if err != nil {
		return nil, fmt.Errorf("baca router: %w", err)
	}
	defer rows.Close()

	var out []state.Router
	for rows.Next() {
		var r state.Router
		var status string
		if err := rows.Scan(&r.ID, &r.Name, &r.Host, &status); err != nil {
			return nil, fmt.Errorf("baca baris router: %w", err)
		}
		r.Active = status == "aktif"
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("baca router: %w", err)
	}
	return out, nil
}

// LoadCustomers membaca semua pelanggan. Kolom kosong di database menjadi nilai
// nol dengan penanda Has* bernilai false. Pelanggan tanpa router dilewati
// karena Manager tidak bisa menampungnya.
func LoadCustomers(ctx context.Context, q Querier) ([]state.Customer, error) {
	rows, err := q.Query(ctx, customersSQL)
	if err != nil {
		return nil, fmt.Errorf("baca pelanggan: %w", err)
	}
	defer rows.Close()

	var out []state.Customer
	for rows.Next() {
		var (
			c                      state.Customer
			routerID, address, odp *string
			optical, lat, lon      *float64
		)
		if err := rows.Scan(&c.ID, &c.Name, &c.PPPoEUsername, &routerID, &address, &odp,
			&c.BillingStatus, &optical, &c.IsOnline, &lat, &lon); err != nil {
			return nil, fmt.Errorf("baca baris pelanggan: %w", err)
		}
		if routerID == nil {
			continue
		}
		c.RouterID = *routerID
		if address != nil {
			c.Address = *address
		}
		if odp != nil {
			c.ODPName = *odp
		}
		if optical != nil {
			c.OpticalPowerDbm, c.HasOptical = *optical, true
		}
		if lat != nil && lon != nil {
			c.Latitude, c.Longitude, c.HasLocation = *lat, *lon, true
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("baca pelanggan: %w", err)
	}
	return out, nil
}

// SyncDatabaseState memuat router dan pelanggan ke Manager dan mengembalikan
// jumlah yang berhasil dimasukkan. Satu baris yang ditolak Manager (mis. router
// pelanggan nonaktif) dicatat dan dilewati, tidak menggagalkan sisanya.
func SyncDatabaseState(ctx context.Context, q Querier, mgr *state.Manager, logger *slog.Logger) (int, int, error) {
	routers, err := LoadRouters(ctx, q)
	if err != nil {
		return 0, 0, err
	}
	customers, err := LoadCustomers(ctx, q)
	if err != nil {
		return 0, 0, err
	}

	nR, nC := 0, 0
	for _, r := range routers {
		if err := mgr.UpsertRouter(r); err != nil {
			logger.Warn("router dilewati", "router", r.ID, "error", err)
			continue
		}
		nR++
	}
	for _, c := range customers {
		// Upsert menimpa seluruh pelanggan; rasio queue hanya ada di memori,
		// jadi dibawa dari data yang sudah ada.
		if old, ok := mgr.CustomerByPPPoE(c.PPPoEUsername); ok && old.ID == c.ID {
			c.QueueUpRatio, c.QueueDownRatio, c.HasQueue = old.QueueUpRatio, old.QueueDownRatio, old.HasQueue
			// Status online di memori datang dari polling /ppp/active, webhook, dan
			// syslog, lebih baru daripada kolom is_online di database. Tanpa ini
			// sinkron tiap 15 detik mengembalikan status ke nilai database.
			c.IsOnline = old.IsOnline
		}
		if err := mgr.UpsertCustomer(c); err != nil {
			logger.Warn("pelanggan dilewati", "customer", c.ID, "error", err)
			continue
		}
		nC++
	}
	return nR, nC, nil
}

// StartDatabaseWatcher menyinkronkan ulang tiap interval sampai ctx selesai.
// Error hanya dicatat; pemanggilan berikutnya tetap jalan.
func StartDatabaseWatcher(ctx context.Context, q Querier, mgr *state.Manager, interval time.Duration, logger *slog.Logger) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, _, err := SyncDatabaseState(ctx, q, mgr, logger); err != nil && ctx.Err() == nil {
				logger.Warn("gagal menyinkronkan router dan pelanggan dari database", "error", err)
			}
		}
	}
}
