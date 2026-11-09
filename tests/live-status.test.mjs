import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { useDashboardStore } = await import("../src/lib/dashboard/store.ts");
const { liveStatusView } =
  await import("../src/lib/dashboard/live-status-view.ts");

test("store: nilai awal", () => {
  const s = useDashboardStore.getState();
  assert.equal(s.latencyMs, null);
  assert.equal(s.isMockFallback, false);
  assert.equal(s.reconnectFeed, null);
});

test("store: setConnection mengisi status, cadangan, latensi", () => {
  const { setConnection } = useDashboardStore.getState();
  setConnection("live", false, 42);
  let s = useDashboardStore.getState();
  assert.equal(s.connection, "live");
  assert.equal(s.isMockFallback, false);
  assert.equal(s.latencyMs, 42);

  setConnection("live", true, 3);
  s = useDashboardStore.getState();
  assert.equal(s.isMockFallback, true);
  assert.equal(s.latencyMs, 3);

  // Panggilan satu argumen (dari engine) membersihkan sisa nilai lama.
  setConnection("disconnected");
  s = useDashboardStore.getState();
  assert.equal(s.connection, "disconnected");
  assert.equal(s.isMockFallback, false);
  assert.equal(s.latencyMs, null);
});

test("store: setReconnectHandler memasang dan melepas handler", () => {
  const handler = () => {};
  useDashboardStore.getState().setReconnectHandler(handler);
  assert.equal(useDashboardStore.getState().reconnectFeed, handler);
  useDashboardStore.getState().setReconnectHandler(null);
  assert.equal(useDashboardStore.getState().reconnectFeed, null);
});

test("view: live WebSocket menampilkan Live dan latensi", () => {
  const v = liveStatusView({
    connection: "live",
    latencyMs: 120,
    isMockFallback: false,
    hasReconnect: true,
  });
  assert.equal(v.label, "Live");
  assert.equal(v.latency, "120 ms");
  assert.equal(v.fallbackBadge, null);
  assert.equal(v.showRetry, false);
  assert.match(v.dot, /bg-success/);
});

test("view: latensi 0 ms tetap tampil", () => {
  const v = liveStatusView({
    connection: "live",
    latencyMs: 0,
    isMockFallback: false,
    hasReconnect: false,
  });
  assert.equal(v.latency, "0 ms");
});

test("view: live mock menampilkan badge cadangan tanpa latensi", () => {
  const v = liveStatusView({
    connection: "live",
    latencyMs: 5,
    isMockFallback: true,
    hasReconnect: true,
  });
  assert.equal(v.label, "Live");
  assert.equal(v.fallbackBadge, "Cadangan (Mock)");
  assert.equal(v.latency, null);
});

test("view: connecting", () => {
  const v = liveStatusView({
    connection: "connecting",
    latencyMs: null,
    isMockFallback: false,
    hasReconnect: true,
  });
  assert.equal(v.label, "Menghubungkan…");
  assert.match(v.dot, /bg-warning/);
  assert.equal(v.latency, null);
  assert.equal(v.showRetry, false);
});

test("view: disconnected menampilkan Coba lagi hanya bila ada handler", () => {
  const input = {
    connection: "disconnected",
    latencyMs: 99,
    isMockFallback: false,
  };
  const withHandler = liveStatusView({ ...input, hasReconnect: true });
  assert.equal(withHandler.label, "Terputus");
  assert.match(withHandler.dot, /bg-destructive/);
  assert.equal(withHandler.showRetry, true);
  assert.equal(withHandler.latency, null);
  assert.equal(
    liveStatusView({ ...input, hasReconnect: false }).showRetry,
    false,
  );
});
