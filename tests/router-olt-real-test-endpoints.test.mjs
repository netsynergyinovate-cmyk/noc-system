import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";
import { getTableConfig } from "drizzle-orm/pg-core";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";
process.env.DEVICE_SECRET = "d".repeat(32);
process.env.REALTIME_TOKEN_SECRET ??= "r".repeat(64);
process.env.BACKEND_INTERNAL_URL ??= "http://127.0.0.1:8080";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// DB palsu lewat slot global src/db/index.ts.
const state = { rows: {}, inserts: [], updates: [] };
const reset = () => {
  state.rows = { routers: [], olts: [] };
  state.inserts = [];
  state.updates = [];
};
reset();
const nameOf = (t) => getTableConfig(t).name;
globalThis.starterPostgresDb = {
  select: () => {
    let table;
    const c = {
      from: (t) => ((table = nameOf(t)), c),
      where: () => c,
      limit: () => c,
      then: (res, rej) => Promise.resolve(state.rows[table] ?? []).then(res, rej),
    };
    return c;
  },
  insert: (t) => ({
    values: (v) => {
      state.inserts.push({ table: nameOf(t), values: v });
      const p = Promise.resolve([{ id: "r1", ...v }]);
      return Object.assign(p, { returning: () => p });
    },
  }),
  update: (t) => ({
    set: (v) => ({
      where: async () => {
        state.updates.push({ table: nameOf(t), set: v });
      },
    }),
  }),
};

register();
const { auth } = await import("../src/lib/auth.ts");
const { encryptAES256GCM } = await import("../src/lib/encryption.ts");
const { POST: routersTest } = await import("../src/app/api/routers/test/route.ts");
const { POST: oltsTest } = await import("../src/app/api/olts/test/route.ts");
const { POST: routerIdTest } = await import("../src/app/api/routers/[id]/test/route.ts");
const { POST: oltIdTest } = await import("../src/app/api/olts/[id]/test/route.ts");

let sessionOk = true;
let permOk = true;
auth.api.getSession = async () => (sessionOk ? { user: { id: "u1", name: "Budi", email: "b@x.id" }, session: {} } : null);
auth.api.userHasPermission = async () => ({ success: permOk });

const ID = "11111111-1111-4111-8111-111111111111";
const PASS = "rahasia-super-123";
const req = (url, body) =>
  new Request(`http://localhost:3101${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3101" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const callId = async (handler, url, id) => {
  const res = await handler(req(url), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json() };
};
const saved = () => state.inserts.filter((i) => i.table === "device_test_results");

const realFetch = globalThis.fetch;
const stubFetch = (impl) => {
  globalThis.fetch = impl;
};
test.afterEach(() => {
  globalThis.fetch = realFetch;
  sessionOk = true;
  permOk = true;
  reset();
});

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status });

// --- Rute lama: simpan hasil ---------------------------------------------------

test("POST /api/routers/test menyimpan hasil (sukses & gagal), tanpa password", async () => {
  for (const [host, ok] of [["10.0.0.1", true], ["10.0.0.255", false]]) {
    const res = await routersTest(req("/api/routers/test", { host, username: "admin", password: PASS, mode: "simulator" }));
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.data.ok, ok);
    const row = saved().at(-1).values;
    assert.equal(row.deviceType, "mikrotik");
    assert.equal(row.host, host);
    assert.equal(row.ok, ok);
    assert.equal(row.testedBy, "Budi");
    assert.ok(!JSON.stringify(state.inserts).includes(PASS));
  }
  assert.equal(saved().length, 2);
});

test("POST /api/olts/test menyimpan hasil (sukses & gagal), tanpa password", async () => {
  for (const [host, ok] of [["10.0.0.1", true], ["10.0.0.255", false]]) {
    const res = await oltsTest(req("/api/olts/test", { host, port: 80, username: "admin", password: PASS, mode: "simulator" }));
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.data.ok, ok);
    const row = saved().at(-1).values;
    assert.equal(row.deviceType, "olt");
    assert.equal(row.host, host);
    assert.equal(row.ok, ok);
    assert.ok(!JSON.stringify(state.inserts).includes(PASS));
  }
  assert.equal(saved().length, 2);
});

// --- Router by ID -------------------------------------------------------------

test("POST /api/routers/[id]/test: 401 tanpa sesi", async () => {
  sessionOk = false;
  const { status } = await callId(routerIdTest, `/api/routers/${ID}/test`, ID);
  assert.equal(status, 401);
});

test("POST /api/routers/[id]/test: 403 tanpa router:manage, tanpa koneksi keluar", async () => {
  permOk = false;
  let called = false;
  stubFetch(async () => ((called = true), jsonRes({})));
  const { status } = await callId(routerIdTest, `/api/routers/${ID}/test`, ID);
  assert.equal(status, 403);
  assert.equal(called, false);
});

test("POST /api/routers/[id]/test: 404 ROUTER_NOT_FOUND", async () => {
  const { status, json } = await callId(routerIdTest, `/api/routers/${ID}/test`, ID);
  assert.equal(status, 404);
  assert.equal(json.error.code, "ROUTER_NOT_FOUND");
  const bad = await callId(routerIdTest, "/api/routers/x/test", "x");
  assert.equal(bad.status, 404);
});

test("POST /api/routers/[id]/test: 200, lastSeenAt, device_test_results, audit", async () => {
  state.rows.routers = [{ id: ID, host: "10.0.0.1", username: "admin", passwordEnc: encryptAES256GCM(PASS) }];
  stubFetch(async (url) => {
    assert.match(String(url), /\/api\/v1\/routers\/preflight/);
    return jsonRes({
      data: {
        ok: true,
        code: "OK",
        message: "Router terhubung",
        latencyMs: 12,
        port: 443,
        tls: true,
        endpointTested: "REST",
        version: "7.14",
        cpuLoad: 5,
        uptime: "1d",
        boardName: "RB",
      },
    });
  });
  const { status, json } = await callId(routerIdTest, `/api/routers/${ID}/test`, ID);
  assert.equal(json.success, true);
  assert.equal(json.data.ok, true);
  assert.equal(json.data.status, "connected");
  assert.equal(json.data.code, "OK");
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].table, "routers");
  assert.ok(state.updates[0].set.lastSeenAt instanceof Date);
  const row = saved()[0].values;
  assert.equal(row.deviceId, ID);
  assert.equal(row.testedBy, "Budi");
  assert.equal(row.ok, true);
  const audit = state.inserts.find((i) => i.table === "audit_log").values;
  assert.equal(audit.action, "router-connection-tested");
  assert.ok(!JSON.stringify([json, state.inserts]).includes(PASS));
});

test("POST /api/routers/[id]/test: gagal koneksi -> 200 ok=false, disimpan, lastSeenAt tidak disentuh", async () => {
  state.rows.routers = [{ id: ID, host: "10.0.0.1", username: "admin", passwordEnc: encryptAES256GCM(PASS) }];
  stubFetch(async () => jsonRes({ data: { ok: false, code: "AUTH_FAILED", message: "Login ditolak", latencyMs: 5, port: 443, tls: true, endpointTested: "REST" } }, 200));
  const { status, json } = await callId(routerIdTest, `/api/routers/${ID}/test`, ID);
  assert.equal(status, 200);
  assert.equal(json.data.ok, false);
  assert.equal(json.data.code, "AUTH_FAILED");
  assert.equal(state.updates.length, 0);
  assert.equal(saved().length, 1);
  assert.equal(saved()[0].values.ok, false);
  assert.ok(!JSON.stringify([json, state.inserts]).includes(PASS));
});

// --- OLT by ID ----------------------------------------------------------------

test("POST /api/olts/[id]/test: 401 tanpa sesi", async () => {
  sessionOk = false;
  const { status } = await callId(oltIdTest, `/api/olts/${ID}/test`, ID);
  assert.equal(status, 401);
});

test("POST /api/olts/[id]/test: 403 tanpa router:manage", async () => {
  permOk = false;
  const { status } = await callId(oltIdTest, `/api/olts/${ID}/test`, ID);
  assert.equal(status, 403);
});

test("POST /api/olts/[id]/test: 404 OLT_NOT_FOUND", async () => {
  const { status, json } = await callId(oltIdTest, `/api/olts/${ID}/test`, ID);
  assert.equal(status, 404);
  assert.equal(json.error.code, "OLT_NOT_FOUND");
});

test("POST /api/olts/[id]/test: 200, lastSeenAt, device_test_results, audit", async () => {
  state.rows.olts = [{ id: ID, host: "10.0.0.2", username: "admin", passwordEnc: encryptAES256GCM(PASS) }];
  stubFetch(async (url) => {
    assert.match(String(url), /10\.0\.0\.2.*\/api\/v1\/system/);
    return jsonRes({ model: "HSGQ", firmware: "V1", uptime: "1d", ponPortCount: 8 });
  });
  const { status, json } = await callId(oltIdTest, `/api/olts/${ID}/test`, ID);
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.ok, true);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].table, "olts");
  assert.ok(state.updates[0].set.lastSeenAt instanceof Date);
  const row = saved()[0].values;
  assert.equal(row.deviceType, "olt");
  assert.equal(row.deviceId, ID);
  assert.equal(row.testedBy, "Budi");
  assert.deepEqual(row.details.model, "HSGQ");
  const audit = state.inserts.find((i) => i.table === "audit_log").values;
  assert.equal(audit.action, "olt-connection-tested");
  assert.ok(!JSON.stringify([json, state.inserts]).includes(PASS));
});

test("POST /api/olts/[id]/test: gagal koneksi -> 200 ok=false, disimpan", async () => {
  state.rows.olts = [{ id: ID, host: "10.0.0.2", username: "admin", passwordEnc: encryptAES256GCM(PASS) }];
  stubFetch(async () => jsonRes({}, 401));
  const { status, json } = await callId(oltIdTest, `/api/olts/${ID}/test`, ID);
  assert.equal(status, 200);
  assert.equal(json.data.ok, false);
  assert.equal(state.updates.length, 0);
  assert.equal(saved().length, 1);
  assert.equal(saved()[0].values.ok, false);
});
