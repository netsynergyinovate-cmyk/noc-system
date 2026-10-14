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
  createPortableBackupPackage,
  verifyPortableBackupPackage,
  exportPortableBackupJson,
  importPortableBackupPackage,
  restorePortableBackupPackage,
} = await import("../src/services/portable-backup.service.ts");

test("createPortableBackupPackage membuat paket cadangan dengan manifest valid", async () => {
  const dummyData = {
    alert_thresholds: [
      { id: "1", metric: "cpu", threshold: 80 },
      { id: "2", metric: "ram", threshold: 85 },
    ],
    routers: [{ id: "r1", name: "Core-Mikrotik", ip: "192.168.88.1" }],
  };

  const pkg = await createPortableBackupPackage({
    type: "config_only",
    label: "Uji Cadangan",
    customPayload: dummyData,
  });

  assert.equal(pkg.manifest.formatVersion, "1.0.0");
  assert.equal(pkg.manifest.type, "config_only");
  assert.equal(pkg.manifest.label, "Uji Cadangan");
  assert.equal(pkg.manifest.totalRecords, 3);
  assert.equal(pkg.manifest.recordCounts.alert_thresholds, 2);
  assert.equal(pkg.manifest.recordCounts.routers, 1);
  assert.ok(pkg.manifest.dataPayloadChecksum.length === 64);
});

test("verifyPortableBackupPackage memverifikasi keutuhan payload dan checksum", async () => {
  const pkg = await createPortableBackupPackage({
    customPayload: {
      notes: [{ id: "n1", title: "Test Note" }],
    },
  });

  const validRes = verifyPortableBackupPackage(pkg);
  assert.equal(validRes.valid, true);

  // Rusak payload untuk memastikan verifikasi mendeteksi perubahan
  const tampered = JSON.parse(JSON.stringify(pkg));
  tampered.payload.notes[0].title = "Tampered Note!";
  const invalidRes = verifyPortableBackupPackage(tampered);
  assert.equal(invalidRes.valid, false);
  assert.ok(invalidRes.discrepancies?.some((d) => d.includes("Checksum")));
});

test("exportPortableBackupJson dan importPortableBackupPackage bekerja timbal-balik (round-trip)", async () => {
  const originalPkg = await createPortableBackupPackage({
    type: "full",
    label: "Export-Import Test",
    customPayload: {
      schema_migrations: [{ version: "0001_init", applied_at: "2026-10-13" }],
    },
  });

  const jsonStr = exportPortableBackupJson(originalPkg);
  assert.ok(typeof jsonStr === "string");

  const importedPkg = importPortableBackupPackage(jsonStr);
  assert.equal(importedPkg.manifest.packageId, originalPkg.manifest.packageId);
  assert.equal(
    importedPkg.manifest.dataPayloadChecksum,
    originalPkg.manifest.dataPayloadChecksum,
  );
  assert.deepEqual(importedPkg.payload, originalPkg.payload);
});

test("restorePortableBackupPackage dengan dryRun mensimulasikan pemulihan tanpa error DB", async () => {
  const pkg = await createPortableBackupPackage({
    customPayload: {
      alert_thresholds: [{ id: "t1", val: 50 }],
    },
  });

  const result = await restorePortableBackupPackage(pkg, { dryRun: true });
  assert.equal(result.success, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.restoredRecordsCount, 1);
  assert.ok(result.restoredTables.includes("alert_thresholds"));
});
