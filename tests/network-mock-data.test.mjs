import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  getMockNetworkOverview,
  getMockRouterItems,
  isNetworkMockActive,
  NETWORK_DATA_MOCK_ENTRY,
} = await import("../src/lib/dashboard/network-mock-data.ts");
const { SETUP_DATA_SOURCE_REGISTRY } = await import(
  "../src/lib/dashboard/setup-extended.ts"
);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("getMockNetworkOverview: total, aktif, offline, skor 0-100, dummy", () => {
  const o = getMockNetworkOverview();
  assert.equal(o.totalRouters, 6);
  assert.equal(o.activeRouters, 5);
  assert.equal(o.offlineRouters, 1);
  assert.equal(o.totalActivePppoe, 412 + 388 + 215 + 297 + 164);
  assert.equal(o.networkHealthScore, 75);
  assert.ok(o.networkHealthScore >= 0 && o.networkHealthScore <= 100);
  assert.equal(o.sourceStatus, "dummy");
  assert.ok(!Number.isNaN(Date.parse(o.lastScannedAt)));
});

test("getMockNetworkOverview: daftar kustom dan kosong", () => {
  const all = getMockNetworkOverview([{ status: "online" }, { status: "online" }]);
  assert.equal(all.networkHealthScore, 100);
  const none = getMockNetworkOverview([]);
  assert.equal(none.totalRouters, 0);
  assert.equal(none.networkHealthScore, 0);
});

test("getMockRouterItems: router realistis dan unik", () => {
  const items = getMockRouterItems();
  assert.ok(items.length >= 3);
  assert.equal(new Set(items.map((r) => r.id)).size, items.length);
  for (const r of items) {
    assert.ok(r.id && r.name && r.host && r.model && r.uptime);
    assert.ok(r.cpuPercent >= 0 && r.cpuPercent <= 100);
    assert.ok(r.memoryPercent >= 0 && r.memoryPercent <= 100);
    assert.ok(r.trafficInMbps >= 0 && r.trafficOutMbps >= 0);
    assert.ok(["online", "offline", "degraded"].includes(r.status));
  }
  items[0].name = "X";
  assert.notEqual(getMockRouterItems()[0].name, "X");
});

test("NETWORK_DATA_MOCK_ENTRY terdaftar di registry (8 entri)", () => {
  assert.equal(NETWORK_DATA_MOCK_ENTRY.id, "network-devices-overview");
  assert.equal(NETWORK_DATA_MOCK_ENTRY.status, "dummy");
  assert.match(NETWORK_DATA_MOCK_ENTRY.notes, /Fase 5/);
  const e = SETUP_DATA_SOURCE_REGISTRY.find((x) => x.id === "network-devices-overview");
  assert.deepEqual(e, NETWORK_DATA_MOCK_ENTRY);
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.length >= 8);
});

test("isNetworkMockActive", () => {
  assert.equal(isNetworkMockActive("dummy"), true);
  assert.equal(isNetworkMockActive("nyata"), false);
  assert.equal(isNetworkMockActive(), false);
});

test("NetworkOverviewPanel diekspor dan dipasang di halaman router", () => {
  const src = read("../src/components/dashboard/network-overview-panel.tsx");
  assert.match(src, /"use client"/);
  assert.match(src, /export function NetworkOverviewPanel/);
  assert.match(src, /data-testid="network-mock-badge"/);
  assert.match(src, /Data Tiruan Jaringan \(Fase 2\)/);
  assert.match(src, /Wajib beralih ke MikroTik nyata di Fase 5/);
  for (const label of [
    "Router Online / Aktif",
    "Total Sesi PPPoE",
    "Beban CPU Rata-rata",
    "Skor Kesehatan Jaringan",
  ]) {
    assert.ok(src.includes(label), label);
  }
  const page = read("../src/app/(protected)/app/router/page.tsx");
  assert.match(page, /<NetworkOverviewPanel \/>/);
  assert.ok(page.indexOf("<NetworkOverviewPanel") < page.indexOf("<RouterTable"));
});
