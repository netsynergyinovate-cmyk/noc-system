import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const events = [];
globalThis.window = new EventTarget();
window.addEventListener("noc:alert-events", () => events.push(1));
const { useDashboardStore } = await import("../src/lib/dashboard/store.ts");

const tele = (ids) => ({ routers: [], olts: [], vlans: [], pons: [], criticalOptics: [], latency: {}, alerts: { total: ids.length, items: ids.map((id) => ({ id })) } });

test("daftar alert aktif berganti memicu pemuatan ulang; telemetri sama tidak", () => {
  const { applyTelemetry } = useDashboardStore.getState();
  applyTelemetry(tele(["a"])); // pertama: penyinkron memuat sendiri saat dipasang
  applyTelemetry(tele(["a"]));
  assert.equal(events.length, 0);
  applyTelemetry(tele(["a", "b"]));
  assert.equal(events.length, 1);
  assert.equal(useDashboardStore.getState().telemetry.alerts.total, 2);
});
