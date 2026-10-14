import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHarness } from "../scripts/run-benchmark-db.mjs";
import {
  fallbackDbBenchmarkResults,
  loadDbBenchmarkResults,
} from "../src/lib/dashboard/stack-benchmark.ts";

const file = new URL("../src/lib/dashboard/benchmark-db-results.json", import.meta.url);
const results = JSON.parse(readFileSync(file, "utf8"));

const { scenarios } = await createHarness();

for (const sc of scenarios)
  test(`output Drizzle == Raw SQL: ${sc.group}/${sc.key}`, async () => {
    const d = sc.normalize(await sc.drizzle());
    const r = sc.normalize(await sc.raw());
    assert.ok(d);
    assert.deepEqual(d, r);
  });

test("traffic: times, rx, tx identik dan tidak kosong", async () => {
  const sc = scenarios.find((s) => s.key === "1h");
  const d = await sc.drizzle();
  const r = await sc.raw();
  assert.ok(d.times.length > 0);
  assert.deepEqual(d.times, r.times);
  assert.deepEqual(d.rx, r.rx);
  assert.deepEqual(d.tx, r.tx);
  assert.equal(d.source, "db");
  assert.equal(r.source, "raw_sql");
});

test("upsert: 1.000 sampel unik ditulis oleh kedua jalur", async () => {
  const sc = scenarios.find((s) => s.group === "batchUpsert");
  const d = sc.normalize(await sc.drizzle());
  assert.equal(d.count, 1000);
  assert.equal(d.entries.length, 1000);
});

const pairs = () => [
  ...Object.values(results.scenarios.trafficAggregation),
  results.scenarios.batchUpsert,
  results.scenarios.customerMetrics,
];

test("hasil benchmark DB: statistik > 0 dan berurutan", () => {
  assert.equal(results.iterations, 50);
  assert.equal(results.verified, true);
  assert.equal(pairs().length, 6);
  for (const p of pairs())
    for (const engine of ["drizzle", "raw"]) {
      const { latency: s, heapAllocatedBytes } = p[engine];
      assert.equal(s.samples, 50);
      for (const k of ["min", "max", "avg", "p50", "p95", "p99"])
        assert.ok(s[k] > 0, `${engine}.${k}`);
      assert.ok(s.min <= s.p50 && s.p50 <= s.p95 && s.p95 <= s.p99 && s.p99 <= s.max);
      assert.ok(s.min <= s.avg && s.avg <= s.max);
      assert.ok(heapAllocatedBytes > 0);
    }
});

test("batch upsert: Raw SQL lebih cepat atau lebih hemat memori", () => {
  const { drizzle, raw } = results.scenarios.batchUpsert;
  assert.ok(
    raw.latency.avg < drizzle.latency.avg || raw.heapAllocatedBytes < drizzle.heapAllocatedBytes,
  );
});

test("loadDbBenchmarkResults: membaca file hasil, bentuk valid", () => {
  const loaded = loadDbBenchmarkResults();
  assert.notEqual(loaded, fallbackDbBenchmarkResults);
  assert.equal(loaded.generatedAt, results.generatedAt);
  assert.deepEqual(loaded.scenarios.batchUpsert, results.scenarios.batchUpsert);
});

test("fallback bawaan: samples 0 menandai bukan hasil ukur", () => {
  assert.equal(fallbackDbBenchmarkResults.iterations, 0);
  assert.equal(fallbackDbBenchmarkResults.verified, false);
  assert.equal(fallbackDbBenchmarkResults.scenarios.batchUpsert.drizzle.latency.samples, 0);
});
