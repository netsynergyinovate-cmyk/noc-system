import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { runSimulatorDeviceTest } = await import("../src/lib/device-connection.ts");

const run = (host, extra = {}) =>
  runSimulatorDeviceTest({ type: "mikrotik", mode: "simulator", host, ...extra });

test("host normal: sukses dengan data resource", () => {
  const r = run("10.10.0.1", { username: "api", password: "x" });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "simulator");
  assert.equal(r.latencyMs, 12);
  assert.equal(r.data.version, "7.14 (stable)");
  assert.equal(r.data.boardName, "RB4011iGS+");
  assert.equal(r.data.cpuLoad, 8);
  assert.equal(r.data.uptime, "3d4h12m");
});

test("host .0: timeout", () => {
  const r = run("10.10.0.0");
  assert.equal(r.ok, false);
  assert.equal(r.code, "TIMEOUT");
  assert.match(r.message, /timeout/);
});

test("host .255: gagal auth 401", () => {
  const r = run("10.10.0.255");
  assert.equal(r.ok, false);
  assert.equal(r.code, "AUTH_FAILED");
  assert.match(r.message, /401/);
});

test("host invalid: gagal format host", () => {
  for (const bad of ["", "10.0.0.1/admin", "10.0 .0.1", "ftp://10.0.0.1"]) {
    const r = run(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.code, "INVALID_HOST", bad);
  }
});

test("deterministik: input sama, hasil sama", () => {
  assert.deepEqual(run("10.10.0.1"), run("10.10.0.1"));
});
