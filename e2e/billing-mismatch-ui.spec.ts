import { expect, test } from "@playwright/test";
import { mockBillingOverview } from "../src/lib/dashboard/billing";
import { billingBadge } from "../src/lib/dashboard/billing-badge";
import {
  buildMismatches,
  describeMismatches,
  mismatchAdvice,
  mismatchKinds,
  mismatchLabels,
  summarizeMismatches,
  type MismatchKind,
} from "../src/lib/dashboard/billing-mismatch";
import { formatInteger } from "../src/lib/dashboard/format";
import { findBillingMoments } from "./billing-moments";
import {
  contextFor,
  firstDifference,
  openBillingAt,
  signUp,
  type Cookies,
} from "./billing-ui";

// Daftar ketidakcocokan di halaman Billing: tagihan yang tidak punya pelanggan
// dan pelanggan yang tidak punya tagihan, yang kemungkinan satu masalah digabung
// satu baris, beserta saran apa yang perlu dibetulkan. Jam browser dikunci pada
// momen dari data tiruannya sendiri.

const moments = findBillingMoments();
const now = moments.ok;
const data = mockBillingOverview(now);
const list = buildMismatches(data.rows, data.unmatched);
const counts = summarizeMismatches(list);

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Ketidakcocokan");
  await context.close();
});

const card = '[data-testid="billing-mismatch"]';
const rowsSelector = '[data-testid="billing-mismatch-row"]';

test("daftar memuat tiap ketidakcocokan dengan jenis, tagihan, pelanggan, dan sarannya, sama dengan datanya", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);

  await expect(page.locator(card)).toHaveAttribute(
    "data-count",
    String(list.length),
  );
  const rows = page.locator(rowsSelector);
  await expect(rows).toHaveCount(list.length);
  const got = await rows.evaluateAll((items) =>
    items.map((row) => {
      const cells = row.querySelectorAll(":scope > td");
      return {
        kind: row.getAttribute("data-kind"),
        invoice: row.getAttribute("data-invoice"),
        customers: row.getAttribute("data-customers"),
        label: cells[0].textContent,
        invoiceRef:
          cells[1].querySelector("[data-testid=mismatch-invoice]")
            ?.textContent ?? null,
        invoiceName:
          cells[1].querySelector("[data-testid=mismatch-invoice-name]")
            ?.textContent ?? null,
        badge:
          cells[1].querySelector("[data-testid=billing-badge]")?.textContent ??
          null,
        people: [
          ...cells[2].querySelectorAll("[data-testid=mismatch-customer]"),
        ].map((person) => [...person.children].map((line) => line.textContent)),
        dash: cells[1].textContent === "—" || cells[2].textContent === "—",
        advice: cells[3].textContent,
      };
    }),
  );
  const expected = list.map((item) => ({
    kind: item.kind,
    invoice: item.invoice?.invoiceRef ?? "",
    customers: item.customers.map((c) => c.customerId).join(","),
    label: mismatchLabels[item.kind],
    invoiceRef: item.invoice?.invoiceRef ?? null,
    invoiceName: item.invoice?.pppoeUsername ?? null,
    badge: item.invoice ? billingBadge(item.invoice.status).label : null,
    people: item.customers.map((c) => [
      c.name,
      c.pppoeUsername,
      item.kind === "invoice-duplicate" && c.invoiceRef
        ? `${c.routerName}, memakai ${c.invoiceRef}`
        : c.routerName,
    ]),
    dash: item.invoice === null || item.customers.length === 0,
    advice: mismatchAdvice(item),
  }));
  expect(firstDifference(got, expected)).toBeNull();

  // Jenis yang ada di data tiruan benar-benar tampil, supaya pengujian bermakna.
  const seen = new Set(got.map((row) => row.kind));
  for (const kind of [
    "pair",
    "invoice-unknown",
    "invoice-duplicate",
    "customer-without-invoice",
  ]) {
    expect(seen.has(kind), kind).toBe(true);
  }
  // Urutan: jenis yang paling mudah dibetulkan di atas.
  const ranks = got.map((row) =>
    mismatchKinds.indexOf(row.kind as MismatchKind),
  );
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  // Kartu lama (hanya tagihan) sudah digantikan.
  await expect(page.getByTestId("billing-unmatched")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("saran untuk pasangan menyebut nama yang harus dipakai di billing, dan yang ganda menyebut tagihan yang sudah dipakai", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);
  const pair = list.find((item) => item.kind === "pair")!;
  const pairRow = page.locator(`${rowsSelector}[data-kind=pair]`).first();
  await expect(pairRow).toContainText(pair.invoice!.invoiceRef);
  await expect(pairRow).toContainText(pair.customers[0].name);
  await expect(pairRow).toContainText(
    `Samakan nama PPPoE di billing menjadi ${pair.customers[0].pppoeUsername}.`,
  );
  const duplicate = list.find((item) => item.kind === "invoice-duplicate")!;
  const duplicateRow = page
    .locator(`${rowsSelector}[data-kind=invoice-duplicate]`)
    .first();
  await expect(duplicateRow).toContainText(
    `memakai ${duplicate.customers[0].invoiceRef}`,
  );
  await expect(duplicateRow).toContainText(
    `Pelanggan ini sudah memakai tagihan ${duplicate.customers[0].invoiceRef}.`,
  );
  // Pelanggan tanpa tagihan tidak punya kolom tagihan.
  const lonely = page
    .locator(`${rowsSelector}[data-kind=customer-without-invoice]`)
    .first();
  await expect(lonely.locator("td").nth(1)).toHaveText("—");
  expect(errors).toEqual([]);
  await context.close();
});

test("kalimat ringkasan menyebut jumlah tiap jenis, sama dengan daftarnya", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);
  const summary = page.getByTestId("mismatch-summary");
  await expect(summary).toHaveText(describeMismatches(counts));
  await expect(summary).toContainText(
    `${formatInteger(list.length)} ketidakcocokan:`,
  );
  // Tiap jumlah di kalimat sama dengan banyaknya baris jenis itu.
  for (const kind of mismatchKinds) {
    await expect(
      page.locator(`${rowsSelector}[data-kind=${kind}]`),
    ).toHaveCount(counts[kind]);
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("saringan jenis: pilihan beserta jumlahnya, hasilnya, jenis yang kosong, dan bertahan saat data dimuat ulang", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
  const select = page.locator("#mismatch-kind");
  expect(await select.locator("option").allTextContents()).toEqual([
    `Semua jenis (${formatInteger(counts.total)})`,
    ...mismatchKinds.map(
      (kind) => `${mismatchLabels[kind]} (${formatInteger(counts[kind])})`,
    ),
  ]);

  for (const kind of mismatchKinds) {
    await select.selectOption(kind);
    if (counts[kind] === 0) {
      await expect(page.locator(rowsSelector)).toHaveCount(0);
      await expect(page.getByTestId("mismatch-empty")).toHaveText(
        "Tidak ada ketidakcocokan jenis ini.",
      );
      continue;
    }
    await expect(page.locator(rowsSelector)).toHaveCount(counts[kind]);
    const kindsShown = await page
      .locator(rowsSelector)
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-kind")));
    expect(new Set(kindsShown)).toEqual(new Set([kind]));
  }

  // Bertahan saat data dimuat ulang berkala (tiap 30 detik), tanpa memuat ulang halaman.
  await select.selectOption("invoice-duplicate");
  await page.clock.runFor(31_000);
  await expect(select).toHaveValue("invoice-duplicate");
  await expect(page.locator(rowsSelector)).toHaveCount(
    counts["invoice-duplicate"],
  );
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);

  await select.selectOption("all");
  await expect(page.locator(rowsSelector)).toHaveCount(list.length);
  // Ringkasan tidak berubah oleh saringan: ia menghitung seluruh daftar.
  await expect(page.getByTestId("mismatch-summary")).toHaveText(
    describeMismatches(counts),
  );
  expect(errors).toEqual([]);
  await context.close();
});

test("daftar bisa dijangkau papan ketik, ikonnya hiasan, dan kolomnya bernama", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);
  const region = page.getByRole("region", {
    name: "Daftar ketidakcocokan data billing",
  });
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.focus();
  await expect(region).toBeFocused();
  await expect(region.locator("caption")).toContainText(
    "Tagihan yang tidak punya pelanggan dan pelanggan yang tidak punya tagihan",
  );
  expect(
    await region
      .locator("th")
      .evaluateAll((items) => items.map((i) => i.textContent)),
  ).toEqual(["Jenis", "Tagihan di billing", "Pelanggan", "Saran"]);
  await expect(page.locator(`${card} svg:not([aria-hidden=true])`)).toHaveCount(
    0,
  );
  // Satu ikon hiasan di tiap sel jenis, dan bentuknya berbeda untuk tiap jenis.
  const shapes = await page
    .locator(rowsSelector)
    .evaluateAll((rows) =>
      rows.map((row) => [
        row.getAttribute("data-kind"),
        row.querySelector("td:first-child svg")?.getAttribute("class") ?? "",
      ]),
    );
  const byKind = new Map(shapes as [string, string][]);
  expect(new Set(byKind.values()).size).toBe(byKind.size);
  expect(byKind.size).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
  await context.close();
});

test("di layar sempit daftar bergulir di dalam kotaknya, dan saringannya muat", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies, {
    viewport: { width: 390, height: 844 },
  });
  await openBillingAt(page, now);
  const region = page.getByRole("region", {
    name: "Daftar ketidakcocokan data billing",
  });
  await region.scrollIntoViewIfNeeded();
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  const select = (await page.locator("#mismatch-kind").boundingBox())!;
  expect(select.x).toBeGreaterThanOrEqual(0);
  expect(select.x + select.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});
