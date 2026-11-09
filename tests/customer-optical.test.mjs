import test from "node:test";
import assert from "node:assert/strict";
import { getCustomerOpticalInfo, mockOnus } from "../src/lib/dashboard/onus.ts";

test("uses ONU inventory when customer matches", () => {
  const onu = mockOnus.find((o) => o.customerId && o.status === "online");
  const info = getCustomerOpticalInfo({
    id: onu.customerId,
    pppoeUsername: "x",
    opticalPowerDbm: -99,
    isOnline: true,
  });
  assert.equal(info.serialNumber, onu.serialNumber);
  assert.equal(info.rxPowerDbm, onu.rxPowerDbm);
  assert.equal(
    info.attenuationDb,
    Math.round((onu.txPowerDbm - onu.rxPowerDbm) * 10) / 10,
  );
});

test("offline customer has no rx or attenuation", () => {
  const info = getCustomerOpticalInfo({
    id: "zz",
    pppoeUsername: "zz",
    opticalPowerDbm: -20,
    isOnline: false,
  });
  assert.equal(info.rxPowerDbm, null);
  assert.equal(info.attenuationDb, null);
  assert.equal(info.isOnline, false);
});

test("fallback is deterministic and in range", () => {
  const c = {
    id: "unknown-1",
    pppoeUsername: "unknown1",
    opticalPowerDbm: -22.4,
    isOnline: true,
  };
  const a = getCustomerOpticalInfo(c);
  assert.deepEqual(a, getCustomerOpticalInfo(c));
  assert.equal(a.rxPowerDbm, -22.4);
  assert.ok(a.distanceMeters >= 800 && a.distanceMeters <= 2500);
  assert.ok(a.txPowerDbm >= 2.2 && a.txPowerDbm <= 2.6);
  assert.equal(a.attenuationDb, Math.round((a.txPowerDbm + 22.4) * 10) / 10);
});
