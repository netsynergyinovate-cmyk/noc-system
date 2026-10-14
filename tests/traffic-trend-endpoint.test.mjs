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

const { parseTrafficTrendQuery, trafficRangeSchema } = await import(
  "../src/validators/traffic.ts"
);
const { getTrafficTrendData } = await import(
  "../src/services/traffic.service.ts"
);
const routeTrend = await import("../src/app/api/traffic/trend/route.ts");
const routeTraffic = await import("../src/app/api/traffic/route.ts");

test("validator: parseTrafficTrendQuery default range 24h", () => {
  const q = parseTrafficTrendQuery(new URLSearchParams());
  assert.equal(q.range, "24h");
  assert.equal(q.routerId, undefined);
  assert.equal(q.now, undefined);
});

test("validator: parseTrafficTrendQuery validasi range dan uuid", () => {
  const p1 = new URLSearchParams({ range: "1h", now: "1700000000" });
  const q1 = parseTrafficTrendQuery(p1);
  assert.equal(q1.range, "1h");
  assert.equal(q1.now, 1700000000);

  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const p2 = new URLSearchParams({ routerId: uuid });
  const q2 = parseTrafficTrendQuery(p2);
  assert.equal(q2.routerId, uuid);

  assert.throws(() => parseTrafficTrendQuery(new URLSearchParams({ range: "bad" })));
  assert.throws(() => parseTrafficTrendQuery(new URLSearchParams({ routerId: "not-uuid" })));
});

test("getTrafficTrendData: mengembalikan series, overview, dan interfaces", async () => {
  const res = await getTrafficTrendData({ range: "1h", now: 1_700_000_000 });
  assert.ok(res);
  assert.ok(Array.isArray(res.series));
  assert.ok(res.series.length > 0);
  assert.equal(res.overview.range, "1h");
  assert.ok(Array.isArray(res.interfaces));
  assert.ok(["nyata", "dummy"].includes(res.sourceStatus));

  const pt = res.series[0];
  assert.equal(typeof pt.timestamp, "number");
  assert.equal(typeof pt.downloadMbps, "number");
  assert.equal(typeof pt.uploadMbps, "number");
  assert.equal(typeof pt.totalMbps, "number");
  assert.equal(typeof pt.peakMbps, "number");
});

test("route exports GET handler", () => {
  assert.equal(typeof routeTrend.GET, "function");
  assert.equal(typeof routeTraffic.GET, "function");
});
