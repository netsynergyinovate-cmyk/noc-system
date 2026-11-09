import test from "node:test";
import assert from "node:assert/strict";
import {
  customerDrop,
  lossBudget,
  splitterLossDb,
  upstreamPath,
} from "../src/services/map/loss-budget.ts";

const dev = (id, type, extra = {}) => ({
  id,
  name: id,
  type,
  latitude: 0,
  longitude: 0,
  capacity: 0,
  status: "normal",
  parentDeviceId: null,
  ...extra,
});
const seg = (from, to, lengthM, customerId = null) => ({
  id: `${from}-${to ?? customerId}`,
  fromDeviceId: from,
  toDeviceId: to,
  customerId,
  lengthM,
});

const devices = [
  dev("olt", "server"),
  dev("odc", "odc", { splitterRatio: 8, parentDeviceId: "olt" }),
  dev("tiang", "pole"),
  dev("odp", "odp", { splitterRatio: 8, parentDeviceId: "odc" }),
];
const segments = [
  seg("olt", "odc", 2000),
  seg("odc", "tiang", 300),
  seg("tiang", "odp", 200),
  seg("odp", null, 100, "pel"),
];

test("upstreamPath: ikut induk, jarak dijumlah dari kabel lewat tiang", () => {
  const path = upstreamPath("odp", devices, segments);
  assert.deepEqual(
    path.nodes.map((d) => d.id),
    ["olt", "odc", "odp"],
  );
  assert.deepEqual(
    path.links.map((l) => l.lengthM),
    [2000, 500],
  );
  assert.ok(path.links.every((l) => !l.estimated));
});

test("upstreamPath: ODP dipindah ke ODC tapi kabelnya langsung dari OLT -> ODC tetap dihitung", () => {
  const far = devices.map((d) =>
    d.id === "odc" ? { ...d, latitude: 0.001 } : d,
  );
  const path = upstreamPath("odp", far, [
    seg("olt", "odc", 2000),
    seg("olt", "odp", 900),
  ]);
  assert.deepEqual(
    path.nodes.map((d) => d.id),
    ["olt", "odc", "odp"],
  );
  assert.equal(path.links[1].estimated, true); // ODC -> ODP: kabel belum digambar
  assert.ok(Math.abs(path.links[1].lengthM - 111.2) < 1);
});

test("upstreamPath: perangkat tanpa induk ikut kabel yang masuk", () => {
  const orphan = devices.map((d) =>
    d.id === "odp" ? { ...d, parentDeviceId: null } : d,
  );
  const path = upstreamPath("odp", orphan, segments);
  assert.deepEqual(
    path.nodes.map((d) => d.id),
    ["olt", "odc", "tiang", "odp"],
  );
});

test("upstreamPath: tanpa kabel ikut induk dan ditandai perkiraan", () => {
  const path = upstreamPath("odp", devices, []);
  assert.deepEqual(
    path.nodes.map((d) => d.id),
    ["olt", "odc", "odp"],
  );
  assert.ok(path.links.every((l) => l.estimated));
});

test("lossBudget: OLT -> ODC 1:8 -> ODP 1:8 -> pelanggan", () => {
  const drop = customerDrop(
    { id: "pel", odpId: "odp", latitude: 0, longitude: 0 },
    devices,
    segments,
  );
  assert.equal(drop.odp.id, "odp");
  const b = lossBudget(upstreamPath("odp", devices, segments), drop);
  // konektor OLT 0.25 + serat 2.6 km x 0.35 (0.91) + 2 x (10.5 + 0.6) + konektor ONU 0.25
  assert.equal(b.totalLossDb, 23.61);
  assert.equal(b.rxDbm, 5 - 23.61);
  assert.equal(b.complete, true);
  assert.deepEqual(
    b.steps.map((s) => s.kind),
    ["source", "fiber", "splitter", "fiber", "splitter", "fiber", "onu"],
  );
});

test("lossBudget: rasio kosong dan jalur tanpa OLT ditandai belum lengkap", () => {
  const noRatio = devices.map((d) =>
    d.id === "odc" ? { ...d, splitterRatio: null } : d,
  );
  assert.equal(
    lossBudget(upstreamPath("odp", noRatio, segments)).complete,
    false,
  );
  assert.equal(
    lossBudget(upstreamPath("odp", devices.slice(1), [])).complete,
    false,
  );
});

test("splitterLossDb: rasio tak lazim dibulatkan ke atas", () => {
  assert.equal(splitterLossDb(8), 10.5);
  assert.equal(splitterLossDb(12), splitterLossDb(16));
});

test("couplerLossDb: titik datasheet persis, rasio di antaranya naik/turun teratur", async () => {
  const { couplerLossDb, TAP_RATIOS } =
    await import("../src/services/map/loss-budget.ts");
  assert.deepEqual(couplerLossDb(1), { tap: 21.5, pass: 0.2 });
  assert.deepEqual(couplerLossDb(10), { tap: 11, pass: 0.65 });
  assert.deepEqual(couplerLossDb(20), { tap: 7.6, pass: 1.2 });
  assert.deepEqual(couplerLossDb(50), { tap: 3.4, pass: 3.4 });
  // Makin besar porsi tap: redaman tap turun, redaman lewat naik
  const all = TAP_RATIOS.map((p) => couplerLossDb(p));
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i].tap < all[i - 1].tap, `tap ${TAP_RATIOS[i]}`);
    assert.ok(all[i].pass > all[i - 1].pass, `lewat ${TAP_RATIOS[i]}`);
  }
});

test("lossBudget: ODP berantai dengan splitter rasio 10:90", () => {
  const chain = [
    dev("olt", "server"),
    dev("odp1", "odp", {
      splitterRatio: 8,
      splitterTap: 10,
      parentDeviceId: "olt",
    }),
    dev("odp2", "odp", { splitterRatio: 8, parentDeviceId: "odp1" }),
  ];
  const segs = [seg("olt", "odp1", 1000), seg("odp1", "odp2", 1000)];
  // ODP2 diumpan port lewat 90% (0.65 dB), bukan PLC 1:8 milik ODP1
  const down = lossBudget(upstreamPath("odp2", chain, segs));
  const odp1 = down.steps.find((s) => s.label.startsWith("odp1"));
  assert.equal(odp1.lossDb, 1.25); // 0.65 + konektor/sambungan 0.6
  // Pelanggan ODP1 lewat port tap 10% lalu PLC 1:8
  const here = lossBudget(upstreamPath("odp1", chain, segs));
  assert.equal(here.steps.at(-1).lossDb, 22.1); // 11.0 + 10.5 + 0.6
});

test("lossBudget: ODP di port ODC keluar lewat PLC ODC walau ODC punya splitter rasio", () => {
  const tree = [
    dev("olt", "server"),
    dev("odc", "odc", {
      splitterRatio: 4,
      splitterTap: 20,
      parentDeviceId: "olt",
    }),
    dev("odp", "odp", { splitterRatio: 8, parentDeviceId: "odc", odcPort: 1 }),
  ];
  const b = lossBudget(
    upstreamPath("odp", tree, [
      seg("olt", "odc", 1000),
      seg("odc", "odp", 500),
    ]),
  );
  assert.equal(b.steps.find((s) => s.label.startsWith("odc")).lossDb, 15.5); // 7.6 + 7.3 + 0.6
});

test("capacityUse: ODP hitung pelanggan, ODC hitung ODP di bawahnya", async () => {
  const { capacityUse } = await import("../src/services/map/loss-budget.ts");
  const odc = dev("odc", "odc", { splitterRatio: 2 });
  const odp = dev("odp", "odp", {
    splitterRatio: 8,
    connectedCustomersCount: 8,
    parentDeviceId: "odc",
  });
  const all = [
    odc,
    odp,
    dev("odp2", "odp", { parentDeviceId: "odc", capacity: 4 }),
  ];
  assert.deepEqual(capacityUse(odp, all), { used: 8, total: 8 });
  assert.deepEqual(capacityUse(odc, all), { used: 2, total: 2 });
  assert.equal(capacityUse(dev("x", "odp"), all), null); // port belum diketahui
  assert.equal(capacityUse(dev("olt", "server"), all), null);
});
