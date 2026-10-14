import test from "node:test";
import assert from "node:assert/strict";

const {
  MOCK_ONBOARDING_STEPS,
  MOCK_ONBOARDING_GUIDES,
  ONBOARDING_CENTER_MOCK_ENTRY,
  getMockOnboardingOverview,
  isStepUnlocked,
  computeStepStatuses,
  validatePrerequisiteGraph,
} = await import("../src/lib/dashboard/onboarding-data.ts");

test("MOCK_ONBOARDING_STEPS memuat langkah wajib dan opsional yang terurut", () => {
  assert.ok(MOCK_ONBOARDING_STEPS.length >= 6);
  const routerStep = MOCK_ONBOARDING_STEPS.find((s) => s.id === "step-router-mikrotik");
  assert.ok(routerStep, "Langkah router wajib harus ada");
  assert.equal(routerStep.type, "wajib");
  assert.equal(routerStep.order, 1);
  assert.deepEqual(routerStep.prerequisites, []);
});

test("isStepUnlocked mengevaluasi apakah prasyarat sudah terpenuhi", () => {
  const routerStep = MOCK_ONBOARDING_STEPS.find((s) => s.id === "step-router-mikrotik");
  const queueStep = MOCK_ONBOARDING_STEPS.find((s) => s.id === "step-test-router-polling");
  assert.ok(routerStep && queueStep);

  // Router tidak butuh prasyarat -> unlocked
  assert.equal(isStepUnlocked(routerStep, new Set()).unlocked, true);

  // Queue butuh router -> jika belum ada router -> locked
  const lockedCheck = isStepUnlocked(queueStep, new Set());
  assert.equal(lockedCheck.unlocked, false);
  assert.deepEqual(lockedCheck.missingPrereqs, ["step-router-mikrotik"]);

  // Jika router sudah selesai -> unlocked
  const unlockedCheck = isStepUnlocked(queueStep, new Set(["step-router-mikrotik"]));
  assert.equal(unlockedCheck.unlocked, true);
  assert.deepEqual(unlockedCheck.missingPrereqs, []);
});

test("computeStepStatuses menandai terkunci jika prasyarat belum selesai", () => {
  // Hanya router selesai
  const statuses = computeStepStatuses(MOCK_ONBOARDING_STEPS, new Set(["step-router-mikrotik"]));
  const router = statuses.find((s) => s.id === "step-router-mikrotik");
  const queue = statuses.find((s) => s.id === "step-test-router-polling");
  const genie = statuses.find((s) => s.id === "step-genieacs-cpe");

  assert.equal(router?.status, "selesai");
  assert.notEqual(queue?.status, "terkunci"); // prasyarat router sudah selesai
  assert.equal(genie?.status, "terkunci"); // prasyarat olt belum selesai
});

test("validatePrerequisiteGraph memastikan graf dependensi valid & bebas siklus", () => {
  const graphCheck = validatePrerequisiteGraph(MOCK_ONBOARDING_STEPS);
  assert.equal(graphCheck.valid, true);
  assert.deepEqual(graphCheck.cycles, []);
  assert.deepEqual(graphCheck.missingReferences, []);
});

test("getMockOnboardingOverview menghitung persentase dan status gerbang wajib", () => {
  const overview = getMockOnboardingOverview();
  assert.equal(overview.totalSteps, MOCK_ONBOARDING_STEPS.length);
  assert.ok(overview.requiredTotal >= 2);
  assert.ok(overview.completionPercentage >= 0 && overview.completionPercentage <= 100);
  assert.equal(overview.isGatePassed, true);
});

test("ONBOARDING_CENTER_MOCK_ENTRY terdaftar dengan status dummy", () => {
  assert.equal(ONBOARDING_CENTER_MOCK_ENTRY.status, "dummy");
  assert.ok(ONBOARDING_CENTER_MOCK_ENTRY.readPath.includes("onboarding-data"));
});

test("MOCK_ONBOARDING_GUIDES memuat panduan langkah menyalakan dari nol", () => {
  assert.ok(MOCK_ONBOARDING_GUIDES.length >= 2);
  const scratchGuide = MOCK_ONBOARDING_GUIDES.find((g) => g.id === "guide-start-from-scratch");
  assert.ok(scratchGuide);
  assert.ok(scratchGuide.steps.length >= 3);
});
