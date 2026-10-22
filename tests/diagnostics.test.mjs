import test from "node:test";
import assert from "node:assert/strict";
import {
  alertTriggerReason,
  autoDedupeKey,
  createDiagnosticQueue,
  evaluateBilling,
  evaluateOptical,
  evaluatePppoe,
  pendingLayer,
  pickVerdict,
} from "../src/lib/diagnostics.ts";

const now = new Date("2026-10-22T10:00:00Z");
const onu = (over = {}) => ({
  oltName: "HSGQ",
  ponIndex: 2,
  onuIndex: 5,
  status: "online",
  rxPower: -20,
  capturedAt: new Date(now.getTime() - 60_000),
  ...over,
});

test("PPPoE: router gagal dibaca = tidak dapat diperiksa, bukan offline", () => {
  const f = evaluatePppoe({ routerName: "R1", username: "u", session: null, error: "timeout", readAt: now });
  assert.equal(f.status, "unchecked");
  assert.match(f.detail, /timeout/);
});

test("PPPoE: tanpa sesi = fail, dengan sesi = ok", () => {
  const base = { routerName: "R1", username: "u", error: null, readAt: now };
  assert.equal(evaluatePppoe({ ...base, session: null }).status, "fail");
  const ok = evaluatePppoe({ ...base, session: { address: "172.16.0.9", uptime: "1h", callerId: "AA" } });
  assert.equal(ok.status, "ok");
  assert.match(ok.sourceRef, /R1/);
});

test("Optik: tanpa ONU dan sampel basi = unchecked", () => {
  assert.equal(evaluateOptical(null, now).status, "unchecked");
  const stale = evaluateOptical(onu({ capturedAt: new Date(now.getTime() - 11 * 60_000) }), now);
  assert.equal(stale.status, "unchecked");
  assert.match(stale.detail, /basi/);
});

test("Optik: ambang Rx dan status LOS", () => {
  assert.equal(evaluateOptical(onu(), now).status, "ok");
  assert.equal(evaluateOptical(onu({ rxPower: -25.5 }), now).status, "warn");
  assert.equal(evaluateOptical(onu({ rxPower: -28 }), now).status, "fail");
  assert.equal(evaluateOptical(onu({ rxPower: -5 }), now).status, "warn");
  assert.equal(evaluateOptical(onu({ status: "los", rxPower: null }), now).status, "fail");
  assert.equal(evaluateOptical(onu({ rxPower: null }), now).status, "unchecked");
  assert.equal(evaluateOptical(onu({ rxPower: -25.5 }), now).value, "-25.5 dBm");
});

test("Billing: isolir fail, tanpa baris unchecked", () => {
  assert.equal(evaluateBilling(null).status, "unchecked");
  assert.equal(evaluateBilling({ status: "isolir", syncedAt: now, billingName: "x" }).status, "fail");
  assert.equal(evaluateBilling({ status: "lunas", syncedAt: now, billingName: "x" }).status, "ok");
});

test("Kesimpulan: optik LOS mengalahkan PPPoE putus; billing isolir mengalahkan semua", () => {
  const ppp = evaluatePppoe({ routerName: "R1", username: "u", session: null, error: null, readAt: now });
  const los = evaluateOptical(onu({ status: "los" }), now);
  assert.equal(pickVerdict([ppp, los]).layer, "optik");
  const isolir = evaluateBilling({ status: "isolir", syncedAt: now, billingName: "x" });
  assert.equal(pickVerdict([ppp, los, isolir]).layer, "billing");
});

test("Kesimpulan: lapisan tak terperiksa membuat kesimpulan belum lengkap", () => {
  const ok = evaluateOptical(onu(), now);
  const v = pickVerdict([ok, pendingLayer("hulu", "Uplink")]);
  assert.equal(v.layer, null);
  assert.match(v.detail, /belum lengkap/);
  assert.match(pickVerdict([pendingLayer("hulu", "x")]).detail, /Tidak ada lapisan/);
});

test("Pemicu dan kunci dedupe", () => {
  assert.equal(alertTriggerReason("offline"), "alert_offline");
  assert.equal(alertTriggerReason("cpu"), null);
  const t = Date.parse("2026-10-22T10:01:00Z");
  assert.equal(autoDedupeKey("c", t, 15), autoDedupeKey("c", t + 5 * 60_000, 15));
  assert.notEqual(autoDedupeKey("c", t, 15), autoDedupeKey("c", t + 15 * 60_000, 15));
});

test("Antrean: manual didahulukan, satu per router", async () => {
  const order = [];
  const gates = new Map();
  const queue = createDiagnosticQueue(
    (id) => {
      order.push(id);
      return new Promise((resolve) => gates.set(id, resolve));
    },
    { autoGapMs: 0 },
  );
  queue.enqueue({ runId: "auto1", routerKey: "r1", priority: 10 });
  queue.enqueue({ runId: "auto2", routerKey: "r1", priority: 10 });
  queue.enqueue({ runId: "manual", routerKey: "r1", priority: 0 });
  queue.enqueue({ runId: "other", routerKey: "r2", priority: 10 });
  assert.deepEqual(order, ["auto1", "other"]);
  gates.get("auto1")();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(order, ["auto1", "other", "manual"]);
  gates.get("manual")();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(order, ["auto1", "other", "manual", "auto2"]);
  gates.get("auto2")();
  gates.get("other")();
});
