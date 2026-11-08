import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const live = await import("../src/lib/dashboard/alerts-live.ts");
const ws = await import("../src/lib/dashboard/realtime-ws.ts");
const { createLiveAlertActions } = await import("../src/lib/dashboard/alert-actions-live.ts");

const directory = live.buildLiveDirectory(
  [{ id: "r1", name: "Core CIARA", host: "10.0.0.1", active: true }],
  [
    { id: "c1", name: "Budi", routerId: "r1", odpName: "ODP-01" },
    { id: "c2", name: "Siti", routerId: "r1", odpName: "ODP-01" },
    { id: "c3", name: "Agus", routerId: "r1", odpName: "ODP-02" },
  ],
);

const loc = (name) => ({ name, address: null, odpName: null, latitude: null, longitude: null });
const item = (o) => ({
  id: "a1", type: "offline", severity: "warning", status: "active", routerId: "r1", customerId: "c1",
  startedAt: 1000, detectedAt: 1030, endedAt: null, timeSource: "poll", timeUncertaintySeconds: 30,
  endTimeSource: null, endTimeUncertaintySeconds: null, handledBy: null, location: loc("Budi"), ...o,
});

test("alert aktif: dipetakan apa adanya, tanpa angka karangan", () => {
  const [a] = live.toLiveActiveAlerts([item({})], directory);
  assert.deepEqual([a.id, a.kind, a.severity, a.endedAt, a.routerId, a.customerId, a.measured, a.interfaceName],
    ["a1", "offline", "warning", null, "r1", "c1", null, null]);
  assert.deepEqual([a.timeSource, a.timeUncertaintySeconds, a.detectedAt], ["poll", 30, 1030]);
  assert.equal(a.rootSource.name, "Budi");
  assert.equal(a.affectedCustomers, 1);
});

test("angka terukur dari detail rule engine dipakai apa adanya (bukan placeholder)", () => {
  const out = live.toLiveActiveAlerts(
    [
      item({ id: "cpu", type: "cpu", cpuLoad: 91 }),
      item({ id: "queue", type: "queue", queueUpRatio: 0.2, queueDownRatio: 0.97 }),
      item({ id: "port", type: "port", errorsPerMinute: 32.4, interfaceName: "ether1-wan" }),
    ],
    directory,
  );
  const byId = Object.fromEntries(out.map((a) => [a.id, a]));
  assert.equal(byId.cpu.measured, 91);
  assert.equal(byId.queue.measured, 97);
  assert.equal(byId.port.measured, 32.4);
  assert.equal(byId.port.interfaceName, "ether1-wan");
});

test("baris tak dikenal atau yang sudah selesai tidak masuk daftar aktif", () => {
  const out = live.toLiveActiveAlerts(
    [item({ id: "x", type: "aneh" }), item({ id: "y", severity: "genting" }), item({ id: "z", endedAt: 2000 })],
    directory,
  );
  assert.equal(out.length, 0);
});

test("beberapa pelanggan offline di ODP yang sama dikorelasikan menjadi satu sebab", () => {
  const items = [
    item({ id: "a1", customerId: "c1", startedAt: 1000 }),
    item({ id: "a2", customerId: "c2", startedAt: 1005 }),
    item({ id: "a3", customerId: "c3", startedAt: 1010 }),
  ];
  const out = live.toLiveActiveAlerts(items, directory);
  assert.equal(out.length, 3);
  const grouped = out.filter((a) => a.correlationId !== null);
  assert.ok(grouped.length >= 2, "sedikitnya dua alert satu kelompok");
  assert.equal(new Set(grouped.map((a) => a.correlationId)).size, 1);
});

test("riwayat: selesai sendiri vs ditandai petugas", () => {
  const [auto, op] = live.toLiveResolvedAlerts([
    item({ id: "r1", status: "resolved", endedAt: 1500, endTimeSource: "poll", endTimeUncertaintySeconds: 30 }),
    item({ id: "r2", status: "handled", endedAt: 1600, endTimeSource: "operator", handledBy: "Budi Admin" }),
    item({ id: "skip", endedAt: null }),
  ]);
  assert.deepEqual([auto.endTimeSource, auto.endTimeUncertaintySeconds, auto.handledBy], ["poll", 30, null]);
  assert.deepEqual([op.endTimeSource, op.endTimeUncertaintySeconds, op.handledBy], ["operator", 0, "Budi Admin"]);
});

test("anomali: aktif dan riwayat dalam satu daftar", () => {
  const out = live.toLiveAnomalies([item({}), item({ id: "h", endedAt: 1500, status: "resolved" })], directory);
  assert.deepEqual(out.map((a) => [a.id, a.endedAt]).sort(), [["a1", null], ["h", 1500]]);
});

test("pesan WebSocket 'events' (tanpa time) memberi sinyal pemuatan ulang alert", () => {
  const seen = [];
  globalThis.window = { dispatchEvent: (e) => seen.push(e.type) };
  const ok = ws.handleRealtimeMessage(JSON.stringify({ type: "events", events: [] }), {});
  delete globalThis.window;
  assert.equal(ok, true);
  assert.deepEqual(seen, [ws.ALERT_EVENTS_SIGNAL]);
});

test("tindakan nyata menandai ditangani: sukses, 409, 403, jaringan putus", async () => {
  const real = globalThis.fetch;
  const run = async (res) => {
    globalThis.fetch = async () => { if (res instanceof Error) throw res; return res; };
    return createLiveAlertActions().handle("a1", "x");
  };
  const json = (s, b) => new Response(JSON.stringify(b), { status: s });
  try {
    const ok = await run(json(200, { data: item({ status: "handled", endedAt: 1700, endTimeSource: "operator", handledBy: "Admin" }) }));
    assert.equal(ok.ok, true);
    assert.equal(ok.alert.handledBy, "Admin");
    assert.deepEqual([(await run(json(409, {}))).reason, (await run(json(404, {}))).reason], ["not-active", "not-active"]);
    assert.equal((await run(json(403, {}))).reason, "forbidden");
    assert.equal((await run(new TypeError("fetch failed"))).reason, "offline");
    const srv = await run(json(500, {}));
    assert.equal(srv.reason, "offline");
    assert.match(srv.message, /HTTP 500/);
  } finally {
    globalThis.fetch = real;
  }
});

test("nama dari baris alert dipakai bila store belum memuat pelanggan/router", () => {
  const rows = [
    item({ id: "n1", customerId: "c9", location: loc("SARIJO") }),
    item({ id: "n2", routerId: "r9", customerId: null, location: loc("Core Baru") }),
  ];
  const dir = live.buildLiveDirectory([], [], rows);
  assert.equal(dir.customerName("c9"), "SARIJO");
  assert.equal(dir.routerName("r9"), "Core Baru");
  // Store tetap menang (nama terbaru setelah sinkron billing).
  const fresh = live.buildLiveDirectory([], [{ id: "c9", name: "SARIJO B", routerId: "r9", odpName: "" }], rows);
  assert.equal(fresh.customerName("c9"), "SARIJO B");
});
