import { expect, test } from "@playwright/test";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";
import { contextFor, signUp, type Cookies } from "./billing-ui";

const customers = createMockCustomers();
const targetCustomer = customers.find((c) => c.id === "customer-042")!;
const fallbackCustomer = customers.find((c) => c.id === "customer-010")!;

let cookies: Cookies;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Peta Satelit");
  await context.close();
});

test.describe("Upgrade CustomerMap: Satelit, GPS, ODP & Rute Kabel", () => {
  test("memuat peta dengan layer satelit Google Hybrid secara default beserta atribusinya", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await page.goto("/app");

    const map = page.getByTestId("customer-map");
    await expect(map).toBeVisible();

    // Tombol layer switcher berada pada mode Satelit secara default
    const switcher = page.getByTestId("layer-switcher");
    await expect(switcher).toBeVisible();
    await expect(switcher).toHaveAttribute("data-layer", "satellite");
    await expect(switcher).toContainText("Satelit");

    // Atribusi peta memuat tautan Google Maps
    const attribution = map.locator(".leaflet-control-attribution");
    await expect(attribution).toBeVisible();
    await expect(attribution).toContainText("Google Maps");
    await expect(
      attribution.locator('a[href*="google.com/maps"]'),
    ).toHaveCount(1);

    // Memverifikasi tile satelit google.com (mt0-mt3) dimuat
    const tileImages = map.locator(
      '.leaflet-tile-pane img[src*="google.com"]',
    );
    await expect.poll(async () => await tileImages.count()).toBeGreaterThan(0);

    expect(errors).toEqual([]);
    await context.close();
  });

  test("tombol layer switcher mengalihkan tampilan antara Satelit dan Peta Jalan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await page.goto("/app");

    const map = page.getByTestId("customer-map");
    const switcher = page.getByTestId("layer-switcher");
    const attribution = map.locator(".leaflet-control-attribution");

    // Keadaan awal: Satelit
    await expect(switcher).toHaveAttribute("data-layer", "satellite");
    await expect(switcher).toContainText("Satelit");
    await expect(attribution).toContainText("Google Maps");

    // Alihkan ke Peta Jalan (OpenStreetMap)
    await switcher.click();
    await expect(switcher).toHaveAttribute("data-layer", "streets");
    await expect(switcher).toContainText("Peta Jalan");
    await expect(attribution).toContainText("OpenStreetMap");

    // Alihkan kembali ke Satelit
    await switcher.click();
    await expect(switcher).toHaveAttribute("data-layer", "satellite");
    await expect(switcher).toContainText("Satelit");
    await expect(attribution).toContainText("Google Maps");

    expect(errors).toEqual([]);
    await context.close();
  });

  test("tombol GPS 'Lokasi Saya' memiliki label aksesibel dan memicu penandaan posisi teknisi", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);

    // Beri izin dan koordinat geolokasi tiruan di Bandung
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: -6.9175, longitude: 107.6191 });

    await page.goto("/app");

    const gpsBtn = page.getByTestId("gps-button");
    await expect(gpsBtn).toBeVisible();
    await expect(gpsBtn).toHaveAttribute("aria-label", "Lokasi Saya");
    await expect(gpsBtn).toContainText("Lokasi Saya");

    // Klik tombol GPS
    await gpsBtn.click();

    // Memverifikasi tombol menandai status lokasi ditemukan
    await expect(gpsBtn).toHaveAttribute("data-located", "true");

    // Memverifikasi marker lokasi pengguna muncul di layer Leaflet
    const hasUserMarker = await page.evaluate(() => {
      const container = document.querySelector(
        '[data-testid="customer-map"] .leaflet-container',
      ) as HTMLElement & { _leaflet_map?: any };
      const leafletMap = container?._leaflet_map;
      if (!leafletMap) return false;
      let found = false;
      leafletMap.eachLayer((layer: any) => {
        if (layer.options?.fillColor === "#2563eb") {
          found = true;
        }
      });
      return found;
    });
    expect(hasUserMarker).toBe(true);

    expect(errors).toEqual([]);
    await context.close();
  });

  test("titik distribusi ODP terpasang pada peta beserta data aksesibelnya", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await page.goto("/app");

    const map = page.getByTestId("customer-map");
    await expect(map).toBeVisible();

    // Peta memiliki atribut jumlah titik ODP
    const odpCountAttr = await map.getAttribute("data-odp-count");
    expect(Number(odpCountAttr)).toBeGreaterThanOrEqual(8);

    // Daftar marker ODP terdaftar di penampung aksesibel
    const odpMarkers = page.getByTestId("odp-marker");
    await expect(odpMarkers).toHaveCount(Number(odpCountAttr));

    // ODP spesifik seperti ODP-CHP-01 terdaftar
    const chpOdp = page.locator(
      '[data-testid="odp-marker"][data-odp-name="ODP-CHP-01"]',
    );
    await expect(chpOdp).toBeVisible();
    await expect(chpOdp).toContainText("ODP-CHP-01");

    // Memverifikasi pada layer Leaflet bahwa CircleMarker ODP (cyan #06b6d4) terpasang
    const leafletOdpCount = await page.evaluate(() => {
      const container = document.querySelector(
        '[data-testid="customer-map"] .leaflet-container',
      ) as HTMLElement & { _leaflet_map?: any };
      const leafletMap = container?._leaflet_map;
      if (!leafletMap) return 0;
      let count = 0;
      leafletMap.eachLayer((layer: any) => {
        if (layer.options?.fillColor === "#06b6d4") {
          count++;
        }
      });
      return count;
    });
    expect(leafletOdpCount).toBe(Number(odpCountAttr));

    expect(errors).toEqual([]);
    await context.close();
  });

  test("menyorot pelanggan via URL (/app?focus=customer-042) menampilkan banner dengan panjang kabel dan menggambar polyline rute jalan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);

    // Mock respons OSRM road routing API
    await page.route("**/router.project-osrm.org/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 275.5,
              geometry: {
                coordinates: [
                  [107.6043, -6.9291],
                  [107.605, -6.928],
                  [107.606, -6.927],
                ],
              },
            },
          ],
        }),
      });
    });

    await page.goto(`/app?focus=${targetCustomer.id}`);

    const map = page.getByTestId("customer-map");
    const banner = page.getByTestId("map-focus-banner");

    // Banner sorotan muncul dengan nama pelanggan
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`Menyorot ${targetCustomer.name}`);

    // Banner memuat informasi kabel dan ODP
    await expect(banner).toContainText("Kabel: 276 m");
    await expect(banner).toContainText(targetCustomer.odpName);

    // Map container memiliki atribut route aktif
    await expect(map).toHaveAttribute("data-has-route", "true");
    await expect(map).toHaveAttribute("data-cable-distance", "276");

    // Leaflet layer memiliki Polyline rute jalan berwarna cyan (#22d3ee)
    const hasRoadPolyline = await page.evaluate(() => {
      const container = document.querySelector(
        '[data-testid="customer-map"] .leaflet-container',
      ) as HTMLElement & { _leaflet_map?: any };
      const leafletMap = container?._leaflet_map;
      if (!leafletMap) return false;
      let found = false;
      leafletMap.eachLayer((layer: any) => {
        if (
          layer.options?.color === "#22d3ee" &&
          Array.isArray(layer._latlngs) &&
          layer._latlngs.length >= 2
        ) {
          found = true;
        }
      });
      return found;
    });
    expect(hasRoadPolyline).toBe(true);

    expect(errors).toEqual([]);
    await context.close();
  });

  test("menutup sorotan pelanggan membersihkan rute kabel dari peta", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);

    await page.route("**/router.project-osrm.org/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 150,
              geometry: {
                coordinates: [
                  [107.6191, -6.9175],
                  [107.6195, -6.918],
                ],
              },
            },
          ],
        }),
      });
    });

    await page.goto("/app?focus=customer-001");
    const map = page.getByTestId("customer-map");
    const banner = page.getByTestId("map-focus-banner");

    await expect(banner).toBeVisible();
    await expect(map).toHaveAttribute("data-has-route", "true");

    // Klik tombol "Tampilkan semua" untuk menutup sorotan
    const showAllBtn = page.getByRole("button", { name: "Tampilkan semua" });
    await showAllBtn.click();

    // Banner hilang dan atribut rute dibersihkan
    await expect(banner).toHaveCount(0);
    await expect(map).not.toHaveAttribute("data-has-route", "true");

    expect(errors).toEqual([]);
    await context.close();
  });

  test("rute kabel tetap ditampilkan dengan fallback jarak lurus bila OSRM gagal", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);

    // Simulasikan kegagalan panggilan OSRM
    await page.route("**/router.project-osrm.org/**", async (route) => {
      await route.abort("failed");
    });

    await page.goto(`/app?focus=${fallbackCustomer.id}`);

    const map = page.getByTestId("customer-map");
    const banner = page.getByTestId("map-focus-banner");

    // Banner tetap tampil dan memuat perkiraan kabel fallback
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`Menyorot ${fallbackCustomer.name}`);
    await expect(banner).toContainText("Kabel:");
    await expect(banner).toContainText(fallbackCustomer.odpName);

    // Polyline fallback tetap digambar
    await expect(map).toHaveAttribute("data-has-route", "true");

    expect(errors).toEqual([]);
    await context.close();
  });
});
