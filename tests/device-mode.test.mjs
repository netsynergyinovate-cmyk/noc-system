import test from "node:test";
import assert from "node:assert/strict";
import {
  getDeviceMode,
  getDeviceModeServerSnapshot,
  getModeDescription,
  setDeviceMode,
  subscribeDeviceMode,
} from "../src/lib/dashboard/device-mode.ts";

test("device-mode: snapshot server selalu simulator", () => {
  assert.equal(getDeviceModeServerSnapshot().mode, "simulator");
  assert.equal(getDeviceMode().mode, "simulator");
});

test("device-mode: setDeviceMode memberi tahu pelanggan dan mengubah mode", () => {
  let calls = 0;
  const unsub = subscribeDeviceMode(() => calls++);
  setDeviceMode("real");
  assert.equal(getDeviceMode().mode, "real");
  assert.equal(calls, 1);
  unsub();
  setDeviceMode("simulator");
  assert.equal(calls, 1);
  assert.equal(getDeviceMode().mode, "simulator");
});

test("device-mode: hanya mode fisik yang punya peringatan", () => {
  assert.equal(getModeDescription("simulator").warning, undefined);
  assert.ok(getModeDescription("real").warning);
});
