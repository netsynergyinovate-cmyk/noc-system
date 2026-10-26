import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const {
  TRANSFER_STATUS_MOCK_ENTRY,
  getMockTransferJobs,
  getMockTransferOverview,
} = await import("../src/lib/dashboard/transfer-status.ts");

const { SETUP_DATA_SOURCE_REGISTRY } = await import(
  "../src/lib/dashboard/setup-extended.ts"
);

test("TRANSFER_STATUS_MOCK_ENTRY terdaftar di SETUP_DATA_SOURCE_REGISTRY", () => {
  assert.equal(TRANSFER_STATUS_MOCK_ENTRY.id, "local-to-server-transfer");
  assert.equal(TRANSFER_STATUS_MOCK_ENTRY.status, "dummy");
  assert.equal(TRANSFER_STATUS_MOCK_ENTRY.envKey, "TARGET_DATABASE_URL");
  assert.match(TRANSFER_STATUS_MOCK_ENTRY.notes, /Fase 5/);

  const found = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "local-to-server-transfer",
  );
  assert.ok(found, "Entry harus ditemukan di SETUP_DATA_SOURCE_REGISTRY");
  assert.deepEqual(found, TRANSFER_STATUS_MOCK_ENTRY);
});

test("getMockTransferJobs memuat 6 job transfer dengan detail lengkap", () => {
  const jobs = getMockTransferJobs();
  assert.equal(jobs.length, 6);

  const expectedEntities = [
    "routers",
    "olt_devices",
    "customers",
    "onu_mappings",
    "network_rules",
    "billing_invoices",
  ];

  for (const entity of expectedEntities) {
    const job = jobs.find((j) => j.entityName === entity);
    assert.ok(job, `Job untuk entity ${entity} harus ada`);
    assert.ok(job.name.length > 0);
    assert.ok(job.sourceTable.length > 0);
    assert.ok(job.targetTable.length > 0);
    assert.equal(job.status, "completed");
    assert.equal(job.checksumMatch, true);
    assert.ok(job.recordsTransferred > 0);
  }
});

test("getMockTransferOverview menghitung progres persentase dan ringkasan dengan benar", () => {
  const jobs = getMockTransferJobs();
  const overview = getMockTransferOverview(jobs);

  assert.equal(overview.totalJobs, 6);
  assert.equal(overview.completedJobs, 6);
  assert.equal(overview.failedJobs, 0);
  assert.equal(overview.overallProgressPercent, 100);
  assert.equal(overview.status, "success");
  assert.ok(overview.totalRecordsTransferred > 0);
  assert.equal(overview.totalRecordsTransferred, overview.totalRecordsTarget);
  assert.ok(overview.sourceEnvironment.includes("Docker"));
  assert.ok(overview.targetEnvironment.includes("Server Produksi"));
  assert.ok(overview.lastBatchRunAt);
});

test("komponen LocalToServerTransfer tersedia dan valid", () => {
  const compPath = new URL(
    "../src/components/dashboard/local-to-server-transfer.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(compPath));
  const compSrc = readFileSync(compPath, "utf8");
  assert.match(compSrc, /export function LocalToServerTransfer/);
  assert.match(compSrc, /data-testid="local-to-server-transfer"/);
});
