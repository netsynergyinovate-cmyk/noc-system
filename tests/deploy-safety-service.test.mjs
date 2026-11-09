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

const { getRealSystemHealthChecks, getRealDeploySafetyOverview } =
  await import("../src/services/deploy-safety.service.ts");

test("getRealSystemHealthChecks menghasilkan seluruh pemeriksaan sistem dasar", async () => {
  const checks = await getRealSystemHealthChecks();
  assert.ok(checks.length >= 4);

  const dbCheck = checks.find((c) => c.id === "check-postgresql");
  assert.ok(dbCheck);
  assert.equal(dbCheck.category, "database");
  assert.equal(dbCheck.requiredForDeploy, true);

  const migCheck = checks.find((c) => c.id === "check-migrations");
  assert.ok(migCheck);

  const memCheck = checks.find((c) => c.id === "check-disk-volume");
  assert.ok(memCheck);
  assert.equal(memCheck.status, "healthy");
});

test("getRealDeploySafetyOverview mengevaluasi skor kesehatan sistem", async () => {
  const overview = await getRealDeploySafetyOverview();
  assert.ok(overview.totalChecks > 0);
  assert.ok(
    overview.healthScorePercent >= 0 && overview.healthScorePercent <= 100,
  );
  assert.ok(overview.lastDeploymentAt);
});
