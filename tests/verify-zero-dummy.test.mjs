import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEnvFile,
  parseArgs,
  verifyZeroDummy,
  formatZeroDummyReport,
} from "../scripts/verify-zero-dummy.mjs";

test("parseEnvFile mem-parsing teks .env bersih", () => {
  const envText = `
# Komentar
DATA_MODE=nyata
MIKROTIK_MODE=real
DUMMY_OLT="false"
`;
  const parsed = parseEnvFile(envText);
  assert.equal(parsed.DATA_MODE, "nyata");
  assert.equal(parsed.MIKROTIK_MODE, "real");
  assert.equal(parsed.DUMMY_OLT, "false");
});

test("parseArgs mem-parsing argumen CLI", () => {
  const opts = parseArgs([
    "--strict",
    "--format",
    "json",
    "--env-file",
    ".env.custom",
  ]);
  assert.equal(opts.strict, true);
  assert.equal(opts.format, "json");
  assert.equal(opts.envFile, ".env.custom");

  assert.throws(() => parseArgs(["--format", "invalid"]), /--format/);
  assert.throws(() => parseArgs(["--unknown"]), /tidak dikenal/);
});

test("verifyZeroDummy lulus jika konfigurasi bersih tanpa simulator/dummy", async () => {
  const cleanEnv = {
    DATA_MODE: "nyata",
    DEVICE_MODE: "real",
    MIKROTIK_MODE: "real",
    OLT_MODE: "real",
    BILLING_MODE: "real",
    NETFLOW_MODE: "real",
    MIKROTIK_REST_HOST: "192.168.1.1",
    DUMMY_OLT: "false",
    DUMMY_BILLING: "false",
    DUMMY_NETFLOW: "false",
  };

  const res = await verifyZeroDummy({
    env: cleanEnv,
    strict: true,
    readFileFn: async () => "",
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, "ready");
  assert.equal(res.exitCode, 0);
  assert.equal(res.errors.length, 0);
});

test("verifyZeroDummy gagal jika ada mode simulator atau dummy aktif", async () => {
  const dirtyEnv = {
    DATA_MODE: "nyata",
    DEVICE_MODE: "simulator",
    OLT_MODE: "simulator",
    DUMMY_BILLING: "true",
  };

  const res = await verifyZeroDummy({
    env: dirtyEnv,
    strict: true,
    readFileFn: async () => "",
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, "failed");
  assert.equal(res.exitCode, 1);
  assert.ok(res.errors.some((e) => e.includes("DEVICE_MODE")));
  assert.ok(res.errors.some((e) => e.includes("OLT_MODE")));
  assert.ok(res.errors.some((e) => e.includes("DUMMY_BILLING")));

  const report = formatZeroDummyReport(res);
  assert.ok(report.includes("[DITAHAN / BLOCKED]"));
});
