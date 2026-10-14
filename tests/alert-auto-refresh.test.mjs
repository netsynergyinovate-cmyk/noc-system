import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const {
  shouldRefreshAlerts: should,
  describeAlertRefreshMode: describe,
  computeNextRefreshEpoch: next,
  resolveAlertRefreshMode: resolve,
} = await import("../src/lib/dashboard/alert-auto-refresh.ts");

test("shouldRefreshAlerts: batas interval", () => {
  assert.equal(should(100, 104, 5), false);
  assert.equal(should(100, 105, 5), true);
  assert.equal(should(100, 200, 5), true);
});

test("shouldRefreshAlerts: belum pernah refresh", () => {
  assert.equal(should(null, 100, 5), true);
});

test("shouldRefreshAlerts: interval 0 / tidak valid = manual", () => {
  assert.equal(should(null, 100, 0), false);
  assert.equal(should(1, 999999, 0), false);
  assert.equal(should(1, 999999, NaN), false);
  assert.equal(should(1, 999999, -5), false);
});

test("shouldRefreshAlerts: jam mundur tetap menyegarkan", () => {
  assert.equal(should(200, 100, 5), true);
});

test("describeAlertRefreshMode", () => {
  assert.equal(describe("realtime_hub", 5000), "Tersambung Realtime (Hub)");
  assert.equal(
    describe("polling_fallback", 10000),
    "Polling Otomatis (tiap 10 detik)",
  );
  assert.equal(describe("manual", 0), "Pembaruan Manual");
});

test("computeNextRefreshEpoch", () => {
  assert.equal(next(100, 5000), 105);
  assert.equal(next(100, 30000), 130);
  assert.equal(next(null, 5000), null);
  assert.equal(next(100, 0), null);
});

test("resolveAlertRefreshMode", () => {
  assert.equal(resolve(0, "live"), "manual");
  assert.equal(resolve(5000, "live"), "realtime_hub");
  assert.equal(resolve(5000, "disconnected"), "polling_fallback");
  assert.equal(resolve(5000, "connecting"), "polling_fallback");
});

test("komponen AlertAutoRefreshControl diekspor", async () => {
  const mod = await import(
    "../src/components/dashboard/alert-auto-refresh-control.tsx"
  );
  assert.equal(typeof mod.AlertAutoRefreshControl, "function");
});
