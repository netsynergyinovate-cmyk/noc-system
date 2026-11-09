import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { evaluateConfigValidation, MOCK_CONFIG_SCENARIOS } =
  await import("../src/lib/dashboard/config-validation.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const scenario = (id) => MOCK_CONFIG_SCENARIOS.find((s) => s.id === id);
const run = (id) => {
  const s = scenario(id);
  return evaluateConfigValidation(s.env, s.dataMode);
};
const find = (r, key) => r.items.find((i) => i.envKey === key);

test("DATABASE_URL kosong = fatal", () => {
  const r = run("missing_database");
  assert.equal(find(r, "DATABASE_URL").severity, "fatal");
  assert.equal(find(r, "DATABASE_URL").status, "missing");
  assert.equal(r.ok, false);
});

test("router kosong = fatal", () => {
  const r = run("missing_router");
  for (const k of [
    "MIKROTIK_REST_HOST",
    "MIKROTIK_REST_USER",
    "MIKROTIK_REST_PASSWORD",
  ])
    assert.equal(find(r, k).severity, "fatal");
  assert.equal(r.fatalCount, 3);
});

test("perangkat opsional kosong = warning, tetap ok", () => {
  const r = run("default");
  for (const k of ["OLT_HSGQ_HOST", "GENIEACS_NBI_URL", "BILLING_URL"])
    assert.equal(find(r, k).severity, "warning");
  assert.equal(r.warningCount, 3);
  assert.equal(r.fatalCount, 0);
  assert.equal(r.ok, true);
});

test("secret pendek = invalid fatal; spasi saja = kosong", () => {
  const r = evaluateConfigValidation({
    BETTER_AUTH_SECRET: "pendek",
    DATABASE_URL: "   ",
  });
  assert.equal(find(r, "BETTER_AUTH_SECRET").status, "invalid");
  assert.equal(find(r, "DATABASE_URL").status, "missing");
});

test("go-live: mode nyata + env belum lengkap = fatal", () => {
  const r = run("go_live_violation");
  const mode = find(r, "DASHBOARD_DATA");
  assert.equal(mode.severity, "fatal");
  assert.match(mode.message, /Penolakan saat start/);
  assert.equal(r.ok, false);
  // mode demo dengan env sama tidak menolak
  const demo = evaluateConfigValidation(
    scenario("go_live_violation").env,
    "dummy",
  );
  assert.equal(find(demo, "DASHBOARD_DATA").status, "valid");
});

test("semua terisi = ok tanpa peringatan", () => {
  const r = run("all_valid");
  assert.equal(r.ok, true);
  assert.equal(r.fatalCount, 0);
  assert.equal(r.warningCount, 0);
  assert.equal(r.validCount, r.totalCount);
});

test("hasil tidak membocorkan nilai env", () => {
  const s = scenario("all_valid");
  const json = JSON.stringify(run("all_valid"));
  for (const v of Object.values(s.env)) assert.ok(!json.includes(v));
});

test("MOCK_CONFIG_SCENARIOS: ada yang valid dan yang galat", () => {
  assert.deepEqual(
    MOCK_CONFIG_SCENARIOS.map((s) => s.id),
    [
      "default",
      "missing_router",
      "missing_database",
      "go_live_violation",
      "all_valid",
    ],
  );
  assert.ok(MOCK_CONFIG_SCENARIOS.some((s) => run(s.id).ok));
  assert.ok(MOCK_CONFIG_SCENARIOS.some((s) => !run(s.id).ok));
});

test("komponen panel: diekspor dan punya atribut a11y/testid", () => {
  const src = read("../src/components/dashboard/config-validation-panel.tsx");
  assert.match(src, /export function ConfigValidationPanel/);
  assert.match(src, /data-testid="config-validation-panel"/);
  assert.match(src, /aria-label="Panel validasi konfigurasi lingkungan"/);
  assert.match(src, /wajib dihapus saat\s+go-live, Fase 5/);
});

test("setup/page.tsx memuat ConfigValidationPanel", () => {
  const src = read("../src/app/(protected)/setup/page.tsx");
  assert.match(src, /<ConfigValidationPanel \/>/);
});
