import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const {
  parseAnomalyQuery,
  createAnomalyInputSchema,
  detectAnomaliesQuerySchema,
} = await import("../src/validators/anomalies.ts");

const {
  getAnomaliesList,
  detectAnomalies,
} = await import("../src/services/anomalies.service.ts");

const routeAnomalies = await import("../src/app/api/anomalies/route.ts");
const routeDetect = await import("../src/app/api/anomalies/detect/route.ts");

test("validator: parseAnomalyQuery default dan filter", () => {
  const def = parseAnomalyQuery(new URLSearchParams());
  assert.equal(def.status, "all");
  assert.equal(def.limit, 50);
  assert.equal(def.offset, 0);

  const filtered = parseAnomalyQuery(
    new URLSearchParams({
      status: "active",
      kind: "cpu",
      severity: "critical",
      limit: "10",
      offset: "5",
    }),
  );
  assert.equal(filtered.status, "active");
  assert.equal(filtered.kind, "cpu");
  assert.equal(filtered.severity, "critical");
  assert.equal(filtered.limit, 10);
  assert.equal(filtered.offset, 5);

  assert.throws(() => parseAnomalyQuery(new URLSearchParams({ status: "invalid" })));
  assert.throws(() => parseAnomalyQuery(new URLSearchParams({ kind: "invalid" })));
});

test("validator: createAnomalyInputSchema validasi field", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const valid = createAnomalyInputSchema.parse({
    routerId: uuid,
    type: "cpu",
    severity: "warning",
    measured: 88,
  });
  assert.equal(valid.routerId, uuid);
  assert.equal(valid.type, "cpu");
  assert.equal(valid.measured, 88);

  assert.throws(() =>
    createAnomalyInputSchema.parse({
      routerId: "bukan-uuid",
      type: "cpu",
    }),
  );
});

test("getAnomaliesList: mengembalikan daftar anomali dan aturan", async () => {
  const res = await getAnomaliesList({ status: "all", limit: 10, offset: 0 });
  assert.ok(res);
  assert.ok(Array.isArray(res.anomalies));
  assert.ok(res.anomalies.length <= 10);
  assert.ok(Array.isArray(res.rules));
  assert.equal(res.rules.length, 5);
  assert.equal(typeof res.total, "number");
  assert.equal(typeof res.activeCount, "number");
  assert.equal(typeof res.resolvedCount, "number");
  assert.ok(["nyata", "dummy"].includes(res.sourceStatus));

  if (res.anomalies.length > 0) {
    const item = res.anomalies[0];
    assert.ok(item.id);
    assert.ok(item.kind);
    assert.ok(item.severity);
    assert.equal(typeof item.startedAt, "number");
    assert.ok(item.rootSource);
  }
});

test("detectAnomalies: mengevaluasi aturan anomali", async () => {
  const res = await detectAnomalies();
  assert.ok(res);
  assert.equal(typeof res.detected, "number");
  assert.equal(typeof res.rulesEvaluated, "number");
  assert.ok(Array.isArray(res.activeAnomalies));
});

test("route exports handler methods", () => {
  assert.equal(typeof routeAnomalies.GET, "function");
  assert.equal(typeof routeAnomalies.POST, "function");
  assert.equal(typeof routeDetect.GET, "function");
  assert.equal(typeof routeDetect.POST, "function");
});
