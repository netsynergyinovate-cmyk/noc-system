import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import { contextFor, signUp, type Cookies } from "./billing-ui";
import { contrastOf } from "./contrast";

// Kontrol akses per peran di halaman sungguhan (mode demo, port 3101): tautan
// "Admin" mengikuti peran yang dipakai tampilan (peran asli dari server,
// atau peran tiruan "Lihat sebagai"), sudah ada di HTML dari server untuk admin
// asli (tanpa kedip), tidak ada untuk akun biasa, dan tidak memberi akses apa
// pun: server tetap memakai peran asli. Mode live ada di setup-gate.spec.ts.
//
// Dua akun saja untuk seluruh berkas (pendaftaran dibatasi sekitar tiga per
// sepuluh detik): ana tetap akun biasa; budi dijadikan admin lewat database
// seperti npm run role:set hanya selama sebuah tes membutuhkannya, dan selalu
// dikembalikan di finally.

const origin = "http://localhost:3101";
const wide = { width: 1440, height: 900 };
const narrow = { width: 390, height: 844 };
const hint = "Hanya tampilan; server tetap memakai peran asli.";

const appPaths = [
  "/app",
  "/app/alert",
  "/app/billing",
  "/app/anomali",
  "/app/pelanggan",
  "/app/router",
];

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

const pool = new Pool({
  connectionString: process.env.STARTER_TEST_DATABASE_URL,
  max: 1,
});
test.afterAll(async () => {
  await pool.end();
});

// Peran diberikan di luar aplikasi, seperti npm run role:set.
async function setRole(email: string, role: string | null) {
  const { rowCount } = await pool.query(
    'UPDATE "user" SET role = $1 WHERE email = $2',
    [role, email],
  );
  expect(rowCount).toBe(1);
}

let ana: Account; // akun biasa
let budi: Account; // admin hanya selama asAdmin
test.beforeAll(async ({ browser }) => {
  ana = await register(browser, "Petugas Akses Satu");
  budi = await register(browser, "Petugas Akses Dua");
});

async function asAdmin<T>(run: () => Promise<T>): Promise<T> {
  await setRole(budi.email, "admin");
  try {
    return await run();
  } finally {
    await setRole(budi.email, "user");
  }
}

// ---------------------------------------------------------------------------
// Pembantu
// ---------------------------------------------------------------------------

type Viewport = typeof wide;
const isWide = (viewport: Viewport) => viewport === wide;

// Sidebar (layar lebar) dan header (layar sempit) sama-sama ada di halaman;
// yang satunya disembunyikan CSS. Dipilih menurut tempatnya.
const sidebarBadge = (page: Page) =>
  page.locator("aside").getByTestId("role-badge");
const barBadge = (page: Page) =>
  page.locator("header").getByTestId("role-badge");
const badgeFor = (page: Page, viewport: Viewport) =>
  isWide(viewport) ? sidebarBadge(page) : barBadge(page);
const choice = (badge: Locator) => badge.getByLabel("Lihat sebagai");

// Tautan menurut DOM (juga yang disembunyikan CSS).
const sidebarLink = (page: Page) => page.locator("aside a[href='/admin']");
const barLink = (page: Page) => page.locator("header a[href='/admin']");
const anyLink = (page: Page) => page.locator("a[href='/admin']");
const visibleLink = (page: Page, viewport: Viewport) =>
  isWide(viewport) ? sidebarLink(page) : barLink(page);

// Pilihan sudah dihidrasi: elemennya punya props React.
async function hydrated(select: Locator) {
  await expect
    .poll(() =>
      select.evaluate((el) =>
        Object.keys(el).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
}

// Ada: satu salinan di sidebar dan satu di header, hanya yang cocok dengan
// lebar layar yang terlihat. Tidak ada: tidak satu pun, juga tidak di DOM.
async function expectLink(
  page: Page,
  viewport: Viewport,
  present: boolean,
  label: string,
) {
  if (present) {
    await expect(sidebarLink(page), label).toHaveCount(1);
    await expect(barLink(page), label).toHaveCount(1);
    await expect(anyLink(page), label).toHaveCount(2);
    await expect(visibleLink(page, viewport), label).toBeVisible();
    await expect(
      isWide(viewport) ? barLink(page) : sidebarLink(page),
      label,
    ).toBeHidden();
    await expect(visibleLink(page, viewport), label).toHaveText("Admin");
    await expect(visibleLink(page, viewport), label).toHaveAttribute(
      "href",
      "/admin",
    );
  } else {
    await expect(anyLink(page), label).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Admin" }),
      label,
    ).toHaveCount(0);
  }
}

const adminLinksInHtml = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="\/admin"[^>]*>/g)].length;

const overflowX = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

const markWindow = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __tanpaMuatUlang: boolean }).__tanpaMuatUlang =
      true;
  });
const windowMarked = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __tanpaMuatUlang?: boolean }).__tanpaMuatUlang ===
      true,
  );

type NextWindow = {
  next?: { router: { push(url: string): void } };
};
const softNavigate = (page: Page, url: string) =>
  page.evaluate((target) => {
    const router = (window as unknown as NextWindow).next?.router;
    if (!router) throw new Error("window.next.router tidak ada");
    router.push(target);
  }, url);

const notHere = (page: Page) =>
  page.getByRole("heading", { name: "Halaman tidak ditemukan" });
const adminHeading = (page: Page) =>
  page.getByRole("heading", { name: "Every account’s notes" });

// Memuat tiap halaman aplikasi di satu lebar layar dan memeriksa: tautan, HTML
// dari server (sebelum JavaScript apa pun), tanpa guliran mendatar, tautan di
// dalam layar, dan tanpa galat halaman atau konsol (termasuk ketidakcocokan
// hidrasi).
async function visitEveryPage(
  browser: Browser,
  account: Account,
  viewport: Viewport,
  present: boolean,
) {
  const { context, page, errors } = await contextFor(browser, account.cookies, {
    viewport,
  });
  try {
    for (const path of appPaths) {
      const label = `${path} di ${viewport.width} px`;
      await page.goto(path);
      await hydrated(choice(badgeFor(page, viewport)));
      await expectLink(page, viewport, present, label);

      // Jawaban HTML dari server untuk akun ini.
      const response = await page.request.get(path);
      expect(response.status(), label).toBe(200);
      const html = await response.text();
      if (present) {
        expect(adminLinksInHtml(html), label).toBe(2);
        expect(html, label).toContain("Admin");
      } else {
        expect(adminLinksInHtml(html), label).toBe(0);
        expect(html, label).not.toContain("Admin");
      }

      expect(await overflowX(page), label).toBeLessThanOrEqual(0);
      if (present) {
        const box = (await visibleLink(page, viewport).boundingBox())!;
        expect(box.x, label).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, label).toBeLessThanOrEqual(viewport.width);
        expect(box.height, label).toBeGreaterThanOrEqual(28);
      }
      // Beri waktu bagi galat hidrasi yang dilaporkan setelah render pertama.
      await page.waitForTimeout(300);
      expect(errors, label).toEqual([]);
    }
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Peran asli
// ---------------------------------------------------------------------------

for (const viewport of [wide, narrow]) {
  test(`admin asli: tautan "Admin" ada di semua halaman aplikasi dan di HTML dari server (${viewport.width} px), tanpa galat dan tanpa guliran`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    await asAdmin(() => visitEveryPage(browser, budi, viewport, true));
  });

  test(`akun biasa: tautan "Admin" tidak ada di halaman maupun di HTML dari server (${viewport.width} px), tanpa galat dan tanpa guliran`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    await visitEveryPage(browser, ana, viewport, false);
  });
}

for (const viewport of [wide, narrow]) {
  test(`admin asli: mengklik tautan membuka /admin dengan judul admin (${viewport.width} px)`, async ({
    browser,
  }) => {
    await asAdmin(async () => {
      const { context, page, errors } = await contextFor(
        browser,
        budi.cookies,
        { viewport },
      );
      try {
        await page.goto("/app");
        await hydrated(choice(badgeFor(page, viewport)));
        await markWindow(page);
        await visibleLink(page, viewport).click();
        await expect(page).toHaveURL(/\/admin$/);
        await expect(adminHeading(page)).toBeVisible();
        await expect(notHere(page)).toHaveCount(0);
        // Berpindah di dalam aplikasi, bukan muat ulang penuh.
        expect(await windowMarked(page)).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Peran tiruan
// ---------------------------------------------------------------------------

test("akun biasa memilih Admin (tiruan): tautan muncul tanpa muat ulang, /admin tetap tidak ada dan API tetap 403; Peran asli menyembunyikannya lagi", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, page, errors } = await contextFor(browser, ana.cookies, {
    viewport: wide,
  });
  try {
    await page.goto("/app");
    const badge = sidebarBadge(page);
    const select = choice(badge);
    await hydrated(select);
    await expectLink(page, wide, false, "awal");
    await markWindow(page);

    await select.selectOption({ label: "Admin (tiruan)" });
    await expect(badge).toHaveAttribute("data-preview", "true");
    await expect(badge.getByText(hint, { exact: true })).toBeVisible();
    await expectLink(page, wide, true, "Admin (tiruan)");
    // Tanpa muat ulang, dan salinan di header (tersembunyi) ikut muncul.
    expect(await windowMarked(page)).toBe(true);

    // "Peran asli" menyembunyikannya lagi.
    await select.selectOption({ label: "Peran asli: Petugas" });
    await expect(badge).toHaveAttribute("data-preview", "false");
    await expectLink(page, wide, false, "Peran asli");

    // Petugas (tiruan) sama dengan peran asli akun ini: tetap tidak ada.
    await select.selectOption({ label: "Petugas (tiruan)" });
    await expect(badge).toHaveAttribute("data-preview", "true");
    await expectLink(page, wide, false, "Petugas (tiruan)");

    // Memilih lagi, lalu mengklik tautannya.
    await select.selectOption({ label: "Admin (tiruan)" });
    await expectLink(page, wide, true, "Admin (tiruan) lagi");
    await sidebarLink(page).click();
    await expect(page).toHaveURL(/\/admin$/);
    // Server memakai peran asli: halaman "tidak ada", bukan halaman admin.
    await expect(notHere(page)).toBeVisible();
    await expect(adminHeading(page)).toHaveCount(0);
    expect(await windowMarked(page)).toBe(true);

    // API admin tetap menolak dengan peran asli.
    const list = await page.request.get("/api/admin/notes");
    expect(list.status()).toBe(403);
    expect((await list.json()).error.code).toBe("FORBIDDEN");

    // Muat ulang penuh: peran tiruan hilang, jadi tautan tidak ada lagi.
    await page.goto("/app");
    await hydrated(choice(sidebarBadge(page)));
    await expect(sidebarBadge(page)).toHaveAttribute("data-preview", "false");
    await expectLink(page, wide, false, "sesudah muat ulang");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("akun biasa di layar sempit: Admin (tiruan) memunculkan tautan di header, Peran asli menyembunyikannya", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, ana.cookies, {
    viewport: narrow,
  });
  try {
    await page.goto("/app");
    const badge = barBadge(page);
    const select = choice(badge);
    await hydrated(select);
    await expectLink(page, narrow, false, "awal");

    await select.selectOption({ label: "Admin (tiruan)" });
    await expect(badge).toHaveAttribute("data-preview", "true");
    await expectLink(page, narrow, true, "Admin (tiruan)");
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    const box = (await barLink(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(narrow.width);

    // Pilihan tetap bisa dituju setelah tautan muncul.
    await expect(select).toBeVisible();
    await select.selectOption({ label: "Peran asli: Petugas" });
    await expectLink(page, narrow, false, "Peran asli");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const viewport of [wide, narrow]) {
  test(`admin asli memilih Petugas (tiruan): tautan hilang, Peran asli memunculkannya, muat ulang menghapus pilihan; server tetap memakai peran asli (${viewport.width} px)`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    await asAdmin(async () => {
      const { context, page, errors } = await contextFor(
        browser,
        budi.cookies,
        { viewport },
      );
      try {
        await page.goto("/app");
        const badge = badgeFor(page, viewport);
        const select = choice(badge);
        await hydrated(select);
        await expect(badge).toHaveAttribute("data-role", "admin");
        await expectLink(page, viewport, true, "awal");
        await markWindow(page);

        await select.selectOption({ label: "Petugas (tiruan)" });
        await expect(badge).toHaveAttribute("data-preview", "true");
        await expect(badge).toHaveAttribute("data-role", "user");
        await expectLink(page, viewport, false, "Petugas (tiruan)");
        expect(await windowMarked(page)).toBe(true);

        // Server tetap memakai peran asli (admin): API terbuka, dan /admin
        // dibuka lewat navigasi di dalam aplikasi selagi peran tiruan aktif.
        const list = await page.request.get("/api/admin/notes");
        expect(list.status()).toBe(200);
        await softNavigate(page, "/admin");
        await expect(page).toHaveURL(/\/admin$/);
        await expect(adminHeading(page)).toBeVisible();
        await expect(notHere(page)).toHaveCount(0);
        expect(await windowMarked(page)).toBe(true);

        // Kembali ke aplikasi dengan muat ulang penuh: pilihan dihapus.
        await page.goto("/app");
        await hydrated(choice(badgeFor(page, viewport)));
        await expect(badgeFor(page, viewport)).toHaveAttribute(
          "data-preview",
          "false",
        );
        await expectLink(page, viewport, true, "sesudah muat ulang");

        // Pilih lagi, lalu "Peran asli" memunculkannya kembali.
        await choice(badgeFor(page, viewport)).selectOption({
          label: "Petugas (tiruan)",
        });
        await expectLink(page, viewport, false, "Petugas (tiruan) lagi");
        await choice(badgeFor(page, viewport)).selectOption({
          label: "Peran asli: Admin",
        });
        await expect(badgeFor(page, viewport)).toHaveAttribute(
          "data-preview",
          "false",
        );
        await expectLink(page, viewport, true, "Peran asli");

        // Admin (tiruan) sama dengan peran asli akun ini: tetap ada.
        await choice(badgeFor(page, viewport)).selectOption({
          label: "Admin (tiruan)",
        });
        await expect(badgeFor(page, viewport)).toHaveAttribute(
          "data-preview",
          "true",
        );
        await expectLink(page, viewport, true, "Admin (tiruan)");
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });
}

test("peran tiruan di satu akun tidak mengubah tautan di akun lain, dan HTML dari server tetap menurut peran asli", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  await asAdmin(async () => {
    const left = await contextFor(browser, ana.cookies, { viewport: wide });
    const right = await contextFor(browser, budi.cookies, { viewport: wide });
    try {
      await left.page.goto("/app");
      await right.page.goto("/app");
      await hydrated(choice(sidebarBadge(left.page)));
      await hydrated(choice(sidebarBadge(right.page)));

      await choice(sidebarBadge(left.page)).selectOption({
        label: "Admin (tiruan)",
      });
      await choice(sidebarBadge(right.page)).selectOption({
        label: "Petugas (tiruan)",
      });
      await expectLink(left.page, wide, true, "akun biasa meniru admin");
      await expectLink(right.page, wide, false, "admin meniru petugas");

      // Muat ulang di sisi lain tidak terpengaruh, dan HTML dari server tetap
      // menurut peran asli masing-masing.
      const regularHtml = await (await left.page.request.get("/app")).text();
      const adminHtml = await (await right.page.request.get("/app")).text();
      expect(adminLinksInHtml(regularHtml)).toBe(0);
      expect(adminLinksInHtml(adminHtml)).toBe(2);
      expect(left.errors).toEqual([]);
      expect(right.errors).toEqual([]);
    } finally {
      await left.context.close();
      await right.context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Tanpa kedip
// ---------------------------------------------------------------------------

test("tanpa kedip: untuk admin asli tautan sudah ada di DOM saat domcontentloaded, sebelum hidrasi (skrip diblokir); akun biasa tidak punya", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const blockScripts = (page: Page) =>
    page.route("**/_next/static/**", (route) =>
      route.request().resourceType() === "script"
        ? route.abort()
        : route.continue(),
    );

  await asAdmin(async () => {
    for (const viewport of [wide, narrow]) {
      const { context, page } = await contextFor(browser, budi.cookies, {
        viewport,
      });
      try {
        await blockScripts(page);
        for (const path of appPaths) {
          const label = `${path} di ${viewport.width} px`;
          await page.goto(path, { waitUntil: "domcontentloaded" });
          // Tanpa menunggu apa pun: hitungan langsung dari DOM saat ini.
          expect(await sidebarLink(page).count(), label).toBe(1);
          expect(await barLink(page).count(), label).toBe(1);
          // Benar-benar belum dihidrasi: skrip aplikasi tidak pernah jalan.
          const hydratedNow = await choice(badgeFor(page, viewport)).evaluate(
            (el) =>
              Object.keys(el).some((key) => key.startsWith("__reactProps$")),
          );
          expect(hydratedNow, label).toBe(false);
          await expect(visibleLink(page, viewport), label).toBeVisible();
        }
      } finally {
        await context.close();
      }
    }
  });

  const { context, page } = await contextFor(browser, ana.cookies, {
    viewport: wide,
  });
  try {
    await blockScripts(page);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(sidebarBadge(page)).toBeVisible();
    expect(await anyLink(page).count()).toBe(0);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Kontras
// ---------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  test(`kontras tautan "Admin" di tema ${scheme}: 4,5 : 1 di sidebar (1440 px) dan di header (390 px)`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    await asAdmin(async () => {
      for (const viewport of [wide, narrow]) {
        const { context, page } = await contextFor(browser, budi.cookies, {
          colorScheme: scheme,
          viewport,
        });
        try {
          await page.goto("/app");
          if (scheme === "dark") {
            await expect(page.locator("html")).toHaveClass(/dark/);
          } else {
            await expect(page.locator("html")).not.toHaveClass(/dark/);
          }
          await hydrated(choice(badgeFor(page, viewport)));
          const link = visibleLink(page, viewport);
          await expect(link).toBeVisible();
          const { text, ratio } = await contrastOf(link);
          expect(text).toBe("Admin");
          expect(
            ratio,
            `tautan di ${viewport.width} px, tema ${scheme}`,
          ).toBeGreaterThanOrEqual(4.5);
        } finally {
          await context.close();
        }
      }
    });
  });
}
