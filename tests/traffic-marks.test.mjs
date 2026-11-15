import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { trafficMarks, trafficPointNote, TRAFFIC_GAP_SECONDS } =
  await import("../src/lib/dashboard/traffic-marks.ts");

test("trafficMarks: titik 0/0 dan celah >= TRAFFIC_GAP_SECONDS ditandai", () => {
  const times = [
    100,
    101,
    102,
    103 + TRAFFIC_GAP_SECONDS,
    104 + TRAFFIC_GAP_SECONDS,
  ];
  const rx = [90, 0, 80, 70, 0.5];
  const tx = [9, 0, 8, 7, 0];
  assert.deepEqual(trafficMarks(times, rx, tx), [
    { kind: "zero", time: 101 },
    { kind: "gap", from: 102, to: 103 + TRAFFIC_GAP_SECONDS },
  ]);
});

test("trafficMarks: celah 1-2 dtk (counter router dilewati) dan unduh 0 saja tidak ditandai", () => {
  assert.deepEqual(trafficMarks([10, 12, 13], [0, 5, 6], [3, 1, 1]), []);
});

test("trafficPointNote menjelaskan penyebab, bukan menebak", () => {
  const times = [100, 101, 106];
  const rx = [50, 0, 60];
  const tx = [5, 0, 6];
  assert.equal(trafficPointNote(times, rx, tx, 0), null);
  assert.match(trafficPointNote(times, rx, tx, 1), /Router mengirim 0 Mbps/);
  assert.match(trafficPointNote(times, rx, tx, 2), /tanpa data 4 dtk/);
});
