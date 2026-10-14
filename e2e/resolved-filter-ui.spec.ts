import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  ALERT_HISTORY_PAGE_SIZE,
  mockResolvedAlerts,
  type ResolvedAlert,
} from "../src/lib/dashboard/alerts";
import { anomalyRules } from "../src/lib/dashboard/anomalies";
import { formatInteger } from "../src/lib/dashboard/format";
import {
  incidentLabels,
  incidentSeverityLabels,
} from "../src/lib/dashboard/incidents";
import {
  createMockCustomers,
  mockRouters,
} from "../src/lib/dashboard/mock-data";
import {
  defaultResolvedFilters,
  filterResolvedAlerts,
  resolvedFacetCounts,
  type ResolvedFilters,
  type SubjectDirectory,
} from "../src/lib/dashboard/resolved-filter";
import { paginate } from "../src/lib/dashboard/paging";
import { START } from "./alert-moments";

// Pencarian dan saringan pada tabel riwayat alert di halaman Alert. Jam browser
// dipasang pada awal menit supaya "selesai dalam 1 jam" dihitung dari detik yang
// sama dengan tes (komponen memakai awal menit sekarang).

const headers = { Origin: "http://localhost:3101" };
const PAGE = ALERT_HISTORY_PAGE_SIZE;
const MINUTE = Math.ceil(START / 60) * 60 + 6 * 86_400 + 600;
const customers = new Map(createMockCustomers().map((c) => [c.id, c]));
const routers = new Map(mockRouters.map((r) => [r.id, r]));
const routerIds = mockRouters.map((r) => r.id);
const directory: SubjectDirectory = {
  routerName: (id) => routers.get(id)?.name,
  customer: (id) => customers.get(id),
};
const n = formatInteger;

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function signUp(context: BrowserContext): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name: "Petugas Saringan Riwayat",
    email: `saring-riwayat-${randomUUID()}@example.com`,
    password: "A-long-test-password-123!",
  };
  let response = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data,
  });
  if (response.status() === 429) {
    const seconds = Number(response.headers()["retry-after"] || 10);
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 10).toBe(
      true,
    );
    await delay((seconds + 0.1) * 1000);
    response = await page.request.post("/api/auth/sign-up/email", {
      headers,
      data,
    });
  }
  expect(response.status()).toBe(200);
  return context.cookies();
}

async function contextFor(
  browser: Browser,
  cookies: Cookies,
  viewport?: { width: number; height: number },
) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
    timezoneId: "Asia/Jakarta",
    viewport,
  });
  await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}

async function openAt(page: Page, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto("/app/alert");
  await expect(page.getByTestId("resolved-alert-row").first()).toBeVisible();
}

async function moveTo(page: Page, seconds: number, runMs: number) {
  await page.clock.setFixedTime(seconds * 1000);
  await page.clock.runFor(runMs);
}

const rows = (page: Page) => page.getByTestId("resolved-alert-row");
const card = (page: Page) => page.getByTestId("resolved-alerts");
const search = (page: Page) => page.getByLabel("Cari alert");
const kindSelect = (page: Page) => page.getByLabel("Jenis", { exact: true });
const severitySelect = (page: Page) =>
  page.getByLabel("Tingkat", { exact: true });
const routerSelect = (page: Page) => page.getByLabel("Router", { exact: true });
const windowSelect = (page: Page) => page.getByLabel("Selesai dalam");
const reset = (page: Page) =>
  page.getByRole("button", { name: "Reset filter" });
const status = (page: Page) => page.getByTestId("resolved-page-status");

const ids = (page: Page) =>
  rows(page).evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-alert-id")!),
  );

// Yang seharusnya tampil pada halaman tertentu untuk saringan tertentu.
function expectedFor(
  all: ResolvedAlert[],
  filters: Partial<ResolvedFilters>,
  now: number,
  page = 1,
) {
  const visible = filterResolvedAlerts(
    all,
    { ...defaultResolvedFilters, ...filters },
    now,
    directory,
  );
  return { visible, shown: paginate(visible, page, PAGE) };
}

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context);
  await context.close();
});

test("mengetik di kolom cari menyaring riwayat, menulis jumlahnya, dan Reset memulihkannya", async ({
  browser,
}) => {
  const all = mockResolvedAlerts(MINUTE);
  const sample = all.find((a) => a.customerId !== null)!;
  const name = customers.get(sample.customerId!)!.name;
  const { visible, shown } = expectedFor(all, { query: name }, MINUTE);
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.length).toBeLessThan(all.length);

  const errors: string[] = [];
  const { context, page } = await contextFor(browser, cookies);
  page.on("pageerror", (error) => errors.push(error.message));
  await openAt(page, MINUTE);
  await expect(card(page)).toHaveAttribute("data-total", String(all.length));
  await expect(reset(page)).toBeDisabled();
  await expect(
    card(page).getByText(
      `${n(all.length)} alert selesai dalam 7 hari terakhir`,
    ),
  ).toBeVisible();

  await search(page).fill(name);
  await expect(card(page)).toHaveAttribute(
    "data-visible",
    String(visible.length),
  );
  await expect(
    card(page).getByText(
      `Menampilkan ${n(visible.length)} dari ${n(all.length)} alert selesai dalam 7 hari terakhir`,
    ),
  ).toBeVisible();
  expect(await ids(page)).toEqual(shown.items.map((a) => a.id));
  await expect(status(page)).toHaveText(
    new RegExp(
      `^Halaman 1 dari ${shown.pageCount}, alert 1–${shown.to} dari ${n(visible.length)}$`,
    ),
  );
  await expect(reset(page)).toBeEnabled();
  // Setiap baris yang tampil memuat nama itu (pelanggan atau di keterangannya).
  for (const text of await rows(page).allInnerTexts()) {
    expect(text.toLowerCase()).toContain(name.toLowerCase());
  }

  await reset(page).click();
  await expect(search(page)).toHaveValue("");
  await expect(card(page)).toHaveAttribute("data-visible", String(all.length));
  expect(await ids(page)).toEqual(all.slice(0, PAGE).map((a) => a.id));
  await expect(reset(page)).toBeDisabled();
  expect(errors).toEqual([]);
  await context.close();
});

test("pilihan jenis, tingkat, router, dan selesai dalam menyaring, dengan angka di tiap pilihan", async ({
  browser,
}) => {
  const all = mockResolvedAlerts(MINUTE);
  const { context, page } = await contextFor(browser, cookies);
  await openAt(page, MINUTE);

  // Tulisan pilihan: label dan angka dari hitungan saringan lain yang berlaku.
  const optionTexts = (selector: string) =>
    page.locator(`${selector} option`).allTextContents();
  const counts = resolvedFacetCounts(
    all,
    defaultResolvedFilters,
    MINUTE,
    directory,
    routerIds,
  );
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  expect(await optionTexts("#resolved-kind")).toEqual([
    `Semua jenis (${n(sum(anomalyRules.map((r) => counts.kind[r.kind])))})`,
    ...anomalyRules.map(
      (r) => `${incidentLabels[r.kind]} (${n(counts.kind[r.kind])})`,
    ),
  ]);
  expect(await optionTexts("#resolved-severity")).toEqual([
    `Semua tingkat (${n(counts.severity.critical + counts.severity.warning + counts.severity.info)})`,
    ...(["critical", "warning", "info"] as const).map(
      (s) => `${incidentSeverityLabels[s]} (${n(counts.severity[s])})`,
    ),
  ]);
  expect(await optionTexts("#resolved-window")).toEqual([
    `Semua, 7 hari (${n(counts.window.all)})`,
    `1 jam terakhir (${n(counts.window["1h"])})`,
    `6 jam terakhir (${n(counts.window["6h"])})`,
    `24 jam terakhir (${n(counts.window["24h"])})`,
  ]);

  // Memilih satu pilihan menghasilkan persis sebanyak angkanya.
  await kindSelect(page).selectOption("cpu");
  const cpu = expectedFor(all, { kind: "cpu" }, MINUTE);
  expect(cpu.visible.length).toBe(counts.kind.cpu);
  await expect(card(page)).toHaveAttribute(
    "data-visible",
    String(cpu.visible.length),
  );
  expect(await ids(page)).toEqual(cpu.shown.items.map((a) => a.id));

  // Saringan kedua: angka di pilihan lain ikut menyesuaikan, dan hasilnya irisan.
  await severitySelect(page).selectOption("critical");
  await routerSelect(page).selectOption(routerIds[0]);
  await windowSelect(page).selectOption("24h");
  const filters: Partial<ResolvedFilters> = {
    kind: "cpu",
    severity: "critical",
    routerId: routerIds[0],
    window: "24h",
  };
  const both = expectedFor(all, filters, MINUTE);
  await expect(card(page)).toHaveAttribute(
    "data-visible",
    String(both.visible.length),
  );
  expect(await ids(page)).toEqual(both.shown.items.map((a) => a.id));
  const after = resolvedFacetCounts(
    all,
    { ...defaultResolvedFilters, ...filters },
    MINUTE,
    directory,
    routerIds,
  );
  expect(await optionTexts("#resolved-router")).toEqual([
    `Semua router (${n(sum(routerIds.map((id) => after.router[id])))})`,
    ...mockRouters.map((r) => `${r.name} (${n(after.router[r.id])})`),
  ]);
  await expect(reset(page)).toBeEnabled();

  await reset(page).click();
  await expect(kindSelect(page)).toHaveValue("all");
  await expect(severitySelect(page)).toHaveValue("all");
  await expect(routerSelect(page)).toHaveValue("all");
  await expect(windowSelect(page)).toHaveValue("all");
  await expect(card(page)).toHaveAttribute("data-visible", String(all.length));
  await context.close();
});

test("tidak ada yang cocok: pesan jelas, tanpa tabel, dan tombol untuk menampilkan semuanya", async ({
  browser,
}) => {
  const all = mockResolvedAlerts(MINUTE);
  const { context, page } = await contextFor(browser, cookies);
  await openAt(page, MINUTE);
  await search(page).fill("zzzz-tidak-ada-yang-begini");
  await expect(card(page)).toHaveAttribute("data-visible", "0");
  const none = page.getByTestId("resolved-no-match");
  await expect(none).toBeVisible();
  await expect(none).toContainText(
    "Tidak ada alert selesai yang cocok dengan filter.",
  );
  await expect(rows(page)).toHaveCount(0);
  await expect(status(page)).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Riwayat alert selesai" }),
  ).toHaveCount(0);
  await expect(
    card(page).getByText(
      `Menampilkan 0 dari ${n(all.length)} alert selesai dalam 7 hari terakhir`,
    ),
  ).toBeVisible();
  // Kolom saringan tetap ada supaya bisa dikoreksi.
  await expect(search(page)).toBeVisible();

  await none
    .getByRole("button", { name: "Tampilkan semua alert selesai" })
    .click();
  await expect(search(page)).toHaveValue("");
  await expect(none).toHaveCount(0);
  await expect(rows(page)).toHaveCount(PAGE);
  await context.close();
});

test("mengubah saringan membawa kembali ke halaman pertama, dan halaman tunggal tidak punya halaman berikutnya", async ({
  browser,
}) => {
  const all = mockResolvedAlerts(MINUTE);
  const { context, page } = await contextFor(browser, cookies);
  await openAt(page, MINUTE);
  const next = page.getByRole("button", { name: "Berikutnya" });
  await next.click();
  await next.click();
  await expect(status(page)).toHaveText(/^Halaman 3 /);

  // Saringan yang hasilnya banyak: kembali ke halaman 1 dari yang baru.
  await kindSelect(page).selectOption("offline");
  const offline = expectedFor(all, { kind: "offline" }, MINUTE);
  expect(offline.shown.pageCount).toBeGreaterThan(1);
  await expect(status(page)).toHaveText(
    new RegExp(`^Halaman 1 dari ${offline.shown.pageCount}, `),
  );
  expect(await ids(page)).toEqual(offline.shown.items.map((a) => a.id));

  // Pindah ke halaman 2, lalu saringan yang hasilnya sedikit: satu halaman saja.
  await next.click();
  await expect(status(page)).toHaveText(/^Halaman 2 /);
  await windowSelect(page).selectOption("1h");
  const recent = expectedFor(all, { kind: "offline", window: "1h" }, MINUTE);
  expect(recent.shown.pageCount).toBe(1);
  await expect(card(page)).toHaveAttribute(
    "data-visible",
    String(recent.visible.length),
  );
  if (recent.visible.length > 0) {
    await expect(status(page)).toHaveText(/^Halaman 1 dari 1, /);
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByRole("button", { name: "Sebelumnya" }),
    ).toHaveAttribute("aria-disabled", "true");
  }
  await context.close();
});

test("saringan bertahan ketika alert baru selesai: yang cocok masuk di atas, yang tidak cocok tidak mengubah tabel", async ({
  browser,
}) => {
  // Alert yang selesai tepat pada detik tertentu, dan jenisnya.
  const probe = mockResolvedAlerts(MINUTE + 3 * 86_400).find(
    (alert) => mockResolvedAlerts(alert.endedAt)[0].id === alert.id,
  )!;
  const end = probe.endedAt;
  const other = anomalyRules.find((rule) => rule.kind !== probe.kind)!.kind;

  const { context, page } = await contextFor(browser, cookies);
  await openAt(page, end - 1);
  await kindSelect(page).selectOption(probe.kind);
  const before = expectedFor(
    mockResolvedAlerts(end - 1),
    { kind: probe.kind },
    Math.floor((end - 1) / 60) * 60,
  );
  expect(await ids(page)).toEqual(before.shown.items.map((a) => a.id));
  const total = mockResolvedAlerts(end - 1).length;
  await expect(card(page)).toHaveAttribute("data-total", String(total));

  // Alert itu selesai: cocok dengan saringan jenis, jadi tampil paling atas.
  await moveTo(page, end, 1_100);
  await expect(card(page)).toHaveAttribute(
    "data-total",
    String(mockResolvedAlerts(end).length),
  );
  await expect(rows(page).first()).toHaveAttribute("data-alert-id", probe.id);
  // Saringan tetap terpilih, dan jumlah yang tampil bertambah satu.
  await expect(kindSelect(page)).toHaveValue(probe.kind);
  const nowMinute = Math.floor(end / 60) * 60;
  const afterIds = expectedFor(
    mockResolvedAlerts(end),
    { kind: probe.kind },
    nowMinute,
  );
  await expect(card(page)).toHaveAttribute(
    "data-visible",
    String(afterIds.visible.length),
  );

  // Dengan saringan jenis lain, alert itu tidak tampil walau sudah di riwayat.
  await kindSelect(page).selectOption(other);
  const otherList = expectedFor(
    mockResolvedAlerts(end),
    { kind: other },
    nowMinute,
  );
  expect(otherList.visible.map((a) => a.id)).not.toContain(probe.id);
  expect(await ids(page)).toEqual(otherList.shown.items.map((a) => a.id));
  await context.close();
});

// Awal menit yang punya alert yang tepat keluar dari jendela 1 jam pada menit
// berikutnya: selesainya di antara 59 dan 60 menit sebelum awal menit itu.
function findMinuteWithLeaving() {
  for (let k = 0; k < 1_000; k += 1) {
    const minute = MINUTE + k * 60;
    const all = mockResolvedAlerts(minute);
    const leaving = all.filter(
      (a) => a.endedAt > minute - 3_600 && a.endedAt <= minute - 3_540,
    );
    if (leaving.length > 0) return { minute, all, leaving };
  }
  throw new Error("tidak ada menit dengan alert yang keluar dari jendela");
}

test("jendela selesai dalam ikut bergeser ketika menit berganti", async ({
  browser,
}) => {
  const { minute, all, leaving } = findMinuteWithLeaving();
  const { context, page } = await contextFor(browser, cookies);
  await openAt(page, minute);
  await windowSelect(page).selectOption("1h");
  const first = expectedFor(all, { window: "1h" }, minute);
  await expect(card(page)).toHaveAttribute(
    "data-visible",
    String(first.visible.length),
  );
  expect(first.visible.map((a) => a.id)).toContain(leaving[0].id);

  // Satu menit kemudian: awal menit baru, dan alert tadi sudah di luar.
  const later = minute + 60;
  await moveTo(page, later, 10_000);
  const second = expectedFor(
    mockResolvedAlerts(later),
    { window: "1h" },
    later,
  );
  expect(second.visible.map((a) => a.id)).not.toContain(leaving[0].id);
  await expect(card(page)).toHaveAttribute(
    "data-visible",
    String(second.visible.length),
  );
  expect(await ids(page)).toEqual(second.shown.items.map((a) => a.id));
  await context.close();
});

test("Enter di kolom cari tidak memuat ulang halaman, dan semua kolom punya label", async ({
  browser,
}) => {
  const { context, page } = await contextFor(browser, cookies);
  await openAt(page, MINUTE);
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
  await search(page).fill("offline");
  await search(page).press("Enter");
  await expect(page).toHaveURL(/\/app\/alert$/);
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
  await expect(search(page)).toHaveValue("offline");

  // Daerah pencarian bernama, dan setiap kontrol terhubung ke labelnya.
  await expect(
    page.getByRole("search", { name: "Cari dan saring riwayat alert" }),
  ).toBeVisible();
  for (const control of [
    search(page),
    kindSelect(page),
    severitySelect(page),
    routerSelect(page),
    windowSelect(page),
  ]) {
    await expect(control).toBeVisible();
  }
  // Urutan papan ketik: kolom cari, lalu keempat pilihan, lalu tombol reset.
  await search(page).focus();
  const order: string[] = [];
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(
        () =>
          (document.activeElement as HTMLElement).id ||
          (document.activeElement as HTMLElement).textContent!.trim(),
      ),
    );
  }
  expect(order).toEqual([
    "resolved-kind",
    "resolved-severity",
    "resolved-router",
    "resolved-window",
    "Reset filter",
  ]);
  await context.close();
});

test("di layar sempit semua kolom saringan terjangkau dan halaman tidak melebar", async ({
  browser,
}) => {
  const { context, page } = await contextFor(browser, cookies, {
    width: 390,
    height: 844,
  });
  await openAt(page, MINUTE);
  for (const control of [
    search(page),
    kindSelect(page),
    severitySelect(page),
    routerSelect(page),
    windowSelect(page),
    reset(page),
  ]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  // Mengetik tetap berfungsi di layar sempit.
  await search(page).fill("zzzz");
  await expect(page.getByTestId("resolved-no-match")).toBeVisible();
  await context.close();
});
