import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

register();

const { getOnboardingStepsWithPrerequisites } = await import(
  "../src/services/onboarding.service.ts"
);

test("getOnboardingStepsWithPrerequisites mengembalikan 8 langkah dengan prasyarat terhitung", async () => {
  const result = await getOnboardingStepsWithPrerequisites();
  assert.equal(result.steps.length, 8);
  assert.ok(result.overview);
  assert.equal(result.overview.totalSteps, 8);
  assert.ok(Array.isArray(result.completedStepIds));

  // Langkah 1 tidak memiliki prasyarat
  const step1 = result.steps.find((s) => s.id === "step-router-mikrotik");
  assert.ok(step1);
  assert.deepEqual(step1.prerequisites, []);

  // Langkah 2 memiliki prasyarat langkah 1
  const step2 = result.steps.find((s) => s.id === "step-test-router-polling");
  assert.ok(step2);
  assert.deepEqual(step2.prerequisites, ["step-router-mikrotik"]);
});

test("Route handler /api/onboarding/steps terdefinisi dan mengekspor fungsi GET", async () => {
  const route = await import("../src/app/api/onboarding/steps/route.ts");
  assert.equal(typeof route.GET, "function");
});
