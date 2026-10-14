import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";
import { useDashboardStore } from "../src/lib/dashboard/store";

// Uji penerimaan untuk peta sebaran: permintaan sorot dan tooltip lokasi/ODP.
// Bagian pertama menguji logika permintaan dan data tanpa browser; sisanya
// memakai dashboard sungguhan.

const headers = { Origin: "http://localhost:3101" };
const customers = createMockCustomers();

test.describe("permintaan sorot di store", () => {
  test.beforeEach(() => useDashboardStore.getState().clearMapFocus());

  test("permintaan menyimpan pelanggan dan nomor urut, dan bisa ditutup", () => {
    const { focusMap, clearMapFocus } = useDashboardStore.getState();
    expect(useDashboardStore.getState().mapFocus).toBeNull();

    focusMap("customer-007");
    const first = useDashboardStore.getState().mapFocus!;
    expect(first.customerId).toBe("customer-007");
    expect(first.seq).toBeGreaterThan(0);

    clearMapFocus();
    expect(useDashboardStore.getState().mapFocus).toBeNull();
  });

  test("meminta pelanggan yang sama lagi tetap menjadi permintaan baru", () => {
    const { focusMap } = useDashboardStore.getState();
    focusMap("customer-007");
    const first = useDashboardStore.getState().mapFocus!;
    focusMap("customer-007");
    const second = useDashboardStore.getState().mapFocus!;
    // Peta menggeser diri hanya saat nomor urutnya berganti; tanpa ini, pengguna
    // yang sudah menggeser peta sendiri tidak bisa dikembalikan ke pelanggan itu.
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(second).not.toBe(first);
  });

  test("nomor urut tidak pernah mundur, juga setelah sorotan ditutup", () => {
    const { focusMap, clearMapFocus } = useDashboardStore.getState();
    const seen: number[] = [];
    for (const id of ["customer-001", "customer-002", "customer-001"]) {
      focusMap(id);
      seen.push(useDashboardStore.getState().mapFocus!.seq);
      clearMapFocus();
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("permintaan tidak menyentuh data lain, jadi tidak membuat komponen lain digambar ulang", () => {
    const before = useDashboardStore.getState();
    before.focusMap("customer-010");
    const after = useDashboardStore.getState();
    expect(after.customers).toBe(before.customers);
    expect(after.traffic).toBe(before.traffic);
    expect(after.routers).toBe(before.routers);
    expect(after.onlineCount).toBe(before.onlineCount);
  });
});

test.describe("data ODP tiruan", () => {
  test("setiap pelanggan punya ODP dengan bentuk nama yang sama", () => {
    for (const customer of customers) {
      expect(customer.odpName, customer.id).toMatch(/^ODP-[A-Z]{3}-\d{2}$/);
    }
  });

  test("ada beberapa ODP, masing-masing dipakai pelanggan yang berdekatan", () => {
    const byOdp = new Map<string, typeof customers>();
    for (const customer of customers) {
      byOdp.set(customer.odpName, [
        ...(byOdp.get(customer.odpName) ?? []),
        customer,
      ]);
    }
    expect(byOdp.size).toBeGreaterThanOrEqual(8);
    expect(byOdp.size).toBeLessThanOrEqual(12);
    for (const [odp, members] of byOdp) {
      const lats = members.map((customer) => customer.latitude);
      const lngs = members.map((customer) => customer.longitude);
      // Satu ODP melayani satu sel kisi (0,0133 x 0,01 derajat), bukan seluruh kota.
      expect(
        Math.max(...lats) - Math.min(...lats),
        `${odp}: sebaran lintang`,
      ).toBeLessThan(0.015);
      expect(
        Math.max(...lngs) - Math.min(...lngs),
        `${odp}: sebaran bujur`,
      ).toBeLessThan(0.011);
    }
  });

  test("data tiruan sama setiap dibuat, supaya HTML server dan browser identik", () => {
    expect(createMockCustomers()).toEqual(customers);
  });
});

async function signUpAndOpen(page: Page, name: string, path = "/app") {
  const data = {
    name,
    email: `map-${randomUUID()}@example.com`,
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
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();
}

function mapLocators(page: Page) {
  const map = page.getByTestId("customer-map");
  return {
    map,
    view: map.locator(".leaflet-container"),
    banner: page.getByTestId("map-focus-banner"),
    // Tooltip permanen milik cincin sorotan; tooltip kursor memakai arah lain.
    ring: map.locator(".leaflet-tooltip-top"),
    zoom: async () => Number(await map.getAttribute("data-zoom")),
  };
}

// Selisih mendatar antara pusat kotak dan pusat peta, dalam piksel.
async function offCenterX(
  page: Page,
  box: () => Promise<{ x: number; width: number } | null>,
) {
  const { view } = mapLocators(page);
  const frame = (await view.boundingBox())!;
  const target = (await box())!;
  return Math.abs(target.x + target.width / 2 - (frame.x + frame.width / 2));
}

test("banner sorotan tidak menutupi tombol zoom, bisa dijangkau papan ketik, dan mengembalikan fokus ke peta", async ({
  page,
}) => {
  await signUpAndOpen(page, "Petugas Papan Ketik");
  const { map, view, banner, zoom } = mapLocators(page);
  await page.goto("/app?focus=customer-042");
  await expect(map).toHaveAttribute("data-zoom", "16");

  // Tidak ada tumpang tindih dengan kontrol zoom Leaflet, dan banner tetap di dalam peta.
  const frame = (await view.boundingBox())!;
  const bannerBox = (await banner.boundingBox())!;
  const zoomBox = (await map.locator(".leaflet-control-zoom").boundingBox())!;
  expect(bannerBox.x).toBeGreaterThanOrEqual(zoomBox.x + zoomBox.width);
  expect(bannerBox.x + bannerBox.width).toBeLessThanOrEqual(
    frame.x + frame.width,
  );
  expect(bannerBox.y).toBeGreaterThanOrEqual(frame.y);

  // Tombolnya urutan Tab berikutnya setelah tautan atribusi peta, lalu Enter
  // menutup sorotan dan fokus kembali ke peta (bukan hilang ke awal halaman).
  await map.locator(".leaflet-control-attribution a").last().focus();
  await page.keyboard.press("Tab");
  const showAll = page.getByRole("button", { name: "Tampilkan semua" });
  await expect(showAll).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(banner).toHaveCount(0);
  await expect(view).toBeFocused();
  await expect.poll(zoom).toBeLessThan(16);
});

test("permintaan baru lewat navigasi di halaman menggeser peta lagi, juga setelah pengguna menggesernya sendiri", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const [first, second] = [customers[9], customers[70]];
  await signUpAndOpen(page, "Petugas Navigasi");
  await page.goto(`/app?focus=${first.id}`);
  const { map, view, banner, ring, zoom } = mapLocators(page);
  await expect(map).toHaveAttribute("data-zoom", "16");
  await expect(ring).toContainText(first.name);
  await expect
    .poll(() => offCenterX(page, () => ring.boundingBox()))
    .toBeLessThan(30);

  // Tanda: bila halaman dimuat ulang, penanda ini hilang.
  await page.evaluate(() => {
    (window as unknown as { keptAlive: boolean }).keptAlive = true;
  });

  // Pengguna menggeser peta sendiri: sorotan tidak lagi di tengah.
  const frame = (await view.boundingBox())!;
  const middle = {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 90, middle.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => offCenterX(page, () => ring.boundingBox()))
    .toBeGreaterThan(60);

  // Permintaan untuk pelanggan lain (navigasi sisi klien, tanpa memuat ulang).
  await page.mouse.move(0, 0);
  await page.evaluate((url) => {
    (
      window as unknown as { next: { router: { push(url: string): void } } }
    ).next.router.push(url);
  }, `/app?focus=${second.id}`);
  await expect(banner).toContainText(`Menyorot ${second.name}`);
  await expect(ring).toHaveCount(1);
  await expect(ring).toContainText(second.name);
  await expect(ring).toContainText(second.odpName);
  await expect
    .poll(() => offCenterX(page, () => ring.boundingBox()))
    .toBeLessThan(30);
  expect(await zoom()).toBe(16);
  expect(
    await page.evaluate(
      () => (window as unknown as { keptAlive?: boolean }).keptAlive,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("sorotan muat di layar sempit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpAndOpen(page, "Petugas HP Peta");
  const customer = customers[98];
  await page.goto(`/app?focus=${customer.id}`);
  const { map, view, banner, ring } = mapLocators(page);
  await expect(map).toHaveAttribute("data-zoom", "16");
  await expect(ring).toContainText(customer.odpName);

  const frame = (await view.boundingBox())!;
  for (const [name, box] of [
    ["banner", await banner.boundingBox()],
    ["tooltip", await ring.boundingBox()],
  ] as const) {
    expect(box, name).not.toBeNull();
    expect(box!.x, `${name} kiri`).toBeGreaterThanOrEqual(frame.x);
    expect(box!.x + box!.width, `${name} kanan`).toBeLessThanOrEqual(
      frame.x + frame.width,
    );
  }
  const button = page.getByRole("button", { name: "Tampilkan semua" });
  const buttonBox = (await button.boundingBox())!;
  expect(buttonBox.height).toBeGreaterThanOrEqual(24);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
