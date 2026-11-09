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

const { getConfigurationBadgeSummary } =
  await import("../src/services/configuration-badge.service.ts");

test("getConfigurationBadgeSummary menghasilkan status badge lengkap", async () => {
  const summary = await getConfigurationBadgeSummary();

  assert.ok(typeof summary.incomplete === "boolean");
  assert.ok(["selesai", "belum-selesai"].includes(summary.status));
  assert.ok(
    ["Konfigurasi Selesai", "Konfigurasi Belum Selesai"].includes(
      summary.label,
    ),
  );
  assert.ok(typeof summary.isGateLocked === "boolean");
  assert.equal(summary.mandatoryDevice, "router");
  assert.equal(summary.redirectUrl, "/setup");
  assert.ok(summary.notice);
  assert.ok(summary.checkedAt);
});

test("Route handler /api/onboarding/badge mengekspor method GET", async () => {
  const route = await import("../src/app/api/onboarding/badge/route.ts");
  assert.equal(typeof route.GET, "function");
});
