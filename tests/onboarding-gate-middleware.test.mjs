import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();

const { isPathExempt, enforceOnboardingGate, withOnboardingGate } =
  await import("../src/lib/onboarding-gate-middleware.ts");

test("isPathExempt mengidentifikasi rute pengecualian dengan benar", () => {
  assert.equal(isPathExempt("/setup"), true);
  assert.equal(isPathExempt("/app/router"), true);
  assert.equal(isPathExempt("/app/onboarding"), false);
  assert.equal(isPathExempt("/api/auth/signin"), true);
  assert.equal(isPathExempt("/api/onboarding/steps"), true);
  assert.equal(isPathExempt("/api/routers/test"), true);

  // Rute fungsional utama tidak boleh dikecualikan
  assert.equal(isPathExempt("/app/alert"), false);
  assert.equal(isPathExempt("/api/alerts"), false);
  assert.equal(isPathExempt("/api/traffic"), false);
  assert.equal(isPathExempt("/app/billing"), false);
});

test("enforceOnboardingGate pada mode live tanpa router memblokir API dengan HTTP 423 Locked", async () => {
  const req = new Request("http://localhost:3000/api/alerts/handle", {
    method: "POST",
  });

  const res = enforceOnboardingGate(req, {
    isLiveMode: true,
    hasConnectedRouter: false,
  });

  assert.ok(res);
  assert.equal(res.status, 423);
  const json = await res.json();
  assert.equal(json.error, "CONFIGURATION_GATE_LOCKED");
  assert.equal(json.code, "GATE_LOCKED");
  assert.equal(json.redirectUrl, "/setup");
});

test("enforceOnboardingGate pada mode live tanpa router mengarahkan halaman web ke /setup", () => {
  const req = new Request("http://localhost:3000/app/alert");

  const res = enforceOnboardingGate(req, {
    isLiveMode: true,
    hasConnectedRouter: false,
  });

  assert.ok(res);
  assert.equal(res.status, 307);
  assert.ok(res.headers.get("Location")?.endsWith("/setup"));
});

test("enforceOnboardingGate mengizinkan akses jika router wajib telah terhubung", () => {
  const req = new Request("http://localhost:3000/api/alerts");

  const res = enforceOnboardingGate(req, {
    isLiveMode: true,
    hasConnectedRouter: true,
  });

  assert.equal(res, null);
});

test("withOnboardingGate menjalankan handler jika gerbang tidak terkunci", async () => {
  const req = new Request("http://localhost:3000/api/alerts");

  const response = await withOnboardingGate(
    req,
    async () => Response.json({ success: true, count: 5 }),
    { isLiveMode: true, hasConnectedRouter: true },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
});
