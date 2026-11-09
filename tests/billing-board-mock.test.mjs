import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();
const {
  loadBilling,
  summarizeBilling,
  matchBilling,
  nextBillingRefreshAt,
  mockBillingOverview,
} = await import("../src/lib/dashboard/billing.ts");
const { SETUP_DATA_SOURCE_REGISTRY } =
  await import("../src/lib/dashboard/setup-extended.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = 1_760_000_000;
const router = (id) => `R-${id}`;
const cust = (id, pppoeUsername, billingStatus = "lunas") => ({
  id,
  name: `N${id}`,
  pppoeUsername,
  routerId: "r1",
  billingStatus,
});
const rec = (invoiceRef, pppoeUsername, status = "isolir") => ({
  invoiceRef,
  pppoeUsername,
  status,
});

test("loadBilling: totals, rows, unmatched, sync konsisten", async () => {
  const o = mockBillingOverview(NOW);
  assert.ok(Array.isArray(o.rows));
  assert.ok(Array.isArray(o.unmatched));
  assert.ok(Array.isArray(o.sync.runs));
  assert.ok(o.sync.nextRunAt > NOW);
  const t = summarizeBilling(o.rows, o.unmatched);
  assert.equal(t.customers, o.rows.length);
  assert.equal(t.lunas + t.isolir, t.customers);
  assert.equal(t.unmatchedInvoices, o.unmatched.length);
  assert.equal(
    t.withoutInvoice,
    o.rows.filter((r) => r.match === "none").length,
  );
  assert.equal(typeof nextBillingRefreshAt(o.sync, NOW), "number");
});

test("summarizeBilling: hitung lunas, isolir, tanpa tagihan, tak cocok", () => {
  const rows = [
    { status: "lunas", match: "exact" },
    { status: "isolir", match: "normalized" },
    { status: "isolir", match: "none" },
    { status: "lunas", match: "none" },
  ];
  const t = summarizeBilling(rows, [{}, {}]);
  assert.deepEqual(t, {
    customers: 4,
    lunas: 2,
    isolir: 2,
    withoutInvoice: 2,
    unmatchedInvoices: 2,
  });
});

test("matchBilling: persis, normalisasi, tak cocok", () => {
  const customers = [cust("1", "budi"), cust("2", "Dewi")];
  const { rows, unmatched } = matchBilling(
    customers,
    [rec("A", "budi"), rec("B", " dewi "), rec("C", "ghost")],
    router,
  );
  const by = Object.fromEntries(rows.map((r) => [r.customerId, r]));
  assert.equal(by["1"].match, "exact");
  assert.equal(by["2"].match, "normalized");
  assert.equal(by["2"].status, "isolir");
  assert.deepEqual(
    unmatched.map((u) => [u.invoiceRef, u.reason]),
    [["C", "unknown"]],
  );
});

test("matchBilling: tanpa tagihan simpan status lama; duplikat ditolak", () => {
  const { rows, unmatched } = matchBilling(
    [cust("1", "a", "isolir"), cust("2", "b")],
    [rec("X", "b", "lunas"), rec("Y", "b", "isolir")],
    router,
  );
  const by = Object.fromEntries(rows.map((r) => [r.customerId, r]));
  assert.equal(by["1"].match, "none");
  assert.equal(by["1"].status, "isolir");
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].reason, "duplicate");
});

test("BillingBoard: testid root, lencana tiruan, 4 kartu", () => {
  const src = read("../src/components/dashboard/billing-board.tsx");
  assert.match(src, /data-testid="billing-board"/);
  assert.match(src, /data-testid="billing-mock-badge"/);
  assert.match(src, /Data Tiruan Billing \(Fase 2\)/);
  assert.match(src, /Fase 5/);
  assert.equal((src.match(/data-testid="billing-tile"/g) ?? []).length, 4);
  for (const k of ["lunas", "isolir", "unmatched", "without-invoice"]) {
    assert.match(src, new RegExp(`data-kind="${k}"`));
  }
});

test("registry: billing-scraper valid untuk go-live Fase 5", () => {
  const e = SETUP_DATA_SOURCE_REGISTRY.find((x) => x.id === "billing-scraper");
  assert.ok(e);
  assert.equal(e.status, "dummy");
  assert.equal(e.envKey, "BILLING_URL");
  assert.match(e.readPath, /loadBilling/);
  assert.match(e.notes, /Fase 5/);
});
