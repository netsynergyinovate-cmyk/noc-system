import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

register();

const { shouldRunStartupMigration, runStartupMigrations } =
  await import("../src/services/startup-migration.service.ts");

test("startup-migration: shouldRunStartupMigration menolak fase build Next.js", () => {
  const res = shouldRunStartupMigration({
    NEXT_PHASE: "phase-production-build",
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  });
  assert.equal(res.shouldRun, false);
  assert.match(res.reason, /phase-production-build/);
});

test("startup-migration: shouldRunStartupMigration menghormati flag SKIP_STARTUP_MIGRATION dan AUTO_MIGRATE", () => {
  const skip = shouldRunStartupMigration({
    SKIP_STARTUP_MIGRATION: "true",
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  });
  assert.equal(skip.shouldRun, false);
  assert.match(skip.reason, /SKIP_STARTUP_MIGRATION/);

  const disabled = shouldRunStartupMigration({
    AUTO_MIGRATE: "false",
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  });
  assert.equal(disabled.shouldRun, false);
  assert.match(disabled.reason, /AUTO_MIGRATE=false/);
});

test("startup-migration: shouldRunStartupMigration memeriksa validitas DATABASE_URL", () => {
  const empty = shouldRunStartupMigration({ DATABASE_URL: "" });
  assert.equal(empty.shouldRun, false);

  const nonPostgres = shouldRunStartupMigration({
    DATABASE_URL: "mysql://u:p@localhost:3306/db",
  });
  assert.equal(nonPostgres.shouldRun, false);
  assert.match(nonPostgres.reason, /bukan PostgreSQL/);

  const valid = shouldRunStartupMigration({
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  });
  assert.equal(valid.shouldRun, true);
});

test("startup-migration: runStartupMigrations melewati eksekusi jika dinonaktifkan", async () => {
  const logs = [];
  const res = await runStartupMigrations(
    { logger: (l) => logs.push(l) },
    {
      AUTO_MIGRATE: "false",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    },
  );

  assert.equal(res.executed, false);
  assert.equal(res.success, true);
  assert.ok(logs.some((l) => l.includes("Dilewati")));
});

test("startup-migration: runStartupMigrations menangani kegagalan non-strict dengan graceful", async () => {
  const logs = [];
  const res = await runStartupMigrations(
    {
      strict: false,
      migrationsFolder: "path/yang/pasti/tidak/ada",
      logger: (l) => logs.push(l),
    },
    {
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    },
  );

  assert.equal(res.executed, true);
  assert.equal(res.success, false);
  assert.ok(res.error);
  assert.ok(logs.some((l) => l.includes("[FATAL]")));
});
