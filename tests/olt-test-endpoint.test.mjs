import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { testOltSchema } = await import("../src/validators/devices.ts");
const { HsgqClient } = await import("../src/lib/olt/hsgq-client.ts");

const base = { host: "10.0.0.5", username: "admin", password: "x" };
const make = (host, extra = {}) =>
  new HsgqClient({ ...base, host, mode: "simulator", ...extra });

test("testOltSchema: default port 80 dan mode real", () => {
  const r = testOltSchema.parse(base);
  assert.equal(r.port, 80);
  assert.equal(r.mode, "real");
});

test("testOltSchema: batas dan strict", () => {
  const bad = [
    { ...base, host: "" },
    { ...base, host: "a".repeat(256) },
    { ...base, port: 0 },
    { ...base, port: 65536 },
    { ...base, port: 1.5 },
    { ...base, username: "" },
    { ...base, password: "" },
    { ...base, password: "p".repeat(101) },
    { ...base, mode: "other" },
    { ...base, extra: 1 },
  ];
  for (const b of bad) assert.equal(testOltSchema.safeParse(b).success, false, JSON.stringify(b));
  assert.equal(testOltSchema.safeParse({ ...base, port: 65535, community: "public", brand: "HSGQ", driver: "hsgq" }).success, true);
});

test("HsgqClient simulator: sukses", async () => {
  const r = await make("10.0.0.5").testConnection();
  assert.equal(r.ok, true);
  assert.ok(r.data.model);
  assert.equal(r.data.ponPortCount, 8);
});

test("HsgqClient: INVALID_HOST untuk path/kredensial inline", () => {
  for (const bad of ["http://10.0.0.5/admin", "10.0.0.5/x", "http://u:p@10.0.0.5"]) {
    assert.throws(() => make(bad), { name: "DeviceConnectionError", code: "INVALID_HOST" }, bad);
  }
});

test("HsgqClient simulator: .0 TIMEOUT, .255 AUTH_FAILED", async () => {
  const to = await make("10.0.0.0").testConnection();
  assert.deepEqual([to.ok, to.code], [false, "TIMEOUT"]);
  const au = await make("10.0.0.255").testConnection();
  assert.deepEqual([au.ok, au.code], [false, "AUTH_FAILED"]);
});
