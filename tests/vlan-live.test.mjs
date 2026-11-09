import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { buildLiveVlanSummary, seedVlanBuffer, VLAN_LIVE_POINTS } =
  await import("../src/lib/dashboard/vlan-live.ts");

let clock = 0;
const vlan = (
  name,
  down,
  up,
  running = true,
  at = down === null ? null : ++clock,
) => ({
  routerId: "r1",
  name,
  running,
  disabled: false,
  downMbps: down,
  upMbps: up,
  at,
});
const tele = (vlans, pons = []) => ({ vlans, pons });

test("titik grafik hanya ditambah saat laju terhitung; ONU dan Rx dari port PON", () => {
  const buffer = new Map();
  const pons = [
    { oltName: "HSGQ", ponIndex: 2, onuOnline: 12, rxPowerDbm: -18.5 },
  ];
  let s = buildLiveVlanSummary(
    tele([vlan("vlan1102", null, null)], pons),
    buffer,
    1_000,
  );
  assert.equal(s.items[0].series.length, 0);
  assert.equal(s.items[0].currentDownloadMbps, 0);

  s = buildLiveVlanSummary(
    tele([vlan("vlan1102", 10, 1)], pons),
    buffer,
    2_000,
  );
  s = buildLiveVlanSummary(
    tele([vlan("vlan1102", 30, 3)], pons),
    buffer,
    3_000,
  );
  const item = s.items[0];
  assert.deepEqual(
    [item.ponName, item.vlanId, item.onuCount, item.rxPowerDbm],
    ["PON 2", 1102, 12, -18.5],
  );
  assert.deepEqual(
    [item.currentDownloadMbps, item.peakDownloadMbps, item.avgDownloadMbps],
    [30, 30, 20],
  );
  assert.equal(s.totalOnuOnline, 12);
  assert.equal(s.totalActivePon, 1);
});

test("hanya vlan110N yang dipakai, urut PON, dan jendela dibatasi", () => {
  const buffer = new Map();
  let s;
  for (let i = 0; i < VLAN_LIVE_POINTS + 5; i++) {
    s = buildLiveVlanSummary(
      tele([
        vlan("vlan1105", i, 0),
        vlan("vlan10", 9, 9),
        vlan("vlan1101", 1, 1),
      ]),
      buffer,
      i * 1000,
    );
  }
  assert.deepEqual(
    s.items.map((i) => i.vlanName),
    ["vlan1101", "vlan1105"],
  );
  assert.equal(s.items[1].series.length, VLAN_LIVE_POINTS);
  assert.equal(s.items[1].series[0].downloadMbps, 5);
});

test("pesan telemetri ulang dengan waktu sampel yang sama tidak menambah titik", () => {
  const buffer = new Map();
  const sample = vlan("vlan1101", 5, 1, true, 100);
  buildLiveVlanSummary(tele([sample]), buffer, 1_000);
  buildLiveVlanSummary(tele([sample]), buffer, 1_500);
  const s = buildLiveVlanSummary(tele([{ ...sample, at: 101 }]), buffer, 2_000);
  assert.deepEqual(
    s.items[0].series.map((p) => p.timestamp),
    [100, 101],
  );
});

test("riwayat backend mengisi buffer; titik live berikutnya menyambung tanpa duplikat", () => {
  const buffer = new Map();
  seedVlanBuffer(buffer, [
    {
      routerId: "r1",
      name: "vlan1101",
      samples: [
        { at: 100, downMbps: 1, upMbps: 0 },
        { at: 101, downMbps: 2, upMbps: 0 },
      ],
    },
  ]);
  let s = buildLiveVlanSummary(
    tele([vlan("vlan1101", 2, 0, true, 101)]),
    buffer,
    0,
  );
  assert.equal(s.items[0].series.length, 2);
  s = buildLiveVlanSummary(
    tele([vlan("vlan1101", 3, 0, true, 102)]),
    buffer,
    0,
  );
  assert.deepEqual(
    s.items[0].series.map((p) => p.timestamp),
    [100, 101, 102],
  );
  assert.equal(VLAN_LIVE_POINTS, 300);
});
