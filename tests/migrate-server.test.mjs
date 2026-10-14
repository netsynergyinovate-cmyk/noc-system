import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  loadMigrationPlan,
  getPendingMigrations,
  migrateServer,
} from "../scripts/migrate-server.mjs";

const folder = resolve(import.meta.dirname, "..", "drizzle");
const quiet = () => {};

/** Client palsu: mencatat semua query; `failOn` memicu error bila SQL cocok. */
function fakeClient({ applied = [], failOn, tableExists = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push(sql.trim().split("\n")[0]);
      if (failOn && sql.includes(failOn)) throw new Error("boom");
      if (sql.includes("to_regclass('drizzle")) return { rows: [{ exists: tableExists }] };
      if (sql.startsWith("SELECT id, hash, created_at")) return { rows: applied };
      return { rows: [] };
    },
  };
}

test("loadMigrationPlan membaca 0000..0014 terurut dan memecah statement", async () => {
  const plan = await loadMigrationPlan(folder);
  assert.equal(plan.length, 15);
  assert.deepEqual(
    plan.map((m) => m.tag.slice(0, 4)),
    Array.from({ length: 15 }, (_, i) => String(i).padStart(4, "0")),
  );
  for (const m of plan) {
    assert.ok(m.statements.length > 0, m.tag);
    assert.ok(m.statements.every((s) => s && !s.includes("statement-breakpoint")), m.tag);
    assert.match(m.hash, /^[0-9a-f]{64}$/);
  }
  const millis = plan.map((m) => m.folderMillis);
  assert.deepEqual(millis, [...millis].sort((a, b) => a - b));
});

test("getPendingMigrations menghitung migrasi yang belum jalan", () => {
  const all = [0, 1, 2, 3].map((i) => ({ idx: i, folderMillis: 100 + i }));
  assert.equal(getPendingMigrations(all, []).length, 4);
  assert.deepEqual(
    getPendingMigrations(all, [{ created_at: "101" }, { created_at: 100 }]).map((m) => m.idx),
    [2, 3],
  );
  assert.equal(getPendingMigrations(all, [{ created_at: 103 }]).length, 0);
});

test("dry-run melaporkan pending tanpa mutasi atau lock", async () => {
  const c = fakeClient({ applied: [] });
  const logs = [];
  const r = await migrateServer(c, { dryRun: true, migrationsFolder: folder, logger: (l) => logs.push(l) });
  assert.equal(r.dryRun, true);
  assert.equal(r.pending.length, 15);
  assert.equal(r.applied.length, 0);
  assert.ok(logs[0].includes("15"));
  assert.ok(c.calls.every((q) => q.startsWith("SELECT")), c.calls.join("|"));
  assert.ok(!c.calls.some((q) => q.includes("advisory")));
});

test("dry-run tanpa tabel pelacak menganggap semua pending", async () => {
  const c = fakeClient({ tableExists: false });
  const r = await migrateServer(c, { dryRun: true, migrationsFolder: folder, logger: quiet });
  assert.equal(r.pending.length, 15);
});

test("eksekusi: lock -> transaksi per migrasi -> unlock", async () => {
  const plan = await loadMigrationPlan(folder);
  const c = fakeClient({ applied: [{ created_at: plan.at(-2).folderMillis }] });
  const logs = [];
  const r = await migrateServer(c, { migrationsFolder: folder, logger: (l) => logs.push(l) });
  assert.deepEqual(r.applied, [plan.at(-1).tag]);
  assert.equal(c.calls[0], "SELECT pg_advisory_lock($1)");
  assert.ok(c.calls.findIndex((q) => q.includes("pg_advisory_lock")) < c.calls.indexOf("BEGIN"));
  assert.equal(c.calls.at(-1), "SELECT pg_advisory_unlock($1)");
  assert.equal(c.calls.filter((q) => q === "BEGIN").length, 1);
  assert.equal(c.calls.filter((q) => q === "COMMIT").length, 1);
  assert.ok(c.calls.some((q) => q.startsWith("INSERT INTO")));
  assert.ok(logs.includes(`[START] ${plan.at(-1).tag}`));
  assert.ok(logs.includes(`[SUKSES] ${plan.at(-1).tag}`));
});

test("kegagalan SQL: ROLLBACK, tanpa COMMIT, lock dilepas, [GAGAL] dilog", async () => {
  const c = fakeClient({ failOn: "CREATE TABLE \"account\"" });
  const plan = await loadMigrationPlan(folder);
  const failing = plan[0].statements.find((s) => s.includes('CREATE TABLE "account"'));
  assert.ok(failing, "fixture: statement uji harus ada di migrasi 0000");
  const logs = [];
  await assert.rejects(
    migrateServer(c, { migrationsFolder: folder, logger: (l) => logs.push(l) }),
    /boom/,
  );
  assert.ok(c.calls.includes("ROLLBACK"));
  assert.ok(!c.calls.includes("COMMIT"));
  assert.equal(c.calls.at(-1), "SELECT pg_advisory_unlock($1)");
  assert.ok(logs.some((l) => l.startsWith(`[GAGAL] ${plan[0].tag}`)));
});

test("timescale=true memanggil setup TimescaleDB setelah migrasi", async () => {
  const plan = await loadMigrationPlan(folder);
  const c = fakeClient({ applied: [{ created_at: plan.at(-1).folderMillis }] });
  const r = await migrateServer(c, { timescale: true, migrationsFolder: folder, logger: quiet });
  assert.equal(r.applied.length, 0);
  assert.ok(c.calls.some((q) => q.includes("pg_available_extensions")));
  assert.equal(r.timescale.enabled, false); // fake: ekstensi tidak tersedia
  assert.equal(c.calls.at(-1), "SELECT pg_advisory_unlock($1)");
});
