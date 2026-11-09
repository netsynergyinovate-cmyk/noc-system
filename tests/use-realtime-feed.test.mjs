import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { createRealtimeFeedEngine, FALLBACK_AFTER_MS } = await import(
  "../src/lib/dashboard/use-realtime-feed.ts"
);

// Jam palsu + store palsu: engine diuji tanpa React maupun WebSocket sungguhan.
function harness({ forceMock, connect } = {}) {
  let ms = 1_700_000_000_000;
  const timers = [];
  const calls = { snapshot: 0, delta: 0, incidents: 0, alertMsgs: 0, conn: [] };
  const states = [];
  const deps = {
    nowMs: () => ms,
    setInterval: (fn, every) => {
      const t = { fn, every, next: ms + every, repeat: true };
      timers.push(t);
      return t;
    },
    clearInterval: (t) => timers.splice(timers.indexOf(t), 1),
    setTimeout: (fn, after) => {
      const t = { fn, next: ms + after, repeat: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
    },
    connect:
      connect ??
      (() => ({ close() {} })),
    createFeed: () => ({
      snapshot: (t) => ({ customers: [], routers: [], traffic: { times: [t], rx: [1], tx: [1] } }),
      next: (t) => ({ traffic: { time: t, rx: 1, tx: 1 }, statusChanges: [] }),
    }),
    createIncidentHub: () => ({ snapshot: () => [], changes: () => null }),
    createAlertHub: () => ({ snapshot: () => ({}), changes: () => null }),
    dash: () => ({
      customers: [],
      applySnapshot: () => calls.snapshot++,
      applyDelta: () => calls.delta++,
      applyIncidents: () => calls.incidents++,
      setConnection: (c) => calls.conn.push(c),
    }),
    alerts: () => ({
      applySnapshot() {},
      applyMessage: () => calls.alertMsgs++,
      prune() {},
      reset() {},
    }),
  };
  const engine = createRealtimeFeedEngine({
    forceMock: !!forceMock,
    onState: (s) => states.push(s),
    deps,
  });
  const advance = (total) => {
    const end = ms + total;
    for (;;) {
      const due = timers.filter((t) => t.next <= end).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      ms = due.next;
      if (due.repeat) due.next += due.every;
      else timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
    ms = end;
  };
  return { engine, advance, calls, states };
}

test("awal: connecting, tidak dijeda, belum ada update", () => {
  const { engine } = harness();
  assert.deepEqual(engine.getState(), {
    connectionStatus: "connecting",
    isMockFallback: false,
    latencyMs: null,
    lastUpdateAt: null,
    isPaused: false,
  });
});


test("WebSocket live: delta masuk, latency dihitung, pause menahan delta WS", () => {
  let opts;
  const h = harness({
    connect: (o) => ((opts = o), { close() {} }),
  });
  h.engine.start();
  opts.onStatusChange("live");
  assert.equal(h.engine.getState().connectionStatus, "live");
  h.advance(FALLBACK_AFTER_MS + 1000);
  assert.equal(h.engine.getState().isMockFallback, false);
  const nowSec = Math.floor(1_700_000_000_000 / 1000) + 6;
  opts.onDelta({ traffic: null, statusChanges: [] }, nowSec);
  assert.equal(h.calls.delta, 1);
  assert.ok(h.engine.getState().latencyMs >= 0);
  h.engine.pause();
  opts.onDelta({ traffic: null, statusChanges: [] }, nowSec + 1);
  assert.equal(h.calls.delta, 1);
  h.engine.stop();
});

test("onAlerts dan onIncidents diteruskan ke store; jeda menahannya", () => {
  let opts;
  const h = harness({ connect: (o) => ((opts = o), { close() {} }) });
  h.engine.start();
  const base = h.calls.incidents; // snapshot awal engine
  const t = Math.floor(1_700_000_000_000 / 1000);
  opts.onAlerts({ active: [], ended: [] }, t);
  opts.onIncidents([], t);
  assert.equal(h.calls.alertMsgs, 1);
  assert.equal(h.calls.incidents, base + 1);
  h.engine.pause();
  opts.onAlerts({ active: [], ended: [] }, t + 1);
  opts.onIncidents([], t + 1);
  assert.equal(h.calls.alertMsgs, 1);
  assert.equal(h.calls.incidents, base + 1);
  h.engine.stop();
});

test("reconnect menutup koneksi lama, membuka yang baru, dan mengabaikan callback lama", () => {
  const opened = [];
  let closed = 0;
  const h = harness({
    connect: (o) => (opened.push(o), { close: () => closed++ }),
  });
  h.engine.start();
  h.engine.reconnect();
  assert.equal(closed, 1);
  assert.equal(opened.length, 2);
  opened[0].onStatusChange("live"); // soket lama: diabaikan
  assert.equal(h.engine.getState().connectionStatus, "connecting");
  opened[1].onStatusChange("live");
  assert.equal(h.engine.getState().connectionStatus, "live");
  h.engine.stop();
});
