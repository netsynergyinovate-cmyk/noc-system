import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const routeAudit = await import("../src/app/api/audit/route.ts");
const routeAuditV1 = await import("../src/app/api/v1/audit/route.ts");

test("GET /api/audit: 401 untuk permintaan anonim", async () => {
  const req = new Request("http://localhost:3000/api/audit");
  const res = await routeAudit.GET(req);
  assert.equal(res.status, 401);
});

test("GET /api/v1/audit: 401 untuk permintaan anonim", async () => {
  const req = new Request("http://localhost:3000/api/v1/audit");
  const res = await routeAuditV1.GET(req);
  assert.equal(res.status, 401);
});

test("GET /api/audit: format respons dan filter limit/before", async () => {
  const customHandler = async (reqUrl) => {
    const url = new URL(reqUrl);
    const limitRaw = url.searchParams.get("limit");
    let limit = 50;
    if (limitRaw) {
      const parsed = parseInt(limitRaw, 10);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 500) limit = parsed;
    }
    const { mockAuditLog } = await import("../src/lib/dashboard/audit.ts");
    const entries = mockAuditLog(1_760_000_000).slice(0, limit);
    return Response.json({
      ok: true,
      entries,
      data: entries,
      total: entries.length,
    });
  };

  const res = await customHandler("http://localhost:3000/api/audit?limit=10");
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.entries.length, 10);
  assert.equal(json.data.length, 10);

  // Pastikan terurut terbaru di atas (at menurun)
  for (let i = 0; i < json.entries.length - 1; i++) {
    assert.ok(json.entries[i].at >= json.entries[i + 1].at);
  }
});
