import test from "node:test";
import assert from "node:assert/strict";
import { parseNetflowQuery } from "../src/validators/netflow.ts";
import {
  getNetflowFlows,
  selectTopFlows,
  flowRangeSeconds,
} from "../src/lib/dashboard/netflow.ts";

const parse = (qs) => parseNetflowQuery(new URLSearchParams(qs));
const NOW = 1_800_000_000;

test("default range 1h, limit 50", () => {
  assert.deepEqual(parse(""), { range: "1h", limit: 50 });
  assert.deepEqual(parse("q=&app="), { range: "1h", limit: 50 });
});

test("range dan protocol hanya nilai yang diizinkan", () => {
  for (const r of ["1h", "6h", "24h", "7d"])
    assert.equal(parse(`range=${r}`).range, r);
  for (const p of ["TCP", "UDP", "ICMP", "ALL"])
    assert.equal(parse(`protocol=${p}`).protocol, p);
  assert.throws(() => parse("range=30d"));
  assert.throws(() => parse("protocol=tcp"));
  assert.throws(() => parse("routerId=bukan-uuid"));
});

test("limit 1..500", () => {
  assert.equal(parse("limit=1").limit, 1);
  assert.equal(parse("limit=500").limit, 500);
  for (const bad of ["limit=0", "limit=501", "limit=abc", "limit=1.5"])
    assert.throws(() => parse(bad), bad);
});

test("fallback mock deterministik, terurut bytes, total cocok", () => {
  const a = selectTopFlows(
    getNetflowFlows(NOW, "24h"),
    { range: "24h", limit: 10 },
    NOW,
  );
  const b = selectTopFlows(
    getNetflowFlows(NOW, "24h"),
    { range: "24h", limit: 10 },
    NOW,
  );
  assert.deepEqual(a, b);
  assert.equal(a.flows.length, 10);
  for (let i = 1; i < a.flows.length; i++)
    assert.ok(a.flows[i - 1].bytes >= a.flows[i].bytes);
  assert.equal(
    a.totalBytes,
    a.flows.reduce((s, f) => s + f.bytes, 0),
  );
  assert.equal(
    a.totalPackets,
    a.flows.reduce((s, f) => s + f.packets, 0),
  );
});

test("filter protocol, app, q, range", () => {
  const all = getNetflowFlows(NOW, "7d");
  const udp = selectTopFlows(
    all,
    { range: "7d", protocol: "UDP", limit: 500 },
    NOW,
  );
  assert.ok(
    udp.flows.length > 0 && udp.flows.every((f) => f.protocol === "UDP"),
  );
  const dns = selectTopFlows(all, { range: "7d", app: "dns", limit: 500 }, NOW);
  assert.ok(dns.flows.length > 0 && dns.flows.every((f) => f.app === "DNS"));
  const p53 = selectTopFlows(all, { range: "7d", q: "53", limit: 500 }, NOW);
  assert.ok(
    p53.flows.every(
      (f) =>
        f.dstPort === 53 ||
        f.srcPort === 53 ||
        f.srcIp.includes("53") ||
        f.dstIp.includes("53"),
    ),
  );
  const h1 = selectTopFlows(all, { range: "1h", limit: 500 }, NOW);
  assert.ok(h1.flows.every((f) => f.endedAt > NOW - flowRangeSeconds["1h"]));
  const allp = selectTopFlows(
    all,
    { range: "7d", protocol: "ALL", limit: 500 },
    NOW,
  );
  assert.ok(allp.flows.some((f) => f.protocol !== "UDP"));
  assert.ok(allp.totalBytes >= udp.totalBytes);
});
