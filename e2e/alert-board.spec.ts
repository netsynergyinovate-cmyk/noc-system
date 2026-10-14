import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { describeAnomaly } from "../src/lib/dashboard/anomalies";
import {
  ALERT_HISTORY_PAGE_SIZE,
  describeLocation,
  describeTimeSource,
  mockActiveAlerts,
  mockResolvedAlerts,
  type ResolvedAlert,
} from "../src/lib/dashboard/alerts";
import {
  formatElapsed,
  formatInteger,
  isoDuration,
} from "../src/lib/dashboard/format";
import {
  incidentLabels,
  incidentSeverityLabels,
} from "../src/lib/dashboard/incidents";
import { paginate } from "../src/lib/dashboard/paging";

// Halaman Alert dengan dua daftar: yang aktif, dan riwayat yang sudah selesai.
// Jam browser dikunci pada detik yang dipilih dari data tiruannya sendiri,
// supaya isi kedua daftar bisa dibandingkan persis dengan datanya.

test.use({ timezoneId: "Asia/Jakarta" });

const headers = { Origin: "http://localhost:3101" };
const START = 1_791_400_000;
const PAGE = ALERT_HISTORY_PAGE_SIZE;

const clockJakarta = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dayJakarta = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
});

// Jam sampai detik, dengan tanggal bila bukan hari yang sama dengan `now`.
function jakartaTime(seconds: number, now: number) {
  const at = new Date(seconds * 1000);
  const sameDay =
    dayJakarta.format(at) === dayJakarta.format(new Date(now * 1000));
  return sameDay
    ? clockJakarta.format(at)
    : `${dayJakarta.format(at)}, ${clockJakarta.format(at)}`;
}

async function signUp(page: Page) {
  const data = {
    name: "Petugas Dua Daftar",
    email: `dua-daftar-${randomUUID()}@example.com`,
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
}

// Buka halaman Alert pada detik tertentu, dengan jam yang tidak maju sendiri:
// penyegaran berkala tetap berjalan tetapi selalu melihat detik yang sama.
async function openAlertsAt(page: Page, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto("/app/alert");
}

// Waktu dengan beberapa alert aktif sekaligus, supaya kedua daftar berisi.
function findBusyTime(minActive = 3) {
  for (let t = START; t < START + 7 * 86_400; t += 300) {
    const active = mockActiveAlerts(t);
    if (active.length >= minActive) {
      return { t, active, resolved: mockResolvedAlerts(t) };
    }
  }
  throw new Error("tidak ada waktu dengan cukup alert aktif");
}

const resolvedRows = (page: Page) => page.getByTestId("resolved-alert-row");
const activeRows = (page: Page) => page.getByTestId("alert-row");
const ids = (rows: ReturnType<typeof resolvedRows>) =>
  rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-alert-id")!),
  );

test("halaman Alert memuat dua daftar: yang aktif dan riwayat yang selesai", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { t, active, resolved } = findBusyTime();
  await signUp(page);
  await openAlertsAt(page, t);

  await expect(
    page.getByRole("heading", { name: "Alert", level: 1, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Alert/);
  const menu = page.getByRole("navigation", { name: "Menu utama" });
  // Namanya, bukan seluruh teksnya: di dalam tautan ada lencana jumlah alert aktif.
  await expect(menu.locator("[aria-current=page]")).toHaveAccessibleName(
    "Alert",
  );

  // Daftar pertama: yang aktif, seperti sebelumnya.
  const activeCard = page.getByTestId("active-alerts");
  await expect(
    activeCard.getByText("Daftar alert aktif").first(),
  ).toBeVisible();
  await expect(activeRows(page)).toHaveCount(active.length);
  await expect(
    activeCard.getByText(`${active.length} alert sedang berjalan`),
  ).toBeVisible();

  // Daftar kedua: riwayat, halaman pertama, yang paling akhir selesai di atas.
  const history = page.getByTestId("resolved-alerts");
  await expect(
    history.getByText("Riwayat alert selesai").first(),
  ).toBeVisible();
  await expect(
    history.getByText(
      `${formatInteger(resolved.length)} alert selesai dalam 7 hari terakhir`,
    ),
  ).toBeVisible();
  await expect(resolvedRows(page)).toHaveCount(PAGE);
  expect(await ids(resolvedRows(page))).toEqual(
    resolved.slice(0, PAGE).map((alert) => alert.id),
  );

  // Kedua daftar tidak berbagi alert, dan baris riwayat tidak dihitung sebagai
  // alert aktif.
  const activeIds = await ids(activeRows(page));
  const shared = (await ids(resolvedRows(page))).filter((id) =>
    activeIds.includes(id),
  );
  expect(shared).toEqual([]);
  await expect(activeRows(page)).toHaveCount(active.length);

  // Tabel riwayat punya judul kolom dan keterangan untuk pembaca layar.
  const table = page.getByRole("region", { name: "Riwayat alert selesai" });
  await expect(table).toBeVisible();
  const headersText = await table.getByRole("columnheader").allTextContents();
  expect(headersText.map((text) => text.trim())).toEqual([
    "Waktu mulai",
    "Selesai",
    "Alert",
    "Subjek",
    "Keterangan",
    "Lokasi",
    "Peta",
  ]);
  await expect(
    page.getByRole("table", { name: /Alert yang sudah selesai/ }),
  ).toBeVisible();
  // Penjelasan penanda sumber waktu hanya ditulis sekali di halaman.
  await expect(page.getByText(/polling ±N/)).toHaveCount(1);

  expect(errors).toEqual([]);
});

test("setiap baris riwayat menulis waktu mulai, waktu selesai, lamanya, dan keterangannya dari datanya", async ({
  page,
}) => {
  const { t, resolved } = findBusyTime();
  await signUp(page);
  await openAlertsAt(page, t);
  await expect(resolvedRows(page)).toHaveCount(PAGE);

  for (const alert of resolved.slice(0, PAGE)) {
    const row = page.locator(
      `[data-testid=resolved-alert-row][data-alert-id="${alert.id}"]`,
    );
    await expect(row).toHaveAttribute("data-severity", alert.severity);

    // Waktu mulai dan penanda sumbernya, seperti di daftar aktif.
    const marker = row.locator("[data-time-source]");
    await expect(marker).toHaveAttribute("data-time-source", alert.timeSource);
    await expect(marker).toContainText(describeTimeSource(alert).short);
    const started = row.locator("time").first();
    await expect(started).toHaveAttribute(
      "datetime",
      new Date(alert.startedAt * 1000).toISOString(),
    );
    await expect(started).toHaveText(jakartaTime(alert.startedAt, t));

    // Waktu selesai punya penanda sumbernya sendiri.
    const endMarker = row.locator("[data-end-time-source]");
    await expect(endMarker).toHaveCount(1);
    await expect(endMarker).toHaveAttribute(
      "data-end-time-source",
      alert.endTimeSource,
    );
    await expect(endMarker).toContainText(
      describeTimeSource(
        {
          timeSource: alert.endTimeSource,
          timeUncertaintySeconds: alert.endTimeUncertaintySeconds,
        },
        "end",
      ).short,
    );

    // Waktu selesai sampai detik, dan lamanya dari mulai sampai selesai.
    const ended = row.getByTestId("resolved-ended-at");
    await expect(ended).toHaveText(jakartaTime(alert.endedAt, t));
    await expect(ended).toHaveAttribute(
      "datetime",
      new Date(alert.endedAt * 1000).toISOString(),
    );
    const lasted = row.getByTestId("resolved-lasted");
    await expect(lasted).toHaveText(
      formatElapsed(alert.endedAt - alert.startedAt),
    );
    await expect(lasted).toHaveAttribute(
      "datetime",
      isoDuration(alert.endedAt - alert.startedAt),
    );

    // Jenis, tingkat, keterangan, dan lokasi.
    await expect(row).toContainText(incidentLabels[alert.kind]);
    await expect(row).toContainText(incidentSeverityLabels[alert.severity]);
    await expect(row).toContainText(describeAnomaly(alert));
    const place = describeLocation(alert.location);
    await expect(row.locator("[data-has-point]")).toContainText(place.primary);
    await expect(row.locator("[data-has-point]")).toHaveAttribute(
      "data-has-point",
      String(place.hasPoint),
    );
    // Titik di peta hanya untuk alert yang punya koordinat.
    const link = row.getByRole("link", { name: /^Sorot / });
    await expect(link).toHaveCount(place.hasPoint ? 1 : 0);
    if (place.hasPoint) {
      await expect(link).toHaveAttribute(
        "href",
        `/app?focus=${encodeURIComponent(alert.customerId!)}`,
      );
    } else {
      await expect(row).toContainText("Tidak ada titik");
    }
  }
});

test("riwayat dibagi per halaman, dengan tombol yang menjaga fokus papan ketik", async ({
  page,
}) => {
  const { t, resolved } = findBusyTime();
  const pages = paginate(resolved, 1, PAGE).pageCount;
  expect(pages).toBeGreaterThan(5);
  await signUp(page);
  await openAlertsAt(page, t);
  await expect(resolvedRows(page)).toHaveCount(PAGE);

  const status = page.getByTestId("resolved-page-status");
  const label = (n: number) => {
    const shown = paginate(resolved, n, PAGE);
    return `Halaman ${formatInteger(n)} dari ${formatInteger(pages)}, alert ${formatInteger(shown.from)}–${formatInteger(shown.to)} dari ${formatInteger(resolved.length)}`;
  };
  const previous = page.getByRole("button", { name: "Sebelumnya" });
  const next = page.getByRole("button", { name: "Berikutnya" });
  await expect(status).toHaveText(label(1));

  // Di halaman pertama tidak ada yang sebelumnya; menekannya tidak berbuat apa-apa.
  await expect(previous).toHaveAttribute("aria-disabled", "true");
  await expect(next).toHaveAttribute("aria-disabled", "false");
  await previous.click({ force: true });
  await expect(status).toHaveText(label(1));

  // Halaman kedua adalah baris berikutnya, tanpa tumpang tindih.
  await next.click();
  await expect(status).toHaveText(label(2));
  expect(await ids(resolvedRows(page))).toEqual(
    paginate(resolved, 2, PAGE).items.map((alert) => alert.id),
  );
  await expect(next).toBeFocused();
  await expect(previous).toHaveAttribute("aria-disabled", "false");

  // Kembali ke halaman pertama dengan tombol sebelumnya.
  await previous.click();
  await expect(status).toHaveText(label(1));
  expect(await ids(resolvedRows(page))).toEqual(
    resolved.slice(0, PAGE).map((alert) => alert.id),
  );
  await expect(previous).toBeFocused();
  await expect(previous).toHaveAttribute("aria-disabled", "true");

  // Menekan Enter pada tombol berikutnya berulang sampai halaman terakhir:
  // fokus tetap di tombol itu, juga ketika ia menjadi nonaktif.
  await next.focus();
  for (let n = 2; n <= pages; n += 1) {
    await page.keyboard.press("Enter");
    await expect(status).toHaveText(label(n));
  }
  const last = paginate(resolved, pages, PAGE);
  expect(await ids(resolvedRows(page))).toEqual(
    last.items.map((alert) => alert.id),
  );
  await expect(resolvedRows(page)).toHaveCount(last.items.length);
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await expect(next).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(label(pages));

  // Setiap alert di riwayat tampil di tepat satu halaman.
  const seen: string[] = [];
  await previous.focus();
  for (let n = pages; n >= 1; n -= 1) {
    seen.push(...(await ids(resolvedRows(page))));
    if (n > 1) {
      await page.keyboard.press("Enter");
      await expect(status).toHaveText(label(n - 1));
    }
  }
  expect(seen.sort()).toEqual(resolved.map((alert) => alert.id).sort());
});

test("alert yang selesai berpindah dari daftar aktif ke atas riwayat dalam satu pembaruan", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { t } = findBusyTime();
  // Alert aktif yang paling cepat selesai, dan detik selesainya dari riwayat.
  const later = new Map(
    mockResolvedAlerts(t + 6_000).map((alert) => [alert.id, alert]),
  );
  const moving = mockActiveAlerts(t)
    .map((alert) => later.get(alert.id)!)
    .sort((a, b) => a.endedAt - b.endedAt)[0] as ResolvedAlert;
  const end = moving.endedAt;
  await signUp(page);

  // Sedetik sebelum selesai: masih di daftar aktif, belum di riwayat.
  await openAlertsAt(page, end - 1);
  const beforeActive = mockActiveAlerts(end - 1).map((alert) => alert.id);
  const beforeResolved = mockResolvedAlerts(end - 1).map((alert) => alert.id);
  expect(beforeActive).toContain(moving.id);
  expect(beforeResolved).not.toContain(moving.id);
  await expect(activeRows(page)).toHaveCount(beforeActive.length);
  expect((await ids(activeRows(page))).sort()).toEqual(
    [...beforeActive].sort(),
  );
  expect(await ids(resolvedRows(page))).toEqual(beforeResolved.slice(0, PAGE));

  // Catat setiap perubahan tampilan: tak pernah ada alert di dua daftar sekaligus.
  await page.evaluate(() => {
    const overlaps: string[] = [];
    (window as unknown as { overlaps: string[] }).overlaps = overlaps;
    const rowIds = (testId: string) =>
      Array.from(document.querySelectorAll(`[data-testid=${testId}]`)).map(
        (row) => row.getAttribute("data-alert-id")!,
      );
    new MutationObserver(() => {
      const inActive = new Set(rowIds("alert-row"));
      for (const id of rowIds("resolved-alert-row")) {
        if (inActive.has(id)) overlaps.push(id);
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  // Pada detik selesainya: pindah ke riwayat, di baris paling atas.
  await page.clock.setFixedTime(end * 1000);
  await page.clock.runFor(5_100);
  const afterActive = mockActiveAlerts(end).map((alert) => alert.id);
  const afterResolved = mockResolvedAlerts(end);
  expect(afterActive).not.toContain(moving.id);
  expect(afterResolved[0].id).toBe(moving.id);
  await expect(
    page.locator(`[data-testid=alert-row][data-alert-id="${moving.id}"]`),
  ).toHaveCount(0);
  await expect(activeRows(page)).toHaveCount(afterActive.length);
  await expect(resolvedRows(page).first()).toHaveAttribute(
    "data-alert-id",
    moving.id,
  );
  expect(await ids(resolvedRows(page))).toEqual(
    afterResolved.slice(0, PAGE).map((alert) => alert.id),
  );
  await expect(
    resolvedRows(page).first().getByTestId("resolved-ended-at"),
  ).toHaveText(jakartaTime(end, end));
  await expect(
    page
      .getByTestId("resolved-alerts")
      .getByText(
        `${formatInteger(afterResolved.length)} alert selesai dalam 7 hari terakhir`,
      ),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("active-alerts")
      .getByText(`${afterActive.length} alert sedang berjalan`),
  ).toBeVisible();

  expect(
    await page.evaluate(
      () => (window as unknown as { overlaps: string[] }).overlaps,
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("di layar sempit kedua daftar terjangkau dan halaman tidak melebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { t, resolved } = findBusyTime();
  await signUp(page);
  await openAlertsAt(page, t);
  await expect(resolvedRows(page)).toHaveCount(PAGE);
  await expect(activeRows(page).first()).toBeVisible();

  const overflows = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
  expect(await overflows()).toBe(false);

  // Tabel riwayat lebih lebar daripada layar dan menggulir di dalam wadahnya.
  const table = page.getByRole("region", { name: "Riwayat alert selesai" });
  const scrolls = await table.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrolls).toBe(true);
  await table.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  expect(await overflows()).toBe(false);

  // Tombol halaman terlihat penuh dan berfungsi.
  const next = page.getByRole("button", { name: "Berikutnya" });
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeInViewport({ ratio: 1 });
  await next.click();
  expect(await ids(resolvedRows(page))).toEqual(
    paginate(resolved, 2, PAGE).items.map((alert) => alert.id),
  );
  expect(await overflows()).toBe(false);
});
