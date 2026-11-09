import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { isValidPonId, getPonPortDetailOrNull } =
  await import("../src/lib/dashboard/pon-ports.ts");
const { describeConnectionTroubleshoot: d } =
  await import("../src/components/dashboard/connection-error-notice.tsx");

test("isValidPonId: id sah", () => {
  for (const id of ["olt-1-pon-1", "olt-2-pon-8"])
    assert.equal(isValidPonId(id), true);
});

test("isValidPonId: id tidak sah", () => {
  for (const id of [
    "xyz",
    "olt-1",
    "olt-1-pon",
    "",
    "olt-1-pon-1\n",
    "x-olt-1-pon-1",
  ]) {
    assert.equal(isValidPonId(id), false, id);
  }
});

test("getPonPortDetailOrNull", () => {
  assert.equal(getPonPortDetailOrNull("xyz"), null);
  assert.equal(getPonPortDetailOrNull("olt-1-pon-2")?.ponIndex, 2);
});

test("troubleshoot OLT: TIMEOUT dan AUTH_FAILED spesifik", () => {
  assert.match(d("TIMEOUT", "olt").hint, /SNMP 161|HSGQ/);
  assert.match(d("AUTH_FAILED", "olt").hint, /community string/);
  assert.doesNotMatch(d("TIMEOUT", "mikrotik").hint, /SNMP/);
});
