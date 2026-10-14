import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { mockActiveAlerts } from "../src/lib/dashboard/alerts";
import { buildIncidentCards } from "../src/lib/dashboard/incident-cards";

// Uji penerimaan: alert yang satu penyebab menjadi SATU kartu insiden di halaman
// Deteksi Anomali, dan semua halaman sepakat tentang alert yang sama. Jam browser
// dipasang palsu pada momen yang dipilih dari data tiruannya sendiri.

test.use({ timezoneId: "Asia/Jakarta" });

const headers = { Origin: "http://localhost:3101" };
const START = 1_791_400_000;

// Momen dengan kartu router gabungan, kartu ODP gabungan, dan kartu tunggal;
// kartu gabungan jarang bersamaan, jadi pencarian meluas sampai 30 hari.
function findBusyTime() {
  for (let t = START; t < START + 30 * 86_400; t += 300) {
    const cards = buildIncidentCards(mockActiveAlerts(t));
    if (
      cards.some((c) => c.cause === "router" && c.alertCount > 1) &&
      cards.some((c) => c.cause === "odp") &&
      cards.some((c) => c.alertCount === 1)
    ) {
      return { t, alerts: mockActiveAlerts(t), cards };
    }
  }
  throw new Error("tidak ada momen dengan kartu router, ODP, dan tunggal");
}

async function signUp(page: Page) {
  const data = {
    name: "Petugas Penerimaan",
    email: `terima-${randomUUID()}@example.com`,
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

test("alert yang satu penyebab menjadi satu kartu, dan semua halaman sepakat tentang alert yang sama", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { t, alerts, cards } = findBusyTime();
  const expectedIds = alerts.map((alert) => alert.id).sort();
  await signUp(page);
  await page.clock.install({ time: t * 1000 });
  await page.goto("/app/anomali");

  // 1. Kartu: satu per kelompok, dengan jumlah anggota yang benar.
  const shown = page.getByTestId("incident-card");
  await expect(shown).toHaveCount(cards.length);
  const counts = await shown.evaluateAll((items) =>
    items.map((item) => [
      item.getAttribute("data-card-id"),
      Number(item.getAttribute("data-alert-count")),
    ]),
  );
  expect(counts).toEqual(cards.map((card) => [card.id, card.alertCount]));
  expect(counts.reduce((sum, [, n]) => sum + (n as number), 0)).toBe(
    alerts.length,
  );

  // 2. Buka semua kartu: anggota tiap kartu, dan tak satu alert pun di dua kartu.
  for (const toggle of await page.getByTestId("incident-toggle").all()) {
    await toggle.click();
  }
  const seen: string[] = [];
  for (const card of cards) {
    const view = page.locator(
      `[data-testid=incident-card][data-card-id="${card.id}"]`,
    );
    const rows = view.getByTestId("alert-row");
    await expect(rows).toHaveCount(card.alertCount);
    const inCard = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-alert-id")!),
    );
    expect(inCard).toEqual(card.alerts.map((alert) => alert.id));
    seen.push(...inCard);
  }
  expect(new Set(seen).size).toBe(seen.length);
  expect([...seen].sort()).toEqual(expectedIds);

  // Kartu gabungan benar-benar berisi lebih dari satu alert yang sama sebabnya,
  // dengan alasan yang tertulis; kartu tunggal tidak punya alasan.
  for (const card of cards) {
    const view = page.locator(
      `[data-testid=incident-card][data-card-id="${card.id}"]`,
    );
    if (card.alertCount > 1) {
      await expect(view.getByTestId("incident-details")).toContainText(
        "Mengapa dikelompokkan",
      );
      for (const reason of card.reasons) {
        await expect(view.getByTestId("incident-details")).toContainText(
          reason,
        );
      }
    } else {
      await expect(view.getByTestId("incident-details")).toContainText(
        "Tidak ada alert lain yang berkaitan",
      );
    }
  }

  // 3. Ringkasan di halaman yang sama menghitung alert yang sama.
  const summary = page.getByRole("region", { name: "Ringkasan anomali" });
  await expect(summary).toContainText("Anomali aktif");
  const activeValue = summary
    .locator("p", { hasText: "Anomali aktif" })
    .locator("xpath=following-sibling::p[1]");
  await expect(activeValue).toHaveText(String(alerts.length));

  // 4. Halaman Alert menampilkan alert yang sama persis di daftar aktifnya.
  const menu = page.getByRole("navigation", { name: "Menu utama" });
  await menu.getByRole("link", { name: "Alert", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/alert$/);
  const alertRows = page.getByTestId("alert-row");
  await expect(alertRows).toHaveCount(alerts.length);
  const listed = await alertRows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-alert-id")!).sort(),
  );
  expect(listed).toEqual(expectedIds);

  // 5. Dasbor: lencana menghitung alert yang sama.
  await menu.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByTestId("anomaly-badge")).toHaveAttribute(
    "data-count",
    String(alerts.length),
  );
  expect(errors).toEqual([]);
});

test("setiap kartu gabungan menyebut satu akar, dan angkanya sama dengan alert anggotanya", async ({
  page,
}) => {
  const { t, cards } = findBusyTime();
  await signUp(page);
  await page.clock.install({ time: t * 1000 });
  await page.goto("/app/anomali");
  await expect(page.getByTestId("incident-card")).toHaveCount(cards.length);

  for (const card of cards.filter((c) => c.alertCount > 1)) {
    const view = page.locator(
      `[data-testid=incident-card][data-card-id="${card.id}"]`,
    );
    // Satu akar yang sama untuk seluruh kartu, ditulis sekali.
    await expect(view.getByTestId("incident-root")).toHaveCount(1);
    await expect(view.getByTestId("incident-root")).toContainText(
      card.rootSource.name,
    );
    // Jumlah terdampak = pelanggan berbeda di antara anggota.
    const customers = new Set(
      card.alerts.flatMap((a) => (a.customerId ? [a.customerId] : [])),
    );
    await expect(view).toHaveAttribute("data-affected", String(customers.size));
    // Semua anggota berada di router yang sama dengan kartunya.
    expect(new Set(card.alerts.map((a) => a.routerId)).size).toBe(1);
    expect(card.alerts[0].routerId).toBe(card.routerId);
  }
});
