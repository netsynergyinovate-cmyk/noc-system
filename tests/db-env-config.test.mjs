import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseDatabaseUrl,
  loadDatabaseEnvConfig,
  validateDatabaseEnvConfig,
  formatDatabaseSanitizedSummary,
} from "../src/lib/db-env-config.ts";

const URL1 = "postgresql://noc:s3cret@db.local:6543/nocdb?sslmode=require";

test("parseDatabaseUrl: URL valid", () => {
  const p = parseDatabaseUrl(URL1);
  assert.equal(p.host, "db.local");
  assert.equal(p.port, 6543);
  assert.equal(p.database, "nocdb");
  assert.equal(p.user, "noc");
  assert.equal(p.password, "s3cret");
  assert.equal(p.sslMode, "require");
});

test("parseDatabaseUrl: port bawaan 5432, skema postgres://", () => {
  const p = parseDatabaseUrl("postgres://u@h/d");
  assert.equal(p.port, 5432);
  assert.equal(p.password, undefined);
  assert.equal(p.sslMode, undefined);
});

test("parseDatabaseUrl: password ter-encode didekode", () => {
  assert.equal(parseDatabaseUrl("postgres://u:p%40ss@h/d").password, "p@ss");
});

test("parseDatabaseUrl: tolak protokol non-postgres dan URL rusak", () => {
  assert.throws(() => parseDatabaseUrl("mysql://u:p@h/d"), /postgres/);
  assert.throws(() => parseDatabaseUrl("bukan url"), /valid/);
});

test("loadDatabaseEnvConfig: baca URL, migrasi, dan bawaan pool", () => {
  const c = loadDatabaseEnvConfig({
    DATABASE_URL: URL1,
    MIGRATION_DATABASE_URL: "postgresql://m:x@direct/nocdb",
  });
  assert.equal(c.url, URL1);
  assert.equal(c.migrationUrl, "postgresql://m:x@direct/nocdb");
  assert.equal(c.maxConnections, 5);
  assert.equal(c.connectionTimeoutMs, 5000);
  assert.equal(c.idleTimeoutMs, 30000);
});

test("loadDatabaseEnvConfig: override pool dan alias, dibatasi min/max", () => {
  const c = loadDatabaseEnvConfig({
    DATABASE_URL: URL1,
    PG_MAX_CONNECTIONS: "20",
    DATABASE_TIMEOUT_MS: "9000",
    DATABASE_IDLE_TIMEOUT_MS: "1000",
  });
  assert.equal(c.maxConnections, 20);
  assert.equal(c.connectionTimeoutMs, 9000);
  assert.equal(c.idleTimeoutMs, 1000);
  const hi = loadDatabaseEnvConfig({
    DATABASE_URL: URL1,
    PG_MAX_CONNECTIONS: "999",
    PG_TIMEOUT_MS: "1",
  });
  assert.equal(hi.maxConnections, 100);
  assert.equal(hi.connectionTimeoutMs, 500);
  const lo = loadDatabaseEnvConfig({
    DATABASE_URL: URL1,
    PG_MAX_CONNECTIONS: "0",
  });
  assert.equal(lo.maxConnections, 1);
  const bad = loadDatabaseEnvConfig({
    DATABASE_URL: URL1,
    PG_MAX_CONNECTIONS: "abc",
  });
  assert.equal(bad.maxConnections, 5);
});

test("loadDatabaseEnvConfig: null bila DATABASE_URL kosong", () => {
  assert.equal(loadDatabaseEnvConfig({}), null);
  assert.equal(loadDatabaseEnvConfig({ DATABASE_URL: "  " }), null);
});

test("validateDatabaseEnvConfig: password tidak bocor", () => {
  const v = validateDatabaseEnvConfig(
    loadDatabaseEnvConfig({ DATABASE_URL: URL1 }),
  );
  assert.equal(v.valid, true);
  assert.deepEqual(v.errors, []);
  assert.equal(v.sanitizedUrl, "postgresql://noc:***@db.local:6543/nocdb");
  assert.ok(!v.sanitizedUrl.includes("s3cret"));
});

test("validateDatabaseEnvConfig: error bila null atau database kosong", () => {
  const n = validateDatabaseEnvConfig(null);
  assert.equal(n.valid, false);
  assert.match(n.errors[0], /DATABASE_URL/);
  const e = validateDatabaseEnvConfig(
    loadDatabaseEnvConfig({ DATABASE_URL: "postgres://u:p@h" }),
  );
  assert.equal(e.valid, false);
});

test("formatDatabaseSanitizedSummary: tanpa kredensial", () => {
  const s = formatDatabaseSanitizedSummary(
    loadDatabaseEnvConfig({ DATABASE_URL: URL1 }),
  );
  assert.equal(
    s,
    "postgresql://noc@db.local:6543/nocdb (max: 5, timeout: 5000ms)",
  );
  assert.ok(!s.includes("s3cret"));
});

test("service db-config mengekspor fungsi yang benar", () => {
  const src = readFileSync(
    new URL("../src/services/db-config.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /^import "server-only"/);
  for (const fn of [
    "getDatabaseConfig",
    "getDatabaseSanitizedSummary",
    "validateDatabaseConfig",
  ]) {
    assert.match(src, new RegExp(`export function ${fn}\\(`));
  }
});

test("src/db/index.ts membaca konfigurasi pool dari env", () => {
  const src = readFileSync(
    new URL("../src/db/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /loadDatabaseEnvConfig\(process\.env\)/);
  assert.match(src, /config\?\.maxConnections/);
  assert.match(src, /config\?\.connectionTimeoutMs/);
  assert.match(src, /config\?\.idleTimeoutMs/);
});
