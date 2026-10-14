// Opsional: ubah traffic_samples jadi hypertable TimescaleDB + kebijakan retensi.
// Aman dan idempotent; di PostgreSQL biasa hanya mengembalikan { enabled: false }.
import { pathToFileURL } from "node:url";

const DEFAULT_RETENTION_DAYS = 30;

export function normalizeRetentionDays(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(1, n) : DEFAULT_RETENTION_DAYS;
}

/**
 * @param {{ query(sql: string): Promise<{ rows: any[] }> }} poolOrClient
 * @param {{ enabled?: boolean, retentionDays?: number|string }} [options]
 */
export async function applyTimescaleSetup(poolOrClient, options = {}) {
  if (options.enabled === false) {
    return { enabled: false, reason: "TIMESCALE_ENABLED tidak diaktifkan" };
  }
  const days = normalizeRetentionDays(options.retentionDays ?? DEFAULT_RETENTION_DAYS);
  try {
    const ext = await poolOrClient.query(
      "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') AS exists",
    );
    if (!ext.rows[0]?.exists) {
      return {
        enabled: false,
        reason: "Ekstensi timescaledb tidak tersedia di instance PostgreSQL",
      };
    }
    const table = await poolOrClient.query(
      "SELECT to_regclass('public.traffic_samples') IS NOT NULL AS exists",
    );
    if (table.rows[0]?.exists === false) {
      return {
        enabled: false,
        reason: "Tabel traffic_samples belum ada; jalankan npm run db:migrate dulu",
      };
    }
    await poolOrClient.query("CREATE EXTENSION IF NOT EXISTS timescaledb;");
    await poolOrClient.query(
      "SELECT create_hypertable('traffic_samples', 'sampled_at', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE);",
    );
    await poolOrClient.query(
      `SELECT add_retention_policy('traffic_samples', INTERVAL '${days} days', if_not_exists => TRUE);`,
    );
    return { enabled: true, isHypertable: true };
  } catch (error) {
    // Tidak melempar: TimescaleDB hanya tambahan, tabel biasa tetap berfungsi.
    return {
      enabled: false,
      reason: `Setup TimescaleDB gagal: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function main() {
  const { Pool } = await import("pg");
  const { loadEnvironment } = await import("./lib.mjs");
  const { databaseUrl, databaseError } = await import("./postgres.mjs");
  await loadEnvironment();
  let pool;
  try {
    pool = new Pool({
      connectionString: databaseUrl(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL),
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    const result = await applyTimescaleSetup(pool, {
      enabled: process.env.TIMESCALE_ENABLED === "true",
      retentionDays: process.env.TRAFFIC_RETENTION_DAYS,
    });
    console.log(
      result.enabled
        ? "TimescaleDB aktif: traffic_samples jadi hypertable dengan retensi."
        : `TimescaleDB dilewati: ${result.reason}`,
    );
  } catch (error) {
    console.error(databaseError(error));
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
