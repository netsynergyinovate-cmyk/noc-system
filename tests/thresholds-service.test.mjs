import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

// Sumber memakai impor tanpa ekstensi, jadi dimuat lewat tsx.
register();
const { applyRows, mergeThresholds, toRows } =
  await import("../src/lib/dashboard/threshold-rows.ts");
const { defaultThresholds, validateThresholds, changedThresholds } =
  await import("../src/lib/dashboard/thresholds.ts");

test("database kosong jatuh ke bawaan", () => {
  assert.deepEqual(applyRows([]), defaultThresholds());
});

test("baris database menimpa bawaan; baris tak sah/asing diabaikan", () => {
  const out = applyRows([
    { ruleKind: "cpu", threshold: 70, forSeconds: 60 },
    { ruleKind: "queue", threshold: 500, forSeconds: 60 },
    { ruleKind: "bogus", threshold: 1, forSeconds: 1 },
  ]);
  assert.deepEqual(out.cpu, { threshold: 70, forSeconds: 60 });
  assert.deepEqual(out.queue, defaultThresholds().queue);
  assert.equal("bogus" in out, false);
});

test("validasi menolak nilai di luar batas", () => {
  const bad = mergeThresholds(defaultThresholds(), {
    cpu: { threshold: 100, forSeconds: 60 },
  });
  assert.ok(validateThresholds(bad).cpu?.threshold);
  const ok = mergeThresholds(defaultThresholds(), {
    cpu: { threshold: 90, forSeconds: 60 },
  });
  assert.deepEqual(validateThresholds(ok), {});
});

test("mapping upsert: lima baris, bentuk kolom, dan perubahan", () => {
  const merged = mergeThresholds(defaultThresholds(), {
    cpu: { threshold: 70, forSeconds: 60 },
  });
  const rows = toRows(merged);
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.find((r) => r.ruleKind === "cpu"),
    {
      ruleKind: "cpu",
      threshold: 70,
      forSeconds: 60,
    },
  );
  assert.equal(rows.find((r) => r.ruleKind === "offline").threshold, null);
  assert.equal(
    changedThresholds(defaultThresholds(), merged).every(
      (c) => c.kind === "cpu",
    ),
    true,
  );
});
