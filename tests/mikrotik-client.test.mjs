import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { MikrotikRestClient } = await import("../src/lib/mikrotik/client.ts");

const make = (host, extra = {}) =>
  new MikrotikRestClient({ host, username: "admin", password: "x", mode: "simulator", ...extra });

test("anti-SSRF: host ber-path/query/kredensial ditolak", () => {
  assert.ok(make("10.0.0.5"));
  for (const bad of ["http://10.0.0.5/admin", "10.0.0.5/?a=1", "http://u:p@10.0.0.5", "ftp://10.0.0.5", ""]) {
    assert.throws(() => make(bad), { name: "DeviceConnectionError", code: "INVALID_HOST" }, bad);
  }
});

test("simulator: testConnection sukses, .0 timeout, .255 auth failed", async () => {
  const ok = await make("10.0.0.5").testConnection();
  assert.equal(ok.ok, true);
  assert.equal(ok.resource.boardName, "RB4011iGS+");
  const to = await make("10.0.0.0").testConnection();
  assert.deepEqual([to.ok, to.code], [false, "TIMEOUT"]);
  const au = await make("10.0.0.255").testConnection();
  assert.deepEqual([au.ok, au.code], [false, "AUTH_FAILED"]);
});

test("simulator: getResource, getQueues, getInterfaces berstruktur valid", async () => {
  const c = make("10.0.0.5");
  const r = await c.getResource();
  assert.equal(typeof r.cpuLoad, "number");
  assert.ok(r.totalMemory > r.freeMemory);
  const q = await c.getQueues();
  assert.ok(q.length > 0);
  for (const x of q) {
    assert.equal(typeof x.id, "string");
    assert.equal(typeof x.disabled, "boolean");
    assert.ok(x.name && x.target);
  }
  const ifs = await c.getInterfaces();
  assert.ok(ifs.some((i) => i.name === "ether8"));
  assert.ok(ifs.some((i) => i.name === "sfp-sfpplus1"));
  assert.deepEqual(await c.getResource(), r); // deterministik
  await assert.rejects(make("10.0.0.255").getQueues(), { code: "AUTH_FAILED" });
});

test("mode real: kegagalan jaringan dipetakan ke kode, tanpa jaringan sungguhan", async () => {
  // Port 1 di loopback: ditolak seketika.
  const res = await new MikrotikRestClient({
    host: "127.0.0.1", port: 1, username: "a", password: "b", mode: "real", timeoutMs: 2000,
  }).testConnection();
  assert.equal(res.ok, false);
  assert.ok(["CONNECTION_REFUSED", "NETWORK_ERROR", "TIMEOUT"].includes(res.code), res.code);
});

test("TLS dibaca dari skema atau port 443/8443; useSsl eksplisit menang", () => {
  const tls = (host, extra) => make(host, extra).target.tls;
  assert.equal(tls("10.0.0.5"), false);
  assert.equal(tls("10.0.0.5:2024"), false);
  assert.equal(tls("10.0.0.5:443"), true);
  assert.equal(tls("10.0.0.5:8443"), true);
  assert.equal(tls("https://10.0.0.5"), true);
  assert.equal(tls("10.0.0.5", { port: 443 }), true);
  assert.equal(tls("10.0.0.5", { useSsl: true, port: 2024 }), true);
  assert.equal(tls("10.0.0.5:443", { useSsl: false }), false);
  assert.deepEqual(
    { ...make("https://10.0.0.5").target },
    { host: "10.0.0.5", port: 443, tls: true, endpoint: "GET https://10.0.0.5/rest/system/resource" },
  );
  assert.equal(make("10.0.0.5:2024").target.port, 2024);
  assert.equal(make("10.0.0.5").target.port, 80);
});

test("mode real: port API biner 8728/8729 ditolak tanpa koneksi", async () => {
  for (const port of [8728, 8729]) {
    const res = await new MikrotikRestClient({
      host: "10.0.0.5", port, username: "a", password: "b", mode: "real", timeoutMs: 500,
    }).testConnection();
    assert.deepEqual([res.ok, res.code], [false, "WRONG_PORT"], String(port));
  }
});

test("host tersimpan menjaga port dan TLS, dan terbaca sama oleh klien", async () => {
  const { sanitizeHost, storedRouterHost } = await import("../src/lib/device-connection.ts");
  const store = (host, port, useSsl) => {
    const url = sanitizeHost(host, port);
    return storedRouterHost(url, useSsl ?? (url.protocol === "https:" || [443, 8443].includes(Number(url.port))));
  };
  assert.equal(store("10.0.0.5"), "10.0.0.5");
  assert.equal(store("10.0.0.5", 2024), "10.0.0.5:2024");
  assert.equal(store("10.0.0.5:2024"), "10.0.0.5:2024");
  assert.equal(store("10.0.0.5", 443, true), "10.0.0.5:443");
  assert.equal(store("https://10.0.0.5"), "10.0.0.5:443");
  assert.equal(store("10.0.0.5", 2024, true), "https://10.0.0.5:2024");
  assert.equal(store("10.0.0.5", undefined, true), "10.0.0.5:443");
  assert.throws(() => store("10.0.0.5", 443, false), { code: "INVALID_HOST" });
  for (const [host, port, ssl] of [["10.0.0.5", 2024, true], ["10.0.0.5", 443, true], ["10.0.0.5", 2024, false], ["10.0.0.5", undefined, false]]) {
    const t = make(store(host, port, ssl)).target;
    assert.deepEqual([t.port, t.tls], [port ?? (ssl ? 443 : 80), ssl], `${host} ${port} ${ssl}`);
  }
});
