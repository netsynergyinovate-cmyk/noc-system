import { getRawPool } from "@/db";
import {
  type PortableBackupPackage,
  verifyPortableBackupPackage,
} from "@/services/portable-backup.service";

export type RestoreMode = "upsert" | "clean_replace";

export interface RestoreExecutionOptions {
  mode?: RestoreMode;
  dryRun?: boolean;
  actorId?: string;
  actorName?: string;
  targetTables?: string[];
}

export interface RestoreExecutionReport {
  success: boolean;
  dryRun: boolean;
  mode: RestoreMode;
  packageId: string;
  label: string;
  restoredTables: string[];
  skippedTables: string[];
  totalRecordsRestored: number;
  durationMs: number;
  auditLogRecorded: boolean;
  message: string;
  errors: string[];
  timestamp: string;
}

const RESTORE_TABLE_ORDER = [
  "schema_migrations",
  "alert_thresholds",
  "routers",
  "olts",
  "customers",
  "notes",
  "device_test_results",
  "audit_log",
] as const;

/**
 * Mengevaluasi kelayakan paket cadangan sebelum pemulihan (kompatibilitas skema & keutuhan).
 */
export function checkRestoreEligibility(pkg: PortableBackupPackage): {
  eligible: boolean;
  reasons: string[];
  tableCount: number;
  totalRecords: number;
} {
  const reasons: string[] = [];
  const verification = verifyPortableBackupPackage(pkg);

  if (!verification.valid) {
    reasons.push(verification.message);
    if (verification.discrepancies) {
      reasons.push(...verification.discrepancies);
    }
  }

  const tableCount = Object.keys(pkg.payload || {}).length;
  const totalRecords = pkg.manifest?.totalRecords ?? 0;

  if (tableCount === 0 || totalRecords === 0) {
    reasons.push("Paket cadangan tidak memuat tabel atau baris data apa pun.");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    tableCount,
    totalRecords,
  };
}

/**
 * Service pemulihan paket cadangan portabel ke basis data.
 * Menjalankan dalam transaksi tunggal, mendukung mode dry-run & upsert/replace.
 */
export async function executeBackupPackageRestore(
  pkg: PortableBackupPackage,
  options: RestoreExecutionOptions = {},
): Promise<RestoreExecutionReport> {
  const start = Date.now();
  const mode = options.mode ?? "upsert";
  const dryRun = options.dryRun ?? false;
  const actorId = options.actorId ?? "system-restore";
  const actorName = options.actorName ?? "Operator Deploy";
  const errors: string[] = [];

  const eligibility = checkRestoreEligibility(pkg);
  if (!eligibility.eligible) {
    return {
      success: false,
      dryRun,
      mode,
      packageId: pkg.manifest?.packageId ?? "unknown",
      label: pkg.manifest?.label ?? "Tanpa Label",
      restoredTables: [],
      skippedTables: [],
      totalRecordsRestored: 0,
      durationMs: Date.now() - start,
      auditLogRecorded: false,
      message: `Pemulihan ditolak: ${eligibility.reasons.join("; ")}`,
      errors: eligibility.reasons,
      timestamp: new Date().toISOString(),
    };
  }

  const targetFilter = options.targetTables
    ? new Set(options.targetTables)
    : null;

  const restoredTables: string[] = [];
  const skippedTables: string[] = [];
  let totalRecordsRestored = 0;

  // Simulasi dry-run tanpa eksekusi mutasi SQL riil
  if (dryRun) {
    for (const tbl of Object.keys(pkg.payload)) {
      if (targetFilter && !targetFilter.has(tbl)) {
        skippedTables.push(tbl);
        continue;
      }
      const rowCount = pkg.payload[tbl]?.length ?? 0;
      restoredTables.push(tbl);
      totalRecordsRestored += rowCount;
    }

    return {
      success: true,
      dryRun: true,
      mode,
      packageId: pkg.manifest.packageId,
      label: pkg.manifest.label,
      restoredTables,
      skippedTables,
      totalRecordsRestored,
      durationMs: Date.now() - start,
      auditLogRecorded: false,
      message: `Dry-run berhasil: ${totalRecordsRestored} rekaman pada ${restoredTables.length} tabel siap dipulihkan (${mode}).`,
      errors: [],
      timestamp: new Date().toISOString(),
    };
  }

  // Eksekusi riil dalam transaksi
  const pool = getRawPool();
  const client = await pool.connect();
  let auditRecorded = false;

  try {
    await client.query("BEGIN");

    // Urutkan pemulihan tabel sesuai prioritas relasi
    const tablesToProcess = RESTORE_TABLE_ORDER.filter(
      (tbl) => tbl in pkg.payload && (!targetFilter || targetFilter.has(tbl)),
    );

    for (const tbl of tablesToProcess) {
      const rows = pkg.payload[tbl];
      if (!Array.isArray(rows) || rows.length === 0) {
        skippedTables.push(tbl);
        continue;
      }

      if (mode === "clean_replace") {
        // Hapus data lama sebelum memasukkan data cadangan jika clean_replace
        await client.query(`DELETE FROM "${tbl}"`);
      }

      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const keys = Object.keys(row as Record<string, unknown>);
        const values = Object.values(row as Record<string, unknown>);
        if (keys.length === 0) continue;

        const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(", ");
        const colNames = keys.map((k) => `"${k}"`).join(", ");

        const query =
          mode === "clean_replace"
            ? `INSERT INTO "${tbl}" (${colNames}) VALUES (${placeholders})`
            : `INSERT INTO "${tbl}" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

        await client.query(query, values);
        totalRecordsRestored++;
      }

      restoredTables.push(tbl);
    }

    // Catat ke audit log jika tabel audit_log tersedia
    try {
      await client.query(
        `INSERT INTO "audit_log" ("id", "action", "actor_id", "actor_name", "details", "created_at")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          `restore-${Date.now()}`,
          "BACKUP_RESTORE",
          actorId,
          actorName,
          JSON.stringify({
            packageId: pkg.manifest.packageId,
            mode,
            records: totalRecordsRestored,
            tables: restoredTables,
          }),
        ],
      );
      auditRecorded = true;
    } catch {
      // Tabel audit log mungkin belum tersedia jika restore skema awal
    }

    await client.query("COMMIT");

    return {
      success: true,
      dryRun: false,
      mode,
      packageId: pkg.manifest.packageId,
      label: pkg.manifest.label,
      restoredTables,
      skippedTables,
      totalRecordsRestored,
      durationMs: Date.now() - start,
      auditLogRecorded: auditRecorded,
      message: `Pemulihan basis data sukses: ${totalRecordsRestored} rekaman diterapkan pada ${restoredTables.length} tabel.`,
      errors: [],
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    const errMsg = err instanceof Error ? err.message : String(err);
    errors.push(errMsg);

    return {
      success: false,
      dryRun: false,
      mode,
      packageId: pkg.manifest.packageId,
      label: pkg.manifest.label,
      restoredTables,
      skippedTables,
      totalRecordsRestored: 0,
      durationMs: Date.now() - start,
      auditLogRecorded: false,
      message: `Pemulihan gagal dan transaksi di-rollback: ${errMsg}`,
      errors,
      timestamp: new Date().toISOString(),
    };
  } finally {
    client.release();
  }
}
