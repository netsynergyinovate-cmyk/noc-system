import test from "node:test";
import assert from "node:assert/strict";
import { mockOnus, filterOnus, mapOnuToCustomer } from "../src/lib/dashboard/onus.ts";

test("mockOnus is deterministic and realistic", () => {
  assert.ok(mockOnus.length >= 20 && mockOnus.length <= 25);
  assert.equal(new Set(mockOnus.map((o) => o.id)).size, mockOnus.length);
  assert.equal(new Set(mockOnus.map((o) => o.serialNumber)).size, mockOnus.length);
  for (const o of mockOnus) {
    assert.match(o.serialNumber, /^[A-Z]{4,5}\d{7,8}$/);
    assert.ok(o.distanceMeters >= 300 && o.distanceMeters <= 3200);
    assert.ok(o.rxPowerDbm <= -10 && o.rxPowerDbm >= -41);
  }
  for (const s of ["online", "offline", "los"]) assert.ok(mockOnus.some((o) => o.status === s), s);
});

test("filterOnus filters by status, olt and query", () => {
  assert.equal(filterOnus(mockOnus, "", "all", "all").length, mockOnus.length);
  const online = filterOnus(mockOnus, "", "online", "all");
  assert.ok(online.length > 0 && online.every((o) => o.status === "online"));
  const off = filterOnus(mockOnus, "", "offline", "all");
  assert.ok(off.length > 0 && off.every((o) => o.status === "offline"));
  const los = filterOnus(mockOnus, "", "los", "all");
  assert.ok(los.length > 0 && los.every((o) => o.status === "los"));
  assert.equal(online.length + off.length + los.length, mockOnus.length);
  const weak = filterOnus(mockOnus, "", "weak", "all");
  assert.ok(weak.length > 0 && weak.every((o) => o.rxPowerDbm < -27));
  const oltId = mockOnus[0].oltId;
  const byOlt = filterOnus(mockOnus, "", "all", oltId);
  assert.ok(byOlt.length > 0 && byOlt.length < mockOnus.length && byOlt.every((o) => o.oltId === oltId));
  const sn = mockOnus[3].serialNumber;
  assert.deepEqual(filterOnus(mockOnus, ` ${sn.toLowerCase()} `, "all", "all").map((o) => o.id), [mockOnus[3].id]);
  assert.ok(filterOnus(mockOnus, mockOnus[0].pppoeUsername, "all", "all").length >= 1);
  assert.ok(filterOnus(mockOnus, mockOnus[0].ponPort, "all", "all").length >= 1);
  assert.equal(filterOnus(mockOnus, "zzz-tidak-ada", "all", "all").length, 0);
});

test("mapOnuToCustomer maps and unmaps without mutating", () => {
  const onu = mockOnus[10];
  const before = { ...onu };
  const mapped = mapOnuToCustomer(onu, { id: "c-1", name: "Tono", pppoeUsername: "tono@noc" });
  assert.equal(mapped.customerId, "c-1");
  assert.equal(mapped.customerName, "Tono");
  assert.equal(mapped.pppoeUsername, "tono@noc");
  assert.equal(mapped.serialNumber, onu.serialNumber);
  const freed = mapOnuToCustomer(mapped, null);
  assert.equal(freed.customerId, null);
  assert.equal(freed.customerName, "Belum dipasangkan");
  assert.equal(freed.pppoeUsername, "-");
  assert.deepEqual(onu, before);
});
