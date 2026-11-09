import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { testRouterSchema } = await import("../src/validators/routers.ts");
const { MikrotikRestClient } = await import("../src/lib/mikrotik/client.ts");

const valid = { host: "10.0.0.5", username: "admin", password: "x" };
const ok = (o) => testRouterSchema.safeParse({ ...valid, ...o }).success;

test("skema: host, port, username, password, mode", () => {
  assert.ok(ok({}));
  assert.ok(ok({ port: 8728, useSsl: true, mode: "simulator" }));
  assert.ok(ok({ password: "" })); // RouterOS boleh tanpa password
  assert.equal(
    testRouterSchema.parse({ ...valid, host: "  10.0.0.5 " }).host,
    "10.0.0.5",
  );
  assert.ok(!ok({ host: "" }));
  assert.ok(!ok({ host: "a".repeat(256) }));
  assert.ok(!ok({ username: "" }));
  assert.ok(!ok({ username: "a".repeat(101) }));
  assert.ok(!ok({ password: "a".repeat(101) }));
  assert.ok(!ok({ password: undefined }));
  for (const port of [0, 65536, 1.5, "80"])
    assert.ok(!ok({ port }), String(port));
  assert.ok(!ok({ mode: "fake" }));
  assert.ok(!ok({ useSsl: "yes" }));
});

const make = (o) =>
  new MikrotikRestClient({ ...valid, mode: "simulator", ...o });

test("klien: simulator sukses mengisi kunci yang dipakai route", async () => {
  const r = await make().testConnection();
  assert.equal(r.ok, true);
  assert.equal(typeof r.resource.version, "string");
  assert.equal(typeof r.resource.cpuLoad, "number");
  assert.equal(r.resource.boardName, "RB4011iGS+");
});

test("klien: host invalid (SSRF) ditolak di constructor dengan INVALID_HOST", () => {
  for (const host of [
    "http://10.0.0.5/admin",
    "10.0.0.5/?a=1",
    "http://u:p@10.0.0.5",
    "ftp://10.0.0.5",
  ]) {
    assert.throws(() => make({ host }), { code: "INVALID_HOST" }, host);
  }
});

test("klien: host .0 timeout, .255 auth gagal", async () => {
  const to = await make({ host: "10.0.0.0" }).testConnection();
  assert.deepEqual([to.ok, to.code], [false, "TIMEOUT"]);
  const au = await make({ host: "10.0.0.255" }).testConnection();
  assert.deepEqual([au.ok, au.code], [false, "AUTH_FAILED"]);
});
