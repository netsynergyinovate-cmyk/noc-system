import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateStats } from "../scripts/run-benchmark-comparison.mjs";
import {
  fallbackBenchmarkResults,
  loadBenchmarkResults,
} from "../src/lib/dashboard/stack-benchmark.ts";

const file = new URL("../src/lib/dashboard/benchmark-results.json", import.meta.url);
const results = JSON.parse(readFileSync(file, "utf8"));
const STEPS = ["collector", "eval", "traffic", "pipeline"];

test("calculateStats: 1..100 (nearest-rank)", () => {
  const s = calculateStats(Array.from({ length: 100 }, (_, i) => 100 - i));
  assert.deepEqual(s, {
    samples: 100, min: 1, max: 100, avg: 50.5, p50: 50, p95: 95, p99: 99,
  });
});

test("calculateStats: satu elemen, urutan tidak dimutasi", () => {
  assert.equal(calculateStats([7]).p99, 7);
  const input = [3, 1, 2];
  calculateStats(input);
  assert.deepEqual(input, [3, 1, 2]);
});

test("calculateStats: menolak kosong, NaN, dan bukan angka", () => {
  assert.throws(() => calculateStats([]));
  assert.throws(() => calculateStats([1, Number.NaN]));
  assert.throws(() => calculateStats([1, "2"]));
});

test("hasil benchmark: statistik > 0 dan berurutan di tiap langkah", () => {
  assert.equal(results.iterations, 50);
  for (const engine of ["node", "go"])
    for (const step of STEPS) {
      const s = results[engine][step];
      assert.equal(s.samples, 50, `${engine}.${step}.samples`);
      for (const k of ["avg", "p50", "p95", "p99"])
        assert.ok(s[k] > 0, `${engine}.${step}.${k} harus > 0`);
      assert.ok(s.min <= s.p50 && s.p50 <= s.p95 && s.p95 <= s.p99 && s.p99 <= s.max);
    }
});

test("hasil benchmark: Go lebih cepat di pipeline dan hemat memori", () => {
  assert.ok(results.ratios.pipelineAvgSpeedup > 1);
  assert.ok(results.ratios.pipelineP95Speedup > 1);
  assert.ok(results.ratios.memorySavings > 1);
  // Rasio konsisten dengan angka mentahnya (toleransi pembulatan).
  const avg = results.node.pipeline.avg / results.go.pipeline.avg;
  assert.ok(Math.abs(avg - results.ratios.pipelineAvgSpeedup) < 1e-4);
  const mem = results.node.memory.rssBytes / results.go.memory.sysBytes;
  assert.ok(Math.abs(mem - results.ratios.memorySavings) < 1e-4);
});

test("loadBenchmarkResults: memakai file ukur yang valid", () => {
  const loaded = loadBenchmarkResults();
  assert.equal(loaded.generatedAt, results.generatedAt);
  assert.ok(loaded.go.pipeline.avg < loaded.node.pipeline.avg);
});

test("fallbackBenchmarkResults: bentuk valid dan ditandai bukan hasil ukur", () => {
  assert.equal(fallbackBenchmarkResults.iterations, 0);
  for (const step of STEPS) assert.equal(fallbackBenchmarkResults.go[step].samples, 0);
  assert.ok(fallbackBenchmarkResults.ratios.memorySavings > 1);
});
