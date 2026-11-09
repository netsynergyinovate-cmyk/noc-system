import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();
const m = await import("../src/lib/mode-switch.ts");

test("normalizeMode", () => {
  for (const v of ["real", "nyata", "live", " REAL "])
    assert.equal(m.normalizeMode(v), "real");
  for (const v of ["simulator", "dummy", "demo"])
    assert.equal(m.normalizeMode(v, "real"), "simulator");
  assert.equal(m.normalizeMode("x"), "simulator");
  assert.equal(m.normalizeMode(undefined, "real"), "real");
});

test("resolveDeviceMode: prioritas", () => {
  assert.equal(
    m.resolveDeviceMode("mikrotik", {
      MIKROTIK_MODE: "real",
      DEVICE_MODE: "simulator",
    }),
    "real",
  );
  assert.equal(
    m.resolveDeviceMode("olt", { MIKROTIK_MODE: "real" }),
    "simulator",
  );
  assert.equal(
    m.resolveDeviceMode("olt", { DEVICE_MODE: "real", DASHBOARD_DATA: "demo" }),
    "real",
  );
  assert.equal(
    m.resolveDeviceMode("billing", { DASHBOARD_DATA: "live" }),
    "real",
  );
  assert.equal(
    m.resolveDeviceMode("billing", { DASHBOARD_DATA: "demo" }),
    "simulator",
  );
  assert.equal(m.resolveDeviceMode("genieacs", {}), "simulator");
  assert.equal(
    m.resolveDeviceMode("genieacs", {
      GENIEACS_MODE: "bogus",
      DEVICE_MODE: "real",
    }),
    "real",
  );
});

test("assertNoSimulatorInProduction", () => {
  assert.throws(
    () =>
      m.assertNoSimulatorInProduction("olt", {
        DASHBOARD_DATA: "live",
        OLT_MODE: "simulator",
      }),
    (e) =>
      e instanceof m.ModeViolationError &&
      e.code === "SIMULATOR_NOT_ALLOWED" &&
      e.device === "olt" &&
      e.message ===
        "Pelanggaran Go-Live: Perangkat olt berjalan dalam mode simulator di lingkungan produksi/live.",
  );
  assert.throws(
    () => m.assertNoSimulatorInProduction("olt", { NODE_ENV: "production" }),
    m.ModeViolationError,
  );
  m.assertNoSimulatorInProduction("olt", { DASHBOARD_DATA: "live" });
  m.assertNoSimulatorInProduction("olt", { DASHBOARD_DATA: "demo" });
  m.assertNoSimulatorInProduction("olt", {});
});

test("getModeSummary", () => {
  const demo = m.getModeSummary({ DASHBOARD_DATA: "demo" });
  assert.equal(demo.dataMode, "demo");
  assert.equal(demo.isProduction, false);
  assert.equal(demo.hasSimulatorActive, true);
  assert.equal(demo.isGoLiveCompliant, true);
  assert.deepEqual(demo.violations, []);

  const live = m.getModeSummary({ DASHBOARD_DATA: "live" });
  assert.equal(live.globalMode, "real");
  assert.equal(live.hasSimulatorActive, false);
  assert.equal(live.isGoLiveCompliant, true);

  const bad = m.getModeSummary({
    DASHBOARD_DATA: "live",
    BILLING_MODE: "simulator",
  });
  assert.equal(bad.devices.billing, "simulator");
  assert.equal(bad.devices.mikrotik, "real");
  assert.equal(bad.isGoLiveCompliant, false);
  assert.equal(bad.violations.length, 1);
  assert.match(bad.violations[0], /billing/);
});

test("mode-switch.service mengekspor fungsi yang benar", () => {
  const src = readFileSync(
    new URL("../src/services/mode-switch.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /^import "server-only";/);
  for (const f of [
    "getDeviceMode",
    "getAllModes",
    "getSystemModeSummary",
    "validateProductionCompliance",
  ])
    assert.match(src, new RegExp(`export function ${f}\\(`));
});
