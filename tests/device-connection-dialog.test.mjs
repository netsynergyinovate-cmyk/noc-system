import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatDeviceEndpoint,
  evaluateConnectionTestOutcome,
  getRecommendedActionForFailure,
} from "../src/lib/dashboard/device-connection-modal.ts";

test("formatDeviceEndpoint", () => {
  assert.equal(formatDeviceEndpoint("mikrotik", "10.0.0.1", 443), "https://10.0.0.1:443/rest");
  assert.equal(formatDeviceEndpoint("olt", " 10.0.0.2 ", 80), "http://10.0.0.2:80");
  assert.equal(formatDeviceEndpoint("genieacs", "g.local", 7557), "http://g.local:7557");
});

test("evaluate: sukses simulator", () => {
  const r = evaluateConnectionTestOutcome(
    { ok: true, status: "connected", latencyMs: 12, timestamp: 1700000000, message: "ok", data: { version: "7.14", cpuLoad: 8, nested: { a: 1 } } },
    "mikrotik",
  );
  assert.equal(r.ok, true);
  assert.equal(r.status, "connected");
  assert.equal(r.latencyMs, 12);
  assert.deepEqual(r.details, { version: "7.14", cpuLoad: 8 });
  assert.equal(r.testedAt, new Date(1700000000000).toISOString());
  assert.equal(r.deviceType, "mikrotik");
});

test("evaluate: kegagalan dipetakan", () => {
  const e = (raw) => evaluateConnectionTestOutcome(raw, "olt").status;
  assert.equal(e({ ok: false, code: "AUTH_FAILED" }), "unauthorized");
  assert.equal(e({ ok: false, statusCode: 403 }), "unauthorized");
  assert.equal(e({ ok: false, code: "CONNECTION_REFUSED", status: "error" }), "refused");
  assert.equal(e({ ok: false, status: "timeout" }), "timeout");
  assert.equal(e({ ok: false, code: "HTTP_ERROR" }), "error");
  const n = evaluateConnectionTestOutcome(null, "olt");
  assert.equal(n.ok, false);
  assert.equal(n.latencyMs, null);
});

test("getRecommendedActionForFailure", () => {
  assert.match(getRecommendedActionForFailure("unauthorized"), /password/i);
  assert.match(getRecommendedActionForFailure("timeout"), /firewall/i);
  assert.match(getRecommendedActionForFailure("refused"), /port/i);
  assert.match(getRecommendedActionForFailure("error"), /gagal/i);
  assert.equal(getRecommendedActionForFailure("connected"), "");
});

test("komponen & integrasi grid", () => {
  const dlg = readFileSync("src/components/dashboard/device-connection-test-dialog.tsx", "utf8");
  assert.match(dlg, /export function DeviceConnectionTestDialog/);
  for (const id of ["device-connection-dialog", "run-test-button", "test-outcome-panel"]) {
    assert.ok(dlg.includes(`data-testid="${id}"`), id);
  }
  const grid = readFileSync("src/components/dashboard/device-status-card-grid.tsx", "utf8");
  assert.match(grid, /import \{ DeviceConnectionTestDialog \}/);
  assert.match(grid, /<DeviceConnectionTestDialog/);
});
