import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hybridRecommendations,
  stackDecisions,
} from "../src/lib/dashboard/stack-benchmark.ts";

const numeric = /\d+([.,]\d+)?x|\d+\s*(MB|ms|%)/;

test("stackDecisions dan hybridRecommendations berstatus final", () => {
  assert.equal(stackDecisions.length, 3);
  assert.equal(hybridRecommendations.length, 3);
  for (const d of [...stackDecisions, ...hybridRecommendations]) assert.equal(d.status, "final");
});

test("tiap keputusan memuat metrik numerik empiris", () => {
  for (const d of stackDecisions) {
    assert.ok(numeric.test(d.reason), `${d.id}.reason tanpa angka`);
    assert.ok(d.empiricalMetrics && numeric.test(d.empiricalMetrics), `${d.id}.empiricalMetrics`);
  }
});

test("hybridRecommendations selaras dengan stackDecisions", () => {
  assert.deepEqual(hybridRecommendations, stackDecisions);
});

test("ADR-0001 ada, Accepted, menyebut tiga komponen", () => {
  const adr = readFileSync(new URL("../docs/adr/0001-stack-decision.md", import.meta.url), "utf8");
  assert.match(adr, /Accepted/);
  assert.match(adr, /Go Daemon/);
  assert.match(adr, /PostgreSQL Raw SQL/);
  assert.match(adr, /Next\.js 15/);
});
