import test from "node:test";
import assert from "node:assert/strict";
import { mockOlts, getOltStats } from "../src/lib/dashboard/olts.ts";

test("mockOlts and getOltStats structure", () => {
  assert.equal(mockOlts.length, 3);
  const stats = getOltStats(mockOlts);
  assert.equal(stats.total, 3);
  assert.equal(stats.active, 2);
  assert.equal(stats.totalPon, 28);
  assert.equal(stats.totalOnu, 342);
});

import { validateOltInput, mockTestOltConnection } from "../src/lib/dashboard/olts.ts";

const valid = {
  name: "OLT-X", brand: "ZTE", driver: "zte-c320", host: "10.0.0.5",
  port: 23, username: "admin", password: "secret", totalPonPorts: 8,
};

test("validateOltInput accepts valid input", () => {
  assert.deepEqual(validateOltInput(valid), {});
});

test("validateOltInput reports each bad field", () => {
  const e = validateOltInput({ ...valid, name: " ", brand: "X", driver: "", host: "300.1.1.1", port: 0, username: "", password: "", totalPonPorts: 5 });
  assert.deepEqual(Object.keys(e).sort(), ["brand", "driver", "host", "name", "password", "port", "totalPonPorts", "username"]);
  assert.ok(validateOltInput({ ...valid, port: 70000 }).port);
  assert.ok(validateOltInput({ ...valid, port: 22.5 }).port);
});

test("mockTestOltConnection is deterministic by host", () => {
  assert.equal(mockTestOltConnection(valid).ok, true);
  assert.equal(mockTestOltConnection(valid).diagnostics.protocol, "Telnet");
  assert.equal(mockTestOltConnection({ ...valid, port: 22 }).diagnostics.protocol, "SSH");
  const t = mockTestOltConnection({ ...valid, host: "10.0.0.0" });
  assert.equal(t.ok, false);
  assert.match(t.reason, /timeout/i);
  const a = mockTestOltConnection({ ...valid, host: "10.0.0.255" });
  assert.equal(a.ok, false);
  assert.match(a.reason, /Autentikasi/);
});
