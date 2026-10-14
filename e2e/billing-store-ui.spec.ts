import { expect, test, type Page } from "@playwright/test";
import { mockBillingStatusAt } from "../src/lib/dashboard/billing";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";
import { contextFor, openBillingAt, signUp, type Cookies } from "./billing-ui";
import { BILLING_START, changingRuns, nextSyncRun } from "./billing-moments";

// Status tagihan yang berubah lewat store: begitu sinkron billing yang berhasil
// selesai, lencana di tabel Pelanggan dan baris serta angka di halaman Billing
// berganti pada detik yang sama, tanpa memuat ulang dan tanpa menunggu
// penyegaran berkala. Jam browser dipasang palsu pada detik sinkron selesai.

const customers = createMockCustomers();
const byId = new Map(customers.map((customer) => [customer.id, customer]));
// Status yang berlaku pada detik `now`, dari data tiruannya (ditulis lain dari
// kode halaman), per id pelanggan dan per username PPPoE.
const expectedById = (now: number) =>
  Object.fromEntries(
    customers.map((customer) => [
      customer.id,
      mockBillingStatusAt(customer.id, now)!,
    ]),
  );
const expectedByUsername = (now: number) =>
  Object.fromEntries(
    customers.map((customer) => [
      customer.pppoeUsername,
      mockBillingStatusAt(customer.id, now)!,
    ]),
  );

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Status Billing");
  await context.close();
});

async function openAt(page: Page, path: string, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto(path);
}

// Satu detik berlalu pada jam yang dipindah: detak umpan data tiba sekali.
async function moveTo(page: Page, seconds: number) {
  await page.clock.setFixedTime(seconds * 1000);
  await page.clock.runFor(1_100);
}

// Status tagihan tiap pelanggan di tabel Pelanggan, menurut username PPPoE.
function pelangganStatuses(page: Page) {
  return page.getByRole("row").evaluateAll((rows) =>
    Object.fromEntries(
      rows.flatMap((row) => {
        const user = row.querySelector(".font-mono")?.textContent?.trim();
        const badge = row.querySelector("[data-testid=billing-badge]");
        return user && badge ? [[user, badge.getAttribute("data-status")]] : [];
      }),
    ),
  );
}

// Status tiap baris di halaman Billing, menurut id pelanggan.
function billingStatuses(page: Page) {
  return page
    .getByTestId("billing-row")
    .evaluateAll((rows) =>
      Object.fromEntries(
        rows.map((row) => [
          row.getAttribute("data-customer-id"),
          row.getAttribute("data-status"),
        ]),
      ),
    );
}

const tile = (page: Page, kind: string) =>
  page.locator(`[data-testid=billing-tile][data-kind=${kind}]`);

// Daftar yang beda antara dua peta status, untuk menyebut yang tidak cocok.
function differences(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
) {
  return Object.keys(expected)
    .filter((key) => actual[key] !== expected[key])
    .slice(0, 5)
    .map(
      (key) =>
        `${key}: ${String(actual[key])} berbanding ${String(expected[key])}`,
    );
}

test("lencana di tabel Pelanggan berganti tepat pada detik sinkron berhasil selesai", async ({
  browser,
}) => {
  const [run] = changingRuns(1);
  const before = run.finishedAt - 1;
  const { context, page, errors } = await contextFor(browser, cookies);
  await openAt(page, "/app/pelanggan", before);
  await expect(page.getByTestId("billing-badge").first()).toBeVisible();
  // Tepat sesudah dimuat, gambar pertama masih memakai status awal sampai snapshot
  // pertama tiba; tunggu sampai yang berlaku.
  await expect
    .poll(async () =>
      differences(await pelangganStatuses(page), expectedByUsername(before)),
    )
    .toEqual([]);

  // Sedetik kemudian sinkron selesai: yang berubah berganti, yang lain tetap.
  await moveTo(page, run.finishedAt);
  const target = byId.get(run.changes[0].customerId)!;
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: target.pppoeUsername })
      .getByTestId("billing-badge"),
  ).toHaveAttribute("data-status", run.changes[0].to);
  const after = await pelangganStatuses(page);
  expect(differences(after, expectedByUsername(run.finishedAt))).toEqual([]);
  const flipped = customers.filter(
    (customer) =>
      after[customer.pppoeUsername] !==
      expectedByUsername(before)[customer.pppoeUsername],
  );
  expect(flipped.map((customer) => customer.id).sort()).toEqual(
    run.changes.map((change) => change.customerId).sort(),
  );
  expect(errors).toEqual([]);
  await context.close();
});

test("halaman Billing ikut pada detik yang sama: baris, dan angka lunas serta isolir yang berimbang", async ({
  browser,
}) => {
  const [run] = changingRuns(1);
  const before = run.finishedAt - 1;
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, before);
  await expect(page.getByTestId("billing-row")).toHaveCount(customers.length);
  await expect
    .poll(async () =>
      differences(await billingStatuses(page), expectedById(before)),
    )
    .toEqual([]);
  const lunasBefore = Number(
    await tile(page, "lunas").getAttribute("data-value"),
  );
  const isolirBefore = Number(
    await tile(page, "isolir").getAttribute("data-value"),
  );

  await moveTo(page, run.finishedAt);
  // Tenggang pendek: halaman ini juga menarik datanya sendiri, tetapi yang
  // berikutnya baru lima detik lagi. Perubahan di sini harus datang dari store,
  // bukan dari penarikan itu.
  const soon = { timeout: 1_000 };
  await expect(
    page.locator(
      `[data-testid=billing-row][data-customer-id="${run.changes[0].customerId}"]`,
    ),
  ).toHaveAttribute("data-status", run.changes[0].to, soon);
  expect(
    differences(await billingStatuses(page), expectedById(run.finishedAt)),
  ).toEqual([]);

  // Angkanya bergeser sebesar perpindahan itu, dan jumlahnya tetap.
  const toLunas = run.changes.filter((change) => change.to === "lunas").length;
  const fromLunas = run.changes.filter(
    (change) => change.from === "lunas",
  ).length;
  const delta = toLunas - fromLunas;
  await expect(tile(page, "lunas")).toHaveAttribute(
    "data-value",
    String(lunasBefore + delta),
    soon,
  );
  await expect(tile(page, "isolir")).toHaveAttribute(
    "data-value",
    String(isolirBefore - delta),
    soon,
  );
  expect(errors).toEqual([]);
  await context.close();
});

test("berpindah halaman sesudah sinkron selesai tidak memuat ulang, dan statusnya sudah yang baru", async ({
  browser,
}) => {
  const [run] = changingRuns(1);
  const { context, page, errors } = await contextFor(browser, cookies);
  await openAt(page, "/app", run.finishedAt - 1);
  await expect(page.getByTestId("anomaly-badge")).toHaveAttribute(
    "data-count",
    /\d+/,
  );
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
  await moveTo(page, run.finishedAt);

  await page
    .getByRole("navigation", { name: "Menu utama" })
    .getByRole("link", { name: "Pelanggan", exact: true })
    .click();
  await expect(page).toHaveURL("/app/pelanggan");
  await expect(page.getByTestId("billing-badge").first()).toBeVisible();
  expect(
    differences(
      await pelangganStatuses(page),
      expectedByUsername(run.finishedAt),
    ),
  ).toEqual([]);
  // Lalu ke halaman Billing: sama, dan tanpa memuat ulang.
  await page
    .getByRole("navigation", { name: "Menu utama" })
    .getByRole("link", { name: "Billing", exact: true })
    .click();
  await expect(page).toHaveURL("/app/billing");
  await expect(page.getByTestId("billing-row")).toHaveCount(customers.length);
  expect(
    differences(await billingStatuses(page), expectedById(run.finishedAt)),
  ).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test("sinkron yang gagal tidak mengubah status siapa pun", async ({
  browser,
}) => {
  // Sinkron gagal pertama sesudah awal data.
  let cursor = BILLING_START;
  let failed = nextSyncRun(cursor);
  while (failed.status !== "failed") {
    cursor = failed.start;
    failed = nextSyncRun(cursor);
  }
  const before = failed.finishedAt - 1;
  const { context, page, errors } = await contextFor(browser, cookies);
  await openAt(page, "/app/pelanggan", before);
  await expect(page.getByTestId("billing-badge").first()).toBeVisible();
  await expect
    .poll(async () =>
      differences(await pelangganStatuses(page), expectedByUsername(before)),
    )
    .toEqual([]);
  const statuses = await pelangganStatuses(page);

  await moveTo(page, failed.finishedAt);
  await moveTo(page, failed.finishedAt + 5);
  expect(await pelangganStatuses(page)).toEqual(statuses);
  expect(
    differences(statuses, expectedByUsername(failed.finishedAt + 5)),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

test("lompatan waktu jauh (komputer tidur): statusnya dimuat ulang menurut sinkron berhasil terakhir", async ({
  browser,
}) => {
  const [run] = changingRuns(1);
  const start = run.finishedAt - 1;
  const jumped = start + 3 * 86_400 + 17 * 60;
  const wasAt = expectedByUsername(start);
  const willBe = expectedByUsername(jumped);
  // Lompatan itu memang mengubah sebagian status, jadi pengujian ini bermakna.
  expect(differences(willBe, wasAt).length).toBeGreaterThan(0);

  const { context, page, errors } = await contextFor(browser, cookies);
  await openAt(page, "/app/pelanggan", start);
  await expect(page.getByTestId("billing-badge").first()).toBeVisible();
  await moveTo(page, jumped);
  await expect
    .poll(async () => differences(await pelangganStatuses(page), willBe))
    .toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});
