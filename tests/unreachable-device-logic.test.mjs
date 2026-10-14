import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();
const { diagnoseUnreachableDevice, computeRetryPolicy, mapFailureCode, formatDowntime } =
  await import("../src/lib/dashboard/unreachable-device-logic.ts");

const base = {
  deviceId: "d1",
  deviceName: "RB-1",
  deviceType: "router",
  endpoint: "10.0.0.1:443/rest/system/resource",
  lastSeenEpoch: 1000,
  nowSec: 1900,
};

test("downtime akurat, null lastSeen = 0, tidak negatif", () => {
  assert.equal(diagnoseUnreachableDevice(base).downtimeSeconds, 900);
  assert.equal(diagnoseUnreachableDevice({ ...base, lastSeenEpoch: null }).downtimeSeconds, 0);
  assert.equal(diagnoseUnreachableDevice({ ...base, lastSeenEpoch: 5000 }).downtimeSeconds, 0);
});

test("langkah & CLI spesifik per tipe perangkat", () => {
  const mt = diagnoseUnreachableDevice(base);
  const olt = diagnoseUnreachableDevice({ ...base, deviceType: "olt", endpoint: "10.0.0.9:23" });
  const acs = diagnoseUnreachableDevice({ ...base, deviceType: "genieacs", endpoint: "10.0.0.5:7557" });
  for (const r of [mt, olt, acs]) assert.equal(r.troubleshootingSteps.length, 3);
  assert.match(mt.suggestedCliCommand, /\/ip service print/);
  assert.match(mt.suggestedCliCommand, /ping 10\.0\.0\.1/);
  assert.match(olt.suggestedCliCommand, /ping 10\.0\.0\.9/);
  assert.match(acs.suggestedCliCommand, /7557/);
  assert.notDeepEqual(mt.troubleshootingSteps, olt.troubleshootingSteps);
  assert.notDeepEqual(olt.troubleshootingSteps, acs.troubleshootingSteps);
});

test("failureCode dipetakan tepat", () => {
  const cases = {
    TIMEOUT: "TIMEOUT",
    ETIMEDOUT: "TIMEOUT",
    ECONNREFUSED: "CONNECTION_REFUSED",
    CONNECTION_REFUSED: "CONNECTION_REFUSED",
    AUTH_FAILED: "AUTH_FAILED",
    DNS_ERROR: "HOST_UNREACHABLE",
    EHOSTUNREACH: "HOST_UNREACHABLE",
    aneh: "UNKNOWN",
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(mapFailureCode(raw), want);
  assert.equal(mapFailureCode(undefined), "UNKNOWN");
  const r = diagnoseUnreachableDevice({ ...base, errorCode: "AUTH_FAILED", consecutiveFailures: 3 });
  assert.equal(r.failureCode, "AUTH_FAILED");
  assert.equal(r.consecutiveFailures, 3);
  assert.match(r.troubleshootingSteps[0], /username/);
});

test("backoff eksponensial 2,5,10,20,30 dan mentok 30 dtk", () => {
  const ms = [1, 2, 3, 4, 5, 6, 50].map((n) => computeRetryPolicy(n, 0, 0).backoffMs);
  assert.deepEqual(ms, [2000, 5000, 10000, 20000, 30000, 30000, 30000]);
  assert.equal(computeRetryPolicy(0, 0, 0).backoffMs, 2000);
  assert.equal(computeRetryPolicy(NaN, 0, 0).backoffMs, 2000);
});

test("canRetryNow mengikuti jadwal", () => {
  const p = computeRetryPolicy(2, 100, 104);
  assert.equal(p.nextRetryEpoch, 105);
  assert.equal(p.canRetryNow, false);
  assert.equal(computeRetryPolicy(2, 100, 105).canRetryNow, true);
  assert.equal(computeRetryPolicy(2, 100, 200).canRetryNow, true);
});

test("formatDowntime", () => {
  assert.equal(formatDowntime(30), "30 detik");
  assert.equal(formatDowntime(900), "15 menit");
  assert.equal(formatDowntime(3720), "1 jam 2 menit");
});

test("komponen diekspor & terpasang di halaman Router dan CPE", () => {
  const comp = readFileSync("src/components/dashboard/unreachable-device-banner.tsx", "utf8");
  assert.match(comp, /^"use client"/);
  assert.match(comp, /export function UnreachableDeviceBanner/);
  assert.match(comp, /data-testid="unreachable-device-banner"/);
  assert.match(comp, /data-testid="retry-connection-btn"/);
  assert.match(comp, /href="\/setup"/);
  assert.match(readFileSync("src/app/(protected)/app/router/page.tsx", "utf8"), /<UnreachableDeviceBanner scope="router"/);
  assert.match(readFileSync("src/app/(protected)/app/cpe/page.tsx", "utf8"), /<UnreachableDeviceBanner scope="olt"/);
});
