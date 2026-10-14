import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  loadMigrationPlan,
  getMigrationStatus,
  migrateServerWithRetry,
} from "../scripts/migrate-server.mjs";

const folder = resolve(import.meta.dirname, "..", "drizzle");

function statusClient({ rows = [], tableExists = true } = {}) {
  return {
    async query(sql) {
      if (sql.includes("to_regclass")) return { rows: [{ exists: tableExists }] };
      if (sql.startsWith("SELECT id, hash, created_at")) return { rows };
      return { rows: [] };
    },
  };
}

const appliedRows = (plan) =>
  plan.map((m, i) => ({ id: i + 1, hash: m.hash, created_at: String(m.folderMillis) }));

test("status: tabel pelacak belum ada", async () => {
  const s = await getMigrationStatus(statusClient({ tableExists: false }), { migrationsFolder: folder });
  assert.equal(s.trackerExists, false);
  assert.equal(s.appliedCount, 0);
  assert.equal(s.pendingCount, 15);
  assert.equal(s.totalCount, 15);
  assert.equal(s.isUpToDate, false);
  assert.equal(s.lastAppliedAt, null);
});

test("status: up-to-date", async () => {
  const plan = await loadMigrationPlan(folder);
  const s = await getMigrationStatus(statusClient({ rows: appliedRows(plan) }), { migrationsFolder: folder });
  assert.equal(s.appliedCount, 15);
  assert.equal(s.pendingCount, 0);
  assert.equal(s.isUpToDate, true);
  assert.equal(s.hashValid, true);
  assert.deepEqual(s.hashMismatches, []);
  assert.equal(s.lastAppliedAt, new Date(plan.at(-1).folderMillis).toISOString());
});

test("status: hash tidak cocok terdeteksi", async () => {
  const plan = await loadMigrationPlan(folder);
  const rows = appliedRows(plan);
  rows[3].hash = "deadbeef";
  const s = await getMigrationStatus(statusClient({ rows }), { migrationsFolder: folder });
  assert.equal(s.hashValid, false);
  assert.equal(s.hashMismatches.length, 1);
  assert.equal(s.hashMismatches[0].tag, plan[3].tag);
  assert.equal(s.hashMismatches[0].actual, "deadbeef");
  assert.equal(s.hashMismatches[0].expected, plan[3].hash);
});

/** migrateServer palsu lewat client: gagal di BEGIN sebanyak `failures` kali. */
function flakyClient(failures) {
  let left = failures;
  return {
    async query(sql) {
      if (sql.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (sql.startsWith("SELECT id, hash, created_at")) return { rows: [] };
      if (sql.startsWith("SELECT pg_advisory_lock") && left > 0) {
        left--;
        throw new Error("koneksi putus");
      }
      return { rows: [] };
    },
  };
}

test("retry: sukses percobaan pertama tanpa delay", async () => {
  const delays = [];
  const logs = [];
  const r = await migrateServerWithRetry(flakyClient(0), {
    migrationsFolder: folder,
    logger: (l) => logs.push(l),
    sleepFn: async (ms) => delays.push(ms),
  });
  assert.equal(r.dryRun, false);
  assert.deepEqual(delays, []);
  assert.ok(!logs.some((l) => l.includes("[RETRY")));
});

test("retry: gagal 2x lalu sukses dengan backoff 1s,2s", async () => {
  const delays = [];
  const logs = [];
  const r = await migrateServerWithRetry(flakyClient(2), {
    migrationsFolder: folder,
    logger: (l) => logs.push(l),
    sleepFn: async (ms) => delays.push(ms),
  });
  assert.equal(r.applied.length, 15);
  assert.deepEqual(delays, [1000, 2000]);
  assert.ok(logs.includes("[RETRY 1/3] Gagal (koneksi putus), coba lagi dalam 1000ms"));
  assert.ok(logs.includes("[RETRY 2/3] Gagal (koneksi putus), coba lagi dalam 2000ms"));
});

test("retry: habis percobaan melempar error terakhir", async () => {
  const delays = [];
  await assert.rejects(
    migrateServerWithRetry(flakyClient(99), {
      migrationsFolder: folder,
      logger: () => {},
      sleepFn: async (ms) => delays.push(ms),
    }),
    /koneksi putus/,
  );
  assert.deepEqual(delays, [1000, 2000]);
});
