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
import { paginate } from "../src/lib/dashboard/paging";
import { START } from "./alert-moments";

// Waktu mulai dan waktu selesai pada riwayat, sampai detik. Berbeda dari
// resolved-time-display.spec.ts, yang membandingkan dengan Intl di sisi tes,
// spesifikasi ini memakai hitungan bilangan bulat sendiri (selisih zona waktu
// dari epoch) sebagai pembanding, jadi kesalahan pemformatan di browser tidak
// bisa lolos karena tes memakai pustaka yang sama. Ia menguji seluruh detik 00
// sampai 59, jam 00 (bukan 24), batas bulan, zona dengan selisih menit, dan
// halaman riwayat yang bukan pertama.

const headers = { Origin: "http://localhost:3101" };
const PAGE = ALERT_HISTORY_PAGE_SIZE;
const JAKARTA = 7 * 60;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

const pad = (value: number) => String(value).padStart(2, "0");

// Pembanding tanpa Intl: jam di zona dengan selisih tetap `offsetMinutes`.
function clockAt(epoch: number, offsetMinutes: number) {
  const local = epoch + offsetMinutes * 60;
  const secondOfDay = ((local % 86_400) + 86_400) % 86_400;
  return `${pad(Math.floor(secondOfDay / 3600))}.${pad(Math.floor((secondOfDay % 3600) / 60))}.${pad(secondOfDay % 60)}`;
}
const dayNumber = (epoch: number, offsetMinutes: number) =>
  Math.floor((epoch + offsetMinutes * 60) / 86_400);
function dateLabel(epoch: number, offsetMinutes: number) {
  const shifted = new Date((epoch + offsetMinutes * 60) * 1000);
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]}`;
}
// Yang harus tampil: jam saja, atau tanggal dan jam bila bukan hari yang sama
// dengan `now`.
function expectedText(epoch: number, now: number, offsetMinutes: number) {
  return dayNumber(epoch, offsetMinutes) === dayNumber(now, offsetMinutes)
    ? clockAt(epoch, offsetMinutes)
    : `${dateLabel(epoch, offsetMinutes)}, ${clockAt(epoch, offsetMinutes)}`;
}

test.describe("pembanding hitungan sendiri", () => {
  test("cocok dengan titik waktu yang diketahui", () => {
    // 2026-10-07 18:26:40 UTC adalah 01.26.40 tanggal 8 Okt di Jakarta.
    const epoch = Date.UTC(2026, 9, 7, 18, 26, 40) / 1000;
    expect(clockAt(epoch, 0)).toBe("18.26.40");
    expect(clockAt(epoch, JAKARTA)).toBe("01.26.40");
    expect(dateLabel(epoch, 0)).toBe("7 Okt");
    expect(dateLabel(epoch, JAKARTA)).toBe("8 Okt");
    expect(clockAt(epoch, 330)).toBe("23.56.40");
    expect(clockAt(epoch, 345)).toBe("00.11.40");
    expect(expectedText(epoch, epoch, JAKARTA)).toBe("01.26.40");
    expect(expectedText(epoch - 3 * 3600, epoch, JAKARTA)).toBe(
      "7 Okt, 22.26.40",
    );
    // Selisih negatif dan tengah malam tepat.
    expect(clockAt(Date.UTC(2026, 0, 1, 17, 0, 0) / 1000, JAKARTA)).toBe(
      "00.00.00",
    );
    expect(clockAt(0, -8 * 60)).toBe("16.00.00");
  });
});

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function signUp(context: BrowserContext): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name: "Petugas Detik Riwayat",
    email: `riwayat-detik-${randomUUID()}@example.com`,
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

async function contextIn(browser: Browser, cookies: Cookies, timezone: string) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
    timezoneId: timezone,
  });
  await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}

// Halaman Alert pada detik tertentu; jamnya tidak maju sendiri.
async function openAlertsAt(page: Page, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto("/app/alert");
  await expect(page.getByTestId("resolved-alert-row").first()).toBeVisible();
}

// Pindah ke detik tertentu; riwayat menyegarkan diri pada putaran berikutnya.
async function moveTo(page: Page, seconds: number) {
  await page.clock.setFixedTime(seconds * 1000);
  await page.clock.runFor(5_100);
}

// Alert yang memenuhi `predicate` dan yang, sedetik sesudah selesainya, berada
// di baris paling atas riwayat. Dicari di antara yang selesai dalam rentang.
function topRowAlerts(
  predicate: (alert: ResolvedAlert) => boolean,
  around: number,
  windowSeconds: number,
  limit: number,
) {
  const picked: ResolvedAlert[] = [];
  for (const alert of mockResolvedAlerts(around, windowSeconds)) {
    if (!predicate(alert)) continue;
    if (mockResolvedAlerts(alert.endedAt + 1)[0].id !== alert.id) continue;
    picked.push(alert);
    if (picked.length >= limit) break;
  }
  return picked;
}

// Memeriksa baris paling atas: waktu mulai dan waktu selesai menurut pembanding.
async function expectTopRow(
  page: Page,
  alert: ResolvedAlert,
  now: number,
  offsetMinutes: number,
) {
  const row = page.getByTestId("resolved-alert-row").first();
  await expect(row, alert.id).toHaveAttribute("data-alert-id", alert.id);
  await expect(row.locator("time").first(), `${alert.id} mulai`).toHaveText(
    expectedText(alert.startedAt, now, offsetMinutes),
  );
  await expect(
    row.getByTestId("resolved-ended-at"),
    `${alert.id} selesai`,
  ).toHaveText(expectedText(alert.endedAt, now, offsetMinutes));
}

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context);
  await context.close();
});

test("setiap detik 00 sampai 59 tampil benar pada waktu selesai dan waktu mulai", async ({
  browser,
}) => {
  const week = START + 6 * 86_400;
  const bySecond = Array.from({ length: 60 }, (_, second) => {
    const [alert] = topRowAlerts(
      (candidate) => candidate.endedAt % 60 === second,
      week,
      6 * 86_400,
      1,
    );
    expect(
      alert,
      `tidak ada alert yang selesai pada detik ${second}`,
    ).toBeTruthy();
    return alert;
  });
  // Detik mulainya juga beragam, bukan hanya detik selesainya.
  expect(
    new Set(bySecond.map((alert) => alert.startedAt % 60)).size,
  ).toBeGreaterThan(25);

  const { context, page } = await contextIn(browser, cookies, "Asia/Jakarta");
  await openAlertsAt(page, bySecond[0].endedAt + 1);
  for (const alert of bySecond) {
    const now = alert.endedAt + 1;
    await moveTo(page, now);
    await expectTopRow(page, alert, now, JAKARTA);
    // Dua angka terakhir adalah detik sebenarnya, tanpa pembulatan.
    await expect(
      page
        .getByTestId("resolved-alert-row")
        .first()
        .getByTestId("resolved-ended-at"),
    ).toHaveText(new RegExp(`\\.${pad(alert.endedAt % 60)}$`));
  }
  await context.close();
});

test("jam 00 ditulis 00, bukan 24, untuk waktu mulai dan waktu selesai", async ({
  browser,
}) => {
  const week = START + 6 * 86_400;
  const hourZero = (epoch: number) =>
    Math.floor(
      ((((epoch + JAKARTA * 60) % 86_400) + 86_400) % 86_400) / 3600,
    ) === 0;
  const ends = topRowAlerts((a) => hourZero(a.endedAt), week, 6 * 86_400, 4);
  const starts = topRowAlerts(
    (a) => hourZero(a.startedAt),
    week,
    6 * 86_400,
    4,
  );
  expect(ends.length).toBeGreaterThanOrEqual(3);
  expect(starts.length).toBeGreaterThanOrEqual(3);

  const { context, page } = await contextIn(browser, cookies, "Asia/Jakarta");
  await openAlertsAt(page, ends[0].endedAt + 1);
  for (const alert of [...ends, ...starts]) {
    const now = alert.endedAt + 1;
    await moveTo(page, now);
    await expectTopRow(page, alert, now, JAKARTA);
    const row = page.getByTestId("resolved-alert-row").first();
    const texts = [...(await row.locator("time").allTextContents())].map(
      (text) => text.trim(),
    );
    // Tidak ada "24." di mana pun pada baris itu.
    for (const text of texts) expect(text).not.toMatch(/(^|, )24\./);
  }
  const zeroText = await page
    .getByTestId("resolved-alert-row")
    .first()
    .innerText();
  expect(zeroText).toMatch(/(^|\s|, )00\.\d{2}\.\d{2}/);
  await context.close();
});

test("tanggal di depan jam benar di batas bulan dan tahun, dengan nama bulan bahasa Indonesia", async ({
  browser,
}) => {
  // Tengah malam Jakarta pada pergantian bulan, termasuk Mei, Agustus, tahun
  // baru, dan 29 Februari.
  const boundaries = [
    Date.UTC(2026, 3, 30, 17, 0, 0), // 30 Apr -> 1 Mei
    Date.UTC(2026, 6, 31, 17, 0, 0), // 31 Jul -> 1 Agu
    Date.UTC(2026, 8, 30, 17, 0, 0), // 30 Sep -> 1 Okt
    Date.UTC(2026, 11, 31, 17, 0, 0), // 31 Des -> 1 Jan
    Date.UTC(2028, 1, 28, 17, 0, 0), // 28 Feb -> 29 Feb (kabisat)
  ].map((ms) => ms / 1000);

  const picks = boundaries.map((boundary) => {
    const [alert] = topRowAlerts(
      (a) => a.startedAt < boundary && a.endedAt >= boundary,
      boundary + 3 * 3600,
      6 * 3600,
      1,
    );
    expect(alert, `tidak ada alert yang melintasi ${boundary}`).toBeTruthy();
    return { boundary, alert };
  });

  const { context, page } = await contextIn(browser, cookies, "Asia/Jakarta");
  await openAlertsAt(page, picks[0].alert.endedAt + 1);
  const labels: string[] = [];
  for (const { alert } of picks) {
    const now = alert.endedAt + 1;
    await moveTo(page, now);
    await expectTopRow(page, alert, now, JAKARTA);
    const start = (await page
      .getByTestId("resolved-alert-row")
      .first()
      .locator("time")
      .first()
      .textContent())!.trim();
    // Mulai kemarin (tanggal dan jam), selesai hari ini (jam saja).
    expect(start).toMatch(/^\d{1,2} [A-Z][a-z]{2}, \d{2}\.\d{2}\.\d{2}$/);
    labels.push(start.split(",")[0]);
  }
  expect(labels).toEqual(["30 Apr", "31 Jul", "30 Sep", "31 Des", "28 Feb"]);
  await context.close();
});

for (const [zone, offsetMinutes] of [
  ["Asia/Kolkata", 330],
  ["Asia/Kathmandu", 345],
  ["Asia/Jakarta", JAKARTA],
  ["UTC", 0],
] as const) {
  test(`zona ${zone} (selisih ${offsetMinutes} menit): seluruh halaman pertama sampai detik`, async ({
    browser,
  }) => {
    const t = START + 3 * 86_400 + 5 * 3600 + 17 * 60 + 41;
    const shown = mockResolvedAlerts(t).slice(0, PAGE);
    const { context, page } = await contextIn(browser, cookies, zone);
    await openAlertsAt(page, t);
    await expect(page.getByTestId("resolved-alert-row")).toHaveCount(PAGE);
    const rows = await page
      .getByTestId("resolved-alert-row")
      .evaluateAll((items) =>
        items.map((item) => ({
          id: item.getAttribute("data-alert-id")!,
          start: item.querySelectorAll("time")[0].textContent!.trim(),
          end: item
            .querySelector("[data-testid=resolved-ended-at]")!
            .textContent!.trim(),
        })),
      );
    expect(rows.map((row) => row.id)).toEqual(shown.map((a) => a.id));
    for (const [index, row] of rows.entries()) {
      expect(row.start, `${zone} ${row.id} mulai`).toBe(
        expectedText(shown[index].startedAt, t, offsetMinutes),
      );
      expect(row.end, `${zone} ${row.id} selesai`).toBe(
        expectedText(shown[index].endedAt, t, offsetMinutes),
      );
    }
    await context.close();
  });
}

test("halaman riwayat yang bukan pertama juga menulis waktu sampai detik", async ({
  browser,
}) => {
  const t = START + 4 * 86_400 + 9 * 3600 + 3 * 60 + 29;
  const all = mockResolvedAlerts(t);
  const { context, page } = await contextIn(browser, cookies, "Asia/Jakarta");
  await openAlertsAt(page, t);
  const next = page.getByRole("button", { name: "Berikutnya" });
  const status = page.getByTestId("resolved-page-status");
  let current = 1;
  for (const pageNumber of [2, 3, 12]) {
    while (current < pageNumber) {
      await next.click();
      current += 1;
      await expect(status).toHaveText(new RegExp(`^Halaman ${current} `));
    }
    const shown = paginate(all, pageNumber, PAGE).items;
    await expect(
      page.getByTestId("resolved-alert-row").first(),
    ).toHaveAttribute("data-alert-id", shown[0].id);
    const rows = await page
      .getByTestId("resolved-alert-row")
      .evaluateAll((items) =>
        items.map((item) => ({
          id: item.getAttribute("data-alert-id")!,
          start: item.querySelectorAll("time")[0].textContent!.trim(),
          end: item
            .querySelector("[data-testid=resolved-ended-at]")!
            .textContent!.trim(),
        })),
      );
    expect(rows.map((row) => row.id)).toEqual(shown.map((a) => a.id));
    for (const [index, row] of rows.entries()) {
      expect(row.start, `${row.id} mulai`).toBe(
        expectedText(shown[index].startedAt, t, JAKARTA),
      );
      expect(row.end, `${row.id} selesai`).toBe(
        expectedText(shown[index].endedAt, t, JAKARTA),
      );
    }
  }
  await context.close();
});
