import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const onus = await import("../src/lib/dashboard/onus.ts");
const olts = await import("../src/lib/dashboard/olts.ts");
const live = await import("../src/lib/dashboard/olt-live.ts");
const pon = await import("../src/lib/dashboard/pon-port-live.ts");

const item = (o = {}) => ({
  id: "u1", oltId: "o1", oltName: "OLT Utama", ponIndex: 2, onuIndex: 7, description: null,
  serialNumber: "HSGQ27", customerId: null, customerName: null, pppoeUsername: null,
  rxPower: -21.5, txPower: 2.1, attenuation: 23.6, status: "online", capturedAt: "2026-10-14T09:00:00.000Z", ...o,
});

test("ONU dari database dipetakan tanpa angka karangan", () => {
  const d = onus.apiOnuToDashboard(item());
  assert.deepEqual(
    [d.serialNumber, d.ponPort, d.model, d.customerName, d.pppoeUsername, d.rxPowerDbm, d.txPowerDbm, d.distanceMeters, d.status, d.lastSeenAt],
    ["HSGQ27", "PON 2:7", "-", "Belum dipasangkan", "-", -21.5, 2.1, null, "online", 1_791_968_400],
  );
  const los = onus.apiOnuToDashboard(item({ status: "los", rxPower: null, txPower: null, serialNumber: null }));
  assert.deepEqual([los.status, los.rxPowerDbm, los.serialNumber], ["los", null, "-"]);
  assert.equal(onus.apiOnuToDashboard(item({ status: "aneh" })).status, "offline");
  assert.equal(onus.apiOnuToDashboard(item({ capturedAt: "bukan-tanggal" })).lastSeenAt, 0);
});

test("filter ONU: lemah mengabaikan ONU tanpa bacaan", () => {
  const list = [
    onus.apiOnuToDashboard(item({ id: "a", rxPower: -29 })),
    onus.apiOnuToDashboard(item({ id: "b", rxPower: -20 })),
    onus.apiOnuToDashboard(item({ id: "c", status: "offline", rxPower: null })),
  ];
  assert.deepEqual(onus.filterOnus(list, "", "weak", "all").map((o) => o.id), ["a"]);
  assert.deepEqual(onus.filterOnus(list, "", "offline", "all").map((o) => o.id), ["c"]);
  assert.deepEqual(onus.filterOnus(list, "pon 2:7", "all", "all").length, 3);
});

test("optik pelanggan: ONU offline tidak punya bacaan, bukan 0", () => {
  const on = onus.apiOnuToCustomerOptical(item(), true);
  assert.deepEqual([on.rxPowerDbm, on.txPowerDbm, on.attenuationDb, on.distanceMeters, on.oltName, on.ponPort], [-21.5, 2.1, 23.6, null, "OLT Utama", "PON 2:7"]);
  const off = onus.apiOnuToCustomerOptical(item({ status: "offline" }), false);
  assert.deepEqual([off.rxPowerDbm, off.txPowerDbm, off.attenuationDb], [null, null, null]);
});

test("OLT dari database memakai hitungan hasil polling, bukan 8 port bawaan", () => {
  const base = { id: "o1", name: "OLT", host: "10.0.0.9", brand: "HSGQ", driver: "hsgq", status: "aktif", lastSeenAt: "2026-10-14T09:00:00.000Z" };
  const polled = olts.apiOltToDashboard({ ...base, ponPortCount: 4, onuTotal: 60, onuOnline: 52 });
  assert.deepEqual([polled.totalPonPorts, polled.activeOnus], [4, 52]);
  const never = olts.apiOltToDashboard({ ...base, lastSeenAt: null });
  assert.deepEqual([never.totalPonPorts, never.activeOnus, never.lastSeenAt], [0, 0, null]);
});

const json = (s, b) => new Response(JSON.stringify(b), { status: s });

test("fetchLiveOnus: memuat semua halaman, memotong bila terlalu banyak", async () => {
  const real = globalThis.fetch;
  try {
    const total = 450;
    globalThis.fetch = async (url) => {
      const u = new URL(String(url), "http://x");
      const offset = Number(u.searchParams.get("offset"));
      const limit = Number(u.searchParams.get("limit"));
      const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => item({ id: `n${offset + i}`, onuIndex: offset + i }));
      return json(200, { data: { items, total } });
    };
    const r = await live.fetchLiveOnus();
    assert.deepEqual([r.onus.length, r.total, r.truncated], [450, 450, false]);

    globalThis.fetch = async (url) => {
      const offset = Number(new URL(String(url), "http://x").searchParams.get("offset"));
      return json(200, { data: { items: Array.from({ length: 200 }, (_, i) => item({ id: `m${offset + i}` })), total: 100_000 } });
    };
    const big = await live.fetchLiveOnus();
    assert.equal(big.truncated, true);
    assert.equal(big.onus.length, 5000, "dibatasi 25 halaman, tidak berputar tanpa akhir");

    globalThis.fetch = async () => json(500, {});
    await assert.rejects(live.fetchLiveOnus(), live.OltLoadError);
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    await assert.rejects(live.fetchLiveOnus(), live.OltLoadError);
  } finally {
    globalThis.fetch = real;
  }
});

test("mapOnuLive menerjemahkan jawaban server menjadi pesan yang jelas", async () => {
  const real = globalThis.fetch;
  try {
    const run = async (res) => {
      globalThis.fetch = async () => { if (res instanceof Error) throw res; return res; };
      return live.mapOnuLive("u1", "c1");
    };
    assert.deepEqual(await run(json(200, {})), { ok: true });
    assert.match((await run(json(409, {}))).message, /sudah punya ONU lain/);
    assert.match((await run(json(403, {}))).message, /tidak punya izin/);
    assert.match((await run(json(404, {}))).message, /tidak ditemukan/);
    assert.match((await run(json(500, {}))).message, /HTTP 500/);
    assert.match((await run(new TypeError("x"))).message, /belum tersimpan/);
  } finally {
    globalThis.fetch = real;
  }
});

const port = (o = {}) => ({
  id: "o1-pon-1", oltId: "o1", oltName: "OLT", ponIndex: 1, name: "PON 1", status: "up", capacity: 128,
  onuCount: 3, onlineOnuCount: 2, txPowerDbm: 2.5, avgRxPowerDbm: -19, ...o,
});
const dash = (o) => onus.apiOnuToDashboard(item(o));

test("ringkasan PON: dihitung dari ONU nyata, nol-nol bukan bacaan, aturan status sama dengan demo", () => {
  const list = [
    dash({ id: "a", ponIndex: 1, onuIndex: 1, rxPower: -29 }),
    dash({ id: "b", ponIndex: 1, onuIndex: 2, rxPower: -20 }),
    dash({ id: "c", ponIndex: 1, onuIndex: 3, status: "los", rxPower: null }),
    dash({ id: "x", ponIndex: 2, onuIndex: 1 }), // PON lain
    dash({ id: "y", oltId: "o2", ponIndex: 1, onuIndex: 1 }), // OLT lain
  ];
  const [r] = pon.buildPonRows("o1", "OLT", [port()], list);
  assert.deepEqual(
    [r.portId, r.totalOnu, r.onlineOnu, r.weakOnuCount, r.losOnuCount, r.capacityPercent, r.opticalStatus],
    ["o1:1", 3, 2, 1, 1, 2, "normal"],
  );
  const [none] = pon.buildPonRows("o1", "OLT", [port({ avgRxPowerDbm: 0, txPowerDbm: 0, onuCount: 0, onlineOnuCount: 0 })], []);
  assert.deepEqual([none.rxPowerDbm, none.txPowerDbm, none.opticalStatus], [null, null, "normal"]);
  const [weak] = pon.buildPonRows("o1", "OLT", [port({ avgRxPowerDbm: -28 })], []);
  assert.equal(weak.opticalStatus, "critical");
  const [warn] = pon.buildPonRows("o1", "OLT", [port({ avgRxPowerDbm: -25 })], []);
  assert.equal(warn.opticalStatus, "warning");
  const [down] = pon.buildPonRows("o1", "OLT", [port({ status: "down" })], []);
  assert.equal(down.opticalStatus, "critical");
});
