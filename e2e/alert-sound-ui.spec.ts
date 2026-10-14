import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createMockAlertHub } from "../src/lib/dashboard/alert-sync";
import {
  createAlertSoundTracker,
  soundKindFor,
  soundPatterns,
} from "../src/lib/dashboard/alert-sound";
import { GRID, findMoments } from "./alert-moments";

// Suara alert di halaman sungguhan. AudioContext diganti tiruan yang mencatat nada
// yang dijadwalkan (suara tidak bisa didengar tes), jadi yang diperiksa adalah
// pengkabelannya: alert baru lewat store sampai ke mesin bunyi, sekali, dengan
// pola yang benar, dan tombol bisu bekerja. Jam browser dipasang palsu.

const headers = { Origin: "http://localhost:3101" };
const FIRST_FREQUENCY = {
  test: soundPatterns.test[0].frequency,
  warning: soundPatterns.warning[0].frequency,
  critical: soundPatterns.critical[0].frequency,
};

// Dijalankan di browser sebelum halaman mana pun: AudioContext tiruan.
function installFakeAudio() {
  const log = {
    contexts: 0,
    resumes: 0,
    tones: [] as Array<{ frequency: number; start: number }>,
  };
  (window as unknown as { __audio: typeof log }).__audio = log;
  class FakeAudioContext {
    state = "suspended";
    currentTime = 0;
    destination = { name: "destination" };
    constructor() {
      log.contexts += 1;
    }
    resume() {
      this.state = "running";
      log.resumes += 1;
      return Promise.resolve();
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect(node: unknown) {
          return node;
        },
      };
    }
    createOscillator() {
      const oscillator = {
        type: "square",
        frequency: { value: 0 },
        connect(node: unknown) {
          return node;
        },
        start(time: number) {
          log.tones.push({
            frequency: oscillator.frequency.value,
            start: time,
          });
        },
        stop() {},
      };
      return oscillator;
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext =
    FakeAudioContext;
}

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function signUp(context: BrowserContext): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name: "Petugas Suara Alert",
    email: `suara-alert-${randomUUID()}@example.com`,
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
  await context.addInitScript(installFakeAudio);
  await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}

async function open(page: Page, path: string, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto(path);
}

// Halaman sudah dimuat dan terpasang: lencana atau kartu alert sudah berisi, berarti
// data sudah masuk store dan pengendali suara sudah menunggu klik pertama.
async function ready(page: Page) {
  await expect(
    page
      .locator(
        "[data-testid=anomaly-badge][data-count], [data-testid=active-alerts][data-count]",
      )
      .first(),
  ).toBeVisible();
}

async function moveTo(page: Page, seconds: number) {
  await page.clock.setFixedTime(seconds * 1000);
  await page.clock.runFor(1_100);
}

type Kind = "test" | "warning" | "critical";

// Bunyi yang terdengar sejauh ini: nada dikelompokkan, satu bunyi dimulai pada
// nada yang mulainya 0.
async function sounds(page: Page): Promise<Kind[]> {
  const tones = await page.evaluate(
    () =>
      (
        window as unknown as {
          __audio: { tones: Array<{ frequency: number; start: number }> };
        }
      ).__audio.tones,
  );
  const kinds: Kind[] = [];
  for (const tone of tones) {
    if (tone.start !== 0 && kinds.length > 0) continue;
    kinds.push(
      (Object.entries(FIRST_FREQUENCY).find(
        ([, frequency]) => frequency === tone.frequency,
      )?.[0] ?? "critical") as Kind,
    );
  }
  return kinds;
}

const toggle = (page: Page) =>
  page.getByRole("button", { name: "Suara alert" });
const audio = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __audio: { contexts: number; resumes: number } })
        .__audio,
  );

// Yang seharusnya berbunyi pada tiap langkah waktu (`true` bila lompatan terlalu
// besar untuk ditambal detik demi detik, jadi dimuat ulang dari snapshot).
function expectedSounds(t0: number, times: number[]) {
  const hub = createMockAlertHub();
  const tracker = createAlertSoundTracker();
  const first = hub.snapshot(t0);
  tracker.observe(first.active);
  let current = first.active;
  let last = t0;
  return times.map((t) => {
    if (t - last > 300 || t < last) current = hub.snapshot(t).active;
    else current = hub.changes(t)?.active ?? current;
    last = t;
    const fresh = tracker.observe(current);
    return fresh.length > 0 ? soundKindFor(fresh) : null;
  });
}

// Awal dan langkah-langkah (100 detik) dari sebuah rentang yang punya sedikitnya
// `needed` langkah berbunyi, supaya skenario punya yang dibunyikan dan yang dibisukan.
function findWindow(needed: number, count = 70, step = 100) {
  for (const t0 of GRID) {
    const times = Array.from({ length: count }, (_, i) => t0 + (i + 1) * step);
    const expected = expectedSounds(t0, times);
    if (expected.filter(Boolean).length >= needed) {
      return { t0, times, expected };
    }
  }
  throw new Error("tidak ada rentang dengan cukup alert baru");
}

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context);
  await context.close();
});

test("alert yang sudah ada saat halaman dibuka tidak berbunyi, dan klik pertama membuka suara", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", mixed.t);
  await ready(page);
  await expect(page.getByTestId("active-alerts")).toHaveAttribute(
    "data-count",
    String(mixed.summary.total),
  );
  // Sebelum ada interaksi, browser menahan suara dan tombol menyebutnya.
  await expect(toggle(page)).toHaveAttribute("data-state", "waiting");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  expect((await audio(page)).resumes).toBe(0);

  await page.mouse.click(5, 300);
  await expect(toggle(page)).toHaveAttribute("data-state", "on");
  expect((await audio(page)).resumes).toBe(1);
  // Alert yang sudah ada bukan gangguan baru: tidak ada bunyi sama sekali.
  await moveTo(page, mixed.t + 2);
  expect(await sounds(page)).toEqual([]);
  await context.close();
});

test("setiap gangguan baru berbunyi sekali, dengan pola sesuai tingkatnya, dan yang bertahan tidak berbunyi lagi", async ({
  browser,
}) => {
  const { t0, times, expected } = findWindow(4);
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t0);
  await ready(page);
  await page.mouse.click(5, 300);
  await expect(toggle(page)).toHaveAttribute("data-state", "on");

  const heard: Kind[] = [];
  for (const [index, t] of times.entries()) {
    await moveTo(page, t);
    const kind = expected[index];
    if (kind) heard.push(kind);
    // Setelah tiap langkah, yang terdengar persis sama dengan yang diharapkan:
    // yang sudah berbunyi tidak mengulang, dan yang baru berbunyi sekali.
    expect(await sounds(page), `langkah ${index} @${t}`).toEqual(heard);
  }
  expect(heard.length).toBeGreaterThanOrEqual(4);
  // Kedua pola dipakai, bukan hanya satu.
  expect(new Set(heard).size).toBeGreaterThan(1);
  await context.close();
});

test("dibisukan: gangguan baru diam dan tidak diputar ulang saat dinyalakan, lalu yang berikutnya berbunyi", async ({
  browser,
}) => {
  const { t0, times, expected } = findWindow(5);
  const sounding = expected.flatMap((kind, index) => (kind ? [index] : []));
  const [first, mutedAt, , unmutedAt] = [
    sounding[0],
    sounding[1],
    sounding[2],
    sounding[3],
  ];

  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t0);
  await ready(page);
  await page.mouse.click(5, 300);
  await expect(toggle(page)).toHaveAttribute("data-state", "on");

  const heard: Kind[] = [];
  for (const [index, t] of times.entries()) {
    if (index === mutedAt) {
      await toggle(page).click();
      await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
      await expect(toggle(page)).toHaveAttribute("data-state", "off");
    }
    if (index === unmutedAt) {
      // Menyalakan kembali memperdengarkan satu nada uji, bukan gangguan yang lewat.
      await toggle(page).click();
      await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
      heard.push("test");
    }
    await moveTo(page, t);
    const muted = index >= mutedAt && index < unmutedAt;
    const kind = expected[index];
    if (kind && !muted) heard.push(kind);
    expect(await sounds(page), `langkah ${index} @${t}`).toEqual(heard);
  }
  // Skenario benar-benar mencakup yang dibisukan dan yang kembali berbunyi.
  expect(first).toBeLessThan(mutedAt);
  expect(heard.filter((kind) => kind !== "test").length).toBeLessThan(
    expected.filter(Boolean).length,
  );
  await context.close();
});

test("beberapa gangguan baru dalam satu pembaruan berbunyi sekali, kritis bila ada yang kritis", async ({
  browser,
}) => {
  // Satu langkah besar (250 detik) yang membawa sedikitnya dua alert baru.
  let found: { t0: number; t1: number; kind: Kind } | null = null;
  for (const t0 of GRID) {
    const hub = createMockAlertHub();
    const tracker = createAlertSoundTracker();
    tracker.observe(hub.snapshot(t0).active);
    const t1 = t0 + 250;
    const message = hub.changes(t1);
    const fresh = tracker.observe(message?.active ?? []);
    if (fresh.length >= 2) {
      found = { t0, t1, kind: soundKindFor(fresh) };
      break;
    }
  }
  expect(found).not.toBeNull();
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", found!.t0);
  await ready(page);
  await page.mouse.click(5, 300);
  await expect(toggle(page)).toHaveAttribute("data-state", "on");
  await moveTo(page, found!.t1);
  expect(await sounds(page)).toEqual([found!.kind]);
  await context.close();
});

test("lompatan waktu jauh (komputer tidur): yang muncul selama itu berbunyi sekali", async ({
  browser,
}) => {
  const { mixed, empty } = findMoments();
  const expected = expectedSounds(empty.t, [mixed.t]);
  expect(expected[0]).not.toBeNull();
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", empty.t);
  await ready(page);
  await page.mouse.click(5, 300);
  await expect(toggle(page)).toHaveAttribute("data-state", "on");
  expect(await sounds(page)).toEqual([]);
  await moveTo(page, mixed.t);
  await expect(page.getByTestId("active-alerts")).toHaveAttribute(
    "data-count",
    String(mixed.summary.total),
  );
  expect(await sounds(page)).toEqual([expected[0]]);
  await context.close();
});

test("sebelum browser mengizinkan suara tidak ada bunyi, dan sesudah klik gangguan berikutnya berbunyi", async ({
  browser,
}) => {
  const { t0, times, expected } = findWindow(3);
  const sounding = expected.flatMap((kind, index) => (kind ? [index] : []));
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t0);
  await ready(page);
  await expect(toggle(page)).toHaveAttribute("data-state", "waiting");

  const heard: Kind[] = [];
  for (const [index, t] of times.entries()) {
    // Klik pertama tepat sebelum gangguan berbunyi yang kedua.
    if (index === sounding[1]) {
      await page.mouse.click(5, 300);
      await expect(toggle(page)).toHaveAttribute("data-state", "on");
    }
    await moveTo(page, t);
    const kind = expected[index];
    // Gangguan pertama datang sebelum diizinkan: tidak bisa berbunyi, dan tidak
    // diputar ulang sesudahnya.
    if (kind && index >= sounding[1]) heard.push(kind);
    expect(await sounds(page), `langkah ${index}`).toEqual(heard);
  }
  expect(heard.length).toBeGreaterThanOrEqual(2);
  await context.close();
});

test("pilihan bisu bertahan setelah halaman dimuat ulang", async ({
  browser,
}) => {
  const { t0, times, expected } = findWindow(2);
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t0);
  await ready(page);
  await page.mouse.click(5, 300);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("alertSound"))).toBe(
    "off",
  );

  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(toggle(page)).toHaveAttribute("data-state", "off");
  await page.mouse.click(5, 300);
  for (const t of times) await moveTo(page, t);
  expect(expected.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  expect(await sounds(page)).toEqual([]);
  await context.close();
});

test("menyalakan suara memperdengarkan satu nada uji, juga sebelum ada klik lain", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const { context, page } = await contextFor(browser, cookies);
  await page.addInitScript(() => localStorage.setItem("alertSound", "off"));
  await open(page, "/app/alert", mixed.t);
  await ready(page);
  await expect(toggle(page)).toHaveAttribute("data-state", "off");
  expect(await sounds(page)).toEqual([]);

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("data-state", "on");
  expect(await sounds(page)).toEqual(["test"]);
  // Dimatikan lagi: tidak ada bunyi tambahan.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("data-state", "off");
  expect(await sounds(page)).toEqual(["test"]);
  await context.close();
});

test("bunyi terdengar di halaman mana pun, tidak berulang saat berpindah halaman", async ({
  browser,
}) => {
  const { t0, times, expected } = findWindow(3);
  const { context, page } = await contextFor(browser, cookies);
  // Dasbor, bukan halaman Alert: pengendalinya ada di layout.
  await open(page, "/app", t0);
  await ready(page);
  await page.mouse.click(5, 300);
  await expect(toggle(page)).toHaveAttribute("data-state", "on");
  const menu = page.getByRole("navigation", { name: "Menu utama" });

  const heard: Kind[] = [];
  for (const [index, t] of times.entries()) {
    // Berpindah halaman di tengah jalan: tidak ada bunyi karenanya.
    if (index === 20)
      await menu.getByRole("link", { name: "Alert", exact: true }).click();
    if (index === 40)
      await menu.getByRole("link", { name: "Deteksi Anomali" }).click();
    if (index === 55)
      await menu.getByRole("link", { name: "Dashboard" }).click();
    await moveTo(page, t);
    const kind = expected[index];
    if (kind) heard.push(kind);
    expect(await sounds(page), `langkah ${index}`).toEqual(heard);
  }
  expect(heard.length).toBeGreaterThanOrEqual(3);
  // Satu konteks suara untuk seluruh sesi, tidak dibuat ulang per halaman.
  expect((await audio(page)).contexts).toBe(1);
  await context.close();
});

test("tombol suara bisa dipakai dengan papan ketik dan punya nama yang jelas", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", mixed.t);
  await ready(page);
  const button = toggle(page);
  await expect(button).toHaveAccessibleName("Suara alert");
  // innerText: tulisan keadaan lain ikut ada di DOM (tak terlihat) demi lebar tetap.
  const visible = { useInnerText: true };
  await expect(button).toContainText("Suara: menunggu klik", visible);
  await expect(button).not.toContainText("Suara: mati", visible);
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toContainText("Suara: mati", visible);
  await expect(button).not.toContainText("Suara: aktif", visible);
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toContainText("Suara: aktif", visible);
  await expect(button).not.toContainText("Suara: mati", visible);
  // Keadaannya juga diumumkan sebagai teks, di luar tombol.
  await expect(
    page.getByRole("status").filter({ hasText: "Suara alert aktif" }),
  ).toHaveCount(1);
  await context.close();
});

test("di layar sempit tombol suara ada di header dan berfungsi", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const { context, page } = await contextFor(browser, cookies, {
    width: 390,
    height: 844,
  });
  await open(page, "/app/alert", mixed.t);
  await ready(page);
  const button = toggle(page);
  await expect(button).toBeVisible();
  await expect(button).toBeInViewport({ ratio: 1 });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await context.close();
});

test("klik pertama pada tautan lain tetap bernavigasi walau sekaligus membuka suara", async ({
  browser,
}) => {
  // Layar sempit: header membungkus, jadi perubahan lebar tombol suara akan
  // menggeser menu di antara tekan dan lepas dan membuang kliknya.
  const { mixed } = findMoments();
  const { context, page } = await contextFor(browser, cookies, {
    width: 390,
    height: 844,
  });
  await open(page, "/app", mixed.t);
  await ready(page);
  await expect(toggle(page)).toHaveAttribute("data-state", "waiting");
  await page
    .getByRole("navigation", { name: "Menu halaman" })
    .getByRole("link", { name: "Alert", exact: true })
    .click();
  await expect(page).toHaveURL("/app/alert");
  // Klik itu juga yang membuka suara.
  await expect(toggle(page)).toHaveAttribute("data-state", "on");
  await context.close();
});

test("lebar tombol suara sama di semua keadaan, jadi tidak menggeser yang lain", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const { context, page } = await contextFor(browser, cookies, {
    width: 390,
    height: 844,
  });
  await open(page, "/app/alert", mixed.t);
  await ready(page);
  const widths: Record<string, number> = {};
  const measure = async (state: string) => {
    await expect(toggle(page)).toHaveAttribute("data-state", state);
    widths[state] = (await toggle(page).boundingBox())!.width;
  };
  await measure("waiting");
  await page.mouse.click(5, 300);
  await measure("on");
  await toggle(page).click();
  await measure("off");
  expect(Math.abs(widths.waiting - widths.on)).toBeLessThan(0.6);
  expect(Math.abs(widths.on - widths.off)).toBeLessThan(0.6);
  await context.close();
});
