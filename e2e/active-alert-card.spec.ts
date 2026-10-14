import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { findMoments } from "./alert-moments";

// Kartu daftar alert aktif: hitungan per tingkat di kepalanya, keadaan kosong,
// pembaruan tanpa memuat ulang, dan angka yang sama dengan lencana di dasbor.
// Jam browser dipasang palsu pada momen yang dipilih dari data tiruannya sendiri.

const headers = { Origin: "http://localhost:3101" };
type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function signUp(context: BrowserContext): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name: "Petugas Kartu Alert",
    email: `kartu-alert-${randomUUID()}@example.com`,
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
  colorScheme: "light" | "dark" = "light",
  viewport?: { width: number; height: number },
) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
    timezoneId: "Asia/Jakarta",
    colorScheme,
    viewport,
  });
  await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}

// Halaman Alert pada detik tertentu; jamnya tidak maju sendiri.
async function openAlertsAt(page: Page, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto("/app/alert");
  await expect(page.getByTestId("active-alerts")).toHaveAttribute(
    "data-count",
    /\d+/,
  );
}

const card = (page: Page) => page.getByTestId("active-alerts");
const chips = (page: Page) => card(page).getByTestId("severity-chip");

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context);
  await context.close();
});

test("kartu menulis jumlah alert per tingkat dengan angka dan kata, yang paling genting dulu", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const { context, page } = await contextFor(browser, cookies);
  await openAlertsAt(page, mixed.t);

  const { total, critical, warning, info } = mixed.summary;
  await expect(card(page)).toHaveAttribute("data-count", String(total));
  await expect(card(page)).toHaveAttribute("data-critical", String(critical));
  await expect(card(page)).toHaveAttribute("data-warning", String(warning));
  await expect(card(page)).toHaveAttribute("data-tone", "critical");
  await expect(
    card(page).getByText(`${total} alert sedang berjalan`),
  ).toBeVisible();
  // Jumlah di kartu sama dengan baris yang tampil.
  await expect(page.getByTestId("alert-row")).toHaveCount(total);

  // Satu penanda per tingkat yang ada isinya, genting dulu, ditulis dengan kata.
  const expected = [
    ["critical", `${critical} kritis`],
    ["warning", `${warning} peringatan`],
    ...(info > 0 ? [["info", `${info} info`]] : []),
  ];
  await expect(chips(page)).toHaveCount(expected.length);
  for (const [index, [severity, text]] of expected.entries()) {
    const chip = chips(page).nth(index);
    await expect(chip).toHaveAttribute("data-severity", severity);
    await expect(chip).toHaveText(text);
  }
  // Ikonnya hiasan; artinya sudah ada di tulisan, bukan hanya warna.
  await expect(chips(page).locator("svg[aria-hidden=true]")).toHaveCount(
    expected.length,
  );
  await expect(
    card(page).getByRole("group", {
      name: "Jumlah alert aktif menurut tingkatnya",
    }),
  ).toBeVisible();
  const counts = await chips(page).allTextContents();
  const sum = counts.reduce((acc, text) => acc + Number(text.split(" ")[0]), 0);
  expect(sum).toBe(total);
  await context.close();
});

test("tanpa alert kritis kartu hanya menulis yang peringatan, dengan warna peringatan", async ({
  browser,
}) => {
  const { warningOnly } = findMoments();
  const { context, page } = await contextFor(browser, cookies);
  await openAlertsAt(page, warningOnly.t);
  const { total, warning } = warningOnly.summary;
  await expect(card(page)).toHaveAttribute("data-tone", "warning");
  await expect(card(page)).toHaveAttribute("data-critical", "0");
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toHaveAttribute("data-severity", "warning");
  await expect(chips(page).first()).toHaveText(`${warning} peringatan`);
  await expect(page.getByTestId("alert-row")).toHaveCount(total);
  await expect(card(page).getByText("kritis")).toHaveCount(0);
  await context.close();
});

test("tanpa alert kartu menulis semua normal, dan tabelnya menjelaskan kosongnya", async ({
  browser,
}) => {
  const { empty } = findMoments();
  const { context, page } = await contextFor(browser, cookies);
  await openAlertsAt(page, empty.t);
  await expect(card(page)).toHaveAttribute("data-count", "0");
  await expect(card(page)).toHaveAttribute("data-tone", "ok");
  await expect(card(page).getByText("0 alert sedang berjalan")).toBeVisible();
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toHaveAttribute("data-severity", "ok");
  await expect(chips(page).first()).toHaveText("Semua normal");
  await expect(page.getByTestId("alert-row")).toHaveCount(0);
  await expect(
    card(page).getByText("Tidak ada alert aktif. Semua jaringan normal."),
  ).toBeVisible();
  // Keterangan penanda sumber waktu tetap ada, juga saat daftarnya kosong.
  await expect(card(page).getByText(/polling ±N/)).toBeVisible();
  await context.close();
});

test("kartu ikut berubah tanpa dimuat ulang ketika alert datang dan pergi", async ({
  browser,
}) => {
  const { mixed, empty } = findMoments();
  const errors: string[] = [];
  const { context, page } = await contextFor(browser, cookies);
  page.on("pageerror", (error) => errors.push(error.message));
  await openAlertsAt(page, mixed.t);
  await expect(card(page)).toHaveAttribute(
    "data-count",
    String(mixed.summary.total),
  );
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  // Semua alert reda: kartu menjadi "semua normal".
  await page.clock.setFixedTime(empty.t * 1000);
  await page.clock.runFor(5_100);
  await expect(card(page)).toHaveAttribute("data-count", "0");
  await expect(card(page)).toHaveAttribute("data-tone", "ok");
  await expect(chips(page).first()).toHaveText("Semua normal");

  // Alert muncul lagi: hitungannya kembali, di kartu yang sama.
  await page.clock.setFixedTime(mixed.t * 1000);
  await page.clock.runFor(5_100);
  await expect(card(page)).toHaveAttribute(
    "data-count",
    String(mixed.summary.total),
  );
  await expect(card(page)).toHaveAttribute("data-tone", "critical");
  await expect(chips(page).first()).toHaveText(
    `${mixed.summary.critical} kritis`,
  );
  expect(
    await page.evaluate(() => (window as unknown as { kept: boolean }).kept),
  ).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test("angka kartu sama dengan lencana anomali di dasbor", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const { context, page } = await contextFor(browser, cookies);
  await openAlertsAt(page, mixed.t);
  await page
    .getByRole("navigation", { name: "Menu utama" })
    .getByRole("link", { name: "Dashboard" })
    .click();
  const badge = page.getByTestId("anomaly-badge");
  await expect(badge).toHaveAttribute(
    "data-count",
    String(mixed.summary.total),
  );
  await expect(badge).toHaveAttribute(
    "data-critical",
    String(mixed.summary.critical),
  );
  await expect(badge).toHaveAttribute("data-tone", mixed.summary.tone);
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`penanda tingkat terbaca jelas di tema ${scheme}`, async ({
    browser,
  }) => {
    const { mixed, empty } = findMoments();
    const { context, page } = await contextFor(browser, cookies, scheme);
    await openAlertsAt(page, mixed.t);

    // Kontras tulisan penanda terhadap latarnya yang bening di atas latar kartu
    // (WCAG AA: 4,5 : 1).
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
        return Array.from(
          document.querySelectorAll("[data-testid=severity-chip]"),
        ).map((chip) => {
          const card = chip.closest("[data-slot=card]")!;
          const background = pixel(
            getComputedStyle(card).backgroundColor,
            getComputedStyle(chip).backgroundColor,
          );
          const text = pixel(getComputedStyle(chip).color);
          const [hi, lo] = [luminance(text), luminance(background)].sort(
            (a, b) => b - a,
          );
          return {
            severity: chip.getAttribute("data-severity")!,
            ratio: (hi + 0.05) / (lo + 0.05),
          };
        });
      });

    const mixedRatios = await measure();
    expect(mixedRatios.map((item) => item.severity)).toEqual(
      expect.arrayContaining(["critical", "warning"]),
    );
    await page.clock.setFixedTime(empty.t * 1000);
    await page.clock.runFor(5_100);
    await expect(chips(page).first()).toHaveText("Semua normal");
    const okRatios = await measure();
    expect(okRatios.map((item) => item.severity)).toEqual(["ok"]);
    for (const { severity, ratio } of [...mixedRatios, ...okRatios]) {
      expect(ratio, `${severity} di tema ${scheme}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    await context.close();
  });
}

test("di layar sempit penanda tingkat turun ke bawah judul dan halaman tidak melebar", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const { context, page } = await contextFor(browser, cookies, "light", {
    width: 390,
    height: 844,
  });
  await openAlertsAt(page, mixed.t);
  const count = await chips(page).count();
  expect(count).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < count; index += 1) {
    await expect(chips(page).nth(index)).toBeInViewport({ ratio: 1 });
  }
  // Judul tetap terbaca di atas penanda, tidak terhimpit di sampingnya.
  const title = card(page).getByText("Daftar alert aktif").first();
  const titleBox = (await title.boundingBox())!;
  const chipBox = (await chips(page).first().boundingBox())!;
  expect(titleBox.width).toBeGreaterThan(120);
  expect(chipBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await context.close();
});
