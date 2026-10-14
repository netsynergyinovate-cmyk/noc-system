import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

// "server-only" melempar di luar bundler Next; ganti dengan modul kosong.
const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// src/db/index.ts memakai globalThis.starterPostgresDb bila ada (non-production),
// jadi DB palsu ini menggantikan koneksi nyata tanpa menyentuh PostgreSQL.
const calls = { execute: [], inserts: [], selects: 0 };
let executeImpl = async () => ({ rows: [] });
const fakeDb = {
  execute: (q) => {
    calls.execute.push(q);
    return executeImpl(q);
  },
  insert: () => ({
    values: (rows) => {
      calls.inserts.push(rows);
      return { onConflictDoUpdate: async () => undefined };
    },
  }),
  select: () => {
    calls.selects += 1;
    const chain = {
      from: () => chain,
      where: () => chain,
      groupBy: () => chain,
      orderBy: async () => [
        { routerId: "11111111-1111-1111-1111-111111111111", totalCustomers: "5", onlineCustomers: "3", isolirCustomers: "1" },
      ],
    };
    return chain;
  },
};
globalThis.starterPostgresDb = fakeDb;

register();
const svc = await import("../src/services/traffic-archive.service.ts");
const { traffic } = await import("../src/lib/benchmark/engine.ts");

const NOW = 1791400000;
const ROUTER = "22222222-2222-2222-2222-222222222222";

test("trafficWindow: jendela selaras dengan Go/mock untuk tiap rentang", () => {
  const expect = { "1h": [10, 360], "6h": [60, 360], "24h": [300, 288], "7d": [1800, 336] };
  for (const [range, [step, points]] of Object.entries(expect)) {
    const w = svc.trafficWindow(range, NOW);
    assert.equal(w.step, step, range);
    assert.equal(w.to % step, 0, range);
    assert.equal((w.to - w.from) / step + 1, points, range);
    assert.ok(w.to <= NOW && NOW - w.to < step);
  }
  assert.throws(() => svc.trafficWindow("30d", NOW), RangeError);
  assert.throws(() => svc.trafficWindow("1h", NOW, 0), RangeError);
  assert.throws(() => svc.trafficWindow("1h", -1), RangeError);
});

test("queryTrafficHistoryDrizzle: baris DB menjadi deret, nilai dibulatkan", async () => {
  executeImpl = async () => ({
    rows: [
      { bucket: "1791399990", rx: "10.04", tx: "2.26" },
      { bucket: 1791400000, rx: 11, tx: 3 },
    ],
  });
  const r = await svc.queryTrafficHistoryDrizzle({ range: "1h", nowSec: NOW });
  assert.equal(r.source, "db");
  assert.equal(r.step, 10);
  assert.equal(r.points, 2);
  assert.deepEqual(r.times, [1791399990, 1791400000]);
  assert.deepEqual(r.rx, [10, 11]);
  assert.deepEqual(r.tx, [2.3, 3]);
  assert.equal(r.to, NOW);
});

test("queryTrafficHistoryDrizzle: kosong, error DB, atau nilai rusak = null", async () => {
  executeImpl = async () => ({ rows: [] });
  assert.equal(await svc.queryTrafficHistoryDrizzle({ range: "6h", nowSec: NOW }), null);
  executeImpl = async () => {
    throw new Error("db mati");
  };
  assert.equal(await svc.queryTrafficHistoryDrizzle({ range: "6h", nowSec: NOW }), null);
  executeImpl = async () => ({ rows: [{ bucket: "x", rx: 1, tx: 1 }] });
  assert.equal(await svc.queryTrafficHistoryDrizzle({ range: "6h", nowSec: NOW }), null);
});

test("queryTrafficHistoryDrizzle: routerId bukan UUID ditolak sebelum query", async () => {
  const before = calls.execute.length;
  await assert.rejects(
    svc.queryTrafficHistoryDrizzle({ routerId: "'; DROP TABLE traffic_samples; --", range: "1h", nowSec: NOW }),
    RangeError,
  );
  assert.equal(calls.execute.length, before);
  executeImpl = async () => ({ rows: [{ bucket: 1, rx: 1, tx: 1 }] });
  assert.ok(await svc.queryTrafficHistoryDrizzle({ routerId: ROUTER, range: "1h", nowSec: NOW }));
});

test("insertTrafficSamplesDrizzle: gabung kunci kembar, validasi, kosong = 0", async () => {
  calls.inserts.length = 0;
  assert.equal(await svc.insertTrafficSamplesDrizzle([]), 0);
  assert.equal(calls.inserts.length, 0);

  const at = new Date("2026-10-12T10:00:00.250Z");
  const n = await svc.insertTrafficSamplesDrizzle([
    { routerId: ROUTER, sampledAt: at, rxMbps: 1, txMbps: 1 },
    { routerId: ROUTER.toUpperCase(), sampledAt: new Date("2026-10-12T10:00:00.900Z"), rxMbps: 5, txMbps: 2 },
    { routerId: ROUTER, sampledAt: new Date("2026-10-12T10:00:01Z"), rxMbps: 3, txMbps: 3 },
  ]);
  assert.equal(n, 2);
  assert.equal(calls.inserts.length, 1);
  const rows = calls.inserts[0];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rxMbps, 5); // yang terakhir menang
  assert.equal(rows[0].sampledAt.getMilliseconds(), 0);

  const bad = [
    { routerId: "bukan-uuid", sampledAt: at, rxMbps: 1, txMbps: 1 },
    { routerId: ROUTER, sampledAt: new Date("x"), rxMbps: 1, txMbps: 1 },
    { routerId: ROUTER, sampledAt: at, rxMbps: -1, txMbps: 1 },
    { routerId: ROUTER, sampledAt: at, rxMbps: NaN, txMbps: 1 },
  ];
  for (const s of bad) await assert.rejects(svc.insertTrafficSamplesDrizzle([s]), RangeError);
});

test("queryCustomerMetricsPerRouterDrizzle: angka dari driver diubah ke number", async () => {
  const rows = await svc.queryCustomerMetricsPerRouterDrizzle();
  assert.deepEqual(rows, [
    { routerId: "11111111-1111-1111-1111-111111111111", totalCustomers: 5, onlineCustomers: 3, isolirCustomers: 1 },
  ]);
  await svc.queryCustomerMetricsPerRouterDrizzle(ROUTER);
  await assert.rejects(svc.queryCustomerMetricsPerRouterDrizzle("x"), RangeError);
});

test("traffic(): memakai hasil DB bila ada titik", async () => {
  executeImpl = async () => ({
    rows: [{ bucket: 1791399990, rx: 20, tx: 4 }],
  });
  const r = await traffic("1h", NOW);
  assert.equal(r.source, "db");
  assert.equal(r.points, 1);
  assert.equal(r.times.length, 1);
  assert.equal(r.rx[0], 20);
  assert.equal(r.tx[0], 4);
});

test("traffic(): DB kosong atau error jatuh ke data tiruan yang valid", async () => {
  const expect = { "1h": 360, "6h": 360, "24h": 288, "7d": 336 };
  for (const mode of ["kosong", "error"]) {
    executeImpl =
      mode === "kosong"
        ? async () => ({ rows: [] })
        : async () => {
            throw new Error("db mati");
          };
    for (const [range, points] of Object.entries(expect)) {
      const r = await traffic(range, NOW);
      assert.equal(r.source, "mock", `${mode} ${range}`);
      assert.equal(r.points, points);
      assert.equal(r.times.length, points);
      assert.equal(r.rx.length, points);
      assert.equal(r.tx.length, points);
    }
  }
});
