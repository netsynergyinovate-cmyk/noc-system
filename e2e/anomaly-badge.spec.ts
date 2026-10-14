import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { mockActiveAlerts } from "../src/lib/dashboard/alerts";
import {
  isActive,
  sortAnomalies,
  summarizeAnomalies,
} from "../src/lib/dashboard/anomalies";
import { loadAnomalies } from "../src/lib/dashboard/anomaly-feed";

// Badge indikator anomali di dasbor: berapa yang aktif, warna menurut yang
// paling genting, dan tautan ke daftar alert aktif. Waktu dipasang palsu pada
// momen yang dipilih dari data tiruannya sendiri, supaya hasilnya pasti.

const headers = { Origin: "http://localhost:3101" };
const START = 1_791_400_000;
const GRID = Array.from(
  { length: (7 * 86_400) / 300 },
  (_, i) => START + i * 300,
);

function severityOf(t: number) {
  const alerts = mockActiveAlerts(t);
  const critical = alerts.filter((alert) => alert.severity === "critical");
  return { alerts, critical: critical.length };
}

function findTime(
  pick: (state: { alerts: unknown[]; critical: number }) => boolean,
  label: string,
) {
  for (const t of GRID) if (pick(severityOf(t))) return t;
  throw new Error(`tidak ada waktu untuk: ${label}`);
}

test.describe("data anomali yang menyatu dengan alert aktif", () => {
  test("yang aktif di daftar anomali sama persis dengan alert aktif", async () => {
    const problems: string[] = [];
    for (const t of GRID.filter((_, i) => i % 7 === 0)) {
      const list = await loadAnomalies(t);
      const active = list
        .filter(isActive)
        .map((item) => item.id)
        .sort();
      const alerts = mockActiveAlerts(t)
        .map((alert) => alert.id)
        .sort();
      if (JSON.stringify(active) !== JSON.stringify(alerts))
        problems.push(
          `t=${t}: aktif ${active.length} vs alert ${alerts.length}`,
        );
      const summary = summarizeAnomalies(list, t);
      if (summary.active !== alerts.length)
        problems.push(`t=${t}: ringkasan aktif`);
      if (new Set(list.map((item) => item.id)).size !== list.length)
        problems.push(`t=${t}: id ganda`);
      if (JSON.stringify(list) !== JSON.stringify(sortAnomalies(list)))
        problems.push(`t=${t}: urutan`);
    }
    expect(problems).toEqual([]);
  });

  test("riwayatnya hanya yang sudah selesai, dan ada cukup banyak", async () => {
    const list = await loadAnomalies(START);
    const history = list.filter((item) => !isActive(item));
    expect(history.length).toBeGreaterThan(10);
    expect(history.every((item) => item.endedAt !== null)).toBe(true);
    expect(history.every((item) => !item.id.startsWith("alert-"))).toBe(true);
  });

  test("ketiga keadaan badge ada pada data tiruan", () => {
    expect(
      findTime(({ alerts }) => alerts.length === 0, "kosong"),
    ).toBeGreaterThan(0);
    expect(
      findTime(
        ({ alerts, critical }) => alerts.length > 0 && critical === 0,
        "peringatan",
      ),
    ).toBeGreaterThan(0);
    expect(findTime(({ critical }) => critical > 0, "kritis")).toBeGreaterThan(
      0,
    );
  });
});

async function signUp(page: Page, name: string) {
  const data = {
    name,
    email: `badge-${randomUUID()}@example.com`,
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

async function openDashboardAt(page: Page, t: number) {
  await signUp(page, "Petugas Badge");
  await page.clock.install({ time: t * 1000 });
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();
  return page.getByTestId("anomaly-badge");
}

test("badge merah menyebut jumlah dan yang kritis, dan membuka daftar alert aktif", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const t = findTime(({ critical }) => critical > 0, "kritis");
  const { alerts, critical } = severityOf(t);
  const badge = await openDashboardAt(page, t);

  await expect(badge).toHaveAttribute("data-tone", "critical");
  await expect(badge).toHaveAttribute("data-count", String(alerts.length));
  await expect(badge).toHaveAttribute("data-critical", String(critical));
  await expect(badge).toHaveText(
    `${alerts.length} anomali aktif, ${critical} kritis`,
  );
  await expect(badge).toHaveAttribute("href", "/app/alert");
  // Nama yang dibaca pembaca layar memuat ringkasan dan tujuan tautan.
  await expect(
    page.getByRole("link", {
      name: /anomali aktif.*kritis.*Buka daftar alert aktif/,
    }),
  ).toBeVisible();

  // Menekannya membuka daftar yang jumlah barisnya sama dengan angka di badge.
  await badge.click();
  await expect(page).toHaveURL(/\/app\/alert$/);
  await expect(page.getByTestId("alert-row")).toHaveCount(alerts.length);
  expect(errors).toEqual([]);
});

test("badge kuning bila tidak ada yang kritis, dan hijau bila tidak ada anomali", async ({
  page,
}) => {
  const warningAt = findTime(
    ({ alerts, critical }) => alerts.length > 0 && critical === 0,
    "peringatan",
  );
  const warning = severityOf(warningAt).alerts.length;
  const badge = await openDashboardAt(page, warningAt);
  await expect(badge).toHaveAttribute("data-tone", "warning");
  await expect(badge).toHaveText(`${warning} anomali aktif`);

  // Keadaan aman: hijau dan tertulis jelas, bukan angka nol yang kosong.
  const quietAt = findTime(({ alerts }) => alerts.length === 0, "kosong");
  await page.clock.setFixedTime(quietAt * 1000);
  await page.clock.runFor(6_000); // satu putaran penyegaran
  await expect(badge).toHaveAttribute("data-tone", "ok");
  await expect(badge).toHaveAttribute("data-count", "0");
  await expect(badge).toHaveText("Tidak ada anomali aktif");
});

test("badge ikut berubah saat anomali baru muncul tanpa memuat ulang halaman", async ({
  page,
}) => {
  // Dua momen berselang 10 menit dengan jumlah berbeda, dan jumlah itu tetap
  // sama selama beberapa detik di sekitar momen kedua (agar tidak bergantung
  // pada tepatnya detik penyegaran).
  let pair: { from: number; to: number } | null = null;
  for (const t of GRID) {
    const to = t + 600;
    const before = mockActiveAlerts(t).length;
    const stable = [-7, -3, 0, 3].every(
      (delta) =>
        mockActiveAlerts(to + delta).length === mockActiveAlerts(to).length,
    );
    if (stable && mockActiveAlerts(to).length !== before && before > 0) {
      pair = { from: t, to };
      break;
    }
  }
  expect(pair, "pasangan momen dengan jumlah berbeda").toBeTruthy();
  const { from, to } = pair!;
  const badge = await openDashboardAt(page, from);
  await expect(badge).toHaveAttribute(
    "data-count",
    String(mockActiveAlerts(from).length),
  );

  await page.evaluate(() => {
    (window as unknown as { keptAlive: boolean }).keptAlive = true;
  });
  await page.clock.runFor(600_000);
  await expect(badge).toHaveAttribute(
    "data-count",
    String(mockActiveAlerts(to).length),
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { keptAlive?: boolean }).keptAlive,
    ),
  ).toBe(true);
});

test("badge terlihat penuh di layar sempit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const t = findTime(({ critical }) => critical > 0, "kritis");
  const badge = await openDashboardAt(page, t);
  await expect(badge).toBeVisible();
  const box = (await badge.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
