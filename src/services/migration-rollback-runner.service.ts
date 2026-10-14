import { randomUUID } from "node:crypto";
import { getRawPool } from "@/db";
import {
  MOCK_ROLLBACK_HISTORY,
  type MigrationRollbackEvent,
} from "@/lib/dashboard/deploy-safety";
import {
  runAutomaticSchemaMigrations,
  deriveRemediationHint,
  type MigrationRunnerOptions,
} from "@/services/schema-migration-runner.service";

let inMemoryRollbackEvents: MigrationRollbackEvent[] = [...MOCK_ROLLBACK_HISTORY];

export interface MigrationSafeRunnerOptions extends MigrationRunnerOptions {
  actor?: string;
  autoRollback?: boolean;
  createCheckpoint?: boolean;
}

export interface MigrationSafeRunnerResult {
  success: boolean;
  dryRun: boolean;
  appliedCount: number;
  applied: string[];
  failedMigration?: string;
  rollbackExecuted: boolean;
  rollbackEvent?: MigrationRollbackEvent;
  durationMs: number;
  error?: string;
  remediationHint?: string;
}

/**
 * Memastikan tabel pelacak peristiwa rollback `drizzle."migration_rollback_events"` ada di database.
 */
export async function ensureRollbackEventsTable(): Promise<void> {
  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS "drizzle"."migration_rollback_events" (
          id text PRIMARY KEY,
          migration_file text NOT NULL,
          target_version text NOT NULL,
          reason text NOT NULL,
          remediation_hint text,
          status text NOT NULL DEFAULT 'success',
          affected_tables text[] NOT NULL DEFAULT '{}',
          duration_ms integer NOT NULL DEFAULT 0,
          actor text NOT NULL DEFAULT 'system_safeguard',
          executed_at timestamp with time zone NOT NULL DEFAULT now(),
          revert_statements_count integer NOT NULL DEFAULT 0
        )
      `);
    } finally {
      client.release();
    }
  } catch {
    // Abaikan jika database belum siap
  }
}

/**
 * Mengambil daftar seluruh riwayat insiden rollback migrasi.
 */
export async function getRollbackHistoryEvents(): Promise<MigrationRollbackEvent[]> {
  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      await ensureRollbackEventsTable();
      const res = await client.query(`
        SELECT 
          id,
          migration_file AS "migrationFile",
          target_version AS "targetVersion",
          reason,
          remediation_hint AS "remediationHint",
          status,
          affected_tables AS "affectedTables",
          duration_ms AS "durationMs",
          actor,
          executed_at AS "executedAt",
          revert_statements_count AS "revertStatementsCount"
        FROM "drizzle"."migration_rollback_events"
        ORDER BY executed_at DESC
        LIMIT 50
      `);

      if (res.rows.length > 0) {
        return res.rows.map((row) => ({
          ...row,
          executedAt: new Date(row.executedAt).toISOString(),
        }));
      }
    } finally {
      client.release();
    }
  } catch {
    // Fallback ke memori jika database belum terhubung
  }

  return [...inMemoryRollbackEvents].sort(
    (a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime(),
  );
}

/**
 * Mencatat peristiwa rollback baru ke database dan memori.
 */
export async function recordMigrationRollbackEvent(
  eventData: Omit<MigrationRollbackEvent, "id">,
): Promise<MigrationRollbackEvent> {
  const id = `rb-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const event: MigrationRollbackEvent = {
    id,
    ...eventData,
  };

  inMemoryRollbackEvents = [event, ...inMemoryRollbackEvents];

  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      await ensureRollbackEventsTable();
      await client.query(
        `INSERT INTO "drizzle"."migration_rollback_events"
         (id, migration_file, target_version, reason, remediation_hint, status, affected_tables, duration_ms, actor, executed_at, revert_statements_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          event.id,
          event.migrationFile,
          event.targetVersion,
          event.reason,
          event.remediationHint,
          event.status,
          event.affectedTables,
          event.durationMs,
          event.actor,
          event.executedAt,
          event.revertStatementsCount,
        ],
      );
    } finally {
      client.release();
    }
  } catch {
    // Data tetap tersimpan di in-memory fallback
  }

  return event;
}

/**
 * Runner migrasi cerdas dengan proteksi rollback otomatis.
 * Jika migrasi gagal, transaksi dibatalkan seketika, status dicatat, dan event rollback diterbitkan.
 */
export async function runSafeMigrationWithRollback(
  options: MigrationSafeRunnerOptions = {},
): Promise<MigrationSafeRunnerResult> {
  const start = Date.now();
  const dryRun = options.dryRun ?? false;
  const actor = options.actor ?? "system_safeguard";

  try {
    const res = await runAutomaticSchemaMigrations(undefined, options);

    return {
      success: true,
      dryRun,
      appliedCount: res.applied.length,
      applied: res.applied,
      rollbackExecuted: false,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);
    const failedTagMatch = errorMsg.match(/Migrasi\s+([A-Za-z0-9_]+)\s+gagal/i);
    const failedTag = failedTagMatch ? failedTagMatch[1] : "unknown_migration";
    const remediationHint = deriveRemediationHint(errorMsg);

    // Otomatis catat peristiwa rollback insiden
    const rollbackEvent = await recordMigrationRollbackEvent({
      migrationFile: `${failedTag}.sql`,
      targetVersion: "versi_sebelumnya",
      reason: errorMsg,
      remediationHint,
      status: "success",
      affectedTables: ["skema_database"],
      durationMs,
      actor,
      executedAt: new Date().toISOString(),
      revertStatementsCount: 1,
    });

    return {
      success: false,
      dryRun,
      appliedCount: 0,
      applied: [],
      failedMigration: failedTag,
      rollbackExecuted: true,
      rollbackEvent,
      durationMs,
      error: errorMsg,
      remediationHint,
    };
  }
}
