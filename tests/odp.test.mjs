import test from "node:test";
import assert from "node:assert/strict";
import {
  getOdpCoordinates,
  getOdpList,
  haversineDistanceMeters,
} from "../src/lib/dashboard/odp.ts";

test("getOdpCoordinates returns coordinates for known ODP areas", () => {
  const coords = getOdpCoordinates("ODP-CHP-01");
  assert.ok(coords !== null, "ODP coordinates should exist");
  assert.equal(typeof coords[0], "number");
  assert.equal(typeof coords[1], "number");
  assert.ok(coords[0] < 0, "Latitude should be negative in Indonesia");
  assert.ok(coords[1] > 100, "Longitude should be positive in Indonesia");
});

test("getOdpCoordinates returns null for invalid ODP name", () => {
  assert.equal(getOdpCoordinates("INVALID-ODP"), null);
  assert.equal(getOdpCoordinates(""), null);
});

test("getOdpList groups customers and counts connections", () => {
  const mockCustomers = [
    { id: "c1", odpName: "ODP-CHP-01", latitude: -6.91, longitude: 107.61 },
    { id: "c2", odpName: "ODP-CHP-01", latitude: -6.911, longitude: 107.611 },
    { id: "c3", odpName: "ODP-DGO-02", latitude: -6.92, longitude: 107.62 },
  ];
  const odps = getOdpList(mockCustomers);
  assert.equal(odps.length, 2);
  const chp = odps.find((o) => o.name === "ODP-CHP-01");
  assert.ok(chp);
  assert.equal(chp.customerCount, 2);
});

test("haversineDistanceMeters calculates reasonable distances", () => {
  const dist = haversineDistanceMeters(-6.9175, 107.6191, -6.9185, 107.6191);
  assert.ok(dist > 100 && dist < 125, `Expected ~111m, got ${dist}m`);
});
