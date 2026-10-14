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
  describeLocation,
  mockActiveAlerts,
  mockResolvedAlerts,
  type ResolvedAlert,
} from "../src/lib/dashboard/alerts";
import { GRID } from "./alert-moments";
import { mapFocusHref } from "../src/lib/dashboard/map-focus";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";
import { paginate } from "../src/lib/dashboard/paging";

// Lokasi kejadian dan tombol sorot ke peta pada riwayat alert selesai: sama
// dengan daftar aktif, dan tidak berubah ketika alert pindah dari daftar aktif
// ke riwayat. Jam browser dipasang palsu pada momen yang dipilih dari data
// tiruannya sendiri.

const headers = { Origin: "http://localhost:3101" };
const PAGE = ALERT_HISTORY_PAGE_SIZE;
const customers = new Map(createMockCustomers().map((c) => [c.id, c]));

// Momen yang halaman pertama riwayatnya berisi sedikitnya dua alert pelanggan
// berbeda dan satu alert router, dan yang tiga halaman pertamanya tidak berubah
// selama setengah menit berikutnya: peta memakai jam yang berjalan sendiri
// (animasinya macet bila jam dibekukan), jadi daftarnya tidak boleh bergeser
// selagi tes berlangsung.
function findRichTime() {
  const firstIds = (t: number) =>
    mockResolvedAlerts(t)
      .slice(0, PAGE * 3)
      .map((a) => a.id);
  for (const t of GRID) {
    const shown = mockResolvedAlerts(t).slice(0, PAGE);
    const people = shown.filter((a) => a.customerId !== null);
    const routers = shown.filter((a) => a.customerId === null);
    if (
      new Set(people.map((a) => a.customerId)).size >= 2 &&
      routers.length &&
      JSON.stringify(firstIds(t)) === JSON.stringify(firstIds(t + 30))
    ) {
      return { t, shown, people, routers };
    }
  }
  throw new Error("tidak ada momen dengan dua pelanggan dan satu router");
}

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function signUp(context: BrowserContext): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name: "Petugas Lokasi Riwayat",
    email: `riwayat-lokasi-${randomUUID()}@example.com`,
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

// Halaman Alert pada detik tertentu. Jamnya berjalan sendiri dari sana, seperti
// jam sungguhan, supaya peta bisa menyelesaikan animasinya sesudah tombol sorot
// ditekan.
async function openAlertsAt(page: Page, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.goto("/app/alert");
  await expect(page.getByTestId("resolved-alert-row").first()).toBeVisible();
}

const rowOf = (page: Page, alert: ResolvedAlert) =>
  page.locator(`[data-testid=resolved-alert-row][data-alert-id="${alert.id}"]`);

// Selisih mendatar antara pusat tooltip sorotan dan pusat peta, dalam piksel.
async function ringOffCenterX(page: Page) {
  const map = page.getByTestId("customer-map");
  const frame = (await map.locator(".leaflet-container").boundingBox())!;
  const ring = (await map.locator(".leaflet-tooltip-top").boundingBox())!;
  return Math.abs(ring.x + ring.width / 2 - (frame.x + frame.width / 2));
}

async function expectMapFocusedOn(page: Page, customerId: string) {
  const person = customers.get(customerId)!;
  const map = page.getByTestId("customer-map");
  await expect(map).toHaveAttribute("data-zoom", "16");
  await expect(page.getByTestId("map-focus-banner")).toContainText(
    `Menyorot ${person.name}`,
  );
  // Hanya satu sorotan, dan itu milik pelanggan ini.
  const ring = map.locator(".leaflet-tooltip-top");
  await expect(ring).toHaveCount(1);
  await expect(ring).toContainText(person.name);
  await expect(ring).toContainText(person.odpName);
  // Dan peta berpusat di titiknya (sesudah animasi geser selesai).
  await expect.poll(() => ringOffCenterX(page)).toBeLessThan(30);
}

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context);
  await context.close();
});

// Memeriksa satu baris riwayat: lokasi, keterangan titik, dan tombol sorot.
async function expectLocationCells(page: Page, alert: ResolvedAlert) {
  const row = rowOf(page, alert);
  const shown = describeLocation(alert.location);
  const place = row.locator("[data-has-point]");
  await expect(place, alert.id).toContainText(shown.primary);
  if (shown.secondary)
    await expect(place, alert.id).toContainText(shown.secondary);
  await expect(place).toHaveAttribute("data-has-point", String(shown.hasPoint));
  // Pembaca layar diberi tahu ada atau tidaknya titik, bukan hanya ikon.
  await expect(place).toContainText(
    shown.hasPoint ? "ada titik di peta" : "tidak ada titik di peta",
  );
  const link = row.getByRole("link", { name: /^Sorot / });
  if (alert.customerId === null) {
    await expect(link, alert.id).toHaveCount(0);
    await expect(row, alert.id).toContainText("Tidak ada titik");
  } else {
    await expect(link, alert.id).toHaveCount(1);
    await expect(link).toHaveAccessibleName(
      `Sorot ${alert.location.name} di peta`,
    );
    await expect(link).toHaveAttribute("href", mapFocusHref(alert.customerId)!);
    await expect(link).toContainText("Sorot di peta");
  }
}

test("kolom lokasi dan tombol sorot sesuai jenis alert di setiap baris riwayat", async ({
  browser,
}) => {
  const errors: string[] = [];
  const { t, shown } = findRichTime();
  const { context, page } = await contextFor(browser, cookies);
  page.on("pageerror", (error) => errors.push(error.message));
  await openAlertsAt(page, t);
  await expect(page.getByTestId("resolved-alert-row")).toHaveCount(PAGE);
  // Dua tabel di halaman ini punya kolom bernama sama; yang diperiksa riwayat.
  const table = page.getByRole("region", { name: "Riwayat alert selesai" });
  await expect(
    table.getByRole("columnheader", { name: "Lokasi" }),
  ).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Peta" })).toBeVisible();
  for (const alert of shown) await expectLocationCells(page, alert);
  expect(errors).toEqual([]);
  await context.close();
});

test("lokasi dan tombol sorot tetap benar di halaman riwayat berikutnya", async ({
  browser,
}) => {
  const { t } = findRichTime();
  const all = mockResolvedAlerts(t);
  const { context, page } = await contextFor(browser, cookies);
  await openAlertsAt(page, t);
  const next = page.getByRole("button", { name: "Berikutnya" });
  for (const pageNumber of [2, 3]) {
    await next.click();
    const shown = paginate(all, pageNumber, PAGE).items;
    await expect(rowOf(page, shown[0])).toBeVisible();
    for (const alert of shown) await expectLocationCells(page, alert);
  }
  await context.close();
});

test("menekan tombol sorot membuka peta di titik pelanggannya, untuk beberapa alert berturut-turut", async ({
  browser,
}) => {
  const { t, people } = findRichTime();
  const targets: ResolvedAlert[] = [];
  for (const alert of people) {
    if (!targets.some((item) => item.customerId === alert.customerId))
      targets.push(alert);
    if (targets.length === 2) break;
  }
  const { context, page } = await contextFor(browser, cookies);
  await openAlertsAt(page, t);
  for (const alert of targets) {
    await rowOf(page, alert)
      .getByRole("link", { name: /^Sorot / })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/app\\?focus=${alert.customerId}$`),
    );
    await expectMapFocusedOn(page, alert.customerId!);
    await page.goBack();
    // Kembali ke riwayat yang sama, halaman pertama.
    await expect(page.getByTestId("resolved-alert-row")).toHaveCount(PAGE);
  }
  await context.close();
});

test("tombol sorot riwayat bisa dipakai dengan papan ketik dan jalan di tab baru", async ({
  browser,
}) => {
  const { t, people } = findRichTime();
  const alert = people[0];
  const { context, page } = await contextFor(browser, cookies);
  await openAlertsAt(page, t);
  const link = rowOf(page, alert).getByRole("link", { name: /^Sorot / });

  // Tab baru: tanpa bergantung pada halaman asalnya, yang tidak berubah.
  const opened = context.waitForEvent("page");
  await link.click({ modifiers: ["Control"] });
  const tab = await opened;
  await tab.waitForLoadState("domcontentloaded");
  await expect(tab).toHaveURL(new RegExp(`/app\\?focus=${alert.customerId}$`));
  await expectMapFocusedOn(tab, alert.customerId!);
  await expect(page).toHaveURL(/\/app\/alert$/);
  await expect(page.getByTestId("resolved-alert-row")).toHaveCount(PAGE);

  // Papan ketik: fokus lalu Enter.
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/app\\?focus=${alert.customerId}$`));
  await expectMapFocusedOn(page, alert.customerId!);
  await context.close();
});

test("alert yang pindah dari daftar aktif ke riwayat membawa lokasi dan tautan sorot yang sama", async ({
  browser,
}) => {
  // Alert pelanggan yang aktif lalu selesai, dan detik selesainya.
  let found: { end: number; alert: ResolvedAlert } | null = null;
  for (const t of GRID) {
    const later = new Map(
      mockResolvedAlerts(t + 6_000).map((alert) => [alert.id, alert]),
    );
    const mine = mockActiveAlerts(t).find(
      (alert) => alert.customerId !== null && later.has(alert.id),
    );
    if (mine) {
      const done = later.get(mine.id)!;
      // Paling atas riwayat tepat pada detik selesainya.
      if (mockResolvedAlerts(done.endedAt)[0].id === done.id) {
        found = { end: done.endedAt, alert: done };
        break;
      }
    }
  }
  expect(found).not.toBeNull();
  const { end, alert } = found!;
  const { context, page } = await contextFor(browser, cookies);

  // Sedetik sebelum selesai: catat lokasi dan tautan di daftar aktif.
  await page.clock.install({ time: (end - 1) * 1000 });
  await page.clock.setFixedTime((end - 1) * 1000);
  await page.goto("/app/alert");
  const activeRow = page.locator(
    `[data-testid=alert-row][data-alert-id="${alert.id}"]`,
  );
  await expect(activeRow).toBeVisible();
  const before = {
    place: await activeRow.locator("[data-has-point]").innerText(),
    href: await activeRow
      .getByRole("link", { name: /^Sorot / })
      .getAttribute("href"),
    name: await activeRow
      .getByRole("link", { name: /^Sorot / })
      .getAttribute("aria-label"),
  };

  // Pada detik selesainya: pindah ke riwayat dengan isian yang sama.
  await page.clock.setFixedTime(end * 1000);
  await page.clock.runFor(5_100);
  const movedRow = rowOf(page, alert);
  await expect(movedRow).toBeVisible();
  await expect(activeRow).toHaveCount(0);
  const after = {
    place: await movedRow.locator("[data-has-point]").innerText(),
    href: await movedRow
      .getByRole("link", { name: /^Sorot / })
      .getAttribute("href"),
    name: await movedRow
      .getByRole("link", { name: /^Sorot / })
      .getAttribute("aria-label"),
  };
  expect(after).toEqual(before);
  expect(after.href).toBe(mapFocusHref(alert.customerId!));
  await context.close();
});

test("di layar sempit tombol sorot riwayat terjangkau dengan menggulir tabel, dan halaman tidak melebar", async ({
  browser,
}) => {
  const { t, people } = findRichTime();
  const alert = people[0];
  const { context, page } = await contextFor(browser, cookies, {
    width: 390,
    height: 844,
  });
  await openAlertsAt(page, t);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);

  const link = rowOf(page, alert).getByRole("link", { name: /^Sorot / });
  // Kolom terakhir ada di luar layar sampai tabelnya digulir.
  const region = page.getByRole("region", { name: "Riwayat alert selesai" });
  await region.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeInViewport();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/app\\?focus=${alert.customerId}$`));
  await expectMapFocusedOn(page, alert.customerId!);
  await context.close();
});

test("dari riwayat ke peta lalu kembali: Tampilkan semua memulihkan peta, dan Kembali membawa ke riwayat", async ({
  browser,
}) => {
  const { t, people } = findRichTime();
  const alert = people[0];
  const { context, page } = await contextFor(browser, cookies);
  await openAlertsAt(page, t);
  await rowOf(page, alert)
    .getByRole("link", { name: /^Sorot / })
    .click();
  await expectMapFocusedOn(page, alert.customerId!);

  // Menutup sorotan: banner dan cincin hilang, peta kembali menampilkan semua.
  await page.getByRole("button", { name: "Tampilkan semua" }).click();
  await expect(page.getByTestId("map-focus-banner")).toHaveCount(0);
  await expect(
    page.getByTestId("customer-map").locator(".leaflet-tooltip-top"),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      Number(await page.getByTestId("customer-map").getAttribute("data-zoom")),
    )
    .toBeLessThan(16);

  // Kembali membawa ke riwayat yang sama.
  await page.goBack();
  await expect(page).toHaveURL("/app/alert");
  await expect(page.getByTestId("resolved-alert-row")).toHaveCount(PAGE);
  await expect(rowOf(page, alert)).toBeVisible();
  await context.close();
});
