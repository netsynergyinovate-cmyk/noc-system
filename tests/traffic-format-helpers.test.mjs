import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  formatBandwidthRate,
  formatDataVolume,
  formatPacketCount,
  formatTrafficDuration,
  formatPercentage,
} = await import("../src/lib/dashboard/traffic-format-helpers.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("formatBandwidthRate: auto dan satuan eksplisit", () => {
  assert.equal(formatBandwidthRate(500), "500 bps");
  assert.equal(formatBandwidthRate(12_400), "12.40 Kbps");
  assert.equal(formatBandwidthRate(340_500_000), "340.50 Mbps");
  assert.equal(formatBandwidthRate(1_250_000_000), "1.25 Gbps");
  assert.equal(formatBandwidthRate(2_000_000), "2 Mbps");
  assert.equal(formatBandwidthRate(1_500_000, "kbps"), "1500 Kbps");
  assert.equal(formatBandwidthRate(1_500_000, "mbps"), "1.50 Mbps");
  assert.equal(formatBandwidthRate(1_500_000, "bps"), "1500000 bps");
  assert.equal(formatBandwidthRate(1_500_000, "gbps"), "0.00 Gbps");
  assert.equal(formatBandwidthRate(-5), "0 bps");
  assert.equal(formatBandwidthRate(NaN), "0 bps");
});

test("formatDataVolume: B sampai TB", () => {
  assert.equal(formatDataVolume(512), "512 B");
  assert.equal(formatDataVolume(46_080), "45.00 KB");
  assert.equal(formatDataVolume(340.2 * 1024 ** 2), "340.20 MB");
  assert.equal(formatDataVolume(1.5 * 1024 ** 3), "1.50 GB");
  assert.equal(formatDataVolume(2 * 1024 ** 4), "2.00 TB");
  assert.equal(formatDataVolume(0), "0 B");
  assert.equal(formatDataVolume(5000 * 1024 ** 4), "5000.00 TB");
});

test("formatPacketCount: pemisah ribuan titik", () => {
  assert.equal(formatPacketCount(1_240_500), "1.240.500 paket");
  assert.equal(formatPacketCount(999), "999 paket");
  assert.equal(formatPacketCount(1000), "1.000 paket");
  assert.equal(formatPacketCount(0), "0 paket");
});

test("formatTrafficDuration", () => {
  assert.equal(formatTrafficDuration(0), "< 1 dtk");
  assert.equal(formatTrafficDuration(0.4), "< 1 dtk");
  assert.equal(formatTrafficDuration(45), "45 dtk");
  assert.equal(formatTrafficDuration(330), "5 mnt 30 dtk");
  assert.equal(formatTrafficDuration(300), "5 mnt");
  assert.equal(formatTrafficDuration(2 * 3600 + 15 * 60), "2 jam 15 mnt");
  assert.equal(formatTrafficDuration(3 * 86_400 + 4 * 3600), "3 hari 4 jam");
  assert.equal(formatTrafficDuration(86_400), "1 hari");
});

test("formatPercentage", () => {
  assert.equal(formatPercentage(85.4), "85.4%");
  assert.equal(formatPercentage(85.44, 2), "85.44%");
  assert.equal(formatPercentage(100, 0), "100%");
  assert.equal(formatPercentage(NaN), "0.0%");
});

test("TrafficEmptyState: ekspor, test id, dan pemakaian di papan", () => {
  const cmp = read("../src/components/dashboard/traffic-empty-state.tsx");
  assert.match(cmp, /^"use client"/);
  assert.match(cmp, /export function TrafficEmptyState/);
  for (const id of ["traffic-empty-state", "reset-filter-btn", "retry-traffic-btn"]) {
    assert.match(cmp, new RegExp(`data-testid="${id}"`));
  }

  const trend = read("../src/components/dashboard/traffic-trend-board.tsx");
  assert.match(trend, /<TrafficEmptyState/);
  assert.match(trend, /variant="no_match"/);
  assert.match(trend, /variant="no_data"/);
  assert.match(trend, /formatBandwidthRate/);
  assert.match(trend, /formatDataVolume/);

  const nf = read("../src/components/dashboard/netflow-board.tsx");
  assert.match(nf, /<TrafficEmptyState/);
  assert.match(nf, /data-testid="netflow-empty-state"/);
  assert.match(nf, /data-testid="netflow-no-match"/);
  for (const fn of ["formatBandwidthRate", "formatDataVolume", "formatPacketCount", "formatTrafficDuration"]) {
    assert.match(nf, new RegExp(fn));
  }
});

test("helper murni tanpa server-only", () => {
  assert.doesNotMatch(read("../src/lib/dashboard/traffic-format-helpers.ts"), /server-only/);
});
