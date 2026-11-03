import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDashboardEmptyState } from "../src/lib/dashboard/dashboard-empty-state.ts";

const base = {
  customerCount: 10,
  routerCount: 2,
  visibleCount: 10,
  isConnected: true,
  hasActiveFilter: false,
};
const reason = (over) => resolveDashboardEmptyState({ ...base, ...over })?.reason;

test("connection_lost saat tidak tersambung (prioritas tertinggi)", () => {
  assert.equal(reason({ isConnected: false, routerCount: 0 }), "connection_lost");
});

test("no_router_connected saat router 0", () => {
  const c = resolveDashboardEmptyState({ ...base, routerCount: 0, customerCount: 0 });
  assert.equal(c.reason, "no_router_connected");
  assert.equal(c.actionHref, "/setup");
  assert.ok(c.guidanceTips.length > 0);
});

test("no_customers_found saat router ada tapi pelanggan 0", () => {
  assert.equal(reason({ customerCount: 0, visibleCount: 0 }), "no_customers_found");
});

test("filtered_empty hanya dengan filter aktif", () => {
  assert.equal(reason({ visibleCount: 0, hasActiveFilter: true }), "filtered_empty");
  assert.equal(reason({ visibleCount: 0, hasActiveFilter: false }), undefined);
});

test("null pada kondisi normal", () => {
  assert.equal(resolveDashboardEmptyState(base), null);
});

test("komponen tampilan kosong diekspor dan membawa test id", () => {
  const view = readFileSync("src/components/dashboard/dashboard-empty-view.tsx", "utf8");
  assert.match(view, /export function DashboardEmptyView/);
  assert.match(view, /data-testid="dashboard-empty-view"/);
  assert.match(view, /data-empty-reason/);
});
