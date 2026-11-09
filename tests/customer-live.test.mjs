import test from "node:test";
import assert from "node:assert/strict";

const { combineCustomerLive, formatAgo } =
  await import("../src/lib/dashboard/customer-live.ts");

const cpe = (over = {}) => ({
  pppoeUsername: "17060001092@runsnet.id",
  wanIp: "172.16.15.210",
  uptimeText: "2 hari 3 jam",
  lastInformAt: 1_700_000_000,
  isOnline: true,
  wifi: { ssid: "RUMAH", clientCount: 4 },
  optical: { rxDbm: -19.5 },
  ...over,
});
const customers = [{ id: "c1", pppoeUsername: "17060001092@runsnet.id" }];
const onu = { customerId: "c1", rxPower: -22.1, status: "online" };

test("modem GenieACS online: redaman, IP, uptime, Wi-Fi, dan perangkat dari modem", () => {
  const r = combineCustomerLive(customers, [onu], [], [cpe()]).c1;
  assert.deepEqual(r, {
    ip: "172.16.15.210",
    uptime: "2 hari 3 jam",
    ssid: "RUMAH",
    clients: 4,
    rxDbm: -19.5,
    rxSource: "genieacs",
    onuLos: false,
    modemOnline: true,
    informAt: 1_700_000_000,
    staleNote: null,
  });
});

test("belum terdaftar di GenieACS: redaman dari OLT, IP dari billing, sisanya kosong", () => {
  const r = combineCustomerLive(
    customers,
    [onu],
    [{ custId: "17060001092", ipAddress: "172.16.15.99" }],
    [],
  ).c1;
  assert.deepEqual(r, {
    ip: "172.16.15.99",
    uptime: null,
    ssid: null,
    clients: null,
    rxDbm: -22.1,
    rxSource: "olt",
    onuLos: false,
    modemOnline: false,
    informAt: null,
    staleNote: null,
  });
});

test("modem offline: redaman jatuh ke OLT, uptime dan perangkat tetap bacaan terakhir bertanda waktu inform", () => {
  const r = combineCustomerLive(
    customers,
    [onu],
    [],
    [cpe({ isOnline: false })],
    1_700_000_000 + 7 * 3600 + 120,
  ).c1;
  assert.equal(r.rxSource, "olt");
  assert.equal(r.rxDbm, -22.1);
  assert.equal(r.uptime, "2 hari 3 jam");
  assert.equal(r.clients, 4);
  assert.equal(r.modemOnline, false);
  assert.equal(r.informAt, 1_700_000_000);
  assert.equal(r.staleNote, "per 7 jam lalu");
});

test("ONU LOS: tidak ada redaman, ditandai LOS; tanpa ONU dan modem: semuanya kosong, bukan LOS", () => {
  assert.deepEqual(
    combineCustomerLive(
      customers,
      [{ customerId: "c1", rxPower: null, status: "los" }],
      [],
      null,
    ).c1,
    {
      ip: null,
      uptime: null,
      ssid: null,
      clients: null,
      rxDbm: null,
      rxSource: null,
      onuLos: true,
      modemOnline: false,
      informAt: null,
      staleNote: null,
    },
  );
  assert.equal(combineCustomerLive(customers, [], [], null).c1.onuLos, false);
});

test("username dicocokkan tanpa peduli huruf besar/kecil dan spasi", () => {
  const r = combineCustomerLive(
    [{ id: "c1", pppoeUsername: " Budi01@NOC " }],
    [],
    [],
    [cpe({ pppoeUsername: "budi01@noc" })],
  ).c1;
  assert.equal(r.ssid, "RUMAH");
});

test("formatAgo: satuan menit, jam, hari", () => {
  assert.equal(formatAgo(30), "baru saja");
  assert.equal(formatAgo(300), "5 mnt lalu");
  assert.equal(formatAgo(26 * 3600), "1 hari lalu");
});
