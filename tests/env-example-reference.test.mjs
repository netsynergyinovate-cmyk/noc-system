import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseEnvExample,
  validateEnvExampleSecurity,
  checkEnvCoverage,
  EXPECTED_ENV_KEYS,
} from "../src/lib/env-example-reference.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(root, ".env.example"), "utf8");

test("parseEnvExample membaca kunci, nilai bawaan, dan komentar", () => {
  const p = parseEnvExample(text);
  assert.equal(p.keyValues.BETTER_AUTH_URL, "http://localhost:3000");
  assert.equal(p.keyValues.PG_MAX_CONNECTIONS, "5");
  assert.equal(p.keyValues.DEVICE_MODE, "simulator");
  assert.equal(p.keyValues.BETTER_AUTH_SECRET, "");
  assert.equal(p.keys.length, new Set(p.keys).size, "tidak ada kunci ganda");
  assert.ok(!p.keys.includes("POSTGRES_PORT"), "baris berkomentar bukan kunci");
  assert.ok(p.comments.TRUSTED_PROXIES.length > 0);
});

test("parseEnvExample: kasus kecil", () => {
  const p = parseEnvExample("# c\nA=1\n\nB = x y \n#C=3\n");
  assert.deepEqual(p.keys, ["A", "B"]);
  assert.equal(p.keyValues.B, "x y");
  assert.deepEqual(p.comments.A, ["c"]);
});

test(".env.example lolos pemeriksaan keamanan", () => {
  assert.deepEqual(validateEnvExampleSecurity(text), { ok: true, violations: [] });
});

test("validateEnvExampleSecurity menangkap pelanggaran", () => {
  const bad = validateEnvExampleSecurity("A=1\nDEVICE_SECRET=abc\nX_TOKEN=t\nY_PASSWORD=\n");
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.violations.slice(1), ["DEVICE_SECRET harus kosong", "X_TOKEN harus kosong"]);
  assert.match(bad.violations[0], /header/);
});

test("checkEnvCoverage", () => {
  assert.deepEqual(checkEnvCoverage(["A", "B"], ["A", "C"]), { covered: false, missing: ["C"] });
  assert.deepEqual(checkEnvCoverage(["A"], ["A"]), { covered: true, missing: [] });
});

test(".env.example mencakup semua EXPECTED_ENV_KEYS", () => {
  assert.deepEqual(checkEnvCoverage(parseEnvExample(text).keys, [...EXPECTED_ENV_KEYS]), {
    covered: true,
    missing: [],
  });
});

test("selaras dengan env-security.test.mjs", () => {
  const { keyValues } = parseEnvExample(text);
  for (const k of ["DEVICE_SECRET", "PPP_WEBHOOK_TOKEN", "WHATSAPP_API_KEY"]) {
    assert.match(text, new RegExp(`^${k}=$`, "m"));
    assert.equal(keyValues[k], "");
  }
  assert.match(text, /^TRUSTED_PROXIES=$/m);
  assert.match(text.split(/\r?\n/)[0], /PERINGATAN KEAMANAN/);
});
