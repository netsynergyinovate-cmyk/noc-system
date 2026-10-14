import { expect, test } from "@playwright/test";
import { mockBillingOverview } from "../src/lib/dashboard/billing";
import {
  billingBadge,
  billingBadgeLegend,
} from "../src/lib/dashboard/billing-badge";
import { findBillingMoments } from "./billing-moments";
import {
  contextFor,
  firstDifference,
  measureContrast,
  openBillingAt,
  signUp,
  type Cookies,
} from "./billing-ui";

// Penanda Lunas, Isolir, dan netral di layar: tabel status billing, daftar
// tagihan yang belum cocok, legenda, dan tabel Pelanggan memakai komponen yang
// sama. Jam browser dikunci pada momen dari data tiruannya sendiri.

const moments = findBillingMoments();

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Penanda Billing");
  await context.close();
});

const badge = "[data-testid=billing-badge]";

test("tiap penanda di tabel dan di daftar belum cocok sama dengan statusnya, dengan satu ikon hiasan dan tulisannya", async ({
  browser,
}) => {
  const now = moments.ok;
  const data = mockBillingOverview(now);
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);
  await expect(page.getByTestId("billing-row")).toHaveCount(100);

  const read = (selector: string) =>
    page.locator(selector).evaluateAll((rows, query) => {
      return rows.map((row) => {
        const found = row.querySelectorAll(query);
        const mark = found[0];
        return {
          invoice: row.getAttribute("data-invoice"),
          badges: found.length,
          status: mark?.getAttribute("data-status") ?? null,
          tone: mark?.getAttribute("data-tone") ?? null,
          text: mark?.textContent ?? null,
          icons: mark?.querySelectorAll("svg").length ?? 0,
          hidden: mark?.querySelector("svg")?.getAttribute("aria-hidden"),
        };
      });
    }, badge);
  const expectedFor = (
    status: "lunas" | "isolir",
    invoice: string | null = null,
  ) => {
    const model = billingBadge(status);
    return {
      invoice,
      badges: 1,
      status: model.state,
      tone: model.tone,
      text: model.label,
      icons: 1,
      hidden: "true",
    };
  };

  expect(
    firstDifference(
      await read("[data-testid=billing-row]"),
      data.rows.map((row) => expectedFor(row.status)),
    ),
  ).toBeNull();
  // Daftar ketidakcocokan: tiap tagihan di sana memakai penanda yang sama. Yang
  // tanpa tagihan tidak punya penanda. Urutannya menurut jenis, jadi dibandingkan
  // menurut kode tagihan.
  const byInvoice = <T extends { invoice: string | null }>(items: T[]) =>
    [...items].sort((a, b) => (a.invoice! < b.invoice! ? -1 : 1));
  expect(
    firstDifference(
      byInvoice(
        await read("[data-testid=billing-mismatch-row]:not([data-invoice=''])"),
      ),
      byInvoice(
        data.unmatched.map((item) => expectedFor(item.status, item.invoiceRef)),
      ),
    ),
  ).toBeNull();
  await expect(
    page.locator(
      "[data-testid=billing-mismatch-row][data-kind=customer-without-invoice] [data-testid=billing-badge]",
    ),
  ).toHaveCount(0);
  // Kedua keadaan yang berwarna benar-benar tampil, supaya pengujian bermakna.
  const tones = new Set(
    (await read("[data-testid=billing-row]")).map((item) => item.tone),
  );
  expect([...tones].sort()).toEqual(["danger", "success"]);
  expect(errors).toEqual([]);
  await context.close();
});

test("legenda menjelaskan ketiga penanda, dengan tulisan, ikon yang berbeda bentuk, dan satu yang netral", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, moments.ok);

  const legend = page.getByRole("group", { name: "Arti penanda status" });
  await expect(legend).toBeVisible();
  await expect(legend).toHaveAttribute("data-testid", "billing-badge-legend");
  const items = legend.getByTestId("billing-legend-item");
  await expect(items).toHaveCount(3);
  for (const [index, status] of billingBadgeLegend.entries()) {
    const model = billingBadge(status);
    const item = items.nth(index);
    await expect(item).toHaveAttribute("data-state", model.state);
    const mark = item.getByTestId("billing-badge");
    await expect(mark).toHaveText(model.label);
    await expect(mark).toHaveAttribute("data-status", model.state);
    await expect(mark).toHaveAttribute("data-tone", model.tone);
    await expect(item).toContainText(model.hint);
  }
  await expect(legend.getByTestId("billing-badge").nth(2)).toHaveText(
    "Belum ada data",
  );

  // Dibedakan oleh bentuk ikon, bukan hanya warna.
  const shapes = await legend
    .locator(`${badge} svg`)
    .evaluateAll((icons) => icons.map((icon) => icon.innerHTML));
  expect(shapes).toHaveLength(3);
  expect(new Set(shapes).size).toBe(3);

  // Latar dan warna tulisan ketiganya berbeda, dan tingginya sama.
  const looks = await legend.locator(badge).evaluateAll((marks) =>
    marks.map((mark) => {
      const style = getComputedStyle(mark);
      return {
        background: style.backgroundColor,
        color: style.color,
        height: Math.round(mark.getBoundingClientRect().height * 10) / 10,
      };
    }),
  );
  expect(new Set(looks.map((look) => look.background)).size).toBe(3);
  expect(new Set(looks.map((look) => look.color)).size).toBe(3);
  expect(new Set(looks.map((look) => look.height)).size).toBe(1);
  expect(errors).toEqual([]);
  await context.close();
});

test("tabel Pelanggan memakai penanda yang sama, dan statusnya sama dengan halaman Billing untuk tiap pelanggan", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, moments.ok);
  await expect(page.getByTestId("billing-row")).toHaveCount(100);
  const billing = await page
    .getByTestId("billing-row")
    .evaluateAll((rows) =>
      rows.map((row) => [
        row.querySelector("td .font-mono")!.textContent,
        row
          .querySelector("[data-testid=billing-badge]")!
          .getAttribute("data-status"),
      ]),
    );

  await page
    .getByRole("navigation", { name: "Menu utama" })
    .getByRole("link", { name: "Pelanggan" })
    .click();
  await expect(page).toHaveURL("/app/pelanggan");
  const table = page.getByRole("region", { name: "Daftar status pelanggan" });
  await expect(table.locator("tbody tr")).toHaveCount(100);
  const customers = await table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => {
      const mark = row.children[4].querySelector("[data-testid=billing-badge]");
      return {
        pppoe: row.children[0].children[1].textContent,
        status: mark?.getAttribute("data-status") ?? null,
        tone: mark?.getAttribute("data-tone") ?? null,
        text: mark?.textContent ?? null,
        icons: mark?.querySelectorAll("svg[aria-hidden=true]").length ?? 0,
        cell: row.children[4].textContent,
      };
    }),
  );
  expect(customers).toHaveLength(100);
  const byPppoe = new Map(billing.map(([pppoe, status]) => [pppoe, status]));
  const problems = customers.filter((item) => {
    const model = billingBadge(byPppoe.get(item.pppoe) as "lunas" | "isolir");
    return (
      item.status !== model.state ||
      item.tone !== model.tone ||
      item.text !== model.label ||
      item.cell !== model.label ||
      item.icons !== 1
    );
  });
  expect(problems.slice(0, 3)).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`ketiga penanda dan legendanya terbaca jelas di tema ${scheme}`, async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      colorScheme: scheme,
    });
    await openBillingAt(page, moments.ok);
    await expect(page.getByTestId("billing-row")).toHaveCount(100);
    const problems: string[] = [];
    for (const selector of [
      `${badge}[data-tone=success]`,
      `${badge}[data-tone=danger]`,
      `${badge}[data-tone=neutral]`,
      "[data-testid=billing-badge-legend] p",
      "[data-testid=billing-badge-legend] li > span",
    ]) {
      const results = await measureContrast(page, selector);
      if (results.length === 0) problems.push(`${selector}: tidak ada elemen`);
      for (const { text, ratio } of results) {
        if (ratio < 4.5)
          problems.push(`${selector} "${text}": ${ratio.toFixed(2)}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("di layar sempit legenda bertumpuk dan muat, penanda tidak terpecah, dan halaman tidak melebar", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies, {
    viewport: { width: 390, height: 844 },
  });
  await openBillingAt(page, moments.ok);
  const legend = page.getByTestId("billing-badge-legend");
  await legend.scrollIntoViewIfNeeded();
  const boxes = await legend
    .getByTestId("billing-legend-item")
    .evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { left: Math.round(box.left), right: box.right, top: box.top };
      }),
    );
  expect(boxes).toHaveLength(3);
  expect(new Set(boxes.map((box) => box.left)).size).toBe(1);
  for (const box of boxes) expect(box.right).toBeLessThanOrEqual(390);
  expect(boxes[1].top).toBeGreaterThan(boxes[0].top);
  expect(boxes[2].top).toBeGreaterThan(boxes[1].top);
  // Tulisan penanda tetap satu baris.
  const heights = await page
    .locator(badge)
    .evaluateAll((marks) =>
      marks.map((mark) => Math.round(mark.getBoundingClientRect().height)),
    );
  expect(Math.max(...heights)).toBeLessThan(28);
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

test("di layar lebar legenda sebaris tiga kolom", async ({ browser }) => {
  const { context, page, errors } = await contextFor(browser, cookies, {
    viewport: { width: 1440, height: 900 },
  });
  await openBillingAt(page, moments.ok);
  const tops = await page
    .getByTestId("billing-legend-item")
    .evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().top)),
    );
  expect(tops).toHaveLength(3);
  expect(new Set(tops).size).toBe(1);
  expect(errors).toEqual([]);
  await context.close();
});
