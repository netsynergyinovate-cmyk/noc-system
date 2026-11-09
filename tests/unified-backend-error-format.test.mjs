import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";
process.env.BILLING_URL = "http://billing.env.test:8080/app";
process.env.BILLING_USERNAME = "env-user";
process.env.BILLING_PASSWORD = "env-pass";

// "server-only" melempar di luar bundler Next; ganti dengan modul kosong.
const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { auth } = await import("../src/lib/auth.ts");
const { redactSecrets, testDeviceConnection } =
  await import("../src/services/device-connection-tester.ts");
const { POST: devicesTest } =
  await import("../src/app/api/devices/test/route.ts");
const { POST: routersTest } =
  await import("../src/app/api/routers/test/route.ts");
const { POST: oltsTest } = await import("../src/app/api/olts/test/route.ts");
const { POST: cpeTest } = await import("../src/app/api/cpe/test/route.ts");
const { POST: billingTest } =
  await import("../src/app/api/billing/test/route.ts");

auth.api.getSession = async () => ({ user: { id: "u1" }, session: {} });
auth.api.userHasPermission = async () => ({ success: true });

const call = async (handler, url, body) => {
  const res = await handler(
    new Request(`http://localhost:3101${url}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3101",
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
};

const REQUIRED = [
  "ok",
  "status",
  "code",
  "message",
  "latencyMs",
  "endpointTested",
  "timestamp",
];
const assertSeven = (data) => {
  for (const k of REQUIRED)
    assert.ok(
      k in data && data[k] !== undefined,
      `field ${k} hilang: ${JSON.stringify(data)}`,
    );
  assert.equal(typeof data.ok, "boolean");
  assert.equal(typeof data.status, "string");
  assert.equal(typeof data.code, "string");
  assert.equal(typeof data.message, "string");
  assert.equal(typeof data.endpointTested, "string");
  assert.equal(typeof data.timestamp, "number");
};

// --- Sanitasi ---------------------------------------------------------------

test("redactSecrets: password, base64, kredensial URL, query token", () => {
  const req = { username: "admin", password: "S3cr3t!Pass" };
  const b64 = Buffer.from("admin:S3cr3t!Pass").toString("base64");
  const text = [
    `plain ${req.password}`,
    `Authorization: Basic ${b64}`,
    `raw ${b64}`,
    "http://bob:hunter2@10.0.0.1/x",
    "http://10.0.0.1/x?token=abc123&password=zzz&ok=1&secret=q&auth=w",
  ].join(" | ");
  const out = redactSecrets(text, req);
  for (const leak of [
    req.password,
    b64,
    "hunter2",
    "abc123",
    "zzz",
    "=q",
    "=w",
  ]) {
    assert.ok(!out.includes(leak), `bocor: ${leak} dalam ${out}`);
  }
  assert.ok(out.includes("ok=1"));
});

test("testDeviceConnection real: galat jaringan tidak membocorkan rahasia", async () => {
  const password = "P@ss-w0rd-123";
  const b64 = Buffer.from(`admin:${password}`).toString("base64");
  const leaky = async () => {
    throw new Error(
      `boom ${password} Basic ${b64} http://admin:${password}@10.0.0.5/?token=tok999`,
    );
  };
  const r = await testDeviceConnection(
    {
      type: "mikrotik",
      host: "10.0.0.5",
      port: 80,
      username: "admin",
      password,
      mode: "real",
    },
    { fetchImpl: leaky },
  );
  assert.equal(r.ok, false);
  assertSeven(r);
  const dump = JSON.stringify(r);
  for (const leak of [password, b64, "tok999"])
    assert.ok(!dump.includes(leak), `bocor: ${leak}`);
});

test("testDeviceConnection: semua cabang punya 7 field wajib", async () => {
  const base = {
    type: "olt",
    host: "10.0.0.1",
    port: 80,
    username: "u",
    password: "p",
  };
  const results = await Promise.all([
    testDeviceConnection({ ...base, mode: "simulator" }),
    testDeviceConnection({ ...base, mode: "simulator", host: "10.0.0.0" }),
    testDeviceConnection({ ...base, mode: "simulator", port: 9999 }),
    testDeviceConnection({ ...base, mode: "simulator", host: "10.0.0.255" }),
    testDeviceConnection({ ...base, mode: "real", host: "bad host!" }),
    testDeviceConnection({ ...base, mode: "real", port: 70000 }),
  ]);
  for (const r of results) assertSeven(r);
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, false, false, false, false, false],
  );
});

// --- Route: kegagalan koneksi = HTTP 200 ok=false ---------------------------

test("POST /api/routers/test: gagal koneksi -> 200, data.ok=false, format seragam", async () => {
  const password = "rahasia-router";
  const { status, json } = await call(routersTest, "/api/routers/test", {
    host: "10.0.0.255",
    username: "admin",
    password,
    mode: "simulator",
  });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.ok, false);
  assertSeven(json.data);
  assert.equal(json.data.status, "error");
  assert.ok(!JSON.stringify(json).includes(password));
});

test("POST /api/routers/test: real, port tertutup -> 200 ok=false", async () => {
  const { status, json } = await call(routersTest, "/api/routers/test", {
    host: "127.0.0.1",
    port: 1,
    username: "admin",
    password: "x",
    mode: "real",
  });
  assert.equal(status, 200);
  assert.equal(json.data.ok, false);
  assertSeven(json.data);
});

test("POST /api/routers/test: sukses simulator tetap membawa kunci RouterOS lama", async () => {
  const { status, json } = await call(routersTest, "/api/routers/test", {
    host: "10.0.0.1",
    username: "admin",
    password: "x",
    mode: "simulator",
  });
  assert.equal(status, 200);
  assert.equal(json.data.ok, true);
  assertSeven(json.data);
  for (const k of ["version", "cpu-load", "uptime", "board-name"])
    assert.ok(k in json.data, k);
});

test("POST /api/olts/test: gagal koneksi -> 200, data.ok=false, format seragam", async () => {
  const password = "rahasia-olt";
  const { status, json } = await call(oltsTest, "/api/olts/test", {
    host: "10.0.0.255",
    username: "admin",
    password,
    mode: "simulator",
  });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.ok, false);
  assertSeven(json.data);
  assert.ok(!JSON.stringify(json).includes(password));
});

test("POST /api/olts/test: sukses simulator memuat field OLT", async () => {
  const { status, json } = await call(oltsTest, "/api/olts/test", {
    host: "10.0.0.1",
    username: "admin",
    password: "x",
    mode: "simulator",
  });
  assert.equal(status, 200);
  assert.equal(json.data.ok, true);
  assertSeven(json.data);
  assert.equal(json.data.ponPortCount, 8);
});

// --- Semua endpoint uji menghasilkan 7 field --------------------------------

const endpoints = [
  [
    "devices",
    devicesTest,
    "/api/devices/test",
    {
      type: "mikrotik",
      host: "10.0.0.1",
      mode: "simulator",
      username: "a",
      password: "b",
    },
  ],
  [
    "routers",
    routersTest,
    "/api/routers/test",
    { host: "10.0.0.1", username: "a", password: "b", mode: "simulator" },
  ],
  [
    "olts",
    oltsTest,
    "/api/olts/test",
    { host: "10.0.0.1", username: "a", password: "b", mode: "simulator" },
  ],
  ["cpe", cpeTest, "/api/cpe/test", { mode: "simulator" }],
  [
    "billing",
    billingTest,
    "/api/billing/test",
    { host: "billing.local", mode: "simulator", username: "op", password: "b" },
  ],
];

for (const [name, handler, url, body] of endpoints) {
  test(`POST ${url}: 7 field wajib (${name})`, async () => {
    const { status, json } = await call(handler, url, body);
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assertSeven(json.data);
  });
}

test("POST /api/cpe/test: field lama tetap ada di level atas", async () => {
  const { json } = await call(cpeTest, "/api/cpe/test", { mode: "simulator" });
  assert.equal(json.ok, true);
  assert.equal(json.mode, "simulator");
  assert.equal(typeof json.latencyMs, "number");
  assert.equal(typeof json.deviceCount, "number");
});

// --- Validasi tetap 422 -----------------------------------------------------

test("validasi schema tetap 422", async () => {
  for (const [handler, url, body] of [
    [routersTest, "/api/routers/test", {}],
    [oltsTest, "/api/olts/test", { host: "" }],
    [devicesTest, "/api/devices/test", { type: "x", host: "h" }],
    [cpeTest, "/api/cpe/test", { port: 0 }],
  ]) {
    const { status, json } = await call(handler, url, body);
    assert.equal(status, 422, url);
    assert.ok(json.error?.code, url);
  }
});

test("host berbahaya tetap 422 INVALID_HOST", async () => {
  const r = await call(routersTest, "/api/routers/test", {
    host: "http://u:p@10.0.0.1/x",
    username: "a",
    password: "b",
    mode: "real",
  });
  assert.equal(r.status, 422);
  assert.equal(r.json.error.code, "INVALID_HOST");
  const o = await call(oltsTest, "/api/olts/test", {
    host: "10.0.0.1/../x",
    username: "a",
    password: "b",
  });
  assert.equal(o.status, 422);
  assert.equal(o.json.error.code, "INVALID_HOST");
});
