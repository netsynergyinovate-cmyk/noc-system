import test from "node:test";
import assert from "node:assert/strict";
import {
  getOpticalSignalStatus,
  getPonPortOpticalStatus,
} from "../src/lib/dashboard/optical.ts";

test("getOpticalSignalStatus: semua batas", () => {
  const cases = [
    [null, "los", true],
    [undefined, "los", true],
    [-35, "los", true],
    [-40, "los", true],
    [-34.9, "critical", true],
    [-30.1, "critical", true],
    [-30, "critical", true],
    [-29.9, "warning", true],
    [-26, "warning", true],
    [-25.9, "ideal", false],
    [-25.38, "ideal", false],
    [-25.01, "ideal", false],
    [-25, "ideal", false],
    [-24, "ideal", false],
    [-15, "ideal", false],
    [-8, "ideal", false],
    [-7.9, "overload", true],
    [0, "overload", true],
  ];
  for (const [rx, level, out] of cases) {
    const s = getOpticalSignalStatus(rx);
    assert.equal(s.level, level, `rx=${rx}`);
    assert.equal(s.isOutOfThreshold, out, `rx=${rx}`);
  }
  assert.equal(getOpticalSignalStatus(-30).tone, "danger");
  assert.equal(getOpticalSignalStatus(-26).tone, "warning");
  assert.equal(getOpticalSignalStatus(-5).tone, "warning");
  assert.equal(getOpticalSignalStatus(-20).tone, "success");
  assert.equal(getOpticalSignalStatus(-20).label, "Normal");
});

test("getPonPortOpticalStatus: batas Tx dan Rx inklusif", () => {
  assert.deepEqual(getPonPortOpticalStatus(-20, 3), {
    isTxNormal: true,
    isRxNormal: true,
    isOutOfThreshold: false,
  });
  assert.equal(getPonPortOpticalStatus(-20, 1.5).isTxNormal, true);
  assert.equal(getPonPortOpticalStatus(-20, 5.0).isTxNormal, true);
  assert.equal(getPonPortOpticalStatus(-20, 1.4).isTxNormal, false);
  assert.equal(getPonPortOpticalStatus(-20, 5.1).isTxNormal, false);
  assert.equal(getPonPortOpticalStatus(-8, 3).isRxNormal, true);
  assert.equal(getPonPortOpticalStatus(-28, 3).isRxNormal, true);
  assert.equal(getPonPortOpticalStatus(-7.9, 3).isRxNormal, false);
  assert.equal(getPonPortOpticalStatus(-28.1, 3).isRxNormal, false);
  assert.equal(getPonPortOpticalStatus(-28.1, 3).isOutOfThreshold, true);
  assert.equal(getPonPortOpticalStatus(-20, 6).isOutOfThreshold, true);
});
