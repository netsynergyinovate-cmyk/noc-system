import test from "node:test";
import assert from "node:assert/strict";

const {
  DEFAULT_ONBOARDING_MIKROTIK,
  ONBOARDING_MIKROTIK_MOCK_ENTRY,
  validateOnboardingMikrotikInput,
  simulateOnboardingMikrotikTest,
} = await import("../src/lib/dashboard/onboarding-mikrotik.ts");

test("validateOnboardingMikrotikInput memvalidasi isian wajib", () => {
  const valid = validateOnboardingMikrotikInput(DEFAULT_ONBOARDING_MIKROTIK);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.errors, {});

  const invalid = validateOnboardingMikrotikInput({
    ...DEFAULT_ONBOARDING_MIKROTIK,
    name: "",
    host: "invalid-host!!",
    port: 0,
    username: "",
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.name);
  assert.ok(invalid.errors.host);
  assert.ok(invalid.errors.port);
  assert.ok(invalid.errors.username);
});

test("simulateOnboardingMikrotikTest menghasilkan status sukses pada konfigurasi valid", () => {
  const res = simulateOnboardingMikrotikTest(DEFAULT_ONBOARDING_MIKROTIK);
  assert.equal(res.ok, true);
  assert.ok(res.latencyMs > 0);
  assert.ok(res.details);
  assert.equal(res.details?.boardName, "CCR2004-16G-2S+");
  assert.equal(res.details?.version.includes("v7"), true);
});

test("simulateOnboardingMikrotikTest mendeteksi kegagalan koneksi jika host offline", () => {
  const res = simulateOnboardingMikrotikTest({
    ...DEFAULT_ONBOARDING_MIKROTIK,
    host: "offline.isp.net",
  });
  assert.equal(res.ok, false);
  assert.ok(res.message.includes("Gagal terhubung"));
});

test("ONBOARDING_MIKROTIK_MOCK_ENTRY terdaftar dalam registry dummy", () => {
  assert.equal(ONBOARDING_MIKROTIK_MOCK_ENTRY.status, "dummy");
  assert.ok(
    ONBOARDING_MIKROTIK_MOCK_ENTRY.readPath.includes("onboarding-mikrotik"),
  );
});

test("splitHostInput memisah host, port, dan skema", async () => {
  const { splitHostInput, defaultRestPort } =
    await import("../src/lib/dashboard/onboarding-mikrotik.ts");
  assert.deepEqual(splitHostInput("203.0.113.10"), { host: "203.0.113.10" });
  assert.deepEqual(splitHostInput(" 203.0.113.10:2024 "), {
    host: "203.0.113.10",
    port: 2024,
  });
  assert.deepEqual(splitHostInput("https://r.example.com"), {
    host: "r.example.com",
    useTls: true,
  });
  assert.deepEqual(splitHostInput("http://10.0.0.1:8080/"), {
    host: "10.0.0.1",
    port: 8080,
    useTls: false,
  });
  assert.deepEqual(splitHostInput("10.0.0.1:99999"), {
    host: "10.0.0.1:99999",
  });
  assert.deepEqual(splitHostInput("10.0.0.1:"), { host: "10.0.0.1:" });
  assert.equal(defaultRestPort(true), 443);
  assert.equal(defaultRestPort(false), 80);
});
