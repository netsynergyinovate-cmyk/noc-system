import test from "node:test";
import assert from "node:assert/strict";
import {
  integrationStatuses,
  promotionPrinciples,
} from "../src/lib/dashboard/stack-benchmark.ts";

test("integrationStatuses: 5 komponen, ID unik dan lengkap", () => {
  const ids = integrationStatuses.map((c) => c.id);
  assert.deepEqual([...ids].sort(), ["billing", "genieacs", "mikrotik", "olt", "realtime_hub"]);
  assert.equal(new Set(ids).size, 5);
});

test("integrationStatuses: field valid dan env keys tidak kosong", () => {
  for (const c of integrationStatuses) {
    for (const k of ["name", "category", "fallbackStrategy", "notes"]) {
      assert.ok(typeof c[k] === "string" && c[k].trim().length > 0, `${c.id}.${k}`);
    }
    assert.ok(["simulator", "mock", "real"].includes(c.currentSource));
    assert.ok(["passed", "untested"].includes(c.verificationStatus));
    assert.ok(["ready", "needs_env"].includes(c.promotionReadiness));
    assert.ok(c.envKeys.length > 0, `${c.id} envKeys`);
    assert.ok(c.envKeys.every((k) => /^[A-Z][A-Z0-9_]*$/.test(k)));
  }
});

test("integrationStatuses: komponen belum diuji tidak ditandai siap promosi", () => {
  for (const c of integrationStatuses) {
    if (c.verificationStatus === "untested") assert.equal(c.promotionReadiness, "needs_env");
  }
});

test("promotionPrinciples: memuat prinsip pelepasan mock", () => {
  assert.ok(promotionPrinciples.length >= 3);
  assert.equal(new Set(promotionPrinciples.map((p) => p.id)).size, promotionPrinciples.length);
  assert.ok(promotionPrinciples.every((p) => p.title.trim() && p.detail.trim()));
  assert.ok(
    promotionPrinciples.some((p) => /lab Docker lokal/.test(p.detail) && /Mock/.test(p.detail)),
  );
});
