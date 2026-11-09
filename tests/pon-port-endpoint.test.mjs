import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { ponIndexSchema: s } = await import("../src/validators/devices.ts");
const { getMockPonPortDetail, WEAK_RX_DBM } =
  await import("../src/lib/dashboard/pon-ports.ts");

test("ponIndex: terima bilangan bulat >= 1", () => {
  assert.equal(s.parse("1"), 1);
  assert.equal(s.parse("16"), 16);
});

test("ponIndex: tolak string, negatif, desimal, nol, kosong", () => {
  for (const v of [
    "abc",
    "-1",
    "1.5",
    "0",
    "",
    " 1",
    "1e2",
    "0x10",
    "+1",
    "1234567",
  ]) {
    assert.equal(s.safeParse(v).success, false, v);
  }
});

test("kontrak data optik PON port (mock)", () => {
  const d = getMockPonPortDetail("olt-1-pon-3");
  for (const k of [
    "oltName",
    "oltHost",
    "ponIndex",
    "txPowerDbm",
    "rxPowerDbm",
    "attenuationDb",
    "totalOnu",
    "onlineOnu",
    "syncedAt",
    "onus",
  ]) {
    assert.ok(k in d, k);
  }
  assert.equal(d.ponIndex, 3);
  assert.equal(d.totalOnu, d.onus.length);
  assert.equal(d.onlineOnu, d.onus.filter((o) => o.status === "online").length);
  for (const o of d.onus) {
    for (const k of [
      "onuIndex",
      "customerName",
      "pppoeUsername",
      "address",
      "rxPowerDbm",
      "txPowerDbm",
      "status",
      "isWeak",
      "lastSeenAt",
    ]) {
      assert.ok(k in o, k);
    }
    assert.equal(o.isWeak, o.rxPowerDbm < WEAK_RX_DBM);
  }
  assert.deepEqual(getMockPonPortDetail("olt-1-pon-3"), d); // deterministik
});
