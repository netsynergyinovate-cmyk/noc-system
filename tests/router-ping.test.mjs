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
const { pingFromRouter, formatPingOutput } =
  await import("../src/services/router-ping.service.ts");

test("Ping Service: menolak host atau target tidak valid / berbahaya", async () => {
  await assert.rejects(
    () => pingFromRouter("router-1", "8.8.8.8; rm -rf /"),
    /Target host atau IP tidak valid/,
  );
  await assert.rejects(
    () => pingFromRouter("router-1", "http://google.com"),
    /Target host atau IP tidak valid/,
  );
  await assert.rejects(
    () => pingFromRouter("router-1", ""),
    /Target host atau IP tidak valid/,
  );
});

test("Ping Service: formatPingOutput mengembalikan respons ping terformat", () => {
  const samplePackets = [
    {
      host: "8.8.8.8",
      size: 56,
      ttl: 118,
      timeMs: 14.2,
      packetLoss: 0,
      status: "ok",
    },
    {
      host: "8.8.8.8",
      size: 56,
      ttl: 118,
      timeMs: 15.1,
      packetLoss: 0,
      status: "ok",
    },
    {
      host: "8.8.8.8",
      size: 56,
      ttl: 118,
      timeMs: 13.9,
      packetLoss: 0,
      status: "ok",
    },
    {
      host: "8.8.8.8",
      size: 56,
      ttl: 118,
      timeMs: 14.5,
      packetLoss: 0,
      status: "ok",
    },
  ];
  const res = formatPingOutput("8.8.8.8", 4, samplePackets);
  assert.equal(res.target, "8.8.8.8");
  assert.equal(res.stats.sent, 4);
  assert.ok(res.stats.received > 0);
  assert.ok(res.terminalLines.length > 0);
  assert.ok(res.terminalLines.some((l) => l.includes("packets transmitted")));
  assert.ok(res.terminalLines.some((l) => l.includes("rtt min/avg/max")));
});
