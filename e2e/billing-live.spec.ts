import { expect, test } from "@playwright/test";
import {
  mockBillingSync,
  summarizeSync,
  type BillingSyncRun,
} from "../src/lib/dashboard/billing";
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
  measureContrast,
  openBillingAt,
  secondsNow,
  signUp,
  timeFormatter,
  type Cookies,
} from "./billing-ui";

// Halaman Billing yang hidup: hitung mundur dan pergantian keadaan tepat pada
// jamnya, zona waktu browser, layar sempit dan lebar, serta keterbacaan di tema
// terang dan gelap.

const moments = findBillingMoments();

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Billing Hidup");
  await context.close();
});

test("hitung mundur berkurang tiap detik, dan halaman berganti sendiri tepat saat sinkron mulai dan selesai", async ({
  browser,
}) => {
  const { start, finishedAt, run } = pickQuickRun(moments.ok);
  const jakarta = timeFormatter("Asia/Jakarta");
  const { context, page, errors } = await contextFor(browser, cookies);

  // Jam browser dipasang 40 detik sebelum sinkron dimulai, lalu dihentikan pada
  // setengah detik supaya tiap detik yang tampil pasti sudah berganti.
  await page.clock.install({ time: (start - 40) * 1000 });
  await page.goto("/app/billing");
  const card = page.getByTestId("billing-sync");
  await expect(card).toHaveAttribute("data-last-status", /.+/);
  const loaded = await page.evaluate(() => Date.now());
  const first = (Math.floor(loaded / 1000) + 2) * 1000 + 500;
  await page.clock.pauseAt(first);
  expect(first).toBeLessThan((start - 20) * 1000);

  const before = summarizeSync(mockBillingSync(start - 40).runs);
  await expect(card).toHaveAttribute("data-running", "false");
  await expect(page.getByTestId("billing-headline")).toHaveText(
    headlineAfter(before),
  );

  // Hitung mundur: berkurang tepat satu tiap detik.
  const countdown = page.getByTestId("billing-countdown");
  for (let step = 0; step < 5; step += 1) {
    const seconds = await secondsNow(page);
    await expect(countdown).toHaveText(
      `dalam ${formatElapsed(start - seconds)}`,
    );
    await expect(countdown).toHaveAttribute("data-due", "false");
    await page.clock.runFor(1_000);
  }

  // Tepat pada jamnya hitung mundur habis, tetapi datanya belum diganti.
  await advanceTo(page, start * 1000 + 500);
  await expect(countdown).toHaveText("sebentar lagi");
  await expect(countdown).toHaveAttribute("data-due", "true");
  await expect(card).toHaveAttribute("data-running", "false");

  // Sedetik kemudian halaman bertanya sendiri dan menampilkan sinkron berjalan,
  // jauh sebelum penyegaran berkala (tiap 30 detik) tiba.
  await advanceTo(page, (start + 1) * 1000 + 500);
  await expect(card).toHaveAttribute("data-running", "true");
  await expect(page.getByTestId("billing-headline")).toHaveText(
    "Sedang menyinkron",
  );
  await expect(page.getByTestId("billing-running-since")).toHaveText(
    jakarta(start, start + 1),
  );
  await expect(page.getByTestId("billing-running-for")).toHaveText(
    "sudah 1 detik",
  );
  await expect(page.getByTestId("billing-next-running")).toBeVisible();
  // Lamanya bertambah tiap detik selama berjalan.
  await advanceTo(page, (start + 2) * 1000 + 500);
  await expect(page.getByTestId("billing-running-for")).toHaveText(
    "sudah 2 detik",
  );

  // Selama berjalan halaman bertanya tiap 6 detik (5 detik ditambah jeda 1
  // detik): mulai dari 1 detik setelah jam sinkron, jadi pada detik 1, 7, 13, ...
  // Berganti pada pertanyaan pertama yang sudah melewati waktu selesainya, dan
  // tidak sebelumnya. Maju satu detik demi satu detik, dengan jeda singkat agar
  // React sempat menggambar ulang dan menjadwalkan pertanyaan berikutnya.
  const lasted = finishedAt - start;
  const flip = start + 1 + 6 * Math.ceil((lasted - 1) / 6);
  for (let second = start + 3; second <= flip + 1; second += 1) {
    await advanceTo(page, second * 1000 + 500);
    await page.waitForTimeout(60);
    await expect(card).toHaveAttribute(
      "data-running",
      second < flip ? "true" : "false",
    );
  }
  expect(await secondsNow(page)).toBe(flip + 1);

  const after = summarizeSync(mockBillingSync(flip + 1).runs);
  expect(after.last!.id).toBe(run.id);
  await expect(card).toHaveAttribute("data-last-status", run.status);
  await expect(page.getByTestId("billing-headline")).toHaveText(
    headlineAfter(after),
  );
  await expect(page.getByTestId("billing-last-at")).toHaveText(
    jakarta(finishedAt, flip + 1),
  );
  await expect(page.getByTestId("billing-last-at")).toHaveAttribute(
    "datetime",
    isoTime(finishedAt),
  );
  await expect(page.getByTestId("billing-last-age")).toHaveText(
    `${formatElapsed(flip + 1 - finishedAt)} lalu`,
  );
  // Sinkron berikutnya satu jam kemudian, dan hitung mundurnya mulai lagi.
  await expect(page.getByTestId("billing-next-at")).toHaveText(
    jakarta(start + 3_600, flip + 1),
  );
  await expect(page.getByTestId("billing-countdown")).toHaveText(
    `dalam ${formatElapsed(start + 3_600 - (flip + 1))}`,
  );
  // Sinkron yang baru masuk ke riwayat paling atas, dan yang lama bergeser.
  const rows = page.getByTestId("billing-run-row");
  await expect(rows).toHaveCount(24);
  await expect(rows.first()).toHaveAttribute("data-run-id", run.id);
  await expect(rows.first()).toHaveAttribute("data-outcome", run.status);
  const ids = await rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-run-id")),
  );
  expect(ids).toEqual(
    mockBillingSync(flip + 1).runs.map((item: BillingSyncRun) => item.id),
  );
  // Sinkron yang gagal menyebut alasannya di kartu; yang berhasil tidak.
  if (run.status === "failed") {
    await expect(page.getByTestId("billing-error")).toContainText(run.error!);
  } else {
    await expect(page.getByTestId("billing-error")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("lama sejak sinkron terakhir bertambah tiap detik, dan yang tertulis tetap sama", async ({
  browser,
}) => {
  const now = moments.ok;
  const { context, page, errors } = await contextFor(browser, cookies);
  await page.clock.install({ time: now * 1000 });
  await page.goto("/app/billing");
  const card = page.getByTestId("billing-sync");
  await expect(card).toHaveAttribute("data-last-status", "success");
  const loaded = await page.evaluate(() => Date.now());
  await page.clock.pauseAt((Math.floor(loaded / 1000) + 2) * 1000 + 500);

  const last = summarizeSync(mockBillingSync(now).runs).last!;
  const at = await page.getByTestId("billing-last-at").textContent();
  for (let step = 0; step < 4; step += 1) {
    const seconds = await secondsNow(page);
    await expect(page.getByTestId("billing-last-age")).toHaveText(
      `${formatElapsed(seconds - last.finishedAt)} lalu`,
    );
    await expect(page.getByTestId("billing-data-age")).toHaveText(
      `${formatElapsed(seconds - last.finishedAt)} lalu`,
    );
    await page.clock.runFor(1_000);
  }
  await expect(page.getByTestId("billing-last-at")).toHaveText(at!);
  expect(errors).toEqual([]);
  await context.close();
});

for (const timeZone of ["Asia/Kolkata", "America/New_York", "Asia/Jakarta"]) {
  test(`waktu sinkron ditulis menurut zona waktu browser (${timeZone})`, async ({
    browser,
  }) => {
    const now = moments.double;
    const format = timeFormatter(timeZone);
    const data = mockBillingSync(now);
    const summary = summarizeSync(data.runs);
    const { context, page, errors } = await contextFor(browser, cookies, {
      timezoneId: timeZone,
    });
    await openBillingAt(page, now);

    await expect(page.getByTestId("billing-last-at")).toHaveText(
      format(summary.last!.finishedAt, now),
    );
    await expect(page.getByTestId("billing-next-at")).toHaveText(
      format(data.nextRunAt, now),
    );
    await expect(page.getByTestId("billing-data-at")).toHaveText(
      format(summary.lastSuccess!.finishedAt, now),
    );
    // Atribut waktu mesin tetap UTC, apa pun zona browsernya.
    await expect(page.getByTestId("billing-last-at")).toHaveAttribute(
      "datetime",
      isoTime(summary.last!.finishedAt),
    );
    // Seluruh riwayat, termasuk yang jatuh pada hari sebelumnya.
    const started = await page
      .getByTestId("billing-run-started")
      .evaluateAll((items) => items.map((item) => item.textContent));
    expect(started).toEqual(
      data.runs.map((item) => format(item.startedAt, now)),
    );
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("di layar sempit semuanya muat tanpa melebarkan halaman, dan tabel bergulir di dalam kotaknya", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies, {
    viewport: { width: 390, height: 844 },
  });
  await page.clock.install({ time: moments.ok * 1000 });
  await page.clock.setFixedTime(moments.ok * 1000);
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();
  // Menu ponsel menjangkau halaman Billing.
  const bar = page.getByRole("navigation", { name: "Menu halaman" });
  await bar.getByRole("link", { name: "Billing" }).click();
  await expect(page).toHaveURL("/app/billing");
  await expect(bar.locator("[aria-current=page]")).toHaveAccessibleName(
    "Billing",
  );
  await expect(page.getByTestId("billing-sync")).toHaveAttribute(
    "data-last-status",
    /.+/,
  );
  await expect(page.getByTestId("billing-row")).toHaveCount(100);

  const overflows = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
  expect(await overflows()).toBe(false);

  // Tiap bagian utama berada seluruhnya di dalam lebar layar.
  const inside = async (testId: string) => {
    const boxes = await page.getByTestId(testId).evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    );
    expect(boxes.length, testId).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.left, testId).toBeGreaterThanOrEqual(0);
      expect(box.right, testId).toBeLessThanOrEqual(390);
    }
  };
  for (const testId of [
    "billing-sync",
    "billing-tile",
    "billing-customers",
    "billing-mismatch",
    "billing-history",
  ]) {
    await inside(testId);
  }
  // Satu kolom: keempat angka ringkasan bertumpuk.
  const lefts = await page
    .getByTestId("billing-tile")
    .evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().left)),
    );
  expect(new Set(lefts).size).toBe(1);

  // Tabel yang lebar bergulir di dalam kotaknya, bukan melebarkan halaman.
  for (const name of [
    "Daftar status billing pelanggan",
    "Daftar ketidakcocokan data billing",
    "Riwayat sinkron billing",
  ]) {
    const region = page.getByRole("region", { name });
    await region.scrollIntoViewIfNeeded();
    const overflow = await region.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(overflow, name).toBe(true);
  }
  expect(await overflows()).toBe(false);

  // Kolom cari dan saringan bisa dipakai di layar sempit.
  const search = page.locator("#billing-search");
  await search.scrollIntoViewIfNeeded();
  await search.fill("agus");
  await expect(page.getByTestId("billing-customers")).toHaveAttribute(
    "data-visible",
    /^\d+$/,
  );
  expect(
    Number(
      await page.getByTestId("billing-customers").getAttribute("data-visible"),
    ),
  ).toBeLessThan(100);
  const filterBox = await page.locator("#billing-status").boundingBox();
  expect(filterBox!.x).toBeGreaterThanOrEqual(0);
  expect(filterBox!.x + filterBox!.width).toBeLessThanOrEqual(390);
  expect(await overflows()).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});

test("di layar lebar keempat angka ringkasan sebaris dan tabel mengisi lebar kartunya", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, cookies, {
    viewport: { width: 1440, height: 900 },
  });
  await openBillingAt(page, moments.ok);
  const tops = await page
    .getByTestId("billing-tile")
    .evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().top)),
    );
  expect(new Set(tops).size).toBe(1);
  const region = page.getByRole("region", {
    name: "Daftar status billing pelanggan",
  });
  const overflow = await region.evaluate(
    (el) => el.scrollWidth > el.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});

const textElements = [
  "[data-testid=billing-headline]",
  "[data-testid=billing-sync] [data-slot=card-title]",
  "[data-testid=billing-sync] [data-slot=card-description]",
  "[data-testid=billing-sync] dt",
  "[data-testid=billing-sync] dd span",
  "[data-testid=billing-sync] dd time",
  "[data-testid=billing-sync] p",
  "[data-testid=billing-tile] p",
  "[data-testid=billing-customers] [data-slot=card-title]",
  "[data-testid=billing-customers] [data-slot=card-description]",
  "[data-testid=billing-customers] label",
  "[data-testid=billing-customers] thead th",
  "[data-testid=billing-row] td",
  "[data-testid=billing-row] td div",
  "[data-testid=billing-row] td span",
  "[data-testid=billing-row] td code",
  "[data-testid=billing-customers] ul li",
  "[data-testid=billing-customers] ul li strong",
  "[data-testid=billing-mismatch] [data-slot=card-description]",
  "[data-testid=billing-mismatch] label",
  "[data-testid=billing-mismatch] thead th",
  "[data-testid=billing-mismatch-row] td",
  "[data-testid=billing-mismatch-row] td div",
  "[data-testid=billing-mismatch-row] td span",
  "[data-testid=billing-history] [data-slot=card-description]",
  "[data-testid=billing-history] thead th",
  "[data-testid=billing-run-row] td",
  "[data-testid=billing-run-row] td span",
  "[data-testid=billing-run-row] td time",
  "main p.rounded-full",
];

for (const scheme of ["light", "dark"] as const) {
  test(`tulisan terbaca jelas di tema ${scheme} pada semua keadaan sinkron`, async ({
    browser,
  }) => {
    const problems: string[] = [];
    const allErrors: string[] = [];
    let measured = 0;
    for (const kind of ["ok", "single", "double", "running"] as const) {
      const { context, page, errors } = await contextFor(browser, cookies, {
        colorScheme: scheme,
      });
      await openBillingAt(page, moments[kind]);
      await expect(page.getByTestId("billing-row")).toHaveCount(100);
      const selectors =
        kind === "single" || kind === "double"
          ? [...textElements, "[data-testid=billing-error] p"]
          : textElements;
      for (const selector of selectors) {
        const results = await measureContrast(page, selector);
        measured += results.length;
        // Selain yang hanya ada pada keadaan tertentu, tiap pemilih harus kena.
        if (results.length === 0 && !selector.includes("billing-error")) {
          problems.push(`${kind} ${selector}: tidak ada elemen`);
        }
        for (const { text, ratio } of results) {
          if (ratio < 4.5) {
            problems.push(`${kind} ${selector} "${text}": ${ratio.toFixed(2)}`);
          }
        }
      }
      allErrors.push(...errors);
      await context.close();
    }
    expect(problems.slice(0, 8)).toEqual([]);
    expect(measured).toBeGreaterThan(1_500);
    expect(allErrors).toEqual([]);
  });
}

test("ikon hanya hiasan dan tiap keadaan tertulis dengan kata, bukan hanya warna", async ({
  browser,
}) => {
  const allErrors: string[] = [];
  for (const kind of ["ok", "double", "running"] as const) {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openBillingAt(page, moments[kind]);
    await expect(page.getByTestId("billing-row")).toHaveCount(100);
    // Semua ikon di halaman disembunyikan dari pembaca layar.
    await expect(page.locator("main svg:not([aria-hidden=true])")).toHaveCount(
      0,
    );
    // Setiap baris menuliskan status dan cara cocoknya dengan kata.
    const texts = await page
      .getByTestId("billing-row")
      .evaluateAll((rows) =>
        rows.map((row) => [
          row.querySelectorAll("td")[2].textContent,
          row.querySelectorAll("td")[4].textContent,
        ]),
      );
    for (const [status, match] of texts) {
      expect(["Lunas", "Isolir"]).toContain(status);
      expect(match).toMatch(/^(Cocok|Belum ada tagihan)/);
    }
    // Keadaan sinkron tertulis di kartu.
    const headline = await page.getByTestId("billing-headline").textContent();
    expect(headline).toMatch(
      /^(Sinkron terakhir (berhasil|gagal)|Gagal \d+ kali berturut-turut|Sedang menyinkron)$/,
    );
    allErrors.push(...errors);
    await context.close();
  }
  expect(allErrors).toEqual([]);
});
