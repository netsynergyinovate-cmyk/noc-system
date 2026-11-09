import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOpticalLoss,
  getOnuTxStatus,
} from "../src/lib/dashboard/optical.ts";

test("calculateOpticalLoss", () => {
  assert.equal(calculateOpticalLoss(2.5, -22.0), 24.5);
  assert.equal(calculateOpticalLoss(2.5, null), null);
  assert.equal(calculateOpticalLoss(2.5, undefined), null);
  assert.equal(calculateOpticalLoss(2.5, -35), null);
  assert.equal(calculateOpticalLoss(2.5, -40), null);
  assert.equal(calculateOpticalLoss(null, -22), null);
  assert.equal(calculateOpticalLoss(undefined, -22), null);
});

test("getOnuTxStatus", () => {
  assert.equal(getOnuTxStatus(2.0).ok, true);
  assert.equal(getOnuTxStatus(1.0).ok, true);
  assert.equal(getOnuTxStatus(3.5).ok, true);
  assert.equal(getOnuTxStatus(0.5).ok, false);
  assert.equal(getOnuTxStatus(4.0).ok, false);
  assert.equal(getOnuTxStatus(null).ok, false);
});
