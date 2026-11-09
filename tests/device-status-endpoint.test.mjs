import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { auth } = await import("../src/lib/auth.ts");
const { db } = await import("../src/db/index.ts");
const { routers, olts } = await import("../src/db/schema/index.ts");
const { GET: statusGET } =
  await import("../src/app/api/devices/status/route.ts");
const { GET: routersGET } = await import("../src/app/api/routers/route.ts");
const { computeReachability } =
  await import("../src/services/devices.service.ts");

let authed = true;
auth.api.getSession = async () =>
  authed ? { user: { id: "u1" }, session: {} } : null;

const now = Date.now();
const iso = (ms) => new Date(now - ms);
const MIN = 60_000;

const routerRows = [
  {
    id: "r1",
    name: "R-A",
    host: "10.0.0.1",
    status: "aktif",
    lastSeenAt: iso(MIN),
  }, // connected test
  {
    id: "r2",
    name: "R-B",
    host: "10.0.0.2",
    status: "aktif",
    lastSeenAt: iso(60 * MIN),
  }, // timeout
  {
    id: "r3",
    name: "R-C",
    host: "10.0.0.3",
    status: "aktif",
    lastSeenAt: null,
  }, // never tested
  {
    id: "r4",
    name: "R-D",
    host: "10.0.0.4",
    status: "nonaktif",
    lastSeenAt: iso(MIN),
  },
];
const oltRows = [
  {
    id: "o1",
    name: "O-A",
    host: "10.0.1.1",
    brand: "hsgq",
    driver: "x",
    username: "u",
    status: "aktif",
    lastSeenAt: iso(2 * MIN),
  },
  {
    id: "o2",
    name: "O-B",
    host: "10.0.1.2",
    brand: "hsgq",
    driver: "x",
    username: "u",
    status: "aktif",
    lastSeenAt: null,
  },
];
const routerTests = [
  { host: "10.0.0.1", status: "connected", latencyMs: 42, testedAt: iso(MIN) },
  {
    host: "10.0.0.2",
    status: "timeout",
    latencyMs: null,
    testedAt: iso(30 * MIN),
  },
];
const oltTests = [
  {
    host: "10.0.1.2",
    status: "disconnected",
    latencyMs: null,
    testedAt: iso(10 * MIN),
  },
];

// DB palsu: select() per tabel, selectDistinctOn() urut panggilan (router lalu OLT).
let distinctCalls = 0;
db.select = () => ({
  from: (table) => ({
    orderBy: async () =>
      table === routers ? routerRows : table === olts ? oltRows : [],
  }),
});
db.selectDistinctOn = () => {
  const rows = distinctCalls++ % 2 === 0 ? routerTests : oltTests;
  return { from: () => ({ where: () => ({ orderBy: async () => rows }) }) };
};

const get = (handler, url) =>
  handler(
    new Request(`http://localhost:3101${url}`, {
      headers: { origin: "http://localhost:3101" },
    }),
  );

test.beforeEach(() => {
  authed = true;
  distinctCalls = 0;
});

test("GET /api/devices/status: 401 tanpa sesi", async () => {
  authed = false;
  assert.equal((await get(statusGET, "/api/devices/status")).status, 401);
});

test("GET /api/devices/status: 200 dengan routers, olts, summary", async () => {
  const res = await get(statusGET, "/api/devices/status");
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.deepEqual(Object.keys(data).sort(), ["olts", "routers", "summary"]);

  const [a, b, c, d] = data.routers;
  assert.equal(a.reachability, "reachable");
  assert.equal(a.latencyMs, 42);
  assert.equal(a.lastTestStatus, "connected");
  assert.equal(a.lastCheckedAt, routerTests[0].testedAt.toISOString());
  assert.equal(a.lastSeenAt, routerRows[0].lastSeenAt.toISOString());
  assert.equal(b.reachability, "unreachable");
  assert.equal(b.latencyMs, null);
  assert.equal(c.reachability, "unknown");
  assert.equal(c.lastSeenAt, null);
  assert.equal(c.lastCheckedAt, null);
  assert.equal(d.reachability, "unreachable"); // nonaktif

  assert.deepEqual(
    data.olts.map((o) => o.reachability),
    ["reachable", "unreachable"],
  );
  assert.equal(data.olts[0].lastCheckedAt, null); // reachable karena lastSeenAt < 5 menit
  assert.ok(!JSON.stringify(data).includes("passwordEnc"));
});

test("GET /api/devices/status: summary konsisten", async () => {
  const { data } = await (await get(statusGET, "/api/devices/status")).json();
  const { summary: s } = data;
  assert.equal(s.totalRouters, 4);
  assert.equal(s.onlineRouters, 1);
  assert.equal(s.offlineRouters, 2);
  assert.equal(s.totalOlts, 2);
  assert.equal(s.onlineOlts, 1);
  assert.equal(s.offlineOlts, 1);
  assert.equal(s.totalDevices, 6);
  assert.equal(s.totalReachable, 2);
  assert.ok(Math.abs(new Date(s.checkedAt).getTime() - Date.now()) < 10_000);
});

test("GET /api/routers: 401 tanpa sesi", async () => {
  authed = false;
  assert.equal((await get(routersGET, "/api/routers")).status, 401);
});

test("GET /api/routers: 200 daftar router dengan status pemeriksaan", async () => {
  const res = await get(routersGET, "/api/routers");
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.length, 4);
  for (const r of data) {
    for (const k of [
      "lastSeenAt",
      "lastCheckedAt",
      "lastTestStatus",
      "reachability",
      "latencyMs",
    ]) {
      assert.ok(k in r, k);
    }
  }
  assert.equal(data[0].reachability, "reachable");
});

test("computeReachability: batas 5 menit", () => {
  const dev = (ms) => ({ status: "aktif", lastSeenAt: new Date(now - ms) });
  assert.equal(computeReachability(dev(5 * MIN), null, now), "reachable");
  assert.equal(computeReachability(dev(5 * MIN + 1), null, now), "unknown");
  assert.equal(
    computeReachability(dev(5 * MIN + 1), { status: "error" }, now),
    "unreachable",
  );
  assert.equal(
    computeReachability(dev(5 * MIN + 1), { status: "untested" }, now),
    "unknown",
  );
});
