import test from "node:test";
import assert from "node:assert/strict";
import { getMockPonPortDetail, getMockPonPorts } from "../src/lib/dashboard/pon-ports.ts";

test("getMockPonPortDetail is deterministic", () => {
  assert.deepEqual(getMockPonPortDetail("olt-1-pon-1"), getMockPonPortDetail("olt-1-pon-1"));
  assert.notDeepEqual(getMockPonPortDetail("olt-1-pon-1").onus, getMockPonPortDetail("olt-1-pon-2").onus);
});

test("getMockPonPortDetail shape and consistency", () => {
  const d = getMockPonPortDetail("olt-1-pon-1");
  assert.equal(d.oltName, "OLT-GPON-CORE-01");
  assert.equal(d.oltHost, "10.10.0.10");
  assert.equal(d.ponIndex, 1);
  assert.equal(d.name, "PON 1/1/1");
  assert.ok(d.onus.length >= 16 && d.onus.length <= 32);
  assert.equal(d.totalOnu, d.onus.length);
  assert.equal(d.onlineOnu, d.onus.filter((o) => o.status === "online").length);
  assert.ok(d.onus.some((o) => o.isWeak), "has weak ONU");
  assert.ok(d.onus.some((o) => !o.isWeak), "has normal ONU");
  for (const o of d.onus) assert.equal(o.isWeak, o.rxPowerDbm < -27);
  assert.equal(new Set(d.onus.map((o) => o.pppoeUsername)).size, d.onus.length);
});

test("getMockPonPortDetail tolerates unknown id", () => {
  const d = getMockPonPortDetail("bogus");
  assert.equal(d.id, "bogus");
  assert.ok(d.onus.length >= 16);
});

test("getMockPonPortDetail HSGQ: kapasitas, status port, identitas ONU", () => {
  const d = getMockPonPortDetail("olt-1-pon-1");
  assert.equal(d.capacity, 128);
  assert.equal(d.status, "up");
  for (const o of d.onus) {
    assert.match(o.serialNumber, /^(HSGQ|ZTEG)[0-9A-F]{8}$/);
    assert.match(o.macAddress, /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    assert.ok(o.distanceMeters > 0);
    assert.ok(o.distanceMeters >= 100 && o.distanceMeters <= 4000, `jarak ${o.distanceMeters}`);
  }
  const statuses = new Set(d.onus.map((o) => o.status));
  for (const s of ["online", "offline", "los"]) assert.ok(statuses.has(s), `ada ONU ${s}`);
  for (const o of d.onus.filter((x) => x.status === "los")) assert.equal(o.rxPowerDbm, -38);
  assert.equal(d.onlineOnu, d.onus.filter((o) => o.status === "online").length);
});

test("getMockPonPorts: jumlah, deterministik, batas valid", () => {
  const a = getMockPonPorts("olt-gpon-core-01", 8, "OLT-GPON-CORE-01");
  assert.equal(a.length, 8);
  assert.deepEqual(a, getMockPonPorts("olt-gpon-core-01", 8, "OLT-GPON-CORE-01"));
  assert.equal(getMockPonPorts("x").length, 8);
  a.forEach((p, i) => {
    assert.equal(p.ponIndex, i + 1);
    assert.equal(p.id, `olt-gpon-core-01-pon-${i + 1}`);
    assert.ok(p.capacity > 0);
    assert.ok(p.onuCount >= 0 && p.onuCount <= p.capacity);
    assert.ok(p.onlineOnuCount >= 0 && p.onlineOnuCount <= p.onuCount);
    assert.ok(Number.isFinite(p.txPowerDbm) && Number.isFinite(p.avgRxPowerDbm));
    assert.ok(p.txPowerDbm > 0 && p.avgRxPowerDbm < 0);
  });
  assert.equal(getMockPonPorts("olt-epon-timur-02", 2)[0].capacity, 64);
});
