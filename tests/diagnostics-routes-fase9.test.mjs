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

const compareRoute =
  await import("../src/app/api/anomalies/diagnostics/compare/route.ts");
const attachRoute =
  await import("../src/app/api/anomalies/diagnostics/[runId]/attach/route.ts");

test("Fase 9 routes: export handler dan runtime nodejs", () => {
  assert.equal(typeof compareRoute.GET, "function");
  assert.equal(compareRoute.runtime, "nodejs");
  assert.equal(typeof attachRoute.POST, "function");
  assert.equal(attachRoute.runtime, "nodejs");
});

test("GET /api/anomalies/diagnostics/compare menolak request tanpa sesi login (401)", async () => {
  const req = new Request(
    "http://localhost:3101/api/anomalies/diagnostics/compare?before=11111111-1111-4111-8111-111111111111&after=22222222-2222-4222-8222-222222222222",
    { method: "GET" },
  );
  const res = await compareRoute.GET(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "UNAUTHORIZED");
});

test("POST /api/anomalies/diagnostics/[runId]/attach menolak request tanpa sesi login (401)", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const req = new Request(
    `http://localhost:3101/api/anomalies/diagnostics/${runId}/attach`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId: "22222222-2222-4222-8222-222222222222" }),
    },
  );
  const params = Promise.resolve({ runId });
  const res = await attachRoute.POST(req, { params });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "UNAUTHORIZED");
});
