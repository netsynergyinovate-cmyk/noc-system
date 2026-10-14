import test from "node:test";
import assert from "node:assert/strict";

const {
  evaluateOnboardingGate,
  isPathExemptFromGate,
  ONBOARDING_GATE_UNLOCKED_PATHS,
} = await import("../src/lib/dashboard/onboarding-gate.ts");

test("evaluateOnboardingGate meluluskan fungsi utama jika router terhubung", () => {
  const gate = evaluateOnboardingGate({
    hasConnectedRouter: true,
    isLiveMode: true,
  });
  assert.equal(gate.isLocked, false);
  assert.equal(gate.status, "lulus");
});

test("evaluateOnboardingGate menahan fungsi utama jika live dan router belum terhubung", () => {
  const gate = evaluateOnboardingGate({
    hasConnectedRouter: false,
    isLiveMode: true,
  });
  assert.equal(gate.isLocked, true);
  assert.equal(gate.status, "ditahan");
  assert.ok(gate.bannerNotice.includes("Gerbang Konfigurasi Aktif"));
});

test("evaluateOnboardingGate tidak menahan di mode demo kecuali di-force", () => {
  const demoGate = evaluateOnboardingGate({
    hasConnectedRouter: false,
    isLiveMode: false,
  });
  assert.equal(demoGate.isLocked, false);

  const forcedGate = evaluateOnboardingGate({
    forceLocked: true,
  });
  assert.equal(forcedGate.isLocked, true);
});

test("isPathExemptFromGate mengecualikan rute setup, onboarding, dan router", () => {
  assert.equal(isPathExemptFromGate("/app/onboarding"), true);
  assert.equal(isPathExemptFromGate("/app/router"), true);
  assert.equal(isPathExemptFromGate("/app/pengaturan"), true);
  assert.equal(isPathExemptFromGate("/app/pengaturan/perangkat"), true);
  assert.equal(isPathExemptFromGate("/setup"), true);

  // Halaman fungsi utama ditahan
  assert.equal(isPathExemptFromGate("/app"), false);
  assert.equal(isPathExemptFromGate("/app/alert"), false);
  assert.equal(isPathExemptFromGate("/app/netflow"), false);
  assert.equal(isPathExemptFromGate("/app/traffic"), false);
  assert.equal(isPathExemptFromGate("/app/billing"), false);
});
