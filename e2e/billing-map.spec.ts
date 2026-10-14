import { expect, test, type Page } from "@playwright/test";
import { mockBillingOverview } from "../src/lib/dashboard/billing";
import { billingBadge } from "../src/lib/dashboard/billing-badge";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";
import { BILLING_START } from "./billing-moments";
import {
  contextFor,
  measureContrast,
  signUp,
  type Cookies,
} from "./billing-ui";

// Penanda Lunas atau Isolir di tooltip titik pelanggan pada peta: tooltip yang
// permanen di cincin sorotan dan tooltip kursor memuat penanda yang sama dengan
// tabel, dengan warna yang terbaca di kotak putih Leaflet pada kedua tema.

const customers = createMockCustomers();
// Dua yang lunas dan tiga yang isolir, supaya kedua keadaan diperiksa.
const picked = [
  ...customers.filter((c) => c.billingStatus === "lunas").slice(0, 2),
  ...customers.filter((c) => c.billingStatus === "isolir").slice(0, 3),
];

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Peta Billing");
  await context.close();
});

async function focusOn(page: Page, customerId: string) {
  await page.goto(`/app?focus=${customerId}`);
  const map = page.getByTestId("customer-map");
  await expect(map).toHaveAttribute("data-zoom", "16");
  const ring = map.locator(".leaflet-tooltip-top");
  await expect(ring).toHaveCount(1);
  return { map, ring };
}

test("data tiruan memuat pelanggan lunas dan isolir untuk diperiksa", () => {
  expect(picked.filter((c) => c.billingStatus === "lunas")).toHaveLength(2);
  expect(picked.filter((c) => c.billingStatus === "isolir")).toHaveLength(3);
});

test("tooltip sorotan memuat nama, ODP, lalu penanda tagihan yang sama dengan datanya", async ({
  browser,
}) => {
  const overview = mockBillingOverview(BILLING_START);
  const { context, page, errors } = await contextFor(browser, cookies);
  for (const customer of picked) {
    const { ring } = await focusOn(page, customer.id);
    const mark = ring.getByTestId("billing-badge");
    await expect(mark, customer.id).toHaveCount(1);
    const model = billingBadge(customer.billingStatus);
    await expect(mark).toHaveAttribute("data-status", model.state);
    await expect(mark).toHaveAttribute("data-tone", model.tone);
    await expect(mark).toHaveAttribute("data-surface", "light");
    await expect(mark).toHaveText(model.label);
    // Sama dengan baris pelanggan itu di halaman Billing.
    const row = overview.rows.find((item) => item.customerId === customer.id)!;
    expect(row.status).toBe(customer.billingStatus);
    // Satu ikon hiasan, dan isi lama tetap ada.
    await expect(mark.locator("svg[aria-hidden=true]")).toHaveCount(1);
    await expect(ring).toContainText(customer.name);
    await expect(ring.getByTestId("customer-odp")).toHaveText(customer.odpName);

    // Urutannya: nama, ODP, lalu penanda; semuanya di dalam kotak tooltip.
    const box = (await ring.boundingBox())!;
    const odp = (await ring.getByTestId("customer-odp").boundingBox())!;
    const badge = (await mark.boundingBox())!;
    expect(badge.y).toBeGreaterThan(odp.y + odp.height - 1);
    expect(badge.x).toBeGreaterThanOrEqual(box.x);
    expect(badge.x + badge.width).toBeLessThanOrEqual(box.x + box.width);
    expect(badge.y + badge.height).toBeLessThanOrEqual(box.y + box.height);
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("tooltip kursor juga memuat penanda, dan keduanya menyebut status yang sama", async ({
  browser,
}) => {
  const customer = picked[2];
  const { context, page, errors } = await contextFor(browser, cookies);
  const { map } = await focusOn(page, customer.id);
  const view = (await map.locator(".leaflet-container").boundingBox())!;
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await expect(map.locator(".leaflet-tooltip")).toHaveCount(2);
  await expect(map.getByTestId("billing-badge")).toHaveCount(2);
  const statuses = await map
    .getByTestId("billing-badge")
    .evaluateAll((marks) => marks.map((mark) => mark.textContent));
  expect(statuses).toEqual([
    billingBadge(customer.billingStatus).label,
    billingBadge(customer.billingStatus).label,
  ]);
  expect(errors).toEqual([]);
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`penanda di kotak putih tooltip terbaca jelas di tema ${scheme}`, async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      colorScheme: scheme,
    });
    const problems: string[] = [];
    for (const customer of [picked[0], picked[2]]) {
      const { ring } = await focusOn(page, customer.id);
      // Kotak tooltip Leaflet putih di kedua tema; itulah alasan penanda di sini
      // tidak boleh memakai warna token tema.
      expect(
        await ring.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe("rgb(255, 255, 255)");
      const results = await measureContrast(
        page,
        ".leaflet-tooltip [data-testid=billing-badge]",
      );
      expect(results.length).toBeGreaterThan(0);
      for (const { text, ratio } of results) {
        if (ratio < 4.5) {
          problems.push(`${customer.id} "${text}": ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("di layar sempit tooltip beserta penandanya muat di dalam peta, dan halaman tidak melebar", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies, {
    viewport: { width: 390, height: 844 },
  });
  for (const customer of [picked[0], picked[4]]) {
    const { map, ring } = await focusOn(page, customer.id);
    const view = (await map.locator(".leaflet-container").boundingBox())!;
    const tooltip = (await ring.boundingBox())!;
    expect(tooltip.x).toBeGreaterThanOrEqual(view.x);
    expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(view.x + view.width);
    expect(tooltip.y).toBeGreaterThanOrEqual(view.y);
    await expect(ring.getByTestId("billing-badge")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  }
  expect(errors).toEqual([]);
  await context.close();
});
