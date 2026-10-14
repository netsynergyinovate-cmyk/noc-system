import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const { GET: getStatus } = await import("../src/app/api/seed/status/route.ts");
const { GET: getSeed, POST: postSeed } = await import("../src/app/api/seed/route.ts");
const { getSeedDataStatus } = await import("../src/services/seed-data.service.ts");

test("handler GET status seed dan route seed terdefinisi", () => {
  assert.equal(typeof getStatus, "function");
  assert.equal(typeof getSeed, "function");
  assert.equal(typeof postSeed, "function");
  assert.equal(typeof getSeedDataStatus, "function");
});

test("GET /api/seed/status menolak request tanpa sesi login (401)", async () => {
  const req = new Request("http://localhost:3101/api/seed/status", {
    method: "GET",
  });
  const res = await getStatus(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "UNAUTHORIZED");
});

test("POST /api/seed menolak request tanpa sesi login (401)", async () => {
  const req = new Request("http://localhost:3101/api/seed", {
    method: "POST",
  });
  const res = await postSeed(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "UNAUTHORIZED");
});
