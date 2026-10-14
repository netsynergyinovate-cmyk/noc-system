import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

register();

const {
  getRollbackHistoryEvents,
  recordMigrationRollbackEvent,
  runSafeMigrationWithRollback,
} = await import("../src/services/migration-rollback-runner.service.ts");

test("getRollbackHistoryEvents mengembalikan daftar peristiwa rollback terurut waktu", async () => {
  const events = await getRollbackHistoryEvents();
  assert.ok(events.length >= 3);
  assert.ok(events[0].id);
  assert.ok(events[0].migrationFile);
  assert.ok(events[0].reason);
  assert.ok(events[0].remediationHint);
});

test("recordMigrationRollbackEvent mencatat insiden rollback baru ke daftar", async () => {
  const newEvt = await recordMigrationRollbackEvent({
    migrationFile: "0015_test_failing.sql",
    targetVersion: "0014_previous_target",
    reason: "Uji coba insiden rollback otomatis",
    remediationHint: "Gunakan tipe varchar alih-alih char.",
    status: "success",
    affectedTables: ["customers"],
    durationMs: 120,
    actor: "system_safeguard",
    executedAt: new Date().toISOString(),
    revertStatementsCount: 1,
  });

  assert.ok(newEvt.id.startsWith("rb-"));
  assert.equal(newEvt.migrationFile, "0015_test_failing.sql");

  const list = await getRollbackHistoryEvents();
  assert.equal(list[0].id, newEvt.id);
});

test("runSafeMigrationWithRollback menangkap kegagalan dan mengeksekusi proteksi rollback otomatis", async () => {
  // Tanpa database aktif, runner otomatis memicu proteksi rollback dan mencatat insiden
  const res = await runSafeMigrationWithRollback({ dryRun: false });
  assert.equal(res.success, false);
  assert.equal(res.rollbackExecuted, true);
  assert.ok(res.rollbackEvent);
  assert.ok(res.error);
  assert.ok(res.remediationHint);
});
