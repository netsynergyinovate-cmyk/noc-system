import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getMockRouterTraffic,
  isTrafficEmpty,
} from "../src/lib/dashboard/router-traffic.ts";

const cardSrc = readFileSync("src/components/dashboard/router-traffic-card.tsx", "utf8");
const tableSrc = readFileSync("src/components/dashboard/router-table.tsx", "utf8");

test("getMockRouterTraffic: router aktif punya data, deterministik", () => {
  const a = getMockRouterTraffic("r1");
  const b = getMockRouterTraffic("r1");
  assert.equal(a.hasData, true);
  assert.ok(a.rxBps > 0 && a.txBps > 0);
  assert.ok(a.peakRxBps >= a.rxBps && a.peakTxBps >= a.txBps);
  assert.ok(a.rxTotalBytes > 0 && a.txTotalBytes > 0);
  assert.equal(a.rxBps, b.rxBps);
  assert.notEqual(a.rxBps, getMockRouterTraffic("r2").rxBps);
});

test("getMockRouterTraffic: router offline kosong", () => {
  const s = getMockRouterTraffic("r1", false);
  assert.equal(s.hasData, false);
  assert.equal(s.rxBps, 0);
  assert.equal(s.txBps, 0);
  assert.equal(s.reason, "Router offline atau REST terputus");
});

test("isTrafficEmpty", () => {
  assert.equal(isTrafficEmpty(getMockRouterTraffic("r1", false)), true);
  assert.equal(isTrafficEmpty(getMockRouterTraffic("r1")), false);
  assert.equal(
    isTrafficEmpty({ ...getMockRouterTraffic("r1"), rxBps: 0, txBps: 0, peakRxBps: 0 }),
    true,
  );
  assert.equal(isTrafficEmpty({ ...getMockRouterTraffic("r1"), rxBps: 0, txBps: 0 }), false);
});

test("RouterTrafficCard: struktur konten dan empty state", () => {
  assert.match(cardSrc, /^"use client";/);
  assert.match(cardSrc, /export function RouterTrafficCard/);
  assert.match(cardSrc, /export interface RouterTrafficCardProps/);
  assert.ok(cardSrc.includes('data-testid="router-traffic-content"'));
  assert.ok(cardSrc.includes('data-testid="traffic-empty-state"'));
  for (const t of [
    "Trafik Interface &amp; Bandwidth",
    "REST Live (Mock)",
    "Data Kosong",
    "Belum Ada Sampel Trafik",
    "Router tidak aktif atau belum ada sampel trafik yang terekam via REST API RouterOS.",
    "Uji Koneksi Router",
    "/app/router/test",
  ]) {
    assert.ok(cardSrc.includes(t), t);
  }
  assert.match(cardSrc, /formatBitrate/);
  assert.match(cardSrc, /formatBytes/);
  assert.match(cardSrc, /isTrafficEmpty\(stats\)/);
  assert.match(cardSrc, /role="progressbar"/);
});

test("RouterTable: tab Trafik Live memakai RouterTrafficCard", () => {
  assert.match(tableSrc, /import \{ RouterTrafficCard \}/);
  assert.match(tableSrc, /grid-cols-5/);
  assert.match(tableSrc, /<TabsTrigger value="traffic"/);
  assert.match(tableSrc, /Trafik Live/);
  assert.match(
    tableSrc,
    /<TabsContent value="traffic"[\s\S]*?<RouterTrafficCard[\s\S]*?routerId=\{selectedRouter\.id\}[\s\S]*?routerName=\{selectedRouter\.name\}[\s\S]*?active=\{selectedRouter\.active\}/,
  );
});
