import test from "node:test";
import assert from "node:assert/strict";

const { REQUIRED_ENV_DEFINITIONS, validateRequiredEnv } =
  await import("../src/lib/required-env-validator.ts");

test("REQUIRED_ENV_DEFINITIONS memuat seluruh kunci konfigurasi kritis", () => {
  const keys = REQUIRED_ENV_DEFINITIONS.map((d) => d.key);
  assert.ok(keys.includes("DATABASE_URL"));
  assert.ok(keys.includes("BETTER_AUTH_SECRET"));
  assert.ok(keys.includes("BETTER_AUTH_URL"));
  assert.ok(keys.includes("DEVICE_SECRET"));
  assert.ok(keys.includes("REALTIME_TOKEN_SECRET"));
  assert.ok(keys.includes("BACKEND_URL"));
  assert.ok(keys.includes("MIKROTIK_REST_HOST"));
  assert.ok(keys.includes("MIKROTIK_REST_USER"));
  assert.ok(keys.includes("MIKROTIK_REST_PASSWORD"));
});

test("validateRequiredEnv pada demo mode mendeteksi missing keys dasar", () => {
  const result = validateRequiredEnv({});
  assert.equal(result.valid, false);
  assert.equal(result.mode, "demo");
  assert.ok(result.missingRequired.includes("DATABASE_URL"));
  assert.ok(result.missingRequired.includes("BETTER_AUTH_SECRET"));
  assert.ok(result.missingRequired.includes("BETTER_AUTH_URL"));
  // Di demo mode, kunci device MikroTik berstatus warning, bukan required blocker
  assert.ok(!result.missingRequired.includes("MIKROTIK_REST_HOST"));
});

test("validateRequiredEnv pada demo mode lulus jika kunci dasar valid", () => {
  const result = validateRequiredEnv({
    DATABASE_URL: "postgresql://user:pass@localhost:5432/noc_test",
    BETTER_AUTH_SECRET: "12345678901234567890123456789012",
    BETTER_AUTH_URL: "http://localhost:3000",
  });
  assert.equal(result.valid, true);
  assert.equal(result.missingRequired.length, 0);
  assert.equal(result.errors.length, 0);
});

test("validateRequiredEnv pada live mode mewajibkan seluruh kunci perangkat dan rahasia", () => {
  const demoOnlyEnv = {
    DASHBOARD_DATA: "live",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/noc_test",
    BETTER_AUTH_SECRET: "12345678901234567890123456789012",
    BETTER_AUTH_URL: "http://localhost:3000",
  };
  const result = validateRequiredEnv(demoOnlyEnv);
  assert.equal(result.valid, false);
  assert.equal(result.mode, "live");
  assert.ok(result.missingRequired.includes("DEVICE_SECRET"));
  assert.ok(result.missingRequired.includes("REALTIME_TOKEN_SECRET"));
  assert.ok(result.missingRequired.includes("MIKROTIK_REST_HOST"));
  assert.ok(result.missingRequired.includes("MIKROTIK_REST_USER"));
  assert.ok(result.missingRequired.includes("MIKROTIK_REST_PASSWORD"));
});

test("validateRequiredEnv menolak secret yang masih berupa placeholder template", () => {
  const placeholderEnv = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/noc_test",
    BETTER_AUTH_SECRET: "<generate-secret-32-chars-long-here>",
    BETTER_AUTH_URL: "http://localhost:3000",
  };
  const result = validateRequiredEnv(placeholderEnv);
  assert.equal(result.valid, false);
  assert.ok(result.invalidRequired.includes("BETTER_AUTH_SECRET"));
  assert.ok(result.errors.some((e) => e.includes("placeholder")));
});

test("validateRequiredEnv pada live mode lulus jika semua kunci lengkap dan valid", () => {
  const fullLiveEnv = {
    DASHBOARD_DATA: "live",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/noc_test",
    BETTER_AUTH_SECRET: "12345678901234567890123456789012",
    BETTER_AUTH_URL: "http://localhost:3000",
    DEVICE_SECRET: "abcdef1234567890abcdef1234567890",
    REALTIME_TOKEN_SECRET: "abcdef1234567890abcdef1234567890",
    BACKEND_URL: "http://localhost:8080",
    MIKROTIK_REST_HOST: "192.168.88.1",
    MIKROTIK_REST_USER: "api_user",
    MIKROTIK_REST_PASSWORD: "secretpassword123",
  };
  const result = validateRequiredEnv(fullLiveEnv);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.configuredRequired, result.totalRequired);
});
