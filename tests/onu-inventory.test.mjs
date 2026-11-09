import test from "node:test";
import assert from "node:assert/strict";
import {
  BULK_MAX,
  EMPTY_INVENTORY_FILTER,
  brandOptions,
  bulkEligibility,
  filterInventory,
  genieacsCounts,
  matchOnusToCpe,
  modelOptions,
  parseOnuModel,
  summarizeInventory,
} from "../src/lib/dashboard/onu-inventory.ts";

let n = 0;
function onu(over = {}) {
  n++;
  return {
    id: `onu-${n}`,
    serialNumber: `D0:5F:AF:D3:C7:${(0x10 + n).toString(16).toUpperCase()}`,
    oltId: "olt-1",
    oltName: "OLT 1",
    ponPort: `1/${n}`,
    ponIndex: 1,
    onuIndex: n,
    model: "CDTC 15CR",
    customerId: null,
    customerName: "Belum dipasangkan",
    pppoeUsername: "-",
    rxPowerDbm: -20,
    txPowerDbm: 2,
    distanceMeters: null,
    status: "online",
    lastSeenAt: 1_760_000_000,
    ...over,
  };
}
const F = (over = {}) => ({ ...EMPTY_INVENTORY_FILTER, ...over });

test("parseOnuModel: kode vendor + tipe, nama merek hanya untuk kode yang pasti", () => {
  assert.deepEqual(
    { ...parseOnuModel("CDTC 15CR") },
    {
      brandKey: "CDTC",
      brandLabel: "C-Data (CDTC)",
      modelKey: "15CR",
      modelLabel: "15CR",
    },
  );
  assert.equal(parseOnuModel("HWTC HG8145").brandLabel, "Huawei (HWTC)");
  assert.equal(
    parseOnuModel("ZICG GM30").brandLabel,
    "ZICG",
    "kode yang belum pasti artinya tidak diberi nama karangan",
  );
  assert.equal(parseOnuModel("MTKc 245H").brandKey, "MTKC");
  assert.equal(
    parseOnuModel("Huawei HG8245H5").brandLabel,
    "Huawei",
    "tidak dobel: 'Huawei (Huawei)'",
  );
  assert.equal(parseOnuModel("ZTE F609 v3").modelLabel, "F609 v3");
  assert.equal(parseOnuModel("  cdtc   15cr ").brandKey, "CDTC");
});

test("parseOnuModel: kosong, tanda minus, dan tanpa tipe", () => {
  for (const m of ["", "  ", "-", null, undefined]) {
    const id = parseOnuModel(m);
    assert.equal(id.brandKey, "?");
    assert.equal(id.brandLabel, "Tidak diketahui");
  }
  const bare = parseOnuModel("HSGQ");
  assert.equal(bare.brandKey, "HSGQ");
  assert.equal(bare.modelLabel, "Tanpa tipe");
});

test("filter merek dan model, dan model hanya berlaku bersama mereknya", () => {
  const a = onu({ model: "CDTC 15CR" });
  const b = onu({ model: "CDTC FD511GW" });
  const c = onu({ model: "HWTC HG8145" });
  const d = onu({ model: "" });
  const all = [a, b, c, d];
  assert.deepEqual(
    filterInventory(all, F({ brand: "CDTC" }), null).map((o) => o.id),
    [a.id, b.id],
  );
  assert.deepEqual(
    filterInventory(all, F({ brand: "CDTC", model: "15CR" }), null).map(
      (o) => o.id,
    ),
    [a.id],
  );
  assert.deepEqual(
    filterInventory(all, F({ brand: "?" }), null).map((o) => o.id),
    [d.id],
  );
  assert.deepEqual(
    filterInventory(all, F({ brand: "HWTC", model: "15CR" }), null),
    [],
    "model 15CR bukan milik HWTC",
  );
});

test("opsi merek dan model memuat jumlah yang tepat, terbanyak dulu, tidak diketahui terakhir", () => {
  const all = [
    onu(),
    onu(),
    onu({ model: "CDTC FD511GW" }),
    onu({ model: "HWTC HG8145" }),
    onu({ model: "" }),
  ];
  const brands = brandOptions(all, F(), null);
  assert.deepEqual(
    brands.map((b) => [b.key, b.count]),
    [
      ["CDTC", 3],
      ["HWTC", 1],
      ["?", 1],
    ],
  );
  const models = modelOptions(all, F({ brand: "CDTC" }), null);
  assert.deepEqual(
    models.map((m) => [m.key, m.label, m.count]),
    [
      ["15CR", "15CR", 2],
      ["FD511GW", "FD511GW", 1],
    ],
  );
  const allModels = modelOptions(all, F(), null);
  assert.ok(
    allModels.some((m) => m.label === "C-Data 15CR"),
    "tanpa merek terpilih, model diberi awalan mereknya",
  );
});

test("jumlah facet = hasil nyata bila opsi itu dipilih (dimensi lain tetap)", () => {
  const mix = [
    onu({ model: "CDTC 15CR", status: "online" }),
    onu({ model: "CDTC 15CR", status: "offline" }),
    onu({ model: "HWTC HG8145", status: "online" }),
    onu({ model: "HWTC HG8145", status: "los" }),
    onu({ model: "ZICG GM22", status: "online", oltId: "olt-2" }),
  ];
  for (const f of [
    F(),
    F({ status: "online" }),
    F({ oltId: "olt-1" }),
    F({ query: "hg8145" }),
    F({ status: "online", brand: "HWTC" }),
  ]) {
    for (const b of brandOptions(mix, f, null)) {
      assert.equal(
        b.count,
        filterInventory(mix, { ...f, brand: b.key, model: "all" }, null).length,
        `${JSON.stringify(f)} / ${b.key}`,
      );
    }
  }
});

test("pencarian mencakup model dan nama merek", () => {
  const all = [onu({ model: "HWTC HG8145" }), onu({ model: "CDTC 15CR" })];
  assert.equal(filterInventory(all, F({ query: "huawei" }), null).length, 1);
  assert.equal(filterInventory(all, F({ query: "hg8145" }), null).length, 1);
  assert.equal(filterInventory(all, F({ query: "c-data" }), null).length, 1);
});

const dev = (over) => ({
  deviceId: "d",
  pppoeUsername: "",
  macAddress: "",
  isOnline: true,
  ...over,
});

test("pencocokan: PPPoE dulu (tanpa beda huruf), lalu MAC unik; satu modem satu ONU", () => {
  const a = onu({
    pppoeUsername: "17060001824@runsnet.id",
    serialNumber: "D0:5F:AF:D3:C7:1D",
  });
  const b = onu({ serialNumber: "D0:5F:AF:D3:7C:1D" });
  const c = onu({ serialNumber: "D0:5F:AF:D3:AA:00" });
  const m = matchOnusToCpe(
    [a, b, c],
    [
      dev({
        deviceId: "d1",
        pppoeUsername: "17060001824@RUNSNET.ID",
        macAddress: "d0:5f:af:d3:c7:1e",
      }),
      dev({ deviceId: "d2", macAddress: "d0:5f:af:d3:7c:1e" }),
    ],
  );
  assert.deepEqual(
    { ...m.get(a.id) },
    { deviceId: "d1", via: "pppoe", isOnline: true },
  );
  assert.equal(m.get(b.id).via, "mac");
  assert.equal(m.get(b.id).deviceId, "d2");
  assert.equal(m.has(c.id), false);
});

test("pencocokan MAC tidak menebak: terlalu jauh, MAC lebih kecil, kandidat ganda, modem rebutan", () => {
  const o1 = onu({ serialNumber: "D0:5F:AF:D3:C7:1D" });
  assert.equal(
    matchOnusToCpe(
      [o1],
      [dev({ deviceId: "x", macAddress: "d0:5f:af:d3:c7:22" })],
    ).size,
    0,
    "selisih 5 > 3",
  );
  assert.equal(
    matchOnusToCpe(
      [o1],
      [dev({ deviceId: "x", macAddress: "d0:5f:af:d3:c7:1c" })],
    ).size,
    0,
    "MAC modem lebih kecil",
  );
  assert.equal(
    matchOnusToCpe(
      [o1],
      [dev({ deviceId: "x", macAddress: "d0:5f:af:d4:c7:1e" })],
    ).size,
    0,
    "oktet ke-4 beda",
  );
  const two = [
    dev({ deviceId: "x", macAddress: "d0:5f:af:d3:c7:1e" }),
    dev({ deviceId: "y", macAddress: "d0:5f:af:d3:c7:1f" }),
  ];
  assert.equal(
    matchOnusToCpe([o1], two).size,
    0,
    "dua kandidat: tidak ditebak",
  );
  const o2 = onu({ serialNumber: "D0:5F:AF:D3:C7:1C" });
  assert.equal(
    matchOnusToCpe(
      [o1, o2],
      [dev({ deviceId: "x", macAddress: "d0:5f:af:d3:c7:1e" })],
    ).size,
    0,
    "dua ONU berebut satu modem: keduanya dilewati",
  );
  assert.equal(
    matchOnusToCpe([o1], [dev({ deviceId: "x", macAddress: "bukan-mac" })])
      .size,
    0,
  );
});

test("pencocokan: PPPoE ganda pada dua modem tidak dipakai, serial bukan MAC aman", () => {
  const a = onu({ pppoeUsername: "u1", serialNumber: "ZTEGC1234567" });
  const dups = [
    dev({ deviceId: "p", pppoeUsername: "u1" }),
    dev({ deviceId: "q", pppoeUsername: "U1" }),
  ];
  assert.equal(matchOnusToCpe([a], dups).size, 0);
  assert.equal(
    matchOnusToCpe(
      [onu({ serialNumber: "ZTEGC1234567" })],
      [dev({ macAddress: "d0:5f:af:d3:c7:1e" })],
    ).size,
    0,
  );
});

test("filter GenieACS dan jumlahnya", () => {
  const a = onu(),
    b = onu(),
    c = onu();
  const reg = new Map([
    [a.id, { deviceId: "d", via: "pppoe", isOnline: true }],
  ]);
  assert.deepEqual(
    filterInventory([a, b, c], F({ genieacs: "registered" }), reg).map(
      (o) => o.id,
    ),
    [a.id],
  );
  assert.deepEqual(
    filterInventory([a, b, c], F({ genieacs: "unregistered" }), reg).map(
      (o) => o.id,
    ),
    [b.id, c.id],
  );
  assert.deepEqual(
    { ...genieacsCounts([a, b, c], F(), reg) },
    { all: 3, registered: 1, unregistered: 2 },
  );
  assert.equal(
    filterInventory([a, b, c], F({ genieacs: "registered" }), null).length,
    3,
    "tanpa data GenieACS filter tidak menyembunyikan apa pun",
  );
});

test("ringkasan: status, sinyal lemah dan terdaftar", () => {
  const a = onu({ status: "online", rxPowerDbm: -28 });
  const b = onu({ status: "offline", rxPowerDbm: null });
  const c = onu({ status: "los", rxPowerDbm: -40 });
  const s = summarizeInventory(
    [a, b, c],
    new Map([[a.id, { deviceId: "d", via: "mac", isOnline: true }]]),
  );
  assert.deepEqual(
    { ...s },
    {
      total: 3,
      online: 1,
      offline: 1,
      los: 1,
      weak: 2,
      registered: 1,
      unregistered: 2,
    },
  );
  assert.equal(summarizeInventory([a], null).registered, null);
});

test("kelayakan massal: sudah terdaftar, merek, status online, dan nomor PON/ONU", () => {
  const reg = new Map();
  const cdtc = onu({ model: "CDTC 15CR" });
  assert.equal(bulkEligibility(cdtc, "web", reg).ok, true);
  assert.equal(
    bulkEligibility(onu({ model: "HWTC HG8145" }), "web", reg).ok,
    false,
  );
  assert.match(
    bulkEligibility(onu({ model: "HWTC HG8145" }), "web", reg).reason,
    /C-Data/,
  );
  assert.match(
    bulkEligibility(onu({ status: "offline" }), "web", reg).reason,
    /online/,
  );
  assert.equal(
    bulkEligibility(onu({ model: "HWTC HG8145" }), "olt", reg).ok,
    true,
    "metode OLT tidak bergantung merek",
  );
  assert.equal(bulkEligibility(onu({ ponIndex: null }), "olt", reg).ok, false);
  reg.set(cdtc.id, { deviceId: "d", via: "pppoe", isOnline: true });
  assert.match(bulkEligibility(cdtc, "web", reg).reason, /Sudah terdaftar/);
  assert.equal(BULK_MAX, 30);
});

test("HWTC H113 adalah ZIMLINK ZL-2113X, bukan Huawei; HWTC lain tetap Huawei", () => {
  const z = parseOnuModel("HWTC H113");
  assert.deepEqual(
    { ...z },
    {
      brandKey: "ZIMLINK",
      brandLabel: "ZIMLINK (HWTC)",
      modelKey: "H113",
      modelLabel: "H113 (ZL-2113X)",
    },
  );
  assert.equal(parseOnuModel(" hwtc  h113 ").brandKey, "ZIMLINK");
  assert.equal(parseOnuModel("HWTC HG8145").brandKey, "HWTC");
  assert.equal(
    parseOnuModel("HWTC H1130").brandKey,
    "HWTC",
    "alias hanya untuk model yang persis",
  );
});

test("filter merek ZIMLINK memisahkan H113 dari Huawei lain, dan pencarian 'zimlink' menemukannya", () => {
  const z = onu({ model: "HWTC H113" });
  const h = onu({ model: "HWTC HG8145" });
  const c = onu({ model: "CDTC 15CR" });
  assert.deepEqual(
    filterInventory([z, h, c], F({ brand: "ZIMLINK" }), null).map((o) => o.id),
    [z.id],
  );
  assert.deepEqual(
    filterInventory([z, h, c], F({ brand: "HWTC" }), null).map((o) => o.id),
    [h.id],
  );
  assert.deepEqual(
    filterInventory([z, h, c], F({ query: "zimlink" }), null).map((o) => o.id),
    [z.id],
  );
  assert.deepEqual(
    filterInventory([z, h, c], F({ query: "zl-2113x" }), null).map((o) => o.id),
    [z.id].filter(() => false),
    "teks model OLT dicari, bukan nama internal",
  );
  const brands = brandOptions([z, h, c], F(), null).map((b) => [
    b.key,
    b.label,
  ]);
  assert.ok(
    brands.some(([k, l]) => k === "ZIMLINK" && l === "ZIMLINK (HWTC)"),
    JSON.stringify(brands),
  );
});

test("kelayakan massal: ZIMLINK bisa lewat metode web bila online; merek lain tetap ditolak", () => {
  const reg = new Map();
  assert.equal(
    bulkEligibility(onu({ model: "HWTC H113" }), "web", reg).ok,
    true,
  );
  assert.match(
    bulkEligibility(onu({ model: "HWTC H113", status: "offline" }), "web", reg)
      .reason,
    /online/,
  );
  assert.match(
    bulkEligibility(onu({ model: "ZICG GM22", status: "offline" }), "web", reg)
      .reason,
    /online/,
  );
  assert.match(
    bulkEligibility(onu({ model: "ZICG GM30" }), "web", reg).reason,
    /GGCLink/,
    "model ZICG lain belum dipetakan",
  );
  assert.equal(
    bulkEligibility(onu({ model: "HWTC HG8145" }), "web", reg).ok,
    false,
    "Huawei sungguhan belum didukung",
  );
});

test("ZICG GM22 adalah GGCLink GM220-S XPON dan bisa lewat metode web bila online", () => {
  const g = parseOnuModel("ZICG GM22");
  assert.deepEqual(
    { ...g },
    {
      brandKey: "GGCLINK",
      brandLabel: "GGCLink (ZICG)",
      modelKey: "GM22",
      modelLabel: "GM22 (GM220-S XPON)",
    },
  );
  assert.equal(parseOnuModel(" zicg  gm22 ").brandKey, "GGCLINK");
  assert.equal(
    parseOnuModel("ZICG GM220").brandKey,
    "ZICG",
    "alias hanya untuk model yang persis",
  );
  const reg = new Map();
  assert.equal(
    bulkEligibility(onu({ model: "ZICG GM22" }), "web", reg).ok,
    true,
  );
  const g1 = onu({ model: "ZICG GM22" });
  const z = onu({ model: "HWTC H113" });
  assert.deepEqual(
    filterInventory([g1, z], F({ brand: "GGCLINK" }), null).map((o) => o.id),
    [g1.id],
  );
  assert.deepEqual(
    filterInventory([g1, z], F({ query: "ggclink" }), null).map((o) => o.id),
    [g1.id],
  );
});

test("MTKc F609 adalah ZTE F609 dan bisa lewat metode web bila online; MTKc lain belum", () => {
  const f = parseOnuModel("MTKc F609");
  assert.deepEqual(
    { ...f },
    {
      brandKey: "F609",
      brandLabel: "ZTE F609 (MTKc)",
      modelKey: "F609",
      modelLabel: "F609",
    },
  );
  assert.equal(parseOnuModel(" mtkc  f609 ").brandKey, "F609");
  assert.equal(
    parseOnuModel("MTKc 245H").brandKey,
    "MTKC",
    "model MTKc lain tidak ikut",
  );
  const reg = new Map();
  assert.equal(
    bulkEligibility(onu({ model: "MTKc F609" }), "web", reg).ok,
    true,
  );
  assert.match(
    bulkEligibility(onu({ model: "MTKc F609", status: "offline" }), "web", reg)
      .reason,
    /online/,
  );
  assert.equal(
    bulkEligibility(onu({ model: "MTKc 245H" }), "web", reg).ok,
    false,
    "245H belum dipetakan",
  );
  assert.match(
    bulkEligibility(onu({ model: "MTKc 245H" }), "web", reg).reason,
    /F609/,
  );
  const a = onu({ model: "MTKc F609" });
  const b = onu({ model: "MTKc 245H" });
  assert.deepEqual(
    filterInventory([a, b], F({ brand: "F609" }), null).map((o) => o.id),
    [a.id],
  );
});
