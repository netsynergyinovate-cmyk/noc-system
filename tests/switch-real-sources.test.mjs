import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
process.env.DEVICE_SECRET ??= "d".repeat(32);

// "server-only" melempar di luar bundler Next; ganti dengan modul kosong.
const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// DB palsu lewat slot global src/db/index.ts (tanpa jaringan).
let routerRow = null;
const updates = [];
globalThis.starterPostgresDb = {
  query: { routers: { findFirst: async () => routerRow } },
  update: () => ({
    set: (v) => {
      updates.push(v);
      return { where: async () => {} };
    },
  }),
};

register();
const { encryptAES256GCM } = await import("../src/lib/encryption.ts");
const { testRouterConnection, getOltLiveOnus } = await import("../src/services/devices.service.ts");
const { runSimulatorDeviceTest } = await import("../src/lib/device-connection.ts");
const { connectRealtimeWs } = await import("../src/lib/dashboard/realtime-ws.ts");
const { createRealtimeFeedEngine, FALLBACK_AFTER_MS } = await import(
  "../src/lib/dashboard/use-realtime-feed.ts"
);
const { integrationStatuses, auditMockUsage } = await import("../src/lib/dashboard/stack-benchmark.ts");

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
  updates.length = 0;
});

const router = () => ({
  id: "r1",
  host: "10.0.0.5",
  username: "admin",
  passwordEnc: encryptAES256GCM("rahasia"),
});

test("testRouterConnection: sukses -> driver nyata dipanggil, lastSeenAt diperbarui", async () => {
  routerRow = router();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.Authorization });
    return new Response(JSON.stringify({ version: "7.14", "cpu-load": "9", "board-name": "RB" }), {
      status: 200,
    });
  };
  const r = await testRouterConnection("r1");
  assert.equal(r.ok, true);
  assert.equal(r.version, "7.14");
  assert.match(seen[0].url, /^http:\/\/10\.0\.0\.5(:80)?\/rest\/system\/resource/);
  // password didekripsi sebelum dipakai
  assert.equal(seen[0].auth, `Basic ${Buffer.from("admin:rahasia").toString("base64")}`);
  assert.equal(updates.length, 1);
  assert.ok(updates[0].lastSeenAt instanceof Date);
});

test("testRouterConnection: gagal -> error terstruktur, lastSeenAt tidak diubah", async () => {
  routerRow = router();
  globalThis.fetch = async () => new Response("", { status: 401 });
  const r = await testRouterConnection("r1");
  assert.equal(r.ok, false);
  assert.equal(r.code, "AUTH_FAILED");
  assert.ok(r.message.length > 0);
  assert.equal(updates.length, 0);

  globalThis.fetch = async () => {
    throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  };
  const r2 = await testRouterConnection("r1");
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "CONNECTION_REFUSED");
  assert.equal(updates.length, 0);
});

test("testRouterConnection: router tidak ada / tanpa password", async () => {
  routerRow = null;
  assert.equal((await testRouterConnection("x")).code, "NOT_FOUND");
  routerRow = { ...router(), passwordEnc: "" };
  assert.equal((await testRouterConnection("r1")).code, "NO_CREDENTIALS");
  assert.equal(updates.length, 0);
});

test("realtime: tiket gagal -> fallbackToMock dipanggil, status disconnected", async () => {
  globalThis.fetch = async () => new Response("", { status: 503 });
  const statuses = [];
  let fallback = 0;
  const conn = connectRealtimeWs({
    onSnapshot() {},
    onDelta() {},
    onStatusChange: (s) => statuses.push(s),
    fallbackToMock: () => fallback++,
  });
  await new Promise((r) => setTimeout(r, 20));
  conn.close();
  assert.equal(fallback, 1);
  assert.deepEqual(statuses, ["connecting", "disconnected"]);
});

test("realtime: tiket sukses -> WebSocket nyata dibuka ke wsUrl", async () => {
  const urls = [];
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: { token: "tok", wsUrl: "ws://hub/ws" } }), { status: 200 });
  const realWs = globalThis.WebSocket;
  globalThis.WebSocket = class {
    constructor(url) {
      urls.push(url);
    }
    send() {}
    close() {}
  };
  const conn = connectRealtimeWs({ onSnapshot() {}, onDelta() {}, onStatusChange() {}, fallbackToMock() {} });
  await new Promise((r) => setTimeout(r, 20));
  conn.close();
  globalThis.WebSocket = realWs;
  assert.deepEqual(urls, ["ws://hub/ws"]);
});

test("realtime engine: backend offline -> jatuh ke mock feed setelah jeda, UI tetap hidup", () => {
  let ms = 1_700_000_000_000;
  const timers = [];
  let snapshots = 0;
  const states = [];
  const deps = {
    nowMs: () => ms,
    setInterval: (fn, every) => (timers.push({ fn, next: ms + every, every, repeat: true }), timers.at(-1)),
    clearInterval: (t) => timers.splice(timers.indexOf(t), 1),
    setTimeout: (fn, after) => (timers.push({ fn, next: ms + after, repeat: false }), timers.at(-1)),
    clearTimeout: (t) => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
    },
    // Tiket gagal: koneksi melapor disconnected dan meminta fallback.
    connect: (o) => {
      o.onStatusChange("disconnected");
      o.fallbackToMock?.();
      return { close() {} };
    },
    createFeed: () => ({
      snapshot: (t) => ({ customers: [], routers: [], traffic: { times: [t], rx: [1], tx: [1] } }),
      next: (t) => ({ traffic: { time: t, rx: 1, tx: 1 }, statusChanges: [] }),
    }),
    createIncidentHub: () => ({ snapshot: () => [], changes: () => null }),
    createAlertHub: () => ({ snapshot: () => ({}), changes: () => null }),
    dash: () => ({
      customers: [],
      applySnapshot: () => snapshots++,
      applyDelta() {},
      applyIncidents() {},
      setConnection() {},
    }),
    alerts: () => ({ applySnapshot() {}, applyMessage() {}, prune() {}, reset() {} }),
  };
  const engine = createRealtimeFeedEngine({ forceMock: false, onState: (s) => states.push(s), deps });
  engine.start();
  assert.equal(engine.getState().isMockFallback, false);
  // majukan jam melewati FALLBACK_AFTER_MS
  const end = ms + FALLBACK_AFTER_MS;
  for (;;) {
    const due = timers.filter((t) => t.next <= end).sort((a, b) => a.next - b.next)[0];
    if (!due) break;
    ms = due.next;
    if (due.repeat) due.next += due.every;
    else timers.splice(timers.indexOf(due), 1);
    due.fn();
  }
  engine.stop();
  assert.equal(states.some((s) => s.isMockFallback && s.connectionStatus === "live"), true);
  assert.ok(snapshots >= 1);
});

test("OLT, GenieACS, Billing: tetap simulator/mock dan aman saat env kosong", async () => {
  for (const id of ["olt", "genieacs", "billing"]) {
    const c = integrationStatuses.find((x) => x.id === id);
    assert.notEqual(c.currentSource, "real", id);
    assert.equal(c.promotionReadiness, "needs_env", id);
  }
  assert.equal(integrationStatuses.find((x) => x.id === "mikrotik").currentSource, "real");
  assert.equal(integrationStatuses.find((x) => x.id === "realtime_hub").currentSource, "real");
  assert.equal(auditMockUsage().ruleEnforced, true);

  for (const type of ["olt", "genieacs", "billing"]) {
    const r = runSimulatorDeviceTest({ type, mode: "simulator", host: "10.0.0.5" });
    assert.equal(r.ok, true, type);
    assert.equal(r.mode, "simulator");
  }
  const onus = await getOltLiveOnus("olt-1", {});
  assert.equal(onus.source, "simulator");
  assert.ok(onus.items.length > 0);
});
