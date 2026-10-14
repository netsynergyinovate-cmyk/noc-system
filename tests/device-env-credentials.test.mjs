import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readMikrotikEnv,
  readOltEnv,
  readGenieacsEnv,
  readBillingEnv,
  readAllDeviceEnv,
  hasConfiguredEnvDevice,
  redactDeviceCredentials,
} from "../src/lib/device-env-credentials.ts";

test("mikrotik: baca dari source kustom, mode real, TLS", () => {
  const c = readMikrotikEnv({
    MIKROTIK_REST_HOST: " 10.0.0.1 ",
    MIKROTIK_REST_PORT: "8443",
    MIKROTIK_REST_USER: "noc",
    MIKROTIK_REST_PASSWORD: "rahasia",
  });
  assert.equal(c.type, "mikrotik");
  assert.equal(c.host, "10.0.0.1");
  assert.equal(c.port, 8443);
  assert.equal(c.username, "noc");
  assert.equal(c.password, "rahasia");
  assert.equal(c.mode, "real");
  assert.equal(c.useTls, true);
});

test("mikrotik: mode eksplisit menang; port 80 tanpa TLS", () => {
  const c = readMikrotikEnv({ MIKROTIK_REST_HOST: "h", MIKROTIK_REST_PORT: "80", MIKROTIK_MODE: "simulator" });
  assert.equal(c.mode, "simulator");
  assert.equal(c.useTls, false);
  assert.equal(readMikrotikEnv({ DEVICE_MODE: "real" }).mode, "real");
  assert.equal(readMikrotikEnv({ DEVICE_MODE: "ngawur" }).mode, "simulator");
});

test("mikrotik: default saat source kosong", () => {
  const c = readMikrotikEnv({});
  assert.deepEqual(
    [c.host, c.port, c.username, c.password, c.mode, c.useTls],
    ["127.0.0.1", 443, "admin", undefined, "simulator", true],
  );
  assert.equal(readMikrotikEnv({ MIKROTIK_REST_PORT: "abc" }).port, 443);
});

test("olt: baca konfigurasi dan default", () => {
  const c = readOltEnv({ OLT_HSGQ_HOST: "10.1.1.1", OLT_HSGQ_PORT: "8080", OLT_HSGQ_USER: "u", OLT_HSGQ_PASSWORD: "p" });
  assert.deepEqual(
    [c.type, c.host, c.port, c.username, c.password, c.mode],
    ["olt", "10.1.1.1", 8080, "u", "p", "real"],
  );
  const d = readOltEnv({});
  assert.deepEqual([d.host, d.port, d.username, d.mode], ["127.0.0.1", 80, "admin", "simulator"]);
});

test("genieacs: url, user, pass, timeout", () => {
  const c = readGenieacsEnv({
    GENIEACS_NBI_URL: "https://acs.example:7557",
    GENIEACS_NBI_USER: "acs",
    GENIEACS_NBI_PASSWORD: "pw",
    GENIEACS_TIMEOUT_MS: "9000",
  });
  assert.deepEqual([c.host, c.username, c.password, c.mode, c.useTls], ["https://acs.example:7557", "acs", "pw", "real", true]);
  assert.equal(c.extra.timeoutMs, 9000);
  const d = readGenieacsEnv({});
  assert.deepEqual([d.host, d.username, d.mode, d.extra.timeoutMs], ["http://localhost:7557", "", "simulator", 5000]);
});

test("billing: url, user, pass, portal", () => {
  const c = readBillingEnv({
    BILLING_URL: "http://bill.local",
    BILLING_USERNAME: "kasir",
    BILLING_PASSWORD: "pw",
    BILLING_PORTAL_URL: "http://portal.local",
  });
  assert.deepEqual([c.host, c.username, c.password, c.mode], ["http://bill.local", "kasir", "pw", "real"]);
  assert.equal(c.extra.portalUrl, "http://portal.local");
  const d = readBillingEnv({});
  assert.deepEqual([d.host, d.username, d.mode, d.extra.portalUrl], ["http://localhost:8080", "billing-admin", "simulator", undefined]);
});

test("readAllDeviceEnv mengembalikan keempat tipe", () => {
  assert.deepEqual(Object.keys(readAllDeviceEnv({})).sort(), ["billing", "genieacs", "mikrotik", "olt"]);
});

test("hasConfiguredEnvDevice: false saat kosong, true saat terisi", () => {
  for (const t of ["mikrotik", "olt", "genieacs", "billing"]) assert.equal(hasConfiguredEnvDevice(t, {}), false);
  assert.equal(hasConfiguredEnvDevice("mikrotik", { MIKROTIK_REST_HOST: "h", MIKROTIK_REST_USER: "u" }), false);
  assert.equal(hasConfiguredEnvDevice("mikrotik", { MIKROTIK_REST_HOST: "h", MIKROTIK_REST_USER: "u", MIKROTIK_REST_PASSWORD: "p" }), true);
  assert.equal(hasConfiguredEnvDevice("olt", { OLT_HSGQ_HOST: "h", OLT_HSGQ_USER: "u", OLT_HSGQ_PASSWORD: "  " }), false);
  assert.equal(hasConfiguredEnvDevice("olt", { OLT_HSGQ_HOST: "h", OLT_HSGQ_USER: "u", OLT_HSGQ_PASSWORD: "p" }), true);
  assert.equal(hasConfiguredEnvDevice("genieacs", { GENIEACS_NBI_URL: "http://x" }), true);
  assert.equal(hasConfiguredEnvDevice("billing", { BILLING_URL: "u", BILLING_USERNAME: "a", BILLING_PASSWORD: "p" }), true);
});

test("redactDeviceCredentials mengganti password, tidak mengubah asli", () => {
  const c = readMikrotikEnv({ MIKROTIK_REST_PASSWORD: "rahasia" });
  const r = redactDeviceCredentials(c);
  assert.equal(r.password, "[REDACTED]");
  assert.equal(c.password, "rahasia");
  assert.equal(r.host, c.host);
});

test("device-credentials.service mengekspor resolver & pembaca env", () => {
  const src = readFileSync(new URL("../src/services/device-credentials.service.ts", import.meta.url), "utf8");
  for (const name of [
    "getMikrotikEnvCredentials",
    "getOltEnvCredentials",
    "getGenieacsEnvCredentials",
    "getBillingEnvCredentials",
    "resolveRouterCredentials",
    "resolveOltCredentials",
    "resolveBillingCredentials",
  ]) {
    assert.match(src, new RegExp(`export (async function|const) ${name}\\b`), name);
  }
});
