import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "tsx/esm/api";
import { getTableConfig } from "drizzle-orm/pg-core";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// DB palsu lewat slot global src/db/index.ts.
const inserted = [];
let stored = null;
const select = { conds: null };
const fakeDb = {
  insert: () => ({
    values: (v) => ({
      returning: async () => {
        inserted.push(v);
        stored = { id: "id-1", createdAt: new Date(), ...v };
        return [stored];
      },
    }),
  }),
  select: () => {
    const c = {
      from: () => c,
      where: (w) => ((select.conds = w), c),
      orderBy: () => c,
      limit: () => c,
      then: (res, rej) =>
        Promise.resolve(stored ? [stored] : []).then(res, rej),
    };
    return c;
  },
};
globalThis.starterPostgresDb = fakeDb;

register();
const schema = await import("../src/db/schema/device-test-results.ts");
const svc = await import("../src/services/device-test-results.service.ts");
const index = readFileSync(
  new URL("../src/db/schema/index.ts", import.meta.url),
  "utf8",
);

const cols = (cfg) => Object.fromEntries(cfg.columns.map((c) => [c.name, c]));

test("konstanta tipe, status, dan kode", () => {
  assert.deepEqual(
    [...schema.deviceTypes],
    ["mikrotik", "olt", "genieacs", "billing"],
  );
  assert.deepEqual(
    [...schema.deviceTestStatuses],
    ["connected", "disconnected", "error", "timeout", "untested"],
  );
  assert.deepEqual(
    [...schema.deviceTestCodes],
    [
      "OK",
      "TIMEOUT",
      "AUTH_FAILED",
      "CONNECTION_REFUSED",
      "INVALID_PORT",
      "INVALID_HOST",
      "HTTP_ERROR",
      "DNS_ERROR",
    ],
  );
  assert.match(index, /export \* from "\.\/device-test-results";/);
});

test("device_test_results: kolom dan nullability", () => {
  const cfg = getTableConfig(schema.deviceTestResults);
  assert.equal(cfg.name, "device_test_results");
  const c = cols(cfg);
  assert.deepEqual(Object.keys(c), [
    "id",
    "device_type",
    "device_id",
    "host",
    "port",
    "username",
    "endpoint_tested",
    "mode",
    "status",
    "code",
    "status_code",
    "message",
    "latency_ms",
    "ok",
    "details",
    "tested_by",
    "tested_at",
    "created_at",
  ]);
  assert.ok(c.id.primary && c.id.hasDefault);
  for (const n of [
    "device_type",
    "host",
    "port",
    "endpoint_tested",
    "mode",
    "status",
    "code",
    "message",
    "ok",
    "details",
    "tested_at",
    "created_at",
  ]) {
    assert.ok(c[n].notNull, n);
  }
  for (const n of [
    "device_id",
    "username",
    "status_code",
    "latency_ms",
    "tested_by",
  ]) {
    assert.ok(!c[n].notNull, n);
  }
  assert.equal(c.mode.default, "real");
  assert.ok(c.details.hasDefault);
  assert.equal(c.tested_at.getSQLType(), "timestamp with time zone");
  assert.ok(c.tested_at.hasDefault && c.created_at.hasDefault);
  assert.equal(c.device_id.getSQLType(), "uuid");
  assert.equal(c.details.getSQLType(), "jsonb");
});

test("device_test_results: index dan check", () => {
  const cfg = getTableConfig(schema.deviceTestResults);
  const idx = Object.fromEntries(
    cfg.indexes.map((i) => [i.config.name, i.config]),
  );
  assert.deepEqual(Object.keys(idx).sort(), [
    "device_test_results_device_id_idx",
    "device_test_results_host_idx",
    "device_test_results_tested_at_idx",
    "device_test_results_type_idx",
  ]);
  assert.deepEqual(
    idx.device_test_results_type_idx.columns.map((x) => x.name),
    ["device_type", "tested_at"],
  );
  assert.equal(
    idx.device_test_results_type_idx.columns[1].indexConfig.order,
    "desc",
  );
  assert.deepEqual(cfg.checks.map((x) => x.name).sort(), [
    "device_test_results_code_check",
    "device_test_results_status_check",
    "device_test_results_type_check",
  ]);
});

test("migrasi 0013 memuat CREATE TABLE device_test_results", () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = readdirSync(dir).filter(
    (f) => f.startsWith("0013_") && f.endsWith(".sql"),
  );
  assert.equal(files.length, 1);
  const sql = readFileSync(new URL(files[0], dir), "utf8");
  assert.match(sql, /CREATE TABLE "device_test_results"/);
  for (const n of ["type_check", "status_check", "code_check"]) {
    assert.match(sql, new RegExp(`device_test_results_${n}`));
  }
  assert.match(sql, /device_test_results_tested_at_idx/);
});

test("saveDeviceTestResult menyimpan dan mengembalikan baris, tanpa password", async () => {
  const row = await svc.saveDeviceTestResult(
    {
      type: "mikrotik",
      mode: "real",
      ok: true,
      status: "connected",
      code: "OK",
      statusCode: 200,
      message: "Terhubung",
      latencyMs: 42,
      endpointTested: "http://10.0.0.1/rest/system/resource",
      timestamp: 1_700_000_000,
      data: { version: "7.1" },
    },
    "user-1",
    "11111111-1111-4111-8111-111111111111",
    { host: "10.0.0.1", port: 80, username: "admin" },
  );
  assert.equal(row, stored);
  const v = inserted.at(-1);
  assert.equal(v.deviceType, "mikrotik");
  assert.equal(v.host, "10.0.0.1");
  assert.equal(v.port, 80);
  assert.equal(v.username, "admin");
  assert.equal(v.testedBy, "user-1");
  assert.equal(v.deviceId, "11111111-1111-4111-8111-111111111111");
  assert.equal(v.latencyMs, 42);
  assert.deepEqual(v.details, { version: "7.1" });
  assert.equal(v.testedAt.getTime(), 1_700_000_000_000);
  assert.ok(!("password" in v));
});

test("saveDeviceTestResult: default null untuk opsional", async () => {
  await svc.saveDeviceTestResult({
    type: "olt",
    mode: "simulator",
    ok: false,
    status: "timeout",
    code: "TIMEOUT",
    message: "x",
    latencyMs: null,
    endpointTested: "-",
    timestamp: 1,
  });
  const v = inserted.at(-1);
  assert.equal(v.testedBy, null);
  assert.equal(v.deviceId, null);
  assert.equal(v.statusCode, null);
  assert.equal(v.username, null);
  assert.deepEqual(v.details, {});
});

test("getLatestDeviceTestResult: baris terbaru atau null", async () => {
  assert.equal(
    await svc.getLatestDeviceTestResult("mikrotik", "10.0.0.1"),
    stored,
  );
  const saved = stored;
  stored = null;
  assert.equal(await svc.getLatestDeviceTestResult("olt"), null);
  stored = saved;
  assert.equal(
    await svc.getLatestDeviceTestResult("olt", undefined, "id"),
    stored,
  );
});
