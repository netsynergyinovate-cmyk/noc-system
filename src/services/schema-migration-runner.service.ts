import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getRawPool } from "@/db";

import {
  MOCK_SCHEMA_MIGRATIONS,
  type SchemaMigrationItem,
  type SchemaMigrationOverview,
} from "@/lib/dashboard/schema-migrations";

export const MIGRATION_ADVISORY_LOCK_KEY = "727274001";
export const MIGRATION_TRACKER_SCHEMA = "drizzle";
export const MIGRATION_TRACKER_TABLE = 'drizzle."__drizzle_migrations"';
export const APP_VERSION_TRACKER_TABLE = 'drizzle."app_version_history"';
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export interface MigrationPlanEntry {
  idx: number;
  tag: string;
  folderMillis: number;
  hash: string;
  statements: string[];
}

export interface AppliedMigrationRow {
  id: number;
  hash: string;
  created_at: string | number;
}

export interface MigrationStatusReport {
  trackerExists: boolean;
  totalCount: number;
  appliedCount: number;
  pendingCount: number;
  pending: string[];
  isUpToDate: boolean;
  lastAppliedAt: string | null;
  hashValid: boolean;
  hashMismatches: Array<{ tag: string; expected: string; actual: string }>;
  advisoryLockKey: string;
  trackerTable: string;
}

export interface MigrationRunnerOptions {
  migrationsFolder?: string;
  dryRun?: boolean;
  timescale?: boolean;
  retentionDays?: number | string;
  logger?: (line: string) => void;
}

export interface MigrationRunnerResult {
  dryRun: boolean;
  pending: string[];
  applied: string[];
  timescale?: { enabled: boolean; reason?: string };
  durationMs: number;
}

export interface MigrationRetryOptions extends MigrationRunnerOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export class MigrationExecutionError extends Error {
  public errorMessage: string;
  public remediationHint: string;
  public rollbackExecuted = true;

  constructor(
    public tag: string,
    public statementIndex: number,
    public statement: string,
    public originalError: unknown,
    hint?: string,
  ) {
    const detail =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);
    const remediation = hint ?? deriveRemediationHint(detail, statement);
    super(
      `Migrasi ${tag} gagal pada statement #${statementIndex + 1}: ${detail} [Rollback: berhasil]. Saran: ${remediation}`,
    );
    this.name = "MigrationExecutionError";
    this.errorMessage = detail;
    this.remediationHint = remediation;
  }
}

/**
 * Menganalisis pesan galat PostgreSQL dan memberikan petunjuk perbaikan dalam Bahasa Indonesia.
 */
export function deriveRemediationHint(
  errorText: string,
  statement?: string,
): string {
  const lower = (errorText || "").toLowerCase();

  if (lower.includes("unique constraint") || lower.includes("duplicate key")) {
    return "Terdapat duplikasi data pada kolom constraint unik. Bersihkan atau gabungkan data duplikat sebelum menerapkan constraint.";
  }
  if (lower.includes("already exists")) {
    return "Objek database sudah ada. Periksa apakah migrasi pernah dijalankan manual atau gunakan klausa IF NOT EXISTS.";
  }
  if (lower.includes("does not exist") || lower.includes("undefined table")) {
    return "Tabel atau kolom acuan belum ada di database. Pastikan urutan migrasi skema sesuai dependensi relasional.";
  }
  if (
    lower.includes("foreign key") ||
    lower.includes("violates foreign key constraint")
  ) {
    return "Pelanggaran relasi foreign key. Pastikan data induk (parent) sudah tersedia sebelum menghubungkan kunci asing.";
  }
  if (lower.includes("cannot drop") && lower.includes("depend")) {
    return "Objek tidak dapat dihapus karena masih digunakan objek lain. Hapus constraint atau foreign key yang bergantung lebih dulu.";
  }
  if (lower.includes("syntax error")) {
    return "Terdapat kesalahan sintaks SQL pada berkas migrasi generated. Periksa tanda baca atau tipe data pada berkas .sql.";
  }
  if (lower.includes("lock timeout") || lower.includes("deadlock")) {
    return "Terjadi perebutan kunci (lock contention) di PostgreSQL. Coba jalankan ulang setelah koneksi lain selesai.";
  }
  return "Periksa log PostgreSQL dan pastikan hak akses (permissions) serta integritas skema database terpenuhi.";
}

export function resolveMigrationsFolder(customFolder?: string): string {
  if (customFolder) return resolve(customFolder);
  if (process.env.DRIZZLE_MIGRATIONS_DIR) {
    return resolve(process.env.DRIZZLE_MIGRATIONS_DIR);
  }
  return resolve(process.cwd(), "drizzle");
}

/**
 * Membaca _journal.json Drizzle dan seluruh berkas generated .sql.
 * Menghasilkan entri terurut berdasarkan indeks journal.
 */
export async function loadGeneratedSqlMigrationPlan(
  drizzleFolder?: string,
): Promise<MigrationPlanEntry[]> {
  const folder = resolveMigrationsFolder(drizzleFolder);
  const journalRaw = await readFile(
    resolve(folder, "meta", "_journal.json"),
    "utf8",
  );
  const journal = JSON.parse(journalRaw) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };

  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const plan: MigrationPlanEntry[] = [];

  for (const entry of entries) {
    const sqlPath = resolve(folder, `${entry.tag}.sql`);
    const sql = await readFile(sqlPath, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const statements = sql
      .split(STATEMENT_BREAKPOINT)
      .map((s) => s.trim())
      .filter(Boolean);

    plan.push({
      idx: entry.idx,
      tag: entry.tag,
      folderMillis: entry.when,
      hash,
      statements,
    });
  }

  return plan;
}

/**
 * Menyaring migrasi yang belum dijalankan berdasarkan created_at terakhir di database.
 */
export function getPendingMigrations(
  allMigrations: MigrationPlanEntry[],
  appliedMigrations: AppliedMigrationRow[],
): MigrationPlanEntry[] {
  const lastMillis = appliedMigrations.reduce(
    (max, m) => Math.max(max, Number(m.created_at)),
    -Infinity,
  );
  return allMigrations
    .filter((m) => m.folderMillis > lastMillis)
    .sort((a, b) => a.idx - b.idx);
}

interface QueryableClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

interface ConnectablePool extends QueryableClient {
  connect(): Promise<QueryableClient & { release(): void }>;
}

function isPool(clientOrPool: unknown): clientOrPool is ConnectablePool {
  return (
    typeof clientOrPool === "object" &&
    clientOrPool !== null &&
    "totalCount" in clientOrPool &&
    "connect" in clientOrPool &&
    "query" in clientOrPool &&
    typeof (clientOrPool as { connect?: unknown }).connect === "function" &&
    !("release" in clientOrPool)
  );
}

/**
 * Memastikan skema dan tabel pelacak migrasi `drizzle."__drizzle_migrations"` tersedia secara idempoten.
 */
export async function ensureMigrationTrackerTable(
  client: QueryableClient,
): Promise<{ created: boolean }> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  return { created: true };
}

/**
 * Memeriksa apakah suatu migrasi tertentu sudah diterapkan pada daftar baris pelacak.
 */
export function isMigrationApplied(
  migration: MigrationPlanEntry | number,
  appliedRows: AppliedMigrationRow[],
): boolean {
  const targetMillis =
    typeof migration === "number" ? migration : migration.folderMillis;
  return appliedRows.some((row) => Number(row.created_at) === targetMillis);
}

/**
 * Mencatat riwayat eksekusi migrasi ke tabel pelacak `drizzle."__drizzle_migrations"`.
 */
export async function recordMigrationHistory(
  client: QueryableClient,
  entry: {
    hash: string;
    folderMillis: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
    [entry.hash, entry.folderMillis],
  );
}

/**
 * Memastikan tabel pencatat galat migrasi `drizzle."migration_failures"` tersedia.
 */
export async function ensureMigrationFailureTable(
  client: QueryableClient,
): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."migration_failures" (
      id SERIAL PRIMARY KEY,
      tag text NOT NULL,
      statement_index integer,
      failed_statement text,
      error_message text NOT NULL,
      remediation_hint text,
      rollback_executed boolean DEFAULT true,
      failed_at timestamp with time zone DEFAULT now(),
      resolved boolean DEFAULT false
    )`,
  );
}

/**
 * Mencatat rincian kegagalan migrasi dan petunjuk perbaikan ke tabel pelacak.
 */
export async function recordMigrationFailure(
  client: QueryableClient,
  error: MigrationExecutionError,
): Promise<void> {
  await ensureMigrationFailureTable(client);
  await client.query(
    `INSERT INTO "drizzle"."migration_failures" 
     (tag, statement_index, failed_statement, error_message, remediation_hint, rollback_executed)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      error.tag,
      error.statementIndex,
      error.statement,
      error.errorMessage,
      error.remediationHint,
      error.rollbackExecuted,
    ],
  );
}

/**
 * Mengambil informasi galat migrasi terakhir yang belum terselesaikan.
 */
export async function getLatestMigrationFailure(
  client: QueryableClient,
): Promise<{
  tag: string;
  name: string;
  error: string;
  failedStatement?: string | null;
  at: string;
  remediationHint?: string | null;
} | null> {
  await ensureMigrationFailureTable(client);
  const res = await client.query(
    `SELECT tag, statement_index, failed_statement, error_message, remediation_hint, failed_at 
     FROM "drizzle"."migration_failures" 
     WHERE resolved = false 
     ORDER BY id DESC LIMIT 1`,
  );
  const row = res.rows[0] as
    | {
        tag?: string;
        failed_statement?: string;
        error_message?: string;
        remediation_hint?: string;
        failed_at?: string;
      }
    | undefined;

  if (!row?.tag) return null;

  return {
    tag: row.tag,
    name: row.tag.replace(/^\d+_/, "").replace(/_/g, " "),
    error: row.error_message || "Eksekusi SQL gagal dan di-rollback.",
    failedStatement: row.failed_statement ?? null,
    at: row.failed_at
      ? new Date(row.failed_at).toISOString()
      : new Date().toISOString(),
    remediationHint: row.remediation_hint ?? null,
  };
}

/**
 * Menandai riwayat galat migrasi telah terselesaikan setelah perbaikan berhasil.
 */
export async function clearResolvedMigrationFailures(
  client: QueryableClient,
  tag?: string,
): Promise<void> {
  await ensureMigrationFailureTable(client);
  if (tag) {
    await client.query(
      `UPDATE "drizzle"."migration_failures" SET resolved = true WHERE tag = $1`,
      [tag],
    );
  } else {
    await client.query(
      `UPDATE "drizzle"."migration_failures" SET resolved = true WHERE resolved = false`,
    );
  }
}

/**
 * Mengambil daftar riwayat migrasi yang sudah tercatat di database terurut kronologis.
 */
export async function getMigrationHistoryRecords(
  clientOrPool?: QueryableClient,
): Promise<AppliedMigrationRow[]> {
  const client = clientOrPool ?? getRawPool();
  const existsRes = await client.query(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
  );
  const trackerExists = Boolean(
    (existsRes.rows[0] as { exists?: boolean })?.exists,
  );
  if (!trackerExists) return [];

  const res = await client.query(
    `SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC`,
  );
  return res.rows as AppliedMigrationRow[];
}

/**
 * Memeriksa status penerapan migrasi skema (read-only, tanpa lock/mutasi).
 */
export async function getSchemaMigrationStatus(
  clientOrPool?: QueryableClient,
  options: { migrationsFolder?: string } = {},
): Promise<MigrationStatusReport> {
  const client = clientOrPool ?? getRawPool();
  const folder = resolveMigrationsFolder(options.migrationsFolder);
  const all = await loadGeneratedSqlMigrationPlan(folder);

  const existsRes = await client.query(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
  );
  const trackerExists = Boolean(
    (existsRes.rows[0] as { exists?: boolean })?.exists,
  );

  const appliedRows: AppliedMigrationRow[] = trackerExists
    ? ((
        await client.query(
          `SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations"`,
        )
      ).rows as AppliedMigrationRow[])
    : [];

  const pending = getPendingMigrations(all, appliedRows);
  const byMillis = new Map<number, MigrationPlanEntry>(
    all.map((m) => [m.folderMillis, m]),
  );

  const hashMismatches: Array<{ tag: string; expected: string; actual: string }> =
    [];
  for (const row of appliedRows) {
    const local = byMillis.get(Number(row.created_at));
    if (local && local.hash !== row.hash) {
      hashMismatches.push({
        tag: local.tag,
        expected: local.hash,
        actual: row.hash,
      });
    }
  }

  const lastMillis = appliedRows.reduce(
    (max, r) => Math.max(max, Number(r.created_at)),
    -Infinity,
  );

  return {
    trackerExists,
    totalCount: all.length,
    appliedCount: all.length - pending.length,
    pendingCount: pending.length,
    pending: pending.map((m) => m.tag),
    isUpToDate: pending.length === 0,
    lastAppliedAt: Number.isFinite(lastMillis)
      ? new Date(lastMillis).toISOString()
      : null,
    hashValid: hashMismatches.length === 0,
    hashMismatches,
    advisoryLockKey: MIGRATION_ADVISORY_LOCK_KEY,
    trackerTable: MIGRATION_TRACKER_TABLE,
  };
}

export interface RealSchemaMigrationsPayload {
  overview: SchemaMigrationOverview;
  items: SchemaMigrationItem[];
}

/**
 * Membaca data riwayat dan status migrasi skema nyata dari jurnal dan database,
 * dipetakan ke model SchemaMigrationOverview dan SchemaMigrationItem[] untuk UI/API.
 */
export async function getRealSchemaMigrationsData(
  clientOrPool?: QueryableClient,
  options: { migrationsFolder?: string } = {},
): Promise<RealSchemaMigrationsPayload> {
  const client = clientOrPool ?? getRawPool();
  const folder = resolveMigrationsFolder(options.migrationsFolder);
  const plan = await loadGeneratedSqlMigrationPlan(folder);
  const statusReport = await getSchemaMigrationStatus(client, {
    migrationsFolder: folder,
  });

  const appliedRows = await getMigrationHistoryRecords(client);
  const appliedMap = new Map<number, AppliedMigrationRow>(
    appliedRows.map((r) => [Number(r.created_at), r]),
  );

  const mockMetaByTag = new Map(
    MOCK_SCHEMA_MIGRATIONS.map((m) => [m.tag, m]),
  );

  const latestFailure = await getLatestMigrationFailure(client);

  const items: SchemaMigrationItem[] = plan.map((p) => {
    const applied = appliedMap.get(p.folderMillis);
    const mockMeta = mockMetaByTag.get(p.tag);
    const isFailed = Boolean(
      latestFailure && latestFailure.tag === p.tag && !applied,
    );

    const name =
      mockMeta?.name ??
      p.tag
        .replace(/^\d+_/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    const description =
      mockMeta?.description ??
      `Migrasi skema generated SQL ${p.tag} (${p.statements.length} statement)`;

    const appliedAt = applied
      ? new Date(Number(applied.created_at)).toISOString()
      : isFailed && latestFailure
        ? latestFailure.at
        : "";

    const statementsSummary =
      mockMeta?.statementsSummary ??
      p.statements.slice(0, 5).map((s) => s.split("\n")[0].slice(0, 80));

    return {
      idx: p.idx,
      tag: p.tag,
      name,
      description,
      folderMillis: p.folderMillis,
      appliedAt,
      status: isFailed ? "failed" : applied ? "applied" : "pending",
      statementsCount: p.statements.length,
      durationMs: mockMeta?.durationMs ?? 25,
      hash: applied?.hash ?? p.hash,
      batch: Math.floor(p.idx / 3) + 1,
      appliedBy: applied ? "Sistem (Auto-Migrate)" : "-",
      statementsSummary,
      errorMessage: isFailed && latestFailure ? latestFailure.error : null,
      failedStatement:
        isFailed && latestFailure ? latestFailure.failedStatement : null,
      remediationHint:
        isFailed && latestFailure ? latestFailure.remediationHint : null,
      rollbackExecuted: isFailed ? true : undefined,
    };
  });

  const appliedCount = items.filter((i) => i.status === "applied").length;
  const pendingCount = items.filter((i) => i.status === "pending").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  const overviewStatus: "up_to_date" | "pending" | "failed" =
    failedCount > 0 ? "failed" : pendingCount === 0 ? "up_to_date" : "pending";

  const overview: SchemaMigrationOverview = {
    totalMigrations: items.length,
    appliedMigrations: appliedCount,
    pendingMigrations: pendingCount,
    failedMigrations: failedCount,
    isUpToDate: pendingCount === 0 && failedCount === 0,
    status: overviewStatus,
    lastAppliedAt: statusReport.lastAppliedAt,
    lastFailure: latestFailure,
    advisoryLockKey: MIGRATION_ADVISORY_LOCK_KEY,
    trackerTable: MIGRATION_TRACKER_TABLE,
    timescaleStatus: "active",
    timescaleRetentionDays: 30,
  };

  return { overview, items };
}

/**
 * Menjalankan migrasi skema dari berkas generated SQL dengan advisory lock PostgreSQL,
 * pencatatan tabel pelacak, dan transaksi atomik per migrasi.
 */
export async function runAutomaticSchemaMigrations(
  clientOrPool?: QueryableClient,
  options: MigrationRunnerOptions = {},
): Promise<MigrationRunnerResult> {
  const start = Date.now();
  const poolOrDirect = clientOrPool ?? getRawPool();
  const log = options.logger ?? ((line: string) => console.log(line));
  const folder = resolveMigrationsFolder(options.migrationsFolder);
  const all = await loadGeneratedSqlMigrationPlan(folder);

  const isClientPool = isPool(poolOrDirect);
  const client = isClientPool ? await poolOrDirect.connect() : poolOrDirect;
  const owned = isClientPool;
  let locked = false;

  try {
    if (options.dryRun) {
      const existsRes = await client.query(
        `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
      );
      const trackerExists = Boolean(
        (existsRes.rows[0] as { exists?: boolean })?.exists,
      );
      const appliedRows = trackerExists
        ? ((
            await client.query(
              `SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations"`,
            )
          ).rows as AppliedMigrationRow[])
        : [];
      const pending = getPendingMigrations(all, appliedRows);

      log(`[DRY-RUN] ${pending.length} migrasi tertunda dari ${all.length}`);
      for (const m of pending) {
        log(`[DRY-RUN] ${m.tag} (${m.statements.length} statement)`);
      }

      return {
        dryRun: true,
        pending: pending.map((m) => m.tag),
        applied: [],
        durationMs: Date.now() - start,
      };
    }

    log("[START] Migrasi skema otomatis");
    await client.query("SELECT pg_advisory_lock($1)", [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);
    locked = true;

    await ensureMigrationTrackerTable(client);

    const rowsRes = await client.query(
      `SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations"`,
    );
    const appliedRows = rowsRes.rows as AppliedMigrationRow[];
    const pending = getPendingMigrations(all, appliedRows);
    const applied: string[] = [];

    for (const m of pending) {
      log(`[START] Menerapkan ${m.tag}`);
      try {
        await client.query("BEGIN");
        for (let i = 0; i < m.statements.length; i++) {
          const stmt = m.statements[i];
          try {
            await client.query(stmt);
          } catch (stmtError) {
            throw new MigrationExecutionError(m.tag, i, stmt, stmtError);
          }
        }
        await recordMigrationHistory(client, {
          hash: m.hash,
          folderMillis: m.folderMillis,
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        const reason =
          error instanceof Error ? error.message : String(error);
        log(`[ROLLBACK SUKSES] Transaksi atomik dibatalkan untuk ${m.tag}`);
        log(`[GAGAL] ${m.tag}: ${reason}`);
        if (error instanceof MigrationExecutionError) {
          try {
            await recordMigrationFailure(client, error);
          } catch {}
        }
        throw error;
      }
      log(`[SUKSES] ${m.tag}`);
      applied.push(m.tag);
    }

    if (applied.length > 0) {
      try {
        await clearResolvedMigrationFailures(client);
      } catch {}
    }

    if (pending.length === 0) {
      log("[SUKSES] Seluruh skema sudah up-to-date, tidak ada migrasi tertunda");
    }

    let timescaleResult: { enabled: boolean; reason?: string } | undefined;
    if (options.timescale) {
      try {
        const { applyTimescaleSetup } = await import(
          "../../scripts/setup-timescale.mjs"
        );
        timescaleResult = await applyTimescaleSetup(client as any, {
          enabled: true,
          retentionDays: options.retentionDays,
        });
      } catch (tsErr) {
        timescaleResult = {
          enabled: false,
          reason: tsErr instanceof Error ? tsErr.message : String(tsErr),
        };
      }
    }

    return {
      dryRun: false,
      pending: pending.map((m) => m.tag),
      applied,
      timescale: timescaleResult,
      durationMs: Date.now() - start,
    };
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_KEY])
        .catch(() => {});
    }
    if (owned && "release" in client && typeof client.release === "function") {
      client.release();
    }
  }
}

/**
 * Menjalankan migrasi skema dengan retry dan exponential backoff.
 */
export async function runAutomaticSchemaMigrationsWithRetry(
  clientOrPool?: QueryableClient,
  options: MigrationRetryOptions = {},
): Promise<MigrationRunnerResult> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoffFactor = 2,
    sleepFn = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...runnerOptions
  } = options;

  const log = runnerOptions.logger ?? ((line: string) => console.log(line));
  let delay = initialDelayMs;

  for (let attempt = 1; ; attempt++) {
    try {
      return await runAutomaticSchemaMigrations(clientOrPool, runnerOptions);
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      log(
        `[RETRY ${attempt}/${maxAttempts}] Gagal (${reason}), mencoba lagi dalam ${delay}ms`,
      );
      await sleepFn(delay);
      delay *= backoffFactor;
    }
  }
}

export interface IdempotencyVerificationResult {
  idempotent: boolean;
  firstRunResult: MigrationRunnerResult;
  secondRunResult: MigrationRunnerResult;
  reAppliedCount: number;
  status: MigrationStatusReport;
}

/**
 * Memverifikasi mekanisme idempotensi migrasi dengan menjalankan runner dua kali berurutan.
 * Pada eksekusi kedua, tidak boleh ada migrasi yang diterapkan ulang (reAppliedCount === 0).
 */
export async function verifyMigrationIdempotency(
  clientOrPool?: QueryableClient,
  options: MigrationRunnerOptions = {},
): Promise<IdempotencyVerificationResult> {
  const poolOrDirect = clientOrPool ?? getRawPool();
  const first = await runAutomaticSchemaMigrations(poolOrDirect, options);
  const second = await runAutomaticSchemaMigrations(poolOrDirect, options);
  const status = await getSchemaMigrationStatus(poolOrDirect, {
    migrationsFolder: options.migrationsFolder,
  });

  const idempotent = second.applied.length === 0 && second.pending.length === 0;

  return {
    idempotent,
    firstRunResult: first,
    secondRunResult: second,
    reAppliedCount: second.applied.length,
    status,
  };
}

export interface AppVersionHistoryRow {
  id: number;
  version: string;
  migrated_at: string;
  migrations_applied: number;
  details?: Record<string, unknown> | null;
}

export interface AppUpgradeMigrationReport {
  previousVersion: string | null;
  currentVersion: string;
  isUpgrade: boolean;
  migrationsApplied: string[];
  durationMs: number;
}

export function getCurrentAppVersion(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.APP_VERSION?.trim()) return env.APP_VERSION.trim();
  if (env.NEXT_PUBLIC_APP_VERSION?.trim())
    return env.NEXT_PUBLIC_APP_VERSION.trim();
  return "0.1.0";
}

/**
 * Memastikan tabel pencatat versi aplikasi `drizzle."app_version_history"` tersedia.
 */
export async function ensureAppVersionTrackerTable(
  client: QueryableClient,
): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."app_version_history" (
      id SERIAL PRIMARY KEY,
      version text NOT NULL,
      migrated_at timestamp with time zone DEFAULT now(),
      migrations_applied integer DEFAULT 0,
      details jsonb
    )`,
  );
}

/**
 * Mengambil versi aplikasi terakhir yang tercatat di database.
 */
export async function getLatestRecordedAppVersion(
  clientOrPool?: QueryableClient,
): Promise<string | null> {
  const client = clientOrPool ?? getRawPool();
  await ensureAppVersionTrackerTable(client);
  const res = await client.query(
    `SELECT version FROM "drizzle"."app_version_history" ORDER BY id DESC LIMIT 1`,
  );
  const row = res.rows[0] as { version?: string } | undefined;
  return row?.version ?? null;
}

/**
 * Mengambil seluruh riwayat versi aplikasi dan migrasi skemanya.
 */
export async function getAppVersionUpgradeHistory(
  clientOrPool?: QueryableClient,
): Promise<AppVersionHistoryRow[]> {
  const client = clientOrPool ?? getRawPool();
  await ensureAppVersionTrackerTable(client);
  const res = await client.query(
    `SELECT id, version, migrated_at, migrations_applied, details FROM "drizzle"."app_version_history" ORDER BY id ASC`,
  );
  return res.rows as AppVersionHistoryRow[];
}

/**
 * Mencatat kenaikan versi aplikasi beserta jumlah migrasi yang diterapkan.
 */
export async function recordAppVersionUpgrade(
  client: QueryableClient,
  version: string,
  migrationsApplied: number,
  details?: Record<string, unknown>,
): Promise<void> {
  await ensureAppVersionTrackerTable(client);
  await client.query(
    `INSERT INTO "drizzle"."app_version_history" (version, migrations_applied, details) VALUES ($1, $2, $3)`,
    [version, migrationsApplied, details ? JSON.stringify(details) : null],
  );
}

/**
 * Memeriksa apakah versi aplikasi naik (upgrade) dan otomatis menerapkan migrasi baru yang tertunda.
 */
export async function applyUpgradeMigrationsIfNeeded(
  clientOrPool?: QueryableClient,
  options: MigrationRetryOptions & { appVersion?: string } = {},
): Promise<AppUpgradeMigrationReport> {
  const start = Date.now();
  const poolOrDirect = clientOrPool ?? getRawPool();
  const log = options.logger ?? ((line: string) => console.log(line));
  const isClientPool = isPool(poolOrDirect);
  const client = isClientPool ? await poolOrDirect.connect() : poolOrDirect;
  const owned = isClientPool;

  try {
    const currentVersion = options.appVersion ?? getCurrentAppVersion();
    const previousVersion = await getLatestRecordedAppVersion(client);
    const isUpgrade =
      previousVersion !== null && previousVersion !== currentVersion;

    if (isUpgrade) {
      log(
        `[UPGRADE VERSI APLIKASI] Terdeteksi kenaikan versi dari ${previousVersion} -> ${currentVersion}`,
      );
    }

    const runnerResult = await runAutomaticSchemaMigrationsWithRetry(
      client,
      options,
    );

    if (
      previousVersion === null ||
      isUpgrade ||
      runnerResult.applied.length > 0
    ) {
      await recordAppVersionUpgrade(
        client,
        currentVersion,
        runnerResult.applied.length,
        {
          previousVersion,
          applied: runnerResult.applied,
          durationMs: runnerResult.durationMs,
        },
      );
      log(
        `[REKORD VERSI] Versi ${currentVersion} tercatat dengan ${runnerResult.applied.length} migrasi baru diterapkan`,
      );
    }

    return {
      previousVersion,
      currentVersion,
      isUpgrade: Boolean(isUpgrade),
      migrationsApplied: runnerResult.applied,
      durationMs: Date.now() - start,
    };
  } finally {
    if (owned && "release" in client && typeof client.release === "function") {
      client.release();
    }
  }
}
