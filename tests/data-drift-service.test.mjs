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

const { computeTableChecksum, detectEnvironmentDataDrift } = await import(
  "../src/services/data-drift.service.ts"
);

test("computeTableChecksum menghasilkan hash sha256 konsisten", () => {
  const sum1 = computeTableChecksum([{ id: 1, name: "Router A" }]);
  const sum2 = computeTableChecksum([{ id: 1, name: "Router A" }]);
  assert.ok(sum1.startsWith("sha256-"));
  assert.equal(sum1, sum2);

  const empty = computeTableChecksum([]);
  assert.equal(empty, "sha256-empty");
});

test("detectEnvironmentDataDrift menangani database yang tidak terjangkau tanpa crash", async () => {
  const report = await detectEnvironmentDataDrift({
    sourceDatabaseUrl: "postgresql://x:x@127.0.0.1:1/x",
    targetDatabaseUrl: "",
    tables: ["routers", "olts"],
  });
  assert.equal(report.sourceReachable, false);
  assert.equal(report.driftStatus, "source_unreachable");
  assert.equal(report.recommendation, "check_source");
  assert.equal(report.tables.length, 2);
  assert.equal(report.tables[0].table, "routers");
  assert.equal(report.tables[0].status, "unverified");
  assert.ok(report.checkedAt);
  assert.ok(report.durationMs >= 0);
});
