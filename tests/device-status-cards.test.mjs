import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  transformRoutersToStatusCards,
  transformOltsToStatusCards,
  computeAggregateDeviceStatus,
} from "../src/lib/dashboard/device-status-cards.ts";

const routers = [
  {
    id: "r1",
    name: "Core",
    host: "10.0.0.1",
    active: true,
    cpuLoad: 24,
    uptime: "48 hari",
    pppoeCount: 5,
  },
  {
    id: "r2",
    name: "Dist",
    host: "10.0.0.2",
    active: true,
    cpuLoad: 88,
    uptime: "2 hari",
    pppoeCount: 7,
  },
  { id: "r3", name: "Down", host: "10.0.0.3", active: false },
];
const olts = [
  {
    id: "o1",
    name: "OLT-A",
    host: "10.1.0.1",
    brand: "HSGQ",
    ponPorts: 8,
    activeOnus: 64,
    temperature: 41,
    uptime: "10 hari",
  },
  {
    id: "o2",
    name: "OLT-B",
    host: "10.1.0.2",
    brand: "ZTE",
    ponPorts: 4,
    activeOnus: 10,
    temperature: 50,
    uptime: "3 hari",
  },
];

test("router -> kartu", () => {
  const [a, b, c] = transformRoutersToStatusCards(routers, [
    { routerId: "r1" },
    { routerId: "r1" },
    { routerId: "r2" },
  ]);
  assert.equal(a.type, "router");
  assert.equal(a.ipAddress, "10.0.0.1");
  assert.equal(a.status, "online");
  assert.equal(a.cpuOrTemp, "CPU 24%");
  assert.equal(a.capacitySummary, "2 Pelanggan");
  assert.equal(b.status, "warning");
  assert.equal(c.status, "offline");
  assert.equal(c.cpuOrTemp, "CPU —");
});

test("router tanpa customers memakai pppoeCount", () => {
  assert.equal(
    transformRoutersToStatusCards(routers)[1].capacitySummary,
    "7 Pelanggan",
  );
});

test("OLT -> kartu dengan suhu dan ONU", () => {
  const [a, b] = transformOltsToStatusCards(olts);
  assert.equal(a.type, "olt");
  assert.equal(a.cpuOrTemp, "Temp 41°C");
  assert.equal(a.capacitySummary, "8 PON / 64 ONU");
  assert.equal(a.status, "online");
  assert.equal(b.status, "warning");
  assert.equal(b.brand, "ZTE");
});

test("trafik opsional", () => {
  const [c] = transformRoutersToStatusCards([
    { id: "x", name: "x", host: "h", rxMbps: 1200, txMbps: 340 },
  ]);
  assert.equal(c.trafficSummary, "↓ 1.2 Gbps / ↑ 340 Mbps");
});

test("agregat", () => {
  const agg = computeAggregateDeviceStatus(routers, olts);
  assert.deepEqual(agg, {
    totalRouters: 3,
    onlineRouters: 2,
    totalOlts: 2,
    onlineOlts: 2,
    totalActivePppoe: 12,
    totalActiveOnus: 74,
    allHealthy: false,
  });
  assert.equal(
    computeAggregateDeviceStatus(routers.slice(0, 2), olts).allHealthy,
    true,
  );
  assert.equal(computeAggregateDeviceStatus([], []).allHealthy, true);
});

test("agregat dengan customers menghitung yang online", () => {
  const agg = computeAggregateDeviceStatus(routers, olts, [
    { isOnline: true },
    { isOnline: false },
  ]);
  assert.equal(agg.totalActivePppoe, 1);
});

test("komponen DeviceStatusCardGrid diekspor dan terpasang", () => {
  const src = readFileSync(
    new URL(
      "../src/components/dashboard/device-status-card-grid.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(src, /^"use client"/);
  assert.match(src, /export function DeviceStatusCardGrid/);
  assert.match(src, /data-testid="device-status-grid"/);
  assert.match(src, /data-testid="device-card"/);
  const page = readFileSync(
    new URL("../src/app/(protected)/app/router/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /<DeviceStatusCardGrid \/>/);
});
