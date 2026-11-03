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
  POLL_SECONDS,
  describeTimeSource,
  formatAlertTime,
  mockActiveAlerts,
  type ActiveAlert,
} from "../src/lib/dashboard/alerts";

// Uji tampilan waktu alert: presisi detik, zona waktu, tanggal, dan penanda
// sumber waktunya. Jam browser dipasang palsu pada momen yang dipilih dari
// data tiruannya sendiri, jadi hasilnya pasti.

const headers = { Origin: "http://localhost:3101" };
const START = 1_791_400_000;
const GRID = Array.from(
  { length: (7 * 86_400) / 300 },
  (_, index) => START + index * 300,
);

const clockIn = (timeZone: string) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
const dayIn = (timeZone: string) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone,
    day: "numeric",
    month: "short",
  });

async function signUp(context: BrowserContext, page: Page) {
  const data = {
    name: "Petugas Waktu",
    email: `time-${randomUUID()}@example.com`,
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

// Konteks baru dalam zona waktu tertentu, sudah masuk dengan sesi yang sama.
async function contextIn(
  browser: Browser,
  timezoneId: string,
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>,
  colorScheme: "light" | "dark" = "light",
) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
    timezoneId,
    colorScheme,
  });
  await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}

function firstTimeWith(pick: (alert: ActiveAlert, t: number) => boolean) {
  for (const t of GRID) {
    const alerts = mockActiveAlerts(t);
    if (alerts.some((alert) => pick(alert, t))) return { t, alerts };
  }
  throw new Error("tidak ada waktu yang cocok pada data tiruan");
}

test.describe("format jam pada setiap detik", () => {
  test("detik 00 sampai 59 selalu dua angka dan sama dengan detik sebenarnya", () => {
    const base = Math.floor(Date.UTC(2026, 9, 7, 7, 32, 0) / 1000);
    for (let second = 0; second < 60; second += 1) {
      const text = formatAlertTime(base + second, base + 60);
      const wanted = new Date((base + second) * 1000).getSeconds();
      expect(text.slice(-2), String(second)).toBe(
        String(wanted).padStart(2, "0"),
      );
      expect(text).toMatch(/\d{2}\.\d{2}\.\d{2}$/);
    }
  });

  test("detik demi detik berbeda dan bertambah satu per satu", () => {
    const base = Math.floor(Date.UTC(2026, 9, 7, 7, 59, 55) / 1000);
    const texts = Array.from({ length: 12 }, (_, i) =>
      formatAlertTime(base + i, base + 20),
    );
    expect(new Set(texts).size).toBe(12);
    // Melewati pergantian menit dan jam tanpa melompat.
    const seconds = texts.map((text) => Number(text.slice(-2)));
    for (let i = 1; i < seconds.length; i += 1) {
      expect((seconds[i] - seconds[i - 1] + 60) % 60).toBe(1);
    }
  });

  test("keterangan sumber waktu untuk semua kombinasi yang ada pada data", () => {
    const seen = new Map<string, string>();
    for (const t of GRID) {
      for (const alert of mockActiveAlerts(t)) {
        const key = `${alert.timeSource}/${alert.timeUncertaintySeconds}/${alert.kind}`;
        if (!seen.has(key)) seen.set(key, describeTimeSource(alert).short);
      }
    }
    expect(Object.fromEntries(seen)).toEqual({
      "poll/1/queue": "polling ±1 detik",
      "poll/5/cpu": "polling ±5 detik",
      "poll/10/port": "polling ±10 detik",
      "poll/60/optical": "polling ±1 menit",
      "event/0/offline": "dari router",
      "poll/30/offline": "polling ±30 detik",
    });
    for (const [kind, seconds] of Object.entries(POLL_SECONDS)) {
      expect(seconds, kind).toBeGreaterThan(0);
    }
  });
});

test("jam sama di setiap zona waktu, dan atribut waktunya tetap UTC yang sama", async ({
  browser,
}) => {
  const { t, alerts } = firstTimeWith(() => true);
  const first = await browser.newContext({ baseURL: "http://localhost:3101" });
  const seedPage = await first.newPage();
  const cookies = await signUp(first, seedPage);
  await first.close();

  const zones = [
    "Asia/Jakarta",
    "Asia/Makassar",
    "Asia/Jayapura",
    "UTC",
    "America/Los_Angeles",
  ];
  const isoByZone: Record<string, string[]> = {};
  for (const zone of zones) {
    const { context, page } = await contextIn(browser, zone, cookies);
    await page.clock.install({ time: t * 1000 });
    await page.goto("/app/alert");
    const rows = page.getByTestId("alert-row");
    await expect(rows).toHaveCount(alerts.length);
    const shown = await rows.evaluateAll((items) =>
      items.map((item) => ({
        id: item.getAttribute("data-alert-id")!,
        text: item.querySelector("time")!.textContent!.trim(),
        iso: item.querySelector("time")!.getAttribute("datetime")!,
      })),
    );
    const clock = clockIn(zone);
    const day = dayIn(zone);
    for (const row of shown) {
      const alert = alerts.find((item) => item.id === row.id)!;
      const instant = new Date(alert.startedAt * 1000);
      // Jam persis sama dengan jam di zona itu; tanggal hanya bila bukan hari ini.
      const sameDay = day.format(instant) === day.format(new Date(t * 1000));
      const expected = sameDay
        ? clock.format(instant)
        : `${day.format(instant)}, ${clock.format(instant)}`;
      expect(row.text, `${zone} ${row.id}`).toBe(expected);
    }
    isoByZone[zone] = shown.map((row) => row.iso);
    await context.close();
  }
  // Atribut dateTime tidak bergantung pada zona waktu.
  for (const zone of zones)
    expect(isoByZone[zone]).toEqual(isoByZone["Asia/Jakarta"]);
});

test("alert dari hari sebelumnya ditulis dengan tanggalnya, yang hari ini tidak", async ({
  browser,
}) => {
  const zone = "Asia/Jakarta";
  const day = dayIn(zone);
  const clock = clockIn(zone);
  const { t, alerts } = firstTimeWith(
    (alert, now) =>
      day.format(new Date(alert.startedAt * 1000)) !==
      day.format(new Date(now * 1000)),
  );
  const first = await browser.newContext({ baseURL: "http://localhost:3101" });
  const cookies = await signUp(first, await first.newPage());
  await first.close();
  const { context, page } = await contextIn(browser, zone, cookies);
  await page.clock.install({ time: t * 1000 });
  await page.goto("/app/alert");
  await expect(page.getByTestId("alert-row")).toHaveCount(alerts.length);

  let withDate = 0;
  for (const alert of alerts) {
    const text = await page
      .locator(`[data-alert-id="${alert.id}"] time`)
      .innerText();
    const instant = new Date(alert.startedAt * 1000);
    const sameDay = day.format(instant) === day.format(new Date(t * 1000));
    if (sameDay) {
      expect(text, alert.id).toBe(clock.format(instant));
      expect(text).not.toContain(",");
    } else {
      withDate += 1;
      expect(text, alert.id).toBe(
        `${day.format(instant)}, ${clock.format(instant)}`,
      );
    }
  }
  expect(withDate).toBeGreaterThan(0);
  await context.close();
});

test("setiap kombinasi sumber waktu tampil benar di daftar", async ({
  browser,
}) => {
  const combos = [
    (a: ActiveAlert) =>
      a.timeSource === "event" && a.timeUncertaintySeconds === 0,
    (a: ActiveAlert) => a.timeSource === "poll" && a.kind === "queue",
    (a: ActiveAlert) => a.timeSource === "poll" && a.kind === "cpu",
    (a: ActiveAlert) => a.timeSource === "poll" && a.kind === "port",
    (a: ActiveAlert) => a.timeSource === "poll" && a.kind === "optical",
    (a: ActiveAlert) => a.timeSource === "poll" && a.kind === "offline",
  ];
  const picks = combos.map((combo) => {
    const { t, alerts } = firstTimeWith((alert) => combo(alert));
    return { t, alert: alerts.find(combo)! };
  });
  expect(
    new Set(picks.map((pick) => describeTimeSource(pick.alert).short)).size,
  ).toBe(6);

  const first = await browser.newContext({ baseURL: "http://localhost:3101" });
  const cookies = await signUp(first, await first.newPage());
  await first.close();
  const { context, page } = await contextIn(browser, "Asia/Jakarta", cookies);
  await page.clock.install({ time: picks[0].t * 1000 });
  await page.goto("/app/alert");
  await expect(page.getByTestId("alert-row").first()).toBeVisible();

  for (const { t, alert } of picks) {
    // Waktu dipindah; daftar menyegarkan diri pada putaran berikutnya.
    await page.clock.setFixedTime(t * 1000);
    await page.clock.runFor(5_100);
    const row = page.locator(`[data-alert-id="${alert.id}"]`);
    await expect(row).toBeVisible();
    const marker = row.locator("[data-time-source]");
    const wanted = describeTimeSource(alert);
    await expect(marker).toHaveAttribute("data-time-source", alert.timeSource);
    await expect(marker).toContainText(wanted.short);
    await expect(marker).toContainText(wanted.long);
    await expect(marker).toHaveAttribute("title", wanted.long);
    // Jam ditulis sampai detik, di dalam <time> yang menyebut detiknya juga.
    await expect(row.locator("time")).toHaveText(
      new RegExp(
        `${clockIn("Asia/Jakarta").format(new Date(alert.startedAt * 1000))}$`,
      ),
    );
    expect(await row.locator("time").getAttribute("datetime")).toBe(
      new Date(alert.startedAt * 1000).toISOString(),
    );
  }
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`penanda sumber waktu terbaca jelas di tema ${scheme}`, async ({
    browser,
  }) => {
    const { t, alerts } = firstTimeWith((alert) => alert.timeSource === "poll");
    const first = await browser.newContext({
      baseURL: "http://localhost:3101",
    });
    const cookies = await signUp(first, await first.newPage());
    await first.close();
    const { context, page } = await contextIn(
      browser,
      "Asia/Jakarta",
      cookies,
      scheme,
    );
    await page.clock.install({ time: t * 1000 });
    await page.goto("/app/alert");
    await expect(page.getByTestId("alert-row")).toHaveCount(alerts.length);

    // Kontras teks penanda terhadap latar kartu (WCAG AA: 4,5 : 1).
    const ratio = await page.evaluate(() => {
      const toRgb = (color: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b];
      };
      const luminance = ([r, g, b]: number[]) => {
        const channel = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const marker = document.querySelector("[data-time-source]")!;
      const row = marker.closest("[data-testid=alert-row]")!;
      // Baris peringatan bisa bertinta; pakai latar kartu sebagai dasar terburuk
      // dan latar baris bila ia buram.
      const card = marker.closest("[data-slot=card]")!;
      const text = toRgb(getComputedStyle(marker).color);
      const rowBackground = getComputedStyle(row).backgroundColor;
      const background = toRgb(
        rowBackground === "rgba(0, 0, 0, 0)"
          ? getComputedStyle(card).backgroundColor
          : rowBackground,
      );
      const [hi, lo] = [luminance(text), luminance(background)].sort(
        (a, b) => b - a,
      );
      return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    await context.close();
  });
}
