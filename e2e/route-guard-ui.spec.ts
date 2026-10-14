import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import { contextFor, signUp, type Cookies } from "./billing-ui";

// Proteksi route dasbor: tanpa cookie sesi, /app, /setup, dan /admin dialihkan
// proxy ke /sign-in?next=... SEBELUM halaman dirender; tujuan itu dibawa lewat
// formulir masuk/daftar dan tidak pernah menjadi open redirect; cookie yang basi
// tetap ditolak server (requireSession) dengan tujuan yang sama; dan proxy
// tidak pernah mengalihkan pemilik cookie menjauh dari halaman masuk.

const origin = "http://localhost:3101";
const password = "A-long-test-password-123!";

const pool = new Pool({
  connectionString: process.env.STARTER_TEST_DATABASE_URL,
  max: 1,
});
test.afterAll(async () => {
  await pool.end();
});

// Satu akun bersama untuk berkas ini (pendaftaran dibatasi lajunya). Sesi
// milik akun ini tidak pernah dikeluarkan atau dihapus oleh pengujian.
let shared: Cookies;
let sharedEmail: string;
// Nama cookie sesi sebenarnya, supaya pengujian cookie basi tidak menulis
// awalan sendiri.
let sessionCookieName: string;

async function emailOf(context: BrowserContext) {
  const response = await context.request.get("/api/auth/get-session");
  const body = (await response.json()) as { user: { email: string } };
  return body.user.email;
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin });
  shared = await signUp(context, "Petugas Gerbang");
  sharedEmail = await emailOf(context);
  await context.close();
  const cookie = shared.find((item) => item.name.endsWith(".session_token"));
  expect(cookie, "cookie sesi dari pendaftaran").toBeDefined();
  sessionCookieName = cookie!.name;
});

// Tujuan pengalihan sebagai URL mutlak di origin yang diminta.
function locationOf(response: APIResponse) {
  const location = response.headers()["location"];
  expect(location, "header Location").toBeTruthy();
  return new URL(location, origin);
}

// Dua alamat sama artinya: jalur sama dan pasangan query sama. Next menyerahkan
// query ke proxy dalam bentuk yang disusun ulang ("a%20b" menjadi "a+b"), yang
// bermakna sama bagi halaman (searchParams).
function sameDestination(actual: string | null, expected: string) {
  expect(actual, "next").not.toBeNull();
  const left = new URL(actual!, origin);
  const right = new URL(expected, origin);
  expect(left.origin).toBe(origin);
  expect(left.pathname).toBe(right.pathname);
  expect([...left.searchParams]).toEqual([...right.searchParams]);
}

const fields = (page: Page) => ({
  name: page.getByLabel("Nama", { exact: true }),
  email: page.getByLabel("Email", { exact: true }),
  password: page.getByLabel("Kata sandi", { exact: true }),
  signIn: page.getByRole("button", { name: "Masuk", exact: true }),
  signUp: page.getByRole("button", { name: "Buat akun", exact: true }),
  toSignUp: page.getByRole("link", { name: "Buat akun", exact: true }),
  toSignIn: page.getByRole("link", { name: "Masuk", exact: true }),
  heading: page.getByRole("heading", { level: 1 }),
});

// Formulir sudah dihidrasi: sebelum itu pengiriman ditangani browser, bukan skrip.
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return (
      form !== null &&
      Object.keys(form).some((key) => key.startsWith("__reactProps$"))
    );
  });
}

// Menjawab sign-in/sign-up seolah-olah berhasil dan memasang cookie sesi akun
// bersama. Dipakai untuk menguji tujuan setelah masuk tanpa menguras batas laju
// autentikasi (tiga per sepuluh detik); satu pengujian memakai server asli.
async function fakeAuthSuccess(context: BrowserContext, cookies: Cookies) {
  await context.route(/\/api\/auth\/sign-(in|up)\/email$/, async (route) => {
    await context.addCookies(cookies);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        redirect: false,
        token: "tiruan",
        user: { id: "tiruan", email: "tiruan@example.com", name: "Tiruan" },
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Anonim: dialihkan proxy, tanpa merender halaman
// ---------------------------------------------------------------------------

test.describe("anonim di jalur terlindungi", () => {
  // [diminta, tujuan yang dibawa (null = alamat masuk bersih)]
  const cases: [string, string | null][] = [
    ["/app", null],
    ["/app/alert", "/app/alert"],
    ["/app/anomali", "/app/anomali"],
    ["/app/billing", "/app/billing"],
    ["/app/pelanggan", "/app/pelanggan"],
    ["/app/router", "/app/router"],
    ["/app/router/new", "/app/router/new"],
    ["/app/xyz-tidak-ada", "/app/xyz-tidak-ada"],
    ["/setup", "/setup"],
    ["/admin", "/admin"],
    ["/app?focus=abc-123", "/app?focus=abc-123"],
    ["/app/alert?x=1&y=a%20b", "/app/alert?x=1&y=a%20b"],
    ["/app/pelanggan?q=%C3%A9&r=1", "/app/pelanggan?q=%C3%A9&r=1"],
    ["/app/./alert", "/app/alert"],
    ["/../app/alert", "/app/alert"],
  ];

  for (const [requested, carried] of cases) {
    test(`${requested} -> 307 ke ${carried === null ? "/sign-in" : "/sign-in?next=" + carried}`, async ({
      request,
    }) => {
      const response = await request.get(requested, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      const target = locationOf(response);
      expect(target.origin).toBe(origin);
      expect(target.pathname).toBe("/sign-in");
      if (carried === null) {
        expect(target.search).toBe("");
      } else {
        expect([...target.searchParams.keys()]).toEqual(["next"]);
        sameDestination(target.searchParams.get("next"), carried);
      }
      // Halaman tidak dirender sama sekali.
      const body = await response.text();
      expect(body).not.toContain("Memuat aplikasi");
      expect(body).not.toContain("Dashboard NOC");
    });
  }

  test("tujuan terkode utuh di Location, termasuk tanda & dan = di dalam query", async ({
    request,
  }) => {
    const response = await request.get("/app/alert?x=1&y=2", {
      maxRedirects: 0,
    });
    expect(locationOf(response).href).toBe(
      `${origin}/sign-in?next=%2Fapp%2Falert%3Fx%3D1%26y%3D2`,
    );
    // Bukan dua parameter terpisah.
    expect([...locationOf(response).searchParams.keys()]).toEqual(["next"]);
  });

  test("permintaan RSC (navigasi sisi klien) juga dialihkan, tanpa parameter internal _rsc", async ({
    request,
  }) => {
    const response = await request.get("/app/alert?_rsc=abc123", {
      headers: { RSC: "1" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(locationOf(response).href).toBe(
      `${origin}/sign-in?next=%2Fapp%2Falert`,
    );
  });

  test("POST (mis. Server Action) ke jalur terlindungi juga ditolak sebelum masuk ke aplikasi", async ({
    request,
  }) => {
    const response = await request.post("/app/alert", {
      headers: { Origin: origin },
      data: {},
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(locationOf(response).pathname).toBe("/sign-in");
  });

  test("jalur yang hanya mirip tidak dicegat dan tidak membocorkan apa-apa", async ({
    request,
  }) => {
    for (const path of [
      "/application",
      "/apps",
      "/administrator",
      "/setupx",
      "/%61pp/alert",
      "/App/alert",
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      expect(response.headers()["location"], path).toBeUndefined();
    }
  });
});

test.describe("jalur yang tidak terlindungi tetap lolos", () => {
  test("/sign-in dan /sign-up terbuka (200), dengan atau tanpa ?next=", async ({
    request,
  }) => {
    for (const path of [
      "/sign-in",
      "/sign-up",
      "/sign-in?next=%2Fapp%2Falert",
      "/sign-up?next=%2Fapp%2Falert",
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      expect(await response.text(), path).toContain("NOC ISP");
    }
  });

  test("/ tetap pengalih lama: anonim berakhir di /sign-in", async ({
    request,
  }) => {
    const response = await request.get("/", { maxRedirects: 0 });
    // 200 (pengalihan lewat aliran halaman) atau pengalihan biasa, seperti sebelumnya.
    if (response.status() === 200) {
      expect(await response.text()).toContain("/sign-in");
    } else {
      expect([307, 308]).toContain(response.status());
      expect(locationOf(response).pathname).toBe("/sign-in");
    }
  });

  test("API menjawab sendiri: get-session 200 berisi null, API terlindungi 401 JSON, bukan pengalihan", async ({
    request,
  }) => {
    const session = await request.get("/api/auth/get-session", {
      maxRedirects: 0,
    });
    expect(session.status()).toBe(200);
    expect(await session.json()).toBeNull();
    for (const path of ["/api/notes", "/api/admin/notes"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(401);
      expect(response.headers()["location"], path).toBeUndefined();
      expect(response.headers()["content-type"], path).toContain(
        "application/json",
      );
      expect((await response.json()).error.code, path).toBe("UNAUTHORIZED");
    }
  });

  test("aset publik (/icon.svg) terbuka", async ({ request }) => {
    const response = await request.get("/icon.svg", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Alur penuh di browser
// ---------------------------------------------------------------------------

test("anonim membuka tautan dalam, masuk, dan mendarat di tujuan semula; tautan membawa tujuan; keluar lalu kembali ke login", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, errors } = await contextFor(browser, []);
  const f = fields(page);
  try {
    await test.step("dialihkan ke /sign-in?next=...", async () => {
      await page.goto("/app/alert?focus=x");
      await expect(page).toHaveURL(
        `${origin}/sign-in?next=%2Fapp%2Falert%3Ffocus%3Dx`,
      );
      await expect(f.heading).toHaveText("Masuk ke NOC ISP");
      await hydrated(page);
    });

    await test.step("tautan antar halaman membawa tujuan", async () => {
      await expect(f.toSignUp).toHaveAttribute(
        "href",
        "/sign-up?next=%2Fapp%2Falert%3Ffocus%3Dx",
      );
      await f.toSignUp.click();
      await expect(page).toHaveURL(
        `${origin}/sign-up?next=%2Fapp%2Falert%3Ffocus%3Dx`,
      );
      await expect(f.heading).toHaveText("Buat akun petugas");
      await expect(f.toSignIn).toHaveAttribute(
        "href",
        "/sign-in?next=%2Fapp%2Falert%3Ffocus%3Dx",
      );
      await f.toSignIn.click();
      await expect(page).toHaveURL(
        `${origin}/sign-in?next=%2Fapp%2Falert%3Ffocus%3Dx`,
      );
      await hydrated(page);
    });

    await test.step("masuk dengan server asli mendarat di tujuan semula", async () => {
      await f.email.fill(sharedEmail);
      await f.password.fill(password);
      await f.signIn.click();
      // Bila kena batas laju autentikasi, tunggu jendelanya habis lalu ulangi.
      const outcome = await Promise.race([
        page
          .waitForURL(`${origin}/app/alert?focus=x`, { timeout: 15_000 })
          .then(() => "ok" as const),
        page
          .locator("#auth-error")
          .filter({ hasText: "Terlalu banyak percobaan" })
          .waitFor({ timeout: 15_000 })
          .then(() => "limited" as const),
      ]);
      if (outcome === "limited") {
        await delay(10_500);
        await f.signIn.click();
      }
      await expect(page).toHaveURL(`${origin}/app/alert?focus=x`);
      await expect(
        page.getByRole("heading", { name: "Alert", level: 1 }),
      ).toBeVisible();
    });

    await test.step("keluar, lalu membuka tautan dalam lagi menuju login dengan tujuannya", async () => {
      await page.getByRole("button", { name: "Keluar", exact: true }).click();
      // Keluar menuju halaman masuk dengan penegasan, tanpa tujuan.
      await expect(page).toHaveURL(`${origin}/sign-in?keluar=1`);
      await page.goto("/app/alert");
      await expect(page).toHaveURL(`${origin}/sign-in?next=%2Fapp%2Falert`);
      await page.goto("/setup");
      await expect(page).toHaveURL(`${origin}/sign-in?next=%2Fsetup`);
    });
  } finally {
    expect(errors.filter((message) => !/401|403/.test(message))).toEqual([]);
    await context.close();
  }
});

test("mendaftar dari tautan dalam juga mendarat di tujuan semula", async ({
  browser,
}) => {
  const { context, page } = await contextFor(browser, []);
  await fakeAuthSuccess(context, shared);
  const f = fields(page);
  try {
    await page.goto("/app/pelanggan?q=a");
    await expect(page).toHaveURL(
      `${origin}/sign-in?next=%2Fapp%2Fpelanggan%3Fq%3Da`,
    );
    await f.toSignUp.click();
    await expect(page).toHaveURL(
      `${origin}/sign-up?next=%2Fapp%2Fpelanggan%3Fq%3Da`,
    );
    await hydrated(page);
    await f.name.fill("Petugas Tiruan");
    await f.email.fill("tiruan@example.com");
    await f.password.fill(password);
    await f.signUp.click();
    await expect(page).toHaveURL(`${origin}/app/pelanggan?q=a`);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Open redirect
// ---------------------------------------------------------------------------

test.describe("tujuan setelah masuk tidak bisa dipakai membuang pengunjung ke tempat lain", () => {
  // [alamat masuk yang dibuka, tujuan yang sah (null = hanya /app)]
  const attacks: [string, string | null][] = [
    ["/sign-in?next=//evil.example", null],
    ["/sign-in?next=%2F%2Fevil.example", null],
    ["/sign-in?next=https://evil.example", null],
    ["/sign-in?next=https%3A%2F%2Fevil.example%2Fapp", null],
    [`/sign-in?next=${encodeURIComponent("/\\evil.example")}`, null],
    [`/sign-in?next=${encodeURIComponent("/\\/evil.example")}`, null],
    ["/sign-in?next=javascript:alert(1)", null],
    ["/sign-in?next=/api/notes", null],
    ["/sign-in?next=/sign-in", null],
    ["/sign-in?next=/sign-up?next=/app/alert", null],
    ["/sign-in?next=/app/../sign-in", null],
    ["/sign-in?next=/app/%2e%2e/%2e%2e/etc", null],
    ["/sign-in?next=/application", null],
    ["/sign-in?next=", null],
    ["/sign-in?next[]=/app/alert", null],
    ["/sign-in?next=/app/alert&next=/admin", null],
    ["/sign-up?next=//evil.example", null],
    ["/sign-up?next=https://evil.example", null],
    // Kontrol positif: yang sah dan ternormalkan tetap dihormati.
    ["/sign-in?next=/app/alert", "/app/alert"],
    ["/sign-in?next=/app/router/../alert", "/app/alert"],
    ["/sign-up?next=/setup", "/setup"],
  ];

  test("alamat berbahaya dibuang di server (tautan antar halaman bersih) dan formulir mengarah ke /app", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { context, page } = await contextFor(browser, []);
    await fakeAuthSuccess(context, shared);
    const f = fields(page);
    const hosts = new Set<string>();
    const visited: string[] = [];
    page.on("request", (request) => hosts.add(new URL(request.url()).host));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) visited.push(frame.url());
    });
    try {
      for (const [entry, legit] of attacks) {
        const signingUp = entry.startsWith("/sign-up");
        await context.clearCookies();
        await page.goto(entry);
        await hydrated(page);
        const expectedOther = legit
          ? `${signingUp ? "/sign-in" : "/sign-up"}?next=${encodeURIComponent(legit)}`
          : signingUp
            ? "/sign-in"
            : "/sign-up";
        await expect(
          signingUp ? f.toSignIn : f.toSignUp,
          entry,
        ).toHaveAttribute("href", expectedOther);
        if (signingUp) {
          await f.name.fill("Petugas Tiruan");
        }
        await f.email.fill("tiruan@example.com");
        await f.password.fill(password);
        await (signingUp ? f.signUp : f.signIn).click();
        await expect(page, entry).toHaveURL(`${origin}${legit ?? "/app"}`);
      }
      expect(
        [...hosts].filter((host) => host.includes("evil")),
        "host",
      ).toEqual([]);
      expect(
        visited.filter((url) => new URL(url).origin !== origin),
        "frame utama",
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Header palsu dan cookie basi
// ---------------------------------------------------------------------------

test.describe("header x-noc-path palsu dan cookie basi", () => {
  test("anonim yang mengirim x-noc-path palsu: tujuan tetap jalur yang diminta (proxy menimpa)", async ({
    request,
  }) => {
    for (const [name, value] of [
      ["x-noc-path", "//evil.example"],
      ["X-Noc-Path", "https://evil.example/app"],
      ["x-noc-path", "/admin"],
    ]) {
      const response = await request.get("/app/alert", {
        headers: { [name]: value },
        maxRedirects: 0,
      });
      expect(response.status(), `${name}: ${value}`).toBe(307);
      expect(locationOf(response).href, `${name}: ${value}`).toBe(
        `${origin}/sign-in?next=%2Fapp%2Falert`,
      );
    }
  });

  test("cookie sesi bernama benar tetapi nilainya ngawur: proxy meloloskan, server menolak dan membawa jalur asal (bukan header palsu)", async ({
    browser,
  }) => {
    const stale: Cookies = [
      {
        ...shared.find((cookie) => cookie.name === sessionCookieName)!,
        value: "ngawur.ngawur",
      },
    ];
    // Proxy tidak mengalihkan pemilik cookie (HTTP mentah: bukan 307).
    const probe = await browser.newContext({ baseURL: origin });
    await probe.addCookies(stale);
    const raw = await probe.request.get("/app/alert?focus=y", {
      headers: { "x-noc-path": "//evil.example" },
      maxRedirects: 0,
    });
    expect(raw.status()).toBe(200);
    expect(raw.headers()["location"]).toBeUndefined();
    await probe.close();

    for (const forged of [null, "//evil.example", "https://evil.example/app"]) {
      const { context, page } = await contextFor(browser, stale);
      if (forged) await context.setExtraHTTPHeaders({ "x-noc-path": forged });
      const navigations: string[] = [];
      page.on("request", (request) => {
        if (request.isNavigationRequest()) navigations.push(request.url());
      });
      try {
        await page.goto("/app/alert?focus=y");
        // Cookie ada tetapi bukan sesi: penanda "sesi berakhir" ikut, sesudah
        // tujuan semula (urutan kunci tetap).
        await expect(page, String(forged)).toHaveURL(
          `${origin}/sign-in?next=%2Fapp%2Falert%3Ffocus%3Dy&sesi=berakhir`,
        );
        await expect(fields(page).heading).toHaveText("Masuk ke NOC ISP");
        await expect(
          page.getByRole("status").filter({
            hasText: "Sesi Anda berakhir. Masuk lagi untuk melanjutkan.",
          }),
        ).toBeVisible();
        // Tanpa putaran: halaman masuk menampilkan formulir, tidak melempar ke dasbor.
        await page.waitForTimeout(500);
        await expect(page).toHaveURL(
          `${origin}/sign-in?next=%2Fapp%2Falert%3Ffocus%3Dy&sesi=berakhir`,
        );
        expect(navigations.length, navigations.join(" > ")).toBeLessThanOrEqual(
          4,
        );
        expect(
          navigations.filter((url) => url.includes("evil.example")),
        ).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });

  test("sesi yang dihapus di database: cookie sah bentuknya, ditolak server, jalur asal terbawa", async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const maker = await browser.newContext({ baseURL: origin });
    const cookies = await signUp(maker, "Petugas Basi");
    const email = await emailOf(maker);
    await maker.close();
    const removed = await pool.query(
      `DELETE FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`,
      [email],
    );
    expect(removed.rowCount).toBeGreaterThanOrEqual(1);

    const { context, page } = await contextFor(browser, cookies);
    try {
      await page.goto("/app/billing?x=1");
      await expect(page).toHaveURL(
        `${origin}/sign-in?next=%2Fapp%2Fbilling%3Fx%3D1&sesi=berakhir`,
      );
      await expect(fields(page).heading).toHaveText("Masuk ke NOC ISP");
      await expect(
        page.getByRole("status").filter({
          hasText: "Sesi Anda berakhir. Masuk lagi untuk melanjutkan.",
        }),
      ).toBeVisible();
      // /setup dan /admin juga: layout yang sama menolak.
      await page.goto("/setup");
      await expect(page).toHaveURL(
        `${origin}/sign-in?next=%2Fsetup&sesi=berakhir`,
      );
      await page.goto("/admin");
      await expect(page).toHaveURL(
        `${origin}/sign-in?next=%2Fadmin&sesi=berakhir`,
      );
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Sudah masuk
// ---------------------------------------------------------------------------

test.describe("petugas yang sudah masuk", () => {
  test("/sign-in?next=... mengalihkan ke /app (perilaku layout lama), tanpa putaran, dan /app/alert terbuka normal", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, shared);
    const navigations: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest()) navigations.push(request.url());
    });
    try {
      await page.goto("/sign-in?next=%2Fapp%2Falert");
      await expect(page).toHaveURL(`${origin}/app`);
      await expect(
        page.getByRole("heading", { name: "Dashboard NOC" }),
      ).toBeVisible();
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(`${origin}/app`);
      expect(navigations.length, navigations.join(" > ")).toBeLessThanOrEqual(
        3,
      );

      await page.goto("/app/alert");
      await expect(page).toHaveURL(`${origin}/app/alert`);
      await expect(
        page.getByRole("heading", { name: "Alert", level: 1 }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("awalan cookie tidak menyimpang: akun yang masuk lewat Better Auth membuka halaman terlindungi langsung", async ({
    browser,
  }) => {
    const { context, page } = await contextFor(browser, shared);
    try {
      // HTTP mentah: proxy meloloskan, tidak ada pengalihan.
      for (const path of ["/app", "/app/billing", "/app/alert?focus=z"]) {
        const raw = await context.request.get(path, { maxRedirects: 0 });
        expect(raw.status(), path).toBe(200);
        expect(raw.headers()["location"], path).toBeUndefined();
      }
      await page.goto("/app/billing");
      await expect(page).toHaveURL(`${origin}/app/billing`);
      await expect(page.getByTestId("billing-sync")).toBeVisible();
      // Dan cookie itu memang yang bernama .session_token dari Better Auth.
      expect(sessionCookieName).toMatch(
        /^ngodingpakeai-[\w-]+\.session_token$/,
      );
    } finally {
      await context.close();
    }
  });
});
