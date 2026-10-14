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
const { POST: devicesTest } = await import("../src/app/api/devices/test/route.ts");
const { POST: billingTest } = await import("../src/app/api/billing/test/route.ts");

// Sesi dan izin dipalsukan di auth.api: tanpa DB. Peran admin memegang
// router:manage dan billing:manage, peran biasa tidak satu pun.
let role = "admin"; // "admin" | "user" | "anon"
auth.api.getSession = async () => (role === "anon" ? null : { user: { id: "u1" }, session: {} });
auth.api.userHasPermission = async () => ({ success: role === "admin" });

const post = (url, body) =>
  new Request(`http://localhost:3101${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3101" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const call = async (handler, url, body) => {
  const res = await handler(post(url, body));
  return { status: res.status, json: await res.json() };
};

test.beforeEach(() => {
  role = "admin";
});

const cases = [
  ["mikrotik", "/rest/system/resource"],
  ["olt", "/api/v1/system"],
  ["genieacs", "/devices"],
  ["billing", "/login"],
];

for (const [type, endpoint] of cases) {
  test(`POST /api/devices/test ${type}: sukses (simulator)`, async () => {
    const { status, json } = await call(devicesTest, "/api/devices/test", {
      type,
      mode: "simulator",
      host: "10.0.0.1",
      username: "admin",
      password: "rahasia",
    });
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.ok, true);
    assert.equal(json.data.status, "connected");
    assert.equal(json.data.code, "OK");
    assert.equal(typeof json.data.latencyMs, "number");
    assert.equal(typeof json.data.timestamp, "number");
    assert.ok(json.data.endpointTested.includes(endpoint), json.data.endpointTested);
    assert.ok(!JSON.stringify(json).includes("rahasia"));
  });
}

test("POST /api/devices/test olt port 23: endpoint TELNET", async () => {
  const { json } = await call(devicesTest, "/api/devices/test", {
    type: "olt",
    mode: "simulator",
    host: "10.0.0.1",
    port: 23,
  });
  assert.equal(json.success, true);
  assert.ok(json.data.endpointTested.includes("TELNET"));
});

test("POST /api/devices/test: useTls diteruskan ke endpoint", async () => {
  const { json } = await call(devicesTest, "/api/devices/test", {
    type: "billing",
    mode: "simulator",
    host: "10.0.0.1",
    port: 8080,
    useTls: true,
  });
  assert.ok(json.data.endpointTested.startsWith("GET https://"), json.data.endpointTested);
});

test("POST /api/devices/test: 422 untuk payload salah", async () => {
  const { status, json } = await call(devicesTest, "/api/devices/test", { type: "x", host: "h" });
  assert.equal(status, 422);
  assert.equal(json.error.code, "VALIDATION_ERROR");
});

test("POST /api/billing/test: sukses di mode simulator", async () => {
  const { status, json } = await call(billingTest, "/api/billing/test", {
    host: "billing.local",
    mode: "simulator",
    username: "op",
    password: "rahasia",
  });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.ok, true);
  assert.equal(json.data.status, "connected");
  assert.ok(json.data.endpointTested.includes("/login"));
  assert.ok(!JSON.stringify(json).includes("rahasia"));
});

test("POST /api/billing/test: gagal auth simulator tetap 200 dengan ok=false", async () => {
  const { status, json } = await call(billingTest, "/api/billing/test", {
    host: "billing.local",
    mode: "simulator",
    username: "bad-user",
  });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.ok, false);
  assert.equal(json.data.code, "AUTH_FAILED");
});

test("POST /api/billing/test: field kosong jatuh ke env BILLING_*", async () => {
  const { status, json } = await call(billingTest, "/api/billing/test", { mode: "simulator" });
  assert.equal(status, 200);
  assert.equal(json.data.ok, true);
  assert.equal(json.data.endpointTested, "GET http://billing.env.test:8080/login");
  assert.ok(!JSON.stringify(json).includes("env-pass"));
});

test("POST /api/billing/test: username env dipakai (bad-user via payload menang)", async () => {
  const { json } = await call(billingTest, "/api/billing/test", { mode: "simulator", username: "bad-user" });
  assert.equal(json.data.code, "AUTH_FAILED");
});

test("POST /api/billing/test: 422 untuk payload salah", async () => {
  for (const bad of [{ port: 0 }, { port: "80" }, { mode: "x" }, { extra: 1 }, { host: "" }]) {
    const { status, json } = await call(billingTest, "/api/billing/test", bad);
    assert.equal(status, 422, JSON.stringify(bad));
    assert.equal(json.error.code, "VALIDATION_ERROR");
  }
});

test("anonymous ditolak 401 di kedua endpoint", async () => {
  role = "anon";
  const a = await call(devicesTest, "/api/devices/test", { type: "billing", host: "h", mode: "simulator" });
  const b = await call(billingTest, "/api/billing/test", { host: "h", mode: "simulator" });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.json.error.code, "UNAUTHORIZED");
});

test("akun biasa tanpa izin manage ditolak 403 sebelum body dibaca", async () => {
  role = "user";
  const a = await call(devicesTest, "/api/devices/test", { type: "billing", host: "h", mode: "simulator" });
  const b = await call(billingTest, "/api/billing/test", { host: "h", mode: "simulator" });
  assert.equal(a.status, 403);
  assert.equal(b.status, 403);
  assert.equal(b.json.error.code, "FORBIDDEN");
});

test("origin asing ditolak 403", async () => {
  const req = new Request("http://localhost:3101/api/billing/test", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://evil.test" },
    body: JSON.stringify({ host: "h", mode: "simulator" }),
  });
  const res = await billingTest(req);
  assert.equal(res.status, 403);
});
