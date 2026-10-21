import test from "node:test";
import assert from "node:assert/strict";
import { parseCoordinates } from "../src/components/peta/coords.ts";

test("parseCoordinates: desimal valid diterima", () => {
  assert.deepEqual(parseCoordinates(" -6.2088 ", "106.8456"), {
    lat: -6.2088,
    lng: 106.8456,
  });
  assert.deepEqual(parseCoordinates("90", "-180"), { lat: 90, lng: -180 });
});

test("parseCoordinates: kosong, bukan angka, koma, dan di luar rentang ditolak", () => {
  for (const [lat, lng] of [
    ["", "106.8"],
    ["-6.2", " "],
    ["12abc", "106.8"],
    ["-6,2", "106.8"],
    ["90.0001", "0"],
    ["0", "180.5"],
    ["1e2", "0"],
  ]) {
    assert.equal(parseCoordinates(lat, lng), null, `${lat}, ${lng}`);
  }
});
