import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const {
  AUTO_ALIGNMENT_MOCK_ENTRY,
  getMockAlignmentJobs,
  getMockAlignmentOverview,
} = await import("../src/lib/dashboard/auto-alignment.ts");

const { SETUP_DATA_SOURCE_REGISTRY } = await import(
  "../src/lib/dashboard/setup-extended.ts"
);

test("AUTO_ALIGNMENT_MOCK_ENTRY terdaftar di SETUP_DATA_SOURCE_REGISTRY", () => {
  assert.equal(AUTO_ALIGNMENT_MOCK_ENTRY.id, "auto-alignment-status");
  assert.equal(AUTO_ALIGNMENT_MOCK_ENTRY.status, "dummy");
  assert.equal(AUTO_ALIGNMENT_MOCK_ENTRY.envKey, "SCHEDULER_ENABLED");
  assert.match(AUTO_ALIGNMENT_MOCK_ENTRY.notes, /Fase 5/);

  const found = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "auto-alignment-status",
  );
  assert.ok(found, "Entry harus ditemukan di SETUP_DATA_SOURCE_REGISTRY");
  assert.deepEqual(found, AUTO_ALIGNMENT_MOCK_ENTRY);
});

test("getMockAlignmentJobs memuat 5 background jobs esensial", () => {
  const jobs = getMockAlignmentJobs();
  assert.equal(jobs.length, 5);

  const expectedIds = [
    "align-mikrotik-telemetry",
    "align-olt-optical",
    "align-billing-status",
    "align-anomaly-detector",
    "align-log-cleanup",
  ];

  for (const id of expectedIds) {
    const job = jobs.find((j) => j.id === id);
    assert.ok(job, `Job ${id} harus terdaftar`);
    assert.ok(job.name.length > 0);
    assert.ok(job.targetService.length > 0);
    assert.ok(job.intervalSeconds > 0);
    assert.equal(job.status, "healthy");
    assert.equal(job.enabled, true);
    assert.ok(job.consecutiveSuccesses > 0);
  }
});

test("getMockAlignmentOverview menghitung status daemon dan metrik", () => {
  const jobs = getMockAlignmentJobs();
  const overview = getMockAlignmentOverview(jobs);

  assert.equal(overview.schedulerStatus, "running");
  assert.equal(overview.activeWorkers, 4);
  assert.equal(overview.totalJobs, 5);
  assert.equal(overview.enabledJobs, 5);
  assert.equal(overview.healthyJobs, 5);
  assert.equal(overview.failingJobs, 0);
  assert.equal(overview.backoffModeActive, false);
  assert.ok(overview.lastGlobalTickAt);
});

test("komponen AutoAlignmentStatus dan tab terpasang pada halaman sinkronisasi", () => {
  const compPath = new URL(
    "../src/components/dashboard/auto-alignment-status.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(compPath));
  const compSrc = readFileSync(compPath, "utf8");
  assert.match(compSrc, /export function AutoAlignmentStatus/);
  assert.match(compSrc, /data-testid="auto-alignment-status"/);

  const pagePath = new URL(
    "../src/app/(protected)/app/sinkronisasi/page.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(pagePath));
  const pageSrc = readFileSync(pagePath, "utf8");
  assert.match(pageSrc, /<AutoAlignmentStatus \/>/);
  assert.match(pageSrc, /Penyelarasan Otomatis/);
});
