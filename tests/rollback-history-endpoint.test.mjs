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
} = await import("../src/services/migration-rollback-runner.service.ts");

test("Pencatatan kejadian rollback menyimpan field audit lengkap", async () => {
  const initial = await getRollbackHistoryEvents();
  const initialCount = initial.length;

  const event = await recordMigrationRollbackEvent({
    migrationFile: "0099_custom_rollback_test.sql",
    targetVersion: "0098_target_test",
    reason: "Pengujian integritas pencatatan riwayat rollback",
    remediationHint: "Perbaiki tipe kolom sebelum rilis.",
    status: "success",
    affectedTables: ["customers", "audit_log"],
    durationMs: 250,
    actor: "operator_test",
    executedAt: new Date().toISOString(),
    revertStatementsCount: 2,
  });

  assert.ok(event.id);
  assert.equal(event.migrationFile, "0099_custom_rollback_test.sql");
  assert.equal(event.targetVersion, "0098_target_test");
  assert.equal(event.actor, "operator_test");

  const updated = await getRollbackHistoryEvents();
  assert.equal(updated.length, initialCount + 1);
  assert.equal(updated[0].id, event.id);
});
