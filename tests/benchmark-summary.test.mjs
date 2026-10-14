import test from "node:test";
import assert from "node:assert/strict";
import {
  compileBenchmarkSummary,
  fallbackBenchmarkResults,
  fallbackDbBenchmarkResults,
} from "../src/lib/dashboard/stack-benchmark.ts";

const numbers = (o, out = []) => {
  if (typeof o === "number") out.push(o);
  else if (o && typeof o === "object") Object.values(o).forEach((v) => numbers(v, out));
  return out;
};

test("ringkasan: semua rasio > 1 (Go > Node, SQL > Drizzle)", () => {
  const s = compileBenchmarkSummary();
  assert.ok(s.runtime.pipelineAvgSpeedup > 1);
  assert.ok(s.runtime.pipelineP95Speedup > 1);
  assert.ok(s.runtime.memoryRatio > 1);
  assert.ok(s.database.batchUpsertSpeedup > 1);
  assert.ok(s.database.trafficSpeedupMin > 1);
  assert.ok(s.database.trafficSpeedupMax >= s.database.trafficSpeedupMin);
  assert.ok(s.database.customerMetricsSpeedup > 1);
  assert.ok(s.database.heapSavingsAvg > 1);
});

test("ringkasan: terukur dan angka sesuai hasil lab", () => {
  const s = compileBenchmarkSummary();
  assert.equal(s.measured, true);
  assert.ok(Math.abs(s.runtime.pipelineAvgSpeedup - 3.73) < 0.2);
  assert.ok(Math.abs(s.runtime.memoryRatio - 5.09) < 0.2);
  assert.ok(Math.abs(s.database.batchUpsertSpeedup - 1.16) < 0.1);
  assert.ok(Math.abs(s.database.customerMetricsSpeedup - 3.16) < 0.2);
  assert.equal(s.runtime.steps.length, 4);
  assert.equal(s.database.scenarios.length, 6);
});

test("ringkasan: KPI lengkap, tanpa NaN/null/undefined", () => {
  const s = compileBenchmarkSummary();
  assert.equal(s.kpis.length, 7);
  for (const k of s.kpis)
    for (const f of ["id", "label", "value", "detail"]) {
      assert.equal(typeof k[f], "string");
      assert.ok(k[f].length > 0);
      assert.ok(!/NaN|undefined|null|Infinity/.test(k[f]), `${k.id}.${f}: ${k[f]}`);
    }
  for (const n of numbers(s)) assert.ok(Number.isFinite(n));
});

test("ringkasan: rekomendasi hibrida tiga lapisan", () => {
  const s = compileBenchmarkSummary();
  assert.deepEqual(
    s.recommendations.map((r) => r.id),
    ["collector", "timeseries", "web"],
  );
});

test("ringkasan: fallback aman bila hasil bawaan (belum diukur)", () => {
  const s = compileBenchmarkSummary(fallbackBenchmarkResults, fallbackDbBenchmarkResults);
  assert.equal(s.measured, false);
  for (const n of numbers(s)) assert.ok(Number.isFinite(n));
  assert.ok(s.kpis.every((k) => !k.measured));
});

test("ringkasan: data nol tidak menghasilkan NaN/Infinity", () => {
  const zero = (st) => ({ ...st, avg: 0, p50: 0, p95: 0 });
  const run = structuredClone(fallbackBenchmarkResults);
  for (const k of ["collector", "eval", "traffic", "pipeline"]) run.go[k] = zero(run.go[k]);
  run.go.memory.sysBytes = 0;
  const s = compileBenchmarkSummary(run, fallbackDbBenchmarkResults);
  for (const n of numbers(s)) assert.ok(Number.isFinite(n));
});
