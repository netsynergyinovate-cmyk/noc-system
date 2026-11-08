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
  getAnomalyById,
  createAnomaly,
  resolveAnomaly,
  updateAnomalyStatus,
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

  assert.throws(() =>
    parseAnomalyQuery(new URLSearchParams({ status: "invalid" })),
  );
  assert.throws(() =>
    parseAnomalyQuery(new URLSearchParams({ kind: "invalid" })),
  );
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

const withDb = process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-");

test(
  "Postgres: createAnomaly -> active list -> resolveAnomaly -> status resolved dan endedAt",
  { skip: !withDb && "jalankan lewat npm test" },
  async () => {
    const prev = process.env.DASHBOARD_DATA;
    process.env.DASHBOARD_DATA = "live";
    try {
      const { db } = await import("../src/db/index.ts");
      const { routers } = await import("../src/db/schema/index.ts");
      const { randomBytes } = await import("node:crypto");

      const suffix = randomBytes(4).toString("hex");
      const [router] = await db
        .insert(routers)
        .values({
          name: `r-test-${suffix}`,
          host: `10.99.1.${Number.parseInt(suffix.slice(0, 2), 16)}`,
          username: "api",
          passwordEnc: "iv:tag:rahasia",
        })
        .returning();

      // 1. Cek filter kosong mengembalikan array kosong dan sourceStatus nyata
      const emptyList = await getAnomaliesList({
        status: "active",
        routerId: router.id,
        limit: 10,
        offset: 0,
      });
      assert.deepEqual(emptyList.anomalies, []);
      assert.equal(emptyList.total, 0);
      assert.equal(emptyList.sourceStatus, "nyata");

      // 2. createAnomaly menulis ke alerts
      const created = await createAnomaly({
        routerId: router.id,
        type: "cpu",
        severity: "warning",
        measured: 85,
      });
      assert.ok(created.id);
      assert.equal(created.routerId, router.id);
      assert.equal(created.kind, "cpu");
      assert.equal(created.endedAt, null);

      // 3. getAnomaliesList harus memuat item ini
      const list = await getAnomaliesList({
        status: "active",
        routerId: router.id,
        limit: 10,
        offset: 0,
      });
      assert.equal(list.total, 1);
      assert.equal(list.activeCount, 1);
      assert.equal(list.sourceStatus, "nyata");
      assert.equal(list.anomalies[0].id, created.id);

      // 4. resolveAnomaly
      const resolved = await resolveAnomaly(created.id);
      assert.ok(resolved);
      assert.ok(resolved.endedAt);

      // 5. Cek detail anomali dari DB
      const detail = await getAnomalyById(created.id);
      assert.equal(detail.anomaly.id, created.id);
      assert.ok(detail.anomaly.endedAt);
      assert.equal(detail.sourceStatus, "nyata");

      // 6. Cek list active sekarang kosong untuk router ini
      const afterResolve = await getAnomaliesList({
        status: "active",
        routerId: router.id,
        limit: 10,
        offset: 0,
      });
      assert.equal(afterResolve.activeCount, 0);
      assert.equal(afterResolve.anomalies.length, 0);
    } finally {
      process.env.DASHBOARD_DATA = prev;
    }
  },
);
