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
  mockActiveAlerts,
  summarizeAlertSeverity,
} from "../src/lib/dashboard/alerts";
import { alertBadge } from "../src/lib/dashboard/alert-badge";
import { GRID, findMoments } from "./alert-moments";

// Lencana jumlah alert aktif di menu "Alert", di halaman sungguhan: angkanya sama
// di semua halaman, berubah sendiri tanpa memuat ulang, ikut turun saat alert
// ditandai ditangani, tidak mengubah nama tautan, dan terbaca di dua tema. Jam
// browser dipasang palsu pada momen yang dipilih dari data tiruannya sendiri.

const headers = { Origin: "http://localhost:3101" };
type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function signUp(context: BrowserContext): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name: "Petugas Lencana",
    email: `lencana-alert-${randomUUID()}@example.com`,
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
  options: {
    colorScheme?: "light" | "dark";
    viewport?: { width: number; height: number };
  } = {},
) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
    timezoneId: "Asia/Jakarta",
    ...options,
  });
  await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}

// Jam palsu dipasang sekali per halaman; membuka halaman lagi hanya menggeser
// waktunya.
const installed = new WeakSet<Page>();
async function open(page: Page, path: string, seconds: number) {
  if (!installed.has(page)) {
    await page.clock.install({ time: seconds * 1000 });
    installed.add(page);
  }
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto(path);
}

async function moveTo(page: Page, seconds: number) {
  await page.clock.setFixedTime(seconds * 1000);
  await page.clock.runFor(1_100);
}

// Menu di sidebar (layar lebar) dan di bilah atas (layar sempit); yang satunya
// disembunyikan CSS, jadi pencarian berdasarkan peran hanya menemukan yang tampil.
const sidebar = (page: Page) =>
  page.getByRole("navigation", { name: "Menu utama" });
const bar = (page: Page) =>
  page.getByRole("navigation", { name: "Menu halaman" });
const alertLink = (menu: ReturnType<typeof sidebar>) =>
  menu.getByRole("link", { name: "Alert", exact: true });
const badgeIn = (menu: ReturnType<typeof sidebar>) =>
  alertLink(menu).getByTestId("alert-count-badge");
const statusIn = (menu: ReturnType<typeof sidebar>) =>
  menu.getByTestId("alert-count-status");

// Sepasang waktu berselang kurang dari empat menit yang jumlah alert aktifnya
// berbeda, supaya perubahannya lewat pesan hub, bukan sinkron ulang.
function findChange() {
  for (const t of GRID) {
    const before = summarizeAlertSeverity(mockActiveAlerts(t));
    for (let gap = 30; gap <= 240; gap += 30) {
      const after = summarizeAlertSeverity(mockActiveAlerts(t + gap));
      if (after.total !== before.total) return { t0: t, t1: t + gap };
    }
  }
  throw new Error("jumlah alert tidak pernah berubah dalam empat menit");
}

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context);
  await context.close();
});

test("lencana menulis jumlah dan tingkat yang sama di setiap halaman, dan nama tautannya tetap Alert", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const { total, critical } = mixed.summary;
  const model = alertBadge(mixed.summary, false)!;
  const { context, page } = await contextFor(browser, cookies);

  for (const path of ["/app", "/app/alert", "/app/anomali"]) {
    await open(page, path, mixed.t);
    const badge = badgeIn(sidebar(page));
    await expect(badge).toHaveAttribute("data-count", String(total));
    await expect(badge).toHaveAttribute("data-critical", String(critical));
    await expect(badge).toHaveAttribute("data-tone", "critical");
    await expect(badge).toHaveText(model.text);
    await expect(badge).toHaveAttribute("title", model.description);
    // Ikon dan angka, bukan hanya warna; keduanya hiasan bagi pembaca layar. Bentuk
    // ikonnya sendiri berbeda untuk tiap tingkat.
    await expect(badge.locator("svg")).toHaveCount(1);
    await expect(badge.locator("svg.lucide-octagon-alert")).toHaveCount(1);
    await expect(badge).toHaveAttribute("aria-hidden", "true");

    // Nama tautan tidak ikut berubah; jumlahnya sampai lewat keterangan dan region
    // status, yang berada di luar tautan.
    const link = alertLink(sidebar(page));
    await expect(link).toHaveAccessibleName("Alert");
    await expect(link).toHaveAccessibleDescription(model.description);
    await expect(statusIn(sidebar(page))).toHaveText(model.description);
    await expect(statusIn(sidebar(page))).toHaveAttribute("role", "status");
    await expect(link.getByTestId("alert-count-status")).toHaveCount(0);
  }

  // Sama dengan angka di dasbor dan di kartu halaman Alert.
  await open(page, "/app", mixed.t);
  await expect(page.getByTestId("anomaly-badge")).toHaveAttribute(
    "data-count",
    String(total),
  );
  await open(page, "/app/alert", mixed.t);
  await expect(page.getByTestId("active-alerts")).toHaveAttribute(
    "data-count",
    String(total),
  );
  await context.close();
});

test("tanpa alert kritis lencana berwarna peringatan dan tidak menulis kritis", async ({
  browser,
}) => {
  const { warningOnly } = findMoments();
  const model = alertBadge(warningOnly.summary, false)!;
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/anomali", warningOnly.t);
  const badge = badgeIn(sidebar(page));
  await expect(badge).toHaveAttribute("data-tone", "warning");
  await expect(badge.locator("svg.lucide-triangle-alert")).toHaveCount(1);
  await expect(badge).toHaveAttribute("data-critical", "0");
  await expect(badge).toHaveText(model.text);
  await expect(alertLink(sidebar(page))).toHaveAccessibleDescription(
    `${warningOnly.summary.total} alert aktif`,
  );
  await context.close();
});

test("tanpa alert sama sekali lencana hanya memuat tanda normal, dan kalimatnya tetap ada", async ({
  browser,
}) => {
  const { empty } = findMoments();
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", empty.t);
  const badge = badgeIn(sidebar(page));
  await expect(badge).toHaveAttribute("data-count", "0");
  await expect(badge).toHaveAttribute("data-tone", "ok");
  await expect(badge).toHaveText("");
  await expect(badge.locator("svg")).toHaveCount(1);
  await expect(badge.locator("svg.lucide-circle-check")).toHaveCount(1);
  await expect(alertLink(sidebar(page))).toHaveAccessibleDescription(
    "Tidak ada alert aktif",
  );
  await expect(statusIn(sidebar(page))).toHaveText("Tidak ada alert aktif");
  await context.close();
});

test("berubah sendiri saat alert baru atau yang selesai masuk, tanpa memuat ulang, dan tetap ada saat berpindah halaman", async ({
  browser,
}) => {
  const { t0, t1 } = findChange();
  const before = alertBadge(
    summarizeAlertSeverity(mockActiveAlerts(t0)),
    false,
  )!;
  const after = alertBadge(
    summarizeAlertSeverity(mockActiveAlerts(t1)),
    false,
  )!;
  expect(after.total).not.toBe(before.total);
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/anomali", t0);
  const badge = badgeIn(sidebar(page));
  await expect(badge).toHaveAttribute("data-count", String(before.total));
  await expect(statusIn(sidebar(page))).toHaveText(before.description);

  // Penanda: halamannya tidak dimuat ulang selama uji.
  await page.evaluate(() => {
    (window as unknown as { __tanpaMuatUlang: boolean }).__tanpaMuatUlang =
      true;
  });
  await moveTo(page, t1);
  await expect(badge).toHaveAttribute("data-count", String(after.total));
  await expect(badge).toHaveAttribute("data-tone", after.tone);
  await expect(badge).toHaveText(after.text);
  await expect(statusIn(sidebar(page))).toHaveText(after.description);

  // Berpindah halaman lewat menu: lencananya langsung ada dengan angka yang sama,
  // tanpa menunggu data dimuat lagi.
  await alertLink(sidebar(page)).click();
  await expect(page).toHaveURL("/app/alert");
  await expect(badgeIn(sidebar(page))).toHaveAttribute(
    "data-count",
    String(after.total),
  );
  await sidebar(page).getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL("/app");
  await expect(badgeIn(sidebar(page))).toHaveAttribute(
    "data-count",
    String(after.total),
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __tanpaMuatUlang?: boolean }).__tanpaMuatUlang,
    ),
  ).toBe(true);
  await context.close();
});

test("menandai alert ditangani menurunkan lencana seketika, dengan tingkat yang ikut dihitung ulang", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const active = mockActiveAlerts(mixed.t);
  const target = active[0];
  const remaining = alertBadge(
    summarizeAlertSeverity(active.filter((alert) => alert.id !== target.id)),
    false,
  )!;
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", mixed.t);
  const badge = badgeIn(sidebar(page));
  await expect(badge).toHaveAttribute(
    "data-count",
    String(mixed.summary.total),
  );

  await page
    .locator(`[data-testid=alert-row][data-alert-id="${target.id}"]`)
    .getByTestId("handle-alert")
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Ya, tandai ditangani" })
    .click();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  await expect(badge).toHaveAttribute("data-count", String(remaining.total));
  await expect(badge).toHaveAttribute(
    "data-critical",
    String(remaining.critical),
  );
  await expect(badge).toHaveAttribute("data-tone", remaining.tone);
  await expect(statusIn(sidebar(page))).toHaveText(remaining.description);
  // Sama dengan kartu di halaman yang sama.
  await expect(page.getByTestId("active-alerts")).toHaveAttribute(
    "data-count",
    String(remaining.total),
  );
  await context.close();
});

test("di layar sempit lencana ada di bilah menu, nama tautan tetap Alert, dan halaman tidak melebar", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const model = alertBadge(mixed.summary, false)!;
  const { context, page } = await contextFor(browser, cookies, {
    viewport: { width: 390, height: 844 },
  });
  await open(page, "/app/alert", mixed.t);
  const badge = badgeIn(bar(page));
  await expect(badge).toHaveAttribute(
    "data-count",
    String(mixed.summary.total),
  );
  await expect(badge).toHaveText(model.text);
  await expect(badge).toBeInViewport({ ratio: 1 });
  const link = alertLink(bar(page));
  await expect(link).toHaveAccessibleName("Alert");
  await expect(link).toHaveAccessibleDescription(model.description);
  // Satu menu saja yang tampil di layar sempit, dan keterangannya satu.
  await expect(sidebar(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`lencana terbaca jelas di tema ${scheme}, di halaman yang sedang dibuka maupun tidak`, async ({
    browser,
  }) => {
    const { mixed, warningOnly, empty } = findMoments();
    const { context, page } = await contextFor(browser, cookies, {
      colorScheme: scheme,
    });

    // Kontras tulisan terhadap latar yang sebenarnya: semua latar di atasnya
    // ditumpuk dari yang terluar (WCAG AA: 4,5 : 1).
    const measure = () =>
      page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const pixel = (...layers: string[]) => {
          ctx.clearRect(0, 0, 1, 1);
          for (const color of layers) {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
          }
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          return [r, g, b];
        };
        const luminance = ([r, g, b]: number[]) => {
          const channel = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return (
            0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
          );
        };
        const badge = document.querySelector(
          "nav[aria-label='Menu utama'] [data-testid=alert-count-badge]",
        )!;
        const layers: string[] = [];
        for (let el: Element | null = badge; el; el = el.parentElement) {
          layers.unshift(getComputedStyle(el).backgroundColor);
        }
        const background = pixel(...layers);
        const text = pixel(getComputedStyle(badge).color);
        const [hi, lo] = [luminance(text), luminance(background)].sort(
          (a, b) => b - a,
        );
        return {
          tone: badge.getAttribute("data-tone")!,
          ratio: (hi + 0.05) / (lo + 0.05),
        };
      });

    const seen = new Set<string>();
    for (const [path, moment] of [
      ["/app/alert", mixed],
      ["/app", mixed],
      ["/app/alert", warningOnly],
      ["/app", warningOnly],
      ["/app/alert", empty],
      ["/app", empty],
    ] as const) {
      await open(page, path, moment.t);
      await expect(badgeIn(sidebar(page))).toHaveAttribute(
        "data-count",
        String(moment.summary.total),
      );
      const { tone, ratio } = await measure();
      seen.add(tone);
      expect(
        ratio,
        `${tone} di ${path}, tema ${scheme}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect([...seen].sort()).toEqual(["critical", "ok", "warning"]);
    await context.close();
  });
}
