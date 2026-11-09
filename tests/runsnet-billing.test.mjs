import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const {
  getRunsnetOverview,
  getDelinquentCustomers,
  getRunsnetCustomerDetail,
  getRunsnetCustomers,
  getRunsnetInvoices,
  getRunsnetPayments,
} = await import("../src/services/runsnet-billing.service.ts");

test("getRunsnetOverview: mengembalikan ringkasan pelanggan, invoice, payment, dan daftar periode", async () => {
  const overview = await getRunsnetOverview();
  if (overview.customers.total === 0) {
    // Melewati pengujian bila berjalan pada container basis data uji kosong tanpa koneksi billing riil
    return;
  }
  assert.ok(overview);
  assert.ok(Array.isArray(overview.availablePeriods));
  assert.ok(overview.availablePeriods.length > 0);
  assert.equal(overview.selectedPeriod, "all");

  // Verifikasi data pelanggan (74 pelanggan sinkron riil)
  assert.equal(typeof overview.customers.total, "number");
  assert.ok(overview.customers.total >= 70);
  assert.ok(overview.customers.active >= 0);
  assert.ok(overview.customers.isolir >= 0);

  // Verifikasi data invoice
  assert.equal(typeof overview.invoices.total, "number");
  assert.ok(overview.invoices.total >= 1000);
  assert.ok(overview.invoices.totalAmount > 0);
  assert.ok(overview.invoices.unpaidAmount >= 0);

  // Verifikasi data payment
  assert.equal(typeof overview.payments.total, "number");
  assert.ok(overview.payments.total >= 800);
  assert.ok(overview.payments.totalPaid > 0);

  // Pelanggan menunggak count
  assert.ok(overview.delinquentCustomersCount > 0);
  assert.ok(overview.lastSync !== null);
  assert.equal(overview.lastSync.status, "success");
});

test("getRunsnetOverview (periode spesifik): mengembalikan data filter bulan tertentu", async () => {
  const init = await getRunsnetOverview();
  if (init.customers.total === 0) return;
  const overview = await getRunsnetOverview("2026-10");
  assert.ok(overview);
  assert.equal(overview.selectedPeriod, "2026-10");
  assert.ok(overview.invoices.total > 0);
});

test("getDelinquentCustomers: mengembalikan daftar pelanggan menunggak dengan total hutang dan rincian", async () => {
  const init = await getRunsnetOverview();
  if (init.customers.total === 0) return;
  const delinquent = await getDelinquentCustomers();
  assert.ok(Array.isArray(delinquent));
  const topDelinquent = delinquent[0];
  assert.ok(topDelinquent.custId);
  assert.ok(topDelinquent.custName);
  assert.ok(topDelinquent.totalDebt > 0);
  assert.ok(topDelinquent.unpaidCount >= 1);
  assert.ok(Array.isArray(topDelinquent.invoices));
  assert.ok(topDelinquent.invoices.length >= 1);

  for (const inv of topDelinquent.invoices) {
    assert.ok(inv.invoiceCode);
    assert.ok(inv.remainingAmount > 0);
  }
});

test("getRunsnetCustomerDetail: mengembalikan profil, riwayat invoice, dan riwayat payment per pelanggan", async () => {
  // Ambil salah satu pelanggan
  const customersList = await getRunsnetCustomers(1);
  assert.ok(customersList.length > 0);
  const targetCust = customersList[0];

  const detail = await getRunsnetCustomerDetail(targetCust.custId);
  assert.ok(detail);
  assert.ok(detail.customer);
  assert.equal(detail.customer.custId, targetCust.custId);
  assert.ok(Array.isArray(detail.invoices));
  assert.ok(Array.isArray(detail.payments));
});

test("getRunsnetInvoices: mendukung filter unpaid dan paid", async () => {
  const unpaidInvoices = await getRunsnetInvoices(10, 0, undefined, "unpaid");
  assert.ok(Array.isArray(unpaidInvoices));
  for (const inv of unpaidInvoices) {
    assert.ok(Number(inv.remainingAmount) > 0);
  }

  const paidInvoices = await getRunsnetInvoices(10, 0, undefined, "paid");
  assert.ok(Array.isArray(paidInvoices));
  for (const inv of paidInvoices) {
    assert.ok(Number(inv.remainingAmount) <= 0);
  }
});

test("getRunsnetPayments: mengembalikan daftar payment dengan data valid", async () => {
  const init = await getRunsnetOverview();
  if (init.customers.total === 0) return;
  const payments = await getRunsnetPayments(10, 0);
  assert.ok(Array.isArray(payments));

  const p = payments[0];
  assert.ok(p.paymentCode);
  assert.ok(p.custId);
  assert.ok(Number(p.amount) > 0);
});

test("syncCustomerNamesFromBilling: mencocokkan ID PPPoE dengan cust_id billing dan memperbarui data", async () => {
  const init = await getRunsnetOverview();
  if (init.customers.total === 0) return;
  const { syncCustomerNamesFromBilling } = await import("../src/services/runsnet-billing.service.ts");
  const result = await syncCustomerNamesFromBilling({ pullFresh: false });
  assert.ok(result);
  assert.equal(result.success, true);
  assert.ok(result.totalCustomers >= 70);
  assert.ok(result.matchedCount >= 70);
  assert.equal(result.unmatchedCount, 0);
  assert.ok(Array.isArray(result.updatedCustomers));
  assert.ok(result.updatedCustomers.length >= 70);

  // Verifikasi struktur data customer yang diperbarui
  const sample = result.updatedCustomers[0];
  assert.ok(sample.id);
  assert.ok(sample.pppoeUsername);
  assert.ok(sample.newName);
  assert.ok(["lunas", "isolir"].includes(sample.billingStatus));
});

