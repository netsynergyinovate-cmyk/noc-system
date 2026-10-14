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
  mockResolvedAlerts,
  summarizeAlertSeverity,
} from "../src/lib/dashboard/alerts";
import { GRID, findMoments } from "./alert-moments";

// Halaman membaca satu store alert yang diisi hub, bukan menarik sendiri:
// berpindah halaman tidak memuat ulang apa pun, dan perubahan sampai ke layar
// dalam satu detik (jam hub), bukan tiap lima detik (jam polling lama). Jam
// browser dipasang palsu pada momen yang dipilih dari data tiruannya sendiri.

const headers = { Origin: "http://localhost:3101" };

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function signUp(context: BrowserContext): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name: "Petugas Store Alert",
    email: `store-alert-${randomUUID()}@example.com`,
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

async function contextFor(browser: Browser, cookies: Cookies) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
    timezoneId: "Asia/Jakarta",
  });
  await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}

// Membuka halaman pada detik tertentu; jamnya tidak maju sendiri.
async function open(page: Page, path: string, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto(path);
}

async function moveTo(page: Page, seconds: number, runMs: number) {
  await page.clock.setFixedTime(seconds * 1000);
  await page.clock.runFor(runMs);
}

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context);
  await context.close();
});

test("berpindah dari dasbor ke halaman Alert tidak memuat ulang dan tidak menampilkan kerangka pemuatan", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  const errors: string[] = [];
  const { context, page } = await contextFor(browser, cookies);
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "/app", mixed.t);
  const badge = page.getByTestId("anomaly-badge");
  await expect(badge).toHaveAttribute(
    "data-count",
    String(mixed.summary.total),
  );

  // Tanda bahwa halamannya tidak dimuat ulang, dan pengamat yang mencatat bila
  // kerangka pemuatan daftar muncul sesudah ini.
  await page.evaluate(() => {
    const w = window as unknown as { kept: boolean; sawSkeleton: boolean };
    w.kept = true;
    w.sawSkeleton = false;
    new MutationObserver(() => {
      if (
        document.querySelector(
          '[aria-label="Memuat daftar alert"], [aria-label="Memuat riwayat alert"]',
        )
      )
        w.sawSkeleton = true;
    }).observe(document.body, { childList: true, subtree: true });
  });

  await page
    .getByRole("navigation", { name: "Menu utama" })
    .getByRole("link", { name: "Alert", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/alert$/);
  const card = page.getByTestId("active-alerts");
  await expect(card).toHaveAttribute("data-count", String(mixed.summary.total));
  await expect(page.getByTestId("resolved-alert-row").first()).toBeVisible();

  const flags = await page.evaluate(() => {
    const w = window as unknown as { kept: boolean; sawSkeleton: boolean };
    return { kept: w.kept, sawSkeleton: w.sawSkeleton };
  });
  expect(flags.kept).toBe(true);
  expect(flags.sawSkeleton).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});

test("alert yang selesai berpindah ke riwayat dalam satu detik, bukan menunggu putaran lima detik", async ({
  browser,
}) => {
  const { mixed } = findMoments();
  // Alert aktif pada momen ini yang paling cepat selesai, dan detik selesainya.
  const later = new Map(
    mockResolvedAlerts(mixed.t + 6_000).map((alert) => [alert.id, alert]),
  );
  const moving = mockActiveAlerts(mixed.t)
    .map((alert) => later.get(alert.id)!)
    .sort((a, b) => a.endedAt - b.endedAt)[0];
  const end = moving.endedAt;

  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", end - 1);
  const activeRow = page.locator(
    `[data-testid=alert-row][data-alert-id="${moving.id}"]`,
  );
  await expect(activeRow).toBeVisible();

  // Satu detik berlalu dan alert itu selesai: pesan hub tiba pada detak berikutnya.
  await moveTo(page, end, 1_100);
  await expect(activeRow).toHaveCount(0);
  await expect(page.getByTestId("resolved-alert-row").first()).toHaveAttribute(
    "data-alert-id",
    moving.id,
  );
  const active = mockActiveAlerts(end);
  await expect(page.getByTestId("active-alerts")).toHaveAttribute(
    "data-count",
    String(active.length),
  );
  await context.close();
});

test("alert baru tampil di daftar aktif dalam satu detik sejak terdeteksi", async ({
  browser,
}) => {
  // Alert yang belum aktif sedetik sebelum terdeteksi dan sudah aktif pada detiknya.
  const { mixed } = findMoments();
  const candidate = mockResolvedAlerts(mixed.t + 86_400).find(
    (alert) =>
      !mockActiveAlerts(alert.detectedAt - 1).some((a) => a.id === alert.id) &&
      mockActiveAlerts(alert.detectedAt).some((a) => a.id === alert.id),
  )!;
  expect(candidate).toBeTruthy();
  const at = candidate.detectedAt;
  const before = summarizeAlertSeverity(mockActiveAlerts(at - 1));
  const after = summarizeAlertSeverity(mockActiveAlerts(at));

  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", at - 1);
  const card = page.getByTestId("active-alerts");
  await expect(card).toHaveAttribute("data-count", String(before.total));
  await expect(
    page.locator(`[data-testid=alert-row][data-alert-id="${candidate.id}"]`),
  ).toHaveCount(0);

  await moveTo(page, at, 1_100);
  await expect(card).toHaveAttribute("data-count", String(after.total));
  await expect(card).toHaveAttribute("data-critical", String(after.critical));
  await expect(
    page.locator(`[data-testid=alert-row][data-alert-id="${candidate.id}"]`),
  ).toBeVisible();
  await context.close();
});

test("lompatan waktu jauh (komputer tidur): daftar dan riwayat dimuat ulang dari snapshot", async ({
  browser,
}) => {
  const { mixed, empty } = findMoments();
  const errors: string[] = [];
  const { context, page } = await contextFor(browser, cookies);
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "/app/alert", mixed.t);
  const card = page.getByTestId("active-alerts");
  await expect(card).toHaveAttribute("data-count", String(mixed.summary.total));
  const firstBefore = await page
    .getByTestId("resolved-alert-row")
    .first()
    .getAttribute("data-alert-id");

  // Berhari-hari kemudian: celahnya terlalu besar untuk ditambal detik demi detik.
  await moveTo(page, empty.t, 1_100);
  await expect(card).toHaveAttribute("data-count", "0");
  await expect(card).toHaveAttribute("data-tone", "ok");
  const expected = mockResolvedAlerts(empty.t)[0].id;
  await expect(page.getByTestId("resolved-alert-row").first()).toHaveAttribute(
    "data-alert-id",
    expected,
  );
  expect(expected).not.toBe(firstBefore);
  await expect(
    page.getByTestId("resolved-alerts").getByText(/alert selesai dalam 7 hari/),
  ).toBeVisible();

  // Dan kembali ke momen semula: keadaan semula, tanpa sisa yang sebelumnya.
  await moveTo(page, mixed.t, 1_100);
  await expect(card).toHaveAttribute("data-count", String(mixed.summary.total));
  await expect(page.getByTestId("resolved-alert-row").first()).toHaveAttribute(
    "data-alert-id",
    firstBefore!,
  );
  expect(errors).toEqual([]);
  await context.close();
});

// Momen yang daftar aktif dan tiga halaman pertama riwayatnya sama persis 30
// detik kemudian: tidak ada alert yang mulai atau selesai di antaranya.
function findQuietMoment() {
  const signature = (t: number) =>
    JSON.stringify([
      mockActiveAlerts(t),
      mockResolvedAlerts(t)
        .slice(0, 45)
        .map((alert) => alert.id),
    ]);
  const t = GRID.find(
    (candidate) => signature(candidate) === signature(candidate + 30),
  );
  if (t === undefined) throw new Error("tidak ada momen yang tenang");
  return t;
}

test("pesan alert tidak mengganggu halaman riwayat yang sedang dilihat", async ({
  browser,
}) => {
  const quiet = findQuietMoment();
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", quiet);
  await expect(page.getByTestId("resolved-alert-row")).toHaveCount(15);
  await page.getByRole("button", { name: "Berikutnya" }).click();
  const status = page.getByTestId("resolved-page-status");
  await expect(status).toHaveText(/^Halaman 2 /);
  const firstOnPage2 = await page
    .getByTestId("resolved-alert-row")
    .first()
    .getAttribute("data-alert-id");

  // Waktu berjalan 20 detik tanpa alert yang berubah: halaman 2 tetap, sama isinya.
  await moveTo(page, quiet + 20, 20_000);
  await expect(status).toHaveText(/^Halaman 2 /);
  await expect(page.getByTestId("resolved-alert-row").first()).toHaveAttribute(
    "data-alert-id",
    firstOnPage2!,
  );
  await context.close();
});
