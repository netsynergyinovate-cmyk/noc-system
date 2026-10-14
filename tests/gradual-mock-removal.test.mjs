import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { integrationStatuses, mockAuditInventory, auditMockUsage } = await import(
  "../src/lib/dashboard/stack-benchmark.ts"
);
const { liveStatusView } = await import("../src/lib/dashboard/live-status-view.ts");
const { streamDisconnectedView } = await import("../src/lib/dashboard/stream-disconnected-view.ts");

const byId = (id) => integrationStatuses.find((c) => c.id === id);

test("lulus uji: mikrotik & realtime_hub real/passed/ready", () => {
  for (const id of ["mikrotik", "realtime_hub"]) {
    const c = byId(id);
    assert.equal(c.currentSource, "real", id);
    assert.equal(c.verificationStatus, "passed", id);
    assert.equal(c.promotionReadiness, "ready", id);
  }
});

test("belum teruji/simulator: olt simulator, genieacs & billing mock, semua needs_env", () => {
  assert.equal(byId("olt").currentSource, "simulator");
  assert.equal(byId("genieacs").currentSource, "mock");
  assert.equal(byId("billing").currentSource, "mock");
  for (const id of ["olt", "genieacs", "billing"]) {
    assert.equal(byId(id).promotionReadiness, "needs_env", id);
    assert.notEqual(byId(id).currentSource, "real", id);
  }
});

test("auditMockUsage: rasio 2 real, 1 simulator, 2 mock, aturan ditegakkan", () => {
  const r = auditMockUsage();
  assert.deepEqual(r.counts, { real: 2, simulator: 1, mock: 2 });
  assert.equal(r.ruleEnforced, true);
  assert.deepEqual(r.violations, []);
});

test("view live: sumber nyata tampil Live + latensi tanpa badge cadangan", () => {
  const v = liveStatusView({ connection: "live", latencyMs: 40, isMockFallback: false, hasReconnect: true });
  assert.equal(v.label, "Live");
  assert.equal(v.latency, "40 ms");
  assert.equal(v.fallbackBadge, null);
});

test("view live: fallback mock menampilkan badge cadangan", () => {
  const v = liveStatusView({ connection: "live", latencyMs: 4, isMockFallback: true, hasReconnect: true });
  assert.equal(v.fallbackBadge, "Cadangan (Mock)");
  assert.equal(v.latency, null);
});

test("view terputus: tombol retry hanya bila ada handler", () => {
  const base = { connection: "disconnected", latencyMs: null, isMockFallback: false };
  assert.equal(liveStatusView({ ...base, hasReconnect: true }).showRetry, true);
  assert.equal(liveStatusView({ ...base, hasReconnect: false }).showRetry, false);
  const s = streamDisconnectedView({ connection: "disconnected", lastUpdateAt: null, hasReconnect: true });
  assert.equal(s.visible, true);
  assert.equal(s.showRetryButton, true);
  assert.equal(
    streamDisconnectedView({ connection: "live", lastUpdateAt: null, hasReconnect: true }).visible,
    false,
  );
});

test("tanpa kebocoran kredensial di inventory & fallback strategy", () => {
  const blob = JSON.stringify({ integrationStatuses, mockAuditInventory });
  assert.doesNotMatch(blob, /https?:\/\/[^"\s]*:[^"\s@]*@/i, "kredensial di URL");
  assert.doesNotMatch(blob, /Bearer\s+\S+/i);
  assert.doesNotMatch(blob, /\b(ngpk_|sk-[A-Za-z0-9]|ghp_|AKIA)/);
  assert.doesNotMatch(blob, /[A-Za-z0-9]{32,}/, "string acak panjang");
  for (const c of integrationStatuses) {
    // envKeys hanya NAMA variabel, bukan nilai.
    assert.ok(c.envKeys.every((k) => /^[A-Z][A-Z0-9_]*$/.test(k)), c.id);
    assert.doesNotMatch(c.fallbackStrategy, /(password|token|secret)\s*[=:]/i, c.id);
  }
});
