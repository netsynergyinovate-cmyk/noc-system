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

const { GET: getRun, POST: postRun } = await import(
  "../src/app/api/transfer/run/route.ts"
);
const { GET: getTransfer, POST: postTransfer } = await import(
  "../src/app/api/transfer/route.ts"
);

test("handler GET & POST route transfer terdefinisi", () => {
  assert.equal(typeof getRun, "function");
  assert.equal(typeof postRun, "function");
  assert.equal(typeof getTransfer, "function");
  assert.equal(typeof postTransfer, "function");
});

test("GET /api/transfer/run menolak request tanpa sesi login (401)", async () => {
  const req = new Request("http://localhost:3101/api/transfer/run", {
    method: "GET",
  });
  const res = await getRun(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "UNAUTHORIZED");
});

test("POST /api/transfer/run menolak request tanpa sesi login (401)", async () => {
  const req = new Request("http://localhost:3101/api/transfer/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: true }),
  });
  const res = await postRun(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "UNAUTHORIZED");
});
