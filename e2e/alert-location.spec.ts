import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  describeLocation,
  mockActiveAlerts,
  type ActiveAlert,
} from "../src/lib/dashboard/alerts";
import {
  MAX_FOCUS_ID_LENGTH,
  mapFocusHref,
  readFocusId,
} from "../src/lib/dashboard/map-focus";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";

// Kolom lokasi kejadian dan tombol sorot ke peta pada daftar alert aktif.
// Bagian pertama menguji tautannya tanpa browser; sisanya memakai halaman
// sungguhan dengan jam palsu pada momen yang dipilih dari data tiruannya.

const headers = { Origin: "http://localhost:3101" };
const START = 1_791_400_000;
const GRID = Array.from(
  { length: (7 * 86_400) / 300 },
  (_, i) => START + i * 300,
);
const customers = new Map(createMockCustomers().map((c) => [c.id, c]));

test.describe("tautan sorot ke peta", () => {
  test("dibaca kembali menjadi id yang sama, apa pun isinya", () => {
    const ids = [
      "customer-007",
      "dengan spasi",
      "a&b=c",
      "tagar#dan?tanya",
      "garis/miring",
      "persen%20tulis",
      "Bapak Sutân ä ö",
      "😀 emoji",
      "x".repeat(MAX_FOCUS_ID_LENGTH),
    ];
    for (const id of ids) {
      const href = mapFocusHref(id);
      expect(href, id).not.toBeNull();
      const url = new URL(href!, "http://localhost");
      expect(url.pathname).toBe("/app");
      expect([...url.searchParams.keys()]).toEqual(["focus"]);
      expect(readFocusId(url.searchParams.get("focus") ?? undefined), id).toBe(
        id,
      );
    }
  });

  test("id yang tidak akan terbaca tidak dibuatkan tautan", () => {
    for (const id of [
      "",
      " ",
      " x",
      "x ",
      "x".repeat(MAX_FOCUS_ID_LENGTH + 1),
    ]) {
      expect(mapFocusHref(id), JSON.stringify(id)).toBeNull();
    }
    expect(readFocusId(["a", "b"])).toBeNull();
    expect(readFocusId(undefined)).toBeNull();
    expect(readFocusId("  x  ")).toBe("x");
  });

  test("setiap alert pelanggan punya tautan yang terbaca dan menunjuk pelanggan yang ada", () => {
    const problems: string[] = [];
    let seen = 0;
    for (const t of GRID) {
      for (const alert of mockActiveAlerts(t)) {
        if (alert.customerId === null) continue;
        seen += 1;
        const href = mapFocusHref(alert.customerId);
        if (href === null) problems.push(`${alert.id}: tanpa tautan`);
        else if (
          readFocusId(new URL(href, "http://x").searchParams.get("focus")!) !==
          alert.customerId
        )
          problems.push(`${alert.id}: tautan tidak kembali ke id yang sama`);
        if (!customers.has(alert.customerId))
          problems.push(`${alert.id}: pelanggan tidak ada di peta`);
      }
    }
    expect(seen).toBeGreaterThan(100);
    expect(problems).toEqual([]);
  });
});

// Momen dengan sedikitnya dua alert pelanggan berbeda dan satu alert router.
function findRichTime() {
  for (const t of GRID) {
    const alerts = mockActiveAlerts(t);
    const people = alerts.filter((a) => a.customerId !== null);
    const routers = alerts.filter((a) => a.customerId === null);
    const distinct = new Set(people.map((a) => a.customerId));
    if (distinct.size >= 2 && routers.length >= 1) {
      return { t, alerts, people, routers };
    }
  }
  throw new Error(
    "tidak ada momen dengan dua alert pelanggan dan satu alert router",
  );
}

async function signUp(page: Page, name: string) {
  const data = {
    name,
    email: `loc-${randomUUID()}@example.com`,
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

async function openAlertsAt(page: Page, t: number, alerts: ActiveAlert[]) {
  await signUp(page, "Petugas Lokasi");
  await page.clock.install({ time: t * 1000 });
  await page.goto("/app/alert");
  await expect(page.getByTestId("alert-row")).toHaveCount(alerts.length);
}

function rowOf(page: Page, alert: ActiveAlert) {
  return page.locator(`[data-alert-id="${alert.id}"]`);
}

async function expectMapFocusedOn(page: Page, alert: ActiveAlert) {
  const person = customers.get(alert.customerId!)!;
  const map = page.getByTestId("customer-map");
  await expect(map).toHaveAttribute("data-zoom", "16");
  await expect(page.getByTestId("map-focus-banner")).toContainText(
    `Menyorot ${person.name}`,
  );
  // Hanya satu sorotan, dan itu milik pelanggan ini (bukan sisa yang sebelumnya).
  const ring = map.locator(".leaflet-tooltip-top");
  await expect(ring).toHaveCount(1);
  await expect(ring).toContainText(person.name);
  await expect(ring).toContainText(person.odpName);
}

test("kolom lokasi dan tombol sorot sesuai jenis alert di setiap baris", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { t, alerts } = findRichTime();
  await openAlertsAt(page, t, alerts);
  // Dua tabel di halaman ini punya kolom bernama sama; yang diperiksa yang aktif.
  const activeTable = page.getByRole("region", { name: "Daftar alert aktif" });
  await expect(
    activeTable.getByRole("columnheader", { name: "Lokasi" }),
  ).toBeVisible();
  await expect(
    activeTable.getByRole("columnheader", { name: "Peta" }),
  ).toBeVisible();

  for (const alert of alerts) {
    const row = rowOf(page, alert);
    const shown = describeLocation(alert.location);
    const place = row.locator("[data-has-point]");
    await expect(place, alert.id).toContainText(shown.primary);
    if (shown.secondary)
      await expect(place, alert.id).toContainText(shown.secondary);
    await expect(place).toHaveAttribute(
      "data-has-point",
      String(shown.hasPoint),
    );
    // Pembaca layar diberi tahu ada atau tidaknya titik, bukan hanya ikon.
    await expect(place).toContainText(
      shown.hasPoint ? "ada titik di peta" : "tidak ada titik di peta",
    );

    const link = row.getByRole("link", { name: /^Sorot / });
    if (alert.customerId === null) {
      await expect(link, alert.id).toHaveCount(0);
      await expect(row, alert.id).toContainText("Tidak ada titik");
    } else {
      await expect(link, alert.id).toHaveCount(1);
      await expect(link).toHaveAccessibleName(
        `Sorot ${alert.location.name} di peta`,
      );
      await expect(link).toHaveAttribute(
        "href",
        mapFocusHref(alert.customerId)!,
      );
      await expect(link).toContainText("Sorot di peta");
    }
  }
  expect(errors).toEqual([]);
});

test("menekan tombol sorot membuka peta di titik pelanggannya, untuk beberapa alert berturut-turut", async ({
  page,
}) => {
  const { t, alerts, people } = findRichTime();
  const targets: ActiveAlert[] = [];
  for (const alert of people) {
    if (!targets.some((item) => item.customerId === alert.customerId))
      targets.push(alert);
    if (targets.length === 2) break;
  }
  await openAlertsAt(page, t, alerts);

  for (const alert of targets) {
    await rowOf(page, alert)
      .getByRole("link", { name: /^Sorot / })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/app\\?focus=${alert.customerId}$`),
    );
    await expectMapFocusedOn(page, alert);
    await page.goBack();
    await expect(page.getByTestId("alert-row")).toHaveCount(alerts.length);
  }
});

test("tombol sorot bisa dipakai dengan papan ketik", async ({ page }) => {
  const { t, alerts, people } = findRichTime();
  await openAlertsAt(page, t, alerts);
  const alert = people[0];
  const link = rowOf(page, alert).getByRole("link", { name: /^Sorot / });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/app\\?focus=${alert.customerId}$`));
  await expectMapFocusedOn(page, alert);
});

test("tautan sorot juga jalan di tab baru, tanpa bergantung pada halaman asalnya", async ({
  page,
  context,
}) => {
  const { t, alerts, people } = findRichTime();
  await openAlertsAt(page, t, alerts);
  const alert = people[0];
  const link = rowOf(page, alert).getByRole("link", { name: /^Sorot / });

  const opened = context.waitForEvent("page");
  await link.click({ modifiers: ["Control"] });
  const tab = await opened;
  await tab.waitForLoadState("domcontentloaded");
  await expect(tab).toHaveURL(new RegExp(`/app\\?focus=${alert.customerId}$`));
  await expectMapFocusedOn(tab, alert);
  // Halaman asal tidak berubah.
  await expect(page).toHaveURL(/\/app\/alert$/);
  await expect(page.getByTestId("alert-row")).toHaveCount(alerts.length);
});

test("di layar sempit tombol sorot terjangkau dengan menggulir tabel, dan halaman tidak melebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { t, alerts, people } = findRichTime();
  await openAlertsAt(page, t, alerts);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);

  const alert = people[0];
  const link = rowOf(page, alert).getByRole("link", { name: /^Sorot / });
  // Kolom terakhir ada di luar layar sampai tabelnya digulir.
  const region = page.getByRole("region", { name: "Daftar alert aktif" });
  await region.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(link).toBeInViewport();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/app\\?focus=${alert.customerId}$`));
  await expectMapFocusedOn(page, alert);
});
