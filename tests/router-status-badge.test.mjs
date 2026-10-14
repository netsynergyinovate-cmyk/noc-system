import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRouterStatusBadgeModel as m } from "../src/lib/dashboard/router-status.ts";

const badgeSrc = readFileSync("src/components/dashboard/router-status-badge.tsx", "utf8");
const tableSrc = readFileSync("src/components/dashboard/router-table.tsx", "utf8");

test("active true -> connected / REST OK", () => {
  const r = m({ active: true });
  assert.equal(r.kind, "connected");
  assert.equal(r.label, "REST OK");
  assert.equal(r.ariaLabel, "Status koneksi router: REST OK");
});

test("active false -> error / Terputus", () => {
  const r = m({ active: false });
  assert.equal(r.kind, "error");
  assert.equal(r.label, "Terputus");
});

test("latency hanya muncul saat connected dan showLatency", () => {
  assert.equal(m({ active: true, latencyMs: 42, showLatency: true }).label, "REST OK · 42 ms");
  assert.equal(m({ active: true, latencyMs: 42 }).label, "REST OK");
  assert.equal(m({ active: false, latencyMs: 42, showLatency: true }).label, "Terputus");
});

test("isTesting menimpa status", () => {
  const r = m({ active: true, status: "connected", isTesting: true });
  assert.equal(r.kind, "testing");
  assert.equal(r.busy, true);
  assert.equal(r.label, "Menguji REST...");
});

test("status menimpa active; timeout & untested", () => {
  assert.equal(m({ active: true, status: "timeout" }).kind, "timeout");
  assert.equal(m({ status: "timeout" }).label, "Timeout");
  assert.equal(m({ status: "untested" }).kind, "untested");
  assert.equal(m({ status: "untested" }).label, "Belum Diuji");
  assert.equal(m({ status: "disconnected" }).kind, "error");
});

test("label kustom dipakai", () => {
  assert.equal(m({ active: true, label: "Aktif" }).label, "Aktif");
});

test("komponen mengekspor RouterStatusBadge dengan atribut a11y", () => {
  assert.match(badgeSrc, /export function RouterStatusBadge/);
  assert.match(badgeSrc, /role="status"/);
  assert.match(badgeSrc, /aria-label=\{model\.ariaLabel\}/);
  assert.match(badgeSrc, /data-testid="router-status-badge"/);
  assert.match(badgeSrc, /data-status=\{model\.kind\}/);
  assert.match(badgeSrc, /aria-hidden="true"/);
});

test("router-table memakai RouterStatusBadge", () => {
  assert.match(tableSrc, /import \{ RouterStatusBadge \}/);
  assert.match(tableSrc, /<RouterStatusBadge active=\{router\.active\} \/>/);
  assert.match(tableSrc, /<RouterStatusBadge active=\{selectedRouter\.active\} \/>/);
});
