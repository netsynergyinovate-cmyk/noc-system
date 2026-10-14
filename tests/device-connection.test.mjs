import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const {
  parseMikrotikResource,
  sanitizeHost,
  runSimulatorDeviceTest,
  describeNetworkError,
} = await import("../src/lib/device-connection.ts");

test("sanitizeHost: port eksplisit dan spasi", () => {
  assert.equal(sanitizeHost("10.0.0.1", 8728).port, "8728");
  assert.equal(sanitizeHost("10.0.0.1:81", 8728).port, "81");
  assert.throws(() => sanitizeHost("10.0.0.1", 70000), { name: "DeviceConnectionError" });
  assert.throws(() => sanitizeHost("10.0 .0.1"), { name: "DeviceConnectionError" });
  assert.throws(() => sanitizeHost("http://u:p@10.0.0.1"), { name: "DeviceConnectionError" });
});

test("simulator: 4 perangkat sukses, .0 timeout, .255 401", () => {
  for (const type of ["mikrotik", "olt", "genieacs", "billing"]) {
    const ok = runSimulatorDeviceTest({ type, mode: "simulator", host: "10.0.0.5" });
    assert.equal(ok.ok, true, type);
    assert.equal(ok.mode, "simulator");
    assert.ok(ok.data, type);
    const to = runSimulatorDeviceTest({ type, mode: "simulator", host: "10.0.0.0" });
    assert.equal(to.ok, false);
    assert.equal(to.code, "TIMEOUT");
    const au = runSimulatorDeviceTest({ type, mode: "simulator", host: "10.0.0.255" });
    assert.equal(au.ok, false);
    assert.equal(au.code, "AUTH_FAILED");
  }
  const mk = runSimulatorDeviceTest({ type: "mikrotik", mode: "simulator", host: "1.2.3.4" });
  assert.equal(mk.data.boardName, "RB4011iGS+");
  const bad = runSimulatorDeviceTest({ type: "olt", mode: "simulator", host: "1.2.3.4/x" });
  assert.equal(bad.code, "INVALID_HOST");
});

test("describeNetworkError", () => {
  const abort = Object.assign(new Error("x"), { name: "AbortError" });
  assert.equal(describeNetworkError(abort, "router").code, "TIMEOUT");
  assert.equal(describeNetworkError(new Error("connect ECONNREFUSED"), "OLT").code, "CONNECTION_REFUSED");
  assert.equal(describeNetworkError(new Error("getaddrinfo ENOTFOUND h"), "OLT").code, "DNS_ERROR");
  assert.equal(
    describeNetworkError(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }), "r").code,
    "CONNECTION_REFUSED",
  );
  assert.equal(describeNetworkError("aneh", "r").code, "CONNECTION_FAILED");
});

test("parser resource MikroTik", () => {
  assert.deepEqual(
    parseMikrotikResource({
      version: "7.14 (stable)",
      "cpu-load": "12",
      uptime: "1d2h3m",
      "board-name": "RB4011",
    }),
    { version: "7.14 (stable)", cpuLoad: 12, uptime: "1d2h3m", boardName: "RB4011" },
  );
  assert.equal(parseMikrotikResource([{ "cpu-load": 5 }]).cpuLoad, 5);
});

test("parser tahan data aneh", () => {
  for (const bad of [null, undefined, "x", 3]) {
    assert.deepEqual(parseMikrotikResource(bad), {});
  }
  assert.equal(parseMikrotikResource({ "cpu-load": "abc" }).cpuLoad, undefined);
});

test("host valid diterima", () => {
  assert.equal(sanitizeHost("192.168.1.1").origin, "http://192.168.1.1");
  assert.equal(sanitizeHost("https://r.example.com:8729/").port, "8729");
  assert.equal(sanitizeHost(" 10.0.0.1:8080 ").port, "8080");
});

test("host berbahaya ditolak", () => {
  for (const bad of [
    "",
    "10.0.0.1/admin",
    "http://10.0.0.1/rest/x",
    "http://10.0.0.1?a=1",
    "ftp://10.0.0.1",
    "file:///etc/passwd",
    "user:pw@10.0.0.1",
    "10.0.0.1:0",
    "10.0.0.1:70000",
    "10.0.0.1:abc",
  ]) {
    assert.throws(() => sanitizeHost(bad), { name: "DeviceConnectionError" }, bad);
  }
});
