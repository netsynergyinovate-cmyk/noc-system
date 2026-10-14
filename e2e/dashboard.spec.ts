import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";

const headers = { Origin: "http://localhost:3101" };

// Daftar lewat API; cookie sesi ikut tersimpan di browser. Auth server
// membatasi sign-up beruntun, jadi tunggu jendela retry satu kali.
async function signUpAndOpenDashboard(page: Page, name: string) {
  const data = {
    name,
    email: `noc-${randomUUID()}@example.com`,
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

test("the dashboard shows mock data, a live chart, and a filterable customer table", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signUpAndOpenDashboard(page, "Petugas NOC");
  await expect(page.getByText("Data tiruan")).toBeVisible();

  await expect(
    page.getByText("Pelanggan online", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pelanggan offline", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Router aktif", { exact: true })).toBeVisible();
  await expect(page.locator(".traffic-chart canvas")).toBeVisible();
  await page.locator(".traffic-chart .u-over").hover();
  await expect(page.locator(".traffic-tip")).toContainText("Unggah");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator(".leaflet-overlay-pane canvas")).toHaveCount(1);

  await expect(
    page.getByRole("status").filter({ hasText: "Live" }),
  ).toBeVisible();
  const download = page.getByTestId("download-now");
  const firstValue = await download.textContent();
  await expect
    .poll(() => download.textContent(), { timeout: 8000 })
    .not.toBe(firstValue);

  // Data masuk tiap detik, tetapi sidebar tidak boleh ikut berubah. Lencana
  // jumlah alert di menu dan kalimat pengumumannya dikecualikan: keduanya memang
  // berubah sendiri saat daftar alert tiruan (yang mengikuti jam sebenarnya)
  // berganti, kira-kira 190 kali sehari, jadi tanpa pengecualian ini pengujian
  // gagal sesekali bila perubahan itu jatuh di dalam jendela 4 detik.
  const sidebarMutations = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const sidebar = document.querySelector("aside")!;
        const ownUpdates =
          "[data-testid=alert-count-badge], [data-testid=alert-count-status]";
        let count = 0;
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            const node =
              record.target instanceof Element
                ? record.target
                : record.target.parentElement;
            if (!node?.closest(ownUpdates)) count += 1;
          }
        });
        observer.observe(sidebar, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 4000);
      }),
  );
  expect(sidebarMutations).toBe(0);

  const rows = page
    .getByRole("region", { name: "Daftar status pelanggan" })
    .locator("tbody tr");
  await expect(rows).toHaveCount(100);

  const username = (
    await rows.first().locator(".font-mono").textContent()
  )?.trim();
  expect(username).toBeTruthy();
  await page.getByLabel("Cari pelanggan").fill(username!);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(username!);

  await page.getByLabel("Cari pelanggan").fill("tidak-ada-pelanggan-ini");
  await expect(
    page.getByText("Tidak ada pelanggan yang cocok dengan filter."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tampilkan semua pelanggan" }).click();
  await expect(rows).toHaveCount(100);

  // Status berubah sewaktu-waktu karena simulasi, jadi periksa tiap baris
  // yang tampil, bukan jumlah pastinya.
  await page.getByLabel("Status", { exact: true }).selectOption("offline");
  await expect(rows.filter({ hasText: "Online" })).toHaveCount(0);
  await expect(rows.filter({ hasText: "Sinyal lemah" })).toHaveCount(0);

  await page.getByLabel("Status", { exact: true }).selectOption("all");
  await page.getByLabel("Router", { exact: true }).selectOption({ index: 1 });
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(100);
  await expect(rows.filter({ hasText: "RTR-Barat-02" })).toHaveCount(0);
  await expect(rows.filter({ hasText: "RTR-Timur-03" })).toHaveCount(0);

  await page.getByRole("button", { name: "Reset filter" }).click();
  await expect(rows).toHaveCount(100);
  expect(errors).toEqual([]);
});

test("the traffic range picker switches between live and history, with incidents listed", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await signUpAndOpenDashboard(page, "Petugas Rentang");

  const picker = page.getByRole("group", { name: "Rentang waktu grafik" });
  const pick = (name: string) =>
    picker.getByRole("button", { name, exact: true });
  const download = page.getByTestId("download-now");
  const items = page.getByTestId("incident-item");

  await expect(pick("5 menit")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".traffic-chart canvas")).toBeVisible();

  // Histori: data tetap, jadi angka tidak berubah-ubah seperti rentang live.
  await pick("1 jam").click();
  await expect(pick("1 jam")).toHaveAttribute("aria-pressed", "true");
  await expect(pick("5 menit")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("rata-rata tiap 10 detik, 1 jam")).toBeVisible();
  await expect(page.locator(".traffic-chart canvas")).toBeVisible();
  await expect(
    page.getByText("terakhir", { exact: true }).first(),
  ).toBeVisible();
  const frozen = await download.textContent();
  await page.waitForTimeout(2500);
  await expect(download).toHaveText(frozen!);

  // Tujuh hari memuat banyak insiden; jumlah di judul sama dengan daftarnya.
  await pick("7 hari").click();
  await expect(page.getByText("rata-rata tiap 30 menit, 7 hari")).toBeVisible();
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeGreaterThan(5);
  await expect(
    page.getByRole("heading", {
      name: `Insiden pada rentang ini (${count})`,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Insiden pada rentang ini" }),
  ).toBeVisible();
  await page.locator(".traffic-chart .u-over").hover();
  await expect(page.locator(".traffic-tip")).toContainText("Unduh");

  // Menyapu kursor melintasi grafik: di atas pita insiden, kotak info juga
  // menyebut nama insidennya.
  const over = page.locator(".traffic-chart .u-over");
  const box = (await over.boundingBox())!;
  let named = false;
  for (let x = 4; x < box.width && !named; x += 5) {
    await page.mouse.move(box.x + x, box.y + box.height / 2);
    await page.waitForTimeout(30);
    named = ((await page.locator(".traffic-tip").textContent()) ?? "").includes(
      "Insiden:",
    );
  }
  expect(named).toBe(true);

  // Kembali ke live: angka bergerak lagi dan grafik tetap tergambar.
  await pick("5 menit").click();
  await expect(pick("5 menit")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("sekarang", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".traffic-chart canvas")).toBeVisible();
  const first = await download.textContent();
  await expect
    .poll(() => download.textContent(), { timeout: 8000 })
    .not.toBe(first);

  // Berpindah cepat antarrentang tidak meninggalkan grafik rentang lama.
  await pick("24 jam").click();
  await pick("6 jam").click();
  await expect(pick("6 jam")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("rata-rata tiap 1 menit, 6 jam")).toBeVisible();
  await expect(page.locator(".traffic-chart canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the map accepts a focus request: it zooms to the customer, marks them, and can show everyone again", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signUpAndOpenDashboard(page, "Petugas Peta");

  const customer = createMockCustomers()[41]; // customer-042
  const map = page.getByTestId("customer-map");
  const banner = page.getByTestId("map-focus-banner");
  const tooltip = map.locator(".leaflet-tooltip");
  const zoom = async () => Number(await map.getAttribute("data-zoom"));

  // Tanpa permintaan: peta menampilkan semua pelanggan, tanpa sorotan.
  await expect(map.locator(".leaflet-container")).toBeVisible();
  await expect(map).toHaveAttribute("data-zoom", /^\d+$/);
  const overview = await zoom();
  expect(overview).toBeLessThan(16);
  await expect(banner).toHaveCount(0);

  await page.goto(`/app?focus=${customer.id}`);
  await expect(map).toHaveAttribute("data-zoom", "16");
  await expect(banner).toContainText(`Menyorot ${customer.name}`);
  await expect(
    page.getByRole("status").filter({ hasText: "Peta digeser ke" }),
  ).toHaveText(`Peta digeser ke ${customer.name}`);

  // Nama pelanggan tampil permanen di titiknya, dan titik itu berada di tengah
  // peta (peta benar-benar bergeser, bukan sekadar memperbesar).
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText(customer.name);
  // ...bersama ODP-nya (bila dikenal) di baris kedua.
  expect(customer.odpName).toMatch(/^ODP-[A-Z]+-\d{2}$/);
  await expect(map.getByTestId("customer-odp")).toHaveText(customer.odpName);
  const view = (await map.locator(".leaflet-container").boundingBox())!;
  const label = (await tooltip.boundingBox())!;
  expect(
    Math.abs(label.x + label.width / 2 - (view.x + view.width / 2)),
  ).toBeLessThan(30);
  expect(label.x).toBeGreaterThanOrEqual(view.x);
  expect(label.x + label.width).toBeLessThanOrEqual(view.x + view.width);
  // Nama berada tepat di atas titik (cincin 16 px), jadi dasarnya dekat tengah
  // peta; bergeser ke titik yang salah (mis. hanya lintang) akan terlihat di sini.
  const middle = view.y + view.height / 2;
  expect(label.y + label.height).toBeGreaterThan(middle - 50);
  expect(label.y + label.height).toBeLessThan(middle);

  // Mengarahkan kursor ke titiknya memunculkan tooltip biasa, juga dengan ODP.
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await expect(tooltip).toHaveCount(2);
  await expect(map.getByTestId("customer-odp")).toHaveCount(2);
  await expect(map.getByTestId("customer-odp").last()).toHaveText(
    customer.odpName,
  );

  // Sorotan bisa ditutup: semua pelanggan kembali terlihat.
  await page.getByRole("button", { name: "Tampilkan semua" }).click();
  await expect(banner).toHaveCount(0);
  await expect(tooltip).toHaveCount(0);
  await expect.poll(zoom).toBeLessThan(16);

  // Pelanggan yang tidak ada: dijelaskan, tanpa menggeser peta.
  await page.goto("/app?focus=pelanggan-tidak-ada");
  await expect(banner).toHaveText("Pelanggan tidak (atau belum) ada di peta");
  await expect(map.locator(".leaflet-container")).toBeVisible();
  await expect(tooltip).toHaveCount(0);
  expect(await zoom()).toBeLessThan(16);
  await page.getByRole("button", { name: "Tutup" }).click();
  await expect(banner).toHaveCount(0);

  // Nilai yang tidak masuk akal diabaikan.
  for (const bad of ["", "%20", "x".repeat(101)]) {
    await page.goto(`/app?focus=${bad}`);
    await expect(map.locator(".leaflet-container")).toBeVisible();
    await expect(banner).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("the dashboard fits a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpAndOpenDashboard(page, "Petugas HP");
  await expect(page.locator(".traffic-chart canvas")).toBeVisible();
  const overflows = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
  expect(await overflows()).toBe(false);

  // Rentang berhari-hari: label tanggal dan daftar insiden lebih panjang.
  await page
    .getByRole("group", { name: "Rentang waktu grafik" })
    .getByRole("button", { name: "7 hari", exact: true })
    .click();
  await expect(page.getByTestId("incident-item").first()).toBeVisible();
  await expect(page.locator(".traffic-chart canvas")).toBeVisible();
  expect(await overflows()).toBe(false);
});

test("dark mode follows the saved choice and the system setting, without a flash", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signUpAndOpenDashboard(page, "Petugas Gelap");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", "id");
  await expect(html).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: "Tema gelap" }).click();
  await expect(html).toHaveClass(/dark/);
  await expect(
    page.getByRole("button", { name: "Tema gelap" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".traffic-chart canvas")).toBeVisible();

  // Pilihan tersimpan: setelah muat ulang, kelas sudah terpasang saat HTML
  // pertama diurai, sebelum React berjalan.
  await page.reload();
  await expect(html).toHaveClass(/dark/);

  await page.getByRole("button", { name: "Ikuti tema sistem" }).click();
  await expect(html).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveClass(/dark/);

  await page.getByRole("button", { name: "Tema terang" }).click();
  await expect(html).not.toHaveClass(/dark/);
  await page.reload();
  await expect(html).not.toHaveClass(/dark/);
});

test("in demo mode the setup page says the gate is off and opens the dashboard", async ({
  page,
}) => {
  await signUpAndOpenDashboard(page, "Petugas Setup");
  await page.goto("/setup");
  await expect(
    page.getByRole("heading", { name: "Setup Perangkat" }),
  ).toBeVisible();
  await expect(page.getByText("Mode demo aktif")).toBeVisible();
  await page.getByRole("link", { name: "Buka dashboard demo" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();
});
