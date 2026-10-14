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

const { createPortableBackupPackage } = await import(
  "../src/services/portable-backup.service.ts"
);
const { checkRestoreEligibility, executeBackupPackageRestore } = await import(
  "../src/services/backup-restore.service.ts"
);

test("checkRestoreEligibility memvalidasi paket cadangan utuh", async () => {
  const pkg = await createPortableBackupPackage({
    customPayload: {
      alert_thresholds: [{ id: "t1", metric: "cpu", threshold: 85 }],
    },
  });

  const check = checkRestoreEligibility(pkg);
  assert.equal(check.eligible, true);
  assert.equal(check.totalRecords, 1);
  assert.equal(check.tableCount, 1);
});

test("checkRestoreEligibility menolak paket kosong atau rusak", () => {
  const emptyPkg = {
    manifest: {
      formatVersion: "1.0.0",
      packageId: "empty",
      label: "Empty",
      type: "full",
      createdAt: new Date().toISOString(),
      databaseEngine: "postgresql",
      appVersion: "0.1.0",
      tablesIncluded: [],
      recordCounts: {},
      totalRecords: 0,
      dataPayloadChecksum: "abc",
    },
    payload: {},
  };

  const check = checkRestoreEligibility(emptyPkg);
  assert.equal(check.eligible, false);
  assert.ok(check.reasons.some((r) => r.includes("tidak memuat tabel") || r.includes("rusak")));
});

test("executeBackupPackageRestore dry-run mensimulasikan pemulihan dengan benar", async () => {
  const pkg = await createPortableBackupPackage({
    customPayload: {
      routers: [
        { id: "r1", name: "Core 1" },
        { id: "r2", name: "Core 2" },
      ],
      alert_thresholds: [{ id: "t1", threshold: 90 }],
    },
  });

  const report = await executeBackupPackageRestore(pkg, {
    dryRun: true,
    mode: "upsert",
  });

  assert.equal(report.success, true);
  assert.equal(report.dryRun, true);
  assert.equal(report.mode, "upsert");
  assert.equal(report.totalRecordsRestored, 3);
  assert.equal(report.restoredTables.length, 2);
  assert.ok(report.restoredTables.includes("routers"));
  assert.ok(report.restoredTables.includes("alert_thresholds"));
  assert.ok(report.message.includes("Dry-run berhasil"));
});

test("executeBackupPackageRestore menghormati filter targetTables", async () => {
  const pkg = await createPortableBackupPackage({
    customPayload: {
      routers: [{ id: "r1", name: "Core 1" }],
      alert_thresholds: [{ id: "t1", threshold: 90 }],
    },
  });

  const report = await executeBackupPackageRestore(pkg, {
    dryRun: true,
    targetTables: ["routers"],
  });

  assert.equal(report.success, true);
  assert.equal(report.totalRecordsRestored, 1);
  assert.deepEqual(report.restoredTables, ["routers"]);
  assert.deepEqual(report.skippedTables, ["alert_thresholds"]);
});
