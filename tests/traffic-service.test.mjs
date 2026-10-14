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
  inferInterfaceRole,
  calculateRateFromBytes,
  clearInterfaceHistoryCache,
} = await import("../src/services/traffic.service.ts");

test("inferInterfaceRole: mengenali role wan, uplink, hotspot, dan lan", () => {
  assert.equal(inferInterfaceRole("ether1"), "wan");
  assert.equal(inferInterfaceRole("WAN-ISP"), "wan");
  assert.equal(inferInterfaceRole("sfp-sfpplus1"), "uplink");
  assert.equal(inferInterfaceRole("Uplink-Core"), "uplink");
  assert.equal(inferInterfaceRole("wlan1"), "hotspot");
  assert.equal(inferInterfaceRole("hotspot-bridge"), "hotspot");
  assert.equal(inferInterfaceRole("ether2"), "lan");
  assert.equal(inferInterfaceRole("bridge1"), "lan");
});

test("calculateRateFromBytes: menghitung laju Mbps dari selisih byte", () => {
  // Tanpa data sebelumnya: 0
  assert.deepEqual(
    calculateRateFromBytes(undefined, { rxByte: 1000, txByte: 500 }, 1000),
    { rxMbps: 0, txMbps: 0 },
  );

  // Selisih 10.000.000 byte dalam 8 detik = 80.000.000 bit / 8 = 10.000.000 bps = 10 Mbps
  const prev = { rxByte: 0, txByte: 0, timestamp: 0 };
  const curr = { rxByte: 10_000_000, txByte: 5_000_000 };
  const res = calculateRateFromBytes(prev, curr, 8000);
  assert.equal(res.rxMbps, 10);
  assert.equal(res.txMbps, 5);

  // Delta time 0 atau negatif
  const zeroDelta = calculateRateFromBytes(prev, curr, 0);
  assert.deepEqual(zeroDelta, { rxMbps: 0, txMbps: 0 });

  // Counter reset / reboot (curr < prev)
  const resetPrev = { rxByte: 50_000_000, txByte: 20_000_000, timestamp: 0 };
  const resetCurr = { rxByte: 1_000_000, txByte: 500_000 };
  const resetRes = calculateRateFromBytes(resetPrev, resetCurr, 8000);
  assert.ok(resetRes.rxMbps >= 0 && resetRes.txMbps >= 0);
});

test("clearInterfaceHistoryCache: membersihkan cache", () => {
  clearInterfaceHistoryCache();
  assert.doesNotThrow(() => clearInterfaceHistoryCache());
});
