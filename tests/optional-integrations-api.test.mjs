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

const {
  getRealOptionalIntegrationsOverview,
  setOptionalIntegrationStatusOverride,
  resetOptionalIntegrationOverrides,
} = await import("../src/services/optional-integrations.service.ts");

test("getRealOptionalIntegrationsOverview mengembalikan 5 modul integrasi dengan ringkasan metrik", async () => {
  resetOptionalIntegrationOverrides();
  const overview = await getRealOptionalIntegrationsOverview();

  assert.equal(overview.total, 5);
  assert.equal(overview.items.length, 5);
  assert.ok(typeof overview.configuredCount === "number");
  assert.ok(typeof overview.unconfiguredCount === "number");
  assert.ok(typeof overview.completionPercentage === "number");

  const olt = overview.items.find((i) => i.id === "opt-olt-hsgq");
  assert.ok(olt);
  assert.equal(olt.category, "akses");

  const billing = overview.items.find((i) => i.id === "opt-billing-sync");
  assert.ok(billing);
  assert.equal(billing.category, "billing");
});

test("setOptionalIntegrationStatusOverride mengubah status modul integrasi", async () => {
  setOptionalIntegrationStatusOverride("opt-genieacs-nbi", "terkonfigurasi");
  const overview = await getRealOptionalIntegrationsOverview();

  const genie = overview.items.find((i) => i.id === "opt-genieacs-nbi");
  assert.ok(genie);
  assert.equal(genie.status, "terkonfigurasi");
});

test("Route handler /api/onboarding/integrations mengekspor method GET dan POST", async () => {
  const route = await import("../src/app/api/onboarding/integrations/route.ts");
  assert.equal(typeof route.GET, "function");
  assert.equal(typeof route.POST, "function");
});
