import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// ponytail: source uses extensionless relative imports (bundler style); this hook appends .ts for the test only.
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) {
    if (s.startsWith(".") && !/\\.\\w+$/.test(s)) return next(s + ".ts", c);
    throw e;
  }
}`),
);
const { filterMismatches } = await import(
  "../src/lib/dashboard/billing-mismatch.ts"
);

const cust = (id, name, pppoe, router) => ({
  customerId: id,
  name,
  pppoeUsername: pppoe,
  routerName: router,
  invoiceRef: null,
});

const list = [
  {
    id: "1",
    kind: "pair",
    invoice: { invoiceRef: "INV-001", pppoeUsername: "budi01x", status: "paid" },
    customers: [cust("c1", "Budi Santoso", "budi01", "Router A")],
    distance: 1,
  },
  {
    id: "2",
    kind: "invoice-unknown",
    invoice: { invoiceRef: "INV-002", pppoeUsername: "ghost", status: "unpaid" },
    customers: [],
    distance: null,
  },
  {
    id: "3",
    kind: "customer-without-invoice",
    invoice: null,
    customers: [cust("c2", "Dewi Lestari", "dewi02", "Router B")],
    distance: null,
  },
];

const ids = (r) => r.map((i) => i.id);

test("kind only", () => {
  assert.deepEqual(ids(filterMismatches(list, "pair")), ["1"]);
  assert.deepEqual(ids(filterMismatches(list, "all")), ["1", "2", "3"]);
});

test("query by customer name, case-insensitive", () => {
  assert.deepEqual(ids(filterMismatches(list, "all", "DEWI")), ["3"]);
});

test("query by invoiceRef", () => {
  assert.deepEqual(ids(filterMismatches(list, "all", "inv-002")), ["2"]);
});

test("kind + multi-word query", () => {
  assert.deepEqual(ids(filterMismatches(list, "pair", "budi router a")), ["1"]);
  assert.deepEqual(ids(filterMismatches(list, "invoice-unknown", "budi")), []);
});

test("no match gives empty array", () => {
  assert.deepEqual(filterMismatches(list, "all", "zzzz"), []);
});
