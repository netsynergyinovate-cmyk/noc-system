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

const routeFlows = await import("../src/app/api/netflow/flows/route.ts");
const routeNetflow = await import("../src/app/api/netflow/route.ts");
const { getTopFlows } = await import("../src/services/netflow.service.ts");
const { parseNetflowQuery } = await import("../src/validators/netflow.ts");

test("route exports GET dan POST handler", () => {
  assert.equal(typeof routeFlows.GET, "function");
  assert.equal(typeof routeFlows.POST, "function");
  assert.equal(typeof routeNetflow.GET, "function");
  assert.equal(typeof routeNetflow.POST, "function");
});

test("getTopFlows: mengembalikan daftar flow dan agregat total", async () => {
  const parsed = parseNetflowQuery(new URLSearchParams({ range: "1h", limit: "10" }));
  const res = await getTopFlows(parsed);
  assert.ok(res);
  assert.ok(Array.isArray(res.flows));
  assert.ok(res.flows.length <= 10);
  assert.equal(typeof res.totalBytes, "number");
  assert.equal(typeof res.totalPackets, "number");

  if (res.flows.length > 0) {
    const f = res.flows[0];
    assert.ok(f.srcIp);
    assert.ok(f.dstIp);
    assert.ok(f.protocol);
    assert.equal(typeof f.bytes, "number");
    assert.equal(typeof f.packets, "number");
    assert.ok(f.startedAt);
    assert.ok(f.endedAt);
  }
});
