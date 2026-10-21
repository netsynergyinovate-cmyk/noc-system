import test from "node:test";
import assert from "node:assert/strict";
import {
  haversineDistanceM,
  calculatePolylineLengthM,
  generateSegmentSamples,
} from "../src/services/map/geo.ts";

test("haversineDistanceM: titik identik menghasilkan jarak 0", () => {
  const dist = haversineDistanceM(-6.2088, 106.8456, -6.2088, 106.8456);
  assert.equal(dist, 0);
});

test("haversineDistanceM: sifat simetri dist(A, B) == dist(B, A)", () => {
  const p1 = [-6.1754, 106.8272]; // Monas
  const p2 = [-6.195, 106.823]; // Bundaran HI

  const d1 = haversineDistanceM(p1[0], p1[1], p2[0], p2[1]);
  const d2 = haversineDistanceM(p2[0], p2[1], p1[0], p1[1]);

  assert.equal(d1, d2);
  assert.ok(d1 > 2100 && d1 < 2300, `Jarak Monas-HI sekitar 2.2km, dapat: ${d1}m`);
});

test("haversineDistanceM: perhitungan 1 derajat bujur di ekuator", () => {
  const dist = haversineDistanceM(0, 0, 0, 1);
  assert.ok(dist > 111000 && dist < 111500, `Ekuator 1 deg ~111.19km, dapat: ${dist}m`);
});

test("calculatePolylineLengthM: polilin kosong atau 1 titik mengembalikan 0", () => {
  assert.equal(calculatePolylineLengthM([]), 0);
  assert.equal(calculatePolylineLengthM([[-6.2, 106.8]]), 0);
});

test("calculatePolylineLengthM: akumulasi panjang beberapa titik", () => {
  const pts = [
    [-6.1754, 106.8272],
    [-6.185, 106.825],
    [-6.195, 106.823],
  ];
  const d1 = haversineDistanceM(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
  const d2 = haversineDistanceM(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
  const total = calculatePolylineLengthM(pts);

  assert.equal(total, Math.round((d1 + d2) * 10) / 10);
});

test("generateSegmentSamples: titik kurang dari 2 mengembalikan sampel kosong", () => {
  const res = generateSegmentSamples([[-6.2, 106.8]], 50);
  assert.deepEqual(res.samples, []);
  assert.equal(res.totalLengthM, 0);
});

test("generateSegmentSamples: jarak pendek di bawah interval hanya titik awal dan akhir", () => {
  // ~33 meter
  const p1 = [-6.2088, 106.8456];
  const p2 = [-6.209, 106.8458];
  const res = generateSegmentSamples([p1, p2], 50);

  assert.equal(res.samples.length, 2);
  assert.equal(res.samples[0].sequence, 1);
  assert.equal(res.samples[0].cumulativeM, 0);
  assert.equal(res.samples[1].sequence, 2);
  assert.equal(res.samples[1].cumulativeM, res.totalLengthM);
});

test("generateSegmentSamples: interpolasi titik tiap interval 50m", () => {
  // Jarak Monas ke HI sekitar 2.2km
  const p1 = [-6.1754, 106.8272];
  const p2 = [-6.195, 106.823];
  const res = generateSegmentSamples([p1, p2], 50);

  assert.ok(res.samples.length > 40, `Harus ada minimal 40 titik sampling, dapat: ${res.samples.length}`);
  assert.equal(res.samples[0].sequence, 1);
  assert.equal(res.samples[0].cumulativeM, 0);

  // Verifikasi urutan sequence dan monoton naik cumulativeM
  for (let i = 1; i < res.samples.length; i++) {
    assert.equal(res.samples[i].sequence, i + 1);
    assert.ok(
      res.samples[i].cumulativeM >= res.samples[i - 1].cumulativeM,
      "cumulativeM harus monoton naik",
    );
  }

  const lastSample = res.samples[res.samples.length - 1];
  assert.equal(lastSample.cumulativeM, res.totalLengthM);
});

test("generateSegmentSamples: jarak sampling berlanjut melintasi vertex", () => {
  // ~111m per ruas di ekuator (0.001 deg), belok di vertex tengah
  const pts = [[0, 0], [0, 0.001], [0.001, 0.001]];
  const res = generateSegmentSamples(pts, 50);
  const mids = res.samples.slice(1, -1).map((s) => s.cumulativeM);
  mids.forEach((m, i) => assert.ok(Math.abs(m - 50 * (i + 1)) < 0.1, `sampel ${i} di ${m}`));
  assert.equal(mids.length, 4); // 50,100,150,200 dari ~222m
});
