import { randomUUID } from "node:crypto";
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

// Peran petugas dan "Lihat sebagai" di sidebar dan header, di halaman sungguhan
// (mode demo, port 3101): peran asli dan tiruan, bertahan antarhalaman tanpa
// memuat ulang, hilang saat dimuat ulang, tidak memberi akses apa pun, papan
// ketik, hidrasi bersih, tata letak, kontras di dua tema, dan data tiap akun
// tidak bocor ke akun lain. Mode live ada di setup-gate.spec.ts.
//
// Dua akun saja untuk seluruh berkas (pendaftaran dibatasi sekitar tiga per
// sepuluh detik). Peran akun diubah lewat database seperti npm run role:set,
// dan selalu dikembalikan di finally.

const origin = "http://localhost:3101";
const hint = "Hanya tampilan; server tetap memakai peran asli.";
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

// Dua akun biasa. Yang kedua hanya dipromosikan sebentar di uji isolasi.
let ana: Account;
let budi: Account;
test.beforeAll(async ({ browser }) => {
  ana = await register(browser, "Petugas Peran Satu");
  budi = await register(browser, "Petugas Peran Dua");
});

// Sidebar (layar lebar) dan header (layar sempit) sama-sama ada di halaman;
// yang satunya disembunyikan CSS, jadi dipilih menurut tempatnya.
const sidebarBadge = (page: Page) =>
  page.locator("aside").getByTestId("role-badge");
const barBadge = (page: Page) =>
  page.locator("header").getByTestId("role-badge");
const choice = (badge: Locator) => badge.getByLabel("Lihat sebagai");
const menu = (page: Page) =>
  page.getByRole("navigation", { name: "Menu utama" });

// Pilihan sudah dihidrasi: elemennya punya props React. Sebelum itu perubahan
// pilihan belum ditangani React dan akan dikembalikan saat hidrasi.
async function hydrated(select: Locator) {
  await expect
    .poll(() =>
      select.evaluate((el) =>
        Object.keys(el).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
}

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

// Router Next.js untuk berpindah halaman atau menyegarkan tanpa memuat ulang
// (window.next.router, dipakai di sini hanya untuk pengujian).
type NextWindow = {
  next?: { router: { push(url: string): void; refresh(): void } };
};
const softNavigate = (page: Page, url: string) =>
  page.evaluate((target) => {
    const router = (window as unknown as NextWindow).next?.router;
    if (!router) throw new Error("window.next.router tidak ada");
    router.push(target);
  }, url);
const softRefresh = (page: Page) =>
  page.evaluate(() => {
    const router = (window as unknown as NextWindow).next?.router;
    if (!router) throw new Error("window.next.router tidak ada");
    router.refresh();
  });

const overflowX = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

// Peran yang tertulis di setiap lencana pada HTML dari server.
function badgeRoles(html: string) {
  return [...html.matchAll(/<div[^>]*data-testid="role-badge"[^>]*>/g)].map(
    (match) => /data-role="([^"]*)"/.exec(match[0])?.[1] ?? null,
  );
}

// ---------------------------------------------------------------------------
// Peran asli
// ---------------------------------------------------------------------------

test("akun baru: peran Petugas tampil di sidebar (1440 px) dan di header (390 px), dengan pilihan Lihat sebagai", async ({
  browser,
}) => {
  const desktop = await contextFor(browser, ana.cookies, { viewport: wide });
  try {
    const { page, errors } = desktop;
    await page.goto("/app");
    const badge = sidebarBadge(page);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-role", "user");
    await expect(badge).toHaveAttribute("data-preview", "false");
    await expect(badge).toHaveAttribute("data-preview-enabled", "true");
    // Label terlihat dan terhubung ke pilihan sungguhan.
    await expect(
      badge.getByText("Lihat sebagai", { exact: true }),
    ).toBeVisible();
    const select = choice(badge);
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("");
    await expect(select).toHaveAccessibleName("Lihat sebagai");
    await expect(select.locator("option")).toHaveText([
      "Peran asli: Petugas",
      "Admin (tiruan)",
      "Petugas (tiruan)",
    ]);
    await expect(select.locator("option:checked")).toHaveText(
      "Peran asli: Petugas",
    );
    await expect(badge.getByText(hint)).toHaveCount(0);

    // Tepat di bawah "Masuk sebagai ...".
    const signedIn = page.locator("aside").getByText(/^Masuk sebagai /);
    await expect(signedIn).toHaveText(`Masuk sebagai ${ana.email}`);
    expect(
      await signedIn.evaluate((el) =>
        el.nextElementSibling?.getAttribute("data-testid"),
      ),
    ).toBe("role-badge");

    // Salinan di header ada tetapi disembunyikan di layar lebar.
    await expect(barBadge(page)).toBeHidden();
    await expect(barBadge(page)).toHaveAttribute("data-role", "user");
    expect(errors).toEqual([]);
  } finally {
    await desktop.context.close();
  }

  const phone = await contextFor(browser, ana.cookies, { viewport: narrow });
  try {
    const { page, errors } = phone;
    await page.goto("/app");
    const badge = barBadge(page);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-role", "user");
    await expect(badge).toHaveAttribute("data-preview", "false");
    await expect(badge).toHaveAttribute("data-preview-enabled", "true");
    await expect(
      badge.getByText("Lihat sebagai", { exact: true }),
    ).toBeVisible();
    await expect(choice(badge)).toBeVisible();
    await expect(choice(badge).locator("option:checked")).toHaveText(
      "Peran asli: Petugas",
    );
    // Di barisan tombol header (satu baris dengan tombol Keluar).
    await expect(
      badge
        .locator("xpath=..")
        .getByRole("button", { name: "Keluar", exact: true }),
    ).toBeVisible();
    await expect(sidebarBadge(page)).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await phone.context.close();
  }
});

test("peran asli admin dibaca dari server setelah dimuat ulang: lencana, pilihan, dan tautan admin", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, ana.cookies, {
    viewport: wide,
  });
  try {
    await page.goto("/app");
    await expect(sidebarBadge(page)).toHaveAttribute("data-role", "user");
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

    await setRole(ana.email, "admin");
    await page.reload();
    const badge = sidebarBadge(page);
    await expect(badge).toHaveAttribute("data-role", "admin");
    await expect(badge).toHaveAttribute("data-preview", "false");
    await expect(choice(badge).locator("option").first()).toHaveText(
      "Peran asli: Admin",
    );
    await expect(choice(badge).locator("option:checked")).toHaveText(
      "Peran asli: Admin",
    );
    // Tautan admin mengikuti peran di store, yang diisi server dengan peran
    // asli: sudah ada setelah dimuat ulang tanpa memilih apa pun.
    await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await setRole(ana.email, "user");
  }
});

test("router.refresh() membawa peran asli yang baru tanpa memuat ulang halaman, dan peran tiruan tetap dipertahankan", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, ana.cookies, {
    viewport: wide,
  });
  try {
    await page.goto("/app");
    const badge = sidebarBadge(page);
    const select = choice(badge);
    await hydrated(select);
    await markWindow(page);
    await expect(badge).toHaveAttribute("data-role", "user");

    // Peran asli berubah di server; halaman hanya menyegarkan datanya.
    await setRole(ana.email, "admin");
    await softRefresh(page);
    await expect(select.locator("option").first()).toHaveText(
      "Peran asli: Admin",
    );
    await expect(badge).toHaveAttribute("data-role", "admin");
    await expect(badge).toHaveAttribute("data-preview", "false");

    // Meniru Petugas, lalu peran asli berubah lagi: pilihan tiruan tetap (akun
    // yang sama), hanya tulisan "Peran asli" yang ikut.
    await select.selectOption("user");
    await expect(badge).toHaveAttribute("data-role", "user");
    await expect(badge).toHaveAttribute("data-preview", "true");
    await setRole(ana.email, "user");
    await softRefresh(page);
    await expect(select.locator("option").first()).toHaveText(
      "Peran asli: Petugas",
    );
    await expect(badge).toHaveAttribute("data-preview", "true");
    await expect(badge).toHaveAttribute("data-role", "user");
    await expect(select).toHaveValue("user");

    expect(await windowMarked(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await setRole(ana.email, "user");
  }
});

// ---------------------------------------------------------------------------
// Peran tiruan
// ---------------------------------------------------------------------------

const appPages = [
  { link: "Dashboard", path: "/app", heading: "Dashboard NOC" },
  { link: "Alert", path: "/app/alert", heading: "Alert" },
  { link: "Deteksi Anomali", path: "/app/anomali", heading: "Deteksi Anomali" },
  { link: "Pelanggan", path: "/app/pelanggan", heading: "Daftar Pelanggan" },
  { link: "Billing", path: "/app/billing", heading: "Status Billing" },
  { link: "Router", path: "/app/router", heading: "Kelola Router" },
] as const;

test("memilih peran tiruan mengubah lencana, bertahan di semua halaman aplikasi tanpa memuat ulang, dan hilang saat dimuat ulang", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, errors } = await contextFor(browser, ana.cookies, {
    viewport: wide,
  });
  try {
    await page.goto("/app");
    const badge = sidebarBadge(page);
    const select = choice(badge);
    await hydrated(select);
    await expect(badge).toHaveAttribute("data-role", "user");

    // Keadaan penyimpanan sebelum memilih; sesudahnya tidak boleh berubah.
    const storage = async () =>
      JSON.stringify({
        cookies: (await context.cookies())
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .sort(),
        local: await page.evaluate(() => ({ ...localStorage })),
        session: await page.evaluate(() => ({ ...sessionStorage })),
      });
    const before = await storage();

    // Yang dikirim ke server sesudah memilih tidak boleh memuat peran tiruan.
    const sent: Array<{ url: string; headers: string[]; body: string | null }> =
      [];
    page.on("request", (request) =>
      sent.push({
        url: request.url(),
        headers: Object.keys(request.headers()),
        body: request.postData(),
      }),
    );

    await select.selectOption({ label: "Admin (tiruan)" });
    await expect(badge).toHaveAttribute("data-preview", "true");
    await expect(badge).toHaveAttribute("data-role", "admin");
    await expect(select).toHaveValue("admin");
    await expect(select.locator("option:checked")).toHaveText("Admin (tiruan)");
    await expect(badge.getByText(hint, { exact: true })).toBeVisible();
    await expect(select).toHaveAccessibleDescription(hint);
    // Peran asli di pilihan pertama tidak ikut berubah.
    await expect(select.locator("option").first()).toHaveText(
      "Peran asli: Petugas",
    );
    // Salinan di header (tersembunyi) memakai store yang sama.
    await expect(barBadge(page)).toHaveAttribute("data-role", "admin");
    await expect(barBadge(page)).toHaveAttribute("data-preview", "true");

    // Berpindah halaman lewat menu: halaman tidak dimuat ulang (penanda di
    // window bertahan) dan peran tiruan tetap di setiap halaman.
    await markWindow(page);
    for (const { link, path, heading } of appPages) {
      await menu(page).getByRole("link", { name: link, exact: true }).click();
      await expect(page).toHaveURL(path);
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
      const label = `${link} (${path})`;
      await expect(badge, label).toHaveAttribute("data-preview", "true");
      await expect(badge, label).toHaveAttribute("data-role", "admin");
      await expect(select, label).toHaveValue("admin");
      await expect(badge.getByText(hint, { exact: true }), label).toBeVisible();
      expect(await windowMarked(page), label).toBe(true);
    }

    // Tidak disimpan di cookie, localStorage, atau sessionStorage, dan tidak
    // ikut dikirim ke server.
    expect(await storage()).toBe(before);
    const leaks = sent.filter(
      (request) =>
        /role|preview|tiruan|peran/i.test(new URL(request.url).search) ||
        request.headers.some((name) =>
          /role|preview|tiruan|peran/i.test(name),
        ) ||
        /role|preview|tiruan|peran/i.test(request.body ?? ""),
    );
    expect(leaks).toEqual([]);
    expect(sent.length).toBeGreaterThan(0);

    // "Peran asli" mengembalikannya.
    await select.selectOption({ label: "Peran asli: Petugas" });
    await expect(badge).toHaveAttribute("data-preview", "false");
    await expect(badge).toHaveAttribute("data-role", "user");
    await expect(select).toHaveValue("");
    await expect(badge.getByText(hint)).toHaveCount(0);
    await expect(select).toHaveAccessibleDescription("");

    // Memilih lagi, lalu memuat ulang: peran tiruan hilang (tidak disimpan).
    await select.selectOption("admin");
    await expect(badge).toHaveAttribute("data-preview", "true");
    await page.reload();
    await expect(sidebarBadge(page)).toHaveAttribute("data-preview", "false");
    await expect(sidebarBadge(page)).toHaveAttribute("data-role", "user");
    await expect(choice(sidebarBadge(page))).toHaveValue("");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("peran tiruan hanya mengubah tampilan: tautan admin muncul, tetapi /admin tetap tidak ada dan API admin tetap 403", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, ana.cookies, {
    viewport: wide,
  });
  try {
    await page.goto("/app");
    const badge = sidebarBadge(page);
    const select = choice(badge);
    await hydrated(select);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

    await select.selectOption("admin");
    await expect(badge).toHaveAttribute("data-role", "admin");
    await expect(badge).toHaveAttribute("data-preview", "true");

    // Tampilan mengikuti peran tiruan, jadi tautan admin muncul (hanya tampilan;
    // e2e/access-ui.spec.ts memeriksa tautan ini lebih lengkap).
    await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();

    // API: ditolak server dengan peran asli, bukan 200.
    const list = await page.request.get("/api/admin/notes");
    expect(list.status()).toBe(403);
    expect((await list.json()).error.code).toBe("FORBIDDEN");
    const removal = await page.request.delete(
      `/api/admin/notes/${randomUUID()}`,
      { headers: { Origin: origin } },
    );
    expect(removal.status()).toBe(403);
    expect((await removal.json()).error.code).toBe("FORBIDDEN");

    // Halaman, lewat navigasi di dalam aplikasi selagi peran tiruan aktif.
    await markWindow(page);
    await softNavigate(page, "/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Halaman tidak ditemukan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Every account’s notes" }),
    ).toHaveCount(0);
    expect(await windowMarked(page)).toBe(true);

    // Dan lewat muat halaman penuh.
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Halaman tidak ditemukan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Every account’s notes" }),
    ).toHaveCount(0);
    await expect(page.getByText("Admin access")).toHaveCount(0);

    // Muat halaman penuh membuang peran tiruan, jadi tautan admin ikut hilang.
    await page.goto("/app");
    await expect(sidebarBadge(page)).toHaveAttribute("data-preview", "false");
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Papan ketik
// ---------------------------------------------------------------------------

// Menekan Tab sampai `target` berfokus; gagal bila tidak pernah sampai.
async function tabTo(page: Page, target: Locator, limit = 40) {
  for (let presses = 1; presses <= limit; presses += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) {
      return presses;
    }
  }
  throw new Error(`Tab ${limit} kali tidak sampai ke elemen yang dituju`);
}

test("papan ketik: Tab sampai ke pilihan, panah mengganti peran tiruan, dan fokusnya terlihat", async ({
  browser,
}) => {
  const { context, page, errors } = await contextFor(browser, ana.cookies, {
    viewport: wide,
  });
  try {
    await page.goto("/app");
    const badge = sidebarBadge(page);
    const select = choice(badge);
    await hydrated(select);

    // Satu pilihan yang tampil, dengan nama aksesibel dan peran combobox.
    const byRole = page.getByRole("combobox", { name: "Lihat sebagai" });
    await expect(byRole).toHaveCount(1);

    await tabTo(page, select);
    await expect(select).toBeFocused();
    // Cincin fokus tampil (bukan dihilangkan).
    const ring = await select.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).not.toBe("none");

    const expectState = async (
      value: string,
      role: string,
      preview: boolean,
    ) => {
      await expect(select).toHaveValue(value);
      await expect(badge).toHaveAttribute("data-role", role);
      await expect(badge).toHaveAttribute("data-preview", String(preview));
      await expect(select).toBeFocused();
    };

    await page.keyboard.press("ArrowDown");
    await expectState("admin", "admin", true);
    await expect(select).toHaveAccessibleDescription(hint);
    await page.keyboard.press("ArrowDown");
    await expectState("user", "user", true);
    // Sudah di ujung: tidak ada yang berubah.
    await page.keyboard.press("ArrowDown");
    await expectState("user", "user", true);
    await page.keyboard.press("ArrowUp");
    await expectState("admin", "admin", true);
    await page.keyboard.press("ArrowUp");
    await expectState("", "user", false);
    await expect(select).toHaveAccessibleDescription("");
    await page.keyboard.press("ArrowUp");
    await expectState("", "user", false);

    // Tab berikutnya meninggalkan pilihan menuju tombol Keluar.
    await page.keyboard.press("Tab");
    await expect(
      page
        .locator("aside")
        .getByRole("button", { name: "Keluar", exact: true }),
    ).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Hidrasi
// ---------------------------------------------------------------------------

test("memuat /app, /app/alert, dan /app/billing tanpa galat halaman, galat konsol, atau ketidakcocokan hidrasi", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  for (const viewport of [wide, narrow]) {
    const { context, page, errors } = await contextFor(browser, ana.cookies, {
      viewport,
    });
    try {
      for (const path of ["/app", "/app/alert", "/app/billing"]) {
        await page.goto(path);
        const badge = viewport === wide ? sidebarBadge(page) : barBadge(page);
        await expect(badge, path).toBeVisible();
        // Hidrasi selesai dan pilihan hidup (props React terpasang).
        await hydrated(choice(badge));
        await expect(badge, path).toHaveAttribute("data-role", "user");
        await expect(badge, path).toHaveAttribute("data-preview", "false");
        // Beri waktu bagi galat hidrasi yang dilaporkan setelah render pertama.
        await page.waitForTimeout(500);
        expect(errors, `${path} di ${viewport.width} px`).toEqual([]);
      }
    } finally {
      await context.close();
    }
  }
});

// ---------------------------------------------------------------------------
// Tata letak
// ---------------------------------------------------------------------------

test("tanpa guliran mendatar di 390 dan 1440 px, dengan atau tanpa peran tiruan; pilihan cukup tinggi dan di dalam layar", async ({
  browser,
}) => {
  for (const viewport of [narrow, wide]) {
    const { context, page } = await contextFor(browser, ana.cookies, {
      viewport,
    });
    try {
      await page.goto("/app");
      const badge = viewport === wide ? sidebarBadge(page) : barBadge(page);
      const select = choice(badge);
      await hydrated(select);
      const label = `${viewport.width} px`;

      for (const value of ["", "admin", "user", ""]) {
        await select.selectOption(value);
        await expect(select, label).toHaveValue(value);
        expect(
          await overflowX(page),
          `${label}, pilihan "${value}"`,
        ).toBeLessThanOrEqual(0);

        const box = (await select.boundingBox())!;
        expect(box.height, label).toBeGreaterThanOrEqual(32);
        expect(box.x, label).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, label).toBeLessThanOrEqual(viewport.width);
        // Seluruh isi lencana (petunjuk juga) ada di dalam layar.
        const area = (await badge.boundingBox())!;
        expect(area.x, label).toBeGreaterThanOrEqual(0);
        expect(area.x + area.width, label).toBeLessThanOrEqual(viewport.width);
      }
      if (viewport === wide) {
        // Di sidebar pilihan tidak melebihi lebar sidebar (15 rem).
        const aside = (await page.locator("aside").boundingBox())!;
        const box = (await select.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(aside.x + aside.width);
      }
    } finally {
      await context.close();
    }
  }
});

test("di 1366x768 dan 1366x600 tombol Keluar di sidebar tetap terjangkau, juga saat sidebar paling tinggi (admin, peran tiruan, petunjuk)", async ({
  browser,
}) => {
  // Tautan "Admin" dan petunjuk menambah tinggi sidebar. Tautan ikut peran
  // yang dipakai tampilan, jadi akun admin memilih Admin (tiruan): tautan dan
  // petunjuk sama-sama tampil (Petugas (tiruan) akan menyembunyikan tautannya).
  await setRole(ana.email, "admin");
  try {
    for (const height of [768, 600]) {
      const { context, page } = await contextFor(browser, ana.cookies, {
        viewport: { width: 1366, height },
      });
      try {
        await page.goto("/app");
        const aside = page.locator("aside");
        const select = choice(sidebarBadge(page));
        await hydrated(select);
        await select.selectOption("admin");
        await expect(aside.getByText(hint)).toBeVisible();
        await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();

        // Perilaku dulu: tombol Keluar bisa digulirkan ke dalam layar, utuh dan
        // tidak terpotong, lalu bisa dituju.
        const signOut = aside.getByRole("button", {
          name: "Keluar",
          exact: true,
        });
        await signOut.scrollIntoViewIfNeeded();
        await expect(signOut, `${height} px`).toBeInViewport({ ratio: 1 });
        const box = (await signOut.boundingBox())!;
        expect(box.y + box.height, `${height} px`).toBeLessThanOrEqual(height);
        await signOut.hover();

        // Lalu bentuknya: sidebar setinggi layar dan isinya menggulir di dalam
        // sidebar bila lebih tinggi dari layar. Halaman sendiri tidak melebar.
        const metrics = await aside.evaluate((el) => ({
          scroll: el.scrollHeight,
          client: el.clientHeight,
          overflowY: getComputedStyle(el).overflowY,
        }));
        expect(metrics.client, `${height} px`).toBe(height);
        if (height === 600)
          expect(metrics.scroll).toBeGreaterThan(metrics.client);
        expect(metrics.overflowY, `${height} px`).toBe("auto");
        expect(await overflowX(page)).toBeLessThanOrEqual(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await setRole(ana.email, "user");
  }
});

// ---------------------------------------------------------------------------
// Kontras
// ---------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  test(`kontras di tema ${scheme}: "Masuk sebagai", label, pilihan, dan petunjuk terbaca (4,5 : 1)`, async ({
    browser,
  }) => {
    const { context, page } = await contextFor(browser, ana.cookies, {
      colorScheme: scheme,
      viewport: wide,
    });
    try {
      await page.goto("/app");
      if (scheme === "dark") {
        await expect(page.locator("html")).toHaveClass(/dark/);
      } else {
        await expect(page.locator("html")).not.toHaveClass(/dark/);
      }
      const badge = sidebarBadge(page);
      const select = choice(badge);
      await hydrated(select);

      const measured: Array<[string, Locator]> = [
        ["Masuk sebagai", page.locator("aside").getByText(/^Masuk sebagai /)],
        [
          "label Lihat sebagai",
          badge.getByText("Lihat sebagai", { exact: true }),
        ],
        ["pilihan (peran asli)", select],
      ];
      const check = async () => {
        for (const [name, locator] of measured) {
          const { text, ratio } = await contrastOf(locator);
          expect(text, `${name}: elemen tanpa tulisan`).not.toBe("");
          expect(
            ratio,
            `${name} ("${text}") di tema ${scheme}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      };
      await check();

      // Dengan peran tiruan: pilihan menampilkan "Admin (tiruan)" dan petunjuk muncul.
      await select.selectOption("admin");
      await expect(select.locator("option:checked")).toHaveText(
        "Admin (tiruan)",
      );
      measured.push(["petunjuk", badge.getByText(hint, { exact: true })]);
      measured[2][0] = "pilihan (peran tiruan)";
      await check();

      // Juga di header layar sempit.
      await page.setViewportSize(narrow);
      const bar = barBadge(page);
      await expect(bar).toBeVisible();
      measured.length = 0;
      measured.push(
        ["label di header", bar.getByText("Lihat sebagai", { exact: true })],
        ["pilihan di header", choice(bar)],
        ["petunjuk di header", bar.getByText(hint, { exact: true })],
      );
      await check();
    } finally {
      await context.close();
    }
  });
}

// ---------------------------------------------------------------------------
// Data tiap akun terpisah
// ---------------------------------------------------------------------------

test("dua akun tidak saling melihat data: lencana, 'Masuk sebagai', dan HTML dari server tiap akun sesuai akunnya", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Peran berbeda supaya data yang tertukar langsung kelihatan di lencana.
  await setRole(budi.email, "admin");
  const left = await contextFor(browser, ana.cookies, { viewport: wide });
  const right = await contextFor(browser, budi.cookies, { viewport: wide });
  try {
    const people = [
      {
        who: ana,
        other: budi,
        role: "user",
        original: "Peran asli: Petugas",
        session: left,
      },
      {
        who: budi,
        other: ana,
        role: "admin",
        original: "Peran asli: Admin",
        session: right,
      },
    ];
    // Bergantian beberapa putaran: pembukaan halaman, muat ulang, lalu
    // permintaan mentah ke server.
    for (let round = 0; round < 3; round += 1) {
      for (const { who, other, role, original, session } of people) {
        const { page, errors } = session;
        if (round === 0) await page.goto("/app");
        else await page.reload();
        const badge = sidebarBadge(page);
        const label = `putaran ${round + 1}, ${who.email}`;
        await expect(badge, label).toHaveAttribute("data-role", role);
        await expect(badge, label).toHaveAttribute("data-preview", "false");
        await expect(choice(badge).locator("option").first(), label).toHaveText(
          original,
        );
        await expect(
          page.getByText(`Masuk sebagai ${who.email}`),
          label,
        ).toBeVisible();
        await expect(page.getByText(other.email), label).toHaveCount(0);

        // Jawaban HTML dari server untuk akun ini (sebelum JavaScript apa pun).
        const response = await page.request.get("/app");
        expect(response.status(), label).toBe(200);
        const html = await response.text();
        expect(badgeRoles(html), label).toEqual([role, role]);
        expect(html, label).toContain(who.email);
        expect(html, label).toContain(who.id);
        expect(html, label).not.toContain(other.email);
        expect(html, label).not.toContain(other.id);
        expect(errors, label).toEqual([]);
      }
    }

    // Peran tiruan di satu akun tidak terlihat di akun lain, juga pada
    // permintaan server berikutnya.
    const mine = left.page;
    await hydrated(choice(sidebarBadge(mine)));
    await choice(sidebarBadge(mine)).selectOption("admin");
    await expect(sidebarBadge(mine)).toHaveAttribute("data-role", "admin");
    await right.page.reload();
    await expect(sidebarBadge(right.page)).toHaveAttribute(
      "data-preview",
      "false",
    );
    await expect(sidebarBadge(right.page)).toHaveAttribute(
      "data-role",
      "admin",
    );
    const afterPreview = await (await left.page.request.get("/app")).text();
    expect(badgeRoles(afterPreview)).toEqual(["user", "user"]);
  } finally {
    await left.context.close();
    await right.context.close();
    await setRole(budi.email, "user");
  }
});
