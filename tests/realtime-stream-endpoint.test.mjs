import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { GET } = await import("../src/app/api/realtime/stream/route.ts");
const { formatSseEvent } = await import("../src/lib/dashboard/sse-format.ts");
const { auth } = await import("../src/lib/auth.ts");

const req = (signal) =>
  new Request("http://localhost:3101/api/realtime/stream", { signal });

async function signedIn(fn) {
  const original = auth.api.getSession;
  auth.api.getSession = async () => ({
    session: { id: "s1" },
    user: { id: "u1", name: "Budi", email: "b@x.id", role: "user" },
  });
  try {
    await fn();
  } finally {
    auth.api.getSession = original;
  }
}

test("formatSseEvent", () => {
  assert.equal(
    formatSseEvent("ping", { a: 1 }),
    'event: ping\ndata: {"a":1}\n\n',
  );
});

test("tanpa sesi -> 401", async () => {
  const original = auth.api.getSession;
  auth.api.getSession = async () => null;
  try {
    const res = await GET(req());
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), {
      error: "unauthorized",
      message: "Sesi login diperlukan.",
    });
  } finally {
    auth.api.getSession = original;
  }
});

test("dengan sesi -> 200 SSE berisi snapshot, alerts, incidents", async () => {
  await signedIn(async () => {
    const ac = new AbortController();
    const res = await GET(req(ac.signal));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    assert.equal(res.headers.get("cache-control"), "no-cache, no-transform");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = "";
    while (!text.includes("event: incidents")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
    await reader.cancel();
    ac.abort();
    assert.match(text, /^event: snapshot\ndata: /);
    assert.match(text, /event: alerts\ndata: /);
    assert.match(text, /event: incidents\ndata: /);
    const alertsData = text
      .split("\n\n")
      .find((b) => b.startsWith("event: alerts"))
      .split("data: ")[1];
    const msg = JSON.parse(alertsData);
    assert.equal(msg.type, "alerts");
    assert.ok(Array.isArray(msg.active));
    assert.deepEqual(msg.ended, []);
  });
});
