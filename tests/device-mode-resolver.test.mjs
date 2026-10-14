import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAllDeviceModes,
  resolveDeviceOperationMode,
} from "../src/lib/device-mode-resolver.ts";

const MT = {
  MIKROTIK_REST_HOST: "10.0.0.1",
  MIKROTIK_REST_USER: "admin",
  MIKROTIK_REST_PASSWORD: "s3cret-pass",
};

test("requestedMode simulator", () => {
  const r = resolveDeviceOperationMode({ kind: "mikrotik", requestedMode: "simulator", envSource: MT });
  assert.equal(r.effectiveMode, "simulator");
  assert.equal(r.fallback, false);
});

test("real dengan env lengkap", () => {
  const r = resolveDeviceOperationMode({ kind: "mikrotik", requestedMode: "real", envSource: MT });
  assert.equal(r.effectiveMode, "real");
  assert.equal(r.fallback, false);
  assert.equal(r.ready, true);
  assert.equal(r.warning, null);
});

test("real dengan env kosong fallback ke simulator", () => {
  const r = resolveDeviceOperationMode({ kind: "mikrotik", requestedMode: "real", envSource: {} });
  assert.equal(r.effectiveMode, "simulator");
  assert.equal(r.fallback, true);
  assert.equal(r.reason, "ENV_INCOMPLETE");
  assert.equal(r.ready, false);
  assert.ok(r.warning);
});

test("allowFallback false: fail-fast tetap real", () => {
  const r = resolveDeviceOperationMode({ kind: "mikrotik", requestedMode: "real", envSource: {}, allowFallback: false });
  assert.equal(r.effectiveMode, "real");
  assert.equal(r.fallback, false);
  assert.equal(r.ready, false);
  assert.ok(r.warning);
});

test("default dashboardData demo vs live", () => {
  const demo = resolveDeviceOperationMode({ kind: "mikrotik", dashboardData: "demo", envSource: MT });
  assert.equal(demo.effectiveMode, "simulator");
  assert.equal(demo.reason, "DEMO_DEFAULT");
  assert.equal(demo.fallback, false);
  const live = resolveDeviceOperationMode({ kind: "mikrotik", dashboardData: "live", envSource: MT });
  assert.equal(live.effectiveMode, "real");
  const liveEmpty = resolveDeviceOperationMode({ kind: "mikrotik", dashboardData: "live", envSource: {} });
  assert.equal(liveEmpty.effectiveMode, "simulator");
  assert.equal(liveEmpty.fallback, true);
  // requestedMode menang atas dashboardData
  const sim = resolveDeviceOperationMode({ kind: "mikrotik", requestedMode: "simulator", dashboardData: "live", envSource: MT });
  assert.equal(sim.effectiveMode, "simulator");
});

test("isolasi antar perangkat", () => {
  const all = resolveAllDeviceModes({ requestedMode: "real", envSource: MT });
  assert.equal(all.mikrotik.effectiveMode, "real");
  assert.equal(all.olt.effectiveMode, "simulator");
  assert.equal(all.olt.fallback, true);
  assert.deepEqual(Object.keys(all).sort(), ["billing", "genieacs", "mikrotik", "olt"]);
});

test("missingEnv hanya nama variabel, bukan kredensial", () => {
  const src = { MIKROTIK_REST_HOST: "10.0.0.1", MIKROTIK_REST_USER: "admin-user" };
  const r = resolveDeviceOperationMode({ kind: "mikrotik", requestedMode: "real", envSource: src });
  assert.deepEqual(r.missingEnv, ["MIKROTIK_REST_PASSWORD"]);
  const text = JSON.stringify(r);
  assert.ok(!text.includes("10.0.0.1"));
  assert.ok(!text.includes("admin-user"));
});
