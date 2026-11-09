import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDevice,
  mockTestConnection,
} from "../src/lib/dashboard/devices.ts";

const ok = {
  kind: "router",
  name: "R",
  host: "10.0.0.1",
  username: "u",
  password: "p",
};

test("validateDevice", () => {
  assert.deepEqual(validateDevice(ok), {});
  assert.ok(validateDevice({ ...ok, host: "300.1.1.1" }).host);
  assert.ok(validateDevice({ ...ok, host: "a b" }).host);
  assert.ok(validateDevice({ ...ok, name: " ", password: "" }).name);
});

test("mockTestConnection", () => {
  const good = mockTestConnection(ok);
  assert.equal(good.ok, true);
  assert.equal(good.diagnostics.protocol, "MikroTik REST API v7");
  assert.equal(good.diagnostics.firmware, "RouterOS v7.14.3");
  assert.equal(good.diagnostics.cpuLoad, 9);
  assert.equal(
    mockTestConnection({ ...ok, kind: "olt" }).diagnostics.firmware,
    "ZTE C320 V2.1.0",
  );

  const timeout = mockTestConnection({ ...ok, host: "10.0.0.0" });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.reason, "Host timeout setelah 3000ms");
  assert.equal(timeout.diagnostics.latencyMs, 3000);
  assert.equal(timeout.diagnostics.protocol, "REST API v7 (443)");
  assert.equal(
    mockTestConnection({ ...ok, kind: "olt", host: "10.0.0.0" }).diagnostics
      .protocol,
    "OLT CLI (23)",
  );

  const auth = mockTestConnection({ ...ok, host: "10.0.0.255" });
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /401/);
  assert.equal(auth.diagnostics.latencyMs, 18);
  assert.equal(auth.diagnostics.firmware, undefined);
});
