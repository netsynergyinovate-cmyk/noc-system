import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = ".env.server.example";

const ignored = (path) =>
  spawnSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: root })
    .status === 0;

const lines = () => readFileSync(join(root, file), "utf8").split(/\r?\n/);
const entries = () =>
  lines()
    .map((l) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]);

const REQUIRED = [
  // Web & Auth
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_REALTIME_WS_URL",
  "BACKEND_URL",
  "DASHBOARD_DATA",
  "DEVICE_SECRET",
  "ROUTER_SECRET_KEY",
  "TRUSTED_PROXIES",
  // Realtime Go
  "PORT",
  "BACKEND_ADDR",
  "LOG_LEVEL",
  "REALTIME_TOKEN_SECRET",
  "ALLOWED_ORIGINS",
  "PPP_WEBHOOK_TOKEN",
  "SYS_SYSLOG_ADDR",
  "SYSLOG_ADDR",
  "NETFLOW_ENABLED",
  "NETFLOW_LISTEN_ADDR",
  "NETFLOW_ADDR",
  // MikroTik
  "MIKROTIK_HOST",
  "MIKROTIK_REST_HOST",
  "MIKROTIK_REST_PORT",
  "MIKROTIK_USER",
  "MIKROTIK_REST_USER",
  "MIKROTIK_PASS",
  "MIKROTIK_REST_PASSWORD",
  "MIKROTIK_REST_USE_TLS",
  // OLT
  "OLT_HOST",
  "OLT_HSGQ_HOST",
  "OLT_HSGQ_PORT",
  "OLT_USERNAME",
  "OLT_HSGQ_USER",
  "OLT_PASSWORD",
  "OLT_HSGQ_PASSWORD",
  "OLT_HSGQ_USE_TLS",
  // GenieACS
  "GENIEACS_URL",
  "GENIEACS_NBI_URL",
  "GENIEACS_USERNAME",
  "GENIEACS_NBI_USER",
  "GENIEACS_PASSWORD",
  "GENIEACS_NBI_PASSWORD",
  "GENIEACS_TIMEOUT_MS",
  // Billing
  "BILLING_URL",
  "BILLING_USERNAME",
  "BILLING_PASSWORD",
  "BILLING_SYNC_MINUTE",
  "BILLING_DROP_PERCENT",
  "BILLING_DROP_MIN_INVOICES",
  // DB
  "TIMESCALE_ENABLED",
  "TRAFFIC_RETENTION_DAYS",
];

test(".env.server.example ada dan tidak diabaikan git", () => {
  assert.ok(existsSync(join(root, file)));
  assert.equal(ignored(file), false);
  assert.ok(ignored(".env.server"), ".env.server privat harus tetap diabaikan");
});

test("baris pertama memuat PERINGATAN KEAMANAN", () => {
  assert.match(lines()[0], /^# PERINGATAN KEAMANAN/);
});

test("semua kunci wajib tercakup", () => {
  const keys = new Set(entries().map(([k]) => k));
  assert.deepEqual(
    REQUIRED.filter((k) => !keys.has(k)),
    [],
  );
});

test("kunci rahasia hanya bernilai placeholder <...>", () => {
  const secretKey = /(SECRET|PASSWORD|PASS|TOKEN|_KEY|_USER|USERNAME)$/;
  const secrets = entries().filter(([k]) => secretKey.test(k));
  assert.ok(secrets.length >= 15);
  const bad = secrets
    .filter(([, v]) => !/^<[A-Z0-9_]+>$/.test(v))
    .map(([k]) => k);
  assert.deepEqual(bad, []);
  // DATABASE_URL: kredensial wajib placeholder
  const db = entries().find(([k]) => k === "DATABASE_URL")[1];
  assert.match(
    db,
    /^postgresql:\/\/<DB_USER>:<DB_PASSWORD>@<DB_HOST>:\d+\/<DB_NAME>$/,
  );
});
