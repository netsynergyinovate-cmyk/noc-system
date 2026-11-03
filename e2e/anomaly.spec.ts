import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  anomalyRules,
  describeAnomaly,
  isActive,
  sortAnomalies,
  summarizeAnomalies,
  summarizeByKind,
  toAnomaly,
  type Anomaly,
} from "../src/lib/dashboard/anomalies";
import { loadAnomalies } from "../src/lib/dashboard/anomaly-feed";
import { incidentLabels } from "../src/lib/dashboard/incidents";
import {
  createMockCustomers,
  mockRouters,
} from "../src/lib/dashboard/mock-data";

// Halaman Deteksi Anomali dengan data tiruan. Bagian pertama menguji data dan
// perhitungannya tanpa browser; sisanya memakai dashboard sungguhan.

const headers = { Origin: "http://localhost:3101" };
const NOW = 1_791_400_000;
const customerIds = new Set(
  createMockCustomers().map((customer) => customer.id),
);
const routerIds = new Set(mockRouters.map((router) => router.id));

function anomaly(overrides: Partial<Anomaly>): Anomaly {
  return {
    id: "x",
    kind: "cpu",
    severity: "critical",
    startedAt: NOW - 600,
    endedAt: null,
    routerId: "router-1",
    customerId: null,
    interfaceName: null,
    measured: 90,
    rootSource: { kind: "router", id: "router-1", name: "router-1" },
    affectedCustomers: 0,
    servedCustomers: 0,
    correlationId: null,
    ...overrides,
  };
}

test.describe("data anomali tiruan", () => {
  test("sama setiap dihitung untuk waktu yang sama, dan berubah mengikuti waktu", async () => {
    const first = await loadAnomalies(NOW);
    expect(await loadAnomalies(NOW)).toEqual(first);
    expect(first.length).toBeGreaterThan(10);
    // Beberapa menit kemudian daftar yang sama, hanya sebagian yang selesai.
    const later = await loadAnomalies(NOW + 3600);
    const kept = later.filter((item) =>
      first.some((old) => old.id === item.id),
    );
    expect(kept.length).toBeGreaterThan(first.length / 2);
  });

  test("anomali aktif di atas (kritis dulu), lalu yang selesai, terbaru di atas", async () => {
    const list = await loadAnomalies(NOW);
    const firstDone = list.findIndex((item) => !isActive(item));
    const active = firstDone === -1 ? list : list.slice(0, firstDone);
    const done = firstDone === -1 ? [] : list.slice(firstDone);
    expect(active.every(isActive)).toBe(true);
    expect(done.some(isActive)).toBe(false);
    for (let i = 1; i < done.length; i += 1) {
      expect(done[i - 1].startedAt).toBeGreaterThanOrEqual(done[i].startedAt);
    }

    const sorted = sortAnomalies([
      anomaly({ id: "selesai-baru", endedAt: NOW - 10, startedAt: NOW - 100 }),
      anomaly({
        id: "aktif-peringatan",
        severity: "warning",
        startedAt: NOW - 900,
      }),
      anomaly({ id: "aktif-kritis-lama", startedAt: NOW - 5000 }),
      anomaly({ id: "selesai-lama", endedAt: NOW - 20, startedAt: NOW - 800 }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([
      "aktif-kritis-lama",
      "aktif-peringatan",
      "selesai-baru",
      "selesai-lama",
    ]);
  });

  test("setiap anomali menunjuk router dan pelanggan yang ada, sesuai jenisnya", async () => {
    const list = await loadAnomalies(NOW);
    const kinds = new Set(list.map((item) => item.kind));
    expect(kinds.size).toBe(anomalyRules.length); // semua jenis muncul dalam 7 hari
    for (const item of list) {
      expect(routerIds.has(item.routerId), item.id).toBe(true);
      if (item.kind === "offline" || item.kind === "optical") {
        expect(customerIds.has(item.customerId ?? ""), item.id).toBe(true);
      } else {
        expect(item.customerId, item.id).toBeNull();
      }
      if (item.kind === "queue" || item.kind === "port") {
        expect(item.interfaceName, item.id).toBeTruthy();
      } else {
        expect(item.interfaceName, item.id).toBeNull();
      }
    }
  });

  test("angka terukur selalu melewati ambang aturannya", async () => {
    const list = await loadAnomalies(NOW);
    const rule = Object.fromEntries(anomalyRules.map((r) => [r.kind, r]));
    for (const item of list) {
      const measured = item.measured;
      switch (item.kind) {
        case "queue":
        case "cpu":
        case "port":
          expect(measured, item.id).toBeGreaterThan(rule[item.kind].threshold!);
          break;
        case "optical":
          expect(measured, item.id).toBeLessThan(rule.optical.threshold!);
          break;
        case "offline":
          expect(measured, item.id).toBeNull();
          break;
      }
      expect(item.measured === null ? "" : String(item.measured)).not.toContain(
        "NaN",
      );
    }
    // Antrean tak bisa lebih dari 100%.
    for (const item of list.filter((x) => x.kind === "queue")) {
      expect(item.measured!).toBeLessThanOrEqual(100);
    }
  });

  test("keterangan menyebut angka terukur dan batasnya", () => {
    const text = (item: Partial<Anomaly>) => describeAnomaly(anomaly(item));
    expect(
      text({ kind: "queue", interfaceName: "sfp1-olt", measured: 98 }),
    ).toBe("Antrean sfp1-olt 98% (batas 95%)");
    expect(text({ kind: "cpu", measured: 91 })).toBe("CPU 91% (batas 85%)");
    expect(
      text({ kind: "port", interfaceName: "ether1-wan", measured: 140 }),
    ).toBe("ether1-wan: 140 error/menit (batas 20)");
    expect(text({ kind: "optical", measured: -26.3 })).toBe(
      "Rx -26,3 dBm (batas -25,0 dBm)",
    );
    // Offline: lamanya tidak ikut di keterangan (ia bertambah tiap detik dan
    // ditampilkan di kolom status), jadi sama untuk yang aktif maupun selesai.
    const offline = "Tidak ada sesi PPPoE (batas 30 detik)";
    expect(
      text({ kind: "offline", measured: null, startedAt: NOW - 300 }),
    ).toBe(offline);
    expect(
      text({
        kind: "offline",
        measured: null,
        startedAt: NOW - 900,
        endedAt: NOW - 600,
      }),
    ).toBe(offline);
  });

  test("ringkasan menghitung yang aktif, 24 jam terakhir, dan jenis tersering", () => {
    const summary = summarizeAnomalies(
      [
        anomaly({ id: "a", kind: "cpu", startedAt: NOW - 100 }), // aktif, kritis
        anomaly({
          id: "b",
          kind: "port",
          severity: "warning",
          startedAt: NOW - 200,
        }), // aktif
        anomaly({
          id: "c",
          kind: "port",
          severity: "warning",
          startedAt: NOW - 3600,
          endedAt: NOW - 3000,
        }),
        anomaly({
          id: "d",
          kind: "port",
          severity: "warning",
          startedAt: NOW - 3 * 86400,
          endedAt: NOW - 3 * 86400 + 60,
        }),
        anomaly({
          id: "e",
          kind: "cpu",
          startedAt: NOW - 2 * 86400,
          endedAt: NOW - 2 * 86400 + 60,
        }),
      ],
      NOW,
    );
    expect(summary).toEqual({
      active: 2,
      activeCritical: 1,
      activeWarning: 1,
      last24h: 3,
      last24hResolved: 1,
      topKind: { kind: "port", count: 3 },
      total: 5,
    });
  });

  test("seri jenis tersering diputus oleh urutan aturan, dan daftar kosong aman", () => {
    const tie = summarizeAnomalies(
      [
        anomaly({ id: "a", kind: "offline" }),
        anomaly({ id: "b", kind: "queue" }),
      ],
      NOW,
    );
    expect(tie.topKind).toEqual({ kind: "queue", count: 1 });
    expect(summarizeAnomalies([], NOW)).toEqual({
      active: 0,
      activeCritical: 0,
      activeWarning: 0,
      last24h: 0,
      last24hResolved: 0,
      topKind: null,
      total: 0,
    });
  });

  test("satu gangguan selalu menghasilkan anomali yang sama", () => {
    const incident = {
      id: "mock-42",
      kind: "optical" as const,
      severity: "warning" as const,
      startedAt: NOW - 500,
      endedAt: null,
    };
    expect(toAnomaly(incident)).toEqual(toAnomaly(incident));
  });

  test("ringkasan per jenis: angka, tingkat terparah, dan kejadian terakhir", () => {
    const list = [
      anomaly({ id: "q1", kind: "queue", startedAt: NOW - 100 }), // aktif, kritis
      anomaly({
        id: "q2",
        kind: "queue",
        severity: "warning",
        startedAt: NOW - 200,
      }), // aktif, peringatan
      anomaly({
        id: "q3",
        kind: "queue",
        startedAt: NOW - 3 * 86400,
        endedAt: NOW - 3 * 86400 + 60,
      }),
      anomaly({
        id: "p1",
        kind: "port",
        severity: "warning",
        startedAt: NOW - 7200,
        endedAt: NOW - 7000,
      }),
      anomaly({
        id: "o1",
        kind: "offline",
        severity: "warning",
        startedAt: NOW - 50,
      }), // aktif, peringatan
    ];
    const byKind = Object.fromEntries(
      summarizeByKind(list, NOW).map((item) => [item.kind, item]),
    );
    expect(summarizeByKind(list, NOW).map((item) => item.kind)).toEqual(
      anomalyRules.map((rule) => rule.kind),
    );
    expect(byKind.queue).toMatchObject({
      active: 2,
      worstActive: "critical",
      last24h: 2,
      total: 3,
    });
    expect(byKind.queue.latest?.id).toBe("q1");
    expect(byKind.port).toMatchObject({
      active: 0,
      worstActive: null,
      last24h: 1,
      total: 1,
    });
    expect(byKind.port.latest?.id).toBe("p1");
    expect(byKind.offline).toMatchObject({
      active: 1,
      worstActive: "warning",
      total: 1,
    });
    // Jenis yang tidak pernah muncul tetap ada, dengan angka nol.
    expect(byKind.cpu).toEqual({
      kind: "cpu",
      active: 0,
      worstActive: null,
      last24h: 0,
      total: 0,
      latest: null,
    });
    expect(byKind.optical.total).toBe(0);
  });

  test("ringkasan per jenis cocok dengan ringkasan keseluruhan", async () => {
    for (const now of [NOW, NOW + 3 * 3600, NOW + 40 * 3600]) {
      const list = await loadAnomalies(now);
      const overall = summarizeAnomalies(list, now);
      const kinds = summarizeByKind(list, now);
      const sum = (pick: (item: (typeof kinds)[number]) => number) =>
        kinds.reduce((total, item) => total + pick(item), 0);
      expect(sum((item) => item.total)).toBe(overall.total);
      expect(sum((item) => item.active)).toBe(overall.active);
      expect(sum((item) => item.last24h)).toBe(overall.last24h);
    }
  });

  test("judul aturan sama dengan nama jenis di daftar, dan tiap aturan punya batas pendek", () => {
    for (const rule of anomalyRules) {
      expect(rule.title).toBe(incidentLabels[rule.kind]);
      expect(rule.limit.length).toBeGreaterThan(3);
    }
  });

  test("aturan deteksi lengkap dan sama dengan PRD", () => {
    expect(anomalyRules.map((rule) => rule.kind)).toEqual([
      "queue",
      "cpu",
      "port",
      "optical",
      "offline",
    ]);
    const text = anomalyRules.map((rule) => rule.description).join("\n");
    expect(text).toContain("95%");
    expect(text).toContain("30 detik");
    expect(text).toContain("85%");
    expect(text).toContain("3 menit");
    expect(text).toContain("-25 dBm");
  });
});

async function signUpAndOpenDashboard(page: Page, name: string) {
  const data = {
    name,
    email: `anom-${randomUUID()}@example.com`,
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

test("halaman anomali butuh login", async ({ page }) => {
  await page.goto("/app/anomali");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fanomali$/);
  await expect(page.getByTestId("anomaly-row")).toHaveCount(0);
});

test("menu membuka halaman anomali, yang menampilkan ringkasan, daftar, dan aturan", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signUpAndOpenDashboard(page, "Petugas Anomali");
  const menu = page.getByRole("navigation", { name: "Menu utama" });
  await expect(menu.locator("[aria-current=page]")).toHaveText("Dashboard");

  await menu.getByRole("link", { name: "Deteksi Anomali" }).click();
  await expect(page).toHaveURL(/\/app\/anomali$/);
  await expect(
    page.getByRole("heading", { name: "Deteksi Anomali", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Data tiruan")).toBeVisible();
  await expect(menu.locator("[aria-current=page]")).toHaveText(
    "Deteksi Anomali",
  );
  // Halaman terbuka di "Hari ini"; daftar 7 hari dipilih lewat tab periodenya.
  await page.getByTestId("anomaly-range-7d").click();

  const rows = page.getByTestId("anomaly-row");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(10);

  // Angka di kartu sama dengan isi daftar.
  const summary = page.getByRole("region", { name: "Ringkasan anomali" });
  await expect(summary).toContainText("Anomali aktif");
  // Kartu "Tercatat" (bukan sembarang angka sama di kartu lain, mis. Selesai).
  await expect(
    summary
      .locator("p", { hasText: /^Tercatat/ })
      .locator("xpath=following-sibling::p[1]"),
  ).toHaveText(String(count));
  await expect(
    page.getByText(`${count} anomali dalam 7 hari terakhir`),
  ).toBeVisible();
  const activeRows = await page
    .locator("[data-testid=anomaly-row][data-active=true]")
    .count();
  const activeCard = summary
    .locator("p", { hasText: "Anomali aktif" })
    .locator("xpath=following-sibling::p[1]");
  await expect(activeCard).toHaveText(String(activeRows));

  // Yang aktif selalu di atas yang selesai.
  const flags = await rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-active")),
  );
  const firstDone = flags.indexOf("false");
  expect(
    flags
      .slice(firstDone === -1 ? flags.length : firstDone)
      .every((flag) => flag === "false"),
  ).toBe(true);

  // Setiap baris punya tingkat bertulis (bukan hanya warna) dan keterangan terukur.
  await expect(rows.first().getByText(/Kritis|Peringatan|Info/)).toBeVisible();
  await expect(rows.first()).toContainText(/batas|Terputus/);

  // Satu kartu per jenis, urut sesuai aturan; angkanya cocok dengan isi daftar.
  const cards = page.getByTestId("kind-card");
  await expect(cards).toHaveCount(5);
  await expect(
    page.getByRole("heading", { name: "Per jenis gangguan" }),
  ).toBeVisible();
  const kinds = await cards.evaluateAll((items) =>
    items.map((item) => ({
      kind: item.getAttribute("data-kind"),
      active: Number(item.getAttribute("data-active")),
      total: Number(item.getAttribute("data-total")),
      text: item.textContent ?? "",
    })),
  );
  expect(kinds.map((item) => item.kind)).toEqual([
    "queue",
    "cpu",
    "port",
    "optical",
    "offline",
  ]);
  let totalFromCards = 0;
  for (const card of kinds) {
    const label = incidentLabels[card.kind as keyof typeof incidentLabels];
    expect(card.text).toContain(label);
    const rowsOfKind = rows.filter({ hasText: label });
    expect(await rowsOfKind.count(), card.kind!).toBe(card.total);
    expect(
      await rowsOfKind.and(page.locator("[data-active=true]")).count(),
      card.kind!,
    ).toBe(card.active);
    totalFromCards += card.total;
    // Yang sedang aktif ditulis dengan tingkatnya; yang normal ditulis normal.
    if (card.active > 0) expect(card.text).toMatch(/Kritis|Peringatan/);
    else expect(card.text).toContain("normal");
  }
  expect(totalFromCards).toBe(count);

  // Aturan deteksi ditulis untuk kelima jenis.
  await expect(page.getByTestId("anomaly-rule")).toHaveCount(5);
  await expect(
    page.getByRole("region", { name: "Daftar anomali" }),
  ).toBeVisible();

  // Kembali ke dashboard lewat menu.
  await menu.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(menu.locator("[aria-current=page]")).toHaveText("Dashboard");
  expect(errors).toEqual([]);
});

test("halaman anomali muat di layar sempit dan menu ponsel menjangkaunya", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpAndOpenDashboard(page, "Petugas HP Anomali");
  const bar = page.getByRole("navigation", { name: "Menu halaman" });
  await bar.getByRole("link", { name: "Deteksi Anomali" }).click();
  await expect(page).toHaveURL(/\/app\/anomali$/);
  await expect(page.getByTestId("anomaly-row").first()).toBeVisible();
  await expect(bar.locator("[aria-current=page]")).toHaveText(
    "Deteksi Anomali",
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  // Tabel yang lebar bergulir di dalam kotaknya sendiri, bukan melebarkan halaman.
  const region = page.getByRole("region", { name: "Daftar anomali" });
  const overflow = await region.evaluate(
    (el) => el.scrollWidth > el.clientWidth,
  );
  expect(overflow).toBe(true);
});
