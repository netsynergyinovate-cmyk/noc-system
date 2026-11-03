import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { authPayload, handleRealtimeMessage, connectRealtimeWs } = await import(
  "../src/lib/dashboard/realtime-ws.ts"
);

const collect = () => {
  const calls = { snap: [], delta: [] };
  return {
    calls,
    opts: {
      onSnapshot: (s, t) => calls.snap.push([s, t]),
      onDelta: (d, t) => calls.delta.push([d, t]),
    },
  };
};

test("payload auth handshake", () => {
  assert.deepEqual(JSON.parse(authPayload("abc")), {
    type: "auth",
    token: "abc",
  });
});

test("parsing snapshot dan delta", () => {
  const { calls, opts } = collect();
  const snap = { type: "snapshot", time: 10, customers: [], routers: [] };
  assert.equal(handleRealtimeMessage(JSON.stringify(snap), opts), true);
  assert.deepEqual(calls.snap[0], [snap, 10]);
  const traffic = { time: 11, rx: 1, tx: 2 };
  handleRealtimeMessage(
    JSON.stringify({ type: "delta", time: 11, traffic, statusChanges: [] }),
    opts,
  );
  assert.deepEqual(calls.delta[0], [{ traffic, statusChanges: [] }, 11]);
  handleRealtimeMessage(
    JSON.stringify({ type: "status", time: 12, statusChanges: [{ customerId: "c", isOnline: false }] }),
    opts,
  );
  assert.deepEqual(calls.delta[1], [
    { traffic: null, statusChanges: [{ customerId: "c", isOnline: false }] },
    12,
  ]);
});

test("parsing alerts dan incidents", () => {
  const got = { alerts: [], incidents: [] };
  const opts = {
    onSnapshot() {},
    onDelta() {},
    onAlerts: (m, t) => got.alerts.push([m, t]),
    onIncidents: (c, t) => got.incidents.push([c, t]),
  };
  assert.equal(
    handleRealtimeMessage(
      JSON.stringify({ type: "alerts", time: 20, active: [{ id: "a" }] }),
      opts,
    ),
    true,
  );
  assert.deepEqual(got.alerts[0], [{ active: [{ id: "a" }], ended: [] }, 20]);
  handleRealtimeMessage(
    JSON.stringify({ type: "incidents", time: 21, cards: [{ id: "c" }] }),
    opts,
  );
  assert.deepEqual(got.incidents[0], [[{ id: "c" }], 21]);
  handleRealtimeMessage(
    JSON.stringify({ type: "incidents", time: 22, incidents: [{ id: "d" }] }),
    opts,
  );
  assert.deepEqual(got.incidents[1], [[{ id: "d" }], 22]);
  // tanpa callback: tidak melempar
  assert.equal(
    handleRealtimeMessage('{"type":"alerts","time":1}', {
      onSnapshot() {},
      onDelta() {},
    }),
    true,
  );
});

test("traffic null pada delta tidak melempar", () => {
  const { calls, opts } = collect();
  assert.doesNotThrow(() =>
    handleRealtimeMessage(
      JSON.stringify({ type: "delta", time: 5, traffic: null, statusChanges: [{ customerId: "x", isOnline: true }] }),
      opts,
    ),
  );
  assert.equal(calls.delta[0][0].traffic, null);
  // pesan rusak / tak dikenal diabaikan
  assert.equal(handleRealtimeMessage("{bukan json", opts), false);
  assert.equal(handleRealtimeMessage('{"type":"x","time":1}', opts), false);
  assert.equal(calls.delta.length, 1);
});

test("transisi status connecting -> live -> disconnected", async () => {
  const sent = [];
  let sock;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { token: "tok", wsUrl: "ws://x/ws" } }),
  });
  globalThis.WebSocket = class {
    constructor(url) {
      this.url = url;
      sock = this;
    }
    send(m) {
      sent.push(m);
    }
    close() {}
  };
  const statuses = [];
  const snaps = [];
  const conn = connectRealtimeWs({
    onSnapshot: (s, t) => snaps.push(t),
    onDelta: () => {},
    onStatusChange: (s) => statuses.push(s),
  });
  await new Promise((r) => setTimeout(r, 10));
  sock.onopen();
  assert.deepEqual(JSON.parse(sent[0]), { type: "auth", token: "tok" });
  sock.onmessage({ data: JSON.stringify({ type: "snapshot", time: 1 }) });
  sock.onclose();
  conn.close(); // batalkan reconnect agar proses tidak menggantung
  assert.deepEqual(statuses, ["connecting", "live", "disconnected"]);
  assert.deepEqual(snaps, [1]);
});

test("tiket gagal -> disconnected dan fallbackToMock", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const statuses = [];
  let fell = 0;
  const conn = connectRealtimeWs({
    onSnapshot() {},
    onDelta() {},
    onStatusChange: (s) => statuses.push(s),
    fallbackToMock: () => fell++,
  });
  await new Promise((r) => setTimeout(r, 10));
  conn.close();
  assert.deepEqual(statuses, ["connecting", "disconnected"]);
  assert.equal(fell, 1);
});

test("telemetry tiba tanpa `time` dan diteruskan apa adanya; tanpa data diabaikan", () => {
  const seen = [];
  const opts = { ...collect().opts, onTelemetry: (t) => seen.push(t) };
  const data = { routers: [], alerts: { total: 0, items: [] } };
  assert.equal(handleRealtimeMessage(JSON.stringify({ type: "telemetry", data }), opts), true);
  assert.deepEqual(seen, [data]);
  assert.equal(handleRealtimeMessage(JSON.stringify({ type: "telemetry" }), opts), false);
  assert.equal(seen.length, 1);
});
