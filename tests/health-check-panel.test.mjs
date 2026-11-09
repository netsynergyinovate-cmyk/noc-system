import test from "node:test";
import assert from "node:assert/strict";

const { MOCK_HEALTH_CHECKS } =
  await import("../src/lib/dashboard/deploy-safety.ts");

test("MOCK_HEALTH_CHECKS memiliki seluruh kategori esensial", () => {
  const categories = new Set(MOCK_HEALTH_CHECKS.map((c) => c.category));
  assert.ok(categories.has("database"));
  assert.ok(categories.has("network"));
  assert.ok(categories.has("storage"));
  assert.ok(categories.has("service"));
});

test("MOCK_HEALTH_CHECKS memuat penanda wajib deploy", () => {
  const required = MOCK_HEALTH_CHECKS.filter((c) => c.requiredForDeploy);
  assert.ok(required.length >= 3);
  assert.ok(required.some((c) => c.name.includes("PostgreSQL")));
  assert.ok(required.some((c) => c.name.includes("Drizzle")));
});
