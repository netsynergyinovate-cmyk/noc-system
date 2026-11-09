import test from "node:test";
import assert from "node:assert/strict";
import { mapCentralData } from "../src/services/map/central-mapper.ts";

const infra = (id, type, extra = {}) => ({
  id,
  name: id.toUpperCase(),
  type,
  status: "active",
  latitude: -2.52,
  longitude: 101.24,
  parentId: null,
  capacity: 16,
  description: null,
  ...extra,
});
const customer = (id, extra = {}) => ({
  id,
  name: `Pelanggan ${id}`,
  pppoeUsername: `pppoe-${id}`,
  address: null,
  latitude: -2.521,
  longitude: 101.241,
  odpName: null,
  billingStatus: "lunas",
  opticalPower: null,
  isOnline: true,
  ...extra,
});

test("mapCentralData: jenis & status perangkat, status pelanggan, tautan ODP via nama", () => {
  const { devices, customers } = mapCentralData(
    {
      customers: [
        customer("a", { odpName: "  odp-1 " }),
        customer("b", { billingStatus: "isolir" }),
        customer("c", { isOnline: false, odpName: "tidak-ada" }),
      ],
      infrastructure: [
        infra("olt-1", "olt"),
        infra("odp-1", "odp", { status: "maintenance", parentId: "olt-1" }),
        infra("x", "unknown-type"),
      ],
      cables: [],
    },
    50,
  );
  assert.deepEqual(
    devices.map((d) => [d.id, d.type, d.status]),
    [
      ["olt-1", "server", "normal"],
      ["odp-1", "odp", "warning"],
    ],
  );
  assert.deepEqual(
    customers.map((c) => [c.customerNumber, c.status, c.odpId]),
    [
      ["pppoe-a", "terhubung", "odp-1"],
      ["pppoe-b", "isolir", null],
      ["pppoe-c", "offline", null],
    ],
  );
  assert.equal(devices[1].connectedCustomersCount, 1);
});

test("mapCentralData: kabel jadi jalur + segmen, panjang dari geometri, polyline rusak dilewati", () => {
  const { routes, segments } = mapCentralData(
    {
      customers: [customer("a")],
      infrastructure: [infra("olt-1", "olt"), infra("odp-1", "odp")],
      cables: [
        {
          id: "k1",
          name: "FEEDER-1",
          sourceId: "olt-1",
          targetId: "odp-1",
          targetType: "infrastructure",
          cableType: "feeder",
          coreCapacity: 12,
          polyline: [
            [-2.52, 101.24],
            [-2.52, 101.241],
            ["rusak", 1],
          ],
        },
        {
          id: "k2",
          name: "DROP-A",
          sourceId: "odp-1",
          targetId: "a",
          targetType: "customer",
          cableType: "drop",
          coreCapacity: 1,
          polyline: [[-2.52, 101.24]],
        },
      ],
    },
    50,
  );
  assert.equal(routes.length, 1, "polyline < 2 titik valid dilewati");
  assert.equal(routes[0].toDeviceId, "odp-1");
  assert.ok(routes[0].totalLengthM > 100 && routes[0].totalLengthM < 125);
  assert.equal(segments[0].lengthM, routes[0].totalLengthM);
  assert.equal(segments[0].snapped, false);
  assert.ok(segments[0].samples.length >= 2);
});

test("mapCentralData: paket via awalan PPPoE, ONU per pelanggan, port PON lewat host OLT", () => {
  const { customers, devices } = mapCentralData(
    {
      customers: [
        customer("a", { pppoeUsername: "1706@runsnet.id", opticalPower: null }),
        customer("b"),
      ],
      infrastructure: [
        infra("olt-titik", "olt", { host: " 10.0.0.1:2323 " }),
        infra("olt-lain", "olt", { host: null }),
      ],
      cables: [],
      onus: [
        {
          oltId: "o1",
          ponIndex: 5,
          onuIndex: 12,
          serialNumber: "HWTC01",
          customerId: "a",
          rxPower: -19.5,
          status: "online",
        },
      ],
      olts: [{ id: "o1", name: "HSGQ CORE", host: "10.0.0.1:2323" }],
      ponPorts: [
        { oltId: "o1", ponIndex: 2, rxPower: null, onuOnlineCount: 4 },
        { oltId: "o1", ponIndex: 1, rxPower: -21, onuOnlineCount: null },
      ],
      billingCustomers: [{ custId: 1706, serviceProfile: "NET 10 Mbps" }],
    },
    50,
  );
  const [a, b] = customers;
  assert.equal(a.packagePlan, "NET 10 Mbps");
  assert.equal(a.onuSerial, "HWTC01");
  assert.equal(a.opticalPower, -19.5, "rx ONU dipakai bila pelanggan kosong");
  assert.equal(a.onuLocation, "HSGQ CORE • PON 5 / ONU 12");
  assert.equal(b.packagePlan, null);
  assert.equal(b.onuStatus, undefined);
  assert.deepEqual(devices[0].ponPorts, [
    { ponIndex: 1, onuOnline: 0, rxPower: -21 },
    { ponIndex: 2, onuOnline: 4, rxPower: null },
  ]);
  assert.equal(devices[1].ponPorts, undefined, "tanpa host tidak ditebak");
  assert.deepEqual(devices[0].centralOlt, { id: "o1", name: "HSGQ CORE" });
});

test("mapCentralData: titik OLT tanpa host bisa ditautkan manual", () => {
  const { devices } = mapCentralData(
    {
      customers: [],
      infrastructure: [
        infra("olt-lain", "olt", { host: null }),
        infra("olt-x", "olt", { host: null }),
      ],
      cables: [],
      olts: [{ id: "o1", name: "HSGQ CORE", host: "10.0.0.1:2323" }],
      ponPorts: [{ oltId: "o1", ponIndex: 1, rxPower: -20, onuOnlineCount: 3 }],
    },
    50,
    new Map([["olt-lain", "o1"]]),
  );
  assert.deepEqual(devices[0].centralOlt, { id: "o1", name: "HSGQ CORE" });
  assert.equal(devices[0].ponPorts.length, 1);
  assert.equal(
    devices[1].centralOlt,
    undefined,
    "yang tidak ditautkan tetap kosong",
  );
});

test("mergeMapData: koreksi lokal diterapkan, perangkat tersembunyi hilang, data lokal ikut", async () => {
  const { mergeMapData } =
    await import("../src/services/map/central-mapper.ts");
  const dev = (id, extra = {}) => ({
    id,
    name: id,
    type: "odp",
    latitude: 1,
    longitude: 1,
    capacity: 0,
    status: "normal",
    parentDeviceId: "olt",
    notes: "pusat",
    ...extra,
  });
  const cust = (id, extra = {}) => ({
    id,
    name: id,
    customerNumber: id,
    address: "",
    region: "",
    status: "terhubung",
    billingStatus: "lunas",
    latitude: null,
    longitude: null,
    odpId: null,
    ...extra,
  });
  const ov = (entityType, entityId, extra) => ({
    entityType,
    entityId,
    latitude: null,
    longitude: null,
    parentDeviceId: null,
    parentCleared: false,
    notes: null,
    hidden: false,
    ...extra,
  });
  const merged = mergeMapData(
    {
      customers: [cust("c1"), cust("c2", { latitude: 5, longitude: 5 })],
      devices: [dev("odp-a"), dev("odp-b"), dev("odp-c")],
      routes: [],
      segments: [],
    },
    {
      customers: [cust("lokal-1", { odpId: "odp-a", status: "isolir" })],
      devices: [dev("lokal-odp", { parentDeviceId: "odp-a", notes: null })],
      routes: [],
      segments: [
        {
          id: "s",
          routeId: "r",
          customerId: "lokal-1",
          connectionStatus: "unknown",
        },
      ],
    },
    [
      ov("customer", "c1", {
        latitude: -2.5,
        longitude: 101.2,
        parentDeviceId: "odp-b",
        odpPort: 3,
      }),
      ov("device", "odp-a", { parentCleared: true, notes: "koreksi" }),
      ov("device", "odp-b", { parentDeviceId: "odp-c", deviceType: "odc" }),
      ov("device", "odp-c", { hidden: true }),
    ],
  );
  // Koreksi jenis ODP -> ODC dipakai; jenis lain dari pusat tetap
  assert.equal(merged.devices.find((d) => d.id === "odp-b").type, "odc");
  assert.equal(merged.devices.find((d) => d.id === "odp-a").type, "odp");
  const c1 = merged.customers.find((c) => c.id === "c1");
  assert.deepEqual(
    [c1.latitude, c1.longitude, c1.odpId, c1.odpPort],
    [-2.5, 101.2, "odp-b", 3],
  );
  const c2 = merged.customers.find((c) => c.id === "c2");
  assert.deepEqual([c2.latitude, c2.odpId, c2.odpPort], [5, null, null]);
  assert.equal(merged.devices[1].connectedCustomersCount, 1);
  assert.deepEqual(
    merged.devices.map((d) => [d.id, d.parentDeviceId, d.notes]),
    [
      ["odp-a", null, "koreksi"],
      ["odp-b", "odp-c", "pusat"],
      ["lokal-odp", "odp-a", null],
    ],
  );
  assert.equal(merged.devices[0].connectedCustomersCount, 1);
  assert.equal(merged.segments[0].connectionStatus, "isolir");
});
