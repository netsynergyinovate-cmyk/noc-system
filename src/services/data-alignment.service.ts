import "server-only";
import type { Pool, PoolClient } from "pg";
import { getRawPool } from "@/db";
import { logSyncOperationAudit } from "@/services/audit.service";

export const ALIGNMENT_ADVISORY_LOCK_KEY = 727274003;

export interface AlignmentStepResult {
  step: "billing_status" | "thresholds" | "customers" | "routers";
  recordsProcessed: number;
  recordsUpdated: number;
  recordsInserted: number;
  status: "completed" | "skipped" | "failed";
  durationMs: number;
  error?: string;
}

export interface AlignmentRunReport {
  success: boolean;
  totalSteps: number;
  totalRecordsProcessed: number;
  totalRecordsUpdated: number;
  totalRecordsInserted: number;
  durationMs: number;
  steps: AlignmentStepResult[];
  actor: string;
  executedAt: string;
  errorMessage?: string;
}

export interface AlignmentOptions {
  actor?: string;
  logger?: (line: string) => void;
  steps?: Array<AlignmentStepResult["step"]>;
  pool?: Pool | { connect: () => Promise<never> };
}

/**
 * Service penyelarasan data otomatis yang idempoten.
 * Memastikan status billing, ambang batas, dan entitas perangkat tersinkronisasi
 * tanpa menimpa perubahan operator atau menduplikasi entri.
 */
export async function runDataAlignmentIdempotent(
  options: AlignmentOptions = {},
): Promise<AlignmentRunReport> {
  const startTime = Date.now();
  const actor = options.actor ?? "system_daemon";
  const log = options.logger ?? ((l: string) => console.log(l));
  const activeSteps = options.steps ?? [
    "billing_status",
    "thresholds",
    "routers",
  ];
  const pool = (options.pool as Pool) ?? getRawPool();
  let client: PoolClient | null = null;
  let lockAcquired = false;

  try {
    client = await pool.connect();
  } catch (connErr) {
    const msg = connErr instanceof Error ? connErr.message : String(connErr);
    log(`[ALIGNMENT][WARN] Gagal terhubung ke database untuk penyelarasan: ${msg}`);
    return {
      success: false,
      totalSteps: activeSteps.length,
      totalRecordsProcessed: 0,
      totalRecordsUpdated: 0,
      totalRecordsInserted: 0,
      durationMs: Date.now() - startTime,
      steps: activeSteps.map((s) => ({
        step: s,
        recordsProcessed: 0,
        recordsUpdated: 0,
        recordsInserted: 0,
        status: "skipped",
        durationMs: 0,
        error: "Database tidak terjangkau",
      })),
      actor,
      executedAt: new Date().toISOString(),
      errorMessage: msg,
    };
  }

  const results: AlignmentStepResult[] = [];
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalInserted = 0;

  try {
    // 1. Dapatkan advisory lock khusus penyelarasan
    const lockRes = await client.query(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [ALIGNMENT_ADVISORY_LOCK_KEY],
    );
    lockAcquired = Boolean(lockRes.rows[0]?.acquired);

    if (!lockAcquired) {
      log("[ALIGNMENT] Lock sedang digunakan proses lain, dilewati dengan aman.");
      return {
        success: true,
        totalSteps: 0,
        totalRecordsProcessed: 0,
        totalRecordsUpdated: 0,
        totalRecordsInserted: 0,
        durationMs: Date.now() - startTime,
        steps: [],
        actor,
        executedAt: new Date().toISOString(),
        errorMessage: "Penyelarasan dilewati: proses lain sedang berjalan.",
      };
    }

    // 2. Jalankan tiap langkah penyelarasan
    for (const step of activeSteps) {
      const stepStart = Date.now();
      try {
        if (step === "billing_status") {
          // Selaraskan status billing pelanggan: baris customer yang belum ada di billing_status disisipkan dengan 'lunas' (idempoten)
          const alignRes = await client.query(`
            INSERT INTO billing_status (pppoe_username, status, updated_at)
            SELECT c.pppoe_username, 'lunas', NOW()
            FROM customers c
            ON CONFLICT (pppoe_username) DO NOTHING
          `);
          const ins = alignRes.rowCount ?? 0;
          totalInserted += ins;
          totalProcessed += ins;
          results.push({
            step,
            recordsProcessed: ins,
            recordsUpdated: 0,
            recordsInserted: ins,
            status: "completed",
            durationMs: Date.now() - stepStart,
          });
        } else if (step === "thresholds") {
          // Pastikan 5 ambang batas dasar tersedia tanpa mengubah nilai kustom yang ada
          const defaultRules = [
            ["cpu", 85, 300],
            ["queue", 90, 180],
            ["port", 50, 60],
            ["optical", -27, 0],
            ["offline", null, 60],
          ] as const;

          let insCount = 0;
          for (const [kind, val, sec] of defaultRules) {
            const insRes = await client.query(
              `INSERT INTO alert_thresholds (rule_kind, threshold, for_seconds, updated_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (rule_kind) DO NOTHING`,
              [kind, val, sec],
            );
            if (insRes.rowCount) insCount += insRes.rowCount;
          }

          totalInserted += insCount;
          totalProcessed += defaultRules.length;
          results.push({
            step,
            recordsProcessed: defaultRules.length,
            recordsUpdated: 0,
            recordsInserted: insCount,
            status: "completed",
            durationMs: Date.now() - stepStart,
          });
        } else if (step === "routers") {
          // Normalisasi status router aktif jika null
          const rRes = await client.query(`
            UPDATE routers
            SET status = 'aktif'
            WHERE status IS NULL
          `);
          const upd = rRes.rowCount ?? 0;
          totalUpdated += upd;
          totalProcessed += upd;
          results.push({
            step,
            recordsProcessed: upd,
            recordsUpdated: upd,
            recordsInserted: 0,
            status: "completed",
            durationMs: Date.now() - stepStart,
          });
        }
      } catch (stepErr) {
        const msg = stepErr instanceof Error ? stepErr.message : String(stepErr);
        results.push({
          step,
          recordsProcessed: 0,
          recordsUpdated: 0,
          recordsInserted: 0,
          status: "failed",
          durationMs: Date.now() - stepStart,
          error: msg,
        });
      }
    }

    // 3. Catat riwayat eksekusi ke data_sync_runs jika tabel ada
    try {
      await client.query(
        `INSERT INTO data_sync_runs (module, sync_type, direction, status, records_processed, records_inserted, records_updated, duration_ms, actor, summary_message, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          "data_alignment",
          "alignment",
          "bidirectional",
          "completed",
          totalProcessed,
          totalInserted,
          totalUpdated,
          Date.now() - startTime,
          actor,
          `Penyelarasan otomatis selesai: ${totalInserted} baru, ${totalUpdated} diperbarui.`,
        ],
      );
    } catch {
      // Abaikan jika tabel log belum ada
    }

    // Catat ke audit log
    await logSyncOperationAudit({
      operation: "alignment",
      target: "data_alignment",
      summary: `Penyelarasan otomatis selesai: ${totalInserted} baru, ${totalUpdated} diperbarui.`,
      success: true,
      recordsCount: totalProcessed,
      durationMs: Date.now() - startTime,
      detail: {
        stepsCount: results.length,
        actor,
        totalUpdated,
        totalInserted,
      },
    });

    return {
      success: true,
      totalSteps: results.length,
      totalRecordsProcessed: totalProcessed,
      totalRecordsUpdated: totalUpdated,
      totalRecordsInserted: totalInserted,
      durationMs: Date.now() - startTime,
      steps: results,
      actor,
      executedAt: new Date().toISOString(),
    };
  } finally {
    if (lockAcquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [
          ALIGNMENT_ADVISORY_LOCK_KEY,
        ]);
      } catch {
        // Abaikan galat unlock
      }
    }
    client.release();
  }
}

/**
 * Mengambil status dan riwayat penyelarasan data terkini.
 */
export async function getAlignmentStatusAndHistory() {
  const { getMockAlignmentJobs, getMockAlignmentOverview } = await import(
    "@/lib/dashboard/auto-alignment"
  );

  const pool = getRawPool();
  let recentRuns: unknown[] = [];

  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT * FROM data_sync_runs WHERE sync_type = 'alignment' ORDER BY started_at DESC LIMIT 10`,
      );
      recentRuns = res.rows;
    } finally {
      client.release();
    }
  } catch {
    // Fallback jika database belum ada tabel
  }

  const overview = getMockAlignmentOverview();
  const jobs = getMockAlignmentJobs();

  return {
    overview,
    jobs,
    recentRuns,
    checkedAt: new Date().toISOString(),
  };
}

