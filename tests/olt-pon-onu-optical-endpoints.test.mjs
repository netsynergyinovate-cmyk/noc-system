import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { auth } = await import("../src/lib/auth.ts");
const { db } = await import("../src/db/index.ts");
const { env } = await import("../src/lib/env.ts");
const { olts, oltPonPorts, oltOnus } = await import("../src/db/schema/index.ts");
const { GET: ponList } = await import("../src/app/api/olts/[id]/pon/route.ts");
const { GET: ponDetail } = await import("../src/app/api/olts/[id]/pon/[ponIndex]/route.ts");
const { GET: optical } = await import("../src/app/api/olts/[id]/optical/route.ts");

const OLT_ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-01-01T00:00:00Z");
const setMode = (m) => {
  process.env.DASHBOARD_DATA = m;
  env.DASHBOARD_DATA = m;
};

let authed = true;
auth.api.getSession = async () => (authed ? { user: { id: "u1" }, session: {} } : null);

// DB palsu: baris dipilih menurut tabel di from(); groupBy() = hitungan ONU per PON.
let rows = { olts: [], ports: [], onus: [] };
db.select = () => {
  let table;
  let grouped = false;
  const chain = {
    from(t) { table = t; return chain; },
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    groupBy() { grouped = true; return chain; },
    then(resolve, reject) {
      let out = [];
      if (table === olts) out = rows.olts;
      else if (table === oltPonPorts) out = rows.ports;
      else if (table === oltOnus)
        out = grouped
          ? Object.entries(Object.groupBy(rows.onus, (o) => o.ponIndex ?? 1)).map(([p, l]) => ({ ponIndex: Number(p), total: l.length }))
          : rows.onus;
      return Promise.resolve(out).then(resolve, reject);
    },
  };
  return chain;
};

const get = (handler, url, params) =>
  handler(new Request(`http://localhost:3101${url}`), { params: Promise.resolve(params) });
const errCode = async (res) => (await res.json()).error.code;

test.beforeEach(() => {
  authed = true;
  env.DASHBOARD_DATA = "demo";
  rows = { olts: [], ports: [], onus: [] };
});
test.after(() => {
  env.DASHBOARD_DATA = "demo";
});

// ---------- GET /api/olts/[id]/pon ----------
test("pon list: 401 tanpa sesi", async () => {
  authed = false;
  const res = await get(ponList, "/api/olts/olt-1/pon", { id: "olt-1" });
  assert.equal(res.status, 401);
  assert.equal(await errCode(res), "UNAUTHORIZED");
});

test("pon list: 404 bila OLT tidak ditemukan", async () => {
  setMode("live");
  for (const id of ["olt-1", "abc", OLT_ID]) {
    const res = await get(ponList, `/api/olts/${id}/pon`, { id });
    assert.equal(res.status, 404, id);
    assert.equal(await errCode(res), "NOT_FOUND");
  }
});

test("pon list: 200 demo memuat daya optik tiap port", async () => {
  setMode("demo");
  const res = await get(ponList, "/api/olts/olt-1/pon", { id: "olt-1" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const { data } = await res.json();
  assert.equal(data.length, 8);
  for (const p of data) {
    assert.equal(typeof p.txPowerDbm, "number");
    assert.equal(typeof p.avgRxPowerDbm, "number");
    assert.ok(Number.isInteger(p.onuCount));
  }
});

test("pon list: 200 live dari DB (tabel olt_pon_ports)", async () => {
  setMode("live");
  rows.olts = [{ id: OLT_ID, name: "O-A", host: "10.0.1.1" }];
  rows.ports = [{ ponIndex: 2, txPower: 3.1, rxPower: -21.4, onuOnlineCount: 1, attenuation: 24.5 }];
  rows.onus = [{ ponIndex: 2 }, { ponIndex: 2 }];
  const res = await get(ponList, `/api/olts/${OLT_ID}/pon`, { id: OLT_ID });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].txPowerDbm, 3.1);
  assert.equal(data[0].avgRxPowerDbm, -21.4);
  assert.equal(data[0].onuCount, 2);
  assert.equal(data[0].onlineOnuCount, 1);
});

// ---------- GET /api/olts/[id]/pon/[ponIndex] ----------
test("pon detail: 401 tanpa sesi", async () => {
  authed = false;
  const res = await get(ponDetail, `/api/olts/${OLT_ID}/pon/1`, { id: OLT_ID, ponIndex: "1" });
  assert.equal(res.status, 401);
});

test("pon detail: 422 untuk ponIndex / id tidak valid", async () => {
  for (const ponIndex of ["0", "abc", "-1", "1.5", "1e2", " 1", "1234567"]) {
    const res = await get(ponDetail, `/api/olts/${OLT_ID}/pon/x`, { id: OLT_ID, ponIndex });
    assert.equal(res.status, 422, ponIndex);
    assert.equal(await errCode(res), "VALIDATION_ERROR");
  }
  const res = await get(ponDetail, "/api/olts/abc/pon/1", { id: "abc", ponIndex: "1" });
  assert.equal(res.status, 422);
});

test("pon detail: 404 bila OLT atau port tidak ada (mode live)", async () => {
  setMode("live");
  let res = await get(ponDetail, `/api/olts/${OLT_ID}/pon/1`, { id: OLT_ID, ponIndex: "1" });
  assert.equal(res.status, 404, "OLT tidak ada");
  assert.equal(await errCode(res), "NOT_FOUND");

  rows.olts = [{ id: OLT_ID, name: "O-A", host: "10.0.1.1" }]; // OLT ada, port & ONU kosong
  res = await get(ponDetail, `/api/olts/${OLT_ID}/pon/9`, { id: OLT_ID, ponIndex: "9" });
  assert.equal(res.status, 404, "port tidak ada");
  assert.equal(await errCode(res), "NOT_FOUND");
});

test("pon detail: 200 dari DB memuat redaman port & ONU", async () => {
  setMode("live");
  rows.olts = [{ id: OLT_ID, name: "O-A", host: "10.0.1.1" }];
  rows.ports = [{ ponIndex: 3, txPower: 3.2, rxPower: -22.1, attenuation: 25.3, onuOnlineCount: 1, capturedAt: NOW }];
  rows.onus = [
    { onuIndex: 1, status: "online", serialNumber: "HSGQ0001", rx: -22.1, tx: 2.5, capturedAt: NOW, customerName: "Budi", pppoeUsername: "budi", address: "Jl. A" },
    { onuIndex: 2, status: "online", serialNumber: "HSGQ0002", rx: -28.4, tx: 2.4, capturedAt: NOW, customerName: null, pppoeUsername: null, address: null },
    { onuIndex: 3, status: "offline", serialNumber: "HSGQ0003", rx: null, tx: null, capturedAt: NOW, customerName: null, pppoeUsername: null, address: null },
  ];
  const res = await get(ponDetail, `/api/olts/${OLT_ID}/pon/3`, { id: OLT_ID, ponIndex: "3" });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.source, "db");
  assert.equal(data.ponIndex, 3);
  assert.equal(data.txPowerDbm, 3.2);
  assert.equal(data.rxPowerDbm, -22.1);
  assert.equal(data.attenuationDb, 25.3);
  assert.equal(data.onus.length, 3);
  assert.deepEqual(data.onus.map((o) => o.isWeak), [false, true, false]);
  assert.equal(data.onus[1].rxPowerDbm, -28.4);
  assert.equal(data.onus[1].txPowerDbm, 2.4);
  assert.equal(data.onus[2].rxPowerDbm, null);
  assert.equal(JSON.stringify(data).includes("passwordEnc"), false);
});

test("pon detail: 200 mock pada mode demo bila OLT belum ada di DB", async () => {
  setMode("demo");
  const res = await get(ponDetail, `/api/olts/${OLT_ID}/pon/2`, { id: OLT_ID, ponIndex: "2" });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(typeof data.attenuationDb, "number");
  assert.equal(typeof data.txPowerDbm, "number");
  assert.equal(typeof data.rxPowerDbm, "number");
  assert.ok(data.onus.length > 0);
  for (const o of data.onus) {
    assert.equal(typeof o.rxPowerDbm, "number");
    assert.equal(typeof o.txPowerDbm, "number");
    assert.equal(typeof o.isWeak, "boolean");
  }
});

// ---------- GET /api/olts/[id]/optical ----------
test("optical: 401 tanpa sesi", async () => {
  authed = false;
  const res = await get(optical, "/api/olts/olt-1/optical", { id: "olt-1" });
  assert.equal(res.status, 401);
});

test("optical: 422 untuk parameter tidak valid", async () => {
  for (const q of ["ponIndex=0", "ponIndex=abc", "ponIndex=129", "ponIndex=-1", "ponIndex=1.5", "foo=1"]) {
    const res = await get(optical, `/api/olts/olt-1/optical?${q}`, { id: "olt-1" });
    assert.equal(res.status, 422, q);
    assert.equal(await errCode(res), "VALIDATION_ERROR");
  }
});

test("optical: 404 bila OLT tidak ditemukan", async () => {
  for (const id of ["abc", "../etc"]) {
    const res = await get(optical, "/api/olts/x/optical", { id });
    assert.equal(res.status, 404, id);
    assert.equal(await errCode(res), "NOT_FOUND");
  }
  setMode("live");
  for (const id of ["olt-1", OLT_ID]) {
    const res = await get(optical, "/api/olts/x/optical", { id });
    assert.equal(res.status, 404, `live ${id}`);
  }
});

test("optical: 200 memuat summary & items ber-lossDb", async () => {
  setMode("demo");
  const res = await get(optical, "/api/olts/olt-1/optical", { id: "olt-1" });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  const s = data.summary;
  assert.ok(s.totalOnus > 0);
  assert.equal(s.totalOnus, data.items.length);
  assert.equal(s.normalCount + s.warningCount + s.criticalCount, s.totalOnus);
  assert.equal(typeof s.avgRxDbm, "number");
  for (const o of data.items) {
    assert.ok(["normal", "warning", "critical"].includes(o.category));
    if (o.txPowerDbm !== null && o.rxPowerDbm !== null)
      assert.equal(o.lossDb, Math.round((o.txPowerDbm - o.rxPowerDbm) * 100) / 100);
    else assert.equal(o.lossDb, null);
  }
});

test("optical: filter ponIndex hanya memuat ONU PON itu", async () => {
  const res = await get(optical, "/api/olts/olt-1/optical?ponIndex=3", { id: "olt-1" });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(data.items.length > 0);
  for (const o of data.items) assert.equal(o.ponIndex, 3);
});
