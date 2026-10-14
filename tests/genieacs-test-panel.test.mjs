import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { describeConnectionTroubleshoot: d } = await import(
  "../src/components/dashboard/connection-error-notice.tsx"
);
const { runSimulatorDeviceTest } = await import("../src/lib/device-connection.ts");

const run = (host) =>
  runSimulatorDeviceTest({ type: "genieacs", mode: "simulator", host, port: 7557 });

test("genieacs CONNECTION_REFUSED: port 7557 + systemctl", () => {
  const r = d("CONNECTION_REFUSED", "genieacs");
  assert.match(r.hint, /7557/);
  assert.equal(r.command, "systemctl status genieacs-nbi");
});

test("genieacs TIMEOUT dan AUTH_FAILED: saran khusus", () => {
  assert.match(d("TIMEOUT", "genieacs").hint, /7557/);
  assert.match(d("AUTH_FAILED", "genieacs").hint, /Basic Auth/);
});

test("tipe lain tidak terpengaruh", () => {
  assert.equal(d("CONNECTION_REFUSED", "olt").command, undefined);
});

test("simulator genieacs: host normal sukses", () => {
  const r = run("http://192.168.1.10:7557");
  assert.equal(r.ok, true);
  assert.equal(typeof r.latencyMs, "number");
  assert.equal(r.data.deviceCount, 42);
});

test("simulator genieacs: .0 TIMEOUT, .255 AUTH_FAILED, invalid INVALID_HOST", () => {
  assert.equal(run("10.0.0.0").code, "TIMEOUT");
  assert.equal(run("10.0.0.255").code, "AUTH_FAILED");
  assert.equal(run("ftp://x").code, "INVALID_HOST");
  assert.equal(run("bad host").code, "INVALID_HOST");
});
