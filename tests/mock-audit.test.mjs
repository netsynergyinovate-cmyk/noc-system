import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "tsx/esm/api";
import { auditMockUsage, mockAuditInventory } from "../src/lib/dashboard/stack-benchmark.ts";

register();
process.env.BENCHMARK_SECRET = "test-secret";
const { GET } = await import("../src/app/api/benchmark/mock-audit/route.ts");

const root = path.resolve(import.meta.dirname, "..");

test("audit: 5 komponen terpetakan lengkap", () => {
  const ids = mockAuditInventory.map((c) => c.id).sort();
  assert.deepEqual(ids, ["billing", "genieacs", "mikrotik", "olt", "realtime_hub"]);
  for (const c of mockAuditInventory) {
    assert.ok(c.realDrivers.length > 0, `${c.id} realDrivers`);
    assert.ok(c.mockFiles.length > 0, `${c.id} mockFiles`);
    assert.ok(c.promotionCriteria.length > 0, `${c.id} promotionCriteria`);
    assert.ok(c.envKeys.length > 0, `${c.id} envKeys`);
    assert.ok(c.simulatorSource.trim() && c.fallbackStrategy.trim());
  }
});

test("audit: semua path realDrivers, mockFiles, simulatorSource ada", () => {
  for (const c of mockAuditInventory) {
    for (const p of [...c.realDrivers, ...c.mockFiles, c.simulatorSource]) {
      assert.ok(fs.existsSync(path.join(root, p)), `${c.id}: ${p} tidak ada`);
    }
  }
});

test("audit: aturan plan ditegakkan, belum teruji tidak real/ready", () => {
  const report = auditMockUsage();
  assert.equal(report.ruleEnforced, true);
  assert.deepEqual(report.violations, []);
  for (const c of report.items) {
    if (c.verificationStatus === "untested") {
      assert.notEqual(c.currentSource, "real", c.id);
      assert.notEqual(c.promotionReadiness, "ready", c.id);
    }
  }
  assert.deepEqual(report.counts, { mock: 2, simulator: 1, real: 2 });
});

test("endpoint: 401 tanpa kunci, 200 dengan kunci", async () => {
  const url = "http://localhost/api/benchmark/mock-audit";
  assert.equal((await GET(new Request(url))).status, 401);
  assert.equal((await GET(new Request(url, { headers: { "x-benchmark-key": "salah" } }))).status, 401);
  const res = await GET(new Request(url, { headers: { "x-benchmark-key": "test-secret" } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ruleEnforced, true);
  assert.equal(body.items.length, 5);
});
