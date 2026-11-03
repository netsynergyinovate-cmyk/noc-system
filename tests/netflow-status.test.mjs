import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { buildNetflowStatus, NETFLOW_FRESH_MS } = await import(
  "../src/lib/dashboard/netflow-status.ts"
);

const now = Date.UTC(2026, 0, 1, 12, 0, 0);
const base = { isDemo: false, totalSamples: 10, activeRoutersCount: 2, nowMs: now };

test("aktif bila sampel terakhir tepat 15 menit; tidak aktif lewat itu", () => {
  assert.equal(NETFLOW_FRESH_MS, 15 * 60 * 1000);
  const edge = new Date(now - NETFLOW_FRESH_MS);
  assert.equal(buildNetflowStatus({ ...base, lastCapturedAt: edge }).isActive, true);
  const old = new Date(now - NETFLOW_FRESH_MS - 1);
  assert.equal(buildNetflowStatus({ ...base, lastCapturedAt: old }).isActive, false);
});

test("tanpa sampel: tidak aktif, lastCapturedAt null; demo selalu aktif", () => {
  const none = buildNetflowStatus({ ...base, totalSamples: 0, lastCapturedAt: null });
  assert.equal(none.isActive, false);
  assert.equal(none.lastCapturedAt, null);
  const demo = buildNetflowStatus({
    ...base,
    isDemo: true,
    totalSamples: 0,
    lastCapturedAt: null,
  });
  assert.equal(demo.isDemo, true);
  assert.equal(demo.isActive, true);
});

test("kontrak respon: kunci dan tipe tepat", () => {
  const s = buildNetflowStatus({ ...base, lastCapturedAt: new Date(now - 1000) });
  assert.deepEqual(Object.keys(s).sort(), [
    "activeRoutersCount",
    "isActive",
    "isDemo",
    "lastCapturedAt",
    "totalSamples",
  ]);
  assert.equal(typeof s.isDemo, "boolean");
  assert.equal(typeof s.isActive, "boolean");
  assert.equal(s.totalSamples, 10);
  assert.equal(s.activeRoutersCount, 2);
  assert.equal(s.lastCapturedAt, new Date(now - 1000).toISOString());
});
