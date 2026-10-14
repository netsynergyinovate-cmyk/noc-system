import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  runStartupValidation,
  formatStartupBanner,
  assertStartupConfig,
  StartupValidationError,
} from "../src/lib/startup-validator.ts";

const SECRET = "s".repeat(40);
const PASS = "mikrotik-super-rahasia";
const base = {
  DATABASE_URL: "postgresql://u:dbpass-rahasia@localhost:5432/noc",
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "http://localhost:3000",
};
const mikrotik = {
  MIKROTIK_REST_HOST: "10.10.0.1",
  MIKROTIK_REST_USER: "noc",
  MIKROTIK_REST_PASSWORD: PASS,
};

test("demo + DB & secret valid -> canBoot", () => {
  const r = runStartupValidation({ ...base, DASHBOARD_DATA: "demo" });
  assert.equal(r.canBoot, true);
  assert.equal(r.dataMode, "demo");
  assert.equal(r.valid, false); // MikroTik belum lengkap -> warning
  assert.ok(r.warnings.length > 0);
  assert.deepEqual(r.fatalErrors, []);
});

test("DB kosong -> fatal", () => {
  const r = runStartupValidation({ ...base, DATABASE_URL: "" });
  assert.equal(r.canBoot, false);
  assert.equal(r.details.database.ok, false);
  assert.ok(r.fatalErrors.some((e) => e.includes("DATABASE_URL")));
});

test("DB bukan postgres -> fatal", () => {
  assert.equal(
    runStartupValidation({ ...base, DATABASE_URL: "mysql://x/y" }).canBoot,
    false,
  );
});

test("secret pendek -> fatal", () => {
  const r = runStartupValidation({ ...base, BETTER_AUTH_SECRET: "pendek" });
  assert.equal(r.canBoot, false);
  assert.equal(r.details.auth.ok, false);
});

test("BETTER_AUTH_URL tidak valid -> fatal", () => {
  assert.equal(
    runStartupValidation({ ...base, BETTER_AUTH_URL: "bukan url" }).canBoot,
    false,
  );
});

test("live tanpa MikroTik -> gagal go-live", () => {
  const r = runStartupValidation({ ...base, DASHBOARD_DATA: "live" });
  assert.equal(r.canBoot, false);
  assert.equal(r.details.goLiveCheck.passed, false);
  assert.deepEqual(r.details.devices.missing.length, 3);
  assert.ok(r.details.goLiveCheck.violations.length > 0);
});

test("live + MikroTik simulator -> pelanggaran simulator", () => {
  const r = runStartupValidation({
    ...base,
    ...mikrotik,
    DASHBOARD_DATA: "live",
    MIKROTIK_MODE: "simulator",
  });
  assert.equal(r.canBoot, false);
  assert.equal(r.deviceMode, "simulator");
  assert.ok(
    r.details.goLiveCheck.violations.some((v) => v.includes("simulator")),
  );
});

test("live lengkap + real -> valid", () => {
  const r = runStartupValidation({
    ...base,
    ...mikrotik,
    DASHBOARD_DATA: "live",
  });
  assert.equal(r.canBoot, true);
  assert.equal(r.valid, true);
  assert.equal(r.deviceMode, "real");
  assert.equal(r.details.goLiveCheck.passed, true);
});

test("DATA_MODE=nyata dihitung live", () => {
  assert.equal(
    runStartupValidation({ ...base, DATA_MODE: "nyata" }).dataMode,
    "live",
  );
});

test("DATA_MODE=nyata menolak boot bila ada halaman yang masih dummy", () => {
  const r = runStartupValidation({
    ...base,
    ...mikrotik,
    DATA_MODE: "nyata",
    BILLING_MODE: "simulator",
    DUMMY_PAGES: "/app/alert",
  });

  assert.equal(r.canBoot, false);
  assert.equal(r.details.pageDataSources?.passed, false);
  assert.ok(
    r.fatalErrors.some(
      (e) => e.includes("/app/billing") && e.includes("Billing"),
    ),
  );
  assert.ok(
    r.fatalErrors.some(
      (e) => e.includes("/app/alert"),
    ),
  );
});

test("DATA_MODE=dummy mengizinkan boot meskipun ada modul simulator", () => {
  const r = runStartupValidation({
    ...base,
    DATA_MODE: "dummy",
    BILLING_MODE: "simulator",
  });

  assert.equal(r.canBoot, true);
  assert.equal(r.dataMode, "demo");
});

test("banner & report tidak membocorkan rahasia", () => {
  for (const env of [
    { ...base, ...mikrotik, DASHBOARD_DATA: "live" },
    { ...base, ...mikrotik, DASHBOARD_DATA: "live", MIKROTIK_MODE: "simulator" },
    { ...base, BETTER_AUTH_SECRET: "x" },
  ]) {
    const r = runStartupValidation(env);
    const out = formatStartupBanner(r) + JSON.stringify(r);
    for (const s of [SECRET, PASS, "dbpass-rahasia"])
      assert.ok(!out.includes(s), `bocor: ${s}`);
  }
  assert.match(
    formatStartupBanner(runStartupValidation({ ...base, ...mikrotik, DASHBOARD_DATA: "live" })),
    /\[READY\]/,
  );
  assert.match(
    formatStartupBanner(runStartupValidation({})),
    /\[BLOCKED\]/,
  );
});

test("assertStartupConfig melempar bila tidak bisa boot", () => {
  assert.throws(() => assertStartupConfig({}), StartupValidationError);
  try {
    assertStartupConfig({});
  } catch (e) {
    assert.equal(e.report.canBoot, false);
  }
  assert.equal(assertStartupConfig(base).canBoot, true);
});

test("src/instrumentation.ts ada dan mengekspor register", () => {
  const p = new URL("../src/instrumentation.ts", import.meta.url);
  assert.ok(existsSync(p));
  assert.match(readFileSync(p, "utf8"), /export async function register\(/);
});
