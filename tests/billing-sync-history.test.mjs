import test from "node:test";
import assert from "node:assert/strict";
import {
  filterSyncRuns,
  summarizeSyncHistory,
} from "../src/lib/dashboard/billing-history.ts";

const run = (id, status, startedAt, lasted) => ({
  id,
  startedAt,
  finishedAt: startedAt + lasted,
  status,
  result: null,
  error: null,
});

const mixed = [
  run("a", "success", 100, 10),
  run("b", "failed", 200, 20),
  run("c", "success", 300, 30),
  run("d", "failed", 400, 40),
];

test("filterSyncRuns: all mengembalikan salinan semua baris", () => {
  const out = filterSyncRuns(mixed, "all");
  assert.deepEqual(out, mixed);
  assert.notEqual(out, mixed);
});

test("filterSyncRuns: success dan failed", () => {
  assert.deepEqual(
    filterSyncRuns(mixed, "success").map((r) => r.id),
    ["a", "c"],
  );
  assert.deepEqual(
    filterSyncRuns(mixed, "failed").map((r) => r.id),
    ["b", "d"],
  );
  assert.deepEqual(filterSyncRuns([], "failed"), []);
});

test("summarizeSyncHistory: kosong", () => {
  assert.deepEqual(summarizeSyncHistory([]), {
    total: 0,
    success: 0,
    failed: 0,
    successRatePercent: 0,
    averageDurationSeconds: 0,
  });
});

test("summarizeSyncHistory: 100% sukses", () => {
  const s = summarizeSyncHistory([
    run("a", "success", 0, 5),
    run("b", "success", 10, 15),
  ]);
  assert.equal(s.successRatePercent, 100);
  assert.equal(s.failed, 0);
  assert.equal(s.averageDurationSeconds, 10);
});

test("summarizeSyncHistory: campuran dan rata-rata durasi", () => {
  const s = summarizeSyncHistory(mixed);
  assert.equal(s.total, 4);
  assert.equal(s.success, 2);
  assert.equal(s.failed, 2);
  assert.equal(s.successRatePercent, 50);
  assert.equal(s.averageDurationSeconds, 25);
  assert.equal(summarizeSyncHistory(mixed.slice(0, 3)).successRatePercent, 67);
});
