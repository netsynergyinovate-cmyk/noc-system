import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { getRouterPppoeSessions } =
  await import("../src/services/router-pppoe.service.ts");

test("PPPoE Service: mode demo mengembalikan sesi tiruan berstruktur valid", async () => {
  const sessions = await getRouterPppoeSessions("router-1");
  assert.ok(sessions.length > 0, "Harus mengembalikan sesi pada mode demo");
  for (const s of sessions) {
    assert.ok(s.id, "ID sesi harus ada");
    assert.ok(s.name, "Username PPPoE harus ada");
    assert.ok(s.address, "IP address harus ada");
    assert.ok(s.uptime, "Uptime harus ada");
    assert.ok(s.uptimeHuman, "Uptime terformat harus ada");
  }
});

test("PPPoE Service: pencarian menyaring username dan IP", async () => {
  const all = await getRouterPppoeSessions("router-1");
  const first = all[0];
  const byUser = await getRouterPppoeSessions("router-1", first.name);
  assert.ok(byUser.some((s) => s.id === first.id));

  const byIp = await getRouterPppoeSessions("router-1", first.address);
  assert.ok(byIp.some((s) => s.id === first.id));

  const none = await getRouterPppoeSessions(
    "router-1",
    "non-existent-user-xyz",
  );
  assert.equal(none.length, 0);
});
