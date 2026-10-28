import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

register();

const {
  detectEnvironment,
  getRuntimeModeStatus,
} = await import("../src/services/runtime-mode.service.ts");

test("detectEnvironment mengidentifikasi localhost sebagai local", () => {
  const local1 = detectEnvironment("localhost:3000");
  assert.equal(local1.environment, "local");
  assert.equal(local1.isLocalhost, true);
  assert.equal(local1.label, "Local (localhost)");

  const local2 = detectEnvironment("127.0.0.1:8080");
  assert.equal(local2.environment, "local");
  assert.equal(local2.isLocalhost, true);

  const local3 = detectEnvironment("my-device.local");
  assert.equal(local3.environment, "local");
  assert.equal(local3.isLocalhost, true);
});

test("detectEnvironment mengidentifikasi host remote sebagai server", () => {
  const server1 = detectEnvironment("noc.myisp.net.id");
  assert.equal(server1.environment, "server");
  assert.equal(server1.isLocalhost, false);
  assert.equal(server1.label, "Server (Remote / VPS)");

  const server2 = detectEnvironment("192.168.100.50:3000");
  assert.equal(server2.environment, "server");
  assert.equal(server2.isLocalhost, false);
});

test("getRuntimeModeStatus mengembalikan status lingkungan dan database live", async () => {
  const status = await getRuntimeModeStatus("localhost:3000");
  assert.ok(status.environmentInfo);
  assert.equal(status.environmentInfo.isLocalhost, true);
  assert.equal(typeof status.databaseConnected, "boolean");
  assert.ok(status.dbStats);
});

test("Route handler /api/settings/mode mengekspor method GET dan tidak ada POST", async () => {
  const route = await import("../src/app/api/settings/mode/route.ts");
  assert.equal(typeof route.GET, "function");
  assert.equal(typeof route.POST, "undefined");
});
