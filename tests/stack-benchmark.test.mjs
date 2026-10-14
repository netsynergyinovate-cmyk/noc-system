import test from "node:test";
import assert from "node:assert/strict";
import {
  benchmarkKpis,
  benchmarkMatrix,
  stackDecisions,
} from "../src/lib/dashboard/stack-benchmark.ts";

const filled = (o) =>
  Object.values(o).every((v) => typeof v === "string" && v.trim().length > 0);
const uniqueIds = (a) => new Set(a.map((x) => x.id)).size === a.length;

test("benchmarkKpis: 4 KPI lengkap dan unik", () => {
  assert.equal(benchmarkKpis.length, 4);
  assert.ok(benchmarkKpis.every(filled));
  assert.ok(uniqueIds(benchmarkKpis));
});

test("benchmarkMatrix: 5 fitur, pemenang valid", () => {
  assert.equal(benchmarkMatrix.length, 5);
  assert.ok(benchmarkMatrix.every(filled));
  assert.ok(uniqueIds(benchmarkMatrix));
  assert.ok(benchmarkMatrix.every((r) => ["go", "next", "seri"].includes(r.winner)));
});

test("stackDecisions: 3 keputusan lengkap", () => {
  assert.equal(stackDecisions.length, 3);
  assert.ok(stackDecisions.every(filled));
  assert.ok(uniqueIds(stackDecisions));
});
