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
const { db } = await import("../src/db/index.ts");
const { env } = await import("../src/lib/env.ts");
const { olts, oltPonPorts, oltOnus } =
  await import("../src/db/schema/index.ts");
const { getMockPonPortDetail } =
  await import("../src/lib/dashboard/pon-ports.ts");
const { getOltPonPort, listOnus, getOltOpticalData } =
  await import("../src/services/devices.service.ts");
const { parseListOnusParams } = await import("../src/validators/devices.ts");
const { PgDialect } = await import("drizzle-orm/pg-core");

const OLT_ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-01-01T00:00:00Z");
const dialect = new PgDialect();

let rows = { olts: [], ports: [], onus: [], listed: [] };
let wheres = [];
db.select = (cols) => {
  let table;
  const countQuery = cols && "total" in cols;
  const chain = {
    from(t) {
      table = t;
      return chain;
    },
    leftJoin: () => chain,
    innerJoin: () => chain,
    where(w) {
      if (!countQuery && w) wheres.push(dialect.sqlToQuery(w).sql);
      return chain;
    },
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    then(resolve, reject) {
      let out = [];
      if (countQuery) out = [{ total: rows.listed.length }];
      else if (table === olts) out = rows.olts;
      else if (table === oltPonPorts) out = rows.ports;
      else if (table === oltOnus)
        out =
          cols &&
          "customerName" in cols &&
          "onuIndex" in cols &&
          !("id" in cols)
            ? rows.onus
            : rows.listed;
      return Promise.resolve(out).then(resolve, reject);
    },
  };
  return chain;
};

test.beforeEach(() => {
  env.DASHBOARD_DATA = "demo";
  rows = { olts: [], ports: [], onus: [], listed: [] };
  wheres = [];
});

const onuRow = (onuIndex, status, rx) => ({
  onuIndex,
  status,
  rx,
  tx: 2,
  serialNumber: `HSGQ${onuIndex}`,
  capturedAt: NOW,
  customerName: null,
  pppoeUsername: null,
  address: null,
});

test("getMockPonPortDetail: ONU memuat trouble/isTroubled dan port memuat troubleSummary", () => {
  const d = getMockPonPortDetail("olt-1-pon-1");
  assert.ok(d.onus.length > 0);
  for (const o of d.onus) {
    assert.ok(o.trouble, "trouble");
    assert.equal(o.isTroubled, o.trouble.isTroubled);
    if (o.status === "los") assert.equal(o.trouble.category, "optical_los");
    if (o.status === "offline") assert.equal(o.trouble.category, "power_off");
  }
  assert.equal(d.troubleSummary.total, d.onus.length);
  assert.equal(d.troubledOnuCount, d.onus.filter((o) => o.isTroubled).length);
  assert.equal(d.troubledOnuCount, d.troubleSummary.troubled);
  assert.ok(d.troubledOnuCount > 0);
  // deterministik
  assert.deepEqual(getMockPonPortDetail("olt-1-pon-1"), d);
});

test("getOltPonPort mock mode: trouble lengkap + ringkasan", async () => {
  const p = await getOltPonPort("olt-1", 2);
  assert.equal(p.source, "mock");
  assert.ok(
    p.onus.every((o) => o.trouble && typeof o.isTroubled === "boolean"),
  );
  assert.equal(p.troubledOnuCount, p.troubleSummary.troubled);
  assert.equal(p.weakOnuCount, p.troubleSummary.warningCount);
  assert.equal(p.losOnuCount, p.troubleSummary.losCount);
  assert.ok(p.losOnuCount > 0);
});

test("getOltPonPort DB rows: critical / warning / normal", async () => {
  rows.olts = [{ id: OLT_ID, name: "O-A", host: "10.0.1.1" }];
  rows.ports = [
    {
      ponIndex: 1,
      txPower: 3,
      rxPower: -20,
      onuOnlineCount: 3,
      attenuation: 23,
      capturedAt: NOW,
    },
  ];
  rows.onus = [
    onuRow(1, "online", -20), // normal
    onuRow(2, "online", -26), // warning (lemah)
    onuRow(3, "online", -29), // critical
    onuRow(4, "los", null), // critical LOS
    onuRow(5, "offline", null), // warning power_off
    onuRow(6, "online", null), // normal (tanpa RX)
  ];
  const p = await getOltPonPort(OLT_ID, 1);
  assert.equal(p.source, "db");
  const by = Object.fromEntries(p.onus.map((o) => [o.onuIndex, o]));
  assert.equal(by[1].trouble.severity, "normal");
  assert.equal(by[1].isTroubled, false);
  assert.equal(by[2].trouble.category, "optical_warning");
  assert.equal(by[3].trouble.category, "optical_critical");
  assert.equal(by[3].trouble.severity, "critical");
  assert.equal(by[4].trouble.category, "optical_los");
  assert.equal(by[5].trouble.category, "power_off");
  assert.equal(by[6].isTroubled, false);
  assert.equal(p.troubledOnuCount, 4);
  assert.equal(p.troubleSummary.total, 6);
  assert.equal(p.troubleSummary.healthyCount, 2);
  assert.equal(p.troubleSummary.criticalCount, 2);
  assert.equal(p.weakOnuCount, 2);
  assert.equal(p.losOnuCount, 1);
});

const listedRow = (id, status, rxPower) => ({
  id,
  status,
  rxPower,
  serialNumber: id,
});

test("listOnus: tiap baris memuat trouble & isTroubled", async () => {
  rows.listed = [
    listedRow("a", "online", -20),
    listedRow("b", "online", -28),
    listedRow("c", "offline", null),
  ];
  const { items, total } = await listOnus({});
  assert.equal(total, 3);
  assert.deepEqual(
    items.map((i) => i.isTroubled),
    [false, true, true],
  );
  assert.equal(items[1].trouble.category, "optical_critical");
  assert.equal(items[2].trouble.category, "power_off");
  assert.equal(items[0].trouble.severity, "normal");
});

test("listOnus: filter isTroubled true/false membentuk kondisi SQL; tanpa filter tidak ada", async () => {
  rows.listed = [];
  await listOnus({ isTroubled: true });
  await listOnus({ isTroubled: false });
  await listOnus({});
  assert.equal(wheres.length, 2);
  assert.match(wheres[0], /'los'/);
  assert.match(wheres[0], /"status" = \$\d+/);
  assert.match(wheres[0], /< -25/);
  assert.doesNotMatch(wheres[0], /not \(/);
  assert.match(wheres[1], /not \(/);
  assert.match(wheres[1], /< -25/);
});

test("getOltOpticalData: item memuat trouble & isTroubled", async () => {
  const d = await getOltOpticalData("olt-1");
  assert.ok(d.items.length > 0);
  for (const o of d.items) {
    assert.ok(o.trouble);
    assert.equal(o.isTroubled, o.trouble.isTroubled);
    if (o.status === "los") assert.equal(o.trouble.severity, "critical");
    if (o.rxPowerDbm !== null && o.status === "online" && o.rxPowerDbm >= -25)
      assert.equal(o.isTroubled, false);
  }
});

test("parseListOnusParams: isTroubled dan alias troubled", () => {
  assert.equal(
    parseListOnusParams(new URLSearchParams("isTroubled=true")).isTroubled,
    true,
  );
  assert.equal(
    parseListOnusParams(new URLSearchParams("isTroubled=false")).isTroubled,
    false,
  );
  assert.equal(
    parseListOnusParams(new URLSearchParams("troubled=true")).isTroubled,
    true,
  );
  assert.equal(
    parseListOnusParams(new URLSearchParams("troubled=false")).isTroubled,
    false,
  );
  assert.equal(
    parseListOnusParams(new URLSearchParams("isTroubled=false&troubled=true"))
      .isTroubled,
    false,
  );
  assert.equal(
    parseListOnusParams(new URLSearchParams("isTroubled=x")).isTroubled,
    undefined,
  );
  assert.equal(
    parseListOnusParams(new URLSearchParams("")).isTroubled,
    undefined,
  );
  assert.equal(parseListOnusParams({ troubled: true }).isTroubled, true);
  assert.equal(parseListOnusParams({ isTroubled: false }).isTroubled, false);
});
