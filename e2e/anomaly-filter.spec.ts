import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  anomalyRules,
  isActive,
  type Anomaly,
} from "../src/lib/dashboard/anomalies";
import { loadAnomalies } from "../src/lib/dashboard/anomaly-feed";
import {
  defaultAnomalyFilters,
  facetCounts,
  filterAnomalies,
  hasActiveAnomalyFilters,
  type AnomalyFilters,
} from "../src/lib/dashboard/anomaly-filter";
import { incidentLabels } from "../src/lib/dashboard/incidents";

// Filter dan ringkasan per jenis pada halaman Deteksi Anomali. Bagian pertama
// menguji logikanya tanpa browser; sisanya memakai halaman sungguhan dengan
// jam palsu pada waktu yang punya anomali aktif.

const headers = { Origin: "http://localhost:3101" };
const kinds = anomalyRules.map((rule) => rule.kind);
const severities = ["critical", "warning", "info"] as const;
const statuses = ["all", "active", "unreviewed", "resolved"] as const;

function allFilterStates() {
  const states: AnomalyFilters[] = [];
  for (const kind of ["all", ...kinds] as const) {
    for (const severity of ["all", ...severities] as const) {
      for (const status of statuses) states.push({ kind, severity, status });
    }
  }
  return states;
}

// Waktu pada data tiruan yang punya anomali aktif, dan data pada saat itu.
async function findBusyTime() {
  const start = 1_791_400_000;
  for (let t = start; t < start + 7 * 86_400; t += 900) {
    const list = await loadAnomalies(t);
    const active = list.filter(isActive);
    if (active.length > 0 && list.length - active.length > 10) {
      return { t, list };
    }
  }
  throw new Error("tidak ada waktu dengan anomali aktif pada data tiruan");
}

test.describe("logika filter anomali", () => {
  test("tanpa filter semuanya tampil dengan urutan yang sama", async () => {
    const { list } = await findBusyTime();
    expect(filterAnomalies(list, defaultAnomalyFilters)).toEqual(list);
    expect(hasActiveAnomalyFilters(defaultAnomalyFilters)).toBe(false);
  });

  test("tiap filter menyaring sesuai arti namanya, dan urutan tetap", async () => {
    const { list } = await findBusyTime();
    const ids = (items: Anomaly[]) => items.map((item) => item.id);
    for (const kind of kinds) {
      expect(
        ids(filterAnomalies(list, { ...defaultAnomalyFilters, kind })),
      ).toEqual(ids(list.filter((item) => item.kind === kind)));
    }
    for (const severity of severities) {
      expect(
        ids(filterAnomalies(list, { ...defaultAnomalyFilters, severity })),
      ).toEqual(ids(list.filter((item) => item.severity === severity)));
    }
    expect(
      ids(
        filterAnomalies(list, { ...defaultAnomalyFilters, status: "active" }),
      ),
    ).toEqual(ids(list.filter((item) => item.endedAt === null)));
    expect(
      ids(
        filterAnomalies(list, { ...defaultAnomalyFilters, status: "resolved" }),
      ),
    ).toEqual(ids(list.filter((item) => item.endedAt !== null)));
    expect(
      ids(
        filterAnomalies(list, {
          kind: "queue",
          severity: "critical",
          status: "resolved",
        }),
      ),
    ).toEqual(
      ids(
        list.filter(
          (item) =>
            item.kind === "queue" &&
            item.severity === "critical" &&
            item.endedAt !== null,
        ),
      ),
    );
    // Gabungan yang mustahil: sinyal optik selalu peringatan, tidak pernah kritis.
    expect(
      filterAnomalies(list, {
        ...defaultAnomalyFilters,
        kind: "optical",
        severity: "critical",
      }),
    ).toEqual([]);
  });

  test("angka di samping tiap pilihan sama dengan hasil bila dipilih, pada semua kombinasi", async () => {
    const { list } = await findBusyTime();
    const problems: string[] = [];
    for (const filters of allFilterStates()) {
      const counts = facetCounts(list, filters);
      if (counts.total !== filterAnomalies(list, filters).length)
        problems.push(`total ${JSON.stringify(filters)}`);
      for (const kind of kinds) {
        const got = filterAnomalies(list, { ...filters, kind }).length;
        if (got !== counts.kind[kind])
          problems.push(
            `jenis ${kind} @ ${JSON.stringify(filters)}: ${got} != ${counts.kind[kind]}`,
          );
      }
      for (const severity of severities) {
        const got = filterAnomalies(list, { ...filters, severity }).length;
        if (got !== counts.severity[severity])
          problems.push(`tingkat ${severity} @ ${JSON.stringify(filters)}`);
      }
      for (const status of ["active", "unreviewed", "resolved"] as const) {
        const got = filterAnomalies(list, { ...filters, status }).length;
        if (got !== counts.status[status])
          problems.push(`status ${status} @ ${JSON.stringify(filters)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("hasActiveAnomalyFilters mengenali tiap saringan", () => {
    for (const patch of [
      { kind: "cpu" },
      { severity: "info" },
      { status: "active" },
    ] as const) {
      expect(
        hasActiveAnomalyFilters({ ...defaultAnomalyFilters, ...patch }),
      ).toBe(true);
    }
  });
});

async function signUp(page: Page, name: string) {
  const data = {
    name,
    email: `filt-${randomUUID()}@example.com`,
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
  await signUp(page, "Petugas Filter");
  await page.clock.install({ time: t * 1000 });
  await page.goto("/app/anomali");
  // Halaman terbuka di "Hari ini"; daftar 7 hari dipilih lewat tab periodenya.
  await page.getByTestId("anomaly-range-7d").click();
  await expect(page.getByTestId("anomaly-range-7d")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("anomaly-row").first()).toBeVisible();
}

test("filter jenis, tingkat, dan status menyaring daftar, dengan angka yang cocok", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { t, list } = await findBusyTime();
  await openAt(page, t);
  const rows = page.getByTestId("anomaly-row");
  const kind = page.getByLabel("Jenis", { exact: true });
  const severity = page.getByLabel("Tingkat", { exact: true });
  const reset = page.getByRole("button", { name: "Reset filter" });
  const summary = page.getByText(/anomali dalam 7 hari terakhir/);

  // Awalnya tanpa saringan.
  await expect(rows).toHaveCount(list.length);
  await expect(summary).toHaveText(
    `${list.length} anomali dalam 7 hari terakhir`,
  );
  await expect(reset).toBeDisabled();
  await expect(kind.locator("option")).toHaveCount(1 + kinds.length);

  // Jenis: angka di pilihan sama dengan jumlah barisnya.
  const port = list.filter((item) => item.kind === "port");
  await expect(
    kind.locator("option", {
      hasText: `${incidentLabels.port} (${port.length})`,
    }),
  ).toHaveCount(1);
  await kind.selectOption("port");
  await expect(rows).toHaveCount(port.length);
  await expect(summary).toHaveText(
    `Menampilkan ${port.length} dari ${list.length} anomali dalam 7 hari terakhir`,
  );
  await expect(reset).toBeEnabled();
  for (const text of await rows.allInnerTexts()) {
    expect(text).toContain(incidentLabels.port);
  }

  // Tingkat bergabung dengan jenis (dan angka jenis lain ikut menyesuaikan).
  await severity.selectOption("critical");
  await expect(rows).toHaveCount(0);
  await expect(
    page.getByText("Tidak ada anomali yang cocok dengan filter."),
  ).toBeVisible();
  const queue = list.filter(
    (item) => item.kind === "queue" && item.severity === "critical",
  );
  await expect(
    kind.locator("option", {
      hasText: `${incidentLabels.queue} (${queue.length})`,
    }),
  ).toHaveCount(1);
  // "Error pada port" tidak pernah kritis, jadi angkanya nol di sini.
  await expect(
    kind.locator("option", { hasText: `${incidentLabels.port} (0)` }),
  ).toHaveCount(1);

  // Dari keadaan kosong, satu tombol mengembalikan semuanya.
  await page.getByRole("button", { name: "Tampilkan semua anomali" }).click();
  await expect(rows).toHaveCount(list.length);
  await expect(kind).toHaveValue("all");
  await expect(severity).toHaveValue("all");
  await expect(reset).toBeDisabled();

  // Status: aktif, belum selesai (aktif yang belum ditinjau), dan selesai.
  const active = list.filter(isActive);
  await page.getByTestId("anomaly-status-active").click();
  await expect(rows).toHaveCount(active.length);
  for (const flag of await rows.evaluateAll((items) =>
    items.map((i) => i.getAttribute("data-active")),
  )) {
    expect(flag).toBe("true");
  }
  // Belum ada yang ditinjau, jadi "Belum selesai" sama dengan yang aktif.
  await page.getByTestId("anomaly-status-unreviewed").click();
  await expect(rows).toHaveCount(active.length);
  await page.getByTestId("anomaly-status-resolved").click();
  await expect(rows).toHaveCount(list.length - active.length);
  for (const flag of await rows.evaluateAll((items) =>
    items.map((i) => i.getAttribute("data-active")),
  )) {
    expect(flag).toBe("false");
  }

  // Reset filter membersihkan semuanya sekaligus.
  await kind.selectOption("cpu");
  await reset.click();
  await expect(kind).toHaveValue("all");
  await expect(page.getByTestId("anomaly-status-all")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rows).toHaveCount(list.length);
  expect(errors).toEqual([]);
});

test("kartu per jenis menjadi tombol saring, dan saringannya terlihat di filter", async ({
  page,
}) => {
  const { t, list } = await findBusyTime();
  await openAt(page, t);
  const rows = page.getByTestId("anomaly-row");
  const kind = page.getByLabel("Jenis", { exact: true });
  const cardOf = (name: string) =>
    page.locator(`[data-testid=kind-card][data-kind=${name}]`);

  const queue = list.filter((item) => item.kind === "queue");
  const button = cardOf("queue").getByRole("button", {
    name: "Saring jenis ini",
  });
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();

  // Daftar, kotak jenis, dan kartu sepakat; kartu itu ditandai terpilih.
  await expect(rows).toHaveCount(queue.length);
  await expect(kind).toHaveValue("queue");
  await expect(cardOf("queue")).toHaveAttribute("data-selected", "true");
  const pressed = cardOf("queue").getByRole("button", {
    name: "Menyaring jenis ini",
  });
  await expect(pressed).toHaveAttribute("aria-pressed", "true");
  await expect(cardOf("cpu")).toHaveAttribute("data-selected", "false");

  // Kartu lain menggantikan; menekan kartu yang sama melepas saringan.
  await cardOf("cpu").getByRole("button", { name: "Saring jenis ini" }).click();
  await expect(kind).toHaveValue("cpu");
  await expect(cardOf("queue")).toHaveAttribute("data-selected", "false");
  await cardOf("cpu")
    .getByRole("button", { name: "Menyaring jenis ini" })
    .click();
  await expect(kind).toHaveValue("all");
  await expect(rows).toHaveCount(list.length);

  // Angka di kartu tidak ikut tersaring: ia ringkasan seluruh data.
  await kind.selectOption("port");
  for (const rule of anomalyRules) {
    const total = list.filter((item) => item.kind === rule.kind).length;
    await expect(cardOf(rule.kind)).toHaveAttribute(
      "data-total",
      String(total),
    );
  }
});

test("filter muat di layar sempit dan bisa dipakai dengan papan ketik", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { t, list } = await findBusyTime();
  await openAt(page, t);
  const kind = page.getByLabel("Jenis", { exact: true });
  await expect(kind).toBeVisible();
  await expect(page.getByLabel("Tingkat", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Status", { exact: true })).toBeVisible();
  // Papan ketik: fokus ke kotak, pilih dengan tombol panah, daftar ikut berubah.
  await kind.focus();
  await page.keyboard.press("ArrowDown");
  const first = kinds[0];
  await expect(kind).toHaveValue(first);
  await expect(page.getByTestId("anomaly-row")).toHaveCount(
    list.filter((item) => item.kind === first).length,
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
