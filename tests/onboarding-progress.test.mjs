import test from "node:test";
import assert from "node:assert/strict";

const {
  MOCK_ONBOARDING_STEPS,
  getMockOnboardingOverview,
  computeStepStatuses,
} = await import("../src/lib/dashboard/onboarding-data.ts");

test("Indikator progres menghitung persentase dengan tepat", () => {
  // Kondisi 0 langkah selesai
  const emptyStatuses = computeStepStatuses(MOCK_ONBOARDING_STEPS, new Set());
  const emptyOverview = getMockOnboardingOverview(emptyStatuses);
  assert.equal(emptyOverview.completedSteps, 0);
  assert.equal(emptyOverview.completionPercentage, 0);

  // Kondisi 2 langkah selesai
  const twoDone = computeStepStatuses(
    MOCK_ONBOARDING_STEPS,
    new Set(["step-router-mikrotik", "step-test-router-polling"]),
  );
  const twoOverview = getMockOnboardingOverview(twoDone);
  assert.equal(twoOverview.completedSteps, 2);
  const expectedPct = Math.round((2 / MOCK_ONBOARDING_STEPS.length) * 100);
  assert.equal(twoOverview.completionPercentage, expectedPct);

  // Kondisi semua selesai (100%)
  const allDone = computeStepStatuses(
    MOCK_ONBOARDING_STEPS,
    new Set(MOCK_ONBOARDING_STEPS.map((s) => s.id)),
  );
  const allOverview = getMockOnboardingOverview(allDone);
  assert.equal(allOverview.completedSteps, MOCK_ONBOARDING_STEPS.length);
  assert.equal(allOverview.completionPercentage, 100);
});

test("Penentuan langkah rekomendasi berikutnya memilih langkah terbuka pertama", () => {
  const steps = computeStepStatuses(
    MOCK_ONBOARDING_STEPS,
    new Set(["step-router-mikrotik", "step-test-router-polling"]),
  );
  // Langkah berikutnya harusnya step-olt-hsgq karena step 1 & 2 sudah selesai dan prasyaratnya terpenuhi
  const nextStep = steps.find((s) => s.status !== "selesai" && s.status !== "terkunci");
  assert.ok(nextStep);
  assert.equal(nextStep.id, "step-olt-hsgq");
});
