import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  generateTrafficTrendSeries,
  getMockInterfaceSamples,
  loadTrafficTrendOverview,
  TRAFFIC_TREND_MOCK_ENTRY,
} = await import("../src/lib/dashboard/traffic-trend-data.ts");
const { SETUP_DATA_SOURCE_REGISTRY } = await import("../src/lib/dashboard/setup-extended.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = 1_760_000_000;
const EXPECTED = { "1h": 12, "6h": 24, "24h": 24, "7d": 28 };

test("generateTrafficTrendSeries: jumlah, urutan, nilai valid, deterministik", () => {
  for (const [range, n] of Object.entries(EXPECTED)) {
    const s = generateTrafficTrendSeries(range, NOW);
    assert.equal(s.length, n);
    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      if (i > 0) assert.ok(p.timestamp > s[i - 1].timestamp);
      assert.ok(p.downloadMbps >= 0 && p.uploadMbps >= 0);
      assert.equal(p.totalMbps, Math.round((p.downloadMbps + p.uploadMbps) * 100) / 100);
      assert.ok(p.peakMbps >= p.totalMbps);
      assert.ok(p.timeLabel.length > 0);
    }
    assert.deepEqual(s, generateTrafficTrendSeries(range, NOW));
    assert.ok(s[s.length - 1].timestamp <= NOW);
  }
});

test("getMockInterfaceSamples: 6-8 interface valid", () => {
  const list = getMockInterfaceSamples();
  assert.ok(list.length >= 6 && list.length <= 8);
  assert.equal(new Set(list.map((i) => i.id)).size, list.length);
  const roles = new Set(list.map((i) => i.role));
  for (const r of ["wan", "lan", "uplink"]) assert.ok(roles.has(r));
  for (const i of list) {
    assert.ok(i.rxMbps >= 0 && i.txMbps >= 0);
    assert.ok(["up", "down"].includes(i.status));
  }
});

test("loadTrafficTrendOverview: KPI konsisten dengan seri", () => {
  for (const range of Object.keys(EXPECTED)) {
    const s = generateTrafficTrendSeries(range, NOW);
    const o = loadTrafficTrendOverview(range, NOW);
    assert.equal(o.range, range);
    assert.equal(o.sourceStatus, "dummy");
    assert.equal(o.currentDownloadMbps, s.at(-1).downloadMbps);
    assert.equal(o.currentUploadMbps, s.at(-1).uploadMbps);
    assert.equal(o.peakMbps, Math.max(...s.map((p) => p.peakMbps)));
    assert.ok(o.avgMbps > 0 && o.avgMbps <= o.peakMbps);
    assert.ok(o.totalVolumeGb > 0);
    assert.equal(
      o.activeInterfacesCount,
      getMockInterfaceSamples().filter((i) => i.status === "up").length,
    );
    assert.equal(o.lastSampledAt, new Date(s.at(-1).timestamp * 1000).toISOString());
  }
});

test("TRAFFIC_TREND_MOCK_ENTRY terdaftar di registry", () => {
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.length >= 10);
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.includes(TRAFFIC_TREND_MOCK_ENTRY));
  assert.equal(TRAFFIC_TREND_MOCK_ENTRY.status, "dummy");
  assert.match(TRAFFIC_TREND_MOCK_ENTRY.notes, /Fase 5/);
});

test("komponen, halaman, dan menu", () => {
  const board = read("../src/components/dashboard/traffic-trend-board.tsx");
  assert.match(board, /export function TrafficTrendBoard/);
  for (const id of ["traffic-trend-board", "traffic-range-select", "traffic-interface-table", "traffic-mock-badge"])
    assert.match(board, new RegExp(`data-testid="${id}"`));
  const page = read("../src/app/(protected)/app/traffic/page.tsx");
  assert.match(page, /export default async function TrafficPage/);
  assert.match(page, /<TrafficTrendBoard/);
  assert.match(page, /requireSession\(\)/);
  const nav = read("../src/components/dashboard/app-nav.tsx");
  assert.match(nav, /label: "Trafik", href: "\/app\/traffic"/);
  assert.match(nav, /label: "Alert", href: "\/app\/alert"/);
});
