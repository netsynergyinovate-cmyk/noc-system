import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { evaluateSetupGate } =
  await import("../src/lib/dashboard/setup-gate.ts");

test("demo selalu lolos", () => {
  assert.deepEqual(
    evaluateSetupGate({ isDemo: true, connected: { routers: 0, olts: 0 } }),
    { hasDevices: false, canEnterDashboard: true, redirectUrl: "/app" },
  );
});

test("live tanpa perangkat diblokir", () => {
  assert.deepEqual(
    evaluateSetupGate({ isDemo: false, connected: { routers: 0, olts: 0 } }),
    { hasDevices: false, canEnterDashboard: false, redirectUrl: "/setup" },
  );
});

test("live dengan 1 router lolos", () => {
  assert.deepEqual(
    evaluateSetupGate({ isDemo: false, connected: { routers: 1, olts: 0 } }),
    { hasDevices: true, canEnterDashboard: true, redirectUrl: "/app" },
  );
});

test("live dengan 1 OLT lolos", () => {
  assert.deepEqual(
    evaluateSetupGate({ isDemo: false, connected: { routers: 0, olts: 1 } }),
    { hasDevices: true, canEnterDashboard: true, redirectUrl: "/app" },
  );
});
