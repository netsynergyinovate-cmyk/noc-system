import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

register();

const {
  MIGRATION_ADVISORY_LOCK_KEY,
  MIGRATION_TRACKER_TABLE,
  MigrationExecutionError,
  loadGeneratedSqlMigrationPlan,
  getPendingMigrations,
  getSchemaMigrationStatus,
  runAutomaticSchemaMigrations,
  runAutomaticSchemaMigrationsWithRetry,
  ensureMigrationTrackerTable,
  isMigrationApplied,
  recordMigrationHistory,
  getMigrationHistoryRecords,
  verifyMigrationIdempotency,
  getCurrentAppVersion,
  ensureAppVersionTrackerTable,
  getLatestRecordedAppVersion,
  recordAppVersionUpgrade,
  getAppVersionUpgradeHistory,
  applyUpgradeMigrationsIfNeeded,
  getRealSchemaMigrationsData,
  deriveRemediationHint,
  recordMigrationFailure,
  getLatestMigrationFailure,
  clearResolvedMigrationFailures,
} = await import("../src/services/schema-migration-runner.service.ts");

const drizzleFolder = resolve(import.meta.dirname, "..", "drizzle");

function mockClient({
  tableExists = true,
  applied = [],
  failOnStatement = null,
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const trimmed = sql.trim().split("\n")[0];
      calls.push(trimmed);

      if (failOnStatement && sql.includes(failOnStatement)) {
        throw new Error(`Simulated SQL error on: ${failOnStatement}`);
      }

      if (sql.includes("to_regclass")) {
        return { rows: [{ exists: tableExists }] };
      }

      if (sql.startsWith("SELECT id, hash, created_at")) {
        return { rows: applied };
      }

      return { rows: [] };
    },
  };
}

test("runner: loadGeneratedSqlMigrationPlan membaca 15 berkas generated SQL terurut", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  assert.ok(plan.length >= 15);

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    assert.equal(item.idx, i);
    assert.ok(item.tag.startsWith(String(i).padStart(4, "0")));
    assert.ok(item.folderMillis > 0);
    assert.match(item.hash, /^[0-9a-f]{64}$/);
    assert.ok(item.statements.length > 0);
    assert.ok(
      item.statements.every((s) => !s.includes("statement-breakpoint")),
    );
  }
});

test("runner: getPendingMigrations mendeteksi migrasi yang belum terpasang", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);

  // Belum ada yang diterapkan
  const allPending = getPendingMigrations(plan, []);
  assert.equal(allPending.length, plan.length);

  // Sebagian sudah diterapkan (misal sampai migrasi ke-10)
  const partial = [{ created_at: plan[10].folderMillis }];
  const remaining = getPendingMigrations(plan, partial);
  assert.equal(remaining.length, plan.length - 11);
  assert.equal(remaining[0].idx, 11);
  assert.equal(remaining.at(-1).idx, plan.length - 1);

  // Semua sudah diterapkan
  const fullyApplied = [{ created_at: plan.at(-1).folderMillis }];
  const none = getPendingMigrations(plan, fullyApplied);
  assert.equal(none.length, 0);
});

test("runner: getSchemaMigrationStatus melaporkan trackerExists false saat tabel belum ada", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  const client = mockClient({ tableExists: false });
  const status = await getSchemaMigrationStatus(client, {
    migrationsFolder: drizzleFolder,
  });

  assert.equal(status.trackerExists, false);
  assert.equal(status.appliedCount, 0);
  assert.equal(status.pendingCount, plan.length);
  assert.equal(status.totalCount, plan.length);
  assert.equal(status.isUpToDate, false);
  assert.equal(status.lastAppliedAt, null);
  assert.equal(status.advisoryLockKey, MIGRATION_ADVISORY_LOCK_KEY);
  assert.equal(status.trackerTable, MIGRATION_TRACKER_TABLE);
});

test("runner: getSchemaMigrationStatus melaporkan up-to-date dan memverifikasi integritas hash", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  const appliedRows = plan.map((m, i) => ({
    id: i + 1,
    hash: m.hash,
    created_at: String(m.folderMillis),
  }));

  const client = mockClient({ tableExists: true, applied: appliedRows });
  const status = await getSchemaMigrationStatus(client, {
    migrationsFolder: drizzleFolder,
  });

  assert.equal(status.trackerExists, true);
  assert.equal(status.appliedCount, plan.length);
  assert.equal(status.pendingCount, 0);
  assert.equal(status.isUpToDate, true);
  assert.equal(status.hashValid, true);
  assert.deepEqual(status.hashMismatches, []);
  assert.equal(
    status.lastAppliedAt,
    new Date(plan.at(-1).folderMillis).toISOString(),
  );
});

test("runner: runAutomaticSchemaMigrations dry-run tidak melakukan mutasi atau advisory lock", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  const client = mockClient({ tableExists: false });
  const logs = [];
  const result = await runAutomaticSchemaMigrations(client, {
    dryRun: true,
    migrationsFolder: drizzleFolder,
    logger: (msg) => logs.push(msg),
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.pending.length, plan.length);
  assert.equal(result.applied.length, 0);
  assert.ok(client.calls.every((q) => q.startsWith("SELECT")));
  assert.ok(!client.calls.some((q) => q.includes("advisory")));
  assert.ok(logs.some((l) => l.includes("[DRY-RUN]")));
});

test("runner: runAutomaticSchemaMigrations eksekusi dengan advisory lock dan commit per migrasi", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  // Hanya migrasi terakhir yang pending
  const appliedRows = [{ created_at: plan.at(-2).folderMillis }];
  const client = mockClient({ tableExists: true, applied: appliedRows });
  const logs = [];

  const result = await runAutomaticSchemaMigrations(client, {
    migrationsFolder: drizzleFolder,
    logger: (msg) => logs.push(msg),
  });

  assert.equal(result.dryRun, false);
  assert.deepEqual(result.applied, [plan.at(-1).tag]);

  // Lock dipanggil sebelum BEGIN transaksi
  assert.equal(client.calls[0], "SELECT pg_advisory_lock($1)");
  assert.ok(
    client.calls.findIndex((q) => q.includes("pg_advisory_lock")) <
      client.calls.indexOf("BEGIN"),
  );
  // Unlock dipanggil pada akhirnya
  assert.equal(client.calls.at(-1), "SELECT pg_advisory_unlock($1)");
  assert.ok(client.calls.includes("BEGIN"));
  assert.ok(client.calls.includes("COMMIT"));
  assert.ok(logs.some((l) => l.includes(`[SUKSES] ${plan.at(-1).tag}`)));
});

test("runner: runAutomaticSchemaMigrations rollback dan lepas lock saat statement SQL gagal", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  const client = mockClient({
    tableExists: true,
    applied: [{ created_at: plan[13].folderMillis }],
    failOnStatement: "cpe_tasks",
  });

  await assert.rejects(
    async () => {
      await runAutomaticSchemaMigrations(client, {
        migrationsFolder: drizzleFolder,
        logger: () => {},
      });
    },
    (err) => {
      assert.ok(err instanceof MigrationExecutionError);
      assert.equal(err.tag, plan[14].tag);
      return true;
    },
  );

  assert.ok(client.calls.includes("BEGIN"));
  assert.ok(client.calls.includes("ROLLBACK"));
  assert.ok(!client.calls.includes("COMMIT"));
  assert.equal(client.calls.at(-1), "SELECT pg_advisory_unlock($1)");
});

test("runner: runAutomaticSchemaMigrationsWithRetry mencoba ulang secara berkala", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  let attempts = 0;
  const sleepDelays = [];

  const client = {
    calls: [],
    async query(sql) {
      if (sql.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (sql.startsWith("SELECT id, hash, created_at")) {
        return { rows: [{ created_at: plan.at(-2).folderMillis }] };
      }
      if (sql.startsWith("CREATE TABLE") || sql.startsWith("ALTER TABLE")) {
        attempts++;
        if (attempts < 3) throw new Error("Temporary DB lock contention");
      }
      return { rows: [] };
    },
  };

  const result = await runAutomaticSchemaMigrationsWithRetry(client, {
    migrationsFolder: drizzleFolder,
    maxAttempts: 4,
    initialDelayMs: 50,
    backoffFactor: 2,
    sleepFn: async (ms) => {
      sleepDelays.push(ms);
    },
    logger: () => {},
  });

  assert.equal(result.applied.length, 1);
  assert.deepEqual(sleepDelays, [50, 100]);
});

test("API: GET /api/migrations/status menolak anonim 401", async () => {
  const { GET } = await import("../src/app/api/migrations/status/route.ts");
  const req = new Request("http://localhost:3101/api/migrations/status");
  const res = await GET(req);
  assert.equal(res.status, 401);
});

test("API: POST /api/migrations/run menolak anonim 401", async () => {
  const { POST } = await import("../src/app/api/migrations/run/route.ts");
  const req = new Request("http://localhost:3101/api/migrations/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: true }),
  });
  const res = await POST(req);
  assert.equal(res.status, 401);
});

test("idempotensi: ensureMigrationTrackerTable membuat skema dan tabel secara idempoten", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      return { rows: [] };
    },
  };

  const res = await ensureMigrationTrackerTable(client);
  assert.equal(res.created, true);
  assert.ok(calls.some((q) => q.includes("CREATE SCHEMA IF NOT EXISTS")));
  assert.ok(calls.some((q) => q.includes("CREATE TABLE IF NOT EXISTS")));
});

test("idempotensi: isMigrationApplied mengenali status berdasarkan created_at", () => {
  const appliedRows = [
    { id: 1, hash: "hash1", created_at: 1000 },
    { id: 2, hash: "hash2", created_at: 2000 },
  ];

  assert.equal(isMigrationApplied(1000, appliedRows), true);
  assert.equal(isMigrationApplied(2000, appliedRows), true);
  assert.equal(isMigrationApplied(3000, appliedRows), false);
  assert.equal(isMigrationApplied({ folderMillis: 2000 }, appliedRows), true);
  assert.equal(isMigrationApplied({ folderMillis: 9999 }, appliedRows), false);
});

test("idempotensi: recordMigrationHistory dan getMigrationHistoryRecords mencatat dan membaca data", async () => {
  const rows = [];
  const client = {
    async query(sql, params) {
      if (sql.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (sql.startsWith("INSERT INTO")) {
        rows.push({
          id: rows.length + 1,
          hash: params[0],
          created_at: params[1],
        });
        return { rows: [] };
      }
      if (sql.startsWith("SELECT id, hash, created_at")) {
        return { rows };
      }
      return { rows: [] };
    },
  };

  await recordMigrationHistory(client, {
    hash: "abc123hash",
    folderMillis: 1788829112625,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hash, "abc123hash");
  assert.equal(rows[0].created_at, 1788829112625);

  const history = await getMigrationHistoryRecords(client);
  assert.equal(history.length, 1);
  assert.equal(history[0].hash, "abc123hash");
});

test("idempotensi: verifyMigrationIdempotency membuktikan eksekusi berulang tidak menerapkan migrasi ganda", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  const rows = [];

  const client = {
    calls: [],
    async query(sql, params) {
      if (sql.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (sql.startsWith("SELECT id, hash, created_at")) {
        return { rows: [...rows] };
      }
      if (sql.includes("__drizzle_migrations") && params) {
        rows.push({
          id: rows.length + 1,
          hash: params[0],
          created_at: params[1],
        });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const verify = await verifyMigrationIdempotency(client, {
    migrationsFolder: drizzleFolder,
    logger: () => {},
  });

  assert.equal(verify.idempotent, true);
  assert.equal(verify.firstRunResult.applied.length, plan.length);
  assert.equal(verify.secondRunResult.applied.length, 0);
  assert.equal(verify.secondRunResult.pending.length, 0);
  assert.equal(verify.reAppliedCount, 0);
  assert.equal(verify.status.isUpToDate, true);
});

test("API: GET /api/migrations/history menolak anonim 401", async () => {
  const { GET } = await import("../src/app/api/migrations/history/route.ts");
  const req = new Request("http://localhost:3101/api/migrations/history");
  const res = await GET(req);
  assert.equal(res.status, 401);
});

test("API: POST /api/migrations/verify menolak anonim 401", async () => {
  const { POST } = await import("../src/app/api/migrations/verify/route.ts");
  const req = new Request("http://localhost:3101/api/migrations/verify", {
    method: "POST",
  });
  const res = await POST(req);
  assert.equal(res.status, 401);
});

test("upgrade versi: getCurrentAppVersion membaca dari env atau fallback", () => {
  assert.equal(getCurrentAppVersion({ APP_VERSION: "1.2.3" }), "1.2.3");
  assert.equal(
    getCurrentAppVersion({ NEXT_PUBLIC_APP_VERSION: "2.0.0" }),
    "2.0.0",
  );
  assert.equal(getCurrentAppVersion({}), "1.0.0.0");
});

test("upgrade versi: ensureAppVersionTrackerTable dan recordAppVersionUpgrade mencatat riwayat", async () => {
  const versions = [];
  const client = {
    async query(sql, params) {
      if (sql.startsWith("INSERT INTO")) {
        versions.push({
          id: versions.length + 1,
          version: params[0],
          migrations_applied: params[1],
          details: params[2],
        });
        return { rows: [] };
      }
      if (sql.includes("ORDER BY id DESC LIMIT 1")) {
        return { rows: versions.slice(-1) };
      }
      if (sql.startsWith("SELECT id, version")) {
        return { rows: versions };
      }
      return { rows: [] };
    },
  };

  await ensureAppVersionTrackerTable(client);
  const initial = await getLatestRecordedAppVersion(client);
  assert.equal(initial, null);

  await recordAppVersionUpgrade(client, "0.1.0", 15, { reason: "initial" });
  assert.equal(await getLatestRecordedAppVersion(client), "0.1.0");

  await recordAppVersionUpgrade(client, "0.2.0", 2, { reason: "upgrade" });
  assert.equal(await getLatestRecordedAppVersion(client), "0.2.0");

  const history = await getAppVersionUpgradeHistory(client);
  assert.equal(history.length, 2);
  assert.equal(history[0].version, "0.1.0");
  assert.equal(history[1].version, "0.2.0");
});

test("upgrade versi: applyUpgradeMigrationsIfNeeded mendeteksi kenaikan versi dan menerapkan migrasi baru", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  const migrationRows = [{ created_at: plan.at(-2).folderMillis }];
  const versionRows = [{ id: 1, version: "0.1.0" }];
  const logs = [];

  const client = {
    calls: [],
    async query(sql, params) {
      if (sql.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (sql.startsWith("SELECT id, hash, created_at")) {
        return { rows: [...migrationRows] };
      }
      if (sql.includes("ORDER BY id DESC LIMIT 1")) {
        return { rows: versionRows.slice(-1) };
      }
      if (sql.startsWith('INSERT INTO "drizzle"."__drizzle_migrations"')) {
        migrationRows.push({
          id: migrationRows.length + 1,
          hash: params[0],
          created_at: params[1],
        });
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO "drizzle"."app_version_history"')) {
        versionRows.push({ id: versionRows.length + 1, version: params[0] });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const report = await applyUpgradeMigrationsIfNeeded(client, {
    appVersion: "0.2.0",
    migrationsFolder: drizzleFolder,
    logger: (l) => logs.push(l),
  });

  assert.equal(report.previousVersion, "0.1.0");
  assert.equal(report.currentVersion, "0.2.0");
  assert.equal(report.isUpgrade, true);
  assert.deepEqual(report.migrationsApplied, [plan.at(-1).tag]);
  assert.ok(logs.some((l) => l.includes("[UPGRADE VERSI APLIKASI]")));
  assert.equal(versionRows.at(-1).version, "0.2.0");
});

test("API: GET /api/migrations/version menolak anonim 401", async () => {
  const { GET } = await import("../src/app/api/migrations/version/route.ts");
  const req = new Request("http://localhost:3101/api/migrations/version");
  const res = await GET(req);
  assert.equal(res.status, 401);
});

test("API: POST /api/migrations/version menolak anonim 401", async () => {
  const { POST } = await import("../src/app/api/migrations/version/route.ts");
  const req = new Request("http://localhost:3101/api/migrations/version", {
    method: "POST",
  });
  const res = await POST(req);
  assert.equal(res.status, 401);
});

test("payload: getRealSchemaMigrationsData memetakan plan dan database ke SchemaMigrationOverview dan Item[]", async () => {
  const plan = await loadGeneratedSqlMigrationPlan(drizzleFolder);
  const appliedRows = plan.slice(0, 10).map((m, i) => ({
    id: i + 1,
    hash: m.hash,
    created_at: String(m.folderMillis),
  }));

  const client = mockClient({ tableExists: true, applied: appliedRows });
  const result = await getRealSchemaMigrationsData(client, {
    migrationsFolder: drizzleFolder,
  });

  assert.equal(result.items.length, plan.length);
  assert.equal(result.overview.totalMigrations, plan.length);
  assert.equal(result.overview.appliedMigrations, 10);
  assert.equal(result.overview.pendingMigrations, plan.length - 10);
  assert.equal(result.overview.isUpToDate, false);
  assert.equal(result.overview.status, "pending");

  // Periksa item pertama (applied)
  const first = result.items[0];
  assert.equal(first.idx, 0);
  assert.equal(first.status, "applied");
  assert.ok(first.appliedAt.length > 0);

  // Periksa item ke-11 (pending)
  const pendingItem = result.items[10];
  assert.equal(pendingItem.idx, 10);
  assert.equal(pendingItem.status, "pending");
  assert.equal(pendingItem.appliedAt, "");
});

test("API: GET /api/migrations menolak anonim 401", async () => {
  const { GET } = await import("../src/app/api/migrations/route.ts");
  const req = new Request("http://localhost:3101/api/migrations");
  const res = await GET(req);
  assert.equal(res.status, 401);
});

test("galat & remediation: deriveRemediationHint mendeteksi konteks galat PostgreSQL", () => {
  assert.match(
    deriveRemediationHint("duplicate key value violates unique constraint"),
    /duplikasi data/,
  );
  assert.match(deriveRemediationHint("relation already exists"), /sudah ada/);
  assert.match(deriveRemediationHint("relation does not exist"), /belum ada/);
  assert.match(
    deriveRemediationHint("violates foreign key constraint"),
    /foreign key/,
  );
  assert.match(deriveRemediationHint("syntax error at or near"), /sintaks SQL/);
  assert.match(deriveRemediationHint("deadlock detected"), /lock contention/);
  assert.match(
    deriveRemediationHint("unknown unclassified error"),
    /log PostgreSQL/,
  );
});

test("galat & remediation: recordMigrationFailure dan getLatestMigrationFailure mencatat dan membersihkan galat", async () => {
  const failures = [];
  const client = {
    async query(sql, params) {
      if (sql.startsWith("INSERT INTO")) {
        failures.push({
          id: failures.length + 1,
          tag: params[0],
          statement_index: params[1],
          failed_statement: params[2],
          error_message: params[3],
          remediation_hint: params[4],
          rollback_executed: params[5],
          resolved: false,
        });
        return { rows: [] };
      }
      if (sql.includes("UPDATE")) {
        for (const f of failures) f.resolved = true;
        return { rows: [] };
      }
      if (sql.includes("WHERE resolved = false")) {
        const active = failures.filter((f) => !f.resolved);
        return { rows: active.slice(-1) };
      }
      return { rows: [] };
    },
  };

  const err = new MigrationExecutionError(
    "0015_broken_constraint",
    0,
    "ALTER TABLE customers ADD CONSTRAINT unique_phone UNIQUE (phone)",
    new Error("duplicate key value violates unique constraint"),
  );

  assert.equal(err.rollbackExecuted, true);
  assert.match(err.remediationHint, /duplikasi data/);
  assert.match(err.message, /Rollback: berhasil/);

  await recordMigrationFailure(client, err);
  assert.equal(failures.length, 1);

  const latest = await getLatestMigrationFailure(client);
  assert.ok(latest);
  assert.equal(latest.tag, "0015_broken_constraint");
  assert.match(latest.error, /duplicate key/);
  assert.match(latest.remediationHint, /duplikasi data/);

  await clearResolvedMigrationFailures(client);
  const cleared = await getLatestMigrationFailure(client);
  assert.equal(cleared, null);
});
