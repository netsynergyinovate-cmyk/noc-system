import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import { contextFor, signUp, type Cookies } from "./billing-ui";
import { contrastOf } from "./contrast";

// Tombol "Keluar" dan penegasan "Anda sudah keluar" di halaman sungguhan (mode
// demo, port 3101): keluar memuat ulang dokumen PENUH (memori klien terbuang),
// sesi dicabut di server, tab lain ikut pindah ke halaman masuk, kegagalan
// memberi tahu bahwa sesi MASIH AKTIF, dan penegasan hanya muncul untuk
// ?keluar=1 persis.
//
// Dua akun saja untuk seluruh berkas (pendaftaran dibatasi sekitar tiga per
// sepuluh detik). Keluar mencabut sesi di server, jadi tiap tes yang menekan
// "Keluar" memakai sesi BARU lewat masuk lewat API (freshSession); cookie hasil
// pendaftaran hanya dipakai tes yang tidak keluar. Peran budi diubah lewat
// database seperti npm run role:set hanya selama sebuah tes membutuhkannya, dan
// selalu dikembalikan di finally.

const origin = "http://localhost:3101";
const signedOutUrl = `${origin}/sign-in?keluar=1`;
const password = "A-long-test-password-123!";
const failureMessage = "Gagal keluar. Sesi Anda masih aktif; coba lagi.";
const wide = { width: 1440, height: 900 };
const narrow = { width: 390, height: 844 };

interface Account {
  id: string;
  email: string;
  cookies: Cookies;
}

async function register(browser: Browser, name: string): Promise<Account> {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const cookies = await signUp(context, name);
    const response = await context.request.get("/api/auth/get-session");
    expect(response.status()).toBe(200);
    const { user } = (await response.json()) as {
      user: { id: string; email: string };
    };
    return { id: user.id, email: user.email, cookies };
  } finally {
    await context.close();
  }
}

// Sesi baru untuk akun yang sudah ada (masuk lewat API). Sesi ini boleh
// dikorbankan oleh tes yang menekan "Keluar". Bila kena batas laju masuk (tiga
// per sepuluh detik), tunggu jendelanya habis lalu ulangi.
async function freshSession(
  browser: Browser,
  account: Account,
): Promise<Cookies> {
  const context = await browser.newContext({ baseURL: origin });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await context.request.post("/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: { email: account.email, password },
      });
      if (response.status() === 429) {
        const seconds = Number(response.headers()["retry-after"] || 10);
        expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 10).toBe(
          true,
        );
        await delay((seconds + 0.1) * 1000);
        continue;
      }
      expect(response.status()).toBe(200);
      const cookies = await context.cookies();
      expect(sessionCookies(cookies).length).toBeGreaterThan(0);
      return cookies;
    }
    throw new Error("masuk lewat API terus kena batas laju");
  } finally {
    await context.close();
  }
}

const pool = new Pool({
  connectionString: process.env.STARTER_TEST_DATABASE_URL,
  max: 1,
});
test.afterAll(async () => {
  await pool.end();
});

async function setRole(email: string, role: string | null) {
  const { rowCount } = await pool.query(
    'UPDATE "user" SET role = $1 WHERE email = $2',
    [role, email],
  );
  expect(rowCount).toBe(1);
}

let ana: Account; // petugas A, tetap akun biasa
let budi: Account; // petugas B; admin hanya selama sebuah tes membutuhkannya
test.beforeAll(async ({ browser }) => {
  ana = await register(browser, "Petugas Keluar Satu");
  budi = await register(browser, "Petugas Keluar Dua");
});

// ---------------------------------------------------------------------------
// Pembantu
// ---------------------------------------------------------------------------

const sessionCookies = (cookies: Cookies) =>
  cookies.filter((cookie) => cookie.name.includes("session_token"));

const signOutButton = (page: Page) =>
  page.getByRole("button", { name: "Keluar", exact: true });
const notice = (page: Page) =>
  page.getByRole("status").filter({ hasText: "Anda sudah keluar." });
const failure = (page: Page) =>
  page.getByRole("alert").filter({ hasText: "Gagal keluar" });
const dashboardHeading = (page: Page) =>
  page.getByRole("heading", { name: "Dashboard NOC", exact: true });
const loginHeading = (page: Page) =>
  page.getByRole("heading", { name: "Masuk ke NOC ISP", exact: true });
const sidebarBadge = (page: Page) =>
  page.locator("aside").getByTestId("role-badge");
const choice = (badge: Locator) => badge.getByLabel("Lihat sebagai");

// Elemen sudah dihidrasi: punya props React (klik sebelum itu tidak berbuat apa-apa).
async function hydrated(element: Locator) {
  await expect
    .poll(() =>
      element.evaluate((el) =>
        Object.keys(el).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
}

// Halaman terlindungi siap dipakai: tombol Keluar terlihat dan hidup, dan efek
// pendengar kanal antar-tab (SessionSync) sudah sempat terpasang. Hanya timer,
// bukan requestAnimationFrame: tab yang tidak di depan tidak menggambar.
async function ready(page: Page) {
  const button = signOutButton(page);
  await expect(button).toBeVisible();
  await hydrated(button);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
}

// Permintaan data RSC ke /sign-in = percobaan navigasi di dalam aplikasi
// (router.replace). Dicatat sejak halaman dibuka lewat open(). Dengan navigasi
// penuh yang benar, dokumen lama tidak pernah memintanya. Next bisa saja
// akhirnya jatuh ke muat ulang penuh sendiri sesudah percobaan itu (teramati di
// build produksi ini), jadi penanda window dan jumlah `load` saja belum cukup
// membedakan keduanya; permintaan inilah yang membedakan.
const softNavigations = new WeakMap<Page, string[]>();

async function open(page: Page, path: string) {
  if (!softNavigations.has(page)) {
    const seen: string[] = [];
    softNavigations.set(page, seen);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/sign-in" && url.searchParams.has("_rsc")) {
        seen.push(request.url());
      }
    });
  }
  await page.goto(path);
  await ready(page);
}

type MarkedWindow = { __tandaPetugas?: string };
const markWindow = (page: Page, value = "ada") =>
  page.evaluate((mark) => {
    (window as unknown as MarkedWindow).__tandaPetugas = mark;
  }, value);
const readMark = (page: Page) =>
  page.evaluate(
    () => (window as unknown as MarkedWindow).__tandaPetugas ?? null,
  );

const overflowX = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

// Galat konsol yang diharapkan: permintaan di halaman lama yang dijawab 401/403
// sebelum dokumennya diganti (sesi sudah dicabut), dan 429 dari batas laju
// masuk yang sengaja ditunggu (tiga per sepuluh detik).
const unexpected = (errors: string[]) =>
  errors.filter((message) => !/401|403|429/.test(message));

async function expectSessionAlive(page: Page, email: string) {
  const response = await page.request.get("/api/auth/get-session");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { user?: { email: string } } | null;
  expect(body?.user?.email).toBe(email);
}

// Setelah keluar: tiba di halaman masuk dengan penegasan, dokumen berganti
// SELURUHNYA (penanda di window hilang), dan cookie sesi tidak ada lagi.
async function expectSignedOut(page: Page, context: BrowserContext) {
  await expect(page).toHaveURL(signedOutUrl);
  await expect(notice(page)).toBeVisible();
  await expect(loginHeading(page)).toBeVisible();
  expect(await readMark(page)).toBeNull();
  expect(sessionCookies(await context.cookies())).toEqual([]);
  // Dokumen lama tidak mencoba berpindah di dalam aplikasi lebih dulu.
  expect(softNavigations.get(page) ?? []).toEqual([]);
}

// Menekan Tab sampai `target` berfokus; gagal bila tidak pernah sampai.
async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let presses = 1; presses <= limit; presses += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) {
      return presses;
    }
  }
  throw new Error(`Tab ${limit} kali tidak sampai ke elemen yang dituju`);
}

// ---------------------------------------------------------------------------
// a. Tombol ada dan bernama persis "Keluar" di semua area terlindungi
// ---------------------------------------------------------------------------

test("tombol Keluar bernama persis 'Keluar' di sidebar (1440 px), header (390 px), /setup, dan /admin", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  await test.step("/app di 1440 px: di sidebar, salinan header tersembunyi", async () => {
    const { context, page, errors } = await contextFor(browser, ana.cookies, {
      viewport: wide,
    });
    try {
      await open(page, "/app");
      await expect(signOutButton(page)).toHaveCount(1);
      const button = page.locator("aside").getByRole("button", {
        name: "Keluar",
        exact: true,
      });
      await expect(button).toBeVisible();
      await expect(button).toHaveAccessibleName("Keluar");
      await expect(button).toHaveText("Keluar");
      await expect(
        page.locator("header").getByRole("button", {
          name: "Keluar",
          exact: true,
          includeHidden: true,
        }),
      ).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  await test.step("/app di 390 px: di header, sidebar tersembunyi", async () => {
    const { context, page, errors } = await contextFor(browser, ana.cookies, {
      viewport: narrow,
    });
    try {
      await open(page, "/app");
      await expect(signOutButton(page)).toHaveCount(1);
      const button = page.locator("header").getByRole("button", {
        name: "Keluar",
        exact: true,
      });
      await expect(button).toBeVisible();
      await expect(button).toHaveAccessibleName("Keluar");
      await expect(
        page.locator("aside").getByRole("button", {
          name: "Keluar",
          exact: true,
          includeHidden: true,
        }),
      ).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  await test.step("/setup (mode demo membukanya untuk akun yang masuk), di dua lebar", async () => {
    for (const viewport of [wide, narrow]) {
      const { context, page, errors } = await contextFor(browser, ana.cookies, {
        viewport,
      });
      try {
        await open(page, "/setup");
        await expect(
          page.getByRole("heading", { name: "Setup Perangkat", level: 1 }),
        ).toBeVisible();
        const button = page.locator("header").getByRole("button", {
          name: "Keluar",
          exact: true,
        });
        await expect(button, `${viewport.width} px`).toBeVisible();
        await expect(button).toHaveAccessibleName("Keluar");
        await expect(signOutButton(page)).toHaveCount(1);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });

  await test.step("/admin untuk admin asli", async () => {
    await setRole(budi.email, "admin");
    const { context, page, errors } = await contextFor(browser, budi.cookies, {
      viewport: wide,
    });
    try {
      await open(page, "/admin");
      await expect(
        page.getByRole("heading", { name: "Every account’s notes" }),
      ).toBeVisible();
      const button = page.locator("header").getByRole("button", {
        name: "Keluar",
        exact: true,
      });
      await expect(button).toBeVisible();
      await expect(button).toHaveAccessibleName("Keluar");
      await expect(signOutButton(page)).toHaveCount(1);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await setRole(budi.email, "user");
    }
  });
});

// ---------------------------------------------------------------------------
// b, c, d. Satu alur lengkap di /app (1440 px)
// ---------------------------------------------------------------------------

test("klik Keluar di /app: halaman dimuat ulang penuh, penegasan tampil, cookie hilang; sesi dicabut di server; Kembali tidak menampilkan dasbor", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const cookies = await freshSession(browser, ana);
  const { context, page, errors } = await contextFor(browser, cookies, {
    viewport: wide,
  });
  const staleCookies: Cookies = [];
  try {
    await open(page, "/app");
    await expect(dashboardHeading(page)).toBeVisible();
    staleCookies.push(...(await context.cookies()));
    expect(sessionCookies(staleCookies).length).toBeGreaterThan(0);

    // b. Keluar. Penanda di window hanya hidup selama dokumen yang sama; navigasi
    // di dalam aplikasi (router.replace) tidak akan menghapusnya.
    await markWindow(page);
    expect(await readMark(page)).toBe("ada");
    // Tepat satu dokumen baru dimuat (peristiwa load), bukan lebih.
    let loads = 0;
    page.on("load", () => {
      loads += 1;
    });
    await signOutButton(page).click();
    await expectSignedOut(page, context);
    expect(loads).toBe(1);
    // Dokumen baru: jenis navigasinya "navigate", bukan "reload"/"back_forward".
    expect(
      await page.evaluate(
        () =>
          (
            performance.getEntriesByType(
              "navigation",
            )[0] as PerformanceNavigationTiming
          ).type,
      ),
    ).toBe("navigate");
    await expect(notice(page)).toHaveText("Anda sudah keluar.");
    expect(unexpected(errors)).toEqual([]);

    // d. Tombol Kembali: ke riwayat sebelumnya (/app), yang kini ditolak dan
    // dialihkan ke halaman masuk. Dasbor tidak boleh tampil sedetik pun.
    const visited: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) visited.push(frame.url());
    });
    await page.goBack();
    await expect(page).toHaveURL(`${origin}/sign-in`);
    await expect(loginHeading(page)).toBeVisible();
    for (let check = 0; check < 6; check += 1) {
      await expect(dashboardHeading(page)).toHaveCount(0);
      await expect(
        page.getByText("Dashboard NOC", { exact: true }),
      ).toHaveCount(0);
      await expect(page).toHaveURL(`${origin}/sign-in`);
      await delay(100);
    }
    // Tidak ada dokumen /app yang pernah dimuat sesudah keluar.
    expect(visited.filter((url) => new URL(url).pathname === "/app")).toEqual(
      [],
    );
    // Penegasan hanya untuk ?keluar=1; halaman masuk biasa tidak menampilkannya.
    await expect(notice(page)).toHaveCount(0);

    // Halaman terlindungi sesudahnya: dialihkan ke halaman masuk.
    await page.goto("/app");
    await expect(page).toHaveURL(`${origin}/sign-in`);
    await expect(loginHeading(page)).toBeVisible();
  } finally {
    await context.close();
  }

  // c. Sesi benar-benar dicabut di SERVER: cookie LAMA di konteks baru ditolak.
  // Halaman lebih dulu, sebelum permintaan API apa pun: proxy meloloskan (ada
  // cookie), layout menolak sesi yang basi, dan halaman masuk memberi tahu bahwa
  // sesinya berakhir (bukan "sudah keluar").
  const expired = await browser.newContext({ baseURL: origin });
  try {
    await expired.addCookies(staleCookies);
    const expiredPage = await expired.newPage();
    await expiredPage.goto("/app");
    await expect(expiredPage).toHaveURL(`${origin}/sign-in?sesi=berakhir`);
    await expect(loginHeading(expiredPage)).toBeVisible();
    await expect(
      expiredPage.getByRole("status").filter({
        hasText: "Sesi Anda berakhir. Masuk lagi untuk melanjutkan.",
      }),
    ).toBeVisible();
    await expect(notice(expiredPage)).toHaveCount(0);
    await expect(dashboardHeading(expiredPage)).toHaveCount(0);
  } finally {
    await expired.close();
  }

  const stale = await browser.newContext({ baseURL: origin });
  try {
    await stale.addCookies(staleCookies);
    const session = await stale.request.get("/api/auth/get-session");
    expect(session.status()).toBe(200);
    expect(await session.json()).toBeNull();

    const notes = await stale.request.get("/api/notes");
    expect(notes.status()).toBe(401);

    // Better Auth menghapus cookie sesi yang tidak dikenalnya begitu get-session
    // menjawab null, jadi sesudah dua permintaan di atas konteks ini sudah
    // tanpa cookie: halaman terlindungi dialihkan proxy sebagai anonim, tanpa
    // penanda "sesi berakhir".
    expect(sessionCookies(await stale.cookies())).toEqual([]);
    const stalePage = await stale.newPage();
    await stalePage.goto("/app");
    await expect(stalePage).toHaveURL(`${origin}/sign-in`);
    await expect(loginHeading(stalePage)).toBeVisible();
    await expect(notice(stalePage)).toHaveCount(0);
    await expect(
      stalePage.getByRole("status").filter({ hasText: "Sesi Anda berakhir" }),
    ).toHaveCount(0);
    await expect(dashboardHeading(stalePage)).toHaveCount(0);
  } finally {
    await stale.close();
  }
});

// ---------------------------------------------------------------------------
// b. Area lain: header (390 px) dan /setup
// ---------------------------------------------------------------------------

for (const target of [
  {
    label: "/app di 390 px (tombol di header)",
    path: "/app",
    viewport: narrow,
  },
  { label: "/setup", path: "/setup", viewport: wide },
]) {
  test(`klik Keluar di ${target.label}: muat ulang penuh, penegasan, cookie hilang`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const cookies = await freshSession(browser, ana);
    const { context, page, errors } = await contextFor(browser, cookies, {
      viewport: target.viewport,
    });
    try {
      await open(page, target.path);
      await markWindow(page);
      await signOutButton(page).click();
      await expectSignedOut(page, context);
      await page.goto(target.path);
      await expect(page).toHaveURL(
        `${origin}/sign-in${target.path === "/setup" ? "?next=%2Fsetup" : ""}`,
      );
      expect(unexpected(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

// ---------------------------------------------------------------------------
// e. Memori bersih antar-petugas pada tab yang sama
// ---------------------------------------------------------------------------

test("petugas berikutnya di tab yang sama tidak mewarisi apa pun dari petugas sebelumnya", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const cookies = await freshSession(browser, ana);
  const { context, page, errors } = await contextFor(browser, cookies, {
    viewport: wide,
  });
  try {
    // Petugas A: peran tiruan Admin dipilih (hanya ada di memori) dan sebuah
    // penanda di window.
    await open(page, "/app");
    const badge = sidebarBadge(page);
    const select = choice(badge);
    await hydrated(select);
    await expect(page.getByText(`Masuk sebagai ${ana.email}`)).toBeVisible();
    await select.selectOption("admin");
    await expect(badge).toHaveAttribute("data-preview", "true");
    await expect(badge).toHaveAttribute("data-role", "admin");
    await markWindow(page, "milik-petugas-A");
    expect(await readMark(page)).toBe("milik-petugas-A");

    await signOutButton(page).click();
    await expectSignedOut(page, context);

    // Petugas B masuk lewat formulir, di tab yang sama.
    await hydrated(page.locator("form"));
    await page.getByLabel("Email", { exact: true }).fill(budi.email);
    await page.getByLabel("Kata sandi", { exact: true }).fill(password);
    const submit = page.getByRole("button", { name: "Masuk", exact: true });
    await submit.click();
    // Bila kena batas laju autentikasi, tunggu jendelanya habis lalu ulangi.
    const outcome = await Promise.race([
      page.waitForURL(`${origin}/app`, { timeout: 15_000 }).then(() => "ok"),
      page
        .locator("#auth-error")
        .filter({ hasText: "Terlalu banyak percobaan" })
        .waitFor({ timeout: 15_000 })
        .then(() => "limited"),
    ]);
    if (outcome === "limited") {
      await delay(10_500);
      await submit.click();
    }
    await expect(page).toHaveURL(`${origin}/app`);
    await expect(dashboardHeading(page)).toBeVisible();

    const next = sidebarBadge(page);
    const nextSelect = choice(next);
    await hydrated(nextSelect);
    await expect(page.getByText(`Masuk sebagai ${budi.email}`)).toBeVisible();
    // Peran tiruan tidak terbawa: kembali ke "Peran asli".
    await expect(next).toHaveAttribute("data-role", "user");
    await expect(next).toHaveAttribute("data-preview", "false");
    await expect(nextSelect).toHaveValue("");
    await expect(nextSelect.locator("option:checked")).toHaveText(
      "Peran asli: Petugas",
    );
    // Tidak ada sisa penanda window, dan tidak ada jejak petugas A di halaman.
    expect(await readMark(page)).toBeNull();
    await expect(page.getByText(ana.email)).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain(ana.email);
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// f. Lintas tab
// ---------------------------------------------------------------------------

test("keluar di satu tab memindahkan tab lain (/app/alert dan /setup) ke halaman masuk tanpa interaksi; konteks lain tidak terpengaruh", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const cookies = await freshSession(browser, ana);
  const { context, page: first } = await contextFor(browser, cookies, {
    viewport: wide,
  });
  const second = await context.newPage();
  const third = await context.newPage();
  // Profil lain: akun lain yang sedang masuk, origin yang sama.
  const other = await contextFor(browser, budi.cookies, { viewport: wide });
  try {
    await open(first, "/app");
    await open(second, "/app/alert");
    await open(third, "/setup");
    await open(other.page, "/app");
    await markWindow(second, "tab-kedua");
    await markWindow(third, "tab-ketiga");
    await markWindow(other.page, "konteks-lain");

    await signOutButton(first).click();
    await expectSignedOut(first, context);

    // Tanpa interaksi apa pun di tab lain.
    await expect(second).toHaveURL(signedOutUrl, { timeout: 5_000 });
    await expect(third).toHaveURL(signedOutUrl, { timeout: 5_000 });
    for (const tab of [second, third]) {
      await expect(notice(tab)).toBeVisible();
      await expect(loginHeading(tab)).toBeVisible();
      // Dokumen diganti seluruhnya, bukan dialihkan di dalam aplikasi.
      expect(await readMark(tab)).toBeNull();
      expect(softNavigations.get(tab) ?? []).toEqual([]);
    }
    await expect(dashboardHeading(second)).toHaveCount(0);

    // Konteks lain (profil lain, akun lain) tetap di tempatnya, dan sesinya sah.
    await delay(1_500);
    await expect(other.page).toHaveURL(`${origin}/app`);
    await expect(dashboardHeading(other.page)).toBeVisible();
    expect(await readMark(other.page)).toBe("konteks-lain");
    await expectSessionAlive(other.page, budi.email);
    expect(unexpected(other.errors)).toEqual([]);
  } finally {
    await other.context.close();
    await context.close();
  }
});

test("admin: keluar di /admin memindahkan tab /app dan /setup; jalur penuh yang sama dengan /app", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await setRole(budi.email, "admin");
  const cookies = await freshSession(browser, budi);
  const { context, page: admin } = await contextFor(browser, cookies, {
    viewport: wide,
  });
  const app = await context.newPage();
  const setup = await context.newPage();
  try {
    await open(admin, "/admin");
    await expect(
      admin.getByRole("heading", { name: "Every account’s notes" }),
    ).toBeVisible();
    await open(app, "/app");
    await open(setup, "/setup");
    await markWindow(admin);
    await markWindow(app, "tab-aplikasi");
    await markWindow(setup, "tab-setup");

    await signOutButton(admin).click();
    await expectSignedOut(admin, context);
    // Sesudah keluar, /admin tidak bisa dibuka lagi.
    await expect(app).toHaveURL(signedOutUrl, { timeout: 5_000 });
    await expect(setup).toHaveURL(signedOutUrl, { timeout: 5_000 });
    for (const tab of [app, setup]) {
      await expect(notice(tab)).toBeVisible();
      expect(await readMark(tab)).toBeNull();
      expect(softNavigations.get(tab) ?? []).toEqual([]);
    }
    await admin.goto("/admin");
    await expect(admin).toHaveURL(`${origin}/sign-in?next=%2Fadmin`);
    await expect(
      admin.getByRole("heading", { name: "Every account’s notes" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await setRole(budi.email, "user");
  }
});

// ---------------------------------------------------------------------------
// g. Kegagalan
// ---------------------------------------------------------------------------

test("bila keluar gagal: pesan 'sesi masih aktif', tetap di halaman, tombol aktif lagi dengan fokus; mencoba lagi menghapus pesan; setelah berhasil pesan tidak ikut", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const cookies = await freshSession(browser, ana);
  const { context, page } = await contextFor(browser, cookies, {
    viewport: wide,
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const pattern = "**/api/auth/sign-out";
  try {
    await open(page, "/app");
    const button = signOutButton(page);

    // 1. Permintaan tidak sampai (fetch melempar).
    await page.route(pattern, (route) => route.abort());
    await button.click();
    await expect(failure(page)).toHaveText(failureMessage);
    await expect(failure(page)).toHaveCount(1);
    await expect(page).toHaveURL(`${origin}/app`);
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(button).toHaveText("Keluar");
    // Fokus hilang saat tombol dinonaktifkan; harus dikembalikan.
    await expect(button).toBeFocused();
    await expectSessionAlive(page, ana.email);
    expect(sessionCookies(await context.cookies()).length).toBeGreaterThan(0);

    // 2. Server menjawab 500. Jawaban ditahan dulu: selama mencoba lagi pesan
    // lama hilang dan tombol terkunci.
    await page.unroute(pattern);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(pattern, async (route) => {
      await gate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "boom" }),
      });
    });
    await button.click();
    await expect(failure(page)).toHaveCount(0);
    const waiting = page.getByRole("button", { name: "Keluar…" });
    await expect(waiting).toBeDisabled();
    release();
    await expect(failure(page)).toHaveText(failureMessage);
    await expect(page).toHaveURL(`${origin}/app`);
    await expect(button).toBeEnabled();
    await expect(button).toBeFocused();
    await expectSessionAlive(page, ana.email);

    // 3. Server menjawab 400 dengan galat berisi kode: sama saja.
    await page.unroute(pattern);
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "ANYTHING", message: "x" }),
      }),
    );
    await button.click();
    await expect(failure(page)).toHaveText(failureMessage);
    await expect(button).toBeFocused();

    // 4. Rute dilepas: mencoba lagi berhasil, dan pesan galat tidak ikut ke
    // halaman masuk.
    await page.unroute(pattern);
    await button.click();
    await expect(page).toHaveURL(signedOutUrl);
    await expect(notice(page)).toBeVisible();
    await expect(failure(page)).toHaveCount(0);
    await expect(page.getByText("Gagal keluar")).toHaveCount(0);
    expect(sessionCookies(await context.cookies())).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("klik berulang dalam satu tugas mengirim SATU permintaan, dan sesudah berhasil tombol tetap terkunci sampai halaman berganti", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const cookies = await freshSession(browser, ana);
  const { context, page } = await contextFor(browser, cookies, {
    viewport: wide,
  });
  try {
    await open(page, "/app");
    const button = signOutButton(page);
    let requests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/auth/sign-out"
      ) {
        requests += 1;
      }
    });
    // Dokumen halaman masuk ditahan: jendela antara "berhasil" dan "halaman
    // berganti" dibuat selebar yang kita mau.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    await page.route(/\/sign-in\?keluar=1$/, async (route) => {
      held = true;
      await gate;
      await route.continue();
    });

    // Selama navigasi tertahan, pemanggilan Playwright ke halaman (locator,
    // evaluate) ikut menunggu navigasi itu dan tidak kembali sebelum rute
    // dilepas. Keadaan tombol karena itu DILAPORKAN oleh halaman sendiri
    // (fungsi yang dibuka ke halaman), bukan dibaca dari luar.
    type Snapshot = {
      buttons: Array<{ text: string | null; disabled: boolean }>;
      failures: number;
      path: string;
    };
    const reports: Snapshot[] = [];
    await page.exposeFunction("laporkanKeadaan", (report: Snapshot) => {
      reports.push(report);
    });
    await page.evaluate(() => {
      const report = (
        window as unknown as { laporkanKeadaan: (value: unknown) => void }
      ).laporkanKeadaan;
      window.setInterval(() => {
        report({
          buttons: Array.from(document.querySelectorAll("button"))
            .filter(
              (el) =>
                /^Keluar/.test(el.textContent ?? "") &&
                el.getClientRects().length > 0,
            )
            .map((el) => ({ text: el.textContent, disabled: el.disabled })),
          failures: Array.from(
            document.querySelectorAll("[role=alert]"),
          ).filter((el) => (el.textContent ?? "").includes("Gagal keluar"))
            .length,
          path: location.pathname + location.search,
        });
      }, 40);
    });
    await expect.poll(() => reports.length).toBeGreaterThan(2);
    const enabled = {
      buttons: [{ text: "Keluar", disabled: false }],
      failures: 0,
      path: "/app",
    };
    expect(reports.at(-1)).toEqual(enabled);

    // Tiga klik dalam SATU tugas: React belum sempat menonaktifkan tombol, jadi
    // hanya penjaga sinkron yang mencegah tiga permintaan.
    reports.length = 0;
    await button.evaluate((el) => {
      const target = el as HTMLButtonElement;
      target.click();
      target.click();
      target.click();
    });

    // Sampai dokumen halaman masuk tertahan: sign-out sudah berhasil dan
    // `location.assign` sudah dipanggil.
    await expect.poll(() => held, { timeout: 10_000 }).toBe(true);
    // Lama cukup untuk puluhan laporan sesudahnya.
    const heldAt = reports.length;
    await delay(1_000);
    expect(reports.length - heldAt).toBeGreaterThan(5);

    const locked = {
      buttons: [{ text: "Keluar…", disabled: true }],
      failures: 0,
      path: "/app",
    };
    // Sejak klik sampai sekarang tombol tidak pernah aktif lagi, juga setelah
    // sign-out berhasil dan selama halaman belum berganti, dan tidak ada pesan
    // galat. (Laporan pertama bisa datang sebelum React menonaktifkan tombol.)
    const afterClick = reports.filter((report) => report.buttons[0].disabled);
    expect(afterClick.length).toBeGreaterThan(5);
    const firstLocked = reports.findIndex(
      (report) => report.buttons[0].disabled,
    );
    for (const report of reports.slice(firstLocked)) {
      expect(report).toEqual(locked);
    }
    expect(requests).toBe(1);

    release();
    await expect(page).toHaveURL(signedOutUrl);
    await expect(notice(page)).toBeVisible();
    expect(requests).toBe(1);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// h. Papan ketik
// ---------------------------------------------------------------------------

for (const key of ["Enter", "Space"]) {
  test(`papan ketik: Tab sampai tombol Keluar (fokus terlihat), ${key} keluar`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const cookies = await freshSession(browser, ana);
    const { context, page, errors } = await contextFor(browser, cookies, {
      viewport: wide,
    });
    try {
      await open(page, "/app");
      const button = signOutButton(page);
      await tabTo(page, button);
      await expect(button).toBeFocused();
      // Cincin fokus 3 px tampil (transisi selesai), bukan hilang.
      await expect
        .poll(() => button.evaluate((el) => getComputedStyle(el).boxShadow))
        .toContain("0px 0px 0px 3px");
      await page.keyboard.press(key);
      await expectSignedOut(page, context);
      expect(unexpected(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

// ---------------------------------------------------------------------------
// i, j. Penegasan di halaman masuk
// ---------------------------------------------------------------------------

test("penegasan: tepat di bawah paragraf pengantar dan di atas formulir, teks plus ikon, dan sudah ada di HTML dari server", async ({
  browser,
  request,
}) => {
  const html = await (await request.get("/sign-in?keluar=1")).text();
  expect(html).toContain("Anda sudah keluar.");
  expect(html).toContain('role="status"');
  const plain = await (await request.get("/sign-in")).text();
  expect(plain).not.toContain("Anda sudah keluar.");

  const { context, page, errors } = await contextFor(browser, [], {
    viewport: wide,
  });
  try {
    await page.goto("/sign-in?keluar=1");
    await expect(notice(page)).toHaveCount(1);
    await expect(notice(page)).toHaveText("Anda sudah keluar.");
    await expect(notice(page).locator("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // Satu-satunya judul tetap h1 formulir.
    await expect(page.getByRole("heading")).toHaveCount(1);
    await expect(loginHeading(page)).toBeVisible();

    const intro = page.getByText(
      "Gunakan akun petugas untuk membuka dasbor pemantauan.",
    );
    const boxes = {
      intro: (await intro.boundingBox())!,
      notice: (await notice(page).boundingBox())!,
      form: (await page.locator("form").boundingBox())!,
    };
    expect(boxes.intro.y + boxes.intro.height).toBeLessThanOrEqual(
      boxes.notice.y,
    );
    expect(boxes.notice.y + boxes.notice.height).toBeLessThanOrEqual(
      boxes.form.y,
    );
    // Urutan DOM sama dengan urutan baca.
    expect(
      await notice(page).evaluate((el) => ({
        before: el.previousElementSibling?.textContent,
        after: el.nextElementSibling?.tagName,
      })),
    ).toEqual({
      before: "Gunakan akun petugas untuk membuka dasbor pemantauan.",
      after: "FORM",
    });
    // Tidak mencuri fokus dan bukan sasaran Tab.
    expect(
      await page.evaluate(() => document.activeElement === document.body),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test.describe("hanya keluar=1 persis yang menampilkan penegasan", () => {
  const shown = [
    "/sign-in?keluar=1",
    "/sign-in?keluar=1&next=%2Fapp%2Falert",
    "/sign-in?next=%2Fapp%2Falert&keluar=1",
    "/sign-in?keluar=1&lain=2",
  ];
  const hidden = [
    "/sign-in",
    "/sign-in?keluar",
    "/sign-in?keluar=",
    "/sign-in?keluar=0",
    "/sign-in?keluar=2",
    "/sign-in?keluar=true",
    "/sign-in?keluar=01",
    "/sign-in?keluar=%201",
    "/sign-in?keluar=1%20",
    "/sign-in?keluar=11",
    "/sign-in?Keluar=1",
    "/sign-in?keluar[]=1",
    // Next menyerahkan parameter berulang sebagai array, dan array bukan "1".
    "/sign-in?keluar=1&keluar=2",
    "/sign-in?keluar=2&keluar=1",
    "/sign-in?keluar=1&keluar=1",
    "/sign-in?next=keluar=1",
    // Halaman daftar tidak pernah menampilkannya.
    "/sign-up?keluar=1",
    "/sign-up",
  ];
  for (const path of shown) {
    test(`tampil: ${path}`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      expect(html).toContain("Anda sudah keluar.");
    });
  }
  for (const path of hidden) {
    test(`tidak tampil: ${path}`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(await response.text()).not.toContain("Anda sudah keluar.");
    });
  }

  test("di browser, halaman daftar dengan ?keluar=1 tidak punya status sama sekali", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, []);
    try {
      await page.goto("/sign-up?keluar=1");
      await expect(
        page.getByRole("heading", { name: "Buat akun petugas" }),
      ).toBeVisible();
      await expect(notice(page)).toHaveCount(0);
      await expect(page.getByText("Anda sudah keluar")).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test("isi parameter tidak pernah dipantulkan ke halaman", async ({
  browser,
  request,
}) => {
  const token = "PANTUL_9f3a7c";
  const attack = "<script>window.__pantul=1</script>";
  const values = [
    token,
    attack,
    `"><img src=x onerror="window.__pantul=1">`,
    `1${token}`,
  ];
  for (const value of values) {
    const path = `/sign-in?keluar=${encodeURIComponent(value)}`;
    const html = await (await request.get(path)).text();
    // Next menyalin alamat (termasuk query) ke data internalnya di dalam
    // <script> sebagai teks JSON dengan "<" ditulis \u003c; itu bukan
    // pemantulan oleh halaman. Yang diperiksa: tidak ada tanda mentah di mana
    // pun, dan di luar blok <script> isi parameter sama sekali tidak ada.
    expect(html, value).not.toContain(attack);
    expect(html, value).not.toContain("<img src=x");
    expect(html, value).not.toContain("Anda sudah keluar.");
    const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, "");
    expect(markup, value).not.toContain("PANTUL_9f3a7c");
    expect(markup, value).not.toContain("onerror");
    expect(markup, value).not.toContain("__pantul");

    const { context, page, errors } = await contextFor(browser, []);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    try {
      await page.goto(path);
      await expect(loginHeading(page)).toBeVisible();
      // Teks dan atribut tampilan (di luar data skrip internal Next) bersih.
      const rendered = await page.evaluate(() => {
        const copy = document.body.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("script, style").forEach((el) => el.remove());
        return copy.innerHTML;
      });
      expect(rendered, value).not.toContain("PANTUL_9f3a7c");
      expect(rendered, value).not.toContain("__pantul");
      expect(
        await page.evaluate(
          () => (window as unknown as { __pantul?: number }).__pantul,
        ),
      ).toBeUndefined();
      expect(dialogs).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }

  // Pada ?keluar=1 yang sah, isi parameter pun tidak ada di tampilan.
  const { context, page } = await contextFor(browser, []);
  try {
    await page.goto("/sign-in?keluar=1");
    const rendered = await page.evaluate(() => {
      const copy = document.body.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("script, style").forEach((el) => el.remove());
      return copy.innerHTML;
    });
    expect(rendered).not.toContain("keluar=1");
  } finally {
    await context.close();
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`kontras teks penegasan ≥ 4,5:1 di tema ${scheme === "light" ? "terang" : "gelap"}`, async ({
    browser,
  }) => {
    const { context, page } = await contextFor(browser, [], {
      colorScheme: scheme,
      viewport: wide,
    });
    try {
      await page.goto("/sign-in?keluar=1");
      await expect(notice(page)).toBeVisible();
      // Tema benar-benar berganti (latar halaman terang vs gelap).
      const background = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      const channels = (background.match(/\d+(\.\d+)?/g) ?? [])
        .slice(0, 3)
        .map(Number);
      const lightness = (channels[0] + channels[1] + channels[2]) / 3;
      if (scheme === "light") expect(lightness).toBeGreaterThan(200);
      else expect(lightness).toBeLessThan(60);

      const { ratio, text } = await contrastOf(notice(page));
      expect(text).toBe("Anda sudah keluar.");
      expect(ratio, `${scheme}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        4.5,
      );
    } finally {
      await context.close();
    }
  });
}

test("penegasan tanpa guliran mendatar di 390 dan 1440 px, tanpa galat halaman atau konsol", async ({
  browser,
}) => {
  for (const viewport of [narrow, wide]) {
    const { context, page, errors } = await contextFor(browser, [], {
      viewport,
    });
    try {
      await page.goto("/sign-in?keluar=1");
      await expect(notice(page)).toBeVisible();
      expect(await overflowX(page), `${viewport.width} px`).toBeLessThanOrEqual(
        0,
      );
      const box = (await notice(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      // Beri waktu bagi galat hidrasi yang dilaporkan setelah render pertama.
      await page.waitForTimeout(400);
      expect(errors, `${viewport.width} px`).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test("tautan 'Buat akun' di halaman masuk dengan ?keluar=1 menuju /sign-up tanpa keluar, juga bersama next", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, []);
  try {
    await page.goto("/sign-in?keluar=1");
    const link = page.getByRole("link", { name: "Buat akun", exact: true });
    await expect(link).toHaveAttribute("href", "/sign-up");
    await hydrated(page.locator("form"));
    await link.click();
    await expect(page).toHaveURL(`${origin}/sign-up`);
    await expect(
      page.getByRole("heading", { name: "Buat akun petugas" }),
    ).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    // Dari sana kembali ke masuk: tanpa keluar.
    await expect(
      page.getByRole("link", { name: "Masuk", exact: true }),
    ).toHaveAttribute("href", "/sign-in");

    await page.goto("/sign-in?keluar=1&next=%2Fapp%2Falert");
    await expect(notice(page)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Buat akun", exact: true }),
    ).toHaveAttribute("href", "/sign-up?next=%2Fapp%2Falert");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
