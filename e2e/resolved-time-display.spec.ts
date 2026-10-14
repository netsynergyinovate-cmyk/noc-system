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
  describeTimeSource,
  mockResolvedAlerts,
  type ResolvedAlert,
} from "../src/lib/dashboard/alerts";

// Waktu mulai dan waktu selesai pada riwayat alert: sampai detik, di zona waktu
// mana pun, dengan tanggal hanya bila bukan hari ini, dengan penanda sumber
// waktunya masing-masing, dan dengan lama yang cocok dengan kedua jam itu. Jam
// browser dipasang palsu pada momen yang dipilih dari data tiruannya sendiri.

const headers = { Origin: "http://localhost:3101" };
const START = 1_791_400_000;
const PAGE = ALERT_HISTORY_PAGE_SIZE;
const JAKARTA = "Asia/Jakarta";

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
const hourIn = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

// Teks yang harus tampil: jam sampai detik, dengan tanggal di depannya bila
// bukan hari yang sama dengan `now` menurut zona itu.
function expectedText(zone: string, seconds: number, now: number) {
  const day = dayIn(zone);
  const at = new Date(seconds * 1000);
  const sameDay = day.format(at) === day.format(new Date(now * 1000));
  return sameDay
    ? clockIn(zone).format(at)
    : `${day.format(at)}, ${clockIn(zone).format(at)}`;
}

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function signUp(context: BrowserContext): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name: "Petugas Waktu Riwayat",
    email: `riwayat-waktu-${randomUUID()}@example.com`,
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
  cookies: Cookies,
  colorScheme: "light" | "dark" = "light",
  viewport?: { width: number; height: number },
) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
    timezoneId,
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
  await expect(page.getByTestId("resolved-alert-row").first()).toBeVisible();
}

// Membaca teks waktu tiap baris riwayat yang tampil.
function readRows(page: Page) {
  return page.getByTestId("resolved-alert-row").evaluateAll((rows) =>
    rows.map((row) => ({
      id: row.getAttribute("data-alert-id")!,
      startText: row.querySelectorAll("time")[0].textContent!.trim(),
      startIso: row.querySelectorAll("time")[0].getAttribute("datetime")!,
      endText: row
        .querySelector("[data-testid=resolved-ended-at]")!
        .textContent!.trim(),
      endIso: row
        .querySelector("[data-testid=resolved-ended-at]")!
        .getAttribute("datetime")!,
      lastedText: row
        .querySelector("[data-testid=resolved-lasted]")!
        .textContent!.trim(),
    })),
  );
}

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context);
  await context.close();
});

// Detik pada data tiruan, di sekitar tengah hari menurut Jakarta supaya
// seluruh halaman pertama jatuh pada hari yang sama.
function findMidday() {
  for (let t = START; t < START + 7 * 86_400; t += 300) {
    const [hour] = hourIn(JAKARTA)
      .format(new Date(t * 1000))
      .split(":");
    if (hour === "14") return t;
  }
  throw new Error("tidak ada waktu tengah hari pada data tiruan");
}

test("jam mulai dan selesai sama di setiap zona waktu, dan atribut waktunya tetap UTC yang sama", async ({
  browser,
}) => {
  const t = findMidday();
  const shown = mockResolvedAlerts(t).slice(0, PAGE);
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
    await openAlertsAt(page, t);
    await expect(page.getByTestId("resolved-alert-row")).toHaveCount(PAGE);
    const rows = await readRows(page);
    expect(rows.map((row) => row.id)).toEqual(shown.map((a) => a.id));
    for (const [index, row] of rows.entries()) {
      const alert = shown[index];
      // Jam persis sama dengan jam di zona itu, sampai detik, mulai dan selesai.
      expect(row.startText, `${zone} ${row.id} mulai`).toBe(
        expectedText(zone, alert.startedAt, t),
      );
      expect(row.endText, `${zone} ${row.id} selesai`).toBe(
        expectedText(zone, alert.endedAt, t),
      );
      expect(row.startText).toMatch(/\d{2}\.\d{2}\.\d{2}$/);
      expect(row.endText).toMatch(/\d{2}\.\d{2}\.\d{2}$/);
      // Atribut waktu adalah detik bulat dalam UTC, apa pun zonanya.
      expect(row.startIso).toBe(new Date(alert.startedAt * 1000).toISOString());
      expect(row.endIso).toBe(new Date(alert.endedAt * 1000).toISOString());
      expect(row.startIso).toMatch(/:\d{2}\.000Z$/);
      expect(row.endIso).toMatch(/:\d{2}\.000Z$/);
    }
    isoByZone[zone] = rows.flatMap((row) => [row.startIso, row.endIso]);
    await context.close();
  }
  for (const zone of zones) expect(isoByZone[zone]).toEqual(isoByZone[JAKARTA]);
});

// Waktu sedikit sesudah tengah malam di Jakarta, ketika halaman pertama berisi
// alert yang mulai kemarin dan selesai hari ini, yang seluruhnya hari ini, dan
// yang seluruhnya kemarin.
function findAfterMidnight() {
  const day = dayIn(JAKARTA);
  for (let t = START; t < START + 7 * 86_400; t += 300) {
    const [hour] = hourIn(JAKARTA)
      .format(new Date(t * 1000))
      .split(":");
    if (hour !== "00" && hour !== "01") continue;
    const sameDay = (seconds: number) =>
      day.format(new Date(seconds * 1000)) === day.format(new Date(t * 1000));
    const first = mockResolvedAlerts(t).slice(0, PAGE);
    const crossing = first.filter(
      (a) => !sameDay(a.startedAt) && sameDay(a.endedAt),
    );
    const today = first.filter(
      (a) => sameDay(a.startedAt) && sameDay(a.endedAt),
    );
    const yesterday = first.filter((a) => !sameDay(a.endedAt));
    if (crossing.length && today.length && yesterday.length) {
      return { t, first, crossing, today, yesterday, sameDay };
    }
  }
  throw new Error(
    "tidak ada waktu dengan ketiga jenis alert di halaman pertama",
  );
}

test("tanggal ditulis hanya bila bukan hari ini, untuk waktu mulai dan waktu selesai secara terpisah", async ({
  browser,
}) => {
  const { t, first, crossing, today, yesterday } = findAfterMidnight();
  const { context, page } = await contextIn(browser, JAKARTA, cookies);
  await openAlertsAt(page, t);
  await expect(page.getByTestId("resolved-alert-row")).toHaveCount(PAGE);
  const rows = new Map((await readRows(page)).map((row) => [row.id, row]));

  const hasDate = (text: string) => text.includes(",");
  for (const alert of first) {
    const row = rows.get(alert.id)!;
    expect(row.startText).toBe(expectedText(JAKARTA, alert.startedAt, t));
    expect(row.endText).toBe(expectedText(JAKARTA, alert.endedAt, t));
  }
  // Mulai kemarin, selesai hari ini: hanya waktu mulai yang memakai tanggal.
  for (const alert of crossing) {
    const row = rows.get(alert.id)!;
    expect(hasDate(row.startText), `${alert.id} mulai`).toBe(true);
    expect(hasDate(row.endText), `${alert.id} selesai`).toBe(false);
  }
  // Seluruhnya hari ini: tanpa tanggal sama sekali.
  for (const alert of today) {
    const row = rows.get(alert.id)!;
    expect(hasDate(row.startText) || hasDate(row.endText), alert.id).toBe(
      false,
    );
  }
  // Selesai kemarin: keduanya memakai tanggal.
  for (const alert of yesterday) {
    const row = rows.get(alert.id)!;
    expect(hasDate(row.startText), `${alert.id} mulai`).toBe(true);
    expect(hasDate(row.endText), `${alert.id} selesai`).toBe(true);
  }
  await context.close();
});

// Satu alert untuk tiap pasangan sumber (waktu mulai / waktu selesai) yang
// ketika baru selesai berada di baris paling atas riwayat.
function findOnePerCombo() {
  const combos = new Map<string, ResolvedAlert>();
  const list = mockResolvedAlerts(START + 4 * 86_400);
  for (const alert of list) {
    const key = `${alert.timeSource}/${alert.endTimeSource}`;
    if (combos.has(key)) continue;
    // Tidak ada alert lain yang selesai pada detik yang sama atau sesudahnya
    // sampai satu detik kemudian, jadi pasti paling atas pada detik itu.
    const top = mockResolvedAlerts(alert.endedAt + 1)[0];
    if (top.id === alert.id) combos.set(key, alert);
  }
  expect([...combos.keys()].sort()).toEqual([
    "event/event",
    "event/poll",
    "poll/event",
    "poll/poll",
  ]);
  return combos;
}

test("setiap pasangan sumber waktu mulai dan selesai tampil benar pada barisnya", async ({
  browser,
}) => {
  const combos = [...findOnePerCombo().entries()];
  const { context, page } = await contextIn(browser, JAKARTA, cookies);
  await openAlertsAt(page, combos[0][1].endedAt + 1);

  for (const [key, alert] of combos) {
    // Waktu dipindah; riwayat menyegarkan diri pada putaran berikutnya.
    await page.clock.setFixedTime((alert.endedAt + 1) * 1000);
    await page.clock.runFor(5_100);
    const row = page.getByTestId("resolved-alert-row").first();
    await expect(row, key).toHaveAttribute("data-alert-id", alert.id);

    const start = describeTimeSource(alert, "start");
    const end = describeTimeSource(
      {
        timeSource: alert.endTimeSource,
        timeUncertaintySeconds: alert.endTimeUncertaintySeconds,
      },
      "end",
    );
    const startMarker = row.locator("[data-time-source]");
    const endMarker = row.locator("[data-end-time-source]");
    await expect(startMarker, key).toHaveAttribute(
      "data-time-source",
      alert.timeSource,
    );
    await expect(endMarker, key).toHaveAttribute(
      "data-end-time-source",
      alert.endTimeSource,
    );
    // Tulisan pendek, penjelasan lengkap untuk pembaca layar, dan tooltip.
    await expect(startMarker).toContainText(start.short);
    await expect(startMarker).toContainText(start.long);
    await expect(startMarker).toHaveAttribute("title", start.long);
    await expect(endMarker).toContainText(end.short);
    await expect(endMarker).toContainText(end.long);
    await expect(endMarker).toHaveAttribute("title", end.long);
    // Waktu mulai bicara tentang kejadian, waktu selesai tentang pulihnya.
    expect(start.long).not.toContain("pulih");
    expect(end.long).toContain("pulih");
  }
  await context.close();
});

// "selama 12 menit 30 detik" menjadi detik. Mulai satu jam detiknya dibuang.
function parseElapsed(text: string) {
  const parts = {
    jam: /(\d+) jam/.exec(text)?.[1],
    menit: /(\d+) menit/.exec(text)?.[1],
    detik: /(\d+) detik/.exec(text)?.[1],
  };
  return (
    Number(parts.jam ?? 0) * 3600 +
    Number(parts.menit ?? 0) * 60 +
    Number(parts.detik ?? 0)
  );
}

// "01.50.54" menjadi detik sejak tengah malam.
function clockSeconds(text: string) {
  const [h, m, s] = text.slice(-8).split(".").map(Number);
  return h * 3600 + m * 60 + s;
}

test("lamanya cocok dengan selisih jam mulai dan jam selesai yang tertulis, sampai detik", async ({
  browser,
}) => {
  const t = findMidday();
  const { context, page } = await contextIn(browser, JAKARTA, cookies);
  await openAlertsAt(page, t);
  await expect(page.getByTestId("resolved-alert-row")).toHaveCount(PAGE);
  const rows = await readRows(page);
  let underHour = 0;
  let overHour = 0;
  for (const row of rows) {
    // Seluruh halaman pertama jatuh pada hari yang sama pada waktu ini.
    expect(row.startText.includes(","), row.id).toBe(false);
    const difference = clockSeconds(row.endText) - clockSeconds(row.startText);
    const lasted = parseElapsed(row.lastedText);
    if (difference < 3600) {
      // Di bawah satu jam sampai detik, persis selisih kedua jam yang tampil.
      expect(lasted, `${row.id} ${row.lastedText}`).toBe(difference);
      underHour += 1;
    } else {
      // Mulai satu jam detiknya dibuang: selisih dibulatkan ke bawah per menit.
      expect(lasted, `${row.id} ${row.lastedText}`).toBe(
        Math.floor(difference / 60) * 60,
      );
      overHour += 1;
    }
  }
  expect(underHour).toBeGreaterThan(2);
  expect(overHour).toBeGreaterThan(0);
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`penanda waktu selesai terbaca jelas di tema ${scheme}`, async ({
    browser,
  }) => {
    const { context, page } = await contextIn(
      browser,
      JAKARTA,
      cookies,
      scheme,
    );
    await openAlertsAt(page, findMidday());

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
      const marker = document.querySelector("[data-end-time-source]")!;
      const card = marker.closest("[data-slot=card]")!;
      const text = toRgb(getComputedStyle(marker).color);
      const background = toRgb(getComputedStyle(card).backgroundColor);
      const [hi, lo] = [luminance(text), luminance(background)].sort(
        (a, b) => b - a,
      );
      return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    await context.close();
  });
}

test("di layar sempit waktu selesai dan penandanya terjangkau dengan menggulir tabel", async ({
  browser,
}) => {
  const { context, page } = await contextIn(
    browser,
    JAKARTA,
    cookies,
    "light",
    { width: 390, height: 844 },
  );
  await openAlertsAt(page, findMidday());
  const row = page.getByTestId("resolved-alert-row").first();
  const marker = row.locator("[data-end-time-source]");
  const time = row.getByTestId("resolved-ended-at");
  await marker.scrollIntoViewIfNeeded();
  await expect(time).toBeInViewport({ ratio: 1 });
  await expect(marker).toBeInViewport({ ratio: 1 });
  // Halamannya sendiri tidak melebar; yang menggulir hanya tabelnya.
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await context.close();
});
