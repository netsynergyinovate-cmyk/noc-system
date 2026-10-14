import { expect, test, type Page } from "@playwright/test";
import {
  billingMatchLabels,
  describeSyncResult,
  mockBillingOverview,
  summarizeBilling,
  summarizeSync,
} from "../src/lib/dashboard/billing";
import {
  billingFacetCounts,
  defaultBillingFilters,
  filterBillingRows,
  type BillingFilters,
} from "../src/lib/dashboard/billing-filter";
import {
  formatElapsed,
  formatInteger,
  isoDuration,
} from "../src/lib/dashboard/format";
import { findBillingMoments } from "./billing-moments";
import {
  contextFor,
  firstDifference,
  isoTime,
  jakartaTime,
  openBillingAt,
  readCustomerRows,
  signUp,
  type Cookies,
} from "./billing-ui";

// Halaman Billing dengan data tiruan: keadaan sinkron, ringkasan, tabel status
// tagihan beserta saringannya, tagihan yang belum cocok, dan riwayat sinkron.
// Jam browser dikunci pada detik yang dipilih dari data tiruannya sendiri,
// supaya isi layar bisa dibandingkan persis dengan datanya.

const moments = findBillingMoments();
const n = formatInteger;

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Billing");
  await context.close();
});

const customerRows = (page: Page) => page.getByTestId("billing-row");

test("halaman billing butuh login", async ({ page }) => {
  await page.goto("/app/billing");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fbilling$/);
  await expect(page.getByTestId("billing-sync")).toHaveCount(0);
});

test("menu Billing ada di antara Pelanggan dan OLT, membuka halaman yang benar, dan pemberitahuan data tiruan menyebut sistem billing", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await page.clock.install({ time: moments.ok * 1000 });
  await page.clock.setFixedTime(moments.ok * 1000);
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();

  const menu = page.getByRole("navigation", { name: "Menu utama" });
  const labels = await menu
    .locator("li")
    .evaluateAll((items) => items.map((item) => item.textContent ?? ""));
  const at = (name: string) =>
    labels.findIndex((label) => label.startsWith(name));
  expect(at("Billing")).toBe(at("Pelanggan") + 1);
  expect(at("OLT & Optik")).toBe(at("Billing") + 1);

  await menu.getByRole("link", { name: "Billing" }).click();
  await expect(page).toHaveURL("/app/billing");
  await expect(
    page.getByRole("heading", { name: "Status Billing", level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Status Billing/);
  await expect(menu.locator("[aria-current=page]")).toHaveAccessibleName(
    "Billing",
  );
  await expect(
    page.getByText("Data tiruan, belum terhubung ke sistem billing"),
  ).toBeVisible();
  await expect(page.getByTestId("billing-sync")).toBeVisible();

  // Halaman lain tetap menyebut sumbernya sendiri.
  await menu.getByRole("link", { name: "Deteksi Anomali" }).click();
  await expect(page).toHaveURL("/app/anomali");
  await expect(
    page.getByText("Data tiruan, belum terhubung ke router atau OLT"),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("sinkron terakhir berhasil: waktu sampai detik, lama dan hitung mundur, dan hasilnya", async ({
  browser,
}) => {
  const now = moments.ok;
  const data = mockBillingOverview(now);
  const { last, lastSuccess } = summarizeSync(data.sync.runs);
  expect(last!.status).toBe("success");
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);

  const card = page.getByTestId("billing-sync");
  await expect(card).toHaveAttribute("data-last-status", "success");
  await expect(card).toHaveAttribute("data-running", "false");
  await expect(card).toHaveAttribute("data-failures", "0");
  await expect(page.getByTestId("billing-headline")).toHaveText(
    "Sinkron terakhir berhasil",
  );
  await expect(page.getByTestId("billing-headline")).toHaveAttribute(
    "data-tone",
    "success",
  );
  await expect(card.getByText("Berjalan otomatis tiap jam")).toBeVisible();
  await expect(page.getByTestId("billing-error")).toHaveCount(0);
  await expect(page.getByTestId("billing-spinner")).toHaveCount(0);

  // Sinkron terakhir: waktu sampai detik, hasilnya, dan sudah berapa lama.
  const lastAt = page.getByTestId("billing-last-at");
  await expect(lastAt).toHaveText(jakartaTime(last!.finishedAt, now));
  await expect(lastAt).toHaveAttribute("datetime", isoTime(last!.finishedAt));
  await expect(page.getByTestId("billing-last-outcome")).toHaveText(
    "(berhasil)",
  );
  const age = now - last!.finishedAt;
  await expect(page.getByTestId("billing-last-age")).toHaveText(
    `${formatElapsed(age)} lalu`,
  );
  await expect(page.getByTestId("billing-last-age")).toHaveAttribute(
    "datetime",
    isoDuration(age),
  );
  // Cukup lama supaya yang ditulis menit dan detik, bukan hanya detik.
  expect(age).toBeGreaterThanOrEqual(600);

  // Sinkron berikutnya: tepat satu jam setelah mulainya yang terakhir.
  await expect(page.getByTestId("billing-next-at")).toHaveText(
    jakartaTime(data.sync.nextRunAt, now),
  );
  expect(data.sync.nextRunAt - last!.startedAt).toBe(3_600);
  const remaining = data.sync.nextRunAt - now;
  await expect(page.getByTestId("billing-countdown")).toHaveText(
    `dalam ${formatElapsed(remaining)}`,
  );
  await expect(page.getByTestId("billing-countdown")).toHaveAttribute(
    "data-due",
    "false",
  );
  await expect(page.getByTestId("billing-countdown")).toHaveAttribute(
    "datetime",
    isoDuration(remaining),
  );

  // Data tagihan berasal dari sinkron yang sama.
  await expect(page.getByTestId("billing-data-at")).toHaveText(
    jakartaTime(lastSuccess!.finishedAt, now),
  );
  await expect(page.getByTestId("billing-data-age")).toHaveText(
    `${formatElapsed(age)} lalu`,
  );
  await expect(page.getByTestId("billing-result")).toHaveText(
    describeSyncResult(lastSuccess!.result!),
  );
  await expect(page.getByTestId("billing-result")).toHaveText(
    `${n(lastSuccess!.result!.invoices)} tagihan terbaca, ${n(lastSuccess!.result!.matched)} cocok, ${n(lastSuccess!.result!.unmatched)} belum cocok`,
  );
  await expect(page.getByTestId("billing-result-without")).toHaveText(
    `${n(lastSuccess!.result!.withoutInvoice)} pelanggan tanpa tagihan`,
  );
  expect(errors).toEqual([]);
  await context.close();
});

test("sinkron terakhir gagal sekali: alasannya tertulis, dan data tagihan menyebut sinkron berhasil sebelumnya", async ({
  browser,
}) => {
  const now = moments.single;
  const data = mockBillingOverview(now);
  const { last, lastSuccess, consecutiveFailures } = summarizeSync(
    data.sync.runs,
  );
  expect(consecutiveFailures).toBe(1);
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);

  const card = page.getByTestId("billing-sync");
  await expect(card).toHaveAttribute("data-last-status", "failed");
  await expect(card).toHaveAttribute("data-failures", "1");
  await expect(page.getByTestId("billing-headline")).toHaveText(
    "Sinkron terakhir gagal",
  );
  await expect(page.getByTestId("billing-headline")).toHaveAttribute(
    "data-tone",
    "warning",
  );
  const error = page.getByTestId("billing-error");
  await expect(error).toHaveAttribute("data-tone", "warning");
  await expect(error).toContainText(last!.error!);
  await expect(error).toContainText(
    "Tabel di bawah masih memakai hasil sinkron berhasil terakhir",
  );
  await expect(page.getByTestId("billing-last-outcome")).toHaveText("(gagal)");
  await expect(page.getByTestId("billing-last-at")).toHaveText(
    jakartaTime(last!.finishedAt, now),
  );

  // Data tagihan masih dari sinkron berhasil sebelumnya, dan umurnya terbaca.
  await expect(page.getByTestId("billing-data-at")).toHaveText(
    jakartaTime(lastSuccess!.finishedAt, now),
  );
  const dataAge = now - lastSuccess!.finishedAt;
  expect(dataAge).toBeGreaterThan(3_600);
  await expect(page.getByTestId("billing-data-age")).toHaveText(
    `${formatElapsed(dataAge)} lalu`,
  );
  await expect(page.getByTestId("billing-result")).toHaveText(
    describeSyncResult(lastSuccess!.result!),
  );
  // Tabel tetap terisi penuh.
  await expect(customerRows(page)).toHaveCount(data.rows.length);
  // Sinkron berikutnya tetap dijadwalkan.
  await expect(page.getByTestId("billing-next-at")).toHaveText(
    jakartaTime(data.sync.nextRunAt, now),
  );
  expect(errors).toEqual([]);
  await context.close();
});

for (const kind of ["double", "triple"] as const) {
  test(`gagal beruntun (${kind}): jumlahnya tertulis dan peringatannya lebih keras`, async ({
    browser,
  }) => {
    const now = moments[kind];
    const data = mockBillingOverview(now);
    const { last, lastSuccess, consecutiveFailures } = summarizeSync(
      data.sync.runs,
    );
    expect(consecutiveFailures).toBeGreaterThanOrEqual(2);
    const { context, page, errors } = await contextFor(browser, cookies);
    await openBillingAt(page, now);

    await expect(page.getByTestId("billing-sync")).toHaveAttribute(
      "data-failures",
      String(consecutiveFailures),
    );
    await expect(page.getByTestId("billing-headline")).toHaveText(
      `Gagal ${consecutiveFailures} kali berturut-turut`,
    );
    await expect(page.getByTestId("billing-headline")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    await expect(page.getByTestId("billing-error")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    await expect(page.getByTestId("billing-error")).toContainText(last!.error!);
    // Data tagihan makin tua: lebih dari dua jam.
    const dataAge = now - lastSuccess!.finishedAt;
    expect(dataAge).toBeGreaterThan(2 * 3_600);
    await expect(page.getByTestId("billing-data-age")).toHaveText(
      `${formatElapsed(dataAge)} lalu`,
    );
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const kind of ["running", "runningAfterFail"] as const) {
  test(`sedang menyinkron (${kind}): mulainya, lamanya berjalan, dan hasil sebelumnya tetap terbaca`, async ({
    browser,
  }) => {
    const now = moments[kind];
    const data = mockBillingOverview(now);
    const startedAt = data.sync.running!.startedAt;
    const { last, lastSuccess } = summarizeSync(data.sync.runs);
    const { context, page, errors } = await contextFor(browser, cookies);
    await openBillingAt(page, now);

    const card = page.getByTestId("billing-sync");
    await expect(card).toHaveAttribute("data-running", "true");
    await expect(card).toHaveAttribute("data-last-status", last!.status);
    await expect(page.getByTestId("billing-headline")).toHaveText(
      "Sedang menyinkron",
    );
    await expect(page.getByTestId("billing-spinner")).toBeVisible();
    await expect(page.getByTestId("billing-running-since")).toHaveText(
      jakartaTime(startedAt, now),
    );
    await expect(page.getByTestId("billing-running-for")).toHaveText(
      `sudah ${formatElapsed(now - startedAt)}`,
    );
    // Yang berikutnya adalah yang sedang berjalan ini.
    await expect(page.getByTestId("billing-next-running")).toHaveText(
      "Sedang berjalan",
    );
    await expect(page.getByTestId("billing-next-at")).toHaveCount(0);
    await expect(page.getByTestId("billing-countdown")).toHaveCount(0);
    // Sinkron yang terakhir selesai tetap tertulis, begitu juga datanya.
    await expect(page.getByTestId("billing-last-at")).toHaveText(
      jakartaTime(last!.finishedAt, now),
    );
    await expect(page.getByTestId("billing-data-at")).toHaveText(
      jakartaTime(lastSuccess!.finishedAt, now),
    );
    if (last!.status === "failed") {
      await expect(page.getByTestId("billing-error")).toContainText(
        last!.error!,
      );
    } else {
      await expect(page.getByTestId("billing-error")).toHaveCount(0);
    }
    // Sinkron yang belum selesai belum masuk riwayat.
    const ids = await page
      .getByTestId("billing-run-row")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-run-id")),
      );
    expect(ids).toEqual(data.sync.runs.map((run) => run.id));
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("pemutar sinkron berhenti bila pengguna meminta gerak dikurangi", async ({
  browser,
}) => {
  const { context, page } = await contextFor(browser, cookies, {
    reducedMotion: "reduce",
  });
  await openBillingAt(page, moments.running);
  const animation = await page
    .getByTestId("billing-spinner")
    .evaluate((icon) => getComputedStyle(icon).animationName);
  expect(animation).toBe("none");
  await context.close();

  const normal = await contextFor(browser, cookies, {
    reducedMotion: "no-preference",
  });
  await openBillingAt(normal.page, moments.running);
  const spinning = await normal.page
    .getByTestId("billing-spinner")
    .evaluate((icon) => getComputedStyle(icon).animationName);
  expect(spinning).not.toBe("none");
  await normal.context.close();
});

test("empat angka ringkasan sama dengan isi tabel, dengan kata, bukan hanya warna", async ({
  browser,
}) => {
  const now = moments.ok;
  const data = mockBillingOverview(now);
  const totals = summarizeBilling(data.rows, data.unmatched);
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);

  const tiles = page.getByTestId("billing-tile");
  await expect(tiles).toHaveCount(4);
  const kinds = await tiles.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-kind")),
  );
  expect(kinds).toEqual(["lunas", "isolir", "unmatched", "without-invoice"]);
  const percent = (count: number) =>
    `${Math.round((100 * count) / totals.customers)}% dari ${n(totals.customers)} pelanggan`;
  const expected = [
    ["Lunas", totals.lunas, percent(totals.lunas)],
    ["Isolir", totals.isolir, percent(totals.isolir)],
    [
      "Tagihan belum cocok",
      totals.unmatchedInvoices,
      "Tagihan yang tidak bisa dipasangkan dengan pelanggan",
    ],
    [
      "Tanpa tagihan",
      totals.withoutInvoice,
      "Pelanggan yang statusnya belum diperbarui dari billing",
    ],
  ] as const;
  for (const [index, [label, value, hint]] of expected.entries()) {
    const tile = tiles.nth(index);
    await expect(tile).toHaveAttribute("data-value", String(value));
    await expect(tile.getByText(label, { exact: true })).toBeVisible();
    await expect(tile.getByText(n(value), { exact: true })).toBeVisible();
    await expect(tile.getByText(hint, { exact: true })).toBeVisible();
  }
  // Angkanya sama dengan baris yang tampil di tabel.
  await expect(
    page.locator("[data-testid=billing-row][data-status=lunas]"),
  ).toHaveCount(totals.lunas);
  await expect(
    page.locator("[data-testid=billing-row][data-status=isolir]"),
  ).toHaveCount(totals.isolir);
  await expect(
    page.locator("[data-testid=billing-row][data-match=none]"),
  ).toHaveCount(totals.withoutInvoice);
  // Daftar ketidakcocokan memuat kedua sisi: tiap tagihan yang belum cocok dan
  // tiap pelanggan tanpa tagihan tepat satu kali (sepasang yang kemungkinan satu
  // masalah ada di satu baris, jadi dihitung di kedua sisi).
  await expect(
    page.locator("[data-testid=billing-mismatch-row]:not([data-invoice=''])"),
  ).toHaveCount(totals.unmatchedInvoices);
  await expect(
    page.locator(
      "[data-testid=billing-mismatch-row][data-kind=pair], [data-testid=billing-mismatch-row][data-kind=customer-without-invoice]",
    ),
  ).toHaveCount(totals.withoutInvoice);
  expect(totals.lunas + totals.isolir).toBe(100);
  expect(errors).toEqual([]);
  await context.close();
});

test("tabel memuat satu baris untuk tiap pelanggan, urut nama, dengan isi sama dengan datanya", async ({
  browser,
}) => {
  const now = moments.ok;
  const data = mockBillingOverview(now);
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);

  const customers = page.getByTestId("billing-customers");
  await expect(customers).toHaveAttribute("data-total", "100");
  await expect(customers).toHaveAttribute("data-visible", "100");
  await expect(
    customers.getByText("100 pelanggan", { exact: true }),
  ).toBeVisible();
  await expect(customerRows(page)).toHaveCount(100);

  const expected = data.rows.map((row) => ({
    id: row.customerId,
    status: row.status,
    match: row.match,
    name: row.name,
    pppoe: row.pppoeUsername,
    router: row.routerName,
    badge: row.status === "lunas" ? "Lunas" : "Isolir",
    invoice: row.invoiceRef ?? "—",
    label: billingMatchLabels[row.match],
    note:
      row.match === "normalized"
        ? `Di billing: “${row.billingName}”`
        : row.match === "none"
          ? "Status belum diperbarui dari billing"
          : null,
  }));
  expect(
    firstDifference(await readCustomerRows(customerRows(page)), expected),
  ).toBeNull();
  // Ketiga cara cocok benar-benar tampil, supaya pengujian ini bermakna.
  const seen = new Set(expected.map((row) => row.match));
  expect([...seen].sort()).toEqual(["exact", "none", "normalized"]);

  // Nama di billing ditulis apa adanya, termasuk spasi di ujungnya.
  const normalized = data.rows.filter((row) => row.match === "normalized");
  const written = await page
    .getByTestId("billing-name")
    .evaluateAll((items) => items.map((item) => item.textContent));
  expect(written).toEqual(normalized.map((row) => `“${row.billingName}”`));
  expect(
    normalized.some((row) => row.billingName !== row.billingName!.trim()),
  ).toBe(true);

  // Bisa dijangkau papan ketik, dan punya nama untuk pembaca layar.
  const region = page.getByRole("region", {
    name: "Daftar status billing pelanggan",
  });
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.focus();
  await expect(region).toBeFocused();
  await expect(region.locator("caption")).toContainText(
    "Status tagihan tiap pelanggan",
  );
  const headers = await region
    .locator("th")
    .evaluateAll((items) => items.map((item) => item.textContent));
  expect(headers).toEqual([
    "Pelanggan",
    "Router",
    "Status tagihan",
    "Kode tagihan",
    "Pencocokan",
  ]);
  // Penjelasan ketiga cara cocok ada di bawah tabel.
  for (const label of Object.values(billingMatchLabels)) {
    await expect(
      customers.locator("li", { hasText: `${label}:` }).first(),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("status tiap pelanggan di sini sama dengan di halaman Pelanggan", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, moments.ok);
  await expect(customerRows(page)).toHaveCount(100);
  const billing = new Map(
    (await readCustomerRows(customerRows(page))).map((row) => [
      row.pppoe,
      row.badge,
    ]),
  );
  expect(billing.size).toBe(100);

  await page
    .getByRole("navigation", { name: "Menu utama" })
    .getByRole("link", { name: "Pelanggan" })
    .click();
  await expect(page).toHaveURL("/app/pelanggan");
  const customersTable = page.getByRole("region", {
    name: "Daftar status pelanggan",
  });
  await expect(customersTable.locator("tbody tr")).toHaveCount(100);
  const other = await customersTable
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) => [
        row.children[0].children[1].textContent,
        row.children[4].textContent,
      ]),
    );
  expect(other).toHaveLength(100);
  const different = other.filter(
    ([pppoe, badge]) => billing.get(pppoe) !== badge,
  );
  expect(different).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

test("pencarian dan saringan: hasilnya, angka di tiap pilihan, tombol reset, dan keadaan kosong", async ({
  browser,
}) => {
  const now = moments.ok;
  const data = mockBillingOverview(now);
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  const search = page.locator("#billing-search");
  const status = page.locator("#billing-status");
  const match = page.locator("#billing-match");
  const router = page.locator("#billing-router");
  const reset = page.getByRole("button", { name: "Reset filter" });
  const description = page
    .getByTestId("billing-customers")
    .locator("[data-slot=card-description]");
  const routers = [
    ...new Map(data.rows.map((row) => [row.routerId, row.routerName])),
  ]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id", { numeric: true }));

  // Tulisan tiap pilihan beserta angkanya, seperti di data.
  async function expectOptions(filters: BillingFilters) {
    const counts = billingFacetCounts(data.rows, filters);
    expect(await status.locator("option").allTextContents()).toEqual([
      `Semua status (${n(counts.status.lunas + counts.status.isolir)})`,
      `Lunas (${n(counts.status.lunas)})`,
      `Isolir (${n(counts.status.isolir)})`,
    ]);
    expect(await match.locator("option").allTextContents()).toEqual([
      `Semua (${n(counts.match.exact + counts.match.normalized + counts.match.none)})`,
      `Cocok (${n(counts.match.exact)})`,
      `Cocok setelah dirapikan (${n(counts.match.normalized)})`,
      `Belum ada tagihan (${n(counts.match.none)})`,
    ]);
    expect(await router.locator("option").allTextContents()).toEqual([
      `Semua router (${n(routers.reduce((sum, r) => sum + counts.router[r.id], 0))})`,
      ...routers.map((r) => `${r.name} (${n(counts.router[r.id])})`),
    ]);
  }

  async function expectShown(filters: BillingFilters) {
    const want = filterBillingRows(data.rows, filters);
    await expect(customerRows(page)).toHaveCount(want.length);
    const got = await customerRows(page).evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-customer-id")),
    );
    expect(got).toEqual(want.map((row) => row.customerId));
    await expect(description).toHaveText(
      want.length === data.rows.length
        ? `${n(data.rows.length)} pelanggan`
        : `Menampilkan ${n(want.length)} dari ${n(data.rows.length)} pelanggan`,
    );
    await expectOptions(filters);
  }

  // Awalnya tanpa saringan: semua baris, reset mati.
  await expectShown(defaultBillingFilters);
  await expect(reset).toBeDisabled();

  // Kata kunci.
  let filters: BillingFilters = { ...defaultBillingFilters, query: "agus" };
  await search.fill("agus");
  await expectShown(filters);
  await expect(reset).toBeEnabled();
  expect(filterBillingRows(data.rows, filters).length).toBeGreaterThan(2);

  // Nama di billing yang ditulis lain tetap bisa dicari lewat huruf kecil.
  const respelled = data.rows.find((row) => row.match === "normalized")!;
  filters = {
    ...defaultBillingFilters,
    query: respelled.billingName!.trim().toUpperCase(),
  };
  await search.fill(filters.query);
  await expectShown(filters);
  expect(
    await customerRows(page).evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-customer-id")),
    ),
  ).toContain(respelled.customerId);

  // Beberapa kata, urutannya bebas.
  const target = data.rows.find((row) => row.name.includes(" "))!;
  const [first, second] = target.name.toLowerCase().split(" ");
  filters = { ...defaultBillingFilters, query: `${second}   ${first}` };
  await search.fill(filters.query);
  await expectShown(filters);

  // Status, lalu pencocokan, lalu router, bertumpuk dengan kata kunci.
  await search.fill("");
  await status.selectOption("isolir");
  filters = { ...defaultBillingFilters, status: "isolir" };
  await expectShown(filters);
  await expect(customerRows(page).first()).toHaveAttribute(
    "data-status",
    "isolir",
  );

  await match.selectOption("exact");
  filters = { ...filters, match: "exact" };
  await expectShown(filters);

  await router.selectOption(routers[1].id);
  filters = { ...filters, routerId: routers[1].id };
  await expectShown(filters);

  await search.fill("a");
  filters = { ...filters, query: "a" };
  await expectShown(filters);

  // Enter di kolom cari tidak memuat ulang halaman dan tidak mengosongkannya.
  const url = page.url();
  await search.press("Enter");
  expect(page.url()).toBe(url);
  await expect(search).toHaveValue("a");
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);

  // Saringan bertahan ketika data dimuat ulang berkala (tiap 30 detik).
  await page.clock.runFor(31_000);
  await expectShown(filters);
  await expect(search).toHaveValue("a");
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);

  // Tidak ada yang cocok: ada penjelasan dan jalan keluar.
  await search.fill("zzzz-tidak-ada");
  await expect(page.getByTestId("billing-no-match")).toContainText(
    "Tidak ada pelanggan yang cocok dengan filter.",
  );
  await expect(customerRows(page)).toHaveCount(0);
  await expect(description).toHaveText(
    `Menampilkan 0 dari ${n(data.rows.length)} pelanggan`,
  );
  await page.getByRole("button", { name: "Tampilkan semua pelanggan" }).click();
  await expectShown(defaultBillingFilters);
  await expect(search).toHaveValue("");
  await expect(status).toHaveValue("all");
  await expect(match).toHaveValue("all");
  await expect(router).toHaveValue("all");
  await expect(reset).toBeDisabled();

  // Reset filter mengembalikan semuanya sekaligus.
  await status.selectOption("lunas");
  await match.selectOption("none");
  await search.fill("a");
  await reset.click();
  await expectShown(defaultBillingFilters);
  await expect(search).toHaveValue("");
  expect(errors).toEqual([]);
  await context.close();
});

test("riwayat sinkron: 24 sinkron terakhir, terbaru di atas, dengan waktu, lama, hasil, dan keterangannya", async ({
  browser,
}) => {
  const now = moments.double;
  const data = mockBillingOverview(now);
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, now);

  const history = page.getByTestId("billing-history");
  await expect(history).toHaveAttribute("data-count", "24");
  await expect(
    history.getByText(
      "24 sinkron terakhir, terbaru di atas. Jadwalnya tiap jam.",
    ),
  ).toBeVisible();
  const rows = page.getByTestId("billing-run-row");
  await expect(rows).toHaveCount(24);
  const got = await rows.evaluateAll((items) =>
    items.map((row) => ({
      id: row.getAttribute("data-run-id"),
      outcome: row.getAttribute("data-outcome"),
      started: row.querySelector("[data-testid=billing-run-started]")!
        .textContent,
      startedAt: row
        .querySelector("[data-testid=billing-run-started]")!
        .getAttribute("datetime"),
      lasted: row.querySelector("[data-testid=billing-run-lasted]")!
        .textContent,
      result: row.children[2].textContent,
      note: row.querySelector("[data-testid=billing-run-note]")!.textContent,
    })),
  );
  const expected = data.sync.runs.map((run) => ({
    id: run.id,
    outcome: run.status,
    started: jakartaTime(run.startedAt, now),
    startedAt: isoTime(run.startedAt),
    lasted: formatElapsed(run.finishedAt - run.startedAt),
    result: run.status === "success" ? "Berhasil" : "Gagal",
    note:
      run.status === "success"
        ? `${describeSyncResult(run.result!)}; ${n(run.result!.withoutInvoice)} pelanggan tanpa tagihan`
        : run.error,
  }));
  expect(firstDifference(got, expected)).toBeNull();
  // Yang terbaru di atas, berjarak satu jam, dan memuat berhasil serta gagal.
  expect(got.map((row) => row.outcome)).toContain("success");
  expect(got.map((row) => row.outcome)).toContain("failed");
  // Karena 24 jam melewati tengah malam, yang lebih lama ditulis dengan tanggal.
  expect(
    got.some((row) => /^\d{1,2} \w+, \d\d\.\d\d\.\d\d$/.test(row.started!)),
  ).toBe(true);
  // Baris pertama adalah sinkron terakhir yang tertulis di kartu.
  const { last } = summarizeSync(data.sync.runs);
  expect(got[0].id).toBe(last!.id);
  await expect(page.getByTestId("billing-last-at")).toHaveText(
    jakartaTime(last!.finishedAt, now),
  );
  const region = page.getByRole("region", { name: "Riwayat sinkron billing" });
  await expect(region).toHaveAttribute("tabindex", "0");
  expect(errors).toEqual([]);
  await context.close();
});
