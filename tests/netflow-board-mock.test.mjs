import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  NETFLOW_DATA_MOCK_ENTRY,
  mockNetflow,
  filterFlows,
  summarizeNetflow,
  topFlows,
  defaultFlowFilter,
} = await import("../src/lib/dashboard/netflow.ts");
const { SETUP_DATA_SOURCE_REGISTRY } =
  await import("../src/lib/dashboard/setup-extended.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = 1_760_000_000;
const flows = mockNetflow(NOW, 86_400);

test("NETFLOW_DATA_MOCK_ENTRY terdaftar di registry", () => {
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.length >= 14);
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.includes(NETFLOW_DATA_MOCK_ENTRY));
  assert.equal(NETFLOW_DATA_MOCK_ENTRY.envKey, "NETFLOW_PORT");
  assert.equal(NETFLOW_DATA_MOCK_ENTRY.status, "dummy");
  assert.match(NETFLOW_DATA_MOCK_ENTRY.notes, /Fase 5/);
});

test("filterFlows: rentang, protokol, router, IP, port", () => {
  assert.ok(flows.length > 100);
  const h1 = filterFlows(flows, { ...defaultFlowFilter, range: "1h" }, NOW);
  assert.ok(h1.length > 0 && h1.length < flows.length);
  for (const f of h1) assert.ok(f.endedAt > NOW - 3600 && f.endedAt <= NOW);

  const udp = filterFlows(
    flows,
    { ...defaultFlowFilter, range: "24h", protocol: "UDP" },
    NOW,
  );
  assert.ok(udp.length > 0);
  assert.ok(udp.every((f) => f.protocol === "UDP"));

  const rid = flows[0].routerId;
  const byRouter = filterFlows(
    flows,
    { ...defaultFlowFilter, range: "24h", routerId: rid },
    NOW,
  );
  assert.ok(byRouter.every((f) => f.routerId === rid));

  const ip = flows[0].srcIp;
  const byIp = filterFlows(
    flows,
    { ...defaultFlowFilter, range: "24h", clientIp: ip },
    NOW,
  );
  assert.ok(byIp.length > 0);
  assert.ok(byIp.every((f) => f.srcIp.includes(ip) || f.dstIp.includes(ip)));

  const p443 = filterFlows(
    flows,
    { ...defaultFlowFilter, range: "24h", dstPort: "443" },
    NOW,
  );
  assert.ok(p443.length > 0 && p443.every((f) => f.dstPort === 443));

  const none = filterFlows(
    flows,
    { ...defaultFlowFilter, range: "24h", query: "tidak-ada-app" },
    NOW,
  );
  assert.equal(none.length, 0);
});

test("summarizeNetflow: total, throughput, laju, teratas", () => {
  const s = summarizeNetflow(flows, "24h");
  const total = flows.reduce((a, f) => a + f.bytes, 0);
  assert.equal(s.flowCount, flows.length);
  assert.equal(s.totalBytes, total);
  assert.equal(s.throughputBps, (total * 8) / 86_400);
  assert.equal(s.flowsPerSec, flows.length / 86_400);
  assert.ok(["TCP", "UDP", "ICMP"].includes(s.topProtocol));
  assert.equal(typeof s.topApp, "string");

  const empty = summarizeNetflow([], "1h");
  assert.equal(empty.flowCount, 0);
  assert.equal(empty.topApp, null);
  assert.equal(empty.topProtocol, null);
});

test("topFlows: urut bytes menurun, batas, tanpa mutasi input", () => {
  const copy = [...flows];
  const top = topFlows(flows, 20);
  assert.equal(top.length, 20);
  for (let i = 1; i < top.length; i++)
    assert.ok(top[i - 1].bytes >= top[i].bytes);
  assert.equal(top[0].bytes, Math.max(...flows.map((f) => f.bytes)));
  assert.deepEqual(flows, copy);
  assert.equal(topFlows(flows, 3).length, 3);
});

test("NetflowBoard: test id, badge tiruan, kolom tabel", () => {
  const src = read("../src/components/dashboard/netflow-board.tsx");
  for (const id of ["netflow-mock-badge", "netflow-table", "netflow-kpi"]) {
    assert.match(src, new RegExp(`data-testid="${id}"`));
  }
  assert.match(src, /Data Tiruan NetFlow \(Fase 2\)/);
  assert.match(src, /Fase 5/);
  for (const col of [
    "No",
    "Waktu Mulai",
    "Router",
    "Protokol",
    "Aplikasi",
    "Bytes",
    "Paket",
    "Throughput",
  ]) {
    assert.ok(src.includes(col), `kolom ${col}`);
  }
  assert.match(src, /IP Asal:Port → IP Tujuan:Port/);
});
