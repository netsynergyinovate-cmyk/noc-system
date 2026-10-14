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

const { GET: getStatus } = await import(
  "../src/app/api/alignment/status/route.ts"
);
const { GET: getAlignment, POST: postAlignment } = await import(
  "../src/app/api/alignment/route.ts"
);
const { getAlignmentStatusAndHistory } = await import(
  "../src/services/data-alignment.service.ts"
);

test("handler GET & POST route alignment terdefinisi", () => {
  assert.equal(typeof getStatus, "function");
  assert.equal(typeof getAlignment, "function");
  assert.equal(typeof postAlignment, "function");
});

test("GET /api/alignment/status menolak request tanpa sesi login (401)", async () => {
  const req = new Request("http://localhost:3101/api/alignment/status", {
    method: "GET",
  });
  const res = await getStatus(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "UNAUTHORIZED");
});

test("POST /api/alignment menolak request tanpa sesi login (401)", async () => {
  const req = new Request("http://localhost:3101/api/alignment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ steps: ["thresholds"] }),
  });
  const res = await postAlignment(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error.code, "UNAUTHORIZED");
});

test("getAlignmentStatusAndHistory menghasilkan struktur status valid", async () => {
  const data = await getAlignmentStatusAndHistory();
  assert.ok(data.overview);
  assert.ok(data.jobs);
  assert.ok(Array.isArray(data.jobs));
  assert.ok(Array.isArray(data.recentRuns));
  assert.ok(data.checkedAt);
});
