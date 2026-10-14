import { expect, test, type Page } from "@playwright/test";
import { mockBillingSync, summarizeSync } from "../src/lib/dashboard/billing";
import { formatElapsed } from "../src/lib/dashboard/format";
import {
  findBillingMoments,
  headlineAfter,
  pickQuickRun,
} from "./billing-moments";
import {
  advanceTo,
  contextFor,
  isoTime,
  jakartaTime,
  measureContrast,
  openBillingAt,
  secondsNow,
  signUp,
  timeFormatter,
  type Cookies,
} from "./billing-ui";

// Ringkasan sinkron billing di halaman Pelanggan: kapan sinkron terakhir dan
// berhasil atau gagalnya, di tempat status tagihan pelanggan ditampilkan.
// Jam browser dikunci pada momen yang dipilih dari data tiruannya sendiri.

const moments = findBillingMoments();

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Ringkasan Billing");
  await context.close();
});

async function openCustomersAt(page: Page, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto("/app/pelanggan");
  await expect(page.getByTestId("billing-sync-chip")).toHaveAttribute(
    "data-phase",
    /.+/,
  );
}

const chipOf = (page: Page) => page.getByTestId("billing-sync-chip");

for (const kind of [
  "ok",
  "single",
  "double",
  "triple",
  "running",
  "runningAfterFail",
] as const) {
  test(`halaman Pelanggan menulis sinkron billing terakhir dan hasilnya (${kind})`, async ({
    browser,
  }) => {
    const now = moments[kind];
    const sync = mockBillingSync(now);
    const summary = summarizeSync(sync.runs);
    const { context, page, errors } = await contextFor(browser, cookies);
    await openCustomersAt(page, now);
    const chip = chipOf(page);

    const last = summary.last!;
    const phase = sync.running
      ? "running"
      : last.status === "success"
        ? "ok"
        : "failed";
    await expect(chip).toHaveAttribute("data-phase", phase);
    await expect(chip).toHaveAttribute("data-last-status", last.status);
    await expect(chip).toHaveAttribute(
      "data-failures",
      String(summary.consecutiveFailures),
    );
    // Kalimat dan nadanya, ditulis tangan.
    const tone = sync.running
      ? "neutral"
      : last.status === "success"
        ? "success"
        : summary.consecutiveFailures >= 2
          ? "danger"
          : "warning";
    const headline = chip.getByTestId("billing-chip-headline");
    await expect(headline).toHaveText(
      sync.running ? "Sedang menyinkron" : headlineAfter(summary),
    );
    await expect(headline).toHaveAttribute("data-tone", tone);
    await expect(chip.getByText("Billing", { exact: true })).toBeVisible();

    if (sync.running) {
      const startedAt = sync.running.startedAt;
      await expect(chip.getByTestId("billing-chip-detail")).toHaveText(
        `mulai ${jakartaTime(startedAt, now)}, sudah ${formatElapsed(now - startedAt)}`,
      );
      await expect(chip.getByTestId("billing-spinner")).toBeVisible();
      await expect(chip.getByTestId("billing-chip-last-at")).toHaveCount(0);
    } else {
      await expect(chip.getByTestId("billing-chip-detail")).toHaveText(
        `pukul ${jakartaTime(last.finishedAt, now)} (${formatElapsed(now - last.finishedAt)} lalu)`,
      );
      await expect(chip.getByTestId("billing-chip-last-at")).toHaveAttribute(
        "datetime",
        isoTime(last.finishedAt),
      );
      await expect(chip.getByTestId("billing-spinner")).toHaveCount(0);
    }

    // Sinkron yang gagal menyebut dari kapan data tagihan yang tampil.
    const data = chip.getByTestId("billing-chip-data");
    if (!sync.running && last.status === "failed") {
      const success = summary.lastSuccess!;
      await expect(data).toHaveText(
        `Data tagihan per ${jakartaTime(success.finishedAt, now)} (${formatElapsed(now - success.finishedAt)} lalu)`,
      );
    } else {
      await expect(data).toHaveCount(0);
    }

    const link = chip.getByRole("link", { name: "Lihat rincian" });
    await expect(link).toHaveAttribute("href", "/app/billing");
    await link.focus();
    await expect(link).toBeFocused();
    // Ikon hanya hiasan.
    await expect(chip.locator("svg:not([aria-hidden=true])")).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("ringkasan di halaman Pelanggan dan kartu di halaman Billing selalu sepakat, dan tautannya membuka halaman Billing", async ({
  browser,
}) => {
  for (const kind of ["ok", "single", "double"] as const) {
    const now = moments[kind];
    const { context, page, errors } = await contextFor(browser, cookies);
    await openCustomersAt(page, now);
    const chip = chipOf(page);
    const headline = await chip
      .getByTestId("billing-chip-headline")
      .textContent();
    const lastAt = await chip.getByTestId("billing-chip-last-at").textContent();
    const failures = await chip.getAttribute("data-failures");
    const lastStatus = await chip.getAttribute("data-last-status");

    await chip.getByRole("link", { name: "Lihat rincian" }).click();
    await expect(page).toHaveURL("/app/billing");
    const card = page.getByTestId("billing-sync");
    await expect(card).toHaveAttribute("data-failures", failures!);
    await expect(card).toHaveAttribute("data-last-status", lastStatus!);
    await expect(page.getByTestId("billing-headline")).toHaveText(headline!);
    await expect(page.getByTestId("billing-last-at")).toHaveText(lastAt!);
    // Ringkasan hanya ada di halaman Pelanggan.
    await expect(page.getByTestId("billing-sync-chip")).toHaveCount(0);
    expect(errors, kind).toEqual([]);
    await context.close();
  }
});

test("tabel Pelanggan tetap utuh di bawah ringkasan, dan ringkasan tidak ada di halaman lain", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openCustomersAt(page, moments.ok);
  const table = page.getByRole("region", { name: "Daftar status pelanggan" });
  await expect(table.locator("tbody tr")).toHaveCount(100);
  await expect(
    page.getByRole("button", { name: "Sinkron Tagihan" }),
  ).toBeVisible();
  const chipBox = (await chipOf(page).boundingBox())!;
  const tableBox = (await table.boundingBox())!;
  expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(tableBox.y);
  await page.getByLabel("Cari pelanggan").fill("tidak-ada-pelanggan-ini");
  await expect(
    page.getByText("Tidak ada pelanggan yang cocok dengan filter."),
  ).toBeVisible();
  await expect(chipOf(page)).toBeVisible();

  for (const [path, name] of [
    ["/app", "Dashboard"],
    ["/app/alert", "Alert"],
    ["/app/anomali", "Deteksi Anomali"],
  ] as const) {
    await page
      .getByRole("navigation", { name: "Menu utama" })
      .getByRole("link", { name })
      .click();
    await expect(page).toHaveURL(path);
    await expect(chipOf(page)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("ringkasan berganti sendiri tepat saat sinkron mulai dan selesai, tanpa memuat ulang halaman", async ({
  browser,
}) => {
  const { start, finishedAt, run } = pickQuickRun(moments.ok);
  const jakarta = timeFormatter("Asia/Jakarta");
  const { context, page, errors } = await contextFor(browser, cookies);
  await page.clock.install({ time: (start - 40) * 1000 });
  await page.goto("/app/pelanggan");
  const chip = chipOf(page);
  await expect(chip).toHaveAttribute("data-phase", /.+/);
  const loaded = await page.evaluate(() => Date.now());
  await page.clock.pauseAt((Math.floor(loaded / 1000) + 2) * 1000 + 500);
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  const before = summarizeSync(mockBillingSync(start - 40).runs);
  await expect(chip).not.toHaveAttribute("data-phase", "running");
  await expect(chip.getByTestId("billing-chip-headline")).toHaveText(
    headlineAfter(before),
  );

  // Tepat pada jamnya belum berganti; sedetik kemudian sedang menyinkron.
  await advanceTo(page, start * 1000 + 500);
  await expect(chip).not.toHaveAttribute("data-phase", "running");
  await advanceTo(page, (start + 1) * 1000 + 500);
  await expect(chip).toHaveAttribute("data-phase", "running");
  await expect(chip.getByTestId("billing-chip-headline")).toHaveText(
    "Sedang menyinkron",
  );
  await expect(chip.getByTestId("billing-chip-detail")).toHaveText(
    `mulai ${jakarta(start, start + 1)}, sudah 1 detik`,
  );

  // Berganti pada pertanyaan pertama yang sudah melewati waktu selesainya
  // (detik 1, 7, 13, ... setelah jam sinkron), dan tidak sebelumnya.
  const flip = start + 1 + 6 * Math.ceil((finishedAt - start - 1) / 6);
  for (let second = start + 3; second <= flip + 1; second += 1) {
    await advanceTo(page, second * 1000 + 500);
    await page.waitForTimeout(60);
    if (second < flip) {
      await expect(chip).toHaveAttribute("data-phase", "running");
    } else {
      await expect(chip).not.toHaveAttribute("data-phase", "running");
    }
  }
  expect(await secondsNow(page)).toBe(flip + 1);
  const after = summarizeSync(mockBillingSync(flip + 1).runs);
  expect(after.last!.id).toBe(run.id);
  await expect(chip).toHaveAttribute("data-last-status", run.status);
  await expect(chip.getByTestId("billing-chip-headline")).toHaveText(
    headlineAfter(after),
  );
  await expect(chip.getByTestId("billing-chip-detail")).toHaveText(
    `pukul ${jakarta(finishedAt, flip + 1)} (${formatElapsed(flip + 1 - finishedAt)} lalu)`,
  );
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test("pemutar berhenti bila pengguna meminta gerak dikurangi", async ({
  browser,
}) => {
  const reduced = await contextFor(browser, cookies, {
    reducedMotion: "reduce",
  });
  await openCustomersAt(reduced.page, moments.running);
  expect(
    await reduced.page
      .getByTestId("billing-spinner")
      .evaluate((icon) => getComputedStyle(icon).animationName),
  ).toBe("none");
  await reduced.context.close();

  const normal = await contextFor(browser, cookies, {
    reducedMotion: "no-preference",
  });
  await openCustomersAt(normal.page, moments.running);
  expect(
    await normal.page
      .getByTestId("billing-spinner")
      .evaluate((icon) => getComputedStyle(icon).animationName),
  ).not.toBe("none");
  await normal.context.close();
});

const chipText = [
  "[data-testid=billing-sync-chip] span",
  "[data-testid=billing-sync-chip] strong",
  "[data-testid=billing-sync-chip] time",
  "[data-testid=billing-sync-chip] a",
];

for (const scheme of ["light", "dark"] as const) {
  test(`ringkasan terbaca jelas di tema ${scheme} pada semua keadaan sinkron`, async ({
    browser,
  }) => {
    const problems: string[] = [];
    const allErrors: string[] = [];
    let measured = 0;
    for (const kind of ["ok", "single", "double", "running"] as const) {
      const { context, page, errors } = await contextFor(browser, cookies, {
        colorScheme: scheme,
      });
      await openCustomersAt(page, moments[kind]);
      const selectors =
        kind === "single" || kind === "double"
          ? [...chipText, "[data-testid=billing-chip-data]"]
          : chipText;
      for (const selector of selectors) {
        const results = await measureContrast(page, selector);
        measured += results.length;
        if (results.length === 0) problems.push(`${kind} ${selector}: kosong`);
        for (const { text, ratio } of results) {
          if (ratio < 4.5) {
            problems.push(`${kind} ${selector} "${text}": ${ratio.toFixed(2)}`);
          }
        }
      }
      allErrors.push(...errors);
      await context.close();
    }
    expect(problems.slice(0, 6)).toEqual([]);
    expect(measured).toBeGreaterThan(20);
    expect(allErrors).toEqual([]);
  });
}

test("di layar sempit ringkasan turun baris dan muat, tautannya terjangkau, dan halaman tidak melebar", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies, {
    viewport: { width: 390, height: 844 },
  });
  await openCustomersAt(page, moments.double);
  const chip = chipOf(page);
  const box = (await chip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Isinya lebih panjang dari satu baris, jadi turun ke baris berikutnya.
  expect(box.height).toBeGreaterThan(50);
  const link = chip.getByRole("link", { name: "Lihat rincian" });
  await expect(link).toBeInViewport({ ratio: 1 });
  for (const testId of ["billing-chip-headline", "billing-chip-detail"]) {
    const part = (await chip.getByTestId(testId).boundingBox())!;
    expect(part.x + part.width, testId).toBeLessThanOrEqual(390);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});

test("di halaman Billing ringkasan ini tidak dipasang karena kartu sinkron sudah ada", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies);
  await openBillingAt(page, moments.ok);
  await expect(page.getByTestId("billing-sync")).toBeVisible();
  await expect(page.getByTestId("billing-sync-chip")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("tiap keadaan punya ikonnya sendiri, dan ikon di ringkasan sama dengan di kartu Billing", async ({
  browser,
}) => {
  const expected = {
    ok: "lucide-circle-check",
    single: "lucide-triangle-alert",
    double: "lucide-circle-x",
    running: "lucide-loader-circle",
  } as const;
  const shapes = new Set<string>();
  const allErrors: string[] = [];
  for (const kind of ["ok", "single", "double", "running"] as const) {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openCustomersAt(page, moments[kind]);
    const chipIcon = chipOf(page).locator("svg").first();
    await expect(chipIcon).toHaveClass(new RegExp(expected[kind]));
    const chipShape = await chipIcon.innerHTML();
    await chipOf(page).getByRole("link", { name: "Lihat rincian" }).click();
    await expect(page).toHaveURL("/app/billing");
    const cardIcon = page.getByTestId("billing-sync").locator("svg").first();
    await expect(cardIcon).toHaveClass(new RegExp(expected[kind]));
    expect(await cardIcon.innerHTML(), kind).toBe(chipShape);
    shapes.add(chipShape);
    allErrors.push(...errors);
    await context.close();
  }
  expect(shapes.size).toBe(4);
  expect(allErrors).toEqual([]);
});
