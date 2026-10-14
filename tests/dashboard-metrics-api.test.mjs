import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x"; // port tertutup
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { buildDashboardKpiMetrics } = await import(
  "../src/services/dashboard-metrics.service.ts"
);
const { GET } = await import("../src/app/api/dashboard/metrics/route.ts");
const { auth } = await import("../src/lib/auth.ts");

const agg = {
  customers: { total: 8, online: 6, weak: 2, critical: 1, paid: 5, isolated: 3 },
  routers: { total: 3, active: 2 },
  alerts: { active: 3, critical: 1, warning: 2 },
  traffic: [
    { rxMbps: 100.04, txMbps: 20.1 },
    { rxMbps: 50.02, txMbps: 10.1 },
  ],
  cpuLoads: [10, 21],
};

test("agregasi: pelanggan, billing, router, alert", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const m = buildDashboardKpiMetrics(agg, now);
  assert.equal(m.totalCustomers, 8);
  assert.equal(m.onlineCount, 6);
  assert.equal(m.offlineCount, 2);
  assert.equal(m.percentOnline, 75);
  assert.equal(m.weakSignalCount, 2);
  assert.equal(m.criticalSignalCount, 1);
  assert.equal(m.billingPaidCount, 5);
  assert.equal(m.billingIsolatedCount, 3);
  assert.equal(m.totalRouters, 3);
  assert.equal(m.activeRouterCount, 2);
  assert.equal(m.activeAlertsCount, 3);
  assert.equal(m.criticalAlertsCount, 1);
  assert.equal(m.warningAlertsCount, 2);
  assert.equal(m.totalBandwidthInMbps, 150.1);
  assert.equal(m.totalBandwidthOutMbps, 30.2);
  assert.equal(m.routerCpuAverage, 15.5);
  assert.equal(m.sourceStatus, "nyata");
  assert.equal(m.generatedAt, now.toISOString());
});

test("agregasi: data kosong -> semua 0, tanpa NaN", () => {
  const m = buildDashboardKpiMetrics({
    customers: { total: 0, online: 0, weak: 0, critical: 0, paid: 0, isolated: 0 },
    routers: { total: 0, active: 0 },
    alerts: { active: 0, critical: 0, warning: 0 },
    traffic: [],
    cpuLoads: [],
  });
  assert.equal(m.percentOnline, 0);
  assert.equal(m.routerCpuAverage, 0);
  assert.equal(m.totalBandwidthInMbps, 0);
  assert.equal(m.totalBandwidthOutMbps, 0);
});

test("GET tanpa sesi -> 401", async () => {
  const res = await GET(new Request("http://localhost:3101/api/dashboard/metrics"));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "UNAUTHORIZED");
});

test("GET dengan sesi valid -> 200 { data }", async () => {
  const original = auth.api.getSession;
  auth.api.getSession = async () => ({
    session: { id: "s1" },
    user: { id: "u1", role: "user" },
  });
  try {
    const res = await GET(new Request("http://localhost:3101/api/dashboard/metrics"));
    assert.equal(res.status, 200);
    const { data } = await res.json();
    for (const k of [
      "onlineCount",
      "offlineCount",
      "totalCustomers",
      "percentOnline",
      "weakSignalCount",
      "criticalSignalCount",
      "activeRouterCount",
      "totalRouters",
      "activeAlertsCount",
    ])
      assert.equal(typeof data[k], "number", k);
    assert.ok(["nyata", "dummy"].includes(data.sourceStatus));
    assert.ok(!Number.isNaN(Date.parse(data.generatedAt)));
    assert.equal(data.onlineCount + data.offlineCount, data.totalCustomers);
  } finally {
    auth.api.getSession = original;
  }
});
