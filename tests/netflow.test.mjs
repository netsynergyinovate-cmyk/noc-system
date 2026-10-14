import test from "node:test";
import assert from "node:assert/strict";
import {
  mockNetflow,
  filterFlows,
  topFlows,
  summarizeNetflow,
  defaultFlowFilter,
  flowRangeSeconds,
  buildNetflowTimeSeries,
  TREND_POINTS,
} from "../src/lib/dashboard/netflow.ts";

const NOW = 1_800_000_000;
const all = mockNetflow(NOW);

test("mockNetflow deterministic, within 24h, newest first", () => {
  assert.deepEqual(mockNetflow(NOW), all);
  assert.ok(all.length > 100);
  for (const f of all) assert.ok(f.endedAt > NOW - 86_400 && f.endedAt <= NOW);
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].endedAt >= all[i].endedAt);
});

test("filterFlows by range", () => {
  const f1 = filterFlows(all, { ...defaultFlowFilter, range: "1h" }, NOW);
  const f6 = filterFlows(all, { ...defaultFlowFilter, range: "6h" }, NOW);
  const f24 = filterFlows(all, { ...defaultFlowFilter, range: "24h" }, NOW);
  assert.ok(f1.length < f6.length && f6.length < f24.length);
  assert.equal(f24.length, all.length);
  for (const f of f1) assert.ok(f.endedAt > NOW - flowRangeSeconds["1h"]);
});

test("filterFlows by router, protocol, app/port", () => {
  const base = { ...defaultFlowFilter, range: "24h" };
  const rid = all[0].routerId;
  const byRouter = filterFlows(all, { ...base, routerId: rid }, NOW);
  assert.ok(byRouter.length > 0 && byRouter.every((f) => f.routerId === rid));
  const udp = filterFlows(all, { ...base, protocol: "UDP" }, NOW);
  assert.ok(udp.length > 0 && udp.every((f) => f.protocol === "UDP"));
  const yt = filterFlows(all, { ...base, query: " youtube " }, NOW);
  assert.ok(yt.length > 0 && yt.every((f) => f.app === "YouTube"));
  const p53 = filterFlows(all, { ...base, query: "53" }, NOW);
  assert.ok(p53.length > 0 && p53.every((f) => f.dstPort === 53 || f.srcPort === 53));
  assert.equal(filterFlows(all, { ...base, query: "nope-xyz" }, NOW).length, 0);
});

test("filterFlows by clientIp and dstPort, isolated and combined", () => {
  const base = { ...defaultFlowFilter, range: "24h" };
  const ip = all[0].srcIp;
  const byIp = filterFlows(all, { ...base, clientIp: ` ${ip} ` }, NOW);
  assert.ok(byIp.length > 0 && byIp.every((f) => f.srcIp.includes(ip) || f.dstIp.includes(ip)));
  const prefix = filterFlows(all, { ...base, clientIp: "10." }, NOW);
  assert.ok(prefix.length > 0 && prefix.every((f) => f.srcIp.includes("10.") || f.dstIp.includes("10.")));

  const p443 = filterFlows(all, { ...base, dstPort: "443" }, NOW);
  assert.ok(p443.length > 0 && p443.every((f) => f.dstPort === 443));
  assert.equal(filterFlows(all, { ...base, dstPort: "44" }, NOW).length, 0);
  assert.equal(filterFlows(all, { ...base, dstPort: "abc" }, NOW).length, 0);

  const both = filterFlows(all, { ...base, clientIp: "10.", dstPort: "53" }, NOW);
  assert.ok(both.length > 0 && both.every((f) => f.dstPort === 53 && f.srcIp.includes("10.")));
  assert.ok(both.length < p443.length + prefix.length);
  const withOld = filterFlows(all, { ...base, dstPort: "53", protocol: "UDP", query: "dns" }, NOW);
  assert.ok(withOld.length > 0 && withOld.every((f) => f.app === "DNS"));
});

test("topFlows sorts by bytes desc and limits", () => {
  const top = topFlows(all, 5);
  assert.equal(top.length, 5);
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].bytes >= top[i].bytes);
  assert.equal(top[0].bytes, Math.max(...all.map((f) => f.bytes)));
  assert.equal(topFlows(all).length, 20);
  assert.equal(topFlows([], 5).length, 0);
});

test("summarizeNetflow", () => {
  const s = summarizeNetflow(all, "24h");
  const total = all.reduce((n, f) => n + f.bytes, 0);
  assert.equal(s.flowCount, all.length);
  assert.equal(s.totalBytes, total);
  assert.equal(s.throughputBps, (total * 8) / 86_400);
  assert.equal(s.flowsPerSec, all.length / 86_400);
  const byProto = {};
  const byApp = {};
  for (const f of all) {
    byProto[f.protocol] = (byProto[f.protocol] ?? 0) + f.bytes;
    byApp[f.app] = (byApp[f.app] ?? 0) + f.bytes;
  }
  const maxKey = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(s.topProtocol, maxKey(byProto));
  assert.equal(s.topApp, maxKey(byApp));
  const empty = summarizeNetflow([], "1h");
  assert.deepEqual(
    [empty.flowCount, empty.throughputBps, empty.topProtocol, empty.topApp],
    [0, 0, null, null],
  );
});

test("empty data: summary, time series and topFlows are safe", () => {
  const s = summarizeNetflow([], "1h");
  assert.equal(s.throughputBps, 0);
  assert.equal(s.flowsPerSec, 0);
  assert.equal(s.topProtocol, null);
  assert.equal(s.topApp, null);
  for (const range of ["1h", "6h", "24h", "7d"]) {
    const ts = buildNetflowTimeSeries([], range, NOW);
    assert.ok(ts.times.length > 0);
    assert.ok(ts.bps.every((v) => v === 0));
    assert.ok(ts.flows.every((v) => v === 0));
  }
  assert.deepEqual(topFlows([], 10), []);
});

test("mockNetflow supports 7d window", () => {
  const week = mockNetflow(NOW, flowRangeSeconds["7d"]);
  assert.ok(week.length > all.length * 5);
  for (const f of week) assert.ok(f.endedAt > NOW - 604_800 && f.endedAt <= NOW);
});

test("buildNetflowTimeSeries buckets are ordered, bounded and consistent", () => {
  const week = mockNetflow(NOW, flowRangeSeconds["7d"]);
  for (const range of ["1h", "6h", "24h", "7d"]) {
    const sec = flowRangeSeconds[range];
    const s = buildNetflowTimeSeries(week, range, NOW);
    assert.equal(s.times.length, TREND_POINTS);
    assert.equal(s.bps.length, TREND_POINTS);
    assert.equal(s.flows.length, TREND_POINTS);
    for (let i = 1; i < s.times.length; i++) assert.ok(s.times[i] > s.times[i - 1]);
    assert.ok(s.times[0] > NOW - sec && s.times.at(-1) === NOW);
    const inRange = filterFlows(week, { ...defaultFlowFilter, range }, NOW);
    assert.equal(s.flows.reduce((a, b) => a + b, 0), inRange.length);
    const step = sec / TREND_POINTS;
    const bytes = s.bps.reduce((a, b) => a + (b * step) / 8, 0);
    const expected = inRange.reduce((a, f) => a + f.bytes, 0);
    assert.ok(Math.abs(bytes - expected) <= expected * 1e-9);
  }
  const empty = buildNetflowTimeSeries([], "1h", NOW);
  assert.ok(empty.bps.every((v) => v === 0) && empty.flows.every((v) => v === 0));
});
