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
  type ActiveAlert,
} from "../src/lib/dashboard/alerts";
import { formatElapsed } from "../src/lib/dashboard/format";
import { incidentLabels } from "../src/lib/dashboard/incidents";
import { GRID } from "./alert-moments";

// "Tandai ditangani" di halaman sungguhan: tombol di tiap baris, dialog konfirmasi,
// pemindahan ke riwayat, keadaan menyimpan dan gagal, alert yang selesai selagi
// dialog terbuka, dan halaman lain yang ikut sepakat. Jam browser dipasang palsu
// pada momen yang dipilih dari data tiruannya sendiri.

const OPERATOR = "Petugas Penanda";
const headers = { Origin: "http://localhost:3101" };

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

async function signUp(context: BrowserContext): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name: OPERATOR,
    email: `tandai-ditangani-${randomUUID()}@example.com`,
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

// Waktu selesai alami satu alert (tanpa penandaan).
const naturalEnd = (id: string, t: number) =>
  mockResolvedAlerts(t + 4 * 3_600).find((alert) => alert.id === id)!.endedAt;

const ids = (alerts: ActiveAlert[]) => alerts.map((alert) => alert.id).sort();

interface Scene {
  t: number;
  alerts: ActiveAlert[];
  // Alert yang ditandai: tidak selesai alami dalam sepuluh menit ke depan.
  target: ActiveAlert;
}

// Momen dengan beberapa alert aktif (kritis dan peringatan), yang daftarnya tidak
// berubah selama sembilan puluh detik (jam boleh berjalan sedikit), dan tanpa alert
// lain yang selesai tepat pada detik itu, supaya yang ditandai pasti di puncak
// riwayat.
function findScene(): Scene {
  for (const t of GRID) {
    const alerts = mockActiveAlerts(t);
    const summary = summarizeAlertSeverity(alerts);
    if (alerts.length < 4 || summary.critical === 0 || summary.warning === 0)
      continue;
    if (mockResolvedAlerts(t)[0].endedAt >= t) continue;
    const stable = [30, 60, 90].every(
      (extra) => ids(mockActiveAlerts(t + extra)).join() === ids(alerts).join(),
    );
    if (!stable) continue;
    const target = alerts.find((alert) => naturalEnd(alert.id, t) > t + 600);
    if (target) return { t, alerts, target };
  }
  throw new Error("tidak ada momen yang cocok");
}

// Momen dengan satu alert yang selesai sendiri 60 sampai 250 detik lagi.
function findEndingScene() {
  for (const t of GRID) {
    for (const alert of mockActiveAlerts(t)) {
      const end = naturalEnd(alert.id, t);
      if (end - t >= 60 && end - t <= 250) return { t, target: alert, end };
    }
  }
  throw new Error("tidak ada alert yang selesai dalam waktu dekat");
}

const scene = findScene();

async function open(page: Page, path: string, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto(path);
}

async function moveTo(page: Page, seconds: number) {
  await page.clock.setFixedTime(seconds * 1000);
  await page.clock.runFor(1_100);
}

const activeCard = (page: Page) => page.getByTestId("active-alerts");
const historyCard = (page: Page) => page.getByTestId("resolved-alerts");
const dialog = (page: Page) => page.getByRole("alertdialog");
const row = (page: Page, id: string) =>
  page.locator(`[data-testid=alert-row][data-alert-id="${id}"]`);
const historyRow = (page: Page, id: string) =>
  page.locator(`[data-testid=resolved-alert-row][data-alert-id="${id}"]`);
const handleButton = (page: Page, id: string) =>
  row(page, id).getByTestId("handle-alert");
const stored = (page: Page) =>
  page.evaluate(() => localStorage.getItem("alertHandled"));

async function ready(page: Page) {
  await expect(
    page.locator("[data-testid=active-alerts][data-count]"),
  ).toBeVisible();
}

// Dialog yang menutup tetap tampil selama animasi keluarnya (200 ms), jadi "masih
// terbuka" harus dibuktikan dengan menunggu lebih lama dari itu lalu memeriksa
// keadaannya, bukan hanya terlihat.
async function stillOpen(page: Page) {
  await page.waitForTimeout(400);
  await expect(dialog(page)).toHaveAttribute("data-state", "open");
}

async function confirmFor(page: Page, id: string) {
  await handleButton(page, id).click();
  await dialog(page)
    .getByRole("button", { name: "Ya, tandai ditangani" })
    .click();
  await expect(dialog(page)).toBeHidden();
}

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context);
  await context.close();
});

test("tiap baris alert aktif punya tombol Tandai ditangani yang namanya menyebut alertnya, dan rincian kartu insiden tidak punya", async ({
  browser,
}) => {
  const { t, alerts } = scene;
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t);
  await ready(page);

  const buttons = activeCard(page).getByTestId("handle-alert");
  await expect(buttons).toHaveCount(alerts.length);
  const names = await buttons.evaluateAll((items) =>
    items.map((item) => item.getAttribute("aria-label") ?? ""),
  );
  // Tombol yang sama di tiap baris, jadi namanya harus berbeda satu sama lain.
  expect(new Set(names).size).toBe(names.length);
  for (const alert of alerts) {
    const button = handleButton(page, alert.id);
    // Di dalam kartunya sendiri, satu per alert.
    await expect(
      row(page, alert.id).getByTestId("handle-alert"),
    ).toHaveCount(1);
    // Terlihat tanpa menggulir mendatar: seluruh lebar tombol ada di dalam daftar.
    const [frame, box] = await Promise.all([
      page.getByRole("region", { name: "Daftar alert aktif" }).boundingBox(),
      button.boundingBox(),
    ]);
    expect(box!.x).toBeGreaterThanOrEqual(frame!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
    await expect(button).toHaveText("Tandai ditangani");
    await expect(button).toHaveAttribute(
      "aria-label",
      new RegExp(`^Tandai ditangani: ${incidentLabels[alert.kind]}, .+`),
    );
  }

  // Rincian kartu insiden memakai tabel yang sama tetapi hanya untuk dibaca.
  await page
    .getByRole("navigation", { name: "Menu utama" })
    .getByRole("link", { name: "Deteksi Anomali" })
    .click();
  await expect(page).toHaveURL("/app/anomali");
  await expect(page.getByTestId("incident-card").first()).toBeVisible();
  for (const toggle of await page.getByTestId("incident-toggle").all()) {
    await toggle.click();
  }
  await expect(page.getByTestId("alert-row")).toHaveCount(alerts.length);
  await expect(page.getByTestId("handle-alert")).toHaveCount(0);
  await context.close();
});

test("Escape dan Batal menutup dialog tanpa mengubah apa pun, dan fokus kembali ke tombolnya", async ({
  browser,
}) => {
  const { t, alerts, target } = scene;
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t);
  await ready(page);

  const button = handleButton(page, target.id);
  await button.click();
  const box = dialog(page);
  await expect(box).toBeVisible();
  await expect(
    box.getByRole("heading", { name: "Tandai alert sudah ditangani?" }),
  ).toBeVisible();
  // Dialog menyebut alert yang mana dan atas nama siapa.
  await expect(box).toContainText(incidentLabels[target.kind]);
  await expect(box).toContainText(OPERATOR);
  // Fokus di Batal, supaya Enter tidak langsung menandai.
  await expect(box.getByRole("button", { name: "Batal" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await expect(button).toBeFocused();

  await button.click();
  await box.getByRole("button", { name: "Batal" }).click();
  await expect(box).toBeHidden();
  await expect(button).toBeFocused();

  await expect(activeCard(page)).toHaveAttribute(
    "data-count",
    String(alerts.length),
  );
  await expect(row(page, target.id)).toHaveCount(1);
  await expect(page.getByTestId("handled-notice")).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  await context.close();
});

test("konfirmasi memindahkan alert ke puncak riwayat atas nama petugas, dan fokus pindah ke daftar", async ({
  browser,
}) => {
  const { t, alerts, target } = scene;
  const resolvedBefore = mockResolvedAlerts(t).length;
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t);
  await ready(page);
  await expect(historyCard(page)).toHaveAttribute(
    "data-total",
    String(resolvedBefore),
  );

  await confirmFor(page, target.id);

  // Daftar aktif: berkurang satu, dengan ringkasan tingkat yang ikut berubah.
  const remaining = alerts.filter((alert) => alert.id !== target.id);
  const summary = summarizeAlertSeverity(remaining);
  await expect(activeCard(page)).toHaveAttribute(
    "data-count",
    String(remaining.length),
  );
  await expect(activeCard(page)).toHaveAttribute(
    "data-critical",
    String(summary.critical),
  );
  await expect(activeCard(page)).toHaveAttribute(
    "data-warning",
    String(summary.warning),
  );
  await expect(row(page, target.id)).toHaveCount(0);

  // Catatan di atas daftar, karena barisnya sudah tidak ada.
  const notice = page.getByTestId("handled-notice");
  await expect(notice).toContainText("Ditandai ditangani");
  await expect(notice).toContainText(incidentLabels[target.kind]);
  await expect(notice).toHaveAttribute("data-alert-id", target.id);

  // Riwayat: di puncak, tertulis ditangani oleh petugas, dengan waktu dan lama
  // yang dihitung dari saat konfirmasi.
  await expect(historyCard(page)).toHaveAttribute(
    "data-total",
    String(resolvedBefore + 1),
  );
  const first = page.getByTestId("resolved-alert-row").first();
  await expect(first).toHaveAttribute("data-alert-id", target.id);
  await expect(first).toHaveAttribute("data-handled", "true");
  const marker = first.locator("[data-end-time-source]");
  await expect(marker).toHaveAttribute("data-end-time-source", "operator");
  await expect(marker).toContainText(`ditangani oleh ${OPERATOR}`);
  await expect(first.getByTestId("resolved-ended-at")).toHaveAttribute(
    "datetime",
    new Date(t * 1000).toISOString(),
  );
  await expect(first.getByTestId("resolved-lasted")).toHaveText(
    formatElapsed(t - target.startedAt),
  );
  // Yang lain di halaman riwayat berhenti sendiri.
  await expect(
    page.locator("[data-testid=resolved-alert-row][data-handled=true]"),
  ).toHaveCount(1);
  await expect(
    page
      .locator("[data-testid=resolved-alert-row][data-handled=false]")
      .first(),
  ).toBeVisible();

  // Barisnya hilang, jadi fokus pindah ke daftar, bukan jatuh ke halaman.
  await expect(
    page.getByRole("region", { name: "Daftar alert aktif" }),
  ).toBeFocused();

  // Waktu berjalan: alert yang ditandai tidak hidup lagi dan tidak tercatat dua kali.
  await moveTo(page, t + 61);
  await expect(row(page, target.id)).toHaveCount(0);
  await expect(historyRow(page, target.id)).toHaveCount(1);
  await expect(historyRow(page, target.id)).toHaveAttribute(
    "data-handled",
    "true",
  );
  await context.close();
});

test("tanpa mouse: Enter membuka dialog, Tab ke konfirmasi, Enter menandai, dan fokus pindah ke daftar", async ({
  browser,
}) => {
  const { t, target } = scene;
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t);
  await ready(page);

  await handleButton(page, target.id).focus();
  await page.keyboard.press("Enter");
  const box = dialog(page);
  await expect(box.getByRole("button", { name: "Batal" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    box.getByRole("button", { name: "Ya, tandai ditangani" }),
  ).toBeFocused();
  // Fokus tetap di dalam dialog selama terbuka.
  await page.keyboard.press("Tab");
  await expect(box.getByRole("button", { name: "Batal" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(box).toBeHidden();
  await expect(historyRow(page, target.id)).toHaveAttribute(
    "data-handled",
    "true",
  );
  await expect(
    page.getByRole("region", { name: "Daftar alert aktif" }),
  ).toBeFocused();
  await context.close();
});

test("halaman lain ikut sepakat, dan penandaan bertahan setelah dimuat ulang", async ({
  browser,
}) => {
  const { t, alerts, target } = scene;
  const remaining = alerts.filter((alert) => alert.id !== target.id);
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t);
  await ready(page);
  await confirmFor(page, target.id);
  const menu = page.getByRole("navigation", { name: "Menu utama" });

  // Deteksi Anomali: ringkasan, dan kartu insiden tanpa alert itu.
  await menu.getByRole("link", { name: "Deteksi Anomali" }).click();
  await expect(page).toHaveURL("/app/anomali");
  const summary = page.getByRole("region", { name: "Ringkasan anomali" });
  const activeValue = summary
    .locator("p", { hasText: "Anomali aktif" })
    .locator("xpath=following-sibling::p[1]");
  await expect(activeValue).toHaveText(String(remaining.length));
  await expect(page.getByTestId("incident-card").first()).toBeVisible();
  for (const toggle of await page.getByTestId("incident-toggle").all()) {
    await toggle.click();
  }
  await expect(page.getByTestId("alert-row")).toHaveCount(remaining.length);
  const inCards = await page
    .getByTestId("alert-row")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-alert-id")!).sort(),
    );
  expect(inCards).toEqual(ids(remaining));

  // Dasbor: lencana menghitung yang sama.
  await menu.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByTestId("anomaly-badge")).toHaveAttribute(
    "data-count",
    String(remaining.length),
  );

  // Dimuat ulang (store kosong lagi): catatan di penyimpanan yang menentukan.
  await page.clock.setFixedTime(t * 1000);
  await page.reload();
  await expect(page.getByTestId("anomaly-badge")).toHaveAttribute(
    "data-count",
    String(remaining.length),
  );
  await page.clock.setFixedTime(t * 1000);
  await page.goto("/app/alert");
  await ready(page);
  await expect(activeCard(page)).toHaveAttribute(
    "data-count",
    String(remaining.length),
  );
  await expect(row(page, target.id)).toHaveCount(0);
  const first = page.getByTestId("resolved-alert-row").first();
  await expect(first).toHaveAttribute("data-alert-id", target.id);
  await expect(first.locator("[data-end-time-source]")).toContainText(
    `ditangani oleh ${OPERATOR}`,
  );
  // Bukan alert baru: catatan "sudah ditandai" tidak muncul lagi setelah dimuat ulang.
  await expect(page.getByTestId("handled-notice")).toHaveCount(0);
  await context.close();
});

test("selama permintaan berjalan tombol konfirmasi tidak bisa ditekan lagi dan dialog tidak bisa ditutup", async ({
  browser,
}) => {
  const { t, alerts, target } = scene;
  const { context, page } = await contextFor(browser, cookies);
  // Tanpa setFixedTime: jamnya dibekukan di bawah, supaya timer latensi server
  // tiruan tidak jalan sampai tes menjalankannya.
  await page.clock.install({ time: t * 1000 });
  await page.goto("/app/alert");
  await ready(page);

  await handleButton(page, target.id).click();
  const box = dialog(page);
  await expect(box).toBeVisible();
  await page.clock.pauseAt((t + 30) * 1000);

  const confirm = box.getByTestId("handle-alert-confirm");
  await confirm.click();
  await expect(box).toHaveAttribute("data-phase", "saving");
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  await expect(confirm).toHaveText("Menyimpan…");
  await expect(box).toHaveAttribute("aria-busy", "true");
  // Menekan konfirmasi sendiri tidak menutup dialog.
  await stillOpen(page);

  // Tidak bisa ditutup selama menyimpan (Escape dan Batal), dan tekan kedua pada
  // konfirmasi tidak berarti apa-apa.
  await page.keyboard.press("Escape");
  await stillOpen(page);
  await box
    .getByRole("button", { name: "Batal" })
    .evaluate((item) => (item as HTMLElement).click());
  await stillOpen(page);
  await confirm.evaluate((item) => (item as HTMLElement).click());
  await stillOpen(page);
  await expect(box).toHaveAttribute("data-phase", "saving");
  // "Server" belum memproses apa pun.
  expect(await stored(page)).toBeNull();
  await expect(row(page, target.id)).toHaveCount(1);

  await page.clock.runFor(500);
  await expect(box).toBeHidden();
  // Tepat satu catatan, pada detik server memprosesnya.
  expect(JSON.parse((await stored(page))!)).toEqual([
    { id: target.id, at: t + 30, by: OPERATOR },
  ]);
  await expect(activeCard(page)).toHaveAttribute(
    "data-count",
    String(alerts.length - 1),
  );
  await expect(historyRow(page, target.id)).toHaveCount(1);
  await context.close();
});

test("tanpa koneksi alert tetap aktif dengan alasan yang jelas, lalu berhasil setelah tersambung", async ({
  browser,
}) => {
  const { t, alerts, target } = scene;
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t);
  await ready(page);

  await handleButton(page, target.id).click();
  const box = dialog(page);
  await expect(box).toBeVisible();
  await context.setOffline(true);
  await box.getByRole("button", { name: "Ya, tandai ditangani" }).click();

  const error = box.getByTestId("handle-alert-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Tidak ada koneksi");
  await expect(box).toHaveAttribute("data-phase", "failed");
  // Alert tetap aktif, dialog tetap terbuka, dan tombolnya menawarkan mencoba lagi.
  await expect(row(page, target.id)).toHaveCount(1);
  await expect(activeCard(page)).toHaveAttribute(
    "data-count",
    String(alerts.length),
  );
  expect(await stored(page)).toBeNull();
  const retry = box.getByRole("button", { name: "Coba lagi" });
  await expect(retry).toBeVisible();
  await expect(retry).not.toHaveAttribute("aria-disabled", "true");

  await context.setOffline(false);
  await retry.click();
  await expect(box).toBeHidden();
  await expect(row(page, target.id)).toHaveCount(0);
  await expect(historyRow(page, target.id)).toHaveAttribute(
    "data-handled",
    "true",
  );
  await context.close();
});

test("alert yang selesai sendiri selagi dialog terbuka tidak bisa lagi ditandai, dan pindah ke riwayat seperti biasa", async ({
  browser,
}) => {
  const { t, target, end } = findEndingScene();
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t);
  await ready(page);

  await handleButton(page, target.id).click();
  const box = dialog(page);
  await expect(box).toHaveAttribute("data-phase", "confirm");
  await expect(
    box.getByRole("button", { name: "Ya, tandai ditangani" }),
  ).toBeVisible();

  await moveTo(page, end + 1);
  await expect(box).toHaveAttribute("data-phase", "ended");
  await expect(box).toContainText("sudah tidak aktif");
  await expect(box.getByTestId("handle-alert-confirm")).toHaveCount(0);
  const close = box.getByRole("button", { name: "Tutup" });
  await expect(close).toBeVisible();
  await expect(historyRow(page, target.id)).toHaveAttribute(
    "data-handled",
    "false",
  );
  await expect(row(page, target.id)).toHaveCount(0);
  await close.click();
  await expect(box).toBeHidden();
  // Tidak ada penandaan yang tercatat.
  expect(await stored(page)).toBeNull();
  await context.close();
});

test("alert yang ditandai dari tab lain selagi dialog terbuka juga tidak bisa ditandai lagi, dan tercatat atas nama petugas itu", async ({
  browser,
}) => {
  const { t, target } = scene;
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t);
  await ready(page);

  await handleButton(page, target.id).click();
  const box = dialog(page);
  await expect(box).toHaveAttribute("data-phase", "confirm");
  // Tab lain menulis catatan untuk detik berikutnya (penyimpanan dipakai bersama).
  await page.evaluate(
    ([id, at]) =>
      localStorage.setItem(
        "alertHandled",
        JSON.stringify([{ id, at, by: "Petugas Lain" }]),
      ),
    [target.id, t + 1] as const,
  );
  await moveTo(page, t + 1);
  await expect(box).toHaveAttribute("data-phase", "ended");
  await expect(box.getByTestId("handle-alert-confirm")).toHaveCount(0);
  await box.getByRole("button", { name: "Tutup" }).click();
  await expect(box).toBeHidden();
  await expect(row(page, target.id)).toHaveCount(0);
  const entry = historyRow(page, target.id);
  await expect(entry).toHaveAttribute("data-handled", "true");
  await expect(entry.locator("[data-end-time-source]")).toContainText(
    "ditangani oleh Petugas Lain",
  );
  await context.close();
});

test("riwayat bisa dicari lewat kata ditangani dan nama petugas", async ({
  browser,
}) => {
  const { t, target } = scene;
  const { context, page } = await contextFor(browser, cookies);
  await open(page, "/app/alert", t);
  await ready(page);
  await confirmFor(page, target.id);

  const search = page.getByLabel("Cari alert");
  const rows = page.getByTestId("resolved-alert-row");
  await search.fill("ditangani");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-alert-id", target.id);
  await search.fill("penanda");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-alert-id", target.id);
  await search.fill("ditangani oleh petugas lain");
  await expect(page.getByTestId("resolved-no-match")).toBeVisible();
  await page
    .getByRole("button", { name: "Tampilkan semua alert selesai" })
    .click();
  await expect(rows.first()).toBeVisible();
  await context.close();
});

test("di layar sempit halaman tidak melebar, tombolnya terjangkau, dan dialog muat di layar", async ({
  browser,
}) => {
  const { t, target } = scene;
  const { context, page } = await contextFor(browser, cookies, {
    width: 390,
    height: 844,
  });
  await open(page, "/app/alert", t);
  await ready(page);
  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Tombol ada di kolom terakhir tabel yang bisa digulir; klik menggulirnya ke
  // layar.
  await handleButton(page, target.id).click();
  const box = dialog(page);
  await expect(box).toBeVisible();
  const frame = await box.boundingBox();
  expect(frame!.x).toBeGreaterThanOrEqual(0);
  expect(frame!.x + frame!.width).toBeLessThanOrEqual(390);
  expect(frame!.y).toBeGreaterThanOrEqual(0);
  expect(frame!.y + frame!.height).toBeLessThanOrEqual(844);
  for (const name of ["Batal", "Ya, tandai ditangani"]) {
    const button = await box.getByRole("button", { name }).boundingBox();
    expect(button!.x).toBeGreaterThanOrEqual(0);
    expect(button!.x + button!.width).toBeLessThanOrEqual(390);
  }
  // Tidak ada tulisan yang terpotong di dalam dialog.
  expect(
    await box.evaluate((item) => item.scrollWidth - item.clientWidth),
  ).toBeLessThanOrEqual(0);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await box.getByRole("button", { name: "Ya, tandai ditangani" }).click();
  await expect(box).toBeHidden();
  await expect(page.getByTestId("handled-notice")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await context.close();
});

test("dengan gerak dikurangi dialog dan latarnya tidak beranimasi, sedangkan tanpa itu beranimasi", async ({
  browser,
}) => {
  const { t, target } = scene;
  const animations: Record<string, string[]> = {};
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    const context = await browser.newContext({
      baseURL: "http://localhost:3101",
      timezoneId: "Asia/Jakarta",
      reducedMotion,
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    await open(page, "/app/alert", t);
    await ready(page);
    await handleButton(page, target.id).click();
    await expect(dialog(page)).toBeVisible();
    animations[reducedMotion] = await page.evaluate(() =>
      ["alert-dialog-content", "alert-dialog-overlay"].map(
        (slot) =>
          getComputedStyle(document.querySelector(`[data-slot=${slot}]`)!)
            .animationName,
      ),
    );
    await context.close();
  }
  expect(animations.reduce).toEqual(["none", "none"]);
  // Kontrol: tanpa pengurangan gerak animasinya ada, jadi hasil di atas bukan
  // karena animasinya memang tidak pernah terpasang.
  expect(animations["no-preference"].every((name) => name !== "none")).toBe(
    true,
  );
});
