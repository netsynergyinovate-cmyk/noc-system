import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  loadCentralConfig,
  validateCentralConfig,
  redactCentralConfig,
} from "../src/lib/central-config-loader.ts";

const full = {
  DATABASE_URL: "postgresql://noc:dbpass123@db:5432/noc",
  MIGRATION_DATABASE_URL: "postgresql://noc:migpass456@db:5432/noc",
  BETTER_AUTH_SECRET: "a".repeat(40),
  REALTIME_TOKEN_SECRET: "rt-secret-value-xyz",
  DEVICE_SECRET: "device-secret-value-xyz",
  DASHBOARD_DATA: "live",
  DEVICE_MODE: "real",
  MIKROTIK_REST_HOST: "10.0.0.1",
  MIKROTIK_REST_USER: "api",
  MIKROTIK_REST_PASSWORD: "mt-pass-111",
  OLT_HSGQ_HOST: "10.0.0.2",
  OLT_HSGQ_PASSWORD: "olt-pass-222",
  GENIEACS_NBI_URL: "http://genie:7557",
  GENIEACS_NBI_PASSWORD: "genie-pass-333",
  BILLING_URL: "https://billing.example",
  BILLING_PASSWORD: "bill-pass-444",
};

test("load: defaults", () => {
  const c = loadCentralConfig({});
  assert.equal(c.database.url, undefined);
  assert.equal(c.auth.url, "http://localhost:3000");
  assert.equal(c.modes.dataMode, "demo");
  assert.equal(c.modes.defaultDeviceMode, "simulator");
  assert.equal(c.devices.mikrotik.port, 443);
  assert.equal(c.devices.mikrotik.mode, "simulator");
  assert.equal(c.devices.olt.port, 80);
  assert.equal(c.devices.genieacs.timeoutMs, 5000);
  assert.equal(c.backendUrl, "http://localhost:8080");
});

test("load: overrides, numeric parsing, blank -> undefined", () => {
  const c = loadCentralConfig({
    ...full,
    MIKROTIK_REST_PORT: "8729",
    OLT_HSGQ_PORT: "8080",
    GENIEACS_TIMEOUT_MS: "1200",
    BACKEND_URL: "http://api:9000",
    BETTER_AUTH_URL: "https://noc.example",
    MIKROTIK_MODE: "simulator",
    TRUSTED_PROXIES: "   ",
    BILLING_PORTAL_URL: "",
  });
  assert.equal(c.devices.mikrotik.port, 8729);
  assert.equal(c.devices.olt.port, 8080);
  assert.equal(c.devices.genieacs.timeoutMs, 1200);
  assert.equal(c.backendUrl, "http://api:9000");
  assert.equal(c.auth.url, "https://noc.example");
  assert.equal(c.modes.dataMode, "live");
  assert.equal(c.devices.mikrotik.mode, "simulator"); // per-device wins
  assert.equal(c.devices.olt.mode, "real"); // falls back to DEVICE_MODE
  assert.equal(c.auth.trustedProxies, undefined);
  assert.equal(c.devices.billing.portalUrl, undefined);
});

test("load: invalid numbers/modes fall back to defaults", () => {
  const c = loadCentralConfig({
    MIKROTIK_REST_PORT: "abc",
    OLT_HSGQ_PORT: "70000",
    GENIEACS_TIMEOUT_MS: "-5",
    DASHBOARD_DATA: "bogus",
    DEVICE_MODE: "bogus",
  });
  assert.equal(c.devices.mikrotik.port, 443);
  assert.equal(c.devices.olt.port, 80);
  assert.equal(c.devices.genieacs.timeoutMs, 5000);
  assert.equal(c.modes.dataMode, "demo");
  assert.equal(c.modes.defaultDeviceMode, "simulator");
});

test("validate: missing DATABASE_URL", () => {
  const v = validateCentralConfig(
    loadCentralConfig({ ...full, DATABASE_URL: "" }),
  );
  assert.equal(v.valid, false);
  assert.ok(v.missingKeys.includes("DATABASE_URL"));
});

test("validate: short auth secret", () => {
  const v = validateCentralConfig(
    loadCentralConfig({ ...full, BETTER_AUTH_SECRET: "short" }),
  );
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes("BETTER_AUTH_SECRET")));
  assert.equal(v.isGoLiveReady, false);
});

test("validate: demo mode needs only db + secret", () => {
  const v = validateCentralConfig(
    loadCentralConfig({
      DATABASE_URL: full.DATABASE_URL,
      BETTER_AUTH_SECRET: full.BETTER_AUTH_SECRET,
    }),
  );
  assert.equal(v.valid, true);
  assert.equal(v.isGoLiveReady, false);
});

test("validate: live with unconfigured router", () => {
  const v = validateCentralConfig(
    loadCentralConfig({
      DATABASE_URL: full.DATABASE_URL,
      BETTER_AUTH_SECRET: full.BETTER_AUTH_SECRET,
      DASHBOARD_DATA: "live",
      DEVICE_MODE: "real",
    }),
  );
  assert.equal(v.valid, false);
  assert.equal(v.isGoLiveReady, false);
  for (const k of [
    "MIKROTIK_REST_HOST",
    "MIKROTIK_REST_USER",
    "MIKROTIK_REST_PASSWORD",
  ])
    assert.ok(v.missingKeys.includes(k), k);
});

test("validate: live with simulator router", () => {
  const v = validateCentralConfig(
    loadCentralConfig({ ...full, MIKROTIK_MODE: "simulator" }),
  );
  assert.equal(v.valid, false);
  assert.equal(v.isGoLiveReady, false);
  assert.ok(
    v.errors.includes(
      "Mode live aktif namun router MikroTik masih mode simulator",
    ),
  );
});

test("validate: complete live + real passes", () => {
  const v = validateCentralConfig(loadCentralConfig(full));
  assert.deepEqual(v, {
    valid: true,
    errors: [],
    missingKeys: [],
    isGoLiveReady: true,
  });
});

test("redact: no raw secrets anywhere", () => {
  const out = redactCentralConfig(loadCentralConfig(full));
  const json = JSON.stringify(out);
  for (const raw of [
    full.BETTER_AUTH_SECRET,
    full.REALTIME_TOKEN_SECRET,
    full.DEVICE_SECRET,
    full.MIKROTIK_REST_PASSWORD,
    full.OLT_HSGQ_PASSWORD,
    full.GENIEACS_NBI_PASSWORD,
    full.BILLING_PASSWORD,
    "dbpass123",
    "migpass456",
  ])
    assert.ok(!json.includes(raw), `leaked ${raw}`);
  assert.equal(out.auth.secret, "[REDACTED]");
  assert.equal(out.devices.mikrotik.password, "[REDACTED]");
  assert.equal(out.devices.billing.password, "[REDACTED]");
  assert.equal(out.devices.mikrotik.host, "10.0.0.1");
});

test("redact: db URL password masked, rest kept; undefined stays undefined", () => {
  const out = redactCentralConfig(loadCentralConfig(full));
  assert.equal(out.database.url, "postgresql://noc:***@db:5432/noc");
  const empty = redactCentralConfig(loadCentralConfig({}));
  assert.equal(empty.database.url, undefined);
  assert.equal(empty.auth.secret, undefined);
});

test("service and route files exist with expected exports", () => {
  const svc = "src/services/config-loader.service.ts";
  const route = "src/app/api/config/status/route.ts";
  assert.ok(existsSync(svc));
  assert.ok(existsSync(route));
  const s = readFileSync(svc, "utf8");
  assert.match(s, /import "server-only"/);
  for (const fn of [
    "getAppConfig",
    "getRedactedAppConfig",
    "getAppConfigValidation",
  ])
    assert.match(s, new RegExp(`export function ${fn}\\b`));
  const r = readFileSync(route, "utf8");
  assert.match(r, /export const runtime = "nodejs"/);
  assert.match(r, /export function GET|export async function GET/);
  assert.match(r, /withApiSession/);
});
