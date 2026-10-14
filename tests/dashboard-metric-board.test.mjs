import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  generateMockDashboardMetrics,
  computeMetricsFromStore,
  isMetricBoardMockActive,
  DASHBOARD_METRICS_MOCK_ENTRY,
} = await import("../src/lib/dashboard/metric-board-data.ts");
const { SETUP_DATA_SOURCE_REGISTRY } = await import(
  "../src/lib/dashboard/setup-extended.ts"
);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("generateMockDashboardMetrics: valid dan konsisten di banyak waktu", () => {
  for (let i = 0; i < 500; i++) {
    const now = new Date(1_700_000_000_000 + i * 97_000);
    const m = generateMockDashboardMetrics(now);
    assert.equal(m.sourceStatus, "dummy");
    assert.equal(m.totalCustomers, m.onlineCount + m.offlineCount);
    assert.ok(m.percentOnline >= 0 && m.percentOnline <= 100);
    assert.ok(m.activeRouterCount <= m.totalRouters);
    assert.equal(m.activeAlertsCount, m.criticalAlertsCount + m.warningAlertsCount);
    assert.equal(m.totalCustomers, m.billingPaidCount + m.billingIsolatedCount);
    assert.ok(m.criticalSignalCount <= m.weakSignalCount);
    assert.ok(m.routerCpuAverage >= 0 && m.routerCpuAverage <= 100);
    assert.equal(m.generatedAt, now.toISOString());
  }
  const t = new Date(1_700_000_000_000);
  assert.deepEqual(
    generateMockDashboardMetrics(t),
    generateMockDashboardMetrics(new Date(t)),
  );
});

test("computeMetricsFromStore: hitungan akurat", () => {
  const customers = [
    { isOnline: true, opticalPowerDbm: -20, billingStatus: "lunas" },
    { isOnline: true, opticalPowerDbm: -26, billingStatus: "lunas" },
    { isOnline: true, opticalPowerDbm: -29, billingStatus: "isolir" },
    { isOnline: false, opticalPowerDbm: -40, billingStatus: "isolir" },
  ];
  const routers = [
    { active: true, cpuPercent: 10 },
    { active: true, cpuPercent: 30 },
    { active: false },
  ];
  const m = computeMetricsFromStore({
    customers,
    routers,
    traffic: { rx: [1, 2, 120.46], tx: [5, 60.04] },
    alertStore: {
      active: [
        { severity: "critical" },
        { severity: "warning" },
        { severity: "warning" },
        { severity: "info" },
      ],
    },
    now: new Date(0),
  });
  assert.equal(m.onlineCount, 3);
  assert.equal(m.offlineCount, 1);
  assert.equal(m.totalCustomers, 4);
  assert.equal(m.percentOnline, 75);
  assert.equal(m.weakSignalCount, 2);
  assert.equal(m.criticalSignalCount, 1);
  assert.equal(m.activeRouterCount, 2);
  assert.equal(m.totalRouters, 3);
  assert.equal(m.routerCpuAverage, 20);
  assert.equal(m.totalBandwidthInMbps, 120.5);
  assert.equal(m.totalBandwidthOutMbps, 60);
  assert.equal(m.activeAlertsCount, 4);
  assert.equal(m.criticalAlertsCount, 1);
  assert.equal(m.warningAlertsCount, 2);
  assert.equal(m.billingPaidCount, 2);
  assert.equal(m.billingIsolatedCount, 2);
  assert.equal(m.sourceStatus, "dummy");
  assert.equal(m.generatedAt, "1970-01-01T00:00:00.000Z");
});

test("computeMetricsFromStore: kosong -> tiruan; alert belum tiba -> 0", () => {
  const empty = computeMetricsFromStore({ customers: [], routers: [] });
  assert.equal(empty.sourceStatus, "dummy");
  assert.ok(empty.totalCustomers > 0);

  const m = computeMetricsFromStore({
    customers: [{ isOnline: true, opticalPowerDbm: -20, billingStatus: "lunas" }],
    routers: [],
    alertStore: { active: null },
    sourceStatus: "nyata",
  });
  assert.equal(m.activeAlertsCount, 0);
  assert.equal(m.routerCpuAverage, 0);
  assert.equal(m.sourceStatus, "nyata");
});

test("DASHBOARD_METRICS_MOCK_ENTRY tercatat untuk pembersihan Fase 5", () => {
  assert.equal(DASHBOARD_METRICS_MOCK_ENTRY.id, "dashboard-kpi-metrics");
  assert.equal(DASHBOARD_METRICS_MOCK_ENTRY.status, "dummy");
  assert.match(DASHBOARD_METRICS_MOCK_ENTRY.notes, /Fase 5/);
});

test("SETUP_DATA_SOURCE_REGISTRY memuat dashboard-kpi-metrics", () => {
  const entry = SETUP_DATA_SOURCE_REGISTRY.find(
    (e) => e.id === "dashboard-kpi-metrics",
  );
  assert.ok(entry);
  assert.deepEqual(entry, DASHBOARD_METRICS_MOCK_ENTRY);
});

test("isMetricBoardMockActive", () => {
  assert.equal(isMetricBoardMockActive("dummy"), true);
  assert.equal(isMetricBoardMockActive("nyata"), false);
  assert.equal(isMetricBoardMockActive(), false);
});

test("DashboardMetricBoard diekspor dan dipasang di dashboard", () => {
  const src = read("../src/components/dashboard/dashboard-metric-board.tsx");
  assert.match(src, /^"use client";/);
  assert.match(src, /export function DashboardMetricBoard/);
  assert.match(src, /aria-label="Ringkasan jaringan"/);
  assert.match(src, /data-testid="metric-mock-badge"/);
  assert.match(src, /Data Tiruan \(Fase 2\)/);
  for (const t of [
    "Pelanggan online",
    "Pelanggan offline",
    "Sinyal optik lemah",
    "Router aktif",
  ]) {
    assert.ok(src.includes(`label="${t}"`), t);
  }
  const page = read("../src/app/(protected)/app/page.tsx");
  assert.match(page, /<DashboardMetricBoard \/>/);
});
