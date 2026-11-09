import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const svc = await import("../src/services/traffic-archive-raw.service.ts");

const NOW = 1791400000;
const R1 = "22222222-2222-2222-2222-222222222222";
const R2 = "33333333-3333-3333-3333-333333333333";

function mock(impl = async () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return impl(sql, params);
    },
  };
}

test("history: routerId tidak valid / injeksi ditolak sebelum query", async () => {
  for (const bad of [
    "x",
    "",
    `${R1}'; DROP TABLE traffic_samples;--`,
    R1 + "0",
  ]) {
    const c = mock();
    await assert.rejects(
      svc.queryTrafficHistoryRaw({ routerId: bad, nowSec: NOW }, c),
      RangeError,
    );
    assert.equal(c.calls.length, 0);
  }
});

test("history: SQL berparameter, nilai tidak disisipkan ke teks", async () => {
  const c = mock(async () => ({
    rows: [
      { bucket: "1791399990", rx: "10.04", tx: "2.26" },
      { bucket: 1791400000, rx: 11, tx: 3 },
    ],
  }));
  const r = await svc.queryTrafficHistoryRaw(
    { routerId: R1, range: "1h", nowSec: NOW },
    c,
  );
  assert.equal(c.calls.length, 1);
  const { sql, params } = c.calls[0];
  for (const p of ["$1", "$2", "$3", "$4"]) assert.ok(sql.includes(p), p);
  assert.ok(!sql.includes(R1));
  assert.equal(params.length, 4);
  assert.equal(params[2], 10);
  assert.equal(params[3], R1);
  assert.equal(r.source, "raw_sql");
  assert.equal(r.points, 2);
  assert.deepEqual(r.times, [1791399990, 1791400000]);
  assert.deepEqual(r.rx, [10, 11]);
  assert.deepEqual(r.tx, [2.3, 3]);
  assert.equal(r.to, NOW);
  assert.equal(r.to - r.from, 359 * 10);
});

test("history: tanpa routerId -> parameter null", async () => {
  const c = mock();
  await svc.queryTrafficHistoryRaw({ nowSec: NOW }, c);
  assert.equal(c.calls[0].params[3], null);
});

test("history: fallback null saat kosong, error, atau nilai non-finite", async () => {
  assert.equal(await svc.queryTrafficHistoryRaw({ nowSec: NOW }, mock()), null);
  const boom = mock(async () => {
    throw new Error("down");
  });
  assert.equal(await svc.queryTrafficHistoryRaw({ nowSec: NOW }, boom), null);
  const nan = mock(async () => ({ rows: [{ bucket: 1, rx: "abc", tx: 1 }] }));
  assert.equal(await svc.queryTrafficHistoryRaw({ nowSec: NOW }, nan), null);
  const inf = mock(async () => ({
    rows: [{ bucket: 1, rx: Infinity, tx: 1 }],
  }));
  assert.equal(await svc.queryTrafficHistoryRaw({ nowSec: NOW }, inf), null);
});

test("insert: UNNEST dengan 4 array, dedup last-write-wins per (router, detik)", async () => {
  const c = mock();
  const t = new Date("2026-01-01T00:00:05.100Z");
  const n = await svc.insertTrafficSamplesRaw(
    [
      { routerId: R1, sampledAt: t, rxMbps: 1, txMbps: 1 },
      {
        routerId: R1.toUpperCase(),
        sampledAt: new Date(t.getTime() + 800),
        rxMbps: 9,
        txMbps: 8,
      },
      { routerId: R2, sampledAt: t, rxMbps: 2, txMbps: 3 },
      {
        routerId: R1,
        sampledAt: new Date(t.getTime() + 1000),
        rxMbps: 4,
        txMbps: 5,
      },
    ],
    c,
  );
  assert.equal(n, 3);
  assert.equal(c.calls.length, 1);
  const { sql, params } = c.calls[0];
  assert.match(
    sql,
    /UNNEST\(\$1::uuid\[\], \$2::timestamptz\[\], \$3::float8\[\], \$4::float8\[\]\)/,
  );
  assert.match(sql, /ON CONFLICT \(router_id, sampled_at\)\s+DO UPDATE/);
  assert.equal(params.length, 4);
  assert.deepEqual(params[0], [R1, R2, R1]);
  assert.deepEqual(params[1], [
    "2026-01-01T00:00:05.000Z",
    "2026-01-01T00:00:05.000Z",
    "2026-01-01T00:00:06.000Z",
  ]);
  assert.deepEqual(params[2], [9, 2, 4]);
  assert.deepEqual(params[3], [8, 3, 5]);
});

test("insert: kosong tanpa query; input buruk ditolak tanpa query", async () => {
  const c = mock();
  assert.equal(await svc.insertTrafficSamplesRaw([], c), 0);
  const ok = { routerId: R1, sampledAt: new Date(), rxMbps: 1, txMbps: 1 };
  for (const bad of [
    { ...ok, routerId: "nope" },
    { ...ok, sampledAt: new Date("x") },
    { ...ok, rxMbps: -1 },
    { ...ok, txMbps: NaN },
    { ...ok, rxMbps: Infinity },
  ]) {
    await assert.rejects(svc.insertTrafficSamplesRaw([ok, bad], c), RangeError);
  }
  assert.equal(c.calls.length, 0);
});

test("metrics: bigint string diubah ke angka, routerId divalidasi", async () => {
  const c = mock(async () => ({
    rows: [
      {
        router_id: R1,
        total_customers: "5",
        online_customers: "3",
        isolir_customers: "1",
      },
    ],
  }));
  const r = await svc.queryCustomerMetricsPerRouterRaw(R1, c);
  assert.deepEqual(r, [
    { routerId: R1, totalCustomers: 5, onlineCustomers: 3, isolirCustomers: 1 },
  ]);
  assert.match(c.calls[0].sql, /GROUP BY router_id/);
  assert.deepEqual(c.calls[0].params, [R1]);
  await svc.queryCustomerMetricsPerRouterRaw(undefined, c);
  assert.deepEqual(c.calls[1].params, [null]);
  await assert.rejects(
    svc.queryCustomerMetricsPerRouterRaw("1; DROP", c),
    RangeError,
  );
  assert.equal(c.calls.length, 2);
});
