import test from "node:test";
import assert from "node:assert/strict";

const {
  MOCK_HEALTH_CHECKS,
  MOCK_BACKUP_SNAPSHOTS,
  MOCK_PREFLIGHT_CHECKS,
  getMockDeploySafetyOverview,
  formatBytes,
  DEPLOY_SAFETY_MOCK_ENTRY,
} = await import("../src/lib/dashboard/deploy-safety.ts");

const { SETUP_DATA_SOURCE_REGISTRY } =
  await import("../src/lib/dashboard/setup-extended.ts");

test("DEPLOY_SAFETY_MOCK_ENTRY terdaftar di SETUP_DATA_SOURCE_REGISTRY", () => {
  const found = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "deploy-safety-status",
  );
  assert.ok(found, "deploy-safety-status harus ada di registry");
  assert.equal(found.status, "dummy");
});

test("formatBytes mengonversi ukuran dengan benar", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(15420000), "14.7 MB");
});

test("getMockDeploySafetyOverview menghasilkan skor dan status valid", () => {
  const overview = getMockDeploySafetyOverview();
  assert.equal(overview.overallStatus, "ready_to_deploy");
  assert.equal(overview.healthScorePercent, 100);
  assert.equal(overview.totalChecks, MOCK_HEALTH_CHECKS.length);
  assert.equal(overview.activeSnapshotsCount, MOCK_BACKUP_SNAPSHOTS.length);
  assert.equal(overview.rollbackReady, true);
});

test("MOCK_PREFLIGHT_CHECKS memuat pemeriksaan kritis wajib", () => {
  const criticals = MOCK_PREFLIGHT_CHECKS.filter(
    (c) => c.severity === "critical",
  );
  assert.ok(criticals.length >= 2);
  assert.ok(criticals.every((c) => c.passed));
});
