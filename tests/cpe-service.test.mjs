import test from "node:test";
import assert from "node:assert/strict";
import { listCpeDevices, getCpeDevice } from "../src/services/cpe-devices.service.ts";
import { GenieAcsClient } from "../src/lib/genieacs/client.ts";

const client = new GenieAcsClient({ url: "http://sim.local:7557", timeoutMs: 1000, mode: "simulator" });
const all = [
  { id: "cpe-1", deviceId: "DEV-1", customerName: "Budi", serialNumber: "SN1", isOnline: true, hosts: [{ hostname: "Host-1" }] },
  { id: "cpe-2", deviceId: "DEV-2", customerName: "Siti", serialNumber: "SN2", isOnline: false, hosts: [] },
  { id: "cpe-3", deviceId: "DEV-3", customerName: "Agus", serialNumber: "SN3", isOnline: true, hosts: [] },
  { id: "cpe-4", deviceId: "DEV-4", customerName: "Dewi", serialNumber: "SN4", isOnline: false, hosts: [] },
];
client.listDevices = async () => all;
client.getDevice = async (id) => all.find((d) => d.deviceId === id || d.id === id) ?? null;

test("listCpeDevices: default pagination", async () => {
  const r = await listCpeDevices({ client });
  assert.equal(r.page, 1);
  assert.equal(r.limit, 20);
  assert.equal(r.total, all.length);
  assert.equal(r.data.length, all.length);
});

test("listCpeDevices: search nama pelanggan dan serial, case-insensitive", async () => {
  const byName = await listCpeDevices({ client, search: all[0].customerName.toUpperCase() });
  assert.ok(byName.total >= 1);
  assert.ok(byName.data.some((d) => d.id === all[0].id));
  const bySerial = await listCpeDevices({ client, search: ` ${all[1].serialNumber.toLowerCase()} ` });
  assert.ok(bySerial.data.some((d) => d.id === all[1].id));
  assert.equal((await listCpeDevices({ client, search: "tidak-ada-zzz" })).total, 0);
});

test("listCpeDevices: filter status", async () => {
  const on = await listCpeDevices({ client, status: "online" });
  const off = await listCpeDevices({ client, status: "offline" });
  assert.ok(on.data.every((d) => d.isOnline));
  assert.ok(off.data.every((d) => !d.isOnline));
  assert.equal(on.total + off.total, all.length);
});

test("listCpeDevices: pagination limit 2 page 2", async () => {
  const r = await listCpeDevices({ client, limit: 2, page: 2 });
  assert.equal(r.total, all.length);
  assert.deepEqual(r.data.map((d) => d.id), all.slice(2, 4).map((d) => d.id));
  assert.equal((await listCpeDevices({ client, limit: 2, page: 99 })).data.length, 0);
});

test("getCpeDevice: ID ada, host terhubung ada", async () => {
  const d = await getCpeDevice(all[0].deviceId, client);
  assert.ok(d);
  assert.equal(d.id, all[0].id);
  assert.ok(Array.isArray(d.hosts) && d.hosts.length > 0);
});

test("getCpeDevice: ID tidak ada -> null", async () => {
  assert.equal(await getCpeDevice("tidak-ada", client), null);
});
