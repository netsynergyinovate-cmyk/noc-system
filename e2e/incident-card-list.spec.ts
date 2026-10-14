import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { mockActiveAlerts } from "../src/lib/dashboard/alerts";
import { formatElapsed, formatInteger } from "../src/lib/dashboard/format";
import {
  buildIncidentCards,
  causeLabels,
  confidenceLabels,
  rootSourceLabels,
  summarizeIncidentCards,
  type IncidentCard,
} from "../src/lib/dashboard/incident-cards";
import { incidentLabels } from "../src/lib/dashboard/incidents";
import { mapFocusHref } from "../src/lib/dashboard/map-focus";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";

// Kartu insiden terkelompok di halaman Deteksi Anomali, dengan rincian yang bisa
// dibuka. Jam browser dipasang palsu pada momen yang dipilih dari data
// tiruannya sendiri, jadi isi kartu dan angkanya pasti.

test.use({ timezoneId: "Asia/Jakarta" });

const headers = { Origin: "http://localhost:3101" };
const START = 1_791_400_000;
const GRID = Array.from(
  { length: (7 * 86_400) / 300 },
  (_, i) => START + i * 300,
);
const customers = new Map(createMockCustomers().map((c) => [c.id, c]));

function cardsAt(t: number) {
  return buildIncidentCards(mockActiveAlerts(t));
}

// Momen dengan kartu router gabungan, kartu ODP gabungan, dan sedikitnya satu
// kartu yang bisa disorot di peta; dipilih sekali dari data itu sendiri. Kartu
// gabungan jarang bersamaan, jadi pencarian meluas sampai 30 hari.
let rich: ReturnType<typeof searchRichTime> | undefined;
function searchRichTime() {
  for (let t = START; t < START + 30 * 86_400; t += 300) {
    const cards = cardsAt(t);
    const router = cards.find((c) => c.cause === "router" && c.alertCount > 1);
    const odp = cards.find((c) => c.cause === "odp");
    const pointed = cards.find((c) => c.focusCustomerId !== null);
    if (router && odp && pointed && cards.length >= 3) {
      return { t, cards, router, odp, pointed };
    }
  }
  throw new Error("tidak ada momen dengan kartu router dan ODP gabungan");
}
function findRichTime() {
  rich ??= searchRichTime();
  return rich;
}

function findTime(pick: (cards: IncidentCard[]) => boolean) {
  for (const t of GRID) if (pick(cardsAt(t))) return t;
  throw new Error("tidak ada momen yang cocok pada data tiruan");
}

async function signUp(page: Page) {
  const data = {
    name: "Petugas Kartu",
    email: `kartu-${randomUUID()}@example.com`,
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

async function openAt(page: Page, t: number) {
  await signUp(page);
  await page.clock.install({ time: t * 1000 });
  await page.goto("/app/anomali");
  await expect(page.getByTestId("incident-summary")).toHaveAttribute(
    "data-cards",
    /\d+/,
  );
}

const cardLocator = (page: Page, card: IncidentCard) =>
  page.locator(`[data-testid=incident-card][data-card-id="${card.id}"]`);

test("kartu insiden tampil sesuai hasil pengelompokan, lengkap dengan akar, dampak, dan waktunya", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { t, cards } = findRichTime();
  await openAt(page, t);

  const shown = page.getByTestId("incident-card");
  await expect(shown).toHaveCount(cards.length);
  // Urutan sama dengan hasil engine: yang paling genting dulu.
  expect(
    await shown.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-card-id")),
    ),
  ).toEqual(cards.map((card) => card.id));

  const summary = summarizeIncidentCards(cards);
  const line = page.getByTestId("incident-summary");
  await expect(line).toHaveAttribute("data-cards", String(summary.cards));
  await expect(line).toHaveAttribute("data-alerts", String(summary.alerts));
  await expect(line).toHaveAttribute("data-grouped", String(summary.grouped));
  await expect(line).toHaveAttribute("data-saved", String(summary.saved));
  await expect(line).toHaveText(
    `${summary.cards} insiden dari ${summary.alerts} alert aktif; pengelompokan menghemat ${summary.saved} baris`,
  );

  for (const card of cards) {
    const view = cardLocator(page, card);
    await expect(view).toHaveAttribute("data-cause", card.cause);
    await expect(view).toHaveAttribute("data-severity", card.severity);
    await expect(view).toHaveAttribute(
      "data-alert-count",
      String(card.alertCount),
    );
    await expect(view).toHaveAttribute(
      "data-affected",
      String(card.affectedCustomers),
    );
    await expect(view).toHaveAttribute(
      "data-served",
      String(card.servedCustomers),
    );
    await expect(view.getByRole("heading", { level: 3 })).toHaveText(
      card.title,
    );
    await expect(view).toContainText(causeLabels[card.cause]);
    if (card.confidence)
      await expect(view).toContainText(confidenceLabels[card.confidence]);
    await expect(view.getByTestId("incident-root")).toHaveText(
      `${rootSourceLabels[card.rootSource.kind]}: ${card.rootSource.name}`,
    );
    const served = formatInteger(card.servedCustomers);
    await expect(view.getByTestId("incident-impact")).toHaveText(
      card.affectedCustomers > 0
        ? `${formatInteger(card.affectedCustomers)} pelanggan terbukti terdampak, dari ${served} yang dilayani`
        : `Belum ada pelanggan terbukti terdampak; melayani ${served} pelanggan`,
    );
    await expect(view.getByTestId("incident-kinds")).toHaveText(
      card.kinds
        .map(
          ({ kind, count }) => `${count} ${incidentLabels[kind].toLowerCase()}`,
        )
        .join(", "),
    );
    // Waktu mulai sampai detik, dengan penanda sumbernya, dari anggota tertua.
    const time = view.locator("time").first();
    await expect(time).toHaveAttribute(
      "datetime",
      new Date(card.startedAt * 1000).toISOString(),
    );
    await expect(view.locator("[data-time-source]")).toHaveAttribute(
      "data-time-source",
      card.timeSource,
    );
    await expect(view.getByRole("article")).toHaveCount(0);
  }
  // Setiap kartu punya nama yang bisa dibaca pembaca layar.
  for (const card of cards) {
    await expect(page.getByRole("article", { name: card.title })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("rincian terbuka dan tertutup lewat tombol, dengan alert anggota dan alasannya", async ({
  page,
}) => {
  const { t, router, odp, cards } = findRichTime();
  const single = cards.find((c) => c.alertCount === 1)!;
  await openAt(page, t);

  for (const card of [router, odp, single]) {
    const view = cardLocator(page, card);
    const toggle = view.getByTestId("incident-toggle");
    // Awalnya tertutup, dan tidak ada rincian di halaman.
    await expect(toggle).toHaveText("Lihat rincian");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(view).toHaveAttribute("data-expanded", "false");
    await expect(view.getByTestId("incident-details")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveText("Sembunyikan rincian");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(view).toHaveAttribute("data-expanded", "true");
    // aria-controls menunjuk wadah yang berisi rinciannya.
    const panelId = (await toggle.getAttribute("aria-controls"))!;
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel.getByTestId("incident-details")).toBeVisible();

    // Alert anggota: semuanya, tertua lebih dulu, dengan waktu sampai detik.
    const rows = panel.getByTestId("alert-row");
    await expect(rows).toHaveCount(card.alertCount);
    expect(
      await rows.evaluateAll((items) =>
        items.map((i) => i.getAttribute("data-alert-id")),
      ),
    ).toEqual(card.alerts.map((alert) => alert.id));
    for (const alert of card.alerts) {
      const row = panel.locator(`[data-alert-id="${alert.id}"]`);
      await expect(row.locator("time")).toHaveAttribute(
        "datetime",
        new Date(alert.startedAt * 1000).toISOString(),
      );
    }
    await expect(
      panel.getByRole("region", { name: `Alert dalam insiden ${card.title}` }),
    ).toBeVisible();

    // Alasan pengelompokan, atau penjelasan bahwa tidak ada yang berkaitan.
    if (card.reasons.length > 0) {
      for (const reason of card.reasons)
        await expect(panel).toContainText(reason);
    } else {
      await expect(panel).toContainText("Tidak ada alert lain yang berkaitan");
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(view.getByTestId("incident-details")).toHaveCount(0);
  }
});

test("kartu yang terbuka melebar ke dua kolom, dan yang lain tidak ikut berubah", async ({
  page,
}) => {
  const { t, router, odp } = findRichTime();
  await openAt(page, t);
  const width = async (card: IncidentCard) =>
    (await cardLocator(page, card).boundingBox())!.width;
  const closed = await width(router);
  const other = await width(odp);
  await cardLocator(page, router).getByTestId("incident-toggle").click();
  await expect.poll(() => width(router)).toBeGreaterThan(closed * 1.6);
  // Kartu lain tetap terbuka/tertutup seperti semula, dan tidak ikut terbuka.
  await expect(cardLocator(page, odp)).toHaveAttribute(
    "data-expanded",
    "false",
  );
  await expect.poll(() => width(odp)).toBeLessThanOrEqual(other * 1.05);
});

test("kartu tetap terbuka saat data disegarkan, dan tidak menggandakan baris", async ({
  page,
}) => {
  const { t, router } = findRichTime();
  await openAt(page, t);
  const view = cardLocator(page, router);
  await view.getByTestId("incident-toggle").click();
  await expect(view.getByTestId("alert-row")).toHaveCount(router.alertCount);

  // Beberapa putaran penyegaran (tiap 5 detik pada jam palsu).
  await page.clock.setFixedTime(t * 1000);
  await page.clock.runFor(16_000);
  await expect(view).toHaveAttribute("data-expanded", "true");
  await expect(view.getByTestId("alert-row")).toHaveCount(router.alertCount);
  await expect(page.getByTestId("incident-card")).toHaveCount(
    cardsAt(t).length,
  );
});

test("papan ketik: Enter pada tombol membuka rincian, dan fokus tetap di tombolnya", async ({
  page,
}) => {
  const { t, router } = findRichTime();
  await openAt(page, t);
  const view = cardLocator(page, router);
  const toggle = view.getByTestId("incident-toggle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
});

test("tombol sorot membawa ke pelanggan pertama yang punya titik; kartu router tidak punya tombol", async ({
  page,
}) => {
  const { t, pointed, cards } = findRichTime();
  const routerOnly = cards.find(
    (c) => c.focusCustomerId === null && c.cause === "router",
  );
  await openAt(page, t);

  if (routerOnly) {
    const view = cardLocator(page, routerOnly);
    await expect(view.getByTestId("incident-focus")).toHaveCount(0);
    await expect(view).toContainText("Tidak ada titik");
  }
  const view = cardLocator(page, pointed);
  const link = view.getByTestId("incident-focus");
  await expect(link).toHaveAttribute(
    "href",
    mapFocusHref(pointed.focusCustomerId!)!,
  );
  await expect(link).toHaveAccessibleName(
    `Sorot insiden ${pointed.title} di peta`,
  );
  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`/app\\?focus=${pointed.focusCustomerId}$`),
  );
  const person = customers.get(pointed.focusCustomerId!)!;
  const map = page.getByTestId("customer-map");
  await expect(map).toHaveAttribute("data-zoom", "16");
  await expect(page.getByTestId("map-focus-banner")).toContainText(
    `Menyorot ${person.name}`,
  );
});

test("lama berjalan tiap kartu bertambah tiap detik dari alert tertuanya", async ({
  page,
}) => {
  const { t, router } = findRichTime();
  await openAt(page, t);
  const view = cardLocator(page, router);
  const duration = view.getByTestId("incident-duration");
  const fakeNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(fakeNow + 1000);
  const seconds = () => page.evaluate(() => Math.floor(Date.now() / 1000));
  const first = await seconds();
  await expect(duration).toHaveText(
    `sudah ${formatElapsed(first - router.startedAt)}`,
  );
  for (let step = 1; step <= 4; step += 1) {
    await page.clock.runFor(1000);
    const now = await seconds();
    expect(now).toBe(first + step);
    await expect(duration).toHaveText(
      `sudah ${formatElapsed(now - router.startedAt)}`,
    );
  }
});

test("keadaan kosong ditulis jelas, dan kartu ikut berubah saat alert baru muncul", async ({
  page,
}) => {
  const quiet = findTime((cards) => cards.length === 0);
  const busy = findRichTime();
  await openAt(page, quiet);
  await expect(page.getByTestId("incident-card")).toHaveCount(0);
  await expect(page.getByTestId("incident-summary")).toHaveText(
    "Tidak ada insiden aktif",
  );
  await expect(page.getByTestId("incident-summary")).toHaveAttribute(
    "data-cards",
    "0",
  );
  await expect(
    page.getByText("Tidak ada insiden aktif. Semua jaringan normal."),
  ).toBeVisible();

  // Alert baru muncul tanpa memuat ulang halaman.
  await page.evaluate(() => {
    (window as unknown as { keptAlive: boolean }).keptAlive = true;
  });
  await page.clock.setFixedTime(busy.t * 1000);
  await page.clock.runFor(5_100);
  await expect(page.getByTestId("incident-card")).toHaveCount(
    busy.cards.length,
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { keptAlive?: boolean }).keptAlive,
    ),
  ).toBe(true);
});

test("kartu dan rinciannya muat di layar sempit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { t, router } = findRichTime();
  await openAt(page, t);
  const view = cardLocator(page, router);
  await view.getByTestId("incident-toggle").click();
  await expect(view.getByTestId("incident-details")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  // Tabel anggota bergulir di dalam kotaknya sendiri.
  const region = view.getByRole("region", {
    name: `Alert dalam insiden ${router.title}`,
  });
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  const box = (await view.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
