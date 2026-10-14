import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  describeLocation,
  describeTimeSource,
  mockActiveAlerts,
  type ActiveAlert,
} from "../src/lib/dashboard/alerts";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";

// Daftar Alert Aktif: waktu mulai ditulis sampai detik, dengan penanda dari
// mana waktu itu berasal. Zona waktu dikunci supaya jam yang diharapkan pasti.

test.use({ timezoneId: "Asia/Jakarta" });

const headers = { Origin: "http://localhost:3101" };
const clock = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

async function signUpAndOpenDashboard(page: Page, name: string) {
  const data = {
    name,
    email: `alert-${randomUUID()}@example.com`,
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
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();
}

// Alert yang mungkin sedang tampil: yang aktif pada detik-detik di sekitar saat
// halaman memuat (halaman dan test tidak membaca jam pada detik yang sama).
function alertsAround(nowSec: number) {
  const known = new Map<string, ActiveAlert>();
  for (let offset = -45; offset <= 15; offset += 1) {
    for (const alert of mockActiveAlerts(nowSec + offset)) {
      if (!known.has(alert.id)) known.set(alert.id, alert);
    }
  }
  return known;
}

test("alert aktif butuh login", async ({ page }) => {
  await page.goto("/app/alert");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Falert$/);
  await expect(page.getByTestId("alert-row")).toHaveCount(0);
});

test("menu membuka daftar alert aktif, dengan waktu sampai detik dan penanda sumbernya", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signUpAndOpenDashboard(page, "Petugas Alert");
  const menu = page.getByRole("navigation", { name: "Menu utama" });
  await menu.getByRole("link", { name: "Alert", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/alert$/);
  await expect(
    page.getByRole("heading", { name: "Alert", level: 1, exact: true }),
  ).toBeVisible();
  // Namanya, bukan seluruh teksnya: di dalam tautan ada lencana jumlah alert aktif.
  await expect(menu.locator("[aria-current=page]")).toHaveAccessibleName(
    "Alert",
  );

  const rows = page.getByTestId("alert-row");
  const empty = page.getByText("Tidak ada alert aktif. Semua jaringan normal.");
  await expect(rows.first().or(empty)).toBeVisible();
  // Kadang memang tidak ada alert (sekitar 3% dari waktu pada data tiruan):
  // keadaan kosong ditulis jelas, dan tidak ada baris yang bisa diperiksa.
  if ((await rows.count()) === 0) {
    await expect(page.getByText("0 alert sedang berjalan")).toBeVisible();
    return;
  }
  const loadedAt = Math.floor(Date.now() / 1000);
  const known = alertsAround(loadedAt);
  const count = await rows.count();
  await expect(page.getByText(`${count} alert sedang berjalan`)).toBeVisible();

  const shown = await rows.evaluateAll((items) =>
    items.map((item) => ({
      id: item.getAttribute("data-alert-id")!,
      severity: item.getAttribute("data-severity")!,
      dateTime: item.querySelector("time")!.getAttribute("datetime")!,
      timeText: item.querySelector("time")!.textContent!.trim(),
      source: item
        .querySelector("[data-time-source]")!
        .getAttribute("data-time-source")!,
      markerText: item.querySelector("[data-time-source]")!.textContent!,
    })),
  );
  expect(new Set(shown.map((row) => row.id)).size).toBe(shown.length);

  for (const row of shown) {
    const alert = known.get(row.id);
    expect(alert, `${row.id} tidak ada di data tiruan`).toBeTruthy();
    // Waktu persis sama dengan datanya, dan bilangan bulat detik (tanpa milidetik).
    expect(row.dateTime).toBe(new Date(alert!.startedAt * 1000).toISOString());
    expect(row.dateTime).toMatch(/:\d{2}\.000Z$/);
    // Jam yang tampil sampai detik, sama dengan jam Jakarta untuk detik itu.
    const expected = clock.format(new Date(alert!.startedAt * 1000));
    expect(
      row.timeText.endsWith(expected),
      `${row.timeText} vs ${expected}`,
    ).toBe(true);
    expect(row.timeText).toMatch(/\d{2}\.\d{2}\.\d{2}$/);
    // Penanda sumber waktu: jenis, tulisan, dan batas ketelitiannya.
    expect(row.source).toBe(alert!.timeSource);
    expect(row.markerText).toContain(describeTimeSource(alert!).short);
    expect(row.markerText).toContain(describeTimeSource(alert!).long);
    expect(row.severity).toBe(alert!.severity);
  }

  // Yang paling genting di atas.
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  const ranks = shown.map((row) => rank[row.severity as keyof typeof rank]);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

  // Penjelasan penanda ditulis di halaman, bukan hanya di tooltip.
  await expect(
    page.getByText("dari router", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(/polling ±N/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Daftar alert aktif" }),
  ).toBeVisible();

  // Disegarkan berkala tanpa menggandakan baris.
  await page.waitForTimeout(6_500);
  const after = await rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-alert-id")),
  );
  expect(new Set(after).size).toBe(after.length);

  // Halaman anomali dan dashboard tetap bisa dibuka dari menu yang sama.
  await menu.getByRole("link", { name: "Deteksi Anomali" }).click();
  await expect(menu.locator("[aria-current=page]")).toHaveText(
    "Deteksi Anomali",
  );
  await menu.getByRole("link", { name: "Dashboard" }).click();
  await expect(menu.locator("[aria-current=page]")).toHaveText("Dashboard");
  expect(errors).toEqual([]);
});

test("daftar alert aktif muat di layar sempit dan menu ponsel menjangkaunya", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpAndOpenDashboard(page, "Petugas HP Alert");
  const bar = page.getByRole("navigation", { name: "Menu halaman" });
  await bar.getByRole("link", { name: "Alert", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/alert$/);
  const rows = page.getByTestId("alert-row");
  // Sel kosong di tabel, bukan teksnya saja: kalimat yang sama juga ada dua kali
  // sebagai pengumuman layar (sr-only) pada lencana menu, jadi pencarian teks
  // cocok dengan tiga elemen dan gagal (strict mode) tepat saat data tiruan
  // kebetulan kosong. Jam asli menentukan data, jadi ini muncul sesekali.
  await expect(
    rows.first().or(page.getByRole("cell", { name: /^Tidak ada alert aktif/ })),
  ).toBeVisible();
  // Namanya, bukan seluruh teksnya: di dalam tautan ada lencana jumlah alert aktif.
  await expect(bar.locator("[aria-current=page]")).toHaveAccessibleName(
    "Alert",
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  // Waktu dan penandanya tetap terbaca penuh pada layar sempit.
  if ((await rows.count()) === 0) return;
  const first = rows.first();
  await expect(first.locator("time")).toBeVisible();
  await expect(first.locator("[data-time-source]")).toBeVisible();
});

// Waktu pada data tiruan yang punya alert pelanggan (ada titik di peta) dan
// alert router (tanpa titik), dipilih dari data itu sendiri supaya test tidak
// bergantung pada jam sebenarnya.
function findTimeWithBothKinds() {
  const start = 1_791_400_000;
  for (let t = start; t < start + 7 * 86_400; t += 300) {
    const alerts = mockActiveAlerts(t);
    const customer = alerts.find((alert) => alert.customerId !== null);
    const router = alerts.find((alert) => alert.customerId === null);
    if (customer && router) return { t, alerts, customer, router };
  }
  throw new Error("tidak ada waktu dengan kedua jenis alert pada data tiruan");
}

test("daftar alert menampilkan lokasi kejadian, dan tombol sorot membawa ke titiknya di peta", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { t, alerts, customer, router } = findTimeWithBothKinds();
  const person = createMockCustomers().find(
    (item) => item.id === customer.customerId,
  )!;
  await signUpAndOpenDashboard(page, "Petugas Sorot");

  await page.clock.install({ time: t * 1000 });
  await page.goto("/app/alert");
  const rows = page.getByTestId("alert-row");
  await expect(rows).toHaveCount(alerts.length);
  // Dua tabel di halaman ini punya kolom bernama sama; yang diperiksa yang aktif.
  const activeTable = page.getByRole("region", { name: "Daftar alert aktif" });
  await expect(
    activeTable.getByRole("columnheader", { name: "Lokasi" }),
  ).toBeVisible();
  await expect(
    activeTable.getByRole("columnheader", { name: "Peta" }),
  ).toBeVisible();

  // Setiap baris menulis lokasi dari datanya: ODP atau nama router di baris
  // utama, alamat atau penjelasan di bawahnya.
  for (const alert of alerts) {
    const row = page.locator(`[data-alert-id="${alert.id}"]`);
    const shown = describeLocation(alert.location);
    const place = row.locator("[data-has-point]");
    await expect(place).toContainText(shown.primary);
    if (shown.secondary) await expect(place).toContainText(shown.secondary);
    await expect(place).toHaveAttribute(
      "data-has-point",
      String(shown.hasPoint),
    );
  }

  // Alert router: tidak ada tombol, dan alasannya tertulis.
  const routerRow = page.locator(`[data-alert-id="${router.id}"]`);
  await expect(routerRow.getByRole("link", { name: /Sorot/ })).toHaveCount(0);
  await expect(routerRow).toContainText("Tidak ada titik");
  await expect(routerRow.locator("[data-has-point]")).toHaveAttribute(
    "data-has-point",
    "false",
  );

  // Alert pelanggan: tautan sorot dengan nama yang jelas bagi pembaca layar.
  const customerRow = page.locator(`[data-alert-id="${customer.id}"]`);
  const link = customerRow.getByRole("link", {
    name: `Sorot ${customer.location.name} di peta`,
  });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    `/app?focus=${encodeURIComponent(customer.customerId!)}`,
  );

  // Menekannya membuka dashboard dengan peta yang sudah bergeser ke pelanggan itu.
  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`/app\\?focus=${customer.customerId}$`),
  );
  const map = page.getByTestId("customer-map");
  await expect(map).toHaveAttribute("data-zoom", "16");
  await expect(page.getByTestId("map-focus-banner")).toContainText(
    `Menyorot ${person.name}`,
  );
  const ring = map.locator(".leaflet-tooltip-top");
  await expect(ring).toContainText(person.name);
  await expect(ring).toContainText(person.odpName);

  // Kembali ke daftar alert: daftar masih sama, dan tombolnya bisa dipakai lagi.
  await page.goBack();
  await expect(rows).toHaveCount(alerts.length);
  await expect(
    page
      .locator(`[data-alert-id="${customer.id}"]`)
      .getByRole("link", { name: /Sorot/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
