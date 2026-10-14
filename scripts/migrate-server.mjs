// Migrasi skema untuk server deploy: advisory lock, transaksi atomik per migrasi,
// dry-run, dan opsional TimescaleDB. Tabel pelacak kompatibel dengan drizzle-orm
// ("drizzle"."__drizzle_migrations"), jadi aman dicampur dengan `npm run db:migrate`.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyTimescaleSetup } from "./setup-timescale.mjs";

const BREAKPOINT = "--> statement-breakpoint";
// Kunci advisory tetap (bigint) agar semua runner/kontainer berebut lock yang sama.
export const MIGRATION_LOCK_KEY = "727274001";

/** Membaca journal + berkas .sql. Hasil terurut menurut idx journal. */
export async function loadMigrationPlan(drizzleFolder) {
  const journal = JSON.parse(await readFile(resolve(drizzleFolder, "meta", "_journal.json"), "utf8"));
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const migrations = [];
  for (const entry of entries) {
    const sql = await readFile(resolve(drizzleFolder, `${entry.tag}.sql`), "utf8");
    migrations.push({
      idx: entry.idx,
      tag: entry.tag,
      folderMillis: entry.when,
      hash: createHash("sha256").update(sql).digest("hex"),
      statements: sql
        .split(BREAKPOINT)
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  return migrations;
}

/**
 * Aturan sama dengan migrator drizzle: pending = migrasi yang `folderMillis`-nya
 * lebih besar dari created_at terakhir di tabel pelacak.
 * @param {{ folderMillis: number }[]} allMigrations
 * @param {{ created_at: number|string }[]} appliedMigrations
 */
export function getPendingMigrations(allMigrations, appliedMigrations) {
  const last = appliedMigrations.reduce((max, m) => Math.max(max, Number(m.created_at)), -Infinity);
  return allMigrations.filter((m) => m.folderMillis > last).sort((a, b) => a.idx - b.idx);
}

const isPool = (x) => typeof x.connect === "function" && "totalCount" in x;

/**
 * @param {{ query(sql: string, params?: any[]): Promise<{ rows: any[] }> }} clientOrPool
 * @param {{ dryRun?: boolean, timescale?: boolean, retentionDays?: number|string,
 *           migrationsFolder?: string, logger?: (line: string) => void }} [options]
 */
export async function migrateServer(clientOrPool, options = {}) {
  const log = options.logger ?? ((line) => console.log(line));
  const folder = options.migrationsFolder ?? resolve(import.meta.dirname, "..", "drizzle");
  const all = await loadMigrationPlan(folder);

  // Lock bersifat per-sesi: pada pool, pakai satu client khusus sampai selesai.
  const client = isPool(clientOrPool) ? await clientOrPool.connect() : clientOrPool;
  const owned = client !== clientOrPool;
  let locked = false;
  try {
    if (options.dryRun) {
      const exists = await client.query(
        `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
      );
      const applied = exists.rows[0]?.exists
        ? (await client.query(`SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations"`)).rows
        : [];
      const pending = getPendingMigrations(all, applied);
      log(`[DRY-RUN] ${pending.length} migrasi tertunda dari ${all.length}`);
      for (const m of pending) log(`[DRY-RUN] ${m.tag} (${m.statements.length} statement)`);
      return { dryRun: true, pending, applied: [] };
    }

    log("[START] migrasi server");
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    locked = true;
    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    const { rows } = await client.query(
      `SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations"`,
    );
    const pending = getPendingMigrations(all, rows);
    const applied = [];
    for (const m of pending) {
      log(`[START] ${m.tag}`);
      try {
        await client.query("BEGIN");
        for (const statement of m.statements) await client.query(statement);
        await client.query(
          `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
          [m.hash, m.folderMillis],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        log(`[GAGAL] ${m.tag}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      log(`[SUKSES] ${m.tag}`);
      applied.push(m.tag);
    }
    if (!pending.length) log("[SUKSES] tidak ada migrasi tertunda");

    let timescale;
    if (options.timescale) {
      log("[START] timescaledb");
      timescale = await applyTimescaleSetup(client, {
        enabled: true,
        retentionDays: options.retentionDays,
      });
      log(timescale.enabled ? "[SUKSES] timescaledb" : `[GAGAL] timescaledb: ${timescale.reason}`);
    }
    return { dryRun: false, pending, applied, timescale };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    if (owned) client.release();
  }
}

/**
 * Status migrasi (hanya baca, tanpa lock/mutasi).
 * Integritas: baris DB dipasangkan ke berkas lokal lewat created_at == folderMillis;
 * hash berbeda = berkas .sql diubah setelah diterapkan.
 * @param {{ query(sql: string, params?: any[]): Promise<{ rows: any[] }> }} clientOrPool
 * @param {{ migrationsFolder?: string }} [options]
 */
export async function getMigrationStatus(clientOrPool, options = {}) {
  const folder = options.migrationsFolder ?? resolve(import.meta.dirname, "..", "drizzle");
  const all = await loadMigrationPlan(folder);
  const exists = await clientOrPool.query(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`,
  );
  const trackerExists = Boolean(exists.rows[0]?.exists);
  const rows = trackerExists
    ? (await clientOrPool.query(`SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations"`)).rows
    : [];
  const pending = getPendingMigrations(all, rows);
  const byMillis = new Map(all.map((m) => [m.folderMillis, m]));
  const hashMismatches = [];
  for (const row of rows) {
    const local = byMillis.get(Number(row.created_at));
    if (local && local.hash !== row.hash) {
      hashMismatches.push({ tag: local.tag, expected: local.hash, actual: row.hash });
    }
  }
  const lastMillis = rows.reduce((max, r) => Math.max(max, Number(r.created_at)), -Infinity);
  return {
    trackerExists,
    totalCount: all.length,
    appliedCount: all.length - pending.length,
    pendingCount: pending.length,
    pending: pending.map((m) => m.tag),
    isUpToDate: pending.length === 0,
    lastAppliedAt: Number.isFinite(lastMillis) ? new Date(lastMillis).toISOString() : null,
    hashValid: hashMismatches.length === 0,
    hashMismatches,
  };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * migrateServer dengan backoff eksponensial. Dry-run tidak perlu retry, tapi tetap aman.
 * @param {Parameters<typeof migrateServer>[0]} clientOrPool
 * @param {Parameters<typeof migrateServer>[1] & { maxAttempts?: number, initialDelayMs?: number,
 *           backoffFactor?: number, sleepFn?: (ms: number) => Promise<void> }} [options]
 */
export async function migrateServerWithRetry(clientOrPool, options = {}) {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoffFactor = 2,
    sleepFn = defaultSleep,
    ...migrateOptions
  } = options;
  const log = migrateOptions.logger ?? ((line) => console.log(line));
  let delay = initialDelayMs;
  for (let attempt = 1; ; attempt++) {
    try {
      return await migrateServer(clientOrPool, migrateOptions);
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      log(`[RETRY ${attempt}/${maxAttempts}] Gagal (${reason}), coba lagi dalam ${delay}ms`);
      await sleepFn(delay);
      delay *= backoffFactor;
    }
  }
}

const USAGE =
  "Pakai: node scripts/migrate-server.mjs [--dry-run] [--timescale] [--retry [n]] | --status [--format json]";

/** Parser argumen CLI; mengembalikan { error } bila tidak valid. */
export function parseArgs(args) {
  const o = { dryRun: false, timescale: false, status: false, json: false, retry: 3 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--timescale") o.timescale = true;
    else if (a === "--status") o.status = true;
    else if (a === "--format") {
      if (args[++i] !== "json") return { error: "--format hanya mendukung: json" };
      o.json = true;
    } else if (a === "--retry") {
      if (/^\d+$/.test(args[i + 1] ?? "")) {
        o.retry = Number(args[++i]);
        if (o.retry < 1) return { error: "--retry minimal 1" };
      }
    } else return { error: `Argumen tidak dikenal: ${a}` };
  }
  return o;
}

async function main() {
  const { Pool } = await import("pg");
  const { loadEnvironment } = await import("./lib.mjs");
  const { databaseUrl, databaseError } = await import("./postgres.mjs");
  await loadEnvironment();
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`${args.error}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  let pool;
  try {
    pool = new Pool({
      connectionString: databaseUrl(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL),
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", () => console.error("Koneksi migrasi PostgreSQL terputus."));
    if (args.status) {
      const s = await getMigrationStatus(pool);
      if (args.json) console.log(JSON.stringify(s, null, 2));
      else {
        console.log(`Migrasi: ${s.appliedCount}/${s.totalCount} diterapkan, ${s.pendingCount} tertunda`);
        console.log(`Terakhir diterapkan: ${s.lastAppliedAt ?? "-"}`);
        console.log(`Integritas hash: ${s.hashValid ? "OK" : "TIDAK COCOK"}`);
        for (const m of s.hashMismatches) console.log(`  ! ${m.tag}`);
        for (const t of s.pending) console.log(`  - tertunda: ${t}`);
      }
      if (!s.hashValid) process.exitCode = 1;
      return;
    }
    await migrateServerWithRetry(pool, {
      dryRun: args.dryRun,
      timescale: args.timescale,
      retentionDays: process.env.TRAFFIC_RETENTION_DAYS,
      maxAttempts: args.retry,
    });
  } catch (error) {
    console.error(databaseError(error));
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
