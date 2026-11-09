import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHierarchyTree,
  chainEndDeviceId,
  createsCycle,
  renameForType,
  routeChainDeviceIds,
  routePon,
  oltPonCount,
} from "../src/services/map/topology.ts";

const devices = [
  { id: "olt", parentDeviceId: null },
  { id: "odc", parentDeviceId: "olt" },
  { id: "odp", parentDeviceId: "odc" },
];

test("createsCycle: induk ke diri sendiri atau keturunan ditolak", () => {
  assert.equal(createsCycle(devices, "odc", "odc"), true);
  assert.equal(createsCycle(devices, "olt", "odp"), true);
});

test("createsCycle: induk sah dan lepas induk diterima", () => {
  assert.equal(createsCycle(devices, "odp", "olt"), false);
  assert.equal(createsCycle(devices, "odp", null), false);
});

test("chainEndDeviceId: jalur kosong mulai dari asal jalur", () => {
  assert.equal(chainEndDeviceId("olt", []), "olt");
});

test("chainEndDeviceId: lanjut dari perangkat terakhir, abaikan drop pelanggan", () => {
  const segments = [
    { sequence: 1, toDeviceId: "odc" },
    { sequence: 3, toDeviceId: null }, // drop ke pelanggan
    { sequence: 2, toDeviceId: "odp" },
  ];
  assert.equal(chainEndDeviceId("olt", segments), "odp");
});

test("routeChainDeviceIds: urut sequence, drop pelanggan & duplikat dilewati", () => {
  const segments = [
    { sequence: 2, toDeviceId: "odp1" },
    { sequence: 1, toDeviceId: "odc" },
    { sequence: 3, toDeviceId: null },
    { sequence: 4, toDeviceId: "odp1" },
    { sequence: 5, toDeviceId: "odp2" },
  ];
  assert.deepEqual(routeChainDeviceIds("olt", segments), [
    "olt",
    "odc",
    "odp1",
    "odp2",
  ]);
  assert.deepEqual(routeChainDeviceIds("olt", []), ["olt"]);
});

test("buildHierarchyTree: server → ODC → ODP → pelanggan, siklus lama tidak menghilangkan node", () => {
  const dev = (id, type, parentDeviceId) => ({
    id,
    type,
    parentDeviceId,
    name: id,
    latitude: 0,
    longitude: 0,
    status: "normal",
  });
  const tree = buildHierarchyTree(
    [
      dev("olt", "server", null),
      dev("odc", "odc", "olt"),
      dev("odp", "odp", "odc"),
      dev("a", "pole", "b"),
      dev("b", "pole", "a"),
    ],
    [
      {
        id: "c1",
        name: "Budi",
        customerNumber: "P-1",
        latitude: 0,
        longitude: 0,
        status: "terhubung",
        odpId: "odp",
      },
    ],
  );
  assert.deepEqual(
    tree.map((n) => n.id),
    ["olt", "a", "b"],
  );
  assert.equal(tree[0].children[0].children[0].children[0].id, "c1");
});

test("routePon: PON dibaca dari kode jalur, format lama dan baru", () => {
  assert.equal(routePon("JLR-OLT-HSGQ-8-PON-PON3"), 3);
  assert.equal(routePon("JLR-OLT-HSGQ-8-PON-PON1-01"), 1);
  assert.equal(routePon("A1"), null);
});

test("oltPonCount: port pusat, lalu angka di nama, lalu kapasitas", () => {
  assert.equal(oltPonCount({ name: "x", capacity: 4, ponPorts: [1, 2] }), 2);
  assert.equal(oltPonCount({ name: "OLT HSGQ 8 PON", capacity: 0 }), 8);
  assert.equal(oltPonCount({ name: "OLT", capacity: 4 }), 4);
  assert.equal(oltPonCount({ name: "OLT", capacity: 0 }), 16);
});

test("renameForType: awalan ODP/ODC ikut jenis, nama lain tetap", () => {
  assert.equal(
    renameForType("ODP 1 Mekar Jaya (2) PON 4", "odc"),
    "ODC 1 Mekar Jaya (2) PON 4",
  );
  assert.equal(renameForType("ODC-07 Pasar", "odp"), "ODP-07 Pasar");
  assert.equal(renameForType("odp3 gang", "odc"), "odc3 gang");
  assert.equal(renameForType("Box Mekar Jaya", "odc"), "Box Mekar Jaya");
  assert.equal(renameForType("ODPLUS 1", "odc"), "ODPLUS 1");
});
