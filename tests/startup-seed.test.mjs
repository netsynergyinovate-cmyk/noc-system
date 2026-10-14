import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/noc_dev";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
process.env.DEVICE_SECRET_KEY ??= "k".repeat(64);

register();

const {
  shouldRunStartupSeed,
  runStartupSeed,
} = await import("../src/services/startup-seed.service.ts");

test("shouldRunStartupSeed mendeteksi kondisi build Next.js", () => {
  const res = shouldRunStartupSeed({
    NEXT_PHASE: "phase-production-build",
    DATABASE_URL: "postgresql://localhost:5432/noc",
  });
  assert.equal(res.shouldRun, false);
  assert.match(res.reason, /phase-production-build/);
});

test("shouldRunStartupSeed menghormati bendera AUTO_SEED=false dan SKIP_STARTUP_SEED=true", () => {
  const res1 = shouldRunStartupSeed({
    AUTO_SEED: "false",
    DATABASE_URL: "postgresql://localhost:5432/noc",
  });
  assert.equal(res1.shouldRun, false);
  assert.match(res1.reason, /AUTO_SEED=false/);

  const res2 = shouldRunStartupSeed({
    SKIP_STARTUP_SEED: "true",
    DATABASE_URL: "postgresql://localhost:5432/noc",
  });
  assert.equal(res2.shouldRun, false);
  assert.match(res2.reason, /SKIP_STARTUP_SEED=true/);
});

test("shouldRunStartupSeed memvalidasi DATABASE_URL", () => {
  const resEmpty = shouldRunStartupSeed({ DATABASE_URL: "" });
  assert.equal(resEmpty.shouldRun, false);
  assert.match(resEmpty.reason, /DATABASE_URL kosong/);

  const resInvalid = shouldRunStartupSeed({ DATABASE_URL: "mysql://localhost/noc" });
  assert.equal(resInvalid.shouldRun, false);
  assert.match(resInvalid.reason, /bukan PostgreSQL/);

  const resValid = shouldRunStartupSeed({
    DATABASE_URL: "postgresql://postgres:secret@localhost:5432/noc",
  });
  assert.equal(resValid.shouldRun, true);
});

test("runStartupSeed melewati eksekusi jika kondisi tidak terpenuhi", async () => {
  const logs = [];
  const result = await runStartupSeed(
    { logger: (line) => logs.push(line) },
    { AUTO_SEED: "false", DATABASE_URL: "postgresql://localhost/noc" },
  );

  assert.equal(result.executed, false);
  assert.equal(result.success, true);
  assert.match(result.skippedReason, /AUTO_SEED=false/);
  assert.ok(logs.some((l) => l.includes("[SEED] Dilewati")));
});
