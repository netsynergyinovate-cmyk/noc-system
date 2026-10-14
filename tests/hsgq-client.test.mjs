import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { HsgqClient } = await import("../src/lib/olt/hsgq-client.ts");

const make = (host, extra = {}) =>
  new HsgqClient({ host, username: "admin", password: "x", community: "public", mode: "simulator", ...extra });

const ENV_KEYS = [
  "OLT_HSGQ_HOST", "OLT_HOST", "OLT_HSGQ_PORT", "OLT_PORT", "OLT_HSGQ_USER", "OLT_USERNAME",
  "OLT_HSGQ_PASSWORD", "OLT_PASSWORD", "OLT_COMMUNITY", "DASHBOARD_DATA",
];
function withEnv(env, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}
const optsOf = (c) => c.opts;

test("anti-SSRF: host ber-path/query/kredensial ditolak", () => {
  assert.ok(make("10.0.0.5"));
  for (const bad of ["http://10.0.0.5/admin", "10.0.0.5/?a=1", "http://u:p@10.0.0.5", "ftp://10.0.0.5", ""]) {
    assert.throws(() => make(bad), { name: "DeviceConnectionError", code: "INVALID_HOST" }, bad);
  }
});

test("fromEnv: default", () => {
  withEnv({}, () => {
    const o = optsOf(HsgqClient.fromEnv());
    assert.deepEqual(
      [o.host, o.port, o.username, o.password, o.community, o.mode],
      ["127.0.0.1", 80, "admin", "", "public", "simulator"],
    );
  });
});

test("fromEnv: env, fallback, live mode, overrides", () => {
  withEnv({ OLT_HOST: "10.1.1.1", OLT_PORT: "8080", OLT_USERNAME: "u", OLT_PASSWORD: "p", DASHBOARD_DATA: "live" }, () => {
    const o = optsOf(HsgqClient.fromEnv());
    assert.deepEqual([o.host, o.port, o.username, o.password, o.mode], ["10.1.1.1", 8080, "u", "p", "real"]);
  });
  withEnv({ OLT_HOST: "10.1.1.1", OLT_HSGQ_HOST: "10.2.2.2", OLT_COMMUNITY: "priv" }, () => {
    const o = optsOf(HsgqClient.fromEnv({ mode: "real", username: "root" }));
    assert.deepEqual([o.host, o.community, o.mode, o.username], ["10.2.2.2", "priv", "real", "root"]);
  });
  withEnv({ OLT_HSGQ_HOST: "http://10.0.0.1/x" }, () => {
    assert.throws(() => HsgqClient.fromEnv(), { code: "INVALID_HOST" });
  });
});

test("simulator: testConnection sukses, .0 timeout, .255 auth failed", async () => {
  const ok = await make("10.0.0.5").testConnection();
  assert.equal(ok.ok, true);
  assert.ok(ok.data.model);
  assert.equal(ok.data.ponPortCount, 8);
  const to = await make("10.0.0.0").testConnection();
  assert.deepEqual([to.ok, to.code], [false, "TIMEOUT"]);
  const au = await make("10.0.0.255").testConnection();
  assert.deepEqual([au.ok, au.code], [false, "AUTH_FAILED"]);
});

test("simulator: getPonPorts 8 port berstruktur lengkap", async () => {
  const ports = await make("10.0.0.5").getPonPorts();
  assert.equal(ports.length, 8);
  ports.forEach((p, i) => {
    assert.equal(p.ponIndex, i + 1);
    assert.equal(p.name, `PON ${i + 1}`);
    assert.equal(p.capacity, 128);
    assert.equal(p.status, "up");
    for (const k of ["rxPowerDbm", "txPowerDbm", "attenuationDb"]) assert.equal(typeof p[k], "number");
    assert.ok(p.onuOnlineCount >= 0 && p.onuOnlineCount <= 128);
  });
  await assert.rejects(make("10.0.0.0").getPonPorts(), { code: "TIMEOUT" });
});

test("simulator: getOnus dan filter ponIndex", async () => {
  const c = make("10.0.0.5");
  const all = await c.getOnus();
  assert.ok(all.length > 0);
  for (const o of all) {
    assert.match(o.serialNumber, /^HSGQ/);
    assert.match(o.macAddress, /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    assert.ok(["online", "offline", "los"].includes(o.status));
    if (o.status !== "online") assert.equal(o.rxPowerDbm, null);
  }
  assert.deepEqual(new Set(all.map((o) => o.status)), new Set(["online", "offline", "los"]));
  const p3 = await c.getOnus(3);
  assert.ok(p3.length > 0 && p3.every((o) => o.ponIndex === 3));
  assert.equal((await c.getOnus(99)).length, 0);
  assert.deepEqual(await c.getOnus(), all); // deterministik
});
